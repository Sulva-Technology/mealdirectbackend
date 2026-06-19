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
};

export class PushChannel {
  constructor(
    private readonly sender: PushSender,
    private readonly tokens: TokenLookup
  ) {}

  async deliverToUser(userId: string, message: ChannelMessage): Promise<void> {
    const tokens = await this.tokens.tokensForUser(userId);
    await Promise.all(
      tokens.map((token) =>
        this.sender.send({
          token,
          title: message.title,
          body: message.body,
          data: message.linkPath === null ? {} : { linkPath: message.linkPath }
        })
      )
    );
  }
}
