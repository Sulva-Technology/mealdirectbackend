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
};

export type OrderQuote = {
  currency: 'NGN';
  foodSubtotalKobo: number;
  deliveryFeeKobo: number;
  discountKobo: number;
  totalKobo: number;
  items: OrderQuoteItem[];
};

export type OrderItem = {
  id: string;
  menuItemId: string;
  itemName: string;
  unitType: string;
  unitPriceKobo: number;
  quantity: number;
  lineTotalKobo: number;
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
  foodSubtotalKobo: number;
  deliveryFeeKobo: number;
  discountKobo: number;
  totalKobo: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;
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
    requestHash: string
  ) => Promise<{ orderId: string }>;
  quoteOrder: (input: CreateOrderDto) => Promise<OrderQuoteItem[]>;
  listCustomerOrders: (customerId: string, filters: OrderListFilters) => Promise<OrderSummary[]>;
  findCustomerOrderById: (customerId: string, orderId: string) => Promise<OrderDetail | undefined>;
  findPaymentStatus: (
    customerId: string,
    orderId: string
  ) => Promise<OrderPaymentStatus | undefined>;
  confirmDelivery: (customerId: string, orderId: string) => Promise<{ confirmationId: string }>;
};
