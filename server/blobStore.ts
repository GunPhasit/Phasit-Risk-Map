import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getStore } from '@netlify/blobs';
import type { StorageMode } from '../src/types/governance.ts';

export const BLOB_STORE_NAME = 'ddpm-risk-db';
export const BLOB_DB_KEY = 'ddpm_risk_v1.sqlite';
export const BLOB_MASTER_KEY = 'ddpm-master-key-v1';

export interface BlobWriteResult {
  readonly etag?: string;
  readonly modified: boolean;
}

export interface BlobSnapshotStore {
  getBytesWithMetadata(
    key: string,
  ): Promise<{ data: Buffer; etag?: string } | null>;
  getText(key: string): Promise<string | null>;
  getMetadata(key: string): Promise<{ etag?: string } | null>;
  setBytes(
    key: string,
    data: Buffer,
    options?: { onlyIfNew?: boolean; onlyIfMatch?: string },
  ): Promise<BlobWriteResult>;
  setText(
    key: string,
    text: string,
    options?: { onlyIfNew?: boolean; onlyIfMatch?: string },
  ): Promise<BlobWriteResult>;
}

/**
 * สร้างตัวเชื่อมต่อ Netlify Blobs (Strong Consistency) เฉพาะเมื่อรันบนสภาพแวดล้อม Netlify
 * หากอยู่นอก Netlify (เครื่องพัฒนาในเครื่อง / Vitest) จะคืนค่า null อย่างปลอดภัย
 */
export function createNetlifyBlobStore(): BlobSnapshotStore | null {
  const hasNetlifyContext =
    typeof globalThis.netlifyBlobsContext !== 'undefined' ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN);

  if (!hasNetlifyContext) {
    return null;
  }

  try {
    const store = getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
    return {
      async getBytesWithMetadata(key: string) {
        const res = await store.getWithMetadata(key, {
          type: 'arrayBuffer',
          consistency: 'strong',
        });
        if (!res || !res.data) return null;
        return {
          data: Buffer.from(res.data),
          etag: res.etag,
        };
      },
      async getText(key: string) {
        const val = await store.get(key, { type: 'text', consistency: 'strong' });
        return typeof val === 'string' ? val : null;
      },
      async getMetadata(key: string) {
        const meta = await store.getMetadata(key, { consistency: 'strong' });
        if (!meta) return null;
        return { etag: meta.etag };
      },
      async setBytes(key: string, data: Buffer, options) {
        const ab = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const result = options?.onlyIfMatch
          ? await store.set(key, ab, { onlyIfMatch: options.onlyIfMatch })
          : options?.onlyIfNew
            ? await store.set(key, ab, { onlyIfNew: true })
            : await store.set(key, ab);
        return { etag: result.etag, modified: result.modified };
      },
      async setText(key: string, text: string, options) {
        const result = options?.onlyIfMatch
          ? await store.set(key, text, { onlyIfMatch: options.onlyIfMatch })
          : options?.onlyIfNew
            ? await store.set(key, text, { onlyIfNew: true })
            : await store.set(key, text);
        return { etag: result.etag, modified: result.modified };
      },
    };
  } catch (err) {
    console.warn('[DDPM BlobStore] Falling back to ephemeral SQLite:', err);
    return null;
  }
}

export class BlobSyncConflictError extends Error {
  constructor(message = 'ข้อมูลบนเซิร์ฟเวอร์ถูกอัปเดตโดยรายการอื่นพร้อมกัน กรุณารีเฟรชแล้วลองใหม่') {
    super(message);
    this.name = 'BlobSyncConflictError';
  }
}

/**
 * ตัวประสานความคงทนของ SQLite ร่วมกับ Netlify Blobs:
 * 1. จัดเก็บ Master Key ใน Blobs (เมื่อไม่ได้ตั้ง DDPM_MASTER_KEY) ป้องกันคีย์ TOTP ถอดรหัสไม่ได้ข้าม Cold Start
 * 2. ดึงสแนปช็อตฐานข้อมูลตอน Cold Start และตรวจ ETag เมื่อ Warm Instance อ่าน/เขียน
 * 3. ใช้ Async Mutex ป้องกันการเขียนซ้อนใน Instance เดียว และใช้ onlyIfMatch/onlyIfNew ป้องกันเขียนทับข้าม Instance
 */
export class BlobDatabaseCoordinator {
  private readonly store: BlobSnapshotStore;
  private readonly localDbPath: string;
  private loadedEtag: string | null = null;
  private lastMetadataCheckMs = 0;
  private lockTail: Promise<void> = Promise.resolve();
  private cachedMasterKey: Buffer | null = null;

  constructor(store: BlobSnapshotStore, localDbPath: string) {
    this.store = store;
    this.localDbPath = localDbPath;
  }

  public get storageMode(): StorageMode {
    return 'netlify-blobs-sqlite';
  }

  public get currentEtag(): string | null {
    return this.loadedEtag;
  }

  public async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  public async resolvePersistentMasterKey(): Promise<Buffer> {
    if (this.cachedMasterKey) return this.cachedMasterKey;

    const envKey = process.env.DDPM_MASTER_KEY;
    if (envKey && envKey.length >= 32) {
      this.cachedMasterKey = crypto.createHash('sha256').update(envKey, 'utf8').digest();
      return this.cachedMasterKey;
    }
    if (process.env.DDPM_STRICT_PROD === 'true') {
      throw new Error('DDPM_MASTER_KEY (>= 32 characters) is required when DDPM_STRICT_PROD=true');
    }

    const existing = await this.store.getText(BLOB_MASTER_KEY);
    if (existing && /^[0-9a-f]{64}$/i.test(existing.trim())) {
      this.cachedMasterKey = Buffer.from(existing.trim(), 'hex');
      return this.cachedMasterKey;
    }

    const freshHex = crypto.randomBytes(32).toString('hex');
    const writeRes = await this.store.setText(BLOB_MASTER_KEY, freshHex, { onlyIfNew: true });
    if (writeRes.modified) {
      this.cachedMasterKey = Buffer.from(freshHex, 'hex');
      return this.cachedMasterKey;
    }

    // หากอีก Instance สร้างคีย์ตัดหน้าไปก่อน ให้ดึงคีย์ของตัวที่ชนะมาใช้ตรงกัน
    const winner = await this.store.getText(BLOB_MASTER_KEY);
    if (winner && /^[0-9a-f]{64}$/i.test(winner.trim())) {
      this.cachedMasterKey = Buffer.from(winner.trim(), 'hex');
      return this.cachedMasterKey;
    }

    this.cachedMasterKey = Buffer.from(freshHex, 'hex');
    return this.cachedMasterKey;
  }

  private removeSqliteSidecars(): void {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${this.localDbPath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        try {
          fs.unlinkSync(sidecar);
        } catch {
          // ข้ามหากถูกลบแล้ว
        }
      }
    }
  }

  private writeAtomicLocalDb(bytes: Buffer): void {
    fs.mkdirSync(path.dirname(this.localDbPath), { recursive: true });
    this.removeSqliteSidecars();
    const tmpPath = `${this.localDbPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, bytes);
    fs.renameSync(tmpPath, this.localDbPath);
  }

  /**
   * ดาวน์โหลดสแนปช็อตฐานข้อมูลจาก Blobs ตอนเริ่มต้น (ถ้ามีอยู่แล้ว)
   * คืนค่า true หากพบฐานข้อมูลเดิมและดาวน์โหลดสำเร็จ
   */
  public async hydrateFromRemote(): Promise<boolean> {
    const snap = await this.store.getBytesWithMetadata(BLOB_DB_KEY);
    this.lastMetadataCheckMs = Date.now();
    if (!snap || snap.data.length === 0) {
      this.loadedEtag = null;
      return false;
    }
    this.writeAtomicLocalDb(snap.data);
    this.loadedEtag = snap.etag ?? null;
    return true;
  }

  /**
   * ตรวจ ETag ล่าสุดจาก Blobs หากมี Instance อื่นอัปเดตฐานข้อมูลไปแล้ว จะคืนค่า true เพื่อให้ผู้เรียกปิด-รีโหลด SQLite
   */
  public async syncIfRemoteChanged(forceCheck: boolean): Promise<boolean> {
    const now = Date.now();
    if (!forceCheck && now - this.lastMetadataCheckMs < 2000) {
      return false;
    }
    const meta = await this.store.getMetadata(BLOB_DB_KEY);
    this.lastMetadataCheckMs = now;
    if (!meta?.etag) return false;
    if (meta.etag === this.loadedEtag) return false;

    const snap = await this.store.getBytesWithMetadata(BLOB_DB_KEY);
    if (!snap || snap.data.length === 0) return false;
    this.writeAtomicLocalDb(snap.data);
    this.loadedEtag = snap.etag ?? meta.etag;
    return true;
  }

  /**
   * อัปโหลดไฟล์ SQLite (หลังปิดหรือ checkpoint สมบูรณ์แล้ว) ขึ้น Netlify Blobs แบบป้องกันการเขียนทับด้วย ETag
   */
  public async uploadLocalSnapshot(): Promise<void> {
    if (!fs.existsSync(this.localDbPath)) return;
    const bytes = fs.readFileSync(this.localDbPath);
    const result = this.loadedEtag
      ? await this.store.setBytes(BLOB_DB_KEY, bytes, { onlyIfMatch: this.loadedEtag })
      : await this.store.setBytes(BLOB_DB_KEY, bytes, { onlyIfNew: true });

    if (!result.modified) {
      // โหลดเวอร์ชันล่าสุดจาก Blobs กลับมาเตรียมไว้สำหรับการลองใหม่ครั้งถัดไป
      await this.hydrateFromRemote();
      throw new BlobSyncConflictError();
    }
    this.loadedEtag = result.etag ?? this.loadedEtag;
    this.lastMetadataCheckMs = Date.now();
  }
}
