import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BatchesModule } from './batches/batches.module.js';
import { CampusesModule } from './campuses/campuses.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { EscalationsModule } from './escalations/escalations.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { PromotionsModule } from './promotions/promotions.module.js';
import { ReferralsModule } from './referrals/referrals.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { RidersModule } from './riders/riders.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';
import { VendorsModule } from './vendors/vendors.module.js';

export const capabilityModules = [
  AuthModule,
  ProfilesModule,
  ReferralsModule,
  CampusesModule,
  VendorsModule,
  CatalogModule,
  InventoryModule,
  OrdersModule,
  PaymentsModule,
  PromotionsModule,
  BatchesModule,
  RidersModule,
  SettlementsModule,
  ReviewsModule,
  EscalationsModule,
  AdminModule,
  NotificationsModule,
  JobsModule
];
