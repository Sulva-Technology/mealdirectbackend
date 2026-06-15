export type ReviewModerationStatus = 'approved' | 'pending' | 'rejected';

export type ReviewEligibility = {
  orderId: string;
  orderStatus: string;
  vendorId: string;
  deliveryBatchId: string | null;
};

export type CreateReviewInput = {
  menuItemId?: string;
  foodRating?: number;
  vendorRating?: number;
  deliveryRating?: number;
  comment?: string;
};

export type ReviewRecord = {
  id: string;
  orderId: string;
  reviewerId: string;
  menuItemId: string | null;
  vendorId: string | null;
  deliveryBatchId: string | null;
  foodRating: number | null;
  vendorRating: number | null;
  deliveryRating: number | null;
  comment: string | null;
  moderationStatus: ReviewModerationStatus;
  createdAt: string;
  updatedAt: string;
};

export type VendorReviewRecord = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  menuItemId: string | null;
  menuItemName: string | null;
  vendorId: string | null;
  deliveryBatchId: string | null;
  foodRating: number | null;
  vendorRating: number | null;
  deliveryRating: number | null;
  comment: string | null;
  moderationStatus: ReviewModerationStatus;
  createdAt: string;
  updatedAt: string;
};

export type VendorReviewListFilters = {
  cursor?: string;
  menuItemId?: string;
  rating?: number;
  limit: number;
};

export type ReviewsRepositoryContract = {
  assertVendorAccess: (vendorId: string, userId: string) => Promise<boolean>;
  findCustomerReview: (
    customerId: string,
    orderId: string
  ) => Promise<ReviewRecord | undefined>;
  findCustomerReviewEligibility: (
    customerId: string,
    orderId: string
  ) => Promise<ReviewEligibility | undefined>;
  customerOrderContainsMenuItem: (orderId: string, menuItemId: string) => Promise<boolean>;
  createCustomerReview: (
    customerId: string,
    eligibility: ReviewEligibility,
    input: CreateReviewInput
  ) => Promise<ReviewRecord | undefined>;
  listVendorReviews: (
    vendorId: string,
    filters: VendorReviewListFilters
  ) => Promise<VendorReviewRecord[]>;
};
