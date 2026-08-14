import { describe, expect, it } from 'vitest';

import {
  assertAllowedOrderStatusTransition,
  canTransitionOrderStatus,
  orderStatuses,
  type OrderStatus
} from '../../src/domain/order-status.js';

describe('order-status collapse', () => {
  it('drops accepted, preparing, confirmed from the enum', () => {
    expect(orderStatuses as readonly string[]).not.toContain('accepted');
    expect(orderStatuses as readonly string[]).not.toContain('preparing');
    expect(orderStatuses as readonly string[]).not.toContain('confirmed');
  });

  it('keeps the four customer-visible states plus terminals', () => {
    for (const status of [
      'pending_payment',
      'paid',
      'ready',
      'out_for_delivery',
      'delivered',
      'administratively_completed',
      'cancelled',
      'expired',
      'refunded'
    ]) {
      expect(orderStatuses as readonly string[]).toContain(status);
    }
  });

  it('allows the collapsed vendor path paid -> ready', () => {
    expect(canTransitionOrderStatus('paid', 'ready')).toBe(true);
  });

  it('rejects the removed intermediate transitions', () => {
    expect(canTransitionOrderStatus('paid', 'accepted' as OrderStatus)).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'confirmed' as OrderStatus)).toBe(false);
  });

  it('makes delivered terminal apart from admin completion and refund', () => {
    expect(canTransitionOrderStatus('delivered', 'administratively_completed')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'refunded')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'out_for_delivery')).toBe(false);
  });

  it('asserts an allowed transition without throwing and rejects a bad one', () => {
    expect(() => assertAllowedOrderStatusTransition('out_for_delivery', 'delivered')).not.toThrow();
    expect(() => assertAllowedOrderStatusTransition('paid', 'delivered')).toThrow();
  });
});
