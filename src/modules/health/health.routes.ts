import { Router } from 'express';
import type { Knex } from 'knex';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * Mounts:
 *   GET /health        → liveness   (always 200 while the process is up)
 *   GET /health/ready  → readiness  (200 ready / 503 not_ready)
 */
export function createHealthRouter(db: Knex): Router {
  const controller = new HealthController(new HealthService(db));
  const router = Router();

  router.get('/health', controller.liveness);
  router.get('/health/ready', asyncHandler(controller.readiness));

  return router;
}
