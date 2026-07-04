// Server-side admin RBAC. The coarse JWT role (super_admin | campus_admin) gates entry to
// admin controllers; these granular admin roles come from public.admin_memberships and
// refine WHICH sensitive actions an admin may perform. admin_memberships is authoritative.

export const adminMembershipRoles = [
  'super_admin',
  'campus_admin',
  'finance_admin',
  'operations_admin',
  'support_admin',
  'readonly_admin'
] as const;

export type AdminMembershipRole = (typeof adminMembershipRoles)[number];

export const adminPermissions = [
  'read',
  'payments:verify',
  'refunds:manage',
  'settlements:manage',
  'reconciliation:manage',
  'vendors:manage',
  'riders:manage',
  'users:manage',
  'admin:manage'
] as const;

export type AdminPermission = (typeof adminPermissions)[number];

const ALL: AdminPermission[] = [...adminPermissions];

// Every admin can read. Sub-roles add scoped write capabilities. Super Admin gets all.
const adminRolePermissions: Record<AdminMembershipRole, AdminPermission[]> = {
  super_admin: ALL,
  campus_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'settlements:manage',
    'reconciliation:manage',
    'vendors:manage',
    'riders:manage',
    'users:manage'
  ],
  finance_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'settlements:manage',
    'reconciliation:manage'
  ],
  operations_admin: ['read', 'vendors:manage', 'riders:manage'],
  support_admin: ['read'],
  readonly_admin: ['read']
};

export function isAdminMembershipRole(value: unknown): value is AdminMembershipRole {
  return typeof value === 'string' && adminMembershipRoles.includes(value as AdminMembershipRole);
}

/**
 * Effective permissions for an admin. Super Admin (by membership OR coarse JWT role) always
 * gets everything. Otherwise permissions are the union across the actor's active membership
 * roles. When an admin has no membership rows yet (e.g. legacy/seeded campus admins), fall
 * back to the coarse JWT role so existing access is preserved.
 */
export function resolveAdminPermissions(
  membershipRoles: readonly AdminMembershipRole[],
  jwtRole: 'super_admin' | 'campus_admin'
): Set<AdminPermission> {
  if (jwtRole === 'super_admin' || membershipRoles.includes('super_admin')) {
    return new Set(ALL);
  }

  const effectiveRoles: AdminMembershipRole[] =
    membershipRoles.length > 0 ? [...membershipRoles] : [jwtRole];

  const permissions = new Set<AdminPermission>(['read']);
  for (const role of effectiveRoles) {
    for (const permission of adminRolePermissions[role]) {
      permissions.add(permission);
    }
  }
  return permissions;
}
