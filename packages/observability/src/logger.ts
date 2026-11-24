import { pino, type DestinationStream, type Logger } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type CreateLoggerOptions = {
  service: string;
  level: LogLevel;
  /** Human-readable output for local development. Ignored when `destination` is set. */
  pretty?: boolean;
  /** Injection point for tests and alternate sinks. */
  destination?: DestinationStream;
};

export const REDACT_PATHS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'gameTicket',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.refreshToken',
] as const;

const REDACTION_CENSOR = '[REDACTED]';

export function createLogger(options: CreateLoggerOptions): Logger {
  const usePretty = options.pretty === true && options.destination === undefined;

  return pino(
    {
      level: options.level,
      base: { service: options.service },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [...REDACT_PATHS],
        censor: REDACTION_CENSOR,
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      ...(usePretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    options.destination,
  );
}
