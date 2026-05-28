import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * secret-crypto.util
 * ------------------
 * AES-256-GCM 加密的小工具, 用于 HospitalWechatOfficialAccount 的 appSecret
 * 和缓存的 accessToken.
 *
 * Key derivation:
 *   k = sha256(PATIENT_ENGAGEMENT_SECRET_KEY)   // 固定 32 bytes
 *
 * 存储格式 (base64url 之间用 '.' 分隔, 一行可读, 不需要单独存 IV/auth tag):
 *   v1.<iv_b64>.<ciphertext_b64>.<authTag_b64>
 *
 * 生产模式:
 *   PATIENT_ENGAGEMENT_SECRET_KEY 未设置 → throw, 服务启动失败.
 *
 * 开发模式 (NODE_ENV !== 'production'):
 *   PATIENT_ENGAGEMENT_SECRET_KEY 未设置 → warn 一次, 使用 'dev_patient_engagement_secret_change_me' 作为 fallback.
 */

const log = new Logger('secret-crypto');
let warnedOnce = false;

export function getSecretKey(): Buffer {
  const raw = process.env.PATIENT_ENGAGEMENT_SECRET_KEY;
  if (!raw || !raw.trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PATIENT_ENGAGEMENT_SECRET_KEY is required in production. Refusing to start without an encryption key.',
      );
    }
    if (!warnedOnce) {
      log.warn(
        'PATIENT_ENGAGEMENT_SECRET_KEY is not set — falling back to the dev default. NEVER deploy to production without setting it.',
      );
      warnedOnce = true;
    }
    return createHash('sha256').update('dev_patient_engagement_secret_change_me', 'utf8').digest();
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptSecret(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('encryptSecret: plain must be a non-empty string');
  }
  const key = getSecretKey();
  const iv = randomBytes(12); // GCM standard nonce length
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    ct.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const parts = String(blob).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    log.warn(`decryptSecret: bad envelope (parts=${parts.length}, version=${parts[0]})`);
    return null;
  }
  try {
    const key = getSecretKey();
    const iv = Buffer.from(parts[1], 'base64url');
    const ct = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
  } catch (e) {
    log.warn(`decryptSecret: decryption failed (${(e as Error).message})`);
    return null;
  }
}

/** Mask a secret for display: keep first 4 / last 2 chars, replace middle with ****. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 6) return '****';
  return value.slice(0, 4) + '****' + value.slice(-2);
}
