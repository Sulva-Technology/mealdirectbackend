import type { AppEnvironment } from '../config/env.js';
import type { EmailTransport } from '../notifications/channels/notification-channel.js';
import type { PushSender } from '../notifications/channels/push.channel.js';

const noopEmailTransport: EmailTransport = {
  send: (): Promise<void> => Promise.resolve()
};

const noopPushSender: PushSender = {
  send: (): Promise<void> => Promise.resolve()
};

export function createEmailTransport(env: AppEnvironment): EmailTransport {
  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined) {
    return noopEmailTransport;
  }

  return {
    async send(input): Promise<void> {
      const { Resend } = await import('resend');
      const client = new Resend(apiKey);
      const result = await client.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text
      });
      if (result.error !== null) {
        throw new Error(`Resend send failed: ${result.error.message}`);
      }
    }
  };
}

export function createPushSender(env: AppEnvironment): PushSender {
  const projectId = env.FCM_PROJECT_ID;
  const clientEmail = env.FCM_CLIENT_EMAIL;
  const privateKey = env.FCM_PRIVATE_KEY;
  if (projectId === undefined || clientEmail === undefined || privateKey === undefined) {
    return noopPushSender;
  }

  return {
    async send(input): Promise<void> {
      const { cert, getApps, initializeApp } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');

      if (getApps().length === 0) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n')
          })
        });
      }

      await getMessaging().send({
        token: input.token,
        notification: { title: input.title, body: input.body },
        data: input.data
      });
    }
  };
}
