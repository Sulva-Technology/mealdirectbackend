// Mirrors public.order_status and public.transition_order_status in the database. Keep this in
// lockstep with supabase/migrations (order_status enum + transition matrix); the DB is
// authoritative.
export const orderStatuses = [
  'pending_payment',
  'paid',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'confirmed',
  'administratively_completed',
  'cancelled',
  'expired',
  'refunded'
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: ['accepted', 'cancelled', 'refunded'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['confirmed', 'administratively_completed', 'refunded'],
  confirmed: ['refunded'],
  administratively_completed: ['refunded'],
  cancelled: [],
  expired: [],
  refunded: []
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertAllowedOrderStatusTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new Error(`Order cannot transition from ${from} to ${to}.`);
  }
}
