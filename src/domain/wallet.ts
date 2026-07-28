// Custom SQLSTATE raised by public.create_paid_order_from_wallet when the balance is short.
// Postgres reserves classes 00–42 and 5x; MDW is a MealDirect-private class, so it can never
// collide with a server-generated code.
export const walletInsufficientBalanceSqlState = 'MDW01';

export const walletStatuses = ['active', 'frozen'] as const;
export type WalletStatus = (typeof walletStatuses)[number];

export const walletEntryTypes = [
  'topup',
  'order_payment',
  'order_refund',
  'adjustment',
  'reversal'
] as const;
export type WalletEntryType = (typeof walletEntryTypes)[number];

export const dedicatedAccountStatuses = ['pending', 'active', 'failed', 'deactivated'] as const;
export type DedicatedAccountStatus = (typeof dedicatedAccountStatuses)[number];

export const orderPaymentMethods = ['wallet', 'paystack'] as const;
export type OrderPaymentMethod = (typeof orderPaymentMethods)[number];

export type WalletShortfall = {
  balanceKobo: number;
  requiredKobo: number;
  shortfallKobo: number;
};

/**
 * The RPC attaches the shortfall to the error's DETAIL field as JSON. Parsing is
 * best-effort: a 402 without numbers is still far more useful than a 500.
 */
export function parseWalletShortfall(detail: string | undefined): WalletShortfall | undefined {
  if (detail === undefined || detail.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { balanceKobo, requiredKobo, shortfallKobo } = parsed as Record<string, unknown>;
    if (
      typeof balanceKobo !== 'number' ||
      typeof requiredKobo !== 'number' ||
      typeof shortfallKobo !== 'number'
    ) {
      return undefined;
    }
    return { balanceKobo, requiredKobo, shortfallKobo };
  } catch {
    return undefined;
  }
}
