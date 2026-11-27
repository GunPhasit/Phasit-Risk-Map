import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HAZARD_IDS } from '../src/data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../src/data/indicatorCatalog.ts';
import type {
  CapacityIndicatorId,
  DistrictMetricsPayload,
  ExposureIndicatorId,
  HazardId,
  VulnerabilityIndicatorId,
} from '../src/types/index.ts';

// ==================== Security Headers (OWASP / NCSA / Gov IT) ====================

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// ==================== Cryptographic Hashing & Password KDF (scrypt) ====================

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomTokenHex(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expectedHex) {
    return false;
  }
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // ทำงานเทียบเวลาคงที่แม้ความยาวต่างกัน
    const dummy = Buffer.alloc(bufB.length);
    crypto.timingSafeEqual(dummy, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ==================== AES-256-GCM Secret Encryption at Rest ====================

export function resolveMasterKey(
  projectRoot: string,
  inMemory: boolean,
  masterKeyOverride?: Buffer,
): Buffer {
  if (masterKeyOverride && masterKeyOverride.length === 32) {
    return masterKeyOverride;
  }
  const envKey = process.env.DDPM_MASTER_KEY;
  if (envKey && envKey.length >= 32) {
    return crypto.createHash('sha256').update(envKey, 'utf8').digest();
  }
  if (!inMemory && process.env.DDPM_STRICT_PROD === 'true') {
    throw new Error('DDPM_MASTER_KEY (>= 32 characters) is required when DDPM_STRICT_PROD=true');
  }
  if (inMemory) {
    return crypto.randomBytes(32);
  }
  const candidatePaths = [
    path.resolve(projectRoot, '.server-secrets.json'),
    path.join(os.tmpdir(), '.ddpm-server-secrets.json'),
  ];
  for (const secretPath of candidatePaths) {
    if (fs.existsSync(secretPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(secretPath, 'utf8')) as { masterKeyHex?: string };
        if (parsed.masterKeyHex && parsed.masterKeyHex.length === 64) {
          return Buffer.from(parsed.masterKeyHex, 'hex');
        }
      } catch {
        // ลองสร้างใหม่ด้านล่าง
      }
    }
  }
  const freshKey = crypto.randomBytes(32);
  for (const secretPath of candidatePaths) {
    try {
      fs.writeFileSync(
        secretPath,
        JSON.stringify({ masterKeyHex: freshKey.toString('hex'), createdAt: new Date().toISOString() }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      return freshKey;
    } catch {
      // โฟลเดอร์โค้ดอาจเป็น read-only บน Serverless ให้ลอง /tmp ต่อ
    }
  }
  return freshKey;
}

export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext: string, masterKey: Buffer): string {
  const parts = ciphertext.split('$');
  if (parts.length !== 4 || parts[0] !== 'aes256gcm') {
    throw new Error('Invalid encrypted secret format');
  }
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const data = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ==================== RFC 6238 TOTP 2FA (HMAC-SHA1, 30s, 6-Digit) ====================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(str: string): Buffer {
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function computeTotpAtStep(base32Secret: string, step: number): string {
  const key = base32Decode(base32Secret);
  const counter = Buffer.alloc(8);
  const hi = Math.floor(step / 0x100000000);
  const lo = step >>> 0;
  counter.writeUInt32BE(hi, 0);
  counter.writeUInt32BE(lo, 4);

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function computeCurrentTotp(base32Secret: string, timestampMs = Date.now()): string {
  const step = Math.floor(timestampMs / 1000 / 30);
  return computeTotpAtStep(base32Secret, step);
}

export function verifyTotp(
  base32Secret: string,
  submittedCode: string,
  timestampMs = Date.now(),
): { valid: boolean; matchedStep: number | null } {
  const normalized = submittedCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return { valid: false, matchedStep: null };
  }
  const currentStep = Math.floor(timestampMs / 1000 / 30);
  const submittedBuf = Buffer.from(normalized, 'utf8');
  for (const offset of [0, -1, 1]) {
    const candidateStep = currentStep + offset;
    const expected = computeTotpAtStep(base32Secret, candidateStep);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (crypto.timingSafeEqual(submittedBuf, expectedBuf)) {
      return { valid: true, matchedStep: candidateStep };
    }
  }
  return { valid: false, matchedStep: null };
}

// ==================== Strict Input Validation & Sanitization ====================

const DANGEROUS_TEXT_REGEX = /<\s*\/?\s*(script|iframe|object|embed|svg|img)|javascript:|on\w+\s*=/i;

export function hasPrototypePollutionKeys(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => hasPrototypePollutionKeys(v));
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (hasPrototypePollutionKeys((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

export function validateSafeText(
  raw: unknown,
  fieldLabelTh: string,
  minLen: number,
  maxLen: number,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: `กรุณาระบุ${fieldLabelTh}เป็นข้อความ` };
  }
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (cleaned.length < minLen || cleaned.length > maxLen) {
    return {
      ok: false,
      error: `${fieldLabelTh}ต้องมีความยาวระหว่าง ${minLen} ถึง ${maxLen} ตัวอักษร`,
    };
  }
  if (DANGEROUS_TEXT_REGEX.test(cleaned) || cleaned.includes('<') || cleaned.includes('>')) {
    return {
      ok: false,
      error: `${fieldLabelTh}มีอักขระหรือโค้ดต้องห้ามด้านความปลอดภัยไซเบอร์`,
    };
  }
  return { ok: true, value: cleaned };
}

function validateScoreRange(val: unknown, label: string): { ok: true; num: number } | { ok: false; error: string } {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return { ok: false, error: `ค่าคะแนน ${label} ต้องเป็นตัวเลขที่ถูกต้อง` };
  }
  if (val < 1.0 || val > 5.0) {
    return { ok: false, error: `ค่าคะแนน ${label} ต้องอยู่ในช่วง 1.00 ถึง 5.00 เท่านั้น` };
  }
  return { ok: true, num: Math.round((val + Number.EPSILON) * 100) / 100 };
}

export function validateDistrictMetricsPayload(
  raw: unknown,
  coastalZone: 'andaman' | 'gulf' | 'inland',
): { ok: true; metrics: DistrictMetricsPayload } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'โครงสร้างข้อมูลตัวชี้วัดไม่ถูกต้อง' };
  }
  const obj = raw as Record<string, unknown>;
  const rawHazards = obj.hazards as Record<string, unknown> | undefined;
  const rawE = obj.exposureIndicators as Record<string, unknown> | undefined;
  const rawV = obj.vulnerabilityIndicators as Record<string, unknown> | undefined;
  const rawC = obj.capacityIndicators as Record<string, unknown> | undefined;

  if (!rawHazards || !rawE || !rawV || !rawC) {
    return { ok: false, error: 'ข้อมูลไม่ครบทั้ง 4 ปัจจัย (ภัยคุกคาม ความล่อแหลม ความเปราะบาง และศักยภาพ)' };
  }

  const hazards = {} as Record<HazardId, number | null>;
  for (const hId of HAZARD_IDS) {
    const val = rawHazards[hId];
    if (hId === 'tsunami_coastal' && coastalZone === 'inland') {
      if (val !== null && val !== undefined) {
        return {
          ok: false,
          error: 'จังหวัดไร้ชายฝั่งทะเลเปิดต้องคงค่าภัยสึนามิและภัยชายฝั่งเป็น N/A (null)',
        };
      }
      hazards[hId] = null;
    } else {
      const checked = validateScoreRange(val, hId);
      if (!checked.ok) return checked;
      hazards[hId] = checked.num;
    }
  }

  const exposureIndicators = {} as Record<ExposureIndicatorId, number>;
  for (const ind of EXPOSURE_INDICATORS) {
    const checked = validateScoreRange(rawE[ind.id], ind.shortNameTh);
    if (!checked.ok) return checked;
    exposureIndicators[ind.id] = checked.num;
  }

  const vulnerabilityIndicators = {} as Record<VulnerabilityIndicatorId, number>;
  for (const ind of VULNERABILITY_INDICATORS) {
    const checked = validateScoreRange(rawV[ind.id], ind.shortNameTh);
    if (!checked.ok) return checked;
    vulnerabilityIndicators[ind.id] = checked.num;
  }

  const capacityIndicators = {} as Record<CapacityIndicatorId, number>;
  for (const ind of CAPACITY_INDICATORS) {
    const checked = validateScoreRange(rawC[ind.id], ind.shortNameTh);
    if (!checked.ok) return checked;
    capacityIndicators[ind.id] = checked.num;
  }

  return {
    ok: true,
    metrics: {
      hazards,
      exposureIndicators,
      vulnerabilityIndicators,
      capacityIndicators,
    },
  };
}

// ==================== Cookie Helpers ====================

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}
