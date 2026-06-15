import type { CursorPaginationMeta } from './pagination.js';

export type SuccessEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ListEnvelope<T> = {
  data: T[];
  pagination: CursorPaginationMeta;
  meta?: Record<string, unknown>;
};

export function createSuccessEnvelope<T>(
  data: T,
  meta?: Record<string, unknown>
): SuccessEnvelope<T> {
  return {
    data,
    ...(meta === undefined ? {} : { meta })
  };
}

export function createListEnvelope<T>(
  data: T[],
  pagination: CursorPaginationMeta,
  meta?: Record<string, unknown>
): ListEnvelope<T> {
  return {
    data,
    pagination,
    ...(meta === undefined ? {} : { meta })
  };
}
