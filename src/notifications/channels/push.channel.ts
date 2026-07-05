import type { ChannelMessage } from './notification-channel.js';

export type PushSender = {
  send: (input: {
    token: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }) => Promise<void>;
};

export type TokenLookup = {
  tokensForUser: (userId: string) => Promise<string[]>;
  removeToken: (token: string, reason?: string) => Promise<void>;
};

// FCM error codes that mean the token is permanently unusable. Pruning these
// lets the outbox event complete instead of retrying forever and dead-lettering.
//
// NOTE: `messaging/invalid-argument` is deliberately NOT here. FCM returns it for
// systemic problems (backend creds / project mismatch with the app's Firebase
// project, malformed payload), not just dead tokens. Treating it as a dead token
// caused mass token deletion on any credential/project mismatch — silent outage.
// It now falls through to the transient path (retry + surfaced error) instead.
const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

function isInvalidTokenError(reason: unknown): boolean {
  const code = (reason as { code?: unknown }).code;
  if (typeof code === 'string' && PERMANENT_TOKEN_ERROR_CODES.has(code)) {
    return true;
  }
  const message = reason instanceof Error ? reason.message : '';
  return /not a valid FCM registration token|not registered/i.test(message);
}

export class PushChannel {
  constructor(
    private readonly sender: PushSender,
    private readonly tokens: TokenLookup
  ) {}

  async deliverToUser(userId: string, message: ChannelMessage): Promise<void> {
    const tokens = await this.tokens.tokensForUser(userId);
    const results = await Promise.allSettled(
      tokens.map((token) =>
        this.sender.send({
          token,
          title: message.title,
          body: message.body,
          data: message.linkPath === null ? {} : { linkPath: message.linkPath }
        })
      )
    );

    let transientError: unknown;
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') continue;
      if (isInvalidTokenError(result.reason)) {
        // Permanent: disable the dead token so it stops poisoning future events.
        const code = (result.reason as { code?: unknown }).code;
        await this.tokens.removeToken(
          tokens[index] as string,
          typeof code === 'string' ? code : 'invalid-token'
        );
        continue;
      }
      // Transient (network, quota, auth): remember it so the event retries.
      transientError ??= result.reason;
    }

    if (transientError !== undefined) {
      throw transientError instanceof Error ? transientError : new Error(String(transientError));
    }
  }
}
