import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  CreateReviewInput,
  ReviewEligibility,
  ReviewRecord,
  ReviewsRepositoryContract,
  VendorReviewListFilters,
  VendorReviewRecord
} from './reviews.types.js';

type ExistsResult = {
  exists: boolean;
};

@Injectable()
export class ReviewsRepository implements ReviewsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);

    return result.rows[0]?.hasAccess ?? false;
  }

  async findCustomerReview(customerId: string, orderId: string): Promise<ReviewRecord | undefined> {
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

  async listVendorReviews(
    vendorId: string,
    filters: VendorReviewListFilters
  ): Promise<VendorReviewRecord[]> {
    const cursorCreatedAt = filters.cursor?.split('|')[0] ?? null;
    const cursorId = filters.cursor?.split('|')[1] ?? null;

    const result = await sql<VendorReviewRecord>`
      select
        r.id::text as "id",
        r.order_id::text as "orderId",
        o.order_number as "orderNumber",
        r.menu_item_id::text as "menuItemId",
        mi.name as "menuItemName",
        r.vendor_id::text as "vendorId",
        r.delivery_batch_id::text as "deliveryBatchId",
        r.food_rating as "foodRating",
        r.vendor_rating as "vendorRating",
        r.delivery_rating as "deliveryRating",
        r.comment,
        r.moderation_status::text as "moderationStatus",
        r.created_at::text as "createdAt",
        r.updated_at::text as "updatedAt"
      from public.reviews r
      join public.orders o on o.id = r.order_id
      left join public.menu_items mi on mi.id = r.menu_item_id
      where r.vendor_id = ${vendorId}::uuid
        and (${filters.menuItemId ?? null}::uuid is null or r.menu_item_id = ${filters.menuItemId ?? null}::uuid)
        and (
          ${filters.rating ?? null}::integer is null
          or r.food_rating = ${filters.rating ?? null}::integer
          or r.vendor_rating = ${filters.rating ?? null}::integer
          or r.delivery_rating = ${filters.rating ?? null}::integer
        )
        and (
          ${cursorCreatedAt}::timestamptz is null
          or (r.created_at, r.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
        )
      order by r.created_at desc, r.id desc
      limit ${filters.limit + 1}
    `.execute(this.database.db);

    return result.rows;
  }
}
