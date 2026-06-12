import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BatchesModule } from './batches/batches.module.js';
import { CampusesModule } from './campuses/campuses.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DeliveriesModule } from './deliveries/deliveries.module.js';
import { EscalationsModule } from './escalations/escalations.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { RidersModule } from './riders/riders.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';
import { SlotsModule } from './slots/slots.module.js';
import { VendorsModule } from './vendors/vendors.module.js';

export const capabilityModules = [
  AuthModule,
  ProfilesModule,
  CampusesModule,
  LocationsModule,
  VendorsModule,
  CatalogModule,
  SlotsModule,
  InventoryModule,
  OrdersModule,
  PaymentsModule,
  BatchesModule,
  DeliveriesModule,
  RidersModule,
  SettlementsModule,
  ReviewsModule,
  EscalationsModule,
  AdminModule,
  AuditModule,
  NotificationsModule,
  JobsModule
];
