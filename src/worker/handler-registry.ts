import type { OutboxEvent } from './outbox.repository.js';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  handlersFor(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }
}
