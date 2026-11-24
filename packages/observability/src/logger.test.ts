import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

function captureLines(): { lines: string[]; write: (chunk: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (chunk: string) => {
      lines.push(chunk);
    },
  };
}

describe('createLogger', () => {
  it('emits structured JSON with the service name and level label', () => {
    const sink = captureLines();
    const logger = createLogger({
      service: 'control-api',
      level: 'info',
      destination: sink,
    });

    logger.info({ requestId: 'req-1' }, 'server started');

    expect(sink.lines).toHaveLength(1);
    const entry: unknown = JSON.parse(sink.lines[0] ?? '{}');
    expect(entry).toMatchObject({
      service: 'control-api',
      level: 'info',
      msg: 'server started',
      requestId: 'req-1',
    });
  });

  it('redacts credentials and tokens', () => {
    const sink = captureLines();
    const logger = createLogger({
      service: 'control-api',
      level: 'info',
      destination: sink,
    });

    logger.info(
      {
        password: 'hunter2',
        token: 'raw-token',
        nested: { refreshToken: 'refresh-token' },
        safe: 'visible',
      },
      'login attempt',
    );

    const entry: unknown = JSON.parse(sink.lines[0] ?? '{}');
    expect(entry).toMatchObject({
      password: '[REDACTED]',
      token: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]' },
      safe: 'visible',
    });
    expect(sink.lines[0]).not.toContain('hunter2');
    expect(sink.lines[0]).not.toContain('raw-token');
  });

  it('honours the configured level', () => {
    const sink = captureLines();
    const logger = createLogger({ service: 'game-server', level: 'warn', destination: sink });

    logger.info('dropped');
    logger.warn('kept');

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('kept');
  });
});
