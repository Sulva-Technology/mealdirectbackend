import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaService } from '../../src/modules/storage/media.service.js';
import { MaxMenuImageBytes, StorageBuckets } from '../../src/modules/storage/storage.constants.js';
import type { StorageService } from '../../src/modules/storage/storage.service.js';

function createStorage(overrides: Partial<StorageService> = {}): StorageService {
  return {
    createSignedUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example/upload',
      token: 'token',
      key: 'placeholder'
    }),
    getObjectInfo: vi.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'image/webp' }),
    removeObject: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as StorageService;
}

const vendorPrefix = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';

describe('MediaService', () => {
  let storage: StorageService;
  let media: MediaService;

  beforeEach(() => {
    storage = createStorage();
    media = new MediaService(storage);
  });

  describe('issueUpload', () => {
    it('rejects a content type outside the image allowlist', async () => {
      await expect(
        media.issueUpload({
          bucket: StorageBuckets.menuItemImages,
          ownerPrefix: vendorPrefix,
          contentType: 'application/pdf',
          sizeBytes: 1024,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a file larger than the surface cap', async () => {
      await expect(
        media.issueUpload({
          bucket: StorageBuckets.menuItemImages,
          ownerPrefix: vendorPrefix,
          contentType: 'image/png',
          sizeBytes: MaxMenuImageBytes + 1,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('signs an owner-scoped key with the extension for the content type', async () => {
      await media.issueUpload({
        bucket: StorageBuckets.menuItemImages,
        ownerPrefix: vendorPrefix,
        contentType: 'image/webp',
        sizeBytes: 2048,
        maxBytes: MaxMenuImageBytes
      });

      expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
      const [bucket, key] = vi.mocked(storage.createSignedUploadUrl).mock.calls[0] ?? [];
      expect(bucket).toBe(StorageBuckets.menuItemImages);
      expect(key).toMatch(new RegExp(`^${vendorPrefix}/[0-9a-f-]{36}\\.webp$`));
    });
  });

  describe('confirmUpload', () => {
    it('rejects a key outside the owner prefix', async () => {
      await expect(
        media.confirmUpload({
          bucket: StorageBuckets.menuItemImages,
          key: 'someone-else/abc.webp',
          ownerPrefix: vendorPrefix,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.getObjectInfo).not.toHaveBeenCalled();
    });

    it('rejects when no object exists at the key', async () => {
      storage = createStorage({ getObjectInfo: vi.fn().mockResolvedValue(undefined) });
      media = new MediaService(storage);

      await expect(
        media.confirmUpload({
          bucket: StorageBuckets.menuItemImages,
          key: `${vendorPrefix}/abc.webp`,
          ownerPrefix: vendorPrefix,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an object whose real size exceeds the cap', async () => {
      storage = createStorage({
        getObjectInfo: vi
          .fn()
          .mockResolvedValue({ sizeBytes: MaxMenuImageBytes + 1, contentType: 'image/webp' })
      });
      media = new MediaService(storage);

      await expect(
        media.confirmUpload({
          bucket: StorageBuckets.menuItemImages,
          key: `${vendorPrefix}/abc.webp`,
          ownerPrefix: vendorPrefix,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an object whose real content type is not allowed', async () => {
      storage = createStorage({
        getObjectInfo: vi
          .fn()
          .mockResolvedValue({ sizeBytes: 1024, contentType: 'application/pdf' })
      });
      media = new MediaService(storage);

      await expect(
        media.confirmUpload({
          bucket: StorageBuckets.menuItemImages,
          key: `${vendorPrefix}/abc.webp`,
          ownerPrefix: vendorPrefix,
          maxBytes: MaxMenuImageBytes
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a verified, owner-scoped, in-spec object', async () => {
      await expect(
        media.confirmUpload({
          bucket: StorageBuckets.menuItemImages,
          key: `${vendorPrefix}/abc.webp`,
          ownerPrefix: vendorPrefix,
          maxBytes: MaxMenuImageBytes
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('removeIfKey', () => {
    it('removes opaque keys but ignores absolute URLs and empty values', async () => {
      await media.removeIfKey(StorageBuckets.avatars, 'user/old.webp');
      await media.removeIfKey(StorageBuckets.avatars, 'https://cdn.example/x.png');
      await media.removeIfKey(StorageBuckets.avatars, null);

      expect(storage.removeObject).toHaveBeenCalledTimes(1);
      expect(storage.removeObject).toHaveBeenCalledWith(StorageBuckets.avatars, 'user/old.webp');
    });
  });
});
