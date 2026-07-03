import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { isStorageKey, type StorageBucket } from './storage.constants.js';

export type SignedUploadTarget = {
  uploadUrl: string;
  token: string;
  key: string;
};

export type StorageObjectInfo = {
  sizeBytes: number;
  contentType: string | null;
};

/**
 * Service-role gateway to Supabase Storage. Mirrors SupabaseAuthService's admin
 * client pattern: buckets are private, so every read path signs keys here and
 * uploads are issued as short-lived signed upload URLs (client → Storage direct,
 * the API never streams file bytes).
 */
@Injectable()
export class StorageService {
  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  private client() {
    const serviceRoleKey = this.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceRoleKey === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Media storage is not configured (SUPABASE_SERVICE_ROLE_KEY missing).'
      });
    }
    return createClient(this.env.get('SUPABASE_URL'), serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  private ttl(): number {
    return this.env.get('MEDIA_SIGNED_URL_TTL_SECONDS');
  }

  /** Issue a signed upload URL the client PUTs the binary to directly. */
  async createSignedUploadUrl(bucket: StorageBucket, key: string): Promise<SignedUploadTarget> {
    const { data, error } = await this.client().storage.from(bucket).createSignedUploadUrl(key);
    if (error || !data) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: error?.message ?? 'Could not create an upload URL.'
      });
    }
    return { uploadUrl: data.signedUrl, token: data.token, key: data.path };
  }

  /**
   * Verify an uploaded object landed at `key` and report its real size and content
   * type. Returns undefined when nothing exists at the key. Used by confirm flows to
   * validate the client-reported upload before persisting the key.
   */
  async getObjectInfo(bucket: StorageBucket, key: string): Promise<StorageObjectInfo | undefined> {
    const slash = key.lastIndexOf('/');
    const folder = slash === -1 ? '' : key.slice(0, slash);
    const name = slash === -1 ? key : key.slice(slash + 1);

    const { data, error } = await this.client()
      .storage.from(bucket)
      .list(folder, { search: name, limit: 100 });
    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: error.message
      });
    }

    const match = (data ?? []).find((entry) => entry.name === name);
    if (match === undefined) {
      return undefined;
    }

    const metadata = (match.metadata ?? {}) as { size?: number; mimetype?: string };
    return {
      sizeBytes: typeof metadata.size === 'number' ? metadata.size : 0,
      contentType: typeof metadata.mimetype === 'string' ? metadata.mimetype : null
    };
  }

  /** Delete an object; best-effort orphan cleanup on replace. Never throws. */
  async removeObject(bucket: StorageBucket, key: string): Promise<void> {
    try {
      await this.client().storage.from(bucket).remove([key]);
    } catch {
      // orphan cleanup is best-effort; a leaked object must not fail the request
    }
  }

  /**
   * Sign a single stored value into a short-lived read URL. Null/undefined and
   * already-absolute URLs pass through unchanged.
   */
  async signKey(
    bucket: StorageBucket,
    value: string | null | undefined
  ): Promise<string | null | undefined> {
    if (value === null || value === undefined) return value;
    if (!isStorageKey(value)) return value;

    const { data, error } = await this.client()
      .storage.from(bucket)
      .createSignedUrl(value, this.ttl());
    if (error || !data) {
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Batch-sign many stored values in one Storage round trip, preserving order and
   * passing through null/undefined and absolute URLs. Avoids N calls on list paths.
   */
  async signKeys(
    bucket: StorageBucket,
    values: (string | null | undefined)[]
  ): Promise<(string | null | undefined)[]> {
    const keyIndexes: number[] = [];
    const keys: string[] = [];
    values.forEach((value, index) => {
      if (typeof value === 'string' && isStorageKey(value)) {
        keyIndexes.push(index);
        keys.push(value);
      }
    });

    if (keys.length === 0) {
      return values;
    }

    const { data, error } = await this.client()
      .storage.from(bucket)
      .createSignedUrls(keys, this.ttl());

    const result = [...values];
    if (error || !data) {
      // Fail closed on the keyed slots so a signing outage cannot leak raw paths.
      for (const index of keyIndexes) result[index] = null;
      return result;
    }

    data.forEach((signed, position) => {
      const index = keyIndexes[position];
      if (index !== undefined) {
        result[index] = signed.error || !signed.signedUrl ? null : signed.signedUrl;
      }
    });
    return result;
  }
}
