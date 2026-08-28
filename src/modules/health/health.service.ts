import type { Knex } from 'knex';
import { pingDatabase } from '../../database/knex.js';

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  timestamp: string;
  dependencies: {
    database: DependencyStatus;
  };
}

/**
 * Health checks for the platform.
 *
 * Liveness answers "is the process running?"; readiness answers "can it serve
 * traffic?" (i.e. required dependencies are reachable).
 */
export class HealthService {
  constructor(private readonly db: Knex) {}

  liveness(): LivenessReport {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();
    return {
      status: database.status === 'up' ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      dependencies: { database },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const start = process.hrtime.bigint();
    try {
      await pingDatabase(this.db);
      const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      return { status: 'up', latencyMs: Math.round(latencyMs * 100) / 100 };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'unknown error' };
    }
  }
}
