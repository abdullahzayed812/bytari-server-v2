import type { Express } from 'express';
import { pino } from 'pino';
import { loadConfig } from '../../src/config/index.js';
import { createContainer, type Container, type ContainerDeps } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { getTestDb } from './db.js';

const logger = pino({ level: 'silent' });

export interface TestHarness {
  app: Express;
  container: Container;
}

export type TestHarnessOverrides = Pick<
  ContainerDeps,
  'aiResponder' | 'objectStorage' | 'pushProvider'
>;

/** Build a real app wired to the shared test database. */
export function buildTestApp(overrides: TestHarnessOverrides = {}): TestHarness {
  const config = loadConfig();
  const db = getTestDb();
  const container = createContainer({ db, config, logger, ...overrides });
  const app = createApp({ config, db, logger, container });
  return { app, container };
}
