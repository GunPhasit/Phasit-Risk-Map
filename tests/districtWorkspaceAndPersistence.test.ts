import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRiskApiServer, type RiskApiServerHandle } from '../server/app.ts';
import {
  BlobDatabaseCoordinator,
  BlobSyncConflictError,
  type BlobSnapshotStore,
} from '../server/blobStore.ts';
import { computeCurrentTotp } from '../server/security.ts';
import type {
  DistrictCatalogSummaryItem,
  DistrictEvaluation,
  ProvinceProgressResponse,
} from '../src/types/index.ts';

function createInMemoryBlobStore(): BlobSnapshotStore {
  const bytesMap = new Map<string, { data: Buffer; etag: string }>();
  const textMap = new Map<string, { text: string; etag: string }>();
  let seq = 1;
  const nextEtag = () => `etag-${seq++}`;

  return {
    async getBytesWithMetadata(key) {
      const item = bytesMap.get(key);
      if (!item) return null;
      return { data: Buffer.from(item.data), etag: item.etag };
    },
    async getText(key) {
      return textMap.get(key)?.text ?? null;
    },
    async getMetadata(key) {
      const item = bytesMap.get(key);
      return item ? { etag: item.etag } : null;
    },
    async setBytes(key, data, options) {
      const existing = bytesMap.get(key);
      if (options?.onlyIfNew && existing) {
        return { modified: false };
      }
      if (options?.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) {
        return { modified: false };
      }
      const etag = nextEtag();
      bytesMap.set(key, { data: Buffer.from(data), etag });
      return { modified: true, etag };
    },
    async setText(key, text, options) {
      const existing = textMap.get(key);
      if (options?.onlyIfNew && existing) {
        return { modified: false };
      }
      if (options?.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) {
        return { modified: false };
      }
      const etag = nextEtag();
      textMap.set(key, { text, etag });
      return { modified: true, etag };
    },
  };
}

describe('All-928-District Lazy Demo Provisioning, Maker-Checker Hardening, Large-Jump Guardrail & Blob Persistence', () => {
  let demoHandle: RiskApiServerHandle;
  let strictHandle: RiskApiServerHandle;

  beforeAll(() => {
    demoHandle = createRiskApiServer({
      dbPath: ':memory:',
      staticDir: null,
      demoMode: true,
      storageMode: 'ephemeral-sqlite',
    });
    strictHandle = createRiskApiServer({
      dbPath: ':memory:',
      staticDir: null,
      demoMode: false,
      storageMode: 'local-sqlite',
    });
  });

  afterAll(async () => {
    await demoHandle.close();
    await strictHandle.close();
  });

  async function loginDemoUser(
    handle: RiskApiServerHandle,
    username: string,
    password: string,
  ): Promise<{ cookie: string; csrfToken: string }> {
    const s1 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username, password },
    });
    expect(s1.status).toBe(200);
    const s1Json = s1.json<{ challengeToken: string; demoTotpCode?: string }>();
    const secret = handle.db.getUserTotpSecretForTest(username)!;
    const code = s1Json.demoTotpCode ?? computeCurrentTotp(secret);
    const s2 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/verify-totp',
      body: { challengeToken: s1Json.challengeToken, code },
    });
    expect(s2.status).toBe(200);
    const cookie = (s2.getHeader('set-cookie') ?? '').split(';')[0];
    const { csrfToken } = s2.json<{ csrfToken: string }>();
    return { cookie, csrfToken };
  }

  it('serves health storageMode, all 928 districts catalog, and parameterized district search', async () => {
    const healthRes = await demoHandle.invoke({ url: '/api/public/health' });
    expect(healthRes.status).toBe(200);
    const health = healthRes.json<{ storageMode: string; districts: number; demoMode: boolean }>();
    expect(health.storageMode).toBe('ephemeral-sqlite');
    expect(health.districts).toBe(928);
    expect(health.demoMode).toBe(true);

    const catRes = await demoHandle.invoke({ url: '/api/public/districts-catalog?period=2569-Q3' });
    expect(catRes.status).toBe(200);
    const catJson = catRes.json<{ districts: DistrictCatalogSummaryItem[] }>();
    expect(catJson.districts).toHaveLength(928);
    expect(catJson.districts.some((d) => d.code === '5709' && d.fullNameTh.includes('แม่สาย'))).toBe(true);

    const searchRes = await demoHandle.invoke({
      url: `/api/public/districts?province=57&q=${encodeURIComponent('แม่สาย')}`,
    });
    expect(searchRes.status).toBe(200);
    const searchJson = searchRes.json<{ districts: DistrictCatalogSummaryItem[] }>();
    expect(searchJson.districts.some((d) => d.code === '5709')).toBe(true);
  });

  it('lazy-provisions any of 928 am_XXXX & 77 pv_XX ONLY in demoMode, blocks wrong password row insertion, and enforces strict ABAC + all-role Maker-Checker', async () => {
    // 1. ในโหมดเข้มงวด (demoMode=false) ห้ามสร้างบัญชี am_5709 อัตโนมัติเด็ดขาด
    const strictAttempt = await strictHandle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'am_5709', password: 'Ddpm@5709#2569' },
    });
    expect(strictAttempt.status).toBe(401);
    expect(strictHandle.db.getUserTotpSecretForTest('am_5709')).toBeNull();

    // 2. รหัสผ่านผิดในโหมดสาธิตต้องไม่สร้างแถวผู้ใช้ขยะในฐานข้อมูล
    const wrongPw = await demoHandle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'am_5709', password: 'WrongPassword#123' },
    });
    expect(wrongPw.status).toBe(401);
    expect(demoHandle.db.getUserTotpSecretForTest('am_5709')).toBeNull();

    // 3. เข้าระบบ อ.แม่สาย (am_5709) และ ปภ.เชียงราย (pv_57) และ ปภ.เชียงใหม่ (pv_50) ในโหมดสาธิต
    const am5709 = await loginDemoUser(demoHandle, 'am_5709', 'Ddpm@5709#2569');
    const pv57 = await loginDemoUser(demoHandle, 'pv_57', 'Ddpm@Prov57#2569');
    const pv50 = await loginDemoUser(demoHandle, 'pv_50', 'Ddpm@Prov50#2569');

    const d5709 = (await demoHandle.invoke({ url: '/api/public/districts/5709?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();

    // 4. Cross-District IDOR: am_5709 พยายามแก้ อ.เมืองเชียงราย (5701) -> ต้องถูกบล็อก 403
    const idor = await demoHandle.invoke({
      method: 'POST',
      url: '/api/districts/5701/submissions',
      headers: { Cookie: am5709.cookie, 'X-CSRF-Token': am5709.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: d5709.district.metrics,
        reasonTh: 'พยายามแก้ไขข้อมูลข้ามอำเภอในจังหวัดเชียงราย',
        referenceDoc: 'TEST-IDOR',
      },
    });
    expect(idor.status).toBe(403);

    // 5. Large-Jump Guardrail: เปลี่ยนค่า >= 1.50 โดยไม่แนบเอกสารอ้างอิง -> 400
    const jumpVal = d5709.district.metrics.capacityIndicators.c_cell_broadcast >= 3.0 ? 1.1 : 4.95;
    const bigJumpNoRef = await demoHandle.invoke({
      method: 'POST',
      url: '/api/districts/5709/submissions',
      headers: { Cookie: am5709.cookie, 'X-CSRF-Token': am5709.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: {
          ...d5709.district.metrics,
          capacityIndicators: {
            ...d5709.district.metrics.capacityIndicators,
            c_cell_broadcast: jumpVal,
          },
        },
        reasonTh: 'สั้นเกินไป',
        referenceDoc: '',
      },
    });
    expect(bigJumpNoRef.status).toBe(400);

    // 6. ส่งคำขอพร้อมเหตุผลและเอกสารอ้างอิงครบถ้วน -> 201
    const okSubmit = await demoHandle.invoke({
      method: 'POST',
      url: '/api/districts/5709/submissions',
      headers: { Cookie: am5709.cookie, 'X-CSRF-Token': am5709.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: {
          ...d5709.district.metrics,
          capacityIndicators: {
            ...d5709.district.metrics.capacityIndicators,
            c_cell_broadcast: jumpVal,
          },
        },
        reasonTh: 'ปรับปรุงข้อมูลหลังตรวจวัดความครอบคลุมสัญญาณ Cell Broadcast ครบทุกตำบลในอำเภอแม่สาย',
        referenceDoc: 'ชร 0021.4/ว 109',
      },
    });
    expect(okSubmit.status).toBe(201);
    const { request: createdReq } = okSubmit.json<{ request: { id: number } }>();

    // 7. pv_50 (ต่างจังหวัด) อนุมัติไม่ได้ -> 403, pv_57 (จังหวัดเดียวกัน) อนุมัติได้ -> 200
    const wrongProvApprove = await demoHandle.invoke({
      method: 'POST',
      url: `/api/change-requests/${createdReq.id}/review`,
      headers: { Cookie: pv50.cookie, 'X-CSRF-Token': pv50.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'พยายามอนุมัติข้ามจังหวัด' },
    });
    expect(wrongProvApprove.status).toBe(403);

    const rightProvApprove = await demoHandle.invoke({
      method: 'POST',
      url: `/api/change-requests/${createdReq.id}/review`,
      headers: { Cookie: pv57.cookie, 'X-CSRF-Token': pv57.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'ตรวจสอบเอกสารอ้างอิงแล้ว อนุมัติประกาศใช้' },
    });
    expect(rightProvApprove.status).toBe(200);

    // 8. All-Role Maker-Checker: pv_57 ส่งคำขอเองแล้วพยายามอนุมัติเอง -> ต้องถูกบล็อก 403!
    const pvSelfSubmit = await demoHandle.invoke({
      method: 'POST',
      url: '/api/districts/5709/submissions',
      headers: { Cookie: pv57.cookie, 'X-CSRF-Token': pv57.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: {
          ...d5709.district.metrics,
          capacityIndicators: {
            ...d5709.district.metrics.capacityIndicators,
            c_ddpm_training: 4.4,
          },
        },
        reasonTh: 'บันทึกผลฝึกอบรม อปพร. ประจำปีในอำเภอแม่สายเพื่อรอผู้ตรวจสอบท่านอื่นอนุมัติ',
        referenceDoc: 'ชร 0021.4/ว 210',
      },
    });
    expect(pvSelfSubmit.status).toBe(201);
    const pvReqId = pvSelfSubmit.json<{ request: { id: number } }>().request.id;

    const pvSelfApprove = await demoHandle.invoke({
      method: 'POST',
      url: `/api/change-requests/${pvReqId}/review`,
      headers: { Cookie: pv57.cookie, 'X-CSRF-Token': pv57.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'อนุมัติคำขอที่ตนส่งเอง' },
    });
    expect(pvSelfApprove.status).toBe(403);

    // 9. ตรวจ /api/officer/province-progress ต้องเห็นเฉพาะจังหวัดของตน และนับอำเภอที่อัปเดตได้ถูกต้อง
    const progRes = await demoHandle.invoke({
      url: '/api/officer/province-progress?period=2569-Q3',
      headers: { Cookie: pv57.cookie },
    });
    expect(progRes.status).toBe(200);
    const prog = progRes.json<ProvinceProgressResponse>();
    expect(prog.provinces).toHaveLength(1);
    expect(prog.provinces[0].provinceCode).toBe('57');
    expect(prog.updatedDistricts).toBeGreaterThanOrEqual(1);
    expect(prog.pendingDistricts).toBeGreaterThanOrEqual(1);

    // สายโซ่ SHA-256 ต้องสมบูรณ์ 100%
    expect(demoHandle.db.verifyAuditChain().valid).toBe(true);
  });

  it('persists SQLite snapshot and Master Key across cold starts via BlobDatabaseCoordinator and detects ETag conflicts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddpm-blob-test-'));
    const dbPathA = path.join(tmpDir, 'instA.sqlite');
    const dbPathB = path.join(tmpDir, 'instB.sqlite');
    const store = createInMemoryBlobStore();

    try {
      // Cold Start #1 (Instance A): สร้าง Master Key + Seed SQLite + อัปโหลดขึ้น Blob
      const coordA = new BlobDatabaseCoordinator(store, dbPathA);
      const keyA = await coordA.resolvePersistentMasterKey();
      expect(await coordA.hydrateFromRemote()).toBe(false);

      const handleA = createRiskApiServer({
        dbPath: dbPathA,
        staticDir: null,
        demoMode: true,
        masterKey: keyA,
        journalMode: 'DELETE',
        storageMode: 'netlify-blobs-sqlite',
      });
      // สร้างบัญชี lazy am_3802 บน Instance A แล้วอัปโหลดสแนปช็อต
      await loginDemoUser(handleA, 'am_3802', 'Ddpm@3802#2569');
      handleA.closeDb();
      await coordA.uploadLocalSnapshot();
      handleA.reloadDb();

      // Cold Start #2 (Instance B): โหลด Master Key + SQLite จาก Blob ต้องถอดรหัส TOTP ของ am_3802 ได้โดยไม่ 500!
      const coordB = new BlobDatabaseCoordinator(store, dbPathB);
      const keyB = await coordB.resolvePersistentMasterKey();
      expect(keyB.equals(keyA)).toBe(true);
      expect(await coordB.hydrateFromRemote()).toBe(true);

      const handleB = createRiskApiServer({
        dbPath: dbPathB,
        staticDir: null,
        demoMode: true,
        masterKey: keyB,
        journalMode: 'DELETE',
        storageMode: 'netlify-blobs-sqlite',
      });
      const secretOnB = handleB.db.getUserTotpSecretForTest('am_3802');
      expect(secretOnB).toBeTruthy();

      // Instance B เขียนและอัปโหลดก่อน -> ETag เปลี่ยน -> Instance A พยายามอัปโหลดด้วย ETag เก่าต้องโยน BlobSyncConflictError
      handleB.closeDb();
      await coordB.uploadLocalSnapshot();
      handleB.reloadDb();

      handleA.closeDb();
      await expect(coordA.uploadLocalSnapshot()).rejects.toBeInstanceOf(BlobSyncConflictError);

      await handleA.close();
      await handleB.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
