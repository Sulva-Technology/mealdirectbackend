import { describe, expect, it, vi } from 'vitest';

import { provisionWalletForRole } from '../../src/modules/auth/supabase-auth.service.js';

describe('provisionWalletForRole', () => {
  it('provisions a wallet for a new customer', async () => {
    const ensureWallet = vi.fn().mockResolvedValue('wallet-1');

    await provisionWalletForRole({ ensureWallet }, 'customer', 'user-1');

    expect(ensureWallet).toHaveBeenCalledWith('user-1');
  });

  it('does not provision for vendors or riders', async () => {
    const ensureWallet = vi.fn();

    await provisionWalletForRole({ ensureWallet }, 'vendor', 'user-2');
    await provisionWalletForRole({ ensureWallet }, 'rider', 'user-3');

    expect(ensureWallet).not.toHaveBeenCalled();
  });

  it('never fails signup when provisioning throws', async () => {
    const ensureWallet = vi.fn().mockRejectedValue(new Error('database down'));

    await expect(
      provisionWalletForRole({ ensureWallet }, 'customer', 'user-4')
    ).resolves.toBeUndefined();
  });
});
