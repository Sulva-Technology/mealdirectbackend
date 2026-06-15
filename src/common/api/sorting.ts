export type SortDirection = 'asc' | 'desc';

export type SortRule<TField extends string = string> = {
  field: TField;
  direction: SortDirection;
};

function isSortDirection(value: string): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

export function parseSort<TField extends string>(
  value: string | undefined,
  allowedFields: readonly TField[],
  fallback: SortRule<TField>
): SortRule<TField> {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const trimmed = value.trim();
  const directionFromPrefix = trimmed.startsWith('-') ? 'desc' : undefined;
  const withoutPrefix = directionFromPrefix === undefined ? trimmed : trimmed.slice(1);
  const [field, rawDirection = directionFromPrefix ?? fallback.direction] = withoutPrefix.split(':');

  if (field === undefined || !allowedFields.includes(field as TField)) {
    throw new Error('Unsupported sort field.');
  }
  if (!isSortDirection(rawDirection)) {
    throw new Error('Unsupported sort direction.');
  }

  return {
    field: field as TField,
    direction: rawDirection
  };
}
