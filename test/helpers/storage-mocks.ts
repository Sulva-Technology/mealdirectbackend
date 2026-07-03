import { vi } from 'vitest';

import type { MediaService } from '../../src/modules/storage/media.service.js';
import type { StorageService } from '../../src/modules/storage/storage.service.js';

/** Pass-through StorageService: signing returns stored keys unchanged. */
export function createStorageServiceMock(): StorageService {
  return {
    signKey: vi.fn((_bucket: unknown, value: unknown) => Promise.resolve(value)),
    signKeys: vi.fn((_bucket: unknown, values: unknown) => Promise.resolve(values)),
    createSignedUploadUrl: vi.fn(),
    getObjectInfo: vi.fn(),
    removeObject: vi.fn().mockResolvedValue(undefined)
  } as unknown as StorageService;
}

export function createMediaServiceMock(): MediaService {
  return {
    issueUpload: vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example/upload',
      token: 'token',
      key: 'owner/uuid.webp'
    }),
    confirmUpload: vi.fn().mockResolvedValue(undefined),
    removeIfKey: vi.fn().mockResolvedValue(undefined)
  } as unknown as MediaService;
}
