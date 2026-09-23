import { describe, expect, it } from 'vitest';

import type { Receipt } from '../../src/modules/printing/printing.types.js';
import {
  customizationLines,
  formatClockTime,
  formatLocalTimestamp,
  formatNaira,
  formatServiceDate,
  renderReceipt,
  renderTestReceipt,
  toAscii,
  wrap
} from '../../src/modules/printing/receipt.renderer.js';

const receipt: Receipt = {
  orderId: '44444444-4444-4444-8444-444444444444',
  orderNumber: 'MD-20260923-4821',
  vendorDisplayName: 'Mama Put Kitchen',
  serviceDate: '2026-09-23',
  deliveryTime: '13:00',
  deliverySlotName: 'Lunch',
  campusTimezone: 'Africa/Lagos',
  customerName: 'Adeola Balogun',
  customerPhone: '08031234567',
  locationName: 'Moremi Hall',
  roomNumber: 'B214',
  deliveryMode: 'meal_direct_rider',
  specialInstructions: 'extra plastic spoon',
  foodSubtotalKobo: 450000,
  paidAt: '2026-09-23T11:41:00.000Z',
  items: [
    {
      itemName: 'Jollof Rice',
      quantity: 2,
      unitPriceKobo: 150000,
      lineTotalKobo: 300000,
      unitType: 'plate',
      soupName: null,
      customization: { customProtein: 'Chicken', noPepper: true, spoonsCount: 0, drinks: [] }
    },
    {
      itemName: 'Amala',
      quantity: 1,
      unitPriceKobo: 150000,
      lineTotalKobo: 150000,
      unitType: 'wrap',
      soupName: 'Ewedu + Gbegiri',
      customization: {}
    }
  ]
};

describe('receipt renderer helpers', () => {
  it('formats kobo as NGN with thousands separators', () => {
    expect(formatNaira(300000)).toBe('NGN 3,000');
    expect(formatNaira(150050)).toBe('NGN 1,500.50');
    expect(formatNaira(0)).toBe('NGN 0');
  });

  it('formats the service date and slot time', () => {
    expect(formatServiceDate('2026-09-23')).toBe('WED 23 SEP');
    expect(formatClockTime('13:00')).toBe('1:00 PM');
    expect(formatClockTime('00:30')).toBe('12:30 AM');
    expect(formatClockTime('12:15')).toBe('12:15 PM');
  });

  it('renders timestamps in the campus timezone', () => {
    // 11:41 UTC is 12:41 in Lagos (UTC+1).
    expect(formatLocalTimestamp('2026-09-23T11:41:00.000Z', 'Africa/Lagos')).toBe('23 Sep 12:41');
  });

  it('transliterates to printable ASCII', () => {
    expect(toAscii('Adéọlá — ₦500 × 2')).toBe('Adeola - NGN 500 x 2');
    expect(toAscii('emoji 🍛')).toMatch(/^emoji \?+$/);
  });

  it('wraps words and hard-splits long ones', () => {
    expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('prints every non-empty customization entry and skips empty ones', () => {
    expect(
      customizationLines({
        customProtein: 'Chicken',
        noPepper: true,
        spoonsCount: 2,
        drinks: [{ name: 'Coke', quantity: 2 }, 'Water'],
        empty: '',
        none: null,
        off: false,
        blank: []
      })
    ).toEqual([
      'Custom protein: Chicken',
      'No pepper: Yes',
      'Spoons count: 2',
      'Drinks: 2x Coke, Water'
    ]);
  });
});

describe('renderReceipt', () => {
  const text = renderReceipt(receipt, 32);
  const lines = text.split('\n');

  it('never exceeds the paper width', () => {
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it('includes everything the kitchen and rider need', () => {
    expect(text).toContain('Mama Put Kitchen');
    expect(text).toContain('ORDER #MD-20260923-4821');
    expect(text).toContain('DELIVER WED 23 SEP 1:00 PM');
    expect(text).toContain('Lunch');
    expect(text).toContain('Adeola Balogun');
    expect(text).toContain('08031234567');
    expect(text).toContain('Moremi Hall');
    expect(text).toContain('B214');
    expect(text).toContain('MODE    MealDirect rider');
    expect(text).toContain('2x Jollof Rice');
    expect(text).toContain('@ NGN 1,500 each');
    expect(text).toContain('Custom protein: Chicken');
    expect(text).toContain('Soup: Ewedu + Gbegiri');
    expect(text).toContain('NOTE: extra plastic spoon');
    expect(text).toContain('Paid: 23 Sep 12:41');
  });

  it('prints the food total only (no delivery or service fee)', () => {
    const totalLine = lines.find((line) => line.startsWith('FOOD TOTAL:'));
    expect(totalLine).toBeDefined();
    expect(totalLine?.endsWith('NGN 4,500')).toBe(true);
  });

  it('right-aligns line prices', () => {
    const jollof = lines.find((line) => line.startsWith('2x Jollof Rice'));
    expect(jollof?.endsWith('NGN 3,000')).toBe(true);
    expect(jollof?.length).toBe(32);
  });

  it('omits the room and note blocks when empty and handles a missing phone', () => {
    const plain = renderReceipt(
      { ...receipt, roomNumber: null, specialInstructions: '  ', customerPhone: null },
      48
    );
    expect(plain).not.toContain('ROOM');
    expect(plain).not.toContain('NOTE:');
    expect(plain).toContain('TEL     not provided');
  });

  it('is pure ASCII', () => {
    const accented = renderReceipt({ ...receipt, customerName: 'Adéọlá Bàlógun' }, 48);
    expect(/^[\x20-\x7e\n]*$/.test(accented)).toBe(true);
    expect(accented).toContain('Adeola Balogun');
  });
});

describe('renderTestReceipt', () => {
  it('prints a sample without customer data', () => {
    const text = renderTestReceipt('Mama Put Kitchen', 32, new Date('2026-09-23T11:41:00.000Z'));
    expect(text).toContain('TEST PRINT');
    expect(text).toContain('Mama Put Kitchen');
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });
});
