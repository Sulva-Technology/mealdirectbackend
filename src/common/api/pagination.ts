export const defaultCursorLimit = 20;
export const maxCursorLimit = 100;

export type CursorPayload = Record<string, boolean | number | string | null>;

export type CursorPaginationInput = {
  cursor?: string;
  limit?: number;
};

export type NormalizedCursorPagination = {
  cursor?: string;
  limit: number;
};

export type CursorPaginationMeta = {
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type CursorPage<T> = {
  items: T[];
  pagination: CursorPaginationMeta;
};

function isCursorPayload(value: unknown): value is CursorPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeCursorPagination(
  input: CursorPaginationInput
): NormalizedCursorPagination {
  const requestedLimit = input.limit ?? defaultCursorLimit;
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), maxCursorLimit)
      : defaultCursorLimit;

  return {
    limit,
    ...(input.cursor === undefined || input.cursor.length === 0 ? {} : { cursor: input.cursor })
  };
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isCursorPayload(parsed)) {
      throw new Error('Cursor payload must be an object.');
    }
    return parsed;
  } catch {
    throw new Error('Invalid cursor.');
  }
}

export function createCursorPage<T>(
  rows: readonly T[],
  limit: number,
  cursorForItem: (item: T) => string
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const lastItem = items.at(-1);
  const pagination: CursorPaginationMeta = {
    hasMore,
    limit,
    ...(hasMore && lastItem !== undefined ? { nextCursor: cursorForItem(lastItem) } : {})
  };

  return {
    items,
    pagination
  };
}
