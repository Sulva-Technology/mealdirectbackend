import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageBuckets } from '../../src/modules/storage/storage.constants.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import type { EnvService } from '../../src/config/env.service.js';

const storageApi = {
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  createSignedUrls: vi.fn(),
  list: vi.fn(),
  remove: vi.fn()
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: vi.fn(() => storageApi) } }))
}));

function createEnv(overrides: Record<string, unknown> = {}): EnvService {
  const values: Record<string, unknown> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    MEDIA_SIGNED_URL_TTL_SECONDS: 3600,
    ...overrides
  };
  return { get: (key: string) => values[key] } as unknown as EnvService;
}

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a clear error when the service role key is missing', async () => {
    const service = new StorageService(createEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }));
    await expect(service.signKey(StorageBuckets.avatars, 'user/a.webp')).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  describe('signKey', () => {
    it('passes absolute URLs and nullish values through without signing', async () => {
      const service = new StorageService(createEnv());
      await expect(service.signKey(StorageBuckets.avatars, 'https://cdn/x.png')).resolves.toBe(
        'https://cdn/x.png'
      );
      await expect(service.signKey(StorageBuckets.avatars, null)).resolves.toBeNull();
      expect(storageApi.createSignedUrl).not.toHaveBeenCalled();
    });

    it('signs an opaque key with the configured TTL', async () => {
      storageApi.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/a' },
        error: null
      });
      const service = new StorageService(createEnv());

      await expect(service.signKey(StorageBuckets.avatars, 'user/a.webp')).resolves.toBe(
        'https://signed/a'
      );
      expect(storageApi.createSignedUrl).toHaveBeenCalledWith('user/a.webp', 3600);
    });
  });

  describe('signKeys', () => {
    it('batch-signs only opaque keys and preserves order and pass-throughs', async () => {
      storageApi.createSignedUrls.mockResolvedValue({
        data: [
          { path: 'a/1.webp', signedUrl: 'https://signed/1', error: null },
          { path: 'b/2.webp', signedUrl: 'https://signed/2', error: null }
        ],
        error: null
      });
      const service = new StorageService(createEnv());

      const result = await service.signKeys(StorageBuckets.menuItemImages, [
        'a/1.webp',
        'https://cdn/x',
        'b/2.webp',
        null
      ]);

      expect(storageApi.createSignedUrls).toHaveBeenCalledTimes(1);
      expect(storageApi.createSignedUrls).toHaveBeenCalledWith(['a/1.webp', 'b/2.webp'], 3600);
      expect(result).toEqual(['https://signed/1', 'https://cdn/x', 'https://signed/2', null]);
    });

    it('fails closed on keyed slots when signing errors', async () => {
      storageApi.createSignedUrls.mockResolvedValue({ data: null, error: { message: 'boom' } });
      const service = new StorageService(createEnv());

      const result = await service.signKeys(StorageBuckets.menuItemImages, [
        'a/1.webp',
        'https://cdn/x'
      ]);

      expect(result).toEqual([null, 'https://cdn/x']);
    });

    it('makes no round trip when there are no keys to sign', async () => {
      const service = new StorageService(createEnv());
      const result = await service.signKeys(StorageBuckets.avatars, ['https://cdn/x', null]);
      expect(result).toEqual(['https://cdn/x', null]);
      expect(storageApi.createSignedUrls).not.toHaveBeenCalled();
    });
  });

  describe('getObjectInfo', () => {
    it('returns size and content type for a matching object', async () => {
      storageApi.list.mockResolvedValue({
        data: [{ name: 'a.webp', metadata: { size: 1234, mimetype: 'image/webp' } }],
        error: null
      });
      const service = new StorageService(createEnv());

      await expect(
        service.getObjectInfo(StorageBuckets.menuItemImages, 'vendor/item/a.webp')
      ).resolves.toEqual({ sizeBytes: 1234, contentType: 'image/webp' });
      expect(storageApi.list).toHaveBeenCalledWith('vendor/item', {
        search: 'a.webp',
        limit: 100
      });
    });

    it('returns undefined when nothing matches the key', async () => {
      storageApi.list.mockResolvedValue({ data: [], error: null });
      const service = new StorageService(createEnv());
      await expect(
        service.getObjectInfo(StorageBuckets.menuItemImages, 'vendor/item/missing.webp')
      ).resolves.toBeUndefined();
    });
  });

  describe('createSignedUploadUrl', () => {
    it('maps the Supabase response to an upload target', async () => {
      storageApi.createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: 'https://upload', token: 'tok', path: 'vendor/item/a.webp' },
        error: null
      });
      const service = new StorageService(createEnv());

      await expect(
        service.createSignedUploadUrl(StorageBuckets.menuItemImages, 'vendor/item/a.webp')
      ).resolves.toEqual({ uploadUrl: 'https://upload', token: 'tok', key: 'vendor/item/a.webp' });
    });
  });
});
