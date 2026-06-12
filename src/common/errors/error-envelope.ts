export type SafeErrorDetails = Record<string, unknown> | readonly Record<string, unknown>[];

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: SafeErrorDetails;
  };
  requestId: string;
  timestamp: string;
};

export function createErrorEnvelope(input: {
  code: string;
  message: string;
  details?: SafeErrorDetails;
  requestId: string;
  timestamp?: string;
}): ErrorEnvelope {
  return {
    error: {
      code: input.code,
      message: input.message,
      ...(input.details === undefined ? {} : { details: input.details })
    },
    requestId: input.requestId,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}
