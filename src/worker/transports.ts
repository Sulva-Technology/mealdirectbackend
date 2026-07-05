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
    const missing = [
      projectId === undefined ? 'FCM_PROJECT_ID' : null,
      clientEmail === undefined ? 'FCM_CLIENT_EMAIL' : null,
      privateKey === undefined ? 'FCM_PRIVATE_KEY' : null
    ].filter((name): name is string => name !== null);
    console.warn(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        context: 'Worker',
        message: 'Push notifications disabled: FCM credentials missing; using noop push sender',
        missing
      })
    );
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

      // Data-only message (no `notification` block) on purpose: with a notification
      // payload, web browsers auto-display the push AND fire the service worker's
      // onBackgroundMessage, which renders it a second time — a duplicate notification.
      // Sending title/body inside `data` lets each app's service worker render exactly
      // one notification with full control over icon and click routing. Every Meal Direct
      // client SW/foreground handler reads data.title/data.body.
      try {
        await getMessaging().send({
          token: input.token,
          data: {
            title: input.title,
            body: input.body,
            ...input.data
          }
        });
      } catch (error) {
        // Surface the FCM error code/message: without this the failure is invisible
        // (thrown transient errors just retry+dead-letter, dead tokens get pruned).
        const code = (error as { code?: unknown }).code;
        console.error(
          JSON.stringify({
            level: 'error',
            timestamp: new Date().toISOString(),
            context: 'PushSender',
            message: 'FCM send failed',
            projectId,
            code: typeof code === 'string' ? code : undefined,
            error: error instanceof Error ? error.message : String(error)
          })
        );
        throw error;
      }
    }
  };
}
