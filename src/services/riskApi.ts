import type {
  AuditChainVerification,
  AuditLogEntry,
  AuthUser,
  ChangeRequestRecord,
  DemoAccountInfo,
  DistrictEvaluation,
  DistrictMetricsPayload,
  PeriodProvincesResponse,
  ProvinceDistrictsResponse,
  ProvinceTrendPoint,
  ReportingPeriod,
} from '../types/index.ts';

export class ApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    csrfToken?: string | null;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.csrfToken) {
    headers['X-CSRF-Token'] = options.csrfToken;
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === 'string' ? data.error : `เกิดข้อผิดพลาดในการเชื่อมต่อ (รหัส ${res.status})`,
    );
  }
  return data as T;
}

// ==================== Public Endpoints ====================

export async function fetchPeriods(): Promise<ReportingPeriod[]> {
  const res = await requestJson<{ periods: ReportingPeriod[] }>('/api/public/periods');
  return res.periods;
}

export async function fetchProvincesForPeriod(periodId?: string): Promise<PeriodProvincesResponse> {
  const q = periodId ? `?period=${encodeURIComponent(periodId)}` : '';
  return requestJson<PeriodProvincesResponse>(`/api/public/provinces${q}`);
}

export async function fetchProvinceDistricts(
  provinceCode: string,
  periodId?: string,
): Promise<ProvinceDistrictsResponse> {
  const q = periodId ? `?period=${encodeURIComponent(periodId)}` : '';
  return requestJson<ProvinceDistrictsResponse>(
    `/api/public/provinces/${encodeURIComponent(provinceCode)}/districts${q}`,
  );
}

export async function fetchProvinceTrend(provinceCode: string): Promise<ProvinceTrendPoint[]> {
  const res = await requestJson<{ trend: ProvinceTrendPoint[] }>(
    `/api/public/provinces/${encodeURIComponent(provinceCode)}/trend`,
  );
  return res.trend;
}

// ==================== Auth & 2FA Endpoints ====================

export async function fetchDemoAccounts(): Promise<DemoAccountInfo[]> {
  const res = await requestJson<{ accounts: DemoAccountInfo[] }>('/api/auth/demo-accounts');
  return res.accounts;
}

export interface AuthSessionState {
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken?: string;
  expiresAt?: string;
  idleExpiresAt?: string;
}

export async function fetchCurrentSession(): Promise<AuthSessionState> {
  return requestJson<AuthSessionState>('/api/auth/me');
}

export interface LoginStep1Response {
  mfaRequired: boolean;
  challengeToken: string;
  expiresInSec: number;
  userPreview: AuthUser;
  demoTotpCode?: string;
}

export async function loginPasswordStep(
  username: string,
  password: string,
): Promise<LoginStep1Response> {
  return requestJson<LoginStep1Response>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export interface LoginStep2Response {
  authenticated: boolean;
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
}

export async function verifyTotpStep(
  challengeToken: string,
  code: string,
): Promise<LoginStep2Response> {
  return requestJson<LoginStep2Response>('/api/auth/verify-totp', {
    method: 'POST',
    body: { challengeToken, code },
  });
}

export async function logoutOfficer(csrfToken: string): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST', csrfToken });
}

// ==================== Officer Scoped & Maker-Checker Endpoints ====================

export interface OfficerScopeResponse {
  user: AuthUser;
  period: ReportingPeriod;
  assignedDistrict: DistrictEvaluation | null;
  provinceDistricts: DistrictEvaluation[];
  changeRequests: ChangeRequestRecord[];
}

export async function fetchOfficerScope(periodId?: string): Promise<OfficerScopeResponse> {
  const q = periodId ? `?period=${encodeURIComponent(periodId)}` : '';
  return requestJson<OfficerScopeResponse>(`/api/officer/scope${q}`);
}

export async function submitDistrictChange(
  districtCode: string,
  payload: {
    periodId: string;
    metrics: DistrictMetricsPayload;
    reasonTh: string;
    referenceDoc: string;
  },
  csrfToken: string,
): Promise<ChangeRequestRecord> {
  const res = await requestJson<{ request: ChangeRequestRecord }>(
    `/api/districts/${encodeURIComponent(districtCode)}/submissions`,
    {
      method: 'POST',
      body: payload,
      csrfToken,
    },
  );
  return res.request;
}

export async function reviewChangeRequestApi(
  requestId: number,
  decision: 'approve' | 'reject',
  reviewNoteTh: string,
  csrfToken: string,
): Promise<ChangeRequestRecord> {
  const res = await requestJson<{ request: ChangeRequestRecord }>(
    `/api/change-requests/${requestId}/review`,
    {
      method: 'POST',
      body: { decision, reviewNoteTh },
      csrfToken,
    },
  );
  return res.request;
}

export async function fetchAuditLogs(): Promise<{
  logs: AuditLogEntry[];
  chain: AuditChainVerification;
}> {
  return requestJson('/api/audit-logs?limit=80');
}

export async function verifyAuditChainApi(): Promise<AuditChainVerification> {
  const res = await requestJson<{ verification: AuditChainVerification }>('/api/admin/audit-verify');
  return res.verification;
}

export async function createPeriodCloneApi(
  payload: {
    periodId: string;
    labelTh: string;
    effectiveFrom: string;
    sourcePeriodId?: string;
  },
  csrfToken: string,
): Promise<ReportingPeriod> {
  const res = await requestJson<{ period: ReportingPeriod }>('/api/admin/periods', {
    method: 'POST',
    body: payload,
    csrfToken,
  });
  return res.period;
}

export async function updatePeriodStatusApi(
  periodId: string,
  status: 'open' | 'locked',
  csrfToken: string,
): Promise<ReportingPeriod> {
  const res = await requestJson<{ period: ReportingPeriod }>(
    `/api/admin/periods/${encodeURIComponent(periodId)}/status`,
    {
      method: 'PATCH',
      body: { status },
      csrfToken,
    },
  );
  return res.period;
}
