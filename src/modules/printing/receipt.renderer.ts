import type { Receipt, ReceiptItem } from './printing.types.js';

// Plain-text kitchen ticket for CloudPRNT text/plain jobs. Pure functions only so the layout
// is unit-testable without a printer. Output is ASCII: printer code pages lack ₦ and many
// accented glyphs, so text is transliterated and money is written as "NGN".

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const DELIVERY_MODE_LABELS: Record<string, string> = {
  meal_direct_rider: 'MealDirect rider',
  vendor_delivery: 'Vendor delivery'
};

/** Strip diacritics and anything outside printable ASCII. */
export function toAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u20a6/g, 'NGN ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00d7/g, 'x')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

/** 300000 kobo → "NGN 3,000"; 150050 → "NGN 1,500.50". */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  const whole = Number.isInteger(naira);
  const text = naira.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2
  });
  return `NGN ${text}`;
}

/** "2026-09-23" → "WED 23 SEP". The date is a calendar date, so it is read in UTC. */
export function formatServiceDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return serviceDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return serviceDate;
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${String(day).padStart(2, '0')} ${MONTHS[month - 1] ?? ''}`;
}

/** "13:00" → "1:00 PM". */
export function formatClockTime(hhmm: string): string {
  const [hourText, minuteText] = hhmm.split(':');
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || minuteText === undefined) return hhmm;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12)}:${minuteText.slice(0, 2)} ${suffix}`;
}

/** Timestamp → "23 Sep 12:41" in the campus timezone. */
export function formatLocalTimestamp(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone
    }).formatToParts(date);
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const monthName = MONTHS[Number(part('month')) - 1] ?? part('month');
    return `${part('day')} ${monthName.charAt(0)}${monthName.slice(1).toLowerCase()} ${part('hour')}:${part('minute')}`;
  } catch {
    return iso;
  }
}

/** Greedy word wrap; words longer than the width are hard-split. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const rawWord of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      let word = rawWord;
      while (word.length > width) {
        if (line.length > 0) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return `${' '.repeat(pad)}${text}`;
}

/** Left text + right-aligned amount on one line, wrapping the left side if needed. */
function leftRight(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  if (room < 8) return [...wrap(left, width), right.padStart(width)];
  const wrapped = wrap(left, room);
  const first = wrapped[0] ?? '';
  return [`${first.padEnd(room)} ${right}`, ...wrapped.slice(1)];
}

/** "customFoodType" → "Custom food type". */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function describeValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === false || value === '') return undefined;
  if (value === true) return 'Yes';
  if (typeof value === 'string') return value.trim().length === 0 ? undefined : value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(describeValue).filter((part): part is string => part !== undefined);
    return parts.length === 0 ? undefined : parts.join(', ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const label = record.name ?? record.label ?? record.title;
    const quantity = record.quantity ?? record.qty ?? record.count;
    if (typeof label === 'string' && label.trim().length > 0) {
      return typeof quantity === 'number' && quantity > 1 ? `${String(quantity)}x ${label}` : label;
    }
    const parts = Object.entries(record)
      .map(([key, inner]) => {
        const described = describeValue(inner);
        return described === undefined ? undefined : `${humanizeKey(key)}: ${described}`;
      })
      .filter((part): part is string => part !== undefined);
    return parts.length === 0 ? undefined : parts.join('; ');
  }
  return undefined;
}

/**
 * The customization blob has no fixed schema (client-defined), so print every non-empty
 * entry as "Label: value" rather than guessing field names.
 */
export function customizationLines(customization: Record<string, unknown>): string[] {
  return Object.entries(customization)
    .map(([key, value]) => {
      const described = describeValue(value);
      return described === undefined ? undefined : `${humanizeKey(key)}: ${described}`;
    })
    .filter((line): line is string => line !== undefined);
}

function itemLines(item: ReceiptItem, width: number): string[] {
  const lines = leftRight(
    `${String(item.quantity)}x ${item.itemName}`,
    formatNaira(item.lineTotalKobo),
    width
  );
  const detail: string[] = [];
  if (item.quantity > 1) detail.push(`@ ${formatNaira(item.unitPriceKobo)} each`);
  if (item.soupName !== null) detail.push(`Soup: ${item.soupName}`);
  detail.push(...customizationLines(item.customization));
  for (const text of detail) {
    lines.push(...wrap(text, width - 3).map((line) => `   ${line}`));
  }
  return lines;
}

function field(label: string, value: string, width: number): string[] {
  const prefix = `${label.padEnd(7)} `;
  const wrapped = wrap(value, width - prefix.length);
  return wrapped.map((line, index) => (index === 0 ? prefix : ' '.repeat(prefix.length)) + line);
}

export function renderReceipt(receipt: Receipt, width: number): string {
  const heavy = '='.repeat(width);
  const light = '-'.repeat(width);
  const lines: string[] = [
    heavy,
    center('MEALDIRECT', width),
    ...wrap(receipt.vendorDisplayName, width).map((line) => center(line, width)),
    center(`ORDER #${receipt.orderNumber}`, width),
    heavy,
    ...field(
      'DELIVER',
      `${formatServiceDate(receipt.serviceDate)} ${formatClockTime(receipt.deliveryTime)}`,
      width
    ),
    ...field('SLOT', receipt.deliverySlotName, width),
    light,
    ...field('TO', receipt.customerName, width),
    ...field('TEL', receipt.customerPhone ?? 'not provided', width),
    ...field('LOC', receipt.locationName, width)
  ];
  if (receipt.roomNumber !== null && receipt.roomNumber.trim().length > 0) {
    lines.push(...field('ROOM', receipt.roomNumber, width));
  }
  lines.push(
    ...field(
      'MODE',
      DELIVERY_MODE_LABELS[receipt.deliveryMode] ?? humanizeKey(receipt.deliveryMode),
      width
    ),
    light
  );
  for (const item of receipt.items) {
    lines.push(...itemLines(item, width));
  }
  lines.push(
    light,
    ...leftRight('FOOD TOTAL:', formatNaira(receipt.foodSubtotalKobo), width),
    light
  );
  if (receipt.specialInstructions !== null && receipt.specialInstructions.trim().length > 0) {
    lines.push(...wrap(`NOTE: ${receipt.specialInstructions.trim()}`, width), light);
  }
  if (receipt.paidAt !== null) {
    lines.push(`Paid: ${formatLocalTimestamp(receipt.paidAt, receipt.campusTimezone)}`);
  }
  lines.push(heavy, '', '', '');

  return toAscii(lines.map((line) => line.trimEnd()).join('\n'));
}

/** Sample ticket for "test print" — exercises the layout without any customer data. */
export function renderTestReceipt(vendorDisplayName: string, width: number, now: Date): string {
  const heavy = '='.repeat(width);
  const lines = [
    heavy,
    center('MEALDIRECT', width),
    ...wrap(vendorDisplayName, width).map((line) => center(line, width)),
    center('TEST PRINT', width),
    heavy,
    ...wrap(
      'Your printer is connected. Order tickets will print here automatically at each slot cutoff.',
      width
    ),
    '-'.repeat(width),
    ...leftRight('1x Sample item', formatNaira(150000), width),
    `Printed: ${formatLocalTimestamp(now.toISOString(), 'Africa/Lagos')}`,
    heavy,
    '',
    '',
    ''
  ];
  return toAscii(lines.map((line) => line.trimEnd()).join('\n'));
}
