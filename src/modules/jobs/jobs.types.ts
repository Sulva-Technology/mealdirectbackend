export type JobsRecord = Record<string, unknown>;

export type SystemSummary = {
  databaseTime: string | null;
  outbox: JobsRecord;
  worker: {
    registeredQueues: string[];
  };
};

export type OutboxProcessResult = {
  claimedCount: number;
  workerId: string;
  events: JobsRecord[];
};
