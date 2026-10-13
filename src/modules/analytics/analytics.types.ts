export const funnelEventNames = [
  'campus_link_opened',
  'signup_started',
  'signup_completed',
  'campus_selected',
  'location_selected'
] as const;

export type FunnelEventName = (typeof funnelEventNames)[number];

export type RecordFunnelEventInput = {
  event: FunnelEventName;
  anonymousId: string;
  /** Only ever taken from a verified bearer token. */
  userId?: string;
  campusId?: string;
  campusSlug?: string;
};

export type FunnelQuery = {
  campusId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type FunnelStepKey =
  | 'campus_link_opened'
  | 'signup_started'
  | 'signup_completed'
  | 'campus_selected'
  | 'location_selected'
  | 'onboarding_completed'
  | 'first_order';

export type FunnelStep = {
  key: FunnelStepKey;
  label: string;
  count: number;
};

export type FunnelStepCounts = Record<FunnelStepKey, number>;

export type CampusFunnelRow = {
  campusId: string;
  campusName: string;
  campusSlug: string;
  linkOpened: number;
  campusSelected: number;
  locationSelected: number;
  onboardingCompleted: number;
  firstOrder: number;
};

export type SignupFunnel = {
  campusId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  steps: FunnelStep[];
  byCampus: CampusFunnelRow[];
};

export type AnalyticsRepositoryContract = {
  recordEvent: (input: RecordFunnelEventInput) => Promise<void>;
  getStepCounts: (query: FunnelQuery) => Promise<FunnelStepCounts>;
  getCampusBreakdown: (query: FunnelQuery) => Promise<CampusFunnelRow[]>;
};
