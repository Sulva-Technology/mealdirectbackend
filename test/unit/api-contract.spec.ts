import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { normalizeDateRange } from '../../src/common/api/date-range.js';
import {
  createCursorPage,
  decodeCursor,
  encodeCursor,
  normalizeCursorPagination
} from '../../src/common/api/pagination.js';
import { createListEnvelope, createSuccessEnvelope } from '../../src/common/api/response.js';
import { parseSort } from '../../src/common/api/sorting.js';
import { normalizeIdempotencyKey } from '../../src/common/http/idempotency-key.js';
import { CursorPaginationQueryDto, MoneyDto } from '../../src/common/dto/api-contract.dto.js';

describe('API contract foundation', () => {
  it('normalizes cursor pagination defaults and caps service limits', () => {
    expect(normalizeCursorPagination({})).toEqual({ limit: 20 });
    expect(normalizeCursorPagination({ limit: 250, cursor: 'abc' })).toEqual({
      cursor: 'abc',
      limit: 100
    });
  });

  it('encodes opaque cursors and rejects malformed cursor tokens', () => {
    const cursor = encodeCursor({ createdAt: '2026-06-15T00:00:00.000Z', id: 'order-1' });

    expect(decodeCursor(cursor)).toEqual({
      createdAt: '2026-06-15T00:00:00.000Z',
      id: 'order-1'
    });
    expect(() => decodeCursor('not-valid-json')).toThrow('Invalid cursor.');
  });

  it('creates cursor pages from limit-plus-one query results', () => {
    const page = createCursorPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, (item) =>
      encodeCursor({ id: item.id })
    );

    expect(page).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      pagination: {
        hasMore: true,
        limit: 2,
        nextCursor: encodeCursor({ id: 'b' })
      }
    });
  });

  it('parses explicit sort rules against an allowlist', () => {
    expect(
      parseSort('createdAt:desc', ['createdAt', 'name'], { field: 'name', direction: 'asc' })
    ).toEqual({ field: 'createdAt', direction: 'desc' });
    expect(
      parseSort('-name', ['createdAt', 'name'], { field: 'createdAt', direction: 'desc' })
    ).toEqual({ field: 'name', direction: 'desc' });
    expect(() =>
      parseSort('email:asc', ['createdAt', 'name'], { field: 'createdAt', direction: 'desc' })
    ).toThrow('Unsupported sort field.');
  });

  it('validates date ranges before services apply filters', () => {
    expect(
      normalizeDateRange({
        dateFrom: '2026-06-15T00:00:00.000Z',
        dateTo: '2026-06-16T00:00:00.000Z'
      })
    ).toEqual({
      dateFrom: new Date('2026-06-15T00:00:00.000Z'),
      dateTo: new Date('2026-06-16T00:00:00.000Z')
    });

    expect(() =>
      normalizeDateRange({
        dateFrom: '2026-06-17T00:00:00.000Z',
        dateTo: '2026-06-16T00:00:00.000Z'
      })
    ).toThrow('dateFrom must be before or equal to dateTo.');
  });

  it('validates shared query and money DTOs', async () => {
    const pageDto = plainToInstance(CursorPaginationQueryDto, { limit: '101' });
    const moneyDto = plainToInstance(MoneyDto, { amountCents: -1, currency: 'ngn' });

    await expect(validate(pageDto)).resolves.toHaveLength(1);
    await expect(validate(moneyDto)).resolves.toHaveLength(2);
  });

  it('creates standard success and list envelopes without empty optional fields', () => {
    expect(createSuccessEnvelope({ id: 'order-1' })).toEqual({
      data: { id: 'order-1' }
    });
    expect(createListEnvelope([{ id: 'order-1' }], { hasMore: false, limit: 20 })).toEqual({
      data: [{ id: 'order-1' }],
      pagination: { hasMore: false, limit: 20 }
    });
  });

  it('normalizes idempotency keys from Fastify headers', () => {
    expect(normalizeIdempotencyKey([' order-key-1 ', 'ignored'])).toBe('order-key-1');
    expect(() => normalizeIdempotencyKey(undefined)).toThrow('Idempotency-Key header is required.');
    expect(() => normalizeIdempotencyKey('a'.repeat(129))).toThrow(
      'Idempotency-Key header must be 128 characters or less.'
    );
  });
});
