import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * OWASP minimum for Argon2id. These values are stored in the hash string, so
 * raising them later still verifies existing passwords.
 */
export const ARGON2ID_PARAMS = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

const SALT_BYTES = 16;
const PHC_VERSION = 19;

export type Argon2idParams = {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
};

function toPhcBase64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/u, '');
}

function deriveKey(password: string, salt: Buffer, params: Argon2idParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        memory: params.memory,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.tagLength,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(
  password: string,
  params: Argon2idParams = ARGON2ID_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt, params);
  const saltEncoded = toPhcBase64(salt);
  const hashEncoded = toPhcBase64(derivedKey);
  return `$argon2id$v=${String(PHC_VERSION)}$m=${String(params.memory)},t=${String(params.passes)},p=${String(params.parallelism)}$${saltEncoded}$${hashEncoded}`;
}

type ParsedHash = {
  params: Argon2idParams;
  salt: Buffer;
  hash: Buffer;
};

const PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/u;

function parseHash(encoded: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(encoded);
  if (match === null) {
    return null;
  }
  const [, version, memory, passes, parallelism, salt, hash] = match;
  if (
    version === undefined ||
    Number(version) !== PHC_VERSION ||
    memory === undefined ||
    passes === undefined ||
    parallelism === undefined ||
    salt === undefined ||
    hash === undefined
  ) {
    return null;
  }

  const params: Argon2idParams = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: Buffer.from(hash, 'base64').length,
  };
  if (
    !Number.isInteger(params.memory) ||
    params.memory <= 0 ||
    !Number.isInteger(params.passes) ||
    params.passes <= 0 ||
    !Number.isInteger(params.parallelism) ||
    params.parallelism <= 0 ||
    params.tagLength <= 0
  ) {
    return null;
  }

  return { params, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (parsed === null) {
    return false;
  }

  try {
    const derivedKey = await deriveKey(password, parsed.salt, parsed.params);
    if (derivedKey.length !== parsed.hash.length) {
      return false;
    }
    return timingSafeEqual(derivedKey, parsed.hash);
  } catch {
    return false;
  }
}
