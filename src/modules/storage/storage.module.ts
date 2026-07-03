import { Global, Module } from '@nestjs/common';

import { MediaService } from './media.service.js';
import { StorageService } from './storage.service.js';

/**
 * Global so any capability module (catalog, vendors, profiles) can inject the
 * signer without re-importing. Read paths across the app all depend on it.
 */
@Global()
@Module({
  providers: [StorageService, MediaService],
  exports: [StorageService, MediaService]
})
export class StorageModule {}
