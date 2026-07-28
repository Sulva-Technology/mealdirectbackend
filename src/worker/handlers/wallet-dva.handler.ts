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
  return {
    ...(firstName === undefined ? {} : { firstName }),
    ...(rest.length === 0 ? {} : { lastName: rest.join(' ') })
  };
}

/**
 * Drains `wallet.dva_requested`: creates the Paystack customer, then its dedicated virtual
 * account, and stores the bank details on the wallet. Entirely inert while WALLET_DVA_ENABLED
 * is off — the flag is the switch we flip once Paystack approves DVA on the account, and until
 * then wallets simply have no account number and top-ups run through a checkout link.
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

    const owner = await this.reads.findWalletOwner(walletId);
    if (owner === undefined || owner.email === null) {
      // No owner or no email: nothing Paystack can be told. Completing the event is correct —
      // retrying cannot change the outcome, and POST /wallet/dedicated-account can retry later.
      return;
    }

    let customer: PaystackCustomerResult | undefined;
    try {
      customer = await this.paystack.createCustomer({
        email: owner.email,
        ...splitDisplayName(owner.displayName)
      });

      const account = await this.paystack.createDedicatedAccount({
        customerCode: customer.customerCode
      });

      await this.reads.upsertDedicatedAccount({
        walletId,
        paystackCustomerCode: customer.customerCode,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName: account.bankName,
        bankSlug: account.bankSlug,
        status: 'active',
        providerPayload: account.providerPayload
      });
    } catch (error) {
      await this.reads.upsertDedicatedAccount({
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
  };
}
