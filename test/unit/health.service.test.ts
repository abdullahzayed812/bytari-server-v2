import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../../src/modules/health/health.service.js';

function fakeDb(raw: (sql: string) => Promise<unknown>): Knex {
  return { raw: vi.fn(raw) } as unknown as Knex;
}

describe('HealthService', () => {
  it('liveness reports ok with a numeric uptime', () => {
    const service = new HealthService(fakeDb(() => Promise.resolve()));
    const report = service.liveness();
    expect(report.status).toBe('ok');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });

  it('readiness is "ready" when the database responds', async () => {
    const service = new HealthService(fakeDb(() => Promise.resolve([{ '?column?': 1 }])));
    const report = await service.readiness();
    expect(report.status).toBe('ready');
    expect(report.dependencies.database.status).toBe('up');
    expect(report.dependencies.database.latencyMs).toBeTypeOf('number');
  });

  it('readiness is "not_ready" when the database throws', async () => {
    const service = new HealthService(fakeDb(() => Promise.reject(new Error('ECONNREFUSED'))));
    const report = await service.readiness();
    expect(report.status).toBe('not_ready');
    expect(report.dependencies.database.status).toBe('down');
    expect(report.dependencies.database.error).toContain('ECONNREFUSED');
  });
});
