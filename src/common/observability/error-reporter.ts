export interface ErrorReporter {
  captureException(error: unknown): void;
}

export class NoopErrorReporter implements ErrorReporter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  captureException(_error: unknown): void {
    // Intentionally does nothing when Sentry is not configured.
  }
}

export class SentryErrorReporter implements ErrorReporter {
  constructor(private readonly client: { captureException: (error: unknown) => unknown }) {}

  captureException(error: unknown): void {
    this.client.captureException(error);
  }
}
