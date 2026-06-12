import { Injectable } from '@nestjs/common';

export type RecordedRequest = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

export type MetricsSnapshot = {
  requests: {
    total: number;
    byStatusClass: Record<string, number>;
    byRoute: Record<string, number>;
    latencyMs: {
      count: number;
      average: number;
      max: number;
    };
  };
};

@Injectable()
export class MetricsService {
  private totalRequests = 0;
  private totalLatencyMs = 0;
  private maxLatencyMs = 0;
  private readonly byStatusClass = new Map<string, number>();
  private readonly byRoute = new Map<string, number>();

  recordRequest(request: RecordedRequest): void {
    this.totalRequests += 1;
    this.totalLatencyMs += request.durationMs;
    this.maxLatencyMs = Math.max(this.maxLatencyMs, request.durationMs);

    const statusClass = `${Math.floor(request.statusCode / 100).toString()}xx`;
    this.byStatusClass.set(statusClass, (this.byStatusClass.get(statusClass) ?? 0) + 1);

    const routeKey = `${request.method.toUpperCase()} ${request.route}`;
    this.byRoute.set(routeKey, (this.byRoute.get(routeKey) ?? 0) + 1);
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: {
        total: this.totalRequests,
        byStatusClass: Object.fromEntries(this.byStatusClass.entries()),
        byRoute: Object.fromEntries(this.byRoute.entries()),
        latencyMs: {
          count: this.totalRequests,
          average:
            this.totalRequests === 0 ? 0 : Math.round(this.totalLatencyMs / this.totalRequests),
          max: Math.round(this.maxLatencyMs)
        }
      }
    };
  }
}
