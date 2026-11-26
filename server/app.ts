import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PROVINCE_BY_CODE } from '../src/data/provincesRiskData.ts';
import { RiskDatabase } from './database.ts';
import {
  hasPrototypePollutionKeys,
  parseCookies,
  SECURITY_HEADERS,
  validateDistrictMetricsPayload,
  validateSafeText,
} from './security.ts';

const SESSION_COOKIE_NAME = 'ddpm_session';
const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KB

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface RiskApiServerOptions {
  dbPath?: string;
  staticDir?: string | null;
  demoMode?: boolean;
}

export interface LocalInvokeResponse {
  status: number;
  headers: Record<string, string | string[]>;
  bodyText: string;
  json: <T = Record<string, unknown>>() => T;
  getHeader: (name: string) => string | null;
}

export interface RiskApiServerHandle {
  server: http.Server;
  db: RiskDatabase;
  invoke: (input: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    remoteAddress?: string;
  }) => Promise<LocalInvokeResponse>;
  close: () => Promise<void>;
}

function getClientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  return req.socket.remoteAddress ?? '127.0.0.1';
}

function isHttpsRequest(req: http.IncomingMessage): boolean {
  return (
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production'
  );
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string | string[]>,
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | string[]> = {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const ct = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    return { ok: false, status: 415, error: 'รองรับเฉพาะคำขอรูปแบบ application/json' };
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        aborted = true;
        resolve({ ok: false, status: 413, error: 'ขนาดข้อมูลคำขอเกินขีดจำกัดความปลอดภัย (64 KB)' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) {
          resolve({ ok: true, data: {} });
          return;
        }
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          resolve({ ok: false, status: 400, error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' });
          return;
        }
        if (hasPrototypePollutionKeys(parsed)) {
          resolve({ ok: false, status: 400, error: 'ตรวจพบคีย์ต้องห้ามด้านความปลอดภัยในข้อมูลคำขอ' });
          return;
        }
        resolve({ ok: true, data: parsed as Record<string, unknown> });
      } catch {
        resolve({ ok: false, status: 400, error: 'ไม่สามารถอ่านข้อมูล JSON ได้' });
      }
    });

    req.on('error', () => {
      if (!aborted) {
        aborted = true;
        resolve({ ok: false, status: 400, error: 'การเชื่อมต่อคำขอขัดข้อง' });
      }
    });
  });
}

function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=28800',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function verifyCsrfAndOrigin(
  req: http.IncomingMessage,
  expectedCsrfToken: string,
): { ok: true } | { ok: false; reason: string } {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return { ok: false, reason: 'Origin header mismatch' };
      }
    } catch {
      return { ok: false, reason: 'Malformed Origin header' };
    }
  }

  const submitted = req.headers['x-csrf-token'];
  if (typeof submitted !== 'string' || submitted.length !== expectedCsrfToken.length) {
    return { ok: false, reason: 'Missing or invalid X-CSRF-Token' };
  }
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(expectedCsrfToken, 'utf8');
  if (!crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'X-CSRF-Token mismatch' };
  }
  return { ok: true };
}

function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
  pathname: string,
): void {
  const resolvedRoot = path.resolve(staticDir);
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let targetPath = path.resolve(resolvedRoot, relPath);

  // ป้องกัน Path Traversal
  if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(resolvedRoot, 'index.html');
  }

  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, SECURITY_HEADERS);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const isAsset = pathname.startsWith('/assets/');
  const cacheControl = isAsset ? 'public, max-age=31536000, immutable' : 'no-cache';

  const data = fs.readFileSync(targetPath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Content-Length': String(data.length),
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(data);
  }
}

export function createRiskApiServer(options: RiskApiServerOptions = {}): RiskApiServerHandle {
  const db = new RiskDatabase(options.dbPath);
  const staticDir = options.staticDir ?? null;
  const demoMode = options.demoMode ?? process.env.NODE_ENV !== 'production';

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const urlObj = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const pathname = decodeURIComponent(urlObj.pathname);
      const ipAddress = getClientIp(req);

      // ==================== Static Frontend Assets ====================
      if (!pathname.startsWith('/api/')) {
        if (staticDir && (method === 'GET' || method === 'HEAD')) {
          serveStaticFile(req, res, staticDir, pathname);
          return;
        }
        sendJson(res, 404, { error: 'ไม่พบเส้นทางที่เรียกใช้งาน' });
        return;
      }

      // ==================== Public Read-Only API (Zero Cookies, PDPA Safe) ====================
      if (method === 'GET' && pathname === '/api/public/health') {
        const periods = db.listPeriods();
        sendJson(res, 200, {
          status: 'ok',
          engine: 'node:sqlite',
          provinces: 77,
          districts: 928,
          periods: periods.length,
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/public/periods') {
        sendJson(res, 200, { periods: db.listPeriods() });
        return;
      }

      if (method === 'GET' && pathname === '/api/public/provinces') {
        const periodParam = urlObj.searchParams.get('period') ?? undefined;
        const period = db.getPeriod(periodParam);
        if (!period) {
          sendJson(res, 404, { error: 'ไม่พบงวดข้อมูลที่ระบุ' });
          return;
        }
        const agg = db.getAggregatedProvincesForPeriod(period.periodId);
        if (!agg) {
          sendJson(res, 404, { error: 'ไม่พบข้อมูลจังหวัดในงวดเวลานี้' });
          return;
        }
        sendJson(res, 200, {
          period: agg.period,
          provinces: agg.provinces,
          lastUpdatedAt: agg.lastUpdatedAt,
          dataSource: 'database',
        });
        return;
      }

      const provDistrictsMatch = pathname.match(/^\/api\/public\/provinces\/(\d{2})\/districts$/);
      if (method === 'GET' && provDistrictsMatch) {
        const provinceCode = provDistrictsMatch[1];
        const periodParam = urlObj.searchParams.get('period') ?? undefined;
        const data = db.getDistrictsForProvince(provinceCode, periodParam);
        if (!data) {
          sendJson(res, 404, { error: 'ไม่พบข้อมูลรายอำเภอของจังหวัดหรืองวดเวลาที่ระบุ' });
          return;
        }
        sendJson(res, 200, {
          period: data.period,
          provinceCode,
          provinceNameTh: data.provinceNameTh,
          districts: data.districts,
        });
        return;
      }

      const provTrendMatch = pathname.match(/^\/api\/public\/provinces\/(\d{2})\/trend$/);
      if (method === 'GET' && provTrendMatch) {
        const provinceCode = provTrendMatch[1];
        const trend = db.getProvinceTrend(provinceCode);
        if (!trend) {
          sendJson(res, 404, { error: 'ไม่พบข้อมูลแนวโน้มของจังหวัดที่ระบุ' });
          return;
        }
        sendJson(res, 200, { provinceCode, trend });
        return;
      }

      const singleDistrictMatch = pathname.match(/^\/api\/public\/districts\/(\d{4})$/);
      if (method === 'GET' && singleDistrictMatch) {
        const districtCode = singleDistrictMatch[1];
        const periodParam = urlObj.searchParams.get('period') ?? undefined;
        const evalData = db.getDistrictEvaluation(districtCode, periodParam);
        if (!evalData) {
          sendJson(res, 404, { error: 'ไม่พบข้อมูลอำเภอ/เขตที่ระบุ' });
          return;
        }
        sendJson(res, 200, { district: evalData });
        return;
      }

      // ==================== Authentication & 2FA Routes ====================
      if (method === 'GET' && pathname === '/api/auth/demo-accounts') {
        if (!demoMode) {
          sendJson(res, 404, { error: 'ปิดใช้งานรายการบัญชีสาธิตในระบบจริง' });
          return;
        }
        sendJson(res, 200, { accounts: db.listDemoAccountsInfo() });
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }
        const username = typeof bodyRes.data.username === 'string' ? bodyRes.data.username : '';
        const password = typeof bodyRes.data.password === 'string' ? bodyRes.data.password : '';
        if (!username.trim() || !password) {
          sendJson(res, 400, { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน' });
          return;
        }
        const result = db.loginStep1Password(username, password, ipAddress, demoMode);
        if (!result.ok) {
          sendJson(res, result.status, { error: result.error });
          return;
        }
        sendJson(res, 200, {
          mfaRequired: true,
          challengeToken: result.challengeToken,
          expiresInSec: result.expiresInSec,
          userPreview: result.userPreview,
          ...(result.demoTotpCode ? { demoTotpCode: result.demoTotpCode } : {}),
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/verify-totp') {
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }
        const challengeToken =
          typeof bodyRes.data.challengeToken === 'string' ? bodyRes.data.challengeToken : '';
        const code = typeof bodyRes.data.code === 'string' ? bodyRes.data.code : '';
        if (!challengeToken || !code) {
          sendJson(res, 400, { error: 'กรุณาระบุรหัสคำขอและรหัสยืนยัน 2 ชั้น (6 หลัก)' });
          return;
        }

        const result = db.loginStep2VerifyTotp(challengeToken, code, ipAddress);
        if (!result.ok) {
          sendJson(res, result.status, { error: result.error });
          return;
        }

        sendJson(
          res,
          200,
          {
            authenticated: true,
            user: result.user,
            csrfToken: result.csrfToken,
            expiresAt: result.expiresAt,
          },
          { 'Set-Cookie': buildSessionCookie(result.sessionToken, isHttpsRequest(req)) },
        );
        return;
      }

      // ==================== Authenticated Session Verification ====================
      const cookies = parseCookies(req.headers.cookie);
      const rawSessionToken = cookies[SESSION_COOKIE_NAME];
      const authCtx = db.authenticateSession(rawSessionToken);

      if (method === 'GET' && pathname === '/api/auth/me') {
        if (!authCtx) {
          sendJson(res, 200, { authenticated: false, user: null });
          return;
        }
        sendJson(res, 200, {
          authenticated: true,
          user: authCtx.user,
          csrfToken: authCtx.csrfToken,
          expiresAt: authCtx.expiresAt,
          idleExpiresAt: authCtx.idleExpiresAt,
        });
        return;
      }

      // ทุกเส้นทางต่อจากนี้ต้องผ่านการยืนยันตัวตน 2 ชั้น (Session) เท่านั้น!
      if (!authCtx) {
        sendJson(res, 401, {
          error: 'กรุณาเข้าสู่ระบบเจ้าหน้าที่และยืนยันตัวตน 2 ชั้นก่อนทำรายการ',
        });
        return;
      }

      // ตรวจ CSRF + Same-Origin สำหรับทุกคำขอที่เปลี่ยนแปลงข้อมูล (POST/PUT/PATCH/DELETE)
      if (method !== 'GET' && method !== 'HEAD') {
        const csrfCheck = verifyCsrfAndOrigin(req, authCtx.csrfToken);
        if (!csrfCheck.ok) {
          db.appendAuditLog({
            eventType: 'CSRF_REJECTED',
            actorUserId: authCtx.user.id,
            actorUsername: authCtx.user.username,
            actorRole: authCtx.user.role,
            targetProvinceCode: authCtx.user.provinceCode,
            targetDistrictCode: authCtx.user.districtCode,
            periodId: null,
            ipAddress,
            summaryTh: `ปฏิเสธคำขอที่ไม่มีหรือผิดรหัสป้องกัน CSRF (${csrfCheck.reason})`,
            details: { pathname, method, reason: csrfCheck.reason },
          });
          sendJson(res, 403, { error: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย CSRF กรุณารีเฟรชหน้าแล้วลองใหม่' });
          return;
        }
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        db.revokeSession(rawSessionToken, authCtx.user, ipAddress);
        sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': buildClearSessionCookie(isHttpsRequest(req)) },
        );
        return;
      }

      // ==================== Officer Scoped Endpoints (Strict RBAC + ABAC) ====================
      if (method === 'GET' && pathname === '/api/officer/scope') {
        const periodParam = urlObj.searchParams.get('period') ?? undefined;
        const period = db.getPeriod(periodParam);
        if (!period) {
          sendJson(res, 404, { error: 'ไม่พบงวดข้อมูลที่ระบุ' });
          return;
        }

        const myDistrict =
          authCtx.user.districtCode
            ? db.getDistrictEvaluation(authCtx.user.districtCode, period.periodId)
            : null;
        const provinceDistricts =
          authCtx.user.provinceCode
            ? db.getDistrictsForProvince(authCtx.user.provinceCode, period.periodId)?.districts ?? []
            : [];
        const changeRequests = db.listChangeRequests(authCtx.user);

        sendJson(res, 200, {
          user: authCtx.user,
          period,
          assignedDistrict: myDistrict,
          provinceDistricts,
          changeRequests,
        });
        return;
      }

      const submitDistrictMatch = pathname.match(/^\/api\/districts\/(\d{4})\/submissions$/);
      if (method === 'POST' && submitDistrictMatch) {
        const targetDistrictCode = submitDistrictMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }

        // Strict Server-Side Anti-Tampering: ตรวจทันทีหากผู้ใช้พยายามปลอมฟิลด์ role หรือ districtCode ข้ามเขตใน Body
        const distMeta = db.getDistrictMeta(targetDistrictCode);
        if (!distMeta) {
          sendJson(res, 404, { error: 'ไม่พบรหัสอำเภอ/เขตที่ระบุในระบบ' });
          return;
        }

        const provMeta = PROVINCE_BY_CODE[distMeta.provinceCode];
        if (!provMeta) {
          sendJson(res, 404, { error: 'ไม่พบจังหวัดต้นสังกัดของอำเภอนี้' });
          return;
        }

        // ตรวจสอบสิทธิ์เขตอำนาจก่อน Validate รายละเอียดอื่น เพื่อบันทึกความพยายามลักลอบเจาะสิทธิ์ทุกครั้ง!
        if (
          authCtx.user.role === 'district_officer' &&
          (authCtx.user.districtCode !== targetDistrictCode ||
            authCtx.user.provinceCode !== distMeta.provinceCode)
        ) {
          const denied = db.submitDistrictChangeRequest({
            actor: authCtx.user,
            targetDistrictCode,
            periodId: String(bodyRes.data.periodId ?? ''),
            afterMetrics: {
              hazards: {} as never,
              exposureIndicators: {} as never,
              vulnerabilityIndicators: {} as never,
              capacityIndicators: {} as never,
            },
            reasonTh: '',
            referenceDoc: '',
            ipAddress,
          });
          sendJson(res, denied.ok ? 403 : denied.status, {
            error: denied.ok
              ? 'ไม่มีสิทธิ์แก้ไขข้อมูลนอกเขตพื้นที่รับผิดชอบ'
              : denied.error,
          });
          return;
        }

        const periodId = typeof bodyRes.data.periodId === 'string' ? bodyRes.data.periodId.trim() : '';
        const reasonCheck = validateSafeText(bodyRes.data.reasonTh, 'เหตุผลประกอบการปรับปรุงข้อมูล', 5, 500);
        if (!reasonCheck.ok) {
          sendJson(res, 400, { error: reasonCheck.error });
          return;
        }

        const rawRefDoc = bodyRes.data.referenceDoc ?? '';
        const refCheck =
          typeof rawRefDoc === 'string' && rawRefDoc.trim().length === 0
            ? ({ ok: true as const, value: '' })
            : validateSafeText(rawRefDoc, 'เลขที่หนังสืออ้างอิง', 1, 120);
        if (!refCheck.ok) {
          sendJson(res, 400, { error: refCheck.error });
          return;
        }

        const metricsCheck = validateDistrictMetricsPayload(bodyRes.data.metrics, provMeta.coastalZone);
        if (!metricsCheck.ok) {
          sendJson(res, 400, { error: metricsCheck.error });
          return;
        }

        const submitRes = db.submitDistrictChangeRequest({
          actor: authCtx.user,
          targetDistrictCode,
          periodId,
          afterMetrics: metricsCheck.metrics,
          reasonTh: reasonCheck.value,
          referenceDoc: refCheck.value,
          ipAddress,
        });

        if (!submitRes.ok) {
          sendJson(res, submitRes.status, { error: submitRes.error });
          return;
        }

        sendJson(res, 201, { request: submitRes.request });
        return;
      }

      if (method === 'GET' && pathname === '/api/change-requests') {
        const periodParam = urlObj.searchParams.get('period') ?? undefined;
        sendJson(res, 200, { requests: db.listChangeRequests(authCtx.user, periodParam) });
        return;
      }

      const reviewMatch = pathname.match(/^\/api\/change-requests\/(\d+)\/review$/);
      if (method === 'POST' && reviewMatch) {
        const requestId = Number(reviewMatch[1]);
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }

        const decision = bodyRes.data.decision;
        if (decision !== 'approve' && decision !== 'reject') {
          sendJson(res, 400, { error: 'กรุณาระบุผลการพิจารณาเป็น approve หรือ reject' });
          return;
        }

        const rawNote = bodyRes.data.reviewNoteTh ?? '';
        const noteCheck =
          typeof rawNote === 'string' && rawNote.trim().length === 0
            ? ({ ok: true as const, value: decision === 'approve' ? 'ตรวจสอบความถูกต้องแล้ว อนุมัติประกาศใช้' : 'กรุณาตรวจสอบข้อมูลและเอกสารอ้างอิงเพิ่มเติม' })
            : validateSafeText(rawNote, 'ความเห็นผู้ตรวจสอบ', 2, 400);
        if (!noteCheck.ok) {
          sendJson(res, 400, { error: noteCheck.error });
          return;
        }

        const reviewRes = db.reviewChangeRequest({
          actor: authCtx.user,
          requestId,
          decision,
          reviewNoteTh: noteCheck.value,
          ipAddress,
        });

        if (!reviewRes.ok) {
          sendJson(res, reviewRes.status, { error: reviewRes.error });
          return;
        }
        sendJson(res, 200, { request: reviewRes.request });
        return;
      }

      // ==================== Audit Logs & Central Admin Governance ====================
      if (method === 'GET' && pathname === '/api/audit-logs') {
        const limit = Number(urlObj.searchParams.get('limit') ?? '80');
        sendJson(res, 200, {
          logs: db.listAuditLogs(authCtx.user, Number.isFinite(limit) ? limit : 80),
          chain: db.verifyAuditChain(),
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/admin/audit-verify') {
        sendJson(res, 200, { verification: db.verifyAuditChain() });
        return;
      }

      if (method === 'POST' && pathname === '/api/admin/periods') {
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }
        const periodId = typeof bodyRes.data.periodId === 'string' ? bodyRes.data.periodId.trim() : '';
        const labelCheck = validateSafeText(bodyRes.data.labelTh, 'ชื่อแสดงผลงวดข้อมูล', 4, 80);
        if (!labelCheck.ok) {
          sendJson(res, 400, { error: labelCheck.error });
          return;
        }
        const effectiveFrom =
          typeof bodyRes.data.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bodyRes.data.effectiveFrom)
            ? bodyRes.data.effectiveFrom
            : new Date().toISOString().slice(0, 10);
        const sourcePeriodId =
          typeof bodyRes.data.sourcePeriodId === 'string' && bodyRes.data.sourcePeriodId.trim()
            ? bodyRes.data.sourcePeriodId.trim()
            : undefined;

        const created = db.createNewPeriodClone({
          actor: authCtx.user,
          periodId,
          labelTh: labelCheck.value,
          effectiveFrom,
          sourcePeriodId,
          ipAddress,
        });
        if (!created.ok) {
          sendJson(res, created.status, { error: created.error });
          return;
        }
        sendJson(res, 201, { period: created.period });
        return;
      }

      const periodStatusMatch = pathname.match(/^\/api\/admin\/periods\/([A-Za-z0-9-]+)\/status$/);
      if (method === 'PATCH' && periodStatusMatch) {
        const periodId = periodStatusMatch[1];
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          sendJson(res, bodyRes.status, { error: bodyRes.error });
          return;
        }
        const status = bodyRes.data.status;
        if (status !== 'open' && status !== 'locked') {
          sendJson(res, 400, { error: 'สถานะงวดข้อมูลต้องเป็น open หรือ locked' });
          return;
        }
        const updated = db.updatePeriodStatus({
          actor: authCtx.user,
          periodId,
          status,
          ipAddress,
        });
        if (!updated.ok) {
          sendJson(res, updated.status, { error: updated.error });
          return;
        }
        sendJson(res, 200, { period: updated.period });
        return;
      }

      sendJson(res, 404, { error: 'ไม่พบเส้นทาง API ที่เรียกใช้งาน' });
    } catch (err) {
      console.error('[DDPM API Error]', err);
      sendJson(res, 500, { error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' });
    }
  };

  const server = http.createServer(requestHandler);

  const invoke: RiskApiServerHandle['invoke'] = async ({
    method = 'GET',
    url,
    headers = {},
    body,
    remoteAddress = '127.0.0.1',
  }) => {
    const normalizedHeaders: Record<string, string> = { host: '127.0.0.1:4173' };
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    let rawBodyBuf: Buffer | null = null;
    if (body !== undefined) {
      const str = typeof body === 'string' ? body : JSON.stringify(body);
      rawBodyBuf = Buffer.from(str, 'utf8');
      if (!normalizedHeaders['content-type']) {
        normalizedHeaders['content-type'] = 'application/json';
      }
      normalizedHeaders['content-length'] = String(rawBodyBuf.length);
    }

    const reqEmitter = new EventEmitter() as unknown as http.IncomingMessage;
    Object.assign(reqEmitter, {
      method: method.toUpperCase(),
      url,
      headers: normalizedHeaders,
      socket: { remoteAddress },
    });

    let resStatus = 200;
    const resHeaders: Record<string, string | string[]> = {};
    const chunks: Buffer[] = [];

    const donePromise = new Promise<LocalInvokeResponse>((resolve) => {
      const mockRes = {
        writeHead(code: number, hdrs?: Record<string, string | string[]>) {
          resStatus = code;
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              resHeaders[k.toLowerCase()] = v;
            }
          }
          return mockRes;
        },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
          }
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: resStatus,
            headers: resHeaders,
            bodyText,
            json: <T = Record<string, unknown>>() => JSON.parse(bodyText) as T,
            getHeader: (name: string) => {
              const v = resHeaders[name.toLowerCase()];
              if (v === undefined) return null;
              return Array.isArray(v) ? v.join(', ') : v;
            },
          });
        },
      } as unknown as http.ServerResponse;

      void requestHandler(reqEmitter, mockRes);

      queueMicrotask(() => {
        if (rawBodyBuf) {
          (reqEmitter as unknown as EventEmitter).emit('data', rawBodyBuf);
        }
        (reqEmitter as unknown as EventEmitter).emit('end');
      });
    });

    return donePromise;
  };

  return {
    server,
    db,
    invoke,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          db.close();
          resolve();
          return;
        }
        server.close((err) => {
          db.close();
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
