import { Inject, Injectable, type LoggerService } from '@nestjs/common';

import { EnvService } from '../../config/env.service.js';
import { redactUnknown } from './redact.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeight: Record<LogLevel | 'silent', number> = {
  silent: 99,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly configuredLevel: LogLevel | 'silent';

  constructor(@Inject(EnvService) env: EnvService) {
    this.configuredLevel = env.get('LOG_LEVEL');
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    if (levelWeight[level] < levelWeight[this.configuredLevel]) {
      return;
    }

    const entry = {
      level,
      timestamp: new Date().toISOString(),
      context,
      message: redactUnknown(message),
      ...(trace === undefined ? {} : { trace })
    };

    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  }
}
