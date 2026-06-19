import type { HandlerRegistry } from './handler-registry.js';
import type { OutboxRepositoryContract } from './outbox.repository.js';

export type ProcessorConfig = { batchSize: number; maxAttempts: number };

export class OutboxProcessor {
  constructor(
    private readonly repository: OutboxRepositoryContract,
    private readonly registry: HandlerRegistry,
    private readonly config: ProcessorConfig
  ) {}

  async drainOnce(workerId: string): Promise<number> {
    const events = await this.repository.claimBatch(workerId, this.config.batchSize);
    for (const event of events) {
      try {
        for (const handler of this.registry.handlersFor(event.eventType)) {
          await handler(event);
        }
        await this.repository.complete(event.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown handler failure';
        await this.repository.fail(event.id, message, this.config.maxAttempts);
      }
    }
    return events.length;
  }
}
