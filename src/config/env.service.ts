import { Injectable } from '@nestjs/common';

import type { AppEnvironment } from './env.js';
import { parseEnvironment } from './env.js';

@Injectable()
export class EnvService {
  private readonly values: AppEnvironment;

  constructor() {
    this.values = parseEnvironment();
  }

  get all(): AppEnvironment {
    return this.values;
  }

  get<K extends keyof AppEnvironment>(key: K): AppEnvironment[K] {
    return this.values[key];
  }
}
