export type AdminRecord = Record<string, unknown>;

export type AdminListResult = {
  items: AdminRecord[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
};

export type AdminDashboard = {
  date: string;
  campusId: string | null;
  orders: AdminRecord;
  batches: AdminRecord;
  payments: AdminRecord;
  escalations: AdminRecord;
  settlements: AdminRecord;
  alerts: AdminRecord[];
};

export type AdminSession = {
  userId: string;
  role: string;
  campusId: string | null;
  email?: string;
  scopes: string[];
};
