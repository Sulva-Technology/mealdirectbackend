import { describe, expect, it } from 'vitest';

import {
  calculateDeliveryEarnings,
  calculateOrderPricing,
  calculateOrderingCutoff,
  calculateRefund,
  calculateRiderSettlement,
  calculateVendorSettlement,
  canAccessVendorSettlement,
  canManageAdmin,
  canReadOrder,
  canTransitionOrderStatus,
  decideOrderingCutoff,
  decideSpoonLimit,
  mapPaystackEvent
} from '../../src/domain/index.js';

describe('production domain rules', () => {
  it('calculates order pricing from immutable integer inputs', () => {
    expect(
      calculateOrderPricing({
        lines: [
          { unitPriceCents: 1_500, quantity: 2, spoonCount: 1 },
          { unitPriceCents: 750, quantity: 1, spoonCount: 0 }
        ],
        deliveryFeeCents: 300,
        serviceFeeCents: 100,
        discountCents: 50
      })
    ).toEqual({
      subtotalCents: 3_750,
      deliveryFeeCents: 300,
      serviceFeeCents: 100,
      discountCents: 50,
      largeOrderSurchargeCents: 0,
      exceedsLargeOrderThreshold: false,
      totalCents: 4_100,
      spoonCount: 1
    });
  });

  it('adds a 1.5% + flat surcharge when the total exceeds the large-order threshold', () => {
    // Pre-surcharge total: 250000 + 0 delivery = 250000, just over the 249000 threshold.
    // Surcharge = round(250000 * 150 / 10000) + 10000 = 3750 + 10000 = 13750.
    expect(
      calculateOrderPricing({
        lines: [{ unitPriceCents: 250_000, quantity: 1 }],
        deliveryFeeCents: 0,
        largeOrderThresholdCents: 249_000,
        largeOrderSurchargeBps: 150,
        largeOrderSurchargeFlatCents: 10_000
      })
    ).toMatchObject({
      subtotalCents: 250_000,
      largeOrderSurchargeCents: 13_750,
      exceedsLargeOrderThreshold: true,
      totalCents: 263_750
    });
  });

  it('does not surcharge an order exactly at the large-order threshold', () => {
    expect(
      calculateOrderPricing({
        lines: [{ unitPriceCents: 249_000, quantity: 1 }],
        deliveryFeeCents: 0,
        largeOrderThresholdCents: 249_000,
        largeOrderSurchargeBps: 150,
        largeOrderSurchargeFlatCents: 10_000
      })
    ).toMatchObject({
      largeOrderSurchargeCents: 0,
      exceedsLargeOrderThreshold: false,
      totalCents: 249_000
    });
  });

  it('rejects impossible pricing and spoon inputs', () => {
    expect(() =>
      calculateOrderPricing({
        lines: [{ unitPriceCents: 500, quantity: 1 }],
        deliveryFeeCents: 0,
        discountCents: 600
      })
    ).toThrow('discountCents');

    expect(decideSpoonLimit(2, 3)).toMatchObject({ allowed: true });
    expect(decideSpoonLimit(4, 3)).toMatchObject({
      allowed: false,
      reason: 'SPOON_LIMIT_EXCEEDED'
    });
  });

  it('calculates ordering cutoffs and blocks late orders', () => {
    const slotStartsAt = new Date('2026-06-12T12:00:00.000Z');
    const cutoffAt = calculateOrderingCutoff(slotStartsAt, 90);

    expect(cutoffAt.toISOString()).toBe('2026-06-12T10:30:00.000Z');
    expect(
      decideOrderingCutoff(new Date('2026-06-12T10:29:59.000Z'), slotStartsAt, 90)
    ).toMatchObject({
      allowed: true
    });
    expect(
      decideOrderingCutoff(new Date('2026-06-12T10:30:00.000Z'), slotStartsAt, 90)
    ).toMatchObject({
      allowed: false,
      reason: 'ORDERING_CUTOFF_PASSED'
    });
  });

  it('allows only expected order status transitions', () => {
    expect(canTransitionOrderStatus('pending_payment', 'paid')).toBe(true);
    expect(canTransitionOrderStatus('pending_payment', 'expired')).toBe(true);
    expect(canTransitionOrderStatus('paid', 'preparing')).toBe(false);
    expect(canTransitionOrderStatus('ready', 'out_for_delivery')).toBe(true);
    expect(canTransitionOrderStatus('out_for_delivery', 'delivered')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'administratively_completed')).toBe(true);
    expect(canTransitionOrderStatus('confirmed', 'refunded')).toBe(true);
    expect(canTransitionOrderStatus('administratively_completed', 'refunded')).toBe(true);
    expect(canTransitionOrderStatus('refunded', 'paid')).toBe(false);
  });

  it('calculates delivery earnings and settlement payables', () => {
    expect(
      calculateDeliveryEarnings({
        baseFeeCents: 400,
        perOrderFeeCents: 125,
        orderCount: 3,
        distanceFeeCents: 200,
        bonusCents: 100,
        penaltyCents: 50
      })
    ).toBe(1_025);

    expect(
      calculateVendorSettlement({
        foodGrossCents: 10_000,
        commissionBasisPoints: 1_200,
        refundCents: 1_000,
        adjustmentCents: 250
      })
    ).toEqual({
      grossCents: 10_000,
      commissionCents: 1_200,
      refundCents: 1_000,
      adjustmentCents: 250,
      netPayableCents: 8_050
    });

    expect(
      calculateRiderSettlement({
        deliveryEarningsCents: [700, 650],
        bonusCents: 100,
        penaltyCents: 50
      })
    ).toEqual({
      grossEarningsCents: 1_350,
      bonusCents: 100,
      penaltyCents: 50,
      netPayableCents: 1_400
    });
  });

  it('caps refunds at captured payment amount after penalties', () => {
    expect(
      calculateRefund({
        capturedAmountCents: 2_000,
        itemRefundCents: 1_800,
        deliveryRefundCents: 500,
        serviceFeeRefundCents: 100,
        penaltyCents: 250
      })
    ).toEqual({
      requestedRefundCents: 2_400,
      penaltyCents: 250,
      refundableCents: 1_750
    });
  });

  it('makes object-level authorization decisions by role and ownership', () => {
    const order = {
      customerId: 'customer-1',
      campusId: 'campus-a',
      vendorId: 'vendor-a',
      riderId: 'rider-a'
    };

    expect(canReadOrder({ actorId: 'customer-1', role: 'customer' }, order)).toBe(true);
    expect(canReadOrder({ actorId: 'customer-2', role: 'customer' }, order)).toBe(false);
    expect(
      canReadOrder({ actorId: 'vendor-user', role: 'vendor', vendorId: 'vendor-a' }, order)
    ).toBe(true);
    expect(canReadOrder({ actorId: 'rider-user', role: 'rider', riderId: 'rider-b' }, order)).toBe(
      false
    );
    expect(
      canReadOrder({ actorId: 'admin', role: 'campus_admin', campusId: 'campus-a' }, order)
    ).toBe(true);
    expect(
      canReadOrder({ actorId: 'admin', role: 'campus_admin', campusId: 'campus-b' }, order)
    ).toBe(false);
    expect(canManageAdmin({ actorId: 'super', role: 'super_admin' })).toBe(true);
    expect(
      canAccessVendorSettlement(
        { actorId: 'vendor-user', role: 'vendor', vendorId: 'vendor-a' },
        order
      )
    ).toBe(true);
  });

  it('maps Paystack webhook events into domain events without mutating unknown events', () => {
    expect(
      mapPaystackEvent({
        event: 'charge.success',
        data: { reference: 'MD_ref_1', amount: 4_500 }
      })
    ).toEqual({
      type: 'PAYMENT_SUCCEEDED',
      providerReference: 'MD_ref_1',
      amountKobo: 4_500
    });

    expect(
      mapPaystackEvent({
        event: 'refund.processed',
        data: { reference: 'MD_ref_1' }
      })
    ).toEqual({
      type: 'REFUND_SUCCEEDED',
      providerReference: 'MD_ref_1'
    });

    expect(
      mapPaystackEvent({ event: 'transfer.success', data: { reference: 'transfer-ref' } })
    ).toEqual({
      type: 'TRANSFER_RECONCILED',
      providerReference: 'transfer-ref',
      status: 'success'
    });

    expect(
      mapPaystackEvent({ event: 'transfer.failed', data: { reference: 'transfer-ref' } })
    ).toEqual({
      type: 'TRANSFER_RECONCILED',
      providerReference: 'transfer-ref',
      status: 'failed'
    });

    expect(
      mapPaystackEvent({ event: 'transfer.reversed', data: { reference: 'transfer-ref' } })
    ).toEqual({
      type: 'TRANSFER_RECONCILED',
      providerReference: 'transfer-ref',
      status: 'reversed'
    });

    expect(mapPaystackEvent({ event: 'unknown.event', data: { reference: 'r' } })).toEqual({
      type: 'IGNORED',
      reason: 'UNMAPPED_EVENT',
      providerEvent: 'unknown.event'
    });
  });
});
