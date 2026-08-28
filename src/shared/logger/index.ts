import { pino, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../../config/index.js';

export type { Logger };

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

/**
 * Build the root application logger.
 *
 * - `development`: pretty, human-readable output.
 * - `test`: silent by default to keep test output clean.
 * - `production`: structured JSON on stdout (for log shippers).
 */
export function createLogger(config: AppConfig): Logger {
  const options: LoggerOptions = {
    level: config.isTest ? 'silent' : config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'bytari-backend', env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!config.isProduction && !config.isTest) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,service,env',
        },
      },
    });
  }

  return pino(options);
}
