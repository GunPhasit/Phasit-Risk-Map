import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { THAILAND_DISTRICTS_CATALOG } from '../src/data/thailandDistrictsCatalog.ts';
import { HAZARD_BY_ID, HAZARD_IDS } from '../src/data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../src/data/indicatorCatalog.ts';
import { PROVINCE_BY_CODE, PROVINCES_RISK_DATA } from '../src/data/provincesRiskData.ts';
import {
  aggregateDistrictsToProvince,
  deriveHistoricalPeriodMetrics,
  evaluateDistrictMetrics,
  generateProvinceDistrictBaseline,
} from '../src/domain/districtRollup.ts';
import { computeProvinceHevc, round2, scoreToRiskLevel } from '../src/domain/riskCalculator.ts';
import type {
  AuditChainVerification,
  AuditEventType,
  AuditLogEntry,
  AuthUser,
  ChangeRequestRecord,
  DemoAccountInfo,
  DistrictCatalogSummaryItem,
  DistrictEvaluation,
  DistrictMeta,
  DistrictMetricsPayload,
  MetricDiffItem,
  ProvinceProgressItem,
  ProvinceProgressResponse,
  ProvinceRiskRecord,
  ProvinceTrendPoint,
  ReportingPeriod,
  UserRole,
} from '../src/types/index.ts';
import {
  computeCurrentTotp,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  randomTokenHex,
  resolveMasterKey,
  sha256Hex,
  timingSafeStringEqual,
  verifyPassword,
  verifyTotp,
} from './security.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const GENESIS_HASH = '0'.repeat(64);
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 นาที
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 ชั่วโมง
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 นาที
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 นาที

export interface DemoAccountSeed {
  readonly username: string;
  readonly password: string;
  readonly displayNameTh: string;
  readonly positionTh: string;
  readonly role: UserRole;
  readonly provinceCode: string | null;
  readonly districtCode: string | null;
  readonly fixedTotpSecret?: string;
}

export const DEMO_ACCOUNTS_SEED: readonly DemoAccountSeed[] = [
  {
    username: 'am_5001',
    password: 'Ddpm@5001#2569',
    displayNameTh: 'นายสมชาย วัฒนากูล',
    positionTh: 'เจ้าหน้าที่ป้องกันและบรรเทาสาธารณภัย อำเภอเมืองเชียงใหม่',
    role: 'district_officer',
    provinceCode: '50',
    districtCode: '5001',
  },
  {
    username: 'am_5007',
    password: 'Ddpm@5007#2569',
    displayNameTh: 'นางสาวณัฐธิดา ศรีวิชัย',
    positionTh: 'เจ้าหน้าที่ป้องกันและบรรเทาสาธารณภัย อำเภอแม่ริม',
    role: 'district_officer',
    provinceCode: '50',
    districtCode: '5007',
  },
  {
    username: 'am_1001',
    password: 'Ddpm@1001#2569',
    displayNameTh: 'นายกิตติพงศ์ ธรรมรักษ์',
    positionTh: 'หัวหน้าฝ่ายป้องกันและบรรเทาสาธารณภัย เขตพระนคร',
    role: 'district_officer',
    provinceCode: '10',
    districtCode: '1001',
  },
  {
    username: 'am_3801',
    password: 'Ddpm@3801#2569',
    displayNameTh: 'นางสาวพิมพ์ชนก โพธิ์งาม',
    positionTh: 'เจ้าหน้าที่ป้องกันและบรรเทาสาธารณภัย อำเภอเมืองบึงกาฬ',
    role: 'district_officer',
    provinceCode: '38',
    districtCode: '3801',
  },
  {
    username: 'am_8301',
    password: 'Ddpm@8301#2569',
    displayNameTh: 'นายธนากร อันดามัน',
    positionTh: 'เจ้าหน้าที่ป้องกันและบรรเทาสาธารณภัย อำเภอเมืองภูเก็ต',
    role: 'district_officer',
    provinceCode: '83',
    districtCode: '8301',
  },
  {
    username: 'pv_50',
    password: 'Ddpm@Prov50#2569',
    displayNameTh: 'นางสุภาพร อินทนนท์',
    positionTh: 'หัวหน้าสำนักงานป้องกันและบรรเทาสาธารณภัยจังหวัดเชียงใหม่',
    role: 'province_reviewer',
    provinceCode: '50',
    districtCode: null,
  },
  {
    username: 'pv_10',
    password: 'Ddpm@Prov10#2569',
    displayNameTh: 'นายประเสริฐ มหานคร',
    positionTh: 'ผู้อำนวยการส่วนแผนและประเมินความเสี่ยง สำนัก ปภ. กรุงเทพมหานคร',
    role: 'province_reviewer',
    provinceCode: '10',
    districtCode: null,
  },
  {
    username: 'admin_ddpm',
    password: 'Ddpm@Central#2569',
    displayNameTh: 'นายวิศิษฏ์ ศูนย์กลางข้อมูล',
    positionTh: 'ผู้อำนวยการศูนย์เทคโนโลยีสารสนเทศและการสื่อสาร กรม ปภ.',
    role: 'ddpm_central_admin',
    provinceCode: null,
    districtCode: null,
  },
];

export const INITIAL_PERIODS: readonly Omit<ReportingPeriod, 'createdAt'>[] = [
  {
    periodId: '2568-Q4',
    labelTh: 'ไตรมาส 4/2568 (ต.ค.-ธ.ค. 2568)',
    effectiveFrom: '2025-10-01',
    effectiveTo: '2025-12-31',
    status: 'locked',
    isCurrent: false,
    createdBy: 'กรมป้องกันและบรรเทาสาธารณภัย',
  },
  {
    periodId: '2569-Q1',
    labelTh: 'ไตรมาส 1/2569 (ม.ค.-มี.ค. 2569)',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-03-31',
    status: 'locked',
    isCurrent: false,
    createdBy: 'กรมป้องกันและบรรเทาสาธารณภัย',
  },
  {
    periodId: '2569-Q2',
    labelTh: 'ไตรมาส 2/2569 (เม.ย.-มิ.ย. 2569)',
    effectiveFrom: '2026-04-01',
    effectiveTo: '2026-06-30',
    status: 'locked',
    isCurrent: false,
    createdBy: 'กรมป้องกันและบรรเทาสาธารณภัย',
  },
  {
    periodId: '2569-Q3',
    labelTh: 'ไตรมาส 3/2569 (ปัจจุบัน)',
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    status: 'open',
    isCurrent: true,
    createdBy: 'กรมป้องกันและบรรเทาสาธารณภัย',
  },
];

function loadDistrictsCatalog(): DistrictMeta[] {
  return [...THAILAND_DISTRICTS_CATALOG];
}

export function computeMetricsDiff(
  before: DistrictMetricsPayload,
  after: DistrictMetricsPayload,
): MetricDiffItem[] {
  const diffs: MetricDiffItem[] = [];
  for (const hId of HAZARD_IDS) {
    const b = before.hazards[hId];
    const a = after.hazards[hId];
    if (b !== a && b !== null && a !== null && Math.abs(a - b) >= 0.005) {
      diffs.push({
        group: 'H',
        key: hId,
        labelTh: `ภัยคุกคาม: ${HAZARD_BY_ID[hId].shortNameTh}`,
        before: b,
        after: a,
        delta: round2(a - b),
      });
    }
  }
  for (const ind of EXPOSURE_INDICATORS) {
    const b = before.exposureIndicators[ind.id];
    const a = after.exposureIndicators[ind.id];
    if (Math.abs(a - b) >= 0.005) {
      diffs.push({
        group: 'E',
        key: ind.id,
        labelTh: `ความล่อแหลม: ${ind.shortNameTh}`,
        before: b,
        after: a,
        delta: round2(a - b),
      });
    }
  }
  for (const ind of VULNERABILITY_INDICATORS) {
    const b = before.vulnerabilityIndicators[ind.id];
    const a = after.vulnerabilityIndicators[ind.id];
    if (Math.abs(a - b) >= 0.005) {
      diffs.push({
        group: 'V',
        key: ind.id,
        labelTh: `ความเปราะบาง: ${ind.shortNameTh}`,
        before: b,
        after: a,
        delta: round2(a - b),
      });
    }
  }
  for (const ind of CAPACITY_INDICATORS) {
    const b = before.capacityIndicators[ind.id];
    const a = after.capacityIndicators[ind.id];
    if (Math.abs(a - b) >= 0.005) {
      diffs.push({
        group: 'C',
        key: ind.id,
        labelTh: `ศักยภาพ: ${ind.shortNameTh}`,
        before: b,
        after: a,
        delta: round2(a - b),
      });
    }
  }
  return diffs;
}

interface RawUserRow {
  id: string;
  username: string;
  display_name_th: string;
  position_th: string;
  password_hash: string;
  role: UserRole;
  province_code: string | null;
  district_code: string | null;
  totp_secret_enc: string;
  is_active: number;
  failed_attempts: number;
  locked_until: string | null;
}

export interface RiskDatabaseOptions {
  readonly masterKey?: Buffer;
  readonly journalMode?: 'WAL' | 'DELETE';
}

export class RiskDatabase {
  public readonly db: DatabaseSync;
  public readonly dbPath: string;
  private readonly masterKey: Buffer;
  private readonly districtsByCode = new Map<string, DistrictMeta>();
  private readonly districtsByProvince = new Map<string, DistrictMeta[]>();
  private readonly provinceCache = new Map<string, { provinces: ProvinceRiskRecord[]; lastUpdatedAt: string }>();
  private _mutationCount = 0;

  constructor(
    dbPath: string = path.resolve(PROJECT_ROOT, 'data/ddpm_risk.sqlite'),
    options: RiskDatabaseOptions = {},
  ) {
    this.dbPath = dbPath;
    const isMemory = dbPath === ':memory:';
    if (!isMemory) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.masterKey = resolveMasterKey(PROJECT_ROOT, isMemory, options.masterKey);
    this.db = new DatabaseSync(dbPath);
    if (!isMemory) {
      const mode = options.journalMode ?? 'WAL';
      this.db.exec(`PRAGMA journal_mode = ${mode};`);
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    this.initSchema();
    this.seedIfEmpty();
    this.loadDistrictIndex();
  }

  public get mutationCount(): number {
    return this._mutationCount;
  }

  private markMutated(): void {
    this._mutationCount += 1;
  }

  public checkpoint(): void {
    if (this.dbPath === ':memory:') return;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // โหมด DELETE ไม่จำเป็นต้องทำ WAL checkpoint
    }
  }

  public close(): void {
    this.checkpoint();
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provinces (
        dopa_code TEXT PRIMARY KEY,
        iso_code TEXT NOT NULL UNIQUE,
        name_th TEXT NOT NULL,
        name_en TEXT NOT NULL,
        region6 TEXT NOT NULL,
        is_bma6 INTEGER NOT NULL DEFAULT 0,
        coastal_zone TEXT NOT NULL,
        geo_note_th TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS districts (
        district_code TEXT PRIMARY KEY,
        province_code TEXT NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
        prefix_th TEXT NOT NULL,
        name_th TEXT NOT NULL,
        full_name_th TEXT NOT NULL,
        name_en TEXT NOT NULL,
        geo_class TEXT NOT NULL,
        pop_weight REAL NOT NULL CHECK (pop_weight > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_districts_prov ON districts(province_code);

      CREATE TABLE IF NOT EXISTS reporting_periods (
        period_id TEXT PRIMARY KEY,
        label_th TEXT NOT NULL,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        status TEXT NOT NULL CHECK (status IN ('open','locked')),
        is_current INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS district_period_metrics (
        period_id TEXT NOT NULL REFERENCES reporting_periods(period_id) ON DELETE RESTRICT,
        district_code TEXT NOT NULL REFERENCES districts(district_code) ON DELETE RESTRICT,
        province_code TEXT NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        metrics_json TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (period_id, district_code),
        CHECK (substr(district_code, 1, 2) = province_code)
      );
      CREATE INDEX IF NOT EXISTS idx_dpm_period_prov ON district_period_metrics(period_id, province_code);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name_th TEXT NOT NULL,
        position_th TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('district_officer','province_reviewer','ddpm_central_admin')),
        province_code TEXT REFERENCES provinces(dopa_code),
        district_code TEXT REFERENCES districts(district_code),
        totp_secret_enc TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (role = 'district_officer' AND province_code IS NOT NULL AND district_code IS NOT NULL AND substr(district_code, 1, 2) = province_code)
          OR (role = 'province_reviewer' AND province_code IS NOT NULL AND district_code IS NULL)
          OR (role = 'ddpm_central_admin' AND province_code IS NULL AND district_code IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS mfa_challenges (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        ip_address TEXT,
        last_activity_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS totp_used_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        time_step INTEGER NOT NULL,
        used_at TEXT NOT NULL,
        PRIMARY KEY (user_id, time_step)
      );

      CREATE TABLE IF NOT EXISTS login_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        window_start_ms INTEGER NOT NULL,
        blocked_until_ms INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS change_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_id TEXT NOT NULL REFERENCES reporting_periods(period_id) ON DELETE RESTRICT,
        province_code TEXT NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
        district_code TEXT NOT NULL REFERENCES districts(district_code) ON DELETE RESTRICT,
        submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
        submitted_by_name TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
        reason_th TEXT NOT NULL,
        reference_doc TEXT NOT NULL DEFAULT '',
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        diff_json TEXT NOT NULL,
        before_ddpm_score REAL NOT NULL,
        after_ddpm_score REAL NOT NULL,
        reviewed_by_user_id TEXT REFERENCES users(id),
        reviewed_by_name TEXT,
        reviewed_at TEXT,
        review_note_th TEXT,
        CHECK (substr(district_code, 1, 2) = province_code)
      );
      CREATE INDEX IF NOT EXISTS idx_cr_prov_status ON change_requests(province_code, status);
      CREATE INDEX IF NOT EXISTS idx_cr_district ON change_requests(district_code, period_id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_user_id TEXT,
        actor_username TEXT,
        actor_role TEXT,
        target_province_code TEXT,
        target_district_code TEXT,
        period_id TEXT,
        ip_address TEXT,
        summary_th TEXT NOT NULL,
        details_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE
      );

      CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
      BEFORE UPDATE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is immutable and cannot be updated');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
      BEFORE DELETE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is immutable and cannot be deleted');
      END;
    `);
  }

  private loadDistrictIndex(): void {
    this.districtsByCode.clear();
    this.districtsByProvince.clear();
    const rows = this.db
      .prepare(
        `SELECT district_code, province_code, prefix_th, name_th, full_name_th, name_en, geo_class, pop_weight
         FROM districts ORDER BY district_code ASC`,
      )
      .all();

    for (const r of rows) {
      const meta: DistrictMeta = {
        code: String(r.district_code),
        provinceCode: String(r.province_code),
        prefixTh: String(r.prefix_th),
        nameTh: String(r.name_th),
        fullNameTh: String(r.full_name_th),
        nameEn: String(r.name_en),
        geoClass: String(r.geo_class) as DistrictMeta['geoClass'],
        popWeight: Number(r.pop_weight),
      };
      this.districtsByCode.set(meta.code, meta);
      const list = this.districtsByProvince.get(meta.provinceCode) ?? [];
      list.push(meta);
      this.districtsByProvince.set(meta.provinceCode, list);
    }
  }

  private seedIfEmpty(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM provinces').get() as { cnt: number };
    if (countRow && Number(countRow.cnt) >= 77) return;

    const allDistricts = loadDistrictsCatalog();
    const nowIso = '2026-11-26T09:00:00.000Z';

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insertProv = this.db.prepare(
        `INSERT INTO provinces (dopa_code, iso_code, name_th, name_en, region6, is_bma6, coastal_zone, geo_note_th)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of PROVINCES_RISK_DATA) {
        insertProv.run(
          p.dopaCode,
          p.isoCode,
          p.nameTh,
          p.nameEn,
          p.region6,
          p.isBma6 ? 1 : 0,
          p.coastalZone,
          p.geographicNoteTh,
        );
      }

      const insertDistrict = this.db.prepare(
        `INSERT INTO districts (district_code, province_code, prefix_th, name_th, full_name_th, name_en, geo_class, pop_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const byProv = new Map<string, DistrictMeta[]>();
      for (const d of allDistricts) {
        insertDistrict.run(
          d.code,
          d.provinceCode,
          d.prefixTh,
          d.nameTh,
          d.fullNameTh,
          d.nameEn,
          d.geoClass,
          d.popWeight,
        );
        const list = byProv.get(d.provinceCode) ?? [];
        list.push(d);
        byProv.set(d.provinceCode, list);
      }

      const insertPeriod = this.db.prepare(
        `INSERT INTO reporting_periods (period_id, label_th, effective_from, effective_to, status, is_current, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const per of INITIAL_PERIODS) {
        insertPeriod.run(
          per.periodId,
          per.labelTh,
          per.effectiveFrom,
          per.effectiveTo,
          per.status,
          per.isCurrent ? 1 : 0,
          per.createdBy,
          nowIso,
        );
      }

      const insertMetric = this.db.prepare(
        `INSERT INTO district_period_metrics (period_id, district_code, province_code, version, metrics_json, updated_by, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      );

      for (const prov of PROVINCES_RISK_DATA) {
        const provDistricts = byProv.get(prov.dopaCode) ?? [];
        const baselineMap = generateProvinceDistrictBaseline(prov, provDistricts);

        for (const d of provDistricts) {
          const currentMetrics = baselineMap.get(d.code)!;
          for (const per of INITIAL_PERIODS) {
            const periodMetrics = deriveHistoricalPeriodMetrics(currentMetrics, prov.region6, per.periodId);
            insertMetric.run(
              per.periodId,
              d.code,
              prov.dopaCode,
              JSON.stringify(periodMetrics),
              'ชุดข้อมูลตั้งต้น ปภ. 64-70',
              per.effectiveFrom + 'T08:00:00.000Z',
            );
          }
        }
      }

      // สร้างบัญชีเจ้าหน้าที่ตัวอย่างพร้อมรหัสผ่าน scrypt + คีย์ TOTP เข้ารหัส AES-256-GCM
      const insertUser = this.db.prepare(
        `INSERT INTO users (id, username, display_name_th, position_th, password_hash, role, province_code, district_code, totp_secret_enc, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      for (const acc of DEMO_ACCOUNTS_SEED) {
        const uid = `usr_${acc.username}`;
        const pwHash = hashPassword(acc.password);
        const totpSecret = acc.fixedTotpSecret ?? generateTotpSecret();
        const encSecret = encryptSecret(totpSecret, this.masterKey);
        insertUser.run(
          uid,
          acc.username,
          acc.displayNameTh,
          acc.positionTh,
          pwHash,
          acc.role,
          acc.provinceCode,
          acc.districtCode,
          encSecret,
          nowIso,
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    // บันทึก Genesis Audit Log แบบ Hash-Chain
    this.appendAuditLog({
      eventType: 'SYSTEM_GENESIS',
      actorUserId: 'system',
      actorUsername: 'system',
      actorRole: 'ddpm_central_admin',
      targetProvinceCode: null,
      targetDistrictCode: null,
      periodId: '2569-Q3',
      ipAddress: '127.0.0.1',
      summaryTh: 'ตั้งต้นฐานข้อมูลความเสี่ยงรายช่วงเวลา 77 จังหวัด 928 อำเภอ/เขต และเปิดใช้งานระบบตรวจสอบย้อนหลังแบบ Hash-Chain',
      details: { provinces: 77, districts: 928, periods: INITIAL_PERIODS.length },
    });

    // ตัวอย่างคำขอแก้ไขรออนุมัติ 1 รายการใน อ.เมืองเชียงใหม่ เพื่อให้ ปภ.จังหวัดเชียงใหม่ทดสอบตรวจอนุมัติได้ทันที
    this.seedSamplePendingRequest();
  }

  private seedSamplePendingRequest(): void {
    const existing = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM change_requests')
      .get() as { cnt: number };
    if (existing && Number(existing.cnt) > 0) return;

    const currentRow = this.db
      .prepare(
        `SELECT metrics_json FROM district_period_metrics WHERE period_id = '2569-Q3' AND district_code = '5001'`,
      )
      .get() as { metrics_json: string } | undefined;
    if (!currentRow) return;

    const beforeMetrics = JSON.parse(currentRow.metrics_json) as DistrictMetricsPayload;
    const afterMetrics: DistrictMetricsPayload = {
      ...beforeMetrics,
      capacityIndicators: {
        ...beforeMetrics.capacityIndicators,
        c_cell_broadcast: round2(Math.min(5.0, beforeMetrics.capacityIndicators.c_cell_broadcast + 0.45)),
        c_ddpm_training: round2(Math.min(5.0, beforeMetrics.capacityIndicators.c_ddpm_training + 0.50)),
      },
    };
    const prov = PROVINCE_BY_CODE['50'];
    const dist = this.getDistrictMeta('5001');
    if (!prov || !dist) return;

    const beforeEval = evaluateDistrictMetrics(dist, prov, '2569-Q3', 1, beforeMetrics, '', '');
    const afterEval = evaluateDistrictMetrics(dist, prov, '2569-Q3', 1, afterMetrics, '', '');
    const diffItems = computeMetricsDiff(beforeMetrics, afterMetrics);

    this.db
      .prepare(
        `INSERT INTO change_requests (
           period_id, province_code, district_code, submitted_by_user_id, submitted_by_name,
           submitted_at, status, reason_th, reference_doc, before_json, after_json, diff_json,
           before_ddpm_score, after_ddpm_score
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '2569-Q3',
        '50',
        '5001',
        'usr_am_5001',
        'นายสมชาย วัฒนากูล',
        '2026-11-26T09:15:00.000Z',
        'อัปเดตผลการขยายสัญญาณ Cell Broadcast ครอบคลุมชุมชนรอบคูเมือง และอบรมอาสาสมัคร อปพร. รุ่นใหม่ 420 คน',
        'ชม 0021.1/ว 1482',
        JSON.stringify(beforeMetrics),
        JSON.stringify(afterMetrics),
        JSON.stringify(diffItems),
        beforeEval.ddpmScore,
        afterEval.ddpmScore,
      );
  }

  public getDistrictMeta(districtCode: string): DistrictMeta | null {
    return this.districtsByCode.get(districtCode) ?? null;
  }

  public getProvinceDistrictsMeta(provinceCode: string): readonly DistrictMeta[] {
    return this.districtsByProvince.get(provinceCode) ?? [];
  }

  // ==================== Immutable SHA-256 Hash-Chained Audit Log ====================

  public appendAuditLog(input: {
    eventType: AuditEventType;
    actorUserId: string | null;
    actorUsername: string | null;
    actorRole: UserRole | null;
    targetProvinceCode: string | null;
    targetDistrictCode: string | null;
    periodId: string | null;
    ipAddress: string | null;
    summaryTh: string;
    details?: Record<string, unknown>;
  }): AuditLogEntry {
    const createdAt = new Date().toISOString();
    const detailsJson = JSON.stringify(input.details ?? {});

    const lastRow = this.db
      .prepare('SELECT seq, entry_hash FROM audit_logs ORDER BY seq DESC LIMIT 1')
      .get() as { seq: number; entry_hash: string } | undefined;

    const prevHash = lastRow ? String(lastRow.entry_hash) : GENESIS_HASH;
    const nextSeq = lastRow ? Number(lastRow.seq) + 1 : 1;

    const canonical = [
      String(nextSeq),
      createdAt,
      input.eventType,
      input.actorUserId ?? '',
      input.actorUsername ?? '',
      input.actorRole ?? '',
      input.targetProvinceCode ?? '',
      input.targetDistrictCode ?? '',
      input.periodId ?? '',
      input.ipAddress ?? '',
      input.summaryTh,
      detailsJson,
      prevHash,
    ].join('|');

    const entryHash = sha256Hex(canonical);

    const res = this.db
      .prepare(
        `INSERT INTO audit_logs (
          seq, created_at, event_type, actor_user_id, actor_username, actor_role,
          target_province_code, target_district_code, period_id, ip_address,
          summary_th, details_json, prev_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nextSeq,
        createdAt,
        input.eventType,
        input.actorUserId,
        input.actorUsername,
        input.actorRole,
        input.targetProvinceCode,
        input.targetDistrictCode,
        input.periodId,
        input.ipAddress,
        input.summaryTh,
        detailsJson,
        prevHash,
        entryHash,
      );

    this.markMutated();

    return {
      seq: Number(res.lastInsertRowid),
      createdAt,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      targetProvinceCode: input.targetProvinceCode,
      targetDistrictCode: input.targetDistrictCode,
      periodId: input.periodId,
      ipAddress: input.ipAddress,
      summaryTh: input.summaryTh,
      details: input.details ?? {},
      prevHash,
      entryHash,
    };
  }

  public verifyAuditChain(): AuditChainVerification {
    const rows = this.db
      .prepare(
        `SELECT seq, created_at, event_type, actor_user_id, actor_username, actor_role,
                target_province_code, target_district_code, period_id, ip_address,
                summary_th, details_json, prev_hash, entry_hash
         FROM audit_logs ORDER BY seq ASC`,
      )
      .all();

    let expectedPrev = GENESIS_HASH;
    let latestHash = GENESIS_HASH;

    for (const r of rows) {
      const seq = Number(r.seq);
      const prevHash = String(r.prev_hash);
      const storedHash = String(r.entry_hash);

      if (prevHash !== expectedPrev) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenAtSeq: seq,
          latestHash,
          verifiedAt: new Date().toISOString(),
        };
      }

      const canonical = [
        String(seq),
        String(r.created_at),
        String(r.event_type),
        r.actor_user_id ? String(r.actor_user_id) : '',
        r.actor_username ? String(r.actor_username) : '',
        r.actor_role ? String(r.actor_role) : '',
        r.target_province_code ? String(r.target_province_code) : '',
        r.target_district_code ? String(r.target_district_code) : '',
        r.period_id ? String(r.period_id) : '',
        r.ip_address ? String(r.ip_address) : '',
        String(r.summary_th),
        String(r.details_json),
        prevHash,
      ].join('|');

      const recomputed = sha256Hex(canonical);
      if (recomputed !== storedHash) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenAtSeq: seq,
          latestHash,
          verifiedAt: new Date().toISOString(),
        };
      }

      expectedPrev = storedHash;
      latestHash = storedHash;
    }

    return {
      valid: true,
      totalEntries: rows.length,
      brokenAtSeq: null,
      latestHash,
      verifiedAt: new Date().toISOString(),
    };
  }

  public listAuditLogs(user: AuthUser, limit = 80): AuditLogEntry[] {
    const safeLimit = Math.min(200, Math.max(1, limit));
    let rows: Record<string, unknown>[];

    if (user.role === 'ddpm_central_admin') {
      rows = this.db
        .prepare('SELECT * FROM audit_logs ORDER BY seq DESC LIMIT ?')
        .all(safeLimit);
    } else if (user.role === 'province_reviewer' && user.provinceCode) {
      rows = this.db
        .prepare(
          `SELECT * FROM audit_logs
           WHERE target_province_code = ? OR actor_user_id = ?
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(user.provinceCode, user.id, safeLimit);
    } else if (user.role === 'district_officer' && user.districtCode) {
      rows = this.db
        .prepare(
          `SELECT * FROM audit_logs
           WHERE target_district_code = ? OR actor_user_id = ?
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(user.districtCode, user.id, safeLimit);
    } else {
      rows = [];
    }

    return rows.map((r) => ({
      seq: Number(r.seq),
      createdAt: String(r.created_at),
      eventType: String(r.event_type) as AuditEventType,
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      actorUsername: r.actor_username ? String(r.actor_username) : null,
      actorRole: r.actor_role ? (String(r.actor_role) as UserRole) : null,
      targetProvinceCode: r.target_province_code ? String(r.target_province_code) : null,
      targetDistrictCode: r.target_district_code ? String(r.target_district_code) : null,
      periodId: r.period_id ? String(r.period_id) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      summaryTh: String(r.summary_th),
      details: JSON.parse(String(r.details_json)) as Record<string, unknown>,
      prevHash: String(r.prev_hash),
      entryHash: String(r.entry_hash),
    }));
  }

  // ==================== Public Temporal Queries ====================

  public listPeriods(): ReportingPeriod[] {
    const rows = this.db
      .prepare(
        `SELECT period_id, label_th, effective_from, effective_to, status, is_current, created_by, created_at
         FROM reporting_periods ORDER BY effective_from ASC`,
      )
      .all();

    return rows.map((r) => ({
      periodId: String(r.period_id),
      labelTh: String(r.label_th),
      effectiveFrom: String(r.effective_from),
      effectiveTo: r.effective_to ? String(r.effective_to) : null,
      status: String(r.status) as 'open' | 'locked',
      isCurrent: Number(r.is_current) === 1,
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
    }));
  }

  public getPeriod(periodId?: string): ReportingPeriod | null {
    const periods = this.listPeriods();
    if (!periodId) {
      return periods.find((p) => p.isCurrent) ?? periods[periods.length - 1] ?? null;
    }
    return periods.find((p) => p.periodId === periodId) ?? null;
  }

  public getPreviousPeriodId(periodId: string): string | null {
    const periods = this.listPeriods();
    const idx = periods.findIndex((p) => p.periodId === periodId);
    if (idx <= 0) return null;
    return periods[idx - 1].periodId;
  }

  public getAggregatedProvincesForPeriod(periodId: string): {
    period: ReportingPeriod;
    provinces: ProvinceRiskRecord[];
    lastUpdatedAt: string;
  } | null {
    const period = this.getPeriod(periodId);
    if (!period) return null;

    const cached = this.provinceCache.get(period.periodId);
    if (cached) {
      return { period, provinces: cached.provinces, lastUpdatedAt: cached.lastUpdatedAt };
    }

    const rows = this.db
      .prepare(
        `SELECT district_code, province_code, metrics_json, updated_at
         FROM district_period_metrics
         WHERE period_id = ?
         ORDER BY district_code ASC`,
      )
      .all(period.periodId);

    const grouped = new Map<string, Array<{ district: DistrictMeta; metrics: DistrictMetricsPayload }>>();
    let lastUpdatedAt = period.createdAt;

    for (const r of rows) {
      const dCode = String(r.district_code);
      const pCode = String(r.province_code);
      const meta = this.districtsByCode.get(dCode);
      if (!meta) continue;
      const metrics = JSON.parse(String(r.metrics_json)) as DistrictMetricsPayload;
      const updatedAt = String(r.updated_at);
      if (updatedAt > lastUpdatedAt) lastUpdatedAt = updatedAt;

      const list = grouped.get(pCode) ?? [];
      list.push({ district: meta, metrics });
      grouped.set(pCode, list);
    }

    const provinces = PROVINCES_RISK_DATA.map((baseProv) => {
      const distRows = grouped.get(baseProv.dopaCode) ?? [];
      return aggregateDistrictsToProvince(baseProv, distRows);
    });

    this.provinceCache.set(period.periodId, { provinces, lastUpdatedAt });
    return { period, provinces, lastUpdatedAt };
  }

  public getDistrictsForProvince(
    provinceCode: string,
    periodId?: string,
  ): { period: ReportingPeriod; provinceNameTh: string; districts: DistrictEvaluation[] } | null {
    const prov = PROVINCE_BY_CODE[provinceCode];
    const period = this.getPeriod(periodId);
    if (!prov || !period) return null;

    const prevPeriodId = this.getPreviousPeriodId(period.periodId);
    const prevMap = new Map<string, DistrictMetricsPayload>();

    if (prevPeriodId) {
      const prevRows = this.db
        .prepare(
          `SELECT district_code, metrics_json FROM district_period_metrics
           WHERE period_id = ? AND province_code = ?`,
        )
        .all(prevPeriodId, provinceCode);
      for (const pr of prevRows) {
        prevMap.set(String(pr.district_code), JSON.parse(String(pr.metrics_json)) as DistrictMetricsPayload);
      }
    }

    const rows = this.db
      .prepare(
        `SELECT district_code, version, metrics_json, updated_by, updated_at
         FROM district_period_metrics
         WHERE period_id = ? AND province_code = ?
         ORDER BY district_code ASC`,
      )
      .all(period.periodId, provinceCode);

    const districts: DistrictEvaluation[] = [];
    for (const r of rows) {
      const dCode = String(r.district_code);
      const meta = this.districtsByCode.get(dCode);
      if (!meta) continue;
      const metrics = JSON.parse(String(r.metrics_json)) as DistrictMetricsPayload;
      districts.push(
        evaluateDistrictMetrics(
          meta,
          prov,
          period.periodId,
          Number(r.version),
          metrics,
          String(r.updated_by),
          String(r.updated_at),
          prevMap.get(dCode) ?? null,
        ),
      );
    }

    return { period, provinceNameTh: prov.nameTh, districts };
  }

  public getDistrictEvaluation(districtCode: string, periodId?: string): DistrictEvaluation | null {
    const meta = this.districtsByCode.get(districtCode);
    const period = this.getPeriod(periodId);
    if (!meta || !period) return null;
    const prov = PROVINCE_BY_CODE[meta.provinceCode];
    if (!prov) return null;

    const row = this.db
      .prepare(
        `SELECT version, metrics_json, updated_by, updated_at
         FROM district_period_metrics
         WHERE period_id = ? AND district_code = ?`,
      )
      .get(period.periodId, districtCode);
    if (!row) return null;

    const prevPeriodId = this.getPreviousPeriodId(period.periodId);
    let prevMetrics: DistrictMetricsPayload | null = null;
    if (prevPeriodId) {
      const prevRow = this.db
        .prepare(
          `SELECT metrics_json FROM district_period_metrics WHERE period_id = ? AND district_code = ?`,
        )
        .get(prevPeriodId, districtCode);
      if (prevRow) {
        prevMetrics = JSON.parse(String(prevRow.metrics_json)) as DistrictMetricsPayload;
      }
    }

    return evaluateDistrictMetrics(
      meta,
      prov,
      period.periodId,
      Number(row.version),
      JSON.parse(String(row.metrics_json)) as DistrictMetricsPayload,
      String(row.updated_by),
      String(row.updated_at),
      prevMetrics,
    );
  }

  public getProvinceTrend(provinceCode: string): ProvinceTrendPoint[] | null {
    if (!PROVINCE_BY_CODE[provinceCode]) return null;
    const periods = this.listPeriods();
    const trend: ProvinceTrendPoint[] = [];

    for (const per of periods) {
      const agg = this.getAggregatedProvincesForPeriod(per.periodId);
      const prov = agg?.provinces.find((p) => p.dopaCode === provinceCode);
      if (!prov) continue;
      const bd = computeProvinceHevc(prov, 'composite');
      const ddpmScore = bd.ddpmScore ?? 1.0;
      trend.push({
        periodId: per.periodId,
        labelTh: per.labelTh,
        ddpmScore,
        ddpmLevel: scoreToRiskLevel(ddpmScore),
        hazardScore: bd.hazardCompositeScore,
        exposureScore: bd.exposureScore,
        vulnerabilityScore: bd.vulnerabilityScore,
        capacityScore: bd.effectiveCapacityScore,
      });
    }
    return trend;
  }

  public getDistrictsCatalogSummary(
    periodId?: string,
  ): { period: ReportingPeriod; districts: DistrictCatalogSummaryItem[] } | null {
    const period = this.getPeriod(periodId);
    if (!period) return null;

    const pendingRows = this.db
      .prepare(
        `SELECT district_code, COUNT(*) AS cnt
         FROM change_requests
         WHERE period_id = ? AND status = 'pending'
         GROUP BY district_code`,
      )
      .all(period.periodId) as Array<{ district_code: string; cnt: number }>;
    const pendingMap = new Map<string, number>();
    for (const pr of pendingRows) {
      pendingMap.set(String(pr.district_code), Number(pr.cnt));
    }

    const rows = this.db
      .prepare(
        `SELECT district_code, province_code, version, metrics_json, updated_by, updated_at
         FROM district_period_metrics
         WHERE period_id = ?
         ORDER BY district_code ASC`,
      )
      .all(period.periodId);

    const districts: DistrictCatalogSummaryItem[] = [];
    for (const r of rows) {
      const dCode = String(r.district_code);
      const pCode = String(r.province_code);
      const meta = this.districtsByCode.get(dCode);
      const prov = PROVINCE_BY_CODE[pCode];
      if (!meta || !prov) continue;
      const metrics = JSON.parse(String(r.metrics_json)) as DistrictMetricsPayload;
      const version = Number(r.version);
      const updatedBy = String(r.updated_by);
      const updatedAt = String(r.updated_at);
      const ev = evaluateDistrictMetrics(meta, prov, period.periodId, version, metrics, updatedBy, updatedAt);

      districts.push({
        code: meta.code,
        provinceCode: meta.provinceCode,
        provinceNameTh: prov.nameTh,
        prefixTh: meta.prefixTh,
        nameTh: meta.nameTh,
        fullNameTh: meta.fullNameTh,
        nameEn: meta.nameEn,
        geoClass: meta.geoClass,
        ddpmScore: ev.ddpmScore,
        ddpmLevel: ev.ddpmLevel,
        capacityScore: ev.capacityScore,
        version,
        updatedAt,
        pendingCount: pendingMap.get(dCode) ?? 0,
        isModifiedFromBaseline: version > 1,
      });
    }

    return { period, districts };
  }

  public searchDistricts(input: {
    provinceCode?: string;
    periodId?: string;
    query?: string;
    limit?: number;
  }): { period: ReportingPeriod; districts: DistrictCatalogSummaryItem[] } | null {
    const catalog = this.getDistrictsCatalogSummary(input.periodId);
    if (!catalog) return null;

    const q = (input.query ?? '').trim().toLowerCase();
    const provCode = input.provinceCode?.trim();
    const limit = Math.min(928, Math.max(1, input.limit ?? 100));

    const filtered = catalog.districts.filter((d) => {
      if (provCode && d.provinceCode !== provCode) return false;
      if (!q) return true;
      return (
        d.fullNameTh.toLowerCase().includes(q) ||
        d.nameTh.toLowerCase().includes(q) ||
        d.provinceNameTh.toLowerCase().includes(q) ||
        d.nameEn.toLowerCase().includes(q) ||
        d.code.includes(q)
      );
    });

    return {
      period: catalog.period,
      districts: filtered.slice(0, limit),
    };
  }

  public getProvinceProgress(actor: AuthUser, periodId?: string): ProvinceProgressResponse | null {
    const period = this.getPeriod(periodId);
    if (!period) return null;

    const targetProvinces =
      actor.role === 'ddpm_central_admin'
        ? PROVINCES_RISK_DATA
        : actor.provinceCode && PROVINCE_BY_CODE[actor.provinceCode]
          ? [PROVINCE_BY_CODE[actor.provinceCode]]
          : [];

    const versionRows = this.db
      .prepare(
        `SELECT province_code,
                COUNT(*) AS total_cnt,
                SUM(CASE WHEN version > 1 THEN 1 ELSE 0 END) AS updated_cnt
         FROM district_period_metrics
         WHERE period_id = ?
         GROUP BY province_code`,
      )
      .all(period.periodId) as Array<{
      province_code: string;
      total_cnt: number;
      updated_cnt: number;
    }>;

    const pendingRows = this.db
      .prepare(
        `SELECT province_code, COUNT(DISTINCT district_code) AS pending_cnt
         FROM change_requests
         WHERE period_id = ? AND status = 'pending'
         GROUP BY province_code`,
      )
      .all(period.periodId) as Array<{ province_code: string; pending_cnt: number }>;

    const vMap = new Map<string, { total: number; updated: number }>();
    for (const r of versionRows) {
      vMap.set(String(r.province_code), {
        total: Number(r.total_cnt),
        updated: Number(r.updated_cnt),
      });
    }
    const pMap = new Map<string, number>();
    for (const r of pendingRows) {
      pMap.set(String(r.province_code), Number(r.pending_cnt));
    }

    const provinces: ProvinceProgressItem[] = [];
    let totalDistricts = 0;
    let updatedDistricts = 0;
    let pendingDistricts = 0;

    for (const p of targetProvinces) {
      const counts = vMap.get(p.dopaCode) ?? { total: 0, updated: 0 };
      const pend = pMap.get(p.dopaCode) ?? 0;
      const pct = counts.total > 0 ? round2((counts.updated / counts.total) * 100) : 0;
      provinces.push({
        provinceCode: p.dopaCode,
        provinceNameTh: p.nameTh,
        totalDistricts: counts.total,
        updatedDistricts: counts.updated,
        pendingDistricts: pend,
        completionPct: pct,
      });
      totalDistricts += counts.total;
      updatedDistricts += counts.updated;
      pendingDistricts += pend;
    }

    return {
      periodId: period.periodId,
      totalDistricts,
      updatedDistricts,
      pendingDistricts,
      completionPct: totalDistricts > 0 ? round2((updatedDistricts / totalDistricts) * 100) : 0,
      provinces,
    };
  }

  // ==================== Auth, Rate Limiting, TOTP 2FA & Sessions ====================

  public listDemoAccountsInfo(): DemoAccountInfo[] {
    return DEMO_ACCOUNTS_SEED.map((a) => {
      const prov = a.provinceCode ? PROVINCE_BY_CODE[a.provinceCode] : null;
      const dist = a.districtCode ? this.districtsByCode.get(a.districtCode) : null;
      let scopeLabelTh = 'กำกับดูแลทั้งประเทศ (77 จังหวัด 928 อำเภอ/เขต)';
      if (a.role === 'district_officer' && dist && prov) {
        const provLabel = prov.dopaCode === '10' ? prov.nameTh : `จังหวัด${prov.nameTh}`;
        scopeLabelTh = `แก้ไขได้เฉพาะ: ${dist.fullNameTh} ${provLabel}`;
      } else if (a.role === 'province_reviewer' && prov) {
        const provLabel = prov.dopaCode === '10' ? prov.nameTh : `จังหวัด${prov.nameTh}`;
        scopeLabelTh = `อนุมัติข้อมูลเฉพาะ: ${provLabel}`;
      }
      return {
        username: a.username,
        displayNameTh: a.displayNameTh,
        positionTh: a.positionTh,
        role: a.role,
        scopeLabelTh,
        provinceCode: a.provinceCode,
        districtCode: a.districtCode,
      };
    });
  }

  private toAuthUser(row: RawUserRow): AuthUser {
    const prov = row.province_code ? PROVINCE_BY_CODE[row.province_code] : null;
    const dist = row.district_code ? this.districtsByCode.get(row.district_code) : null;
    return {
      id: row.id,
      username: row.username,
      displayNameTh: row.display_name_th,
      positionTh: row.position_th,
      role: row.role,
      provinceCode: row.province_code,
      provinceNameTh: prov ? prov.nameTh : null,
      districtCode: row.district_code,
      districtNameTh: dist ? dist.fullNameTh : null,
    };
  }

  public getUserTotpSecretForTest(username: string): string | null {
    const row = this.db
      .prepare('SELECT totp_secret_enc FROM users WHERE username = ?')
      .get(username) as { totp_secret_enc: string } | undefined;
    if (!row) return null;
    return decryptSecret(row.totp_secret_enc, this.masterKey);
  }

  private checkRateLimit(bucketKey: string, nowMs: number): { allowed: boolean; retryAfterSec: number } {
    const row = this.db
      .prepare('SELECT attempts, window_start_ms, blocked_until_ms FROM login_rate_limits WHERE bucket_key = ?')
      .get(bucketKey) as { attempts: number; window_start_ms: number; blocked_until_ms: number } | undefined;

    if (!row) return { allowed: true, retryAfterSec: 0 };
    if (row.blocked_until_ms > nowMs) {
      return { allowed: false, retryAfterSec: Math.ceil((row.blocked_until_ms - nowMs) / 1000) };
    }
    if (nowMs - row.window_start_ms > LOCKOUT_MS) {
      this.db.prepare('DELETE FROM login_rate_limits WHERE bucket_key = ?').run(bucketKey);
      return { allowed: true, retryAfterSec: 0 };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  private recordFailedRateLimit(bucketKey: string, nowMs: number): boolean {
    const row = this.db
      .prepare('SELECT attempts, window_start_ms FROM login_rate_limits WHERE bucket_key = ?')
      .get(bucketKey) as { attempts: number; window_start_ms: number } | undefined;

    if (!row || nowMs - row.window_start_ms > LOCKOUT_MS) {
      this.db
        .prepare(
          `INSERT INTO login_rate_limits (bucket_key, attempts, window_start_ms, blocked_until_ms)
           VALUES (?, 1, ?, 0)
           ON CONFLICT(bucket_key) DO UPDATE SET attempts = 1, window_start_ms = ?, blocked_until_ms = 0`,
        )
        .run(bucketKey, nowMs, nowMs);
      return false;
    }

    const nextAttempts = Number(row.attempts) + 1;
    const locked = nextAttempts >= MAX_FAILED_LOGINS;
    const blockedUntil = locked ? nowMs + LOCKOUT_MS : 0;
    this.db
      .prepare('UPDATE login_rate_limits SET attempts = ?, blocked_until_ms = ? WHERE bucket_key = ?')
      .run(nextAttempts, blockedUntil, bucketKey);
    return locked;
  }

  private clearRateLimit(bucketKey: string): void {
    this.db.prepare('DELETE FROM login_rate_limits WHERE bucket_key = ?').run(bucketKey);
  }

  /**
   * สร้างบัญชีสาธิตแบบ Lazy Provisioning เฉพาะเมื่ออยู่ในโหมดสาธิต (demoMode=true และไม่ใช่ DDPM_STRICT_PROD)
   * รองรับครบทั้ง 928 อำเภอ/เขต (am_XXXX) และ 77 จังหวัด (pv_XX)
   * ตรวจรหัสผ่านแบบ Constant-Time ก่อนสร้างแถวเสมอเพื่อป้องกัน Brute-Force สร้างข้อมูลขยะ และห้ามสร้าง admin เด็ดขาด
   */
  private tryLazyProvisionDemoAccount(
    username: string,
    passwordRaw: string,
    ipAddress: string,
  ): RawUserRow | null {
    const amMatch = username.match(/^am_(\d{4})$/);
    if (amMatch) {
      const distCode = amMatch[1];
      const dist = this.districtsByCode.get(distCode);
      if (!dist) return null;
      const expectedPw = `Ddpm@${dist.code}#2569`;
      if (!timingSafeStringEqual(passwordRaw, expectedPw)) return null;

      const prov = PROVINCE_BY_CODE[dist.provinceCode];
      const provLabel = prov ? (prov.dopaCode === '10' ? prov.nameTh : `จังหวัด${prov.nameTh}`) : dist.provinceCode;
      const uid = `usr_${username}`;
      const displayNameTh = `เจ้าหน้าที่ ปภ. ${dist.fullNameTh}`;
      const positionTh = `เจ้าหน้าที่ป้องกันและบรรเทาสาธารณภัย ${dist.fullNameTh} ${provLabel}`;
      const pwHash = hashPassword(expectedPw);
      const totpSecret = generateTotpSecret();
      const encSecret = encryptSecret(totpSecret, this.masterKey);
      const nowIso = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO users (id, username, display_name_th, position_th, password_hash, role, province_code, district_code, totp_secret_enc, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, 'district_officer', ?, ?, ?, 1, ?)`,
        )
        .run(uid, username, displayNameTh, positionTh, pwHash, dist.provinceCode, dist.code, encSecret, nowIso);

      this.markMutated();
      this.appendAuditLog({
        eventType: 'DEMO_ACCOUNT_PROVISIONED',
        actorUserId: uid,
        actorUsername: username,
        actorRole: 'district_officer',
        targetProvinceCode: dist.provinceCode,
        targetDistrictCode: dist.code,
        periodId: null,
        ipAddress,
        summaryTh: `เปิดใช้งานบัญชีสาธิตประจำพื้นที่ ${dist.fullNameTh} ${provLabel} (${username})`,
        details: { role: 'district_officer', districtCode: dist.code },
      });

      return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as RawUserRow | undefined ?? null;
    }

    const pvMatch = username.match(/^pv_(\d{2})$/);
    if (pvMatch) {
      const provCode = pvMatch[1];
      const prov = PROVINCE_BY_CODE[provCode];
      if (!prov) return null;
      const expectedPw = `Ddpm@Prov${prov.dopaCode}#2569`;
      if (!timingSafeStringEqual(passwordRaw, expectedPw)) return null;

      const provLabel = prov.dopaCode === '10' ? prov.nameTh : `จังหวัด${prov.nameTh}`;
      const uid = `usr_${username}`;
      const displayNameTh = `ผู้ตรวจสอบ ปภ. ${provLabel}`;
      const positionTh = `หัวหน้าสำนักงานป้องกันและบรรเทาสาธารณภัย${provLabel}`;
      const pwHash = hashPassword(expectedPw);
      const totpSecret = generateTotpSecret();
      const encSecret = encryptSecret(totpSecret, this.masterKey);
      const nowIso = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO users (id, username, display_name_th, position_th, password_hash, role, province_code, district_code, totp_secret_enc, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, 'province_reviewer', ?, NULL, ?, 1, ?)`,
        )
        .run(uid, username, displayNameTh, positionTh, pwHash, prov.dopaCode, encSecret, nowIso);

      this.markMutated();
      this.appendAuditLog({
        eventType: 'DEMO_ACCOUNT_PROVISIONED',
        actorUserId: uid,
        actorUsername: username,
        actorRole: 'province_reviewer',
        targetProvinceCode: prov.dopaCode,
        targetDistrictCode: null,
        periodId: null,
        ipAddress,
        summaryTh: `เปิดใช้งานบัญชีผู้ตรวจสอบระดับจังหวัด (สาธิต) ประจำ${provLabel} (${username})`,
        details: { role: 'province_reviewer', provinceCode: prov.dopaCode },
      });

      return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as RawUserRow | undefined ?? null;
    }

    return null;
  }

  public loginStep1Password(
    usernameRaw: string,
    passwordRaw: string,
    ipAddress: string,
    demoMode: boolean,
  ):
    | {
        ok: true;
        challengeToken: string;
        expiresInSec: number;
        userPreview: AuthUser;
        demoTotpCode?: string;
      }
    | { ok: false; status: number; error: string } {
    const username = usernameRaw.trim().toLowerCase();
    const nowMs = Date.now();
    const bucketKey = `login:${ipAddress}:${username}`;

    const rl = this.checkRateLimit(bucketKey, nowMs);
    if (!rl.allowed) {
      this.appendAuditLog({
        eventType: 'LOGIN_LOCKED',
        actorUserId: null,
        actorUsername: username,
        actorRole: null,
        targetProvinceCode: null,
        targetDistrictCode: null,
        periodId: null,
        ipAddress,
        summaryTh: `ระงับการเข้าสู่ระบบชั่วคราวสำหรับบัญชี ${username} เนื่องจากพยายามกรอกรหัสผิดเกินกำหนด`,
        details: { retryAfterSec: rl.retryAfterSec },
      });
      return {
        ok: false,
        status: 429,
        error: `พยายามเข้าสู่ระบบไม่สำเร็จเกินกำหนด กรุณารอประมาณ ${Math.ceil(rl.retryAfterSec / 60)} นาที`,
      };
    }

    let userRow = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as RawUserRow | undefined;

    if (!userRow && demoMode && process.env.DDPM_STRICT_PROD !== 'true') {
      const provisioned = this.tryLazyProvisionDemoAccount(username, passwordRaw, ipAddress);
      if (provisioned) {
        userRow = provisioned;
      }
    }

    if (userRow && userRow.locked_until && new Date(userRow.locked_until).getTime() > nowMs) {
      return {
        ok: false,
        status: 429,
        error: 'บัญชีนี้ถูกระงับชั่วคราว 15 นาทีเพื่อความปลอดภัย กรุณาลองใหม่ภายหลัง',
      };
    }

    const validPw = Boolean(userRow && userRow.is_active === 1 && verifyPassword(passwordRaw, userRow.password_hash));

    if (!validPw || !userRow) {
      const becameLocked = this.recordFailedRateLimit(bucketKey, nowMs);
      if (userRow) {
        const nextFails = Number(userRow.failed_attempts) + 1;
        const lockIso =
          nextFails >= MAX_FAILED_LOGINS ? new Date(nowMs + LOCKOUT_MS).toISOString() : null;
        this.db
          .prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(nextFails, lockIso, userRow.id);
      }

      this.appendAuditLog({
        eventType: becameLocked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        actorUserId: userRow?.id ?? null,
        actorUsername: username,
        actorRole: userRow?.role ?? null,
        targetProvinceCode: userRow?.province_code ?? null,
        targetDistrictCode: userRow?.district_code ?? null,
        periodId: null,
        ipAddress,
        summaryTh: becameLocked
          ? `ล็อกบัญชี ${username} ชั่วคราว 15 นาทีหลังรหัสผ่านผิดครบ 5 ครั้ง`
          : `การเข้าสู่ระบบล้มเหลวสำหรับบัญชี ${username}`,
        details: { locked: becameLocked },
      });

      return {
        ok: false,
        status: becameLocked ? 429 : 401,
        error: becameLocked
          ? 'กรอกรหัสผ่านผิดครบ 5 ครั้ง ระบบระงับบัญชีชั่วคราว 15 นาที'
          : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      };
    }

    // รหัสผ่านถูกต้อง -> ออก MFA Challenge Token (ยังไม่สร้าง Session จนกว่าจะผ่าน TOTP 2FA!)
    const challengeToken = randomTokenHex(32);
    const challengeHash = sha256Hex(challengeToken);
    const nowIso = new Date(nowMs).toISOString();
    const expIso = new Date(nowMs + MFA_CHALLENGE_TTL_MS).toISOString();

    this.db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userRow.id);
    this.db
      .prepare(
        `INSERT INTO mfa_challenges (token_hash, user_id, ip_address, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(challengeHash, userRow.id, ipAddress, expIso, nowIso);
    this.markMutated();

    const response: {
      ok: true;
      challengeToken: string;
      expiresInSec: number;
      userPreview: AuthUser;
      demoTotpCode?: string;
    } = {
      ok: true,
      challengeToken,
      expiresInSec: Math.floor(MFA_CHALLENGE_TTL_MS / 1000),
      userPreview: this.toAuthUser(userRow),
    };

    // เฉพาะโหมดสาธิตเท่านั้น (โหมด Production ที่ตั้ง DDPM_STRICT_PROD=true หรือ demoMode=false จะไม่ส่งรหัสนี้เด็ดขาด)
    if (demoMode && process.env.DDPM_STRICT_PROD !== 'true') {
      const plainTotpSecret = decryptSecret(userRow.totp_secret_enc, this.masterKey);
      response.demoTotpCode = computeCurrentTotp(plainTotpSecret, nowMs);
    }

    return response;
  }

  public loginStep2VerifyTotp(
    challengeToken: string,
    totpCode: string,
    ipAddress: string,
  ):
    | {
        ok: true;
        sessionToken: string;
        csrfToken: string;
        expiresAt: string;
        user: AuthUser;
      }
    | { ok: false; status: number; error: string } {
    const nowMs = Date.now();
    const challengeHash = sha256Hex(challengeToken);
    const challenge = this.db
      .prepare('SELECT user_id, expires_at FROM mfa_challenges WHERE token_hash = ?')
      .get(challengeHash) as { user_id: string; expires_at: string } | undefined;

    if (!challenge || new Date(challenge.expires_at).getTime() < nowMs) {
      return { ok: false, status: 401, error: 'รหัสคำขอยืนยันตัวตน 2 ชั้นหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
    }

    const userRow = this.db
      .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
      .get(challenge.user_id) as RawUserRow | undefined;

    if (!userRow) {
      return { ok: false, status: 401, error: 'ไม่พบบัญชีผู้ใช้งานหรือบัญชีถูกระงับ' };
    }

    const secret = decryptSecret(userRow.totp_secret_enc, this.masterKey);
    const totpCheck = verifyTotp(secret, totpCode, nowMs);

    if (!totpCheck.valid || totpCheck.matchedStep === null) {
      this.appendAuditLog({
        eventType: 'TOTP_FAILED',
        actorUserId: userRow.id,
        actorUsername: userRow.username,
        actorRole: userRow.role,
        targetProvinceCode: userRow.province_code,
        targetDistrictCode: userRow.district_code,
        periodId: null,
        ipAddress,
        summaryTh: `ยืนยันรหัส 2 ชั้น (TOTP) ไม่สำเร็จสำหรับบัญชี ${userRow.username}`,
        details: {},
      });
      return { ok: false, status: 401, error: 'รหัสยืนยัน 2 ชั้น (6 หลัก) ไม่ถูกต้องหรือหมดอายุ' };
    }

    // ป้องกัน Replay Attack: ห้ามใช้รหัส 6 หลักเดิมซ้ำภายในรอบเวลาเดียวกัน
    const alreadyUsed = this.db
      .prepare('SELECT 1 FROM totp_used_codes WHERE user_id = ? AND time_step = ?')
      .get(userRow.id, totpCheck.matchedStep);

    if (alreadyUsed) {
      this.appendAuditLog({
        eventType: 'TOTP_FAILED',
        actorUserId: userRow.id,
        actorUsername: userRow.username,
        actorRole: userRow.role,
        targetProvinceCode: userRow.province_code,
        targetDistrictCode: userRow.district_code,
        periodId: null,
        ipAddress,
        summaryTh: `ตรวจพบการใช้รหัส 2 ชั้นซ้ำ (Replay) สำหรับบัญชี ${userRow.username}`,
        details: { replayBlocked: true },
      });
      return { ok: false, status: 401, error: 'รหัส 6 หลักนี้ถูกใช้งานแล้ว กรุณารอรหัสรอบถัดไป (30 วินาที)' };
    }

    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + SESSION_ABSOLUTE_MS).toISOString();
    const sessionToken = randomTokenHex(32);
    const sessionHash = sha256Hex(sessionToken);
    const csrfToken = randomTokenHex(24);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO totp_used_codes (user_id, time_step, used_at) VALUES (?, ?, ?)')
        .run(userRow.id, totpCheck.matchedStep, nowIso);
      this.db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(challengeHash);
      this.db
        .prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')
        .run(userRow.id);
      this.db
        .prepare(
          `INSERT INTO sessions (token_hash, user_id, csrf_token, ip_address, last_activity_at, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionHash, userRow.id, csrfToken, ipAddress, nowIso, expiresAt, nowIso);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.clearRateLimit(`login:${ipAddress}:${userRow.username}`);
    const user = this.toAuthUser(userRow);

    this.appendAuditLog({
      eventType: 'LOGIN_SUCCESS',
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      targetProvinceCode: user.provinceCode,
      targetDistrictCode: user.districtCode,
      periodId: null,
      ipAddress,
      summaryTh: `${user.displayNameTh} (${user.positionTh}) เข้าสู่ระบบผ่านการยืนยันตัวตน 2 ชั้นสำเร็จ`,
      details: { role: user.role },
    });

    return { ok: true, sessionToken, csrfToken, expiresAt, user };
  }

  public authenticateSession(sessionToken: string | undefined): {
    user: AuthUser;
    csrfToken: string;
    expiresAt: string;
    idleExpiresAt: string;
  } | null {
    if (!sessionToken || sessionToken.length < 32) return null;
    const nowMs = Date.now();
    const hash = sha256Hex(sessionToken);

    const row = this.db
      .prepare(
        `SELECT s.csrf_token, s.last_activity_at, s.expires_at,
                u.id, u.username, u.display_name_th, u.position_th, u.password_hash,
                u.role, u.province_code, u.district_code, u.totp_secret_enc, u.is_active,
                u.failed_attempts, u.locked_until
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(hash) as
      | (RawUserRow & { csrf_token: string; last_activity_at: string; expires_at: string })
      | undefined;

    if (!row || row.is_active !== 1) return null;

    const absExp = new Date(row.expires_at).getTime();
    const lastActivityMs = new Date(row.last_activity_at).getTime();
    const idleExp = lastActivityMs + SESSION_IDLE_MS;
    if (nowMs > absExp || nowMs > idleExp) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      this.markMutated();
      return null;
    }

    // ลดการเขียนซ้ำบนคำขออ่าน (GET) โดยอัปเดตเวลาใช้งานล่าสุดทุก 60 วินาที
    if (nowMs - lastActivityMs >= 60_000) {
      const nowIso = new Date(nowMs).toISOString();
      this.db.prepare('UPDATE sessions SET last_activity_at = ? WHERE token_hash = ?').run(nowIso, hash);
      this.markMutated();
    }

    return {
      user: this.toAuthUser(row),
      csrfToken: String(row.csrf_token),
      expiresAt: String(row.expires_at),
      idleExpiresAt: new Date(nowMs + SESSION_IDLE_MS).toISOString(),
    };
  }

  public revokeSession(sessionToken: string | undefined, user: AuthUser | null, ipAddress: string): void {
    if (sessionToken) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(sessionToken));
    }
    if (user) {
      this.appendAuditLog({
        eventType: 'LOGOUT',
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        targetProvinceCode: user.provinceCode,
        targetDistrictCode: user.districtCode,
        periodId: null,
        ipAddress,
        summaryTh: `${user.displayNameTh} ออกจากระบบเจ้าหน้าที่`,
        details: {},
      });
    }
  }

  // ==================== District-Scoped Submissions & Maker-Checker Review ====================

  public submitDistrictChangeRequest(input: {
    actor: AuthUser;
    targetDistrictCode: string;
    periodId: string;
    afterMetrics: DistrictMetricsPayload;
    reasonTh: string;
    referenceDoc: string;
    ipAddress: string;
  }): { ok: true; request: ChangeRequestRecord } | { ok: false; status: number; error: string } {
    const { actor, targetDistrictCode, periodId, afterMetrics, reasonTh, referenceDoc, ipAddress } = input;
    const dist = this.districtsByCode.get(targetDistrictCode);
    if (!dist) {
      return { ok: false, status: 404, error: 'ไม่พบรหัสอำเภอ/เขตที่ระบุในระบบ' };
    }

    // Strict Server-Side ABAC Enforcement:
    // 1. เจ้าหน้าที่อำเภอแก้ไขได้เฉพาะอำเภอของตนเองในจังหวัดที่สังกัดเท่านั้น!
    if (actor.role === 'district_officer') {
      if (actor.districtCode !== dist.code || actor.provinceCode !== dist.provinceCode) {
        this.appendAuditLog({
          eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
          actorUserId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          targetProvinceCode: dist.provinceCode,
          targetDistrictCode: dist.code,
          periodId,
          ipAddress,
          summaryTh: `สกัดกั้นการพยายามแก้ไขข้อมูลนอกเขตอำนาจ: ${actor.username} (เขตสิทธิ์ ${actor.districtCode}) พยายามแก้ ${dist.fullNameTh} (${dist.code})`,
          details: {
            authorizedProvince: actor.provinceCode,
            authorizedDistrict: actor.districtCode,
            attemptedProvince: dist.provinceCode,
            attemptedDistrict: dist.code,
          },
        });
        return {
          ok: false,
          status: 403,
          error: `ไม่มีสิทธิ์แก้ไขข้อมูลนอกเขตพื้นที่รับผิดชอบ บัญชีนี้แก้ไขได้เฉพาะ${actor.districtNameTh ?? actor.districtCode}เท่านั้น`,
        };
      }
    } else if (actor.role === 'province_reviewer') {
      if (actor.provinceCode !== dist.provinceCode) {
        this.appendAuditLog({
          eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
          actorUserId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          targetProvinceCode: dist.provinceCode,
          targetDistrictCode: dist.code,
          periodId,
          ipAddress,
          summaryTh: `สกัดกั้นการพยายามแก้ไขข้อมูลข้ามจังหวัดโดย ${actor.username} ไปยังรหัสจังหวัด ${dist.provinceCode}`,
          details: { authorizedProvince: actor.provinceCode, attemptedProvince: dist.provinceCode },
        });
        return {
          ok: false,
          status: 403,
          error: 'ไม่มีสิทธิ์ดำเนินการนอกเขตจังหวัดที่รับผิดชอบ',
        };
      }
    }

    const period = this.getPeriod(periodId);
    if (!period) {
      return { ok: false, status: 404, error: 'ไม่พบงวดเวลาที่ระบุ' };
    }
    if (period.status === 'locked') {
      return {
        ok: false,
        status: 409,
        error: `งวดข้อมูล ${period.labelTh} ถูกล็อกปิดงวดแล้ว ไม่สามารถแก้ไขย้อนหลังได้`,
      };
    }

    const currentRow = this.db
      .prepare(
        `SELECT metrics_json, version FROM district_period_metrics WHERE period_id = ? AND district_code = ?`,
      )
      .get(period.periodId, dist.code) as { metrics_json: string; version: number } | undefined;

    if (!currentRow) {
      return { ok: false, status: 404, error: 'ไม่พบข้อมูลตั้งต้นของอำเภอในงวดเวลานี้' };
    }

    const beforeMetrics = JSON.parse(currentRow.metrics_json) as DistrictMetricsPayload;
    const diffItems = computeMetricsDiff(beforeMetrics, afterMetrics);
    if (diffItems.length === 0) {
      return { ok: false, status: 400, error: 'ยังไม่มีรายการตัวชี้วัดที่เปลี่ยนแปลงจากค่าปัจจุบัน' };
    }

    const prov = PROVINCE_BY_CODE[dist.provinceCode]!;
    const beforeEval = evaluateDistrictMetrics(dist, prov, period.periodId, Number(currentRow.version), beforeMetrics, '', '');
    const afterEval = evaluateDistrictMetrics(dist, prov, period.periodId, Number(currentRow.version), afterMetrics, '', '');
    const nowIso = new Date().toISOString();

    const res = this.db
      .prepare(
        `INSERT INTO change_requests (
           period_id, province_code, district_code, submitted_by_user_id, submitted_by_name,
           submitted_at, status, reason_th, reference_doc, before_json, after_json, diff_json,
           before_ddpm_score, after_ddpm_score
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        period.periodId,
        dist.provinceCode,
        dist.code,
        actor.id,
        actor.displayNameTh,
        nowIso,
        reasonTh,
        referenceDoc,
        JSON.stringify(beforeMetrics),
        JSON.stringify(afterMetrics),
        JSON.stringify(diffItems),
        beforeEval.ddpmScore,
        afterEval.ddpmScore,
      );

    const requestId = Number(res.lastInsertRowid);

    this.appendAuditLog({
      eventType: 'DISTRICT_DRAFT_SUBMITTED',
      actorUserId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetProvinceCode: dist.provinceCode,
      targetDistrictCode: dist.code,
      periodId: period.periodId,
      ipAddress,
      summaryTh: `${actor.displayNameTh} ส่งคำขอปรับปรุงข้อมูล${dist.fullNameTh} (${diffItems.length} รายการ) งวด ${period.periodId} รอจังหวัดอนุมัติ`,
      details: {
        requestId,
        changedFields: diffItems.length,
        beforeDdpmScore: beforeEval.ddpmScore,
        afterDdpmScore: afterEval.ddpmScore,
        referenceDoc,
      },
    });

    const created = this.getChangeRequestById(requestId)!;
    return { ok: true, request: created };
  }

  public listChangeRequests(actor: AuthUser, periodId?: string): ChangeRequestRecord[] {
    let sql = `
      SELECT cr.*, p.label_th AS period_label_th
      FROM change_requests cr
      JOIN reporting_periods p ON p.period_id = cr.period_id
      WHERE 1 = 1
    `;
    const params: unknown[] = [];

    // Strict Server-Side Scope Filtering
    if (actor.role === 'district_officer') {
      sql += ' AND cr.district_code = ? AND cr.province_code = ?';
      params.push(actor.districtCode, actor.provinceCode);
    } else if (actor.role === 'province_reviewer') {
      sql += ' AND cr.province_code = ?';
      params.push(actor.provinceCode);
    }

    if (periodId) {
      sql += ' AND cr.period_id = ?';
      params.push(periodId);
    }

    sql += ' ORDER BY cr.id DESC LIMIT 100';
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.mapChangeRequestRow(r));
  }

  private getChangeRequestById(id: number): ChangeRequestRecord | null {
    const row = this.db
      .prepare(
        `SELECT cr.*, p.label_th AS period_label_th
         FROM change_requests cr
         JOIN reporting_periods p ON p.period_id = cr.period_id
         WHERE cr.id = ?`,
      )
      .get(id);
    if (!row) return null;
    return this.mapChangeRequestRow(row);
  }

  private mapChangeRequestRow(r: Record<string, unknown>): ChangeRequestRecord {
    const provCode = String(r.province_code);
    const distCode = String(r.district_code);
    const prov = PROVINCE_BY_CODE[provCode];
    const dist = this.districtsByCode.get(distCode);

    return {
      id: Number(r.id),
      periodId: String(r.period_id),
      periodLabelTh: String(r.period_label_th),
      provinceCode: provCode,
      provinceNameTh: prov ? prov.nameTh : provCode,
      districtCode: distCode,
      districtNameTh: dist ? dist.fullNameTh : distCode,
      submittedByUserId: String(r.submitted_by_user_id),
      submittedByName: String(r.submitted_by_name),
      submittedAt: String(r.submitted_at),
      status: String(r.status) as 'pending' | 'approved' | 'rejected',
      reasonTh: String(r.reason_th),
      referenceDoc: String(r.reference_doc ?? ''),
      beforeMetrics: JSON.parse(String(r.before_json)) as DistrictMetricsPayload,
      afterMetrics: JSON.parse(String(r.after_json)) as DistrictMetricsPayload,
      diffItems: JSON.parse(String(r.diff_json)) as MetricDiffItem[],
      beforeDdpmScore: Number(r.before_ddpm_score),
      afterDdpmScore: Number(r.after_ddpm_score),
      reviewedByName: r.reviewed_by_name ? String(r.reviewed_by_name) : null,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      reviewNoteTh: r.review_note_th ? String(r.review_note_th) : null,
    };
  }

  public reviewChangeRequest(input: {
    actor: AuthUser;
    requestId: number;
    decision: 'approve' | 'reject';
    reviewNoteTh: string;
    ipAddress: string;
  }): { ok: true; request: ChangeRequestRecord } | { ok: false; status: number; error: string } {
    const { actor, requestId, decision, reviewNoteTh, ipAddress } = input;
    const req = this.getChangeRequestById(requestId);
    if (!req) {
      return { ok: false, status: 404, error: 'ไม่พบรายการคำขอแก้ไขข้อมูลที่ระบุ' };
    }

    // Strict RBAC + ABAC: เจ้าหน้าที่อำเภอไม่สามารถอนุมัติคำขอได้ และ ปภ.จังหวัดอนุมัติได้เฉพาะจังหวัดตนเท่านั้น!
    if (actor.role === 'district_officer') {
      this.appendAuditLog({
        eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
        actorUserId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        targetProvinceCode: req.provinceCode,
        targetDistrictCode: req.districtCode,
        periodId: req.periodId,
        ipAddress,
        summaryTh: `สกัดกั้นการยกระดับสิทธิ์: เจ้าหน้าที่อำเภอ ${actor.username} พยายามอนุมัติคำขอ #${req.id}`,
        details: { requestId: req.id, attemptedDecision: decision },
      });
      return {
        ok: false,
        status: 403,
        error: 'เจ้าหน้าที่ระดับอำเภอไม่มีสิทธิ์อนุมัติคำขอแก้ไขข้อมูล ต้องผ่านการตรวจสอบจากระดับจังหวัด',
      };
    }

    if (actor.role === 'province_reviewer' && actor.provinceCode !== req.provinceCode) {
      this.appendAuditLog({
        eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
        actorUserId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        targetProvinceCode: req.provinceCode,
        targetDistrictCode: req.districtCode,
        periodId: req.periodId,
        ipAddress,
        summaryTh: `สกัดกั้นการอนุมัติข้ามจังหวัด: ${actor.username} (จังหวัด ${actor.provinceCode}) พยายามอนุมัติคำขอจังหวัด ${req.provinceCode}`,
        details: { requestId: req.id, authorizedProvince: actor.provinceCode, targetProvince: req.provinceCode },
      });
      return {
        ok: false,
        status: 403,
        error: 'ไม่มีสิทธิ์อนุมัติหรือปฏิเสธคำขอของจังหวัดอื่น',
      };
    }

    // Strict Maker-Checker Separation of Duties ทุกบทบาท: ห้ามผู้ส่งคำขออนุมัติคำขอของตนเอง
    if (req.submittedByUserId === actor.id) {
      this.appendAuditLog({
        eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
        actorUserId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        targetProvinceCode: req.provinceCode,
        targetDistrictCode: req.districtCode,
        periodId: req.periodId,
        ipAddress,
        summaryTh: `สกัดกั้นการอนุมัติคำขอของตนเองตามหลักตรวจสอบถ่วงดุล: ${actor.username} คำขอ #${req.id}`,
        details: { requestId: req.id, selfApprovalBlocked: true },
      });
      return {
        ok: false,
        status: 403,
        error: 'ผู้ส่งคำขอแก้ไขข้อมูลไม่สามารถอนุมัติคำขอของตนเองได้ กรุณาให้ผู้ตรวจสอบท่านอื่นพิจารณา',
      };
    }

    if (req.status !== 'pending') {
      return { ok: false, status: 409, error: 'คำขอนี้ได้รับการพิจารณาเรียบร้อยแล้ว' };
    }

    const period = this.getPeriod(req.periodId);
    if (!period || period.status === 'locked') {
      return { ok: false, status: 409, error: 'งวดข้อมูลนี้ถูกปิดล็อกแล้ว ไม่สามารถอนุมัติการเปลี่ยนแปลงได้' };
    }

    const nowIso = new Date().toISOString();
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE change_requests
           SET status = ?, reviewed_by_user_id = ?, reviewed_by_name = ?, reviewed_at = ?, review_note_th = ?
           WHERE id = ?`,
        )
        .run(nextStatus, actor.id, actor.displayNameTh, nowIso, reviewNoteTh, req.id);

      if (decision === 'approve') {
        this.db
          .prepare(
            `UPDATE district_period_metrics
             SET version = version + 1, metrics_json = ?, updated_by = ?, updated_at = ?
             WHERE period_id = ? AND district_code = ? AND province_code = ?`,
          )
          .run(
            JSON.stringify(req.afterMetrics),
            `${req.submittedByName} (อนุมัติโดย ${actor.displayNameTh})`,
            nowIso,
            req.periodId,
            req.districtCode,
            req.provinceCode,
          );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    // ล้างแคชของงวดเวลานั้นเพื่อให้แผนที่ ตาราง และแนวโน้มคำนวณใหม่ทันที
    if (decision === 'approve') {
      this.provinceCache.delete(req.periodId);
    }

    this.appendAuditLog({
      eventType: decision === 'approve' ? 'DISTRICT_CHANGE_APPROVED' : 'DISTRICT_CHANGE_REJECTED',
      actorUserId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetProvinceCode: req.provinceCode,
      targetDistrictCode: req.districtCode,
      periodId: req.periodId,
      ipAddress,
      summaryTh:
        decision === 'approve'
          ? `${actor.displayNameTh} อนุมัติและประกาศใช้ข้อมูล${req.districtNameTh} งวด ${req.periodId} (ความเสี่ยงสุทธิอำเภอ ${req.beforeDdpmScore.toFixed(2)} -> ${req.afterDdpmScore.toFixed(2)})`
          : `${actor.displayNameTh} ส่งกลับคำขอแก้ไขข้อมูล${req.districtNameTh} งวด ${req.periodId}`,
      details: {
        requestId: req.id,
        decision,
        beforeDdpmScore: req.beforeDdpmScore,
        afterDdpmScore: req.afterDdpmScore,
        reviewNoteTh,
      },
    });

    return { ok: true, request: this.getChangeRequestById(req.id)! };
  }

  // ==================== Central Admin: Temporal Period Management ====================

  public createNewPeriodClone(input: {
    actor: AuthUser;
    periodId: string;
    labelTh: string;
    effectiveFrom: string;
    sourcePeriodId?: string;
    ipAddress: string;
  }): { ok: true; period: ReportingPeriod } | { ok: false; status: number; error: string } {
    const { actor, periodId, labelTh, effectiveFrom, sourcePeriodId, ipAddress } = input;
    if (actor.role !== 'ddpm_central_admin') {
      this.appendAuditLog({
        eventType: 'UNAUTHORIZED_SCOPE_ATTEMPT',
        actorUserId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        targetProvinceCode: actor.provinceCode,
        targetDistrictCode: actor.districtCode,
        periodId,
        ipAddress,
        summaryTh: `สกัดกั้นการสร้างงวดข้อมูลใหม่โดยไม่มีสิทธิ์ส่วนกลาง (${actor.username})`,
        details: { attemptedPeriodId: periodId },
      });
      return { ok: false, status: 403, error: 'เฉพาะผู้ดูแลระบบส่วนกลาง กรม ปภ. เท่านั้นที่เปิดงวดข้อมูลใหม่ได้' };
    }

    if (!/^25\d{2}-Q[1-4]$/.test(periodId) && !/^25\d{2}-\d{2}$/.test(periodId)) {
      return { ok: false, status: 400, error: 'รูปแบบรหัสงวดไม่ถูกต้อง กรุณาใช้รูปแบบเช่น 2569-Q4 หรือ 2570-Q1' };
    }

    const exists = this.getPeriod(periodId);
    if (exists) {
      return { ok: false, status: 409, error: `มีงวดข้อมูล ${periodId} อยู่ในระบบแล้ว` };
    }

    const source = this.getPeriod(sourcePeriodId);
    if (!source) {
      return { ok: false, status: 404, error: 'ไม่พบงวดข้อมูลต้นทางสำหรับคัดลอกฐานข้อมูล' };
    }

    const nowIso = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE reporting_periods SET is_current = 0').run();
      this.db
        .prepare(
          `INSERT INTO reporting_periods (period_id, label_th, effective_from, effective_to, status, is_current, created_by, created_at)
           VALUES (?, ?, ?, NULL, 'open', 1, ?, ?)`,
        )
        .run(periodId, labelTh, effectiveFrom, actor.displayNameTh, nowIso);

      this.db
        .prepare(
          `INSERT INTO district_period_metrics (period_id, district_code, province_code, version, metrics_json, updated_by, updated_at)
           SELECT ?, district_code, province_code, 1, metrics_json, ?, ?
           FROM district_period_metrics
           WHERE period_id = ?`,
        )
        .run(periodId, `คัดลอกฐานจากงวด ${source.periodId} โดย ${actor.displayNameTh}`, nowIso, source.periodId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      eventType: 'PERIOD_CREATED',
      actorUserId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetProvinceCode: null,
      targetDistrictCode: null,
      periodId,
      ipAddress,
      summaryTh: `${actor.displayNameTh} เปิดงวดข้อมูลใหม่ ${labelTh} โดยคัดลอกฐาน 928 อำเภอ/เขตจากงวด ${source.periodId}`,
      details: { sourcePeriodId: source.periodId, effectiveFrom },
    });

    return { ok: true, period: this.getPeriod(periodId)! };
  }

  public updatePeriodStatus(input: {
    actor: AuthUser;
    periodId: string;
    status: 'open' | 'locked';
    ipAddress: string;
  }): { ok: true; period: ReportingPeriod } | { ok: false; status: number; error: string } {
    const { actor, periodId, status, ipAddress } = input;
    if (actor.role !== 'ddpm_central_admin') {
      return { ok: false, status: 403, error: 'เฉพาะผู้ดูแลระบบส่วนกลางเท่านั้นที่เปิดหรือล็อกงวดข้อมูลได้' };
    }
    const existing = this.getPeriod(periodId);
    if (!existing) {
      return { ok: false, status: 404, error: 'ไม่พบงวดข้อมูลที่ระบุ' };
    }
    this.db.prepare('UPDATE reporting_periods SET status = ? WHERE period_id = ?').run(status, periodId);
    this.appendAuditLog({
      eventType: 'PERIOD_STATUS_UPDATED',
      actorUserId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetProvinceCode: null,
      targetDistrictCode: null,
      periodId,
      ipAddress,
      summaryTh: `${actor.displayNameTh} เปลี่ยนสถานะงวด ${periodId} เป็น ${status === 'locked' ? 'ปิดงวด (ล็อก)' : 'เปิดรับการปรับปรุงข้อมูล'}`,
      details: { previousStatus: existing.status, nextStatus: status },
    });
    return { ok: true, period: this.getPeriod(periodId)! };
  }
}
