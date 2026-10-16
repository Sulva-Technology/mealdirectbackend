import type {
  PaystackCustomerInput,
  PaystackCustomerResult,
  PaystackDedicatedAccountInput,
  PaystackDedicatedAccountResult
} from '../../modules/payments/payments.types.js';
import type { OutboxEvent } from '../outbox.repository.js';
import type { DedicatedAccountWrite, WalletOwner } from './wallet-reads.repository.js';

export type WalletReads = {
  findWalletOwner: (walletId: string) => Promise<WalletOwner | undefined>;
  findDedicatedAccount: (walletId: string) => Promise<{ status: string } | null>;
  upsertDedicatedAccount: (input: DedicatedAccountWrite) => Promise<void>;
};

export type DedicatedAccountProvisioner = {
  createCustomer: (input: PaystackCustomerInput) => Promise<PaystackCustomerResult>;
  createDedicatedAccount: (
    input: PaystackDedicatedAccountInput
  ) => Promise<PaystackDedicatedAccountResult>;
};

function splitDisplayName(displayName: string | null): { firstName?: string; lastName?: string } {
  const parts = (displayName ?? '')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return {};
  const [firstName, ...rest] = parts;
  // Paystack wants both names on a DVA customer; a one-word name stands in for both.
  return {
    ...(firstName === undefined ? {} : { firstName }),
    ...(rest.length === 0
      ? firstName === undefined
        ? {}
        : { lastName: firstName }
      : { lastName: rest.join(' ') })
  };
}

/**
 * Normalises a Nigerian profile phone to the international form Paystack expects:
 * "0803 123 4567" / "2348031234567" / "+234 803-123-4567" → "+2348031234567".
 * Anything else is passed through with spacing and punctuation removed.
 */
export function toPaystackPhone(phone: string | null): string | undefined {
  const digits = (phone ?? '').replace(/[\s()-]/g, '');
  if (digits.length === 0) return undefined;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

export type ProvisionOutcome = 'provisioned' | 'missing_email' | 'missing_phone';

/**
 * Creates the Paystack customer, then its dedicated virtual account, and stores the bank
 * details on the wallet. Shared by the outbox handler and POST /wallet/dedicated-account so a
 * customer whose signup-time attempt was skipped (flag off) or failed can self-serve a retry.
 *
 * Paystack refuses a DVA without the customer's email, name and phone, so a profile missing
 * the email or phone returns early without calling Paystack. Name and phone go on both the
 * customer and the DVA request — the latter also fills them in on a Paystack customer created
 * by an earlier attempt that lacked them. Failures write a `failed` row and rethrow.
 */
export async function provisionDedicatedAccount(
  walletId: string,
  reads: WalletReads,
  paystack: DedicatedAccountProvisioner
): Promise<ProvisionOutcome> {
  const owner = await reads.findWalletOwner(walletId);
  if (owner?.email == null) {
    return 'missing_email';
  }
  const phone = toPaystackPhone(owner.phoneNumber);
  if (phone === undefined) {
    return 'missing_phone';
  }
  const names = splitDisplayName(owner.displayName);

  let customer: PaystackCustomerResult | undefined;
  try {
    customer = await paystack.createCustomer({ email: owner.email, phone, ...names });

    const account = await paystack.createDedicatedAccount({
      customerCode: customer.customerCode,
      phone,
      ...names
    });

    await reads.upsertDedicatedAccount({
      walletId,
      paystackCustomerCode: customer.customerCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankName: account.bankName,
      bankSlug: account.bankSlug,
      status: 'active',
      providerPayload: account.providerPayload
    });
    return 'provisioned';
  } catch (error) {
    await reads.upsertDedicatedAccount({
      walletId,
      paystackCustomerCode: customer?.customerCode ?? '',
      accountNumber: `pending:${walletId}`,
      accountName: 'pending',
      bankName: 'pending',
      bankSlug: 'pending',
      status: 'failed',
      providerPayload: {
        error: error instanceof Error ? error.message : 'unknown provisioning error'
      }
    });
    throw error;
  }
}

/**
 * Drains `wallet.dva_requested`. Entirely inert while WALLET_DVA_ENABLED is off — the flag is
 * the switch we flip once Paystack approves DVA on the account, and until then wallets simply
 * have no account number and top-ups run through a checkout link (POST /wallet/topup).
 *
 * Failures write a `failed` row and rethrow, so the outbox retries with backoff and an admin
 * (or the customer, via POST /wallet/dedicated-account) can see the state.
 */
export class WalletDvaHandler {
  constructor(
    private readonly reads: WalletReads,
    private readonly paystack: DedicatedAccountProvisioner,
    private readonly enabled: boolean
  ) {}

  handle = async (event: OutboxEvent): Promise<void> => {
    if (!this.enabled) {
      return;
    }

    const walletId = event.aggregateId;
    const existing = await this.reads.findDedicatedAccount(walletId);
    if (existing !== null && existing.status === 'active') {
      return;
    }

    // No owner email or phone: retrying cannot change the outcome, so the event completes and
    // POST /wallet/dedicated-account can retry once the profile is complete.
    await provisionDedicatedAccount(walletId, this.reads, this.paystack);
  };
}
