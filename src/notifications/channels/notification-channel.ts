export type ChannelMessage = {
  to: string;
  title: string;
  body: string;
  linkPath: string | null;
};

export type NotificationChannel = {
  deliver: (message: ChannelMessage) => Promise<void>;
};

export type EmailTransport = {
  send: (input: { from: string; to: string; subject: string; text: string }) => Promise<void>;
};
