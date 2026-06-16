import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { createCursorPage, decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type { CursorPage, CursorPayload } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import type { VendorReviewListQueryDto } from './dto/review.dto.js';
import { ReviewsRepository } from './reviews.repository.js';
import type {
  CreateReviewInput,
  ReviewRecord,
  ReviewsRepositoryContract,
  VendorReviewRecord
} from './reviews.types.js';

const reviewableStatuses = new Set(['administratively_completed', 'confirmed']);

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

function decodeReviewCursor(cursor: string): string {
  let payload: CursorPayload;
  try {
    payload = decodeCursor(cursor);
  } catch {
    throw badRequest('Invalid review cursor.');
  }

  if (typeof payload.createdAt !== 'string' || typeof payload.id !== 'string') {
    throw badRequest('Invalid review cursor.');
  }

  return `${payload.createdAt}|${payload.id}`;
}

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(ReviewsRepository)
    private readonly repository: ReviewsRepositoryContract
  ) {}

  async createReview(
    actor: AuthenticatedActor,
    orderId: string,
    input: CreateReviewInput
  ): Promise<ReviewRecord> {
    this.assertCustomer(actor);
    this.assertHasRating(input);

    const existing = await this.repository.findCustomerReview(actor.userId, orderId);
    if (existing !== undefined) {
      return existing;
    }

    const eligibility = await this.repository.findCustomerReviewEligibility(actor.userId, orderId);
    if (eligibility === undefined) {
      throw notFound('Order was not found.');
    }
    if (!reviewableStatuses.has(eligibility.orderStatus)) {
      throw badRequest('Order is not ready for review.');
    }
    if (
      input.menuItemId !== undefined &&
      !(await this.repository.customerOrderContainsMenuItem(orderId, input.menuItemId))
    ) {
      throw badRequest('Only purchased menu items can be reviewed.');
    }

    const created = await this.repository.createCustomerReview(actor.userId, eligibility, input);
    if (created !== undefined) {
      return created;
    }

    const racedExisting = await this.repository.findCustomerReview(actor.userId, orderId);
    if (racedExisting !== undefined) {
      return racedExisting;
    }

    throw badRequest('Review could not be created for this order.');
  }

  async listVendorReviews(
    actor: AuthenticatedActor,
    query: VendorReviewListQueryDto
  ): Promise<CursorPage<VendorReviewRecord>> {
    const vendorId = await this.assertAndGetVendorId(actor);
    const limit = query.limit ?? 20;
    const rows = await this.repository.listVendorReviews(vendorId, {
      ...(query.cursor === undefined ? {} : { cursor: decodeReviewCursor(query.cursor) }),
      ...(query.menuItemId === undefined ? {} : { menuItemId: query.menuItemId }),
      ...(query.rating === undefined ? {} : { rating: query.rating }),
      limit
    });

    return createCursorPage(rows, limit, (review) =>
      encodeCursor({
        createdAt: review.createdAt,
        id: review.id
      })
    );
  }

  private assertCustomer(actor: AuthenticatedActor): void {
    if (actor.role !== 'customer') {
      throw forbidden('Customer access is required.');
    }
  }

  private assertHasRating(input: CreateReviewInput): void {
    if (
      input.foodRating === undefined &&
      input.vendorRating === undefined &&
      input.deliveryRating === undefined
    ) {
      throw badRequest('At least one rating is required.');
    }
  }

  private async assertAndGetVendorId(actor: AuthenticatedActor): Promise<string> {
    if (actor.role !== 'vendor' || actor.vendorId === undefined || actor.vendorId.length === 0) {
      throw forbidden('Vendor access is required.');
    }

    if (!(await this.repository.assertVendorAccess(actor.vendorId, actor.userId))) {
      throw forbidden('Vendor access is required.');
    }

    return actor.vendorId;
  }
}
