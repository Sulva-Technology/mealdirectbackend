export const printJobStatuses = ['pending', 'printing', 'printed', 'failed', 'cancelled'] as const;
export type PrintJobStatus = (typeof printJobStatuses)[number];

export const printJobKinds = ['order', 'test'] as const;
export type PrintJobKind = (typeof printJobKinds)[number];

export const paperWidths = [32, 42, 48] as const;
export type PaperWidth = (typeof paperWidths)[number];

/** A printer as shown to its vendor. Never includes the key or its hash. */
export type VendorPrinter = {
  id: string;
  vendorId: string;
  name: string;
  macAddress: string;
  paperWidthChars: PaperWidth;
  lastSeenAt: string | null;
  lastStatusCode: string | null;
  /** Polled within the last 2 minutes (CloudPRNT polls every ~5 s). */
  online: boolean;
  createdAt: string;
};

/** Returned once on register / rotate: the URL to paste into the printer's CloudPRNT settings. */
export type PrinterRegistration = {
  printer: VendorPrinter;
  serverUrl: string;
};

/** Internal: a live printer resolved from its key. */
export type AuthenticatedPrinter = {
  id: string;
  vendorId: string;
  macAddress: string;
  paperWidthChars: PaperWidth;
};

export type PrintJob = {
  id: string;
  vendorId: string;
  orderId: string | null;
  orderNumber: string | null;
  kind: PrintJobKind;
  status: PrintJobStatus;
  printAfter: string;
  attempts: number;
  printedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type ReceiptItem = {
  itemName: string;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
  unitType: string;
  soupName: string | null;
  customization: Record<string, unknown>;
};

/** Everything printed on a kitchen ticket. */
export type Receipt = {
  orderId: string;
  orderNumber: string;
  vendorDisplayName: string;
  serviceDate: string;
  deliveryTime: string;
  deliverySlotName: string;
  campusTimezone: string;
  customerName: string;
  customerPhone: string | null;
  locationName: string;
  roomNumber: string | null;
  deliveryMode: string;
  specialInstructions: string | null;
  foodSubtotalKobo: number;
  paidAt: string | null;
  items: ReceiptItem[];
};

export type ReceiptView = {
  receipt: Receipt;
  text: string;
};

export type PrintJobListFilters = {
  status?: PrintJobStatus;
  limit: number;
};

export type PrintingRepositoryContract = {
  listPrinters: (vendorId: string) => Promise<VendorPrinter[]>;
  findPrinter: (vendorId: string, printerId: string) => Promise<VendorPrinter | undefined>;
  insertPrinter: (input: {
    vendorId: string;
    name: string;
    macAddress: string;
    paperWidthChars: PaperWidth;
    keyHash: string;
    createdBy: string;
  }) => Promise<VendorPrinter>;
  revokePrinter: (vendorId: string, printerId: string) => Promise<VendorPrinter | undefined>;
  rotatePrinterKey: (
    vendorId: string,
    printerId: string,
    keyHash: string
  ) => Promise<VendorPrinter | undefined>;
  findLivePrinterByKeyHash: (keyHash: string) => Promise<AuthenticatedPrinter | undefined>;
  recordPrinterSeen: (printerId: string, statusCode: string | null) => Promise<void>;
  listJobs: (vendorId: string, filters: PrintJobListFilters) => Promise<PrintJob[]>;
  insertTestJob: (vendorId: string) => Promise<PrintJob>;
  requeueOrderJob: (vendorId: string, orderId: string) => Promise<PrintJob>;
  claimJob: (
    printerId: string,
    leaseSeconds: number,
    windowHours: number
  ) => Promise<string | null>;
  findCurrentLease: (printerId: string, leaseSeconds: number) => Promise<string | null>;
  findLeasedJob: (
    printerId: string,
    jobId: string
  ) => Promise<{ id: string; kind: PrintJobKind; orderId: string | null } | undefined>;
  completeJob: (
    jobId: string,
    printerId: string,
    success: boolean,
    error: string | null,
    maxAttempts: number
  ) => Promise<PrintJobStatus | null>;
  findReceipt: (vendorId: string, orderId: string) => Promise<Receipt | undefined>;
  findVendorDisplayName: (vendorId: string) => Promise<string | undefined>;
  hasVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
};
