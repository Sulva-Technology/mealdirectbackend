import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import {
  AllowedImageContentTypes,
  allowedImageContentTypes,
  type StorageBucket
} from './storage.constants.js';
import { StorageService, type SignedUploadTarget } from './storage.service.js';

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

export type IssueUploadInput = {
  bucket: StorageBucket;
  ownerPrefix: string;
  contentType: string;
  sizeBytes: number;
  maxBytes: number;
};

export type ConfirmUploadInput = {
  bucket: StorageBucket;
  key: string;
  ownerPrefix: string;
  maxBytes: number;
};

/**
 * Upload orchestration over StorageService: owner-scoped key derivation, content
 * type / size validation, and post-upload confirmation (HEAD the object before a
 * key is ever persisted). The API never trusts a client-supplied path.
 */
@Injectable()
export class MediaService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  private assertContentType(contentType: string): string {
    const ext = AllowedImageContentTypes[contentType];
    if (ext === undefined) {
      throw badRequest(`contentType must be one of: ${allowedImageContentTypes.join(', ')}.`);
    }
    return ext;
  }

  private assertSize(sizeBytes: number, maxBytes: number): void {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw badRequest('sizeBytes must be a positive integer.');
    }
    if (sizeBytes > maxBytes) {
      throw badRequest(`File exceeds the maximum allowed size of ${String(maxBytes)} bytes.`);
    }
  }

  /**
   * Validate the request and mint a signed upload URL at an owner-scoped key. The
   * key is computed server-side (`{ownerPrefix}/{uuid}.{ext}`) so a client can only
   * ever write under its own prefix.
   */
  async issueUpload(input: IssueUploadInput): Promise<SignedUploadTarget> {
    const ext = this.assertContentType(input.contentType);
    this.assertSize(input.sizeBytes, input.maxBytes);

    const key = `${input.ownerPrefix}/${randomUUID()}.${ext}`;
    return this.storage.createSignedUploadUrl(input.bucket, key);
  }

  /**
   * Verify a client-reported upload before its key is persisted: the key must be
   * owner-scoped, the object must exist, and its real content type and size must
   * satisfy the allowlist and cap. Throws on any violation.
   */
  async confirmUpload(input: ConfirmUploadInput): Promise<void> {
    if (!input.key.startsWith(`${input.ownerPrefix}/`)) {
      throw badRequest('key does not belong to the current owner.');
    }

    const info = await this.storage.getObjectInfo(input.bucket, input.key);
    if (info === undefined) {
      throw badRequest('No uploaded object was found at the provided key.');
    }
    if (info.contentType !== null) {
      this.assertContentType(info.contentType);
    }
    this.assertSize(info.sizeBytes, input.maxBytes);
  }

  /** Best-effort orphan cleanup when an image is replaced or cleared. */
  async removeIfKey(bucket: StorageBucket, previous: string | null | undefined): Promise<void> {
    if (typeof previous === 'string' && previous.length > 0 && !/^https?:\/\//i.test(previous)) {
      await this.storage.removeObject(bucket, previous);
    }
  }
}
