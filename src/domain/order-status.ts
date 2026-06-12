export const orderStatuses = [
  'pending_payment',
  'paid',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'assigned_to_rider',
  'picked_up',
  'delivered',
  'confirmed',
  'completed',
  'cancelled',
  'refunded',
  'escalated'
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['accepted', 'cancelled', 'refunded', 'escalated'],
  accepted: ['preparing', 'cancelled', 'escalated'],
  preparing: ['ready_for_pickup', 'escalated'],
  ready_for_pickup: ['assigned_to_rider', 'picked_up', 'escalated'],
  assigned_to_rider: ['picked_up', 'escalated'],
  picked_up: ['delivered', 'escalated'],
  delivered: ['confirmed', 'escalated'],
  confirmed: ['completed', 'escalated'],
  completed: [],
  cancelled: ['refunded'],
  refunded: [],
  escalated: ['confirmed', 'completed', 'cancelled', 'refunded']
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertAllowedOrderStatusTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new Error(`Order cannot transition from ${from} to ${to}.`);
  }
}
