export type DateRangeInput = {
  dateFrom?: string;
  dateTo?: string;
};

export type NormalizedDateRange = {
  dateFrom?: Date;
  dateTo?: Date;
};

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid ISO date string.`);
  }
  return date;
}

export function normalizeDateRange(input: DateRangeInput): NormalizedDateRange {
  const dateFrom = input.dateFrom === undefined ? undefined : parseDate(input.dateFrom, 'dateFrom');
  const dateTo = input.dateTo === undefined ? undefined : parseDate(input.dateTo, 'dateTo');

  if (dateFrom !== undefined && dateTo !== undefined && dateFrom.getTime() > dateTo.getTime()) {
    throw new Error('dateFrom must be before or equal to dateTo.');
  }

  return {
    ...(dateFrom === undefined ? {} : { dateFrom }),
    ...(dateTo === undefined ? {} : { dateTo })
  };
}
