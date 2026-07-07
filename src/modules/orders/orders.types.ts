import type { CreateOrderDto } from './dto/create-order.dto.js';

export type OrderStatus =
  | 'accepted'
  | 'administratively_completed'
  | 'cancelled'
  | 'confirmed'
  | 'delivered'
  | 'expired'
  | 'out_for_delivery'
  | 'paid'
  | 'pending_payment'
  | 'preparing'
  | 'ready'
  | 'refunded';

export type PaymentStatus =
  | 'abandoned'
  | 'failed'
  | 'initialized'
  | 'pending'
  | 'refunded'
  | 'successful';

export type OrderQuoteItem = {
  menuItemId: string;
  name: string;
  quantity: number;
  remainingQuantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
  countsTowardSpoonLimit: boolean;
  // Whether an order containing this item pulls the flat takeaway/service fee. Independent of
  // the spoon-limit cap: a single-portion item (e.g. pepper soup) charges the fee without
  // counting toward the three-spoon takeaway limit.
  triggersTakeawayFee: boolean;
};

export type OrderQuote = {
  currency: 'NGN';
  foodSubtotalKobo: number;
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  discountKobo: number;
  // Large-order surcharge (1.5% + ₦100) applied when totalKobo would exceed the standard cap.
  // largeOrderSurchargeKobo is already included in totalKobo. exceedsStandardCap tells the
  // client to show the surcharge notice and require acceptLargeOrderSurcharge on create.
  largeOrderSurchargeKobo: number;
  exceedsStandardCap: boolean;
  totalKobo: number;
  items: OrderQuoteItem[];
};

export type LargeOrderSurchargeConfig = {
  surchargeBps: number;
  surchargeFlatKobo: number;
  accepted: boolean;
};

export type OrderItem = {
  id: string;
  menuItemId: string;
  itemName: string;
  unitType: string;
  unitPriceKobo: number;
  quantity: number;
  lineTotalKobo: number;
  customization: Record<string, unknown>;
  // The soup chosen for this line when the menu item required one; null otherwise.
  soupOptionId: string | null;
  soupName: string | null;
};

export type PaymentSnapshot = {
  id: string;
  provider: string;
  providerReference: string;
  status: PaymentStatus;
  expectedAmountKobo: number;
  paidAmountKobo: number | null;
  currency: string;
  initializedAt: string;
  verifiedAt: string | null;
  paidAt: string | null;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  customerId: string;
  campusId: string;
  vendorId: string;
  vendorDisplayName: string;
  serviceDate: string;
  deliverySlotId: string;
  deliverySlotName: string;
  locationId: string;
  locationName: string;
  orderStatus: OrderStatus;
  deliveryMode: string;
  specialInstructions: string | null;
  foodSubtotalKobo: number;
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  discountKobo: number;
  largeOrderSurchargeKobo: number;
  totalKobo: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;
  // Hand-off code shown to the customer once the order is out for delivery; null otherwise.
  // Optional because most order queries do not select it.
  deliveryCode?: string | null;
};

export type OrderDetail = OrderSummary & {
  items: OrderItem[];
  latestPayment: PaymentSnapshot | null;
};

export type OrderListFilters = {
  status?: OrderStatus;
};

export type OrderPaymentStatus = {
  orderId: string;
  orderStatus: OrderStatus;
  payment: PaymentSnapshot | null;
};

export type OrdersRepositoryContract = {
  createOrder: (
    customerId: string,
    input: CreateOrderDto,
    idempotencyKey: string,
    requestHash: string,
    serviceFeeKobo: number,
    maxOrderTotalKobo: number,
    largeOrderSurcharge: LargeOrderSurchargeConfig
  ) => Promise<{ orderId: string }>;
  quoteOrder: (input: CreateOrderDto) => Promise<OrderQuoteItem[]>;
  findZoneDeliveryFeeKobo: (locationId: string) => Promise<number | null>;
  findVendorServiceFeeConfig: (
    vendorId: string
  ) => Promise<{ serviceFeeKobo: number | null; maxServiceFeeKobo: number } | undefined>;
  listCustomerOrders: (customerId: string, filters: OrderListFilters) => Promise<OrderSummary[]>;
  findCustomerOrderById: (customerId: string, orderId: string) => Promise<OrderDetail | undefined>;
  findPaymentStatus: (
    customerId: string,
    orderId: string
  ) => Promise<OrderPaymentStatus | undefined>;
  confirmDelivery: (customerId: string, orderId: string) => Promise<{ confirmationId: string }>;
};
