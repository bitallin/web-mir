import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

export type LogLevel = z.infer<typeof logLevelSchema>;

export const hostSchema = z.string().min(1).default('0.0.0.0');

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const databaseUrlSchema = z
  .string()
  .regex(/^postgres(ql)?:\/\/\S+$/u, 'must be a postgres:// or postgresql:// connection string');

export const corsOriginsSchema = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .refine((origins) => origins.length > 0, 'must contain at least one origin');

/**
 * Walks up from `startDir` looking for a `.env` file. Local development only;
 * production deployments provide real environment variables.
 */
export function findEnvFile(startDir: string): string | undefined {
  let current = resolve(startDir);
  const { root } = parse(current);

  for (;;) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      return undefined;
    }
    current = dirname(current);
  }
}

export type LoadEnvOptions = {
  /** Explicit environment; when provided, no `.env` file is read. */
  env?: NodeJS.ProcessEnv;
  /** Directory to start the upward `.env` search from. Defaults to cwd. */
  startDir?: string;
  /** Set false to skip reading `.env` even when `env` is not provided. */
  loadFiles?: boolean;
};

/**
 * Loads the nearest `.env` (without overriding real environment variables) and
 * validates it. Error messages list variable names, never their values.
 */
export function loadEnv<T extends z.ZodType>(schema: T, options: LoadEnvOptions = {}): z.infer<T> {
  if (options.env === undefined && options.loadFiles !== false) {
    const envFile = findEnvFile(options.startDir ?? process.cwd());
    if (envFile !== undefined) {
      process.loadEnvFile(envFile);
    }
  }

  const source = options.env ?? process.env;
  const result = schema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  ${path}: ${issue.message}`;
      })
      .join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
