import { HttpStatus } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { mapDatabaseError } from '../../src/common/errors/database-error.js';
import { walletInsufficientBalanceSqlState } from '../../src/domain/wallet.js';

function databaseError(code: string, message: string, detail?: string): DatabaseError {
  const error = new DatabaseError(message, 0, 'error');
  error.code = code;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
}

describe('wallet database error mapping', () => {
  it('maps the insufficient-balance SQLSTATE to 402 with the shortfall', () => {
    const mapped = mapDatabaseError(
      databaseError(
        walletInsufficientBalanceSqlState,
        'wallet balance is insufficient for this order',
        JSON.stringify({ balanceKobo: 10000, requiredKobo: 45000, shortfallKobo: 35000 })
      )
    );

    expect(mapped?.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(mapped?.getResponse()).toEqual({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'wallet balance is insufficient for this order',
      details: { balanceKobo: 10000, requiredKobo: 45000, shortfallKobo: 35000 }
    });
  });

  it('still returns 402 when the detail payload is missing or unparseable', () => {
    const mapped = mapDatabaseError(
      databaseError(walletInsufficientBalanceSqlState, 'wallet balance is insufficient', 'not json')
    );

    expect(mapped?.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(mapped?.getResponse()).toEqual({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'wallet balance is insufficient'
    });
  });

  it('leaves other SQLSTATEs on their existing mappings', () => {
    expect(mapDatabaseError(databaseError('23514', 'wallet is frozen'))?.getStatus()).toBe(
      HttpStatus.BAD_REQUEST
    );
  });
});
