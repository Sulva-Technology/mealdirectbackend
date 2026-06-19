import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { evaluatePromotion, PromotionValidationError } from '../../domain/promotions.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { PromotionsRepository } from './promotions.repository.js';
import type {
  CreatePromotionInput,
  PromotionRecord,
  PromotionsRepositoryContract,
  PromotionValidationResult
} from './promotions.types.js';

function invalidPromotion(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PromotionsRepository) private readonly repository: PromotionsRepositoryContract
  ) {}

  async validateForBasket(
    actor: AuthenticatedActor,
    code: string,
    subtotalKobo: number
  ): Promise<PromotionValidationResult> {
    const promo = await this.repository.findActiveByCode(code);
    if (promo === undefined) {
      throw invalidPromotion('Promotion code is not valid.');
    }

    let discountKobo: number;
    try {
      ({ discountKobo } = evaluatePromotion(promo, subtotalKobo));
    } catch (error) {
      if (error instanceof PromotionValidationError) {
        throw invalidPromotion(error.message);
      }
      throw error;
    }

    const userRedemptions = await this.repository.countUserRedemptions(promo.id, actor.userId);
    if (userRedemptions >= promo.perUserLimit) {
      throw invalidPromotion('Promotion code usage limit reached for this user.');
    }

    if (promo.totalUsageLimit !== null) {
      const total = await this.repository.countTotalRedemptions(promo.id);
      if (total >= promo.totalUsageLimit) {
        throw invalidPromotion('Promotion code usage limit reached.');
      }
    }

    return { code: promo.code, discountKobo };
  }

  createPromotion(input: CreatePromotionInput): Promise<PromotionRecord> {
    return this.repository.createPromotion(input);
  }

  listPromotions(): Promise<PromotionRecord[]> {
    return this.repository.listPromotions();
  }

  deactivatePromotion(id: string): Promise<void> {
    return this.repository.setActive(id, false);
  }
}
