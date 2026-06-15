import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { ReviewsRepository } from './reviews.repository.js';
import type {
  CreateReviewInput,
  ReviewRecord,
  ReviewsRepositoryContract
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
}
