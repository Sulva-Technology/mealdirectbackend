import type { OutboxEvent } from './outbox.repository.js';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private readonly prefixHandlers: { prefix: string; handler: OutboxHandler }[] = [];

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  registerPrefix(prefix: string, handler: OutboxHandler): void {
    this.prefixHandlers.push({ prefix, handler });
  }

  handlersFor(eventType: string): OutboxHandler[] {
    const exact = this.handlers.get(eventType) ?? [];
    const prefixed = this.prefixHandlers
      .filter(({ prefix }) => eventType.startsWith(prefix))
      .map(({ handler }) => handler);
    return [...exact, ...prefixed];
  }
}
