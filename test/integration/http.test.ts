import type { Knex } from 'knex';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, API_PREFIX } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/shared/logger/index.js';

/**
 * Exercises the full HTTP middleware stack (routing, envelopes, error handling,
 * OpenAPI) against an in-memory fake database — no Postgres required.
 */
function fakeDb(): Knex {
  return { raw: vi.fn().mockResolvedValue([{ ok: 1 }]) } as unknown as Knex;
}

describe('HTTP application', () => {
  let app: Express;

  beforeAll(() => {
    const config = loadConfig();
    app = createApp({ config, db: fakeDb(), logger: createLogger(config) });
  });

  afterAll(() => vi.restoreAllMocks());

  it('GET / returns the service metadata envelope with an infrastructure summary', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'bytari-backend', apiBase: API_PREFIX });
    expect(res.body.data.infrastructure).toMatchObject({
      realtime: { enabled: true, path: '/realtime', connections: 0 },
      push: { provider: 'noop' },
      storage: { provider: 'in-memory' },
    });
  });

  it('GET /health returns a liveness envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /health/ready returns 200 + ready when the database responds', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.dependencies.database.status).toBe('up');
  });

  it('exposes the same health route under the version prefix', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`);
    expect(res.status).toBe(200);
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health']).toBeDefined();
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await request(app).get('/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain('swagger-ui');
  });

  it('returns a consistent 404 error envelope for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('returns 400 with BAD_REQUEST for malformed JSON', async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/anything`)
      .set('Content-Type', 'application/json')
      .send('{ not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over BODY_LIMIT', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(1_200_000) });
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.requestId).toBeDefined();
  });
});
