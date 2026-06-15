import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import { ReviewsService } from '../../src/modules/reviews/reviews.service.js';
import type {
  ReviewEligibility,
  ReviewRecord,
  ReviewsRepositoryContract
} from '../../src/modules/reviews/reviews.types.js';

const customer: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'customer'
};

const rider: AuthenticatedActor = {
  userId: '22222222-2222-4222-8222-222222222222',
  riderId: '33333333-3333-4333-8333-333333333333',
  role: 'rider'
};

const eligibility: ReviewEligibility = {
  deliveryBatchId: '44444444-4444-4444-8444-444444444444',
  orderId: '55555555-5555-4555-8555-555555555555',
  orderStatus: 'confirmed',
  vendorId: '66666666-6666-4666-8666-666666666666'
};

const menuItemId = '88888888-8888-4888-8888-888888888888';

const review: ReviewRecord = {
  comment: 'Very good.',
  createdAt: '2026-06-15T09:00:00.000Z',
  deliveryBatchId: eligibility.deliveryBatchId,
  deliveryRating: 4,
  foodRating: 5,
  id: '77777777-7777-4777-8777-777777777777',
  menuItemId,
  moderationStatus: 'pending',
  orderId: eligibility.orderId,
  reviewerId: customer.userId,
  updatedAt: '2026-06-15T09:00:00.000Z',
  vendorId: eligibility.vendorId,
  vendorRating: 5
};

function createRepository(): ReviewsRepositoryContract {
  return {
    createCustomerReview: vi.fn().mockResolvedValue(review),
    customerOrderContainsMenuItem: vi.fn().mockResolvedValue(true),
    findCustomerReview: vi.fn().mockResolvedValue(undefined),
    findCustomerReviewEligibility: vi.fn().mockResolvedValue(eligibility)
  };
}

describe('ReviewsService', () => {
  let repository: ReviewsRepositoryContract;
  let service: ReviewsService;

  beforeEach(() => {
    repository = createRepository();
    service = new ReviewsService(repository);
  });

  it('creates a review for a confirmed customer-owned order', async () => {
    await expect(
      service.createReview(customer, eligibility.orderId, {
        comment: 'Very good.',
        deliveryRating: 4,
        foodRating: 5,
        menuItemId,
        vendorRating: 5
      })
    ).resolves.toEqual(review);

    expect(repository.createCustomerReview).toHaveBeenCalledWith(customer.userId, eligibility, {
      comment: 'Very good.',
      deliveryRating: 4,
      foodRating: 5,
      menuItemId: review.menuItemId,
      vendorRating: 5
    });
  });

  it('returns an existing review instead of creating a duplicate', async () => {
    vi.mocked(repository.findCustomerReview).mockResolvedValue(review);

    await expect(
      service.createReview(customer, eligibility.orderId, {
        vendorRating: 5
      })
    ).resolves.toEqual(review);

    expect(repository.createCustomerReview).not.toHaveBeenCalled();
  });

  it('rejects unconfirmed orders and missing orders', async () => {
    vi.mocked(repository.findCustomerReviewEligibility).mockResolvedValueOnce({
      ...eligibility,
      orderStatus: 'delivered'
    });

    await expect(
      service.createReview(customer, eligibility.orderId, {
        vendorRating: 5
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    vi.mocked(repository.findCustomerReviewEligibility).mockResolvedValueOnce(undefined);
    await expect(
      service.createReview(customer, eligibility.orderId, {
        vendorRating: 5
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects reviews without ratings or for unpurchased menu items', async () => {
    await expect(
      service.createReview(customer, eligibility.orderId, {
        comment: 'No stars.'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    vi.mocked(repository.customerOrderContainsMenuItem).mockResolvedValue(false);
    await expect(
      service.createReview(customer, eligibility.orderId, {
        foodRating: 5,
        menuItemId
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a customer actor', async () => {
    await expect(
      service.createReview(rider, eligibility.orderId, {
        vendorRating: 5
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
