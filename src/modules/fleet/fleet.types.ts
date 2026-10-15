export const fleetPartnerStatuses = ['active', 'suspended', 'deactivated'] as const;
export type FleetPartnerStatus = (typeof fleetPartnerStatuses)[number];

export const fleetMemberRoles = ['owner', 'manager'] as const;
export type FleetMemberRole = (typeof fleetMemberRoles)[number];

export type FleetPartner = {
  id: string;
  campusId: string;
  campusName: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: FleetPartnerStatus;
  joinCode: string;
  commissionBps: number;
  canDispatch: boolean;
  dispatchPriority: number;
  riderCount: number;
  activeManagerCount: number;
  createdAt: string;
  updatedAt: string;
};

/** A fleet the caller manages, as listed on GET /fleet/partners. */
export type FleetMembership = {
  fleetPartnerId: string;
  name: string;
  campusId: string;
  campusName: string;
  status: FleetPartnerStatus;
  canDispatch: boolean;
  role: FleetMemberRole;
};

export type FleetMember = {
  id: string;
  fleetPartnerId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: FleetMemberRole;
  active: boolean;
  createdAt: string;
};

export type FleetRider = {
  id: string;
  campusId: string;
  displayName: string;
  phone: string;
  status: string;
  active: boolean;
  available: boolean;
  openAssignmentCount: number;
  createdAt: string;
};

export type FleetBatch = {
  id: string;
  batchNumber: string;
  serviceDate: string;
  status: string;
  vendorId: string;
  vendorDisplayName: string;
  deliverySlotId: string;
  deliverySlotName: string;
  deliveryTime: string;
  zoneId: string;
  zoneName: string;
  orderCount: number;
  deliveryEarningsKobo: number;
  assignmentId: string | null;
  assignmentStatus: string | null;
  riderId: string | null;
  riderDisplayName: string | null;
};

export type FleetRiderEarnings = {
  riderId: string;
  displayName: string;
  deliveredOrderCount: number;
  totalAmountKobo: number;
  settledAmountKobo: number;
};

export type FleetEarningsSummary = {
  fleetPartnerId: string;
  dateFrom: string | null;
  dateTo: string | null;
  currency: 'NGN';
  commissionBps: number;
  deliveredOrderCount: number;
  totalAmountKobo: number;
  settledAmountKobo: number;
  commissionKobo: number;
  riders: FleetRiderEarnings[];
};

/** A rider's own view of the fleet it belongs to. */
export type RiderFleet = {
  fleetPartnerId: string;
  name: string;
  status: FleetPartnerStatus;
  contactName: string | null;
  contactPhone: string | null;
};

export type FleetPartnerCreateInput = {
  campusId: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  commissionBps?: number;
  canDispatch?: boolean;
  dispatchPriority?: number;
};

export type FleetPartnerUpdateInput = {
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  commissionBps?: number;
  canDispatch?: boolean;
  dispatchPriority?: number;
  status?: FleetPartnerStatus;
};

export type FleetPartnerListFilters = {
  campusId?: string;
  status?: FleetPartnerStatus;
};

export type FleetRiderListFilters = {
  status?: string;
  available?: boolean;
};

/** Minimal rider row the service needs to authorise join/attach/remove. */
export type FleetRiderRef = {
  id: string;
  userId: string;
  campusId: string;
  fleetPartnerId: string | null;
};
