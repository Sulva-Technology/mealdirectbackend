import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CreateReviewInput,
  ReviewEligibility,
  ReviewRecord,
  ReviewsRepositoryContract
} from './reviews.types.js';

type ExistsResult = {
  exists: boolean;
};

@Injectable()
export class ReviewsRepository implements ReviewsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findCustomerReview(
    customerId: string,
    orderId: string
  ): Promise<ReviewRecord | undefined> {
    const result = await sql<ReviewRecord>`
      select
        id::text as "id",
        order_id::text as "orderId",
        reviewer_id::text as "reviewerId",
        menu_item_id::text as "menuItemId",
        vendor_id::text as "vendorId",
        delivery_batch_id::text as "deliveryBatchId",
        food_rating as "foodRating",
        vendor_rating as "vendorRating",
        delivery_rating as "deliveryRating",
        comment,
        moderation_status::text as "moderationStatus",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.reviews
      where order_id = ${orderId}::uuid
        and reviewer_id = ${customerId}::uuid
      order by created_at desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findCustomerReviewEligibility(
    customerId: string,
    orderId: string
  ): Promise<ReviewEligibility | undefined> {
    const result = await sql<ReviewEligibility>`
      select
        o.id::text as "orderId",
        o.order_status::text as "orderStatus",
        o.vendor_id::text as "vendorId",
        dbo.batch_id::text as "deliveryBatchId"
      from public.orders o
      left join public.delivery_batch_orders dbo on dbo.order_id = o.id
      where o.id = ${orderId}::uuid
        and o.customer_id = ${customerId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async customerOrderContainsMenuItem(orderId: string, menuItemId: string): Promise<boolean> {
    const result = await sql<ExistsResult>`
      select exists (
        select 1
        from public.order_items
        where order_id = ${orderId}::uuid
          and menu_item_id = ${menuItemId}::uuid
      ) as "exists"
    `.execute(this.database.db);

    return result.rows[0]?.exists ?? false;
  }

  async createCustomerReview(
    customerId: string,
    eligibility: ReviewEligibility,
    input: CreateReviewInput
  ): Promise<ReviewRecord | undefined> {
    const result = await sql<ReviewRecord>`
      insert into public.reviews (
        order_id,
        reviewer_id,
        menu_item_id,
        vendor_id,
        delivery_batch_id,
        food_rating,
        vendor_rating,
        delivery_rating,
        comment
      )
      values (
        ${eligibility.orderId}::uuid,
        ${customerId}::uuid,
        ${input.menuItemId ?? null}::uuid,
        ${eligibility.vendorId}::uuid,
        ${eligibility.deliveryBatchId ?? null}::uuid,
        ${input.foodRating ?? null},
        ${input.vendorRating ?? null},
        ${input.deliveryRating ?? null},
        ${input.comment ?? null}
      )
      on conflict (order_id, reviewer_id) do nothing
      returning
        id::text as "id",
        order_id::text as "orderId",
        reviewer_id::text as "reviewerId",
        menu_item_id::text as "menuItemId",
        vendor_id::text as "vendorId",
        delivery_batch_id::text as "deliveryBatchId",
        food_rating as "foodRating",
        vendor_rating as "vendorRating",
        delivery_rating as "deliveryRating",
        comment,
        moderation_status::text as "moderationStatus",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
    `.execute(this.database.db);

    return result.rows[0];
  }
}
