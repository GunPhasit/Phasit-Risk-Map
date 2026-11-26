import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRiskApiServer, type RiskApiServerHandle } from '../server/app.ts';
import { DEMO_ACCOUNTS_SEED } from '../server/database.ts';
import { computeCurrentTotp } from '../server/security.ts';
import { evaluateAllProvinces } from '../src/domain/riskCalculator.ts';
import type { DistrictEvaluation, DistrictMetricsPayload, ProvinceRiskRecord } from '../src/types/index.ts';

interface AuthClientSession {
  cookie: string;
  csrfToken: string;
  username: string;
}

describe('Temporal 928-District Database & Government Cybersecurity Suite', () => {
  let handle: RiskApiServerHandle;

  beforeAll(() => {
    handle = createRiskApiServer({
      dbPath: ':memory:',
      staticDir: null,
      demoMode: false, // ทดสอบโหมดเข้มงวด Production-like (ไม่ส่ง demoTotpCode ใน response)
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  async function loginAs(username: string, stepOffsetSec = 0): Promise<AuthClientSession> {
    const seed = DEMO_ACCOUNTS_SEED.find((a) => a.username === username);
    if (!seed) throw new Error(`Unknown seed user ${username}`);

    const step1 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: seed.username, password: seed.password },
    });
    expect(step1.status).toBe(200);
    // โหมด demoMode=false ต้องไม่รั่วไหลรหัส TOTP ออกมา และยังต้องไม่ set session cookie ในขั้นที่ 1
    expect(step1.getHeader('set-cookie')).toBeNull();
    const s1Json = step1.json<{ mfaRequired: boolean; challengeToken: string; demoTotpCode?: string }>();
    expect(s1Json.mfaRequired).toBe(true);
    expect(s1Json.demoTotpCode).toBeUndefined();

    const secret = handle.db.getUserTotpSecretForTest(username)!;
    const code = computeCurrentTotp(secret, Date.now() + stepOffsetSec * 1000);

    const step2 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/verify-totp',
      body: { challengeToken: s1Json.challengeToken, code },
    });
    expect(step2.status).toBe(200);
    const setCookie = step2.getHeader('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    const cookiePair = setCookie.split(';')[0];
    const s2Json = step2.json<{ authenticated: boolean; csrfToken: string }>();
    expect(s2Json.authenticated).toBe(true);
    expect(s2Json.csrfToken.length).toBeGreaterThanOrEqual(32);

    return { cookie: cookiePair, csrfToken: s2Json.csrfToken, username };
  }

  it('seeds 77 provinces, 928 districts, 4 temporal periods with 5-color calibration and PDPA zero-cookie public routes', async () => {
    const healthRes = await handle.invoke({ url: '/api/public/health' });
    expect(healthRes.status).toBe(200);
    expect(healthRes.getHeader('set-cookie')).toBeNull();
    expect(healthRes.getHeader('x-frame-options')).toBe('DENY');
    expect(healthRes.getHeader('x-content-type-options')).toBe('nosniff');
    expect(healthRes.getHeader('content-security-policy')).toContain("default-src 'self'");
    const health = healthRes.json<{ provinces: number; districts: number; periods: number }>();
    expect(health.provinces).toBe(77);
    expect(health.districts).toBe(928);
    expect(health.periods).toBe(4);

    // ตรวจการรวมคะแนน 928 อำเภอขึ้นเป็น 77 จังหวัดในงวดปัจจุบันว่ายังคงกระจายครบ 5 สี
    const provRes = await handle.invoke({ url: '/api/public/provinces?period=2569-Q3' });
    expect(provRes.status).toBe(200);
    expect(provRes.getHeader('set-cookie')).toBeNull();
    const provJson = provRes.json<{ provinces: ProvinceRiskRecord[] }>();
    expect(provJson.provinces).toHaveLength(77);

    const evals = evaluateAllProvinces(provJson.provinces, 'R', 'composite', 'ddpm64');
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const e of evals) {
      if (e.level) counts[e.level] += 1;
    }
    expect(counts[1]).toBeGreaterThanOrEqual(4);
    expect(counts[2]).toBeGreaterThanOrEqual(8);
    expect(counts[3]).toBeGreaterThanOrEqual(15);
    expect(counts[4]).toBeGreaterThanOrEqual(10);
    expect(counts[5]).toBeGreaterThanOrEqual(4);

    // ตรวจรายอำเภอบึงกาฬ (8 อำเภอ) และ กทม. (50 เขต) + กราฟแนวโน้มย้อนหลัง
    const bkRes = await handle.invoke({ url: '/api/public/provinces/38/districts?period=2569-Q3' });
    expect(bkRes.json<{ districts: DistrictEvaluation[] }>().districts).toHaveLength(8);

    const bkkRes = await handle.invoke({ url: '/api/public/provinces/10/districts?period=2569-Q3' });
    expect(bkkRes.json<{ districts: DistrictEvaluation[] }>().districts).toHaveLength(50);

    const trendRes = await handle.invoke({ url: '/api/public/provinces/50/trend' });
    const trendJson = trendRes.json<{ trend: Array<{ periodId: string; capacityScore: number }> }>();
    expect(trendJson.trend).toHaveLength(4);
    expect(trendJson.trend[3].capacityScore).toBeGreaterThan(trendJson.trend[0].capacityScore);
  });

  it('blocks unauthenticated requests, rejects TOTP replay, and locks brute-force login after 5 failures', async () => {
    const unauth = await handle.invoke({ url: '/api/officer/scope' });
    expect(unauth.status).toBe(401);

    // ลองยิงรหัสผ่านผิด 5 ครั้งสำหรับ am_8301 -> ครั้งที่ 5 ต้องได้ 429 Lockout
    for (let i = 1; i <= 5; i += 1) {
      const res = await handle.invoke({
        method: 'POST',
        url: '/api/auth/login',
        body: { username: 'am_8301', password: `WrongPass#${i}` },
      });
      if (i < 5) expect(res.status).toBe(401);
      else expect(res.status).toBe(429);
    }

    // ทดสอบ Replay Protection ของ TOTP สำหรับ am_3801
    const s1 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'am_3801', password: DEMO_ACCOUNTS_SEED[3].password },
    });
    const { challengeToken: tok1 } = s1.json<{ challengeToken: string }>();
    const secret = handle.db.getUserTotpSecretForTest('am_3801')!;
    const currentCode = computeCurrentTotp(secret);

    const ok1 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/verify-totp',
      body: { challengeToken: tok1, code: currentCode },
    });
    expect(ok1.status).toBe(200);

    // นำรหัส 6 หลักเดิมมาใช้ซ้ำในรอบ 30 วินาทีเดียวกัน -> ต้องโดนบล็อก 401
    const s2 = await handle.invoke({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'am_3801', password: DEMO_ACCOUNTS_SEED[3].password },
    });
    const { challengeToken: tok2 } = s2.json<{ challengeToken: string }>();
    const replay = await handle.invoke({
      method: 'POST',
      url: '/api/auth/verify-totp',
      body: { challengeToken: tok2, code: currentCode },
    });
    expect(replay.status).toBe(401);
  });

  it('strictly enforces District-Scoped ABAC (blocks cross-district & cross-province IDOR, self-approval, and cross-province review)', async () => {
    const am5001 = await loginAs('am_5001'); // อ.เมืองเชียงใหม่ (5001)
    const pv50 = await loginAs('pv_50'); // ปภ.จังหวัดเชียงใหม่ (50)
    const pv10 = await loginAs('pv_10'); // ปภ.กรุงเทพมหานคร (10)

    const d5001Before = (await handle.invoke({ url: '/api/public/districts/5001?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();
    const d5007Before = (await handle.invoke({ url: '/api/public/districts/5007?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();

    const mutatedMetrics: DistrictMetricsPayload = {
      ...d5001Before.district.metrics,
      capacityIndicators: {
        ...d5001Before.district.metrics.capacityIndicators,
        c_cell_broadcast: 4.95,
        c_ddpm_training: 4.85,
        c_eoc_machinery: 5.0,
      },
    };

    // 1. Cross-District IDOR ภายในจังหวัดเดียวกัน: am_5001 พยายามแก้ อ.แม่ริม (5007) -> ต้อง 403!
    const idorSameProv = await handle.invoke({
      method: 'POST',
      url: '/api/districts/5007/submissions',
      headers: { Cookie: am5001.cookie, 'X-CSRF-Token': am5001.csrfToken },
      body: {
        periodId: '2569-Q3',
        role: 'ddpm_central_admin',
        districtCode: '5001',
        metrics: mutatedMetrics,
        reasonTh: 'พยายามเจาะสิทธิ์ข้ามอำเภอภายในจังหวัดเดียวกัน',
        referenceDoc: 'ATTACK-1',
      },
    });
    expect(idorSameProv.status).toBe(403);

    // 2. Cross-Province IDOR: am_5001 พยายามแก้ เขตพระนคร กทม. (1001) -> ต้อง 403!
    const idorOtherProv = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: { Cookie: am5001.cookie, 'X-CSRF-Token': am5001.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: mutatedMetrics,
        reasonTh: 'พยายามเจาะสิทธิ์ข้ามจังหวัดไปยังกรุงเทพมหานคร',
        referenceDoc: 'ATTACK-2',
      },
    });
    expect(idorOtherProv.status).toBe(403);

    // ยืนยันว่าข้อมูล อ.แม่ริม (5007) ไม่ถูกแตะต้องแม้แต่นิดเดียว
    const d5007Check = (await handle.invoke({ url: '/api/public/districts/5007?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();
    expect(d5007Check.district.metrics).toEqual(d5007Before.district.metrics);

    // 3. แก้ไขข้อมูลในเขตอำเภอของตนเอง (5001) -> ต้องสำเร็จ 201!
    const validSubmit = await handle.invoke({
      method: 'POST',
      url: '/api/districts/5001/submissions',
      headers: { Cookie: am5001.cookie, 'X-CSRF-Token': am5001.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: mutatedMetrics,
        reasonTh: 'ปรับปรุงข้อมูลหลังขยายเสาสัญญาณ Cell Broadcast และฝึกอบรม อปพร. ครบทุกตำบล',
        referenceDoc: 'ชม 0021.1/ว 2999',
      },
    });
    expect(validSubmit.status).toBe(201);
    const { request: createdReq } = validSubmit.json<{ request: { id: number; status: string } }>();
    expect(createdReq.status).toBe('pending');

    // 4. Privilege Escalation: am_5001 พยายามอนุมัติคำขอของตนเอง -> ต้อง 403!
    const selfApprove = await handle.invoke({
      method: 'POST',
      url: `/api/change-requests/${createdReq.id}/review`,
      headers: { Cookie: am5001.cookie, 'X-CSRF-Token': am5001.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'อนุมัติเอง' },
    });
    expect(selfApprove.status).toBe(403);

    // 5. Cross-Province Reviewer Isolation: pv_10 (กทม.) พยายามอนุมัติคำขอของ จ.เชียงใหม่ -> ต้อง 403!
    const crossProvApprove = await handle.invoke({
      method: 'POST',
      url: `/api/change-requests/${createdReq.id}/review`,
      headers: { Cookie: pv10.cookie, 'X-CSRF-Token': pv10.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'อนุมัติข้ามจังหวัด' },
    });
    expect(crossProvApprove.status).toBe(403);

    // 6. เจ้าหน้าที่ ปภ.จังหวัดเชียงใหม่ (pv_50) อนุมัติจริง -> ต้องสำเร็จ 200 และอัปเดตฐานข้อมูลเฉพาะงวด 2569-Q3!
    const provBefore = (await handle.invoke({ url: '/api/public/provinces?period=2569-Q3' }))
      .json<{ provinces: ProvinceRiskRecord[] }>()
      .provinces.find((p) => p.dopaCode === '50')!;
    const q1Before = (await handle.invoke({ url: '/api/public/districts/5001?period=2569-Q1' })).json<{
      district: DistrictEvaluation;
    }>();
    const approved = await handle.invoke({
      method: 'POST',
      url: `/api/change-requests/${createdReq.id}/review`,
      headers: { Cookie: pv50.cookie, 'X-CSRF-Token': pv50.csrfToken },
      body: { decision: 'approve', reviewNoteTh: 'ตรวจสอบเอกสารอ้างอิงเรียบร้อย อนุมัติประกาศใช้' },
    });
    expect(approved.status).toBe(200);

    const d5001After = (await handle.invoke({ url: '/api/public/districts/5001?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();
    expect(d5001After.district.version).toBe(d5001Before.district.version + 1);
    expect(d5001After.district.metrics.capacityIndicators.c_cell_broadcast).toBe(4.95);
    expect(d5001After.district.capacityScore).toBeGreaterThan(d5001Before.district.capacityScore);
    expect(d5001After.district.ddpmScore).toBeLessThanOrEqual(d5001Before.district.ddpmScore);

    // ยืนยันว่าคะแนนรวมระดับจังหวัดเชียงใหม่ในงวด 2569-Q3 อัปเดตตามอำเภอที่อนุมัติทันที (EOC เป็นทรัพยากรส่วนกลาง P6b จึงขยับขึ้นชัดเจน)
    const provAfter = (await handle.invoke({ url: '/api/public/provinces?period=2569-Q3' }))
      .json<{ provinces: ProvinceRiskRecord[] }>()
      .provinces.find((p) => p.dopaCode === '50')!;
    expect(provAfter.capacityIndicators.c_eoc_machinery).toBeGreaterThan(
      provBefore.capacityIndicators.c_eoc_machinery,
    );
    expect(provAfter.districtDiagnostics).toBeDefined();
    expect(provAfter.districtDiagnostics!.districtCount).toBe(25);

    // ยืนยันว่าข้อมูลงวดย้อนหลัง (2569-Q1) ไม่ถูกเขียนทับ!
    const q1After = (await handle.invoke({ url: '/api/public/districts/5001?period=2569-Q1' })).json<{
      district: DistrictEvaluation;
    }>();
    expect(q1After.district.metrics).toEqual(q1Before.district.metrics);
  });

  it('defends against CSRF, Origin spoofing, SQLi, XSS, invalid bounds, prototype pollution, and verifies immutable SHA-256 audit chain', async () => {
    const am1001 = await loginAs('am_1001');
    const admin = await loginAs('admin_ddpm');

    const d1001 = (await handle.invoke({ url: '/api/public/districts/1001?period=2569-Q3' })).json<{
      district: DistrictEvaluation;
    }>();

    // 1. CSRF Missing Token -> 403
    const noCsrf = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: { Cookie: am1001.cookie },
      body: {
        periodId: '2569-Q3',
        metrics: d1001.district.metrics,
        reasonTh: 'ทดสอบส่งคำขอไม่มีรหัส CSRF',
      },
    });
    expect(noCsrf.status).toBe(403);

    // 2. Origin Mismatch -> 403
    const badOrigin = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: {
        Cookie: am1001.cookie,
        'X-CSRF-Token': am1001.csrfToken,
        Origin: 'https://evil-attacker.example',
      },
      body: {
        periodId: '2569-Q3',
        metrics: d1001.district.metrics,
        reasonTh: 'ทดสอบปลอมโดเมนต้นทาง',
      },
    });
    expect(badOrigin.status).toBe(403);

    // 3. SQL Injection ในพารามิเตอร์งวด -> 404 ปลอดภัยจาก Parameterized Query
    const sqli = await handle.invoke({
      url: `/api/public/provinces?period=${encodeURIComponent("2569-Q3' OR '1'='1")}`,
    });
    expect(sqli.status).toBe(404);

    // 4. XSS Injection -> 400
    const xss = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: { Cookie: am1001.cookie, 'X-CSRF-Token': am1001.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: d1001.district.metrics,
        reasonTh: '<script>alert(1)</script> พยายามฝังสคริปต์',
      },
    });
    expect(xss.status).toBe(400);

    // 5. Out-of-Bounds Score (> 5.00) -> 400
    const badBounds = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: { Cookie: am1001.cookie, 'X-CSRF-Token': am1001.csrfToken },
      body: {
        periodId: '2569-Q3',
        metrics: {
          ...d1001.district.metrics,
          capacityIndicators: {
            ...d1001.district.metrics.capacityIndicators,
            c_cell_broadcast: 9.99,
          },
        },
        reasonTh: 'ทดสอบส่งคะแนนเกินขอบเขต 5.00',
      },
    });
    expect(badBounds.status).toBe(400);

    // 6. Prototype Pollution Key -> 400
    const protoPoll = await handle.invoke({
      method: 'POST',
      url: '/api/districts/1001/submissions',
      headers: { Cookie: am1001.cookie, 'X-CSRF-Token': am1001.csrfToken },
      body: '{"__proto__":{"isAdmin":true},"periodId":"2569-Q3"}',
    });
    expect(protoPoll.status).toBe(400);

    // 7. การเปิดงวดเวลาใหม่ (Snapshot Clone): เจ้าหน้าที่อำเภอทำไม่ได้ (403), ส่วนกลางทำได้ (201)
    const officerNewPeriod = await handle.invoke({
      method: 'POST',
      url: '/api/admin/periods',
      headers: { Cookie: am1001.cookie, 'X-CSRF-Token': am1001.csrfToken },
      body: {
        periodId: '2569-Q4',
        labelTh: 'ไตรมาส 4/2569',
        effectiveFrom: '2026-10-01',
      },
    });
    expect(officerNewPeriod.status).toBe(403);

    const adminNewPeriod = await handle.invoke({
      method: 'POST',
      url: '/api/admin/periods',
      headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.csrfToken },
      body: {
        periodId: '2569-Q4',
        labelTh: 'ไตรมาส 4/2569 (ต.ค.-ธ.ค. 2569)',
        effectiveFrom: '2026-10-01',
      },
    });
    expect(adminNewPeriod.status).toBe(201);

    // 8. ตรวจ Immutable Trigger ของ audit_logs และความสมบูรณ์สายโซ่แฮช SHA-256
    const verifyRes = await handle.invoke({
      url: '/api/admin/audit-verify',
      headers: { Cookie: admin.cookie },
    });
    expect(verifyRes.status).toBe(200);
    const { verification } = verifyRes.json<{
      verification: { valid: boolean; totalEntries: number; brokenAtSeq: number | null };
    }>();
    expect(verification.valid).toBe(true);
    expect(verification.totalEntries).toBeGreaterThanOrEqual(8);
    expect(verification.brokenAtSeq).toBeNull();

    // ลองแก้ไข/ลบ audit_logs โดยตรงใน SQLite -> Trigger ต้องโยน Error ทันที
    expect(() => {
      handle.db.db.prepare("UPDATE audit_logs SET summary_th = 'tampered' WHERE seq = 1").run();
    }).toThrow(/immutable/i);
    expect(() => {
      handle.db.db.prepare('DELETE FROM audit_logs WHERE seq = 1').run();
    }).toThrow(/immutable/i);

    // จำลองกรณีมีผู้ไม่หวังดีปลด Trigger แล้วแอบแก้ข้อความ -> verifyAuditChain ต้องจับได้ทันที!
    handle.db.db.exec('DROP TRIGGER trg_audit_no_update');
    handle.db.db.prepare("UPDATE audit_logs SET summary_th = 'tampered' WHERE seq = 2").run();
    const tamperedVerify = handle.db.verifyAuditChain();
    expect(tamperedVerify.valid).toBe(false);
    expect(tamperedVerify.brokenAtSeq).toBe(2);
  });
});
