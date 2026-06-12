export const actorRoles = ['customer', 'vendor', 'rider', 'campus_admin', 'super_admin'] as const;

export type ActorRole = (typeof actorRoles)[number];

export type AuthorizationContext = {
  actorId: string;
  role: ActorRole;
  campusId?: string;
  vendorId?: string;
  riderId?: string;
};

export type OrderAccessTarget = {
  customerId: string;
  campusId: string;
  vendorId: string;
  riderId?: string;
};

export function canReadOrder(actor: AuthorizationContext, order: OrderAccessTarget): boolean {
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'campus_admin') return actor.campusId === order.campusId;
  if (actor.role === 'vendor') return actor.vendorId === order.vendorId;
  if (actor.role === 'rider') return actor.riderId !== undefined && actor.riderId === order.riderId;
  return actor.actorId === order.customerId;
}

export function canManageAdmin(actor: AuthorizationContext, targetCampusId?: string): boolean {
  if (actor.role === 'super_admin') return true;
  return (
    actor.role === 'campus_admin' &&
    targetCampusId !== undefined &&
    actor.campusId === targetCampusId
  );
}

export function canAccessVendorSettlement(
  actor: AuthorizationContext,
  settlement: { campusId: string; vendorId: string }
): boolean {
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'campus_admin') return actor.campusId === settlement.campusId;
  return actor.role === 'vendor' && actor.vendorId === settlement.vendorId;
}
