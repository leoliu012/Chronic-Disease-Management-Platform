import * as crypto from 'crypto';

export type AuthTokenPayload = {
  sub: string;
  username: string;
  role: string;
  displayName: string;
  iat: number;
  exp: number;
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signingSecret() {
  return process.env.JWT_SECRET || 'dev_secret_change_later';
}

export function hashPassword(password: string, salt?: string) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, actualSalt, 120000, 32, 'sha256')
    .toString('hex');

  return `${actualSalt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

export function signToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>) {
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = Number(process.env.JWT_EXPIRES_SECONDS || 60 * 60 * 8);

  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    }),
  );

  const signature = base64Url(
    crypto.createHmac('sha256', signingSecret()).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): AuthTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [header, body, signature] = parts;
  const expectedSignature = base64Url(
    crypto.createHmac('sha256', signingSecret()).update(`${header}.${body}`).digest(),
  );

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(fromBase64Url(body)) as AuthTokenPayload;
  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}
