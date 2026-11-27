import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Unlock,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { PROVINCES_RISK_DATA } from '../../data/provincesRiskData.ts';
import { DISTRICT_BY_CODE, DISTRICTS_BY_PROVINCE } from '../../data/thailandDistrictsCatalog.ts';
import {
  ApiError,
  createPeriodCloneApi,
  fetchAuditLogs,
  fetchDemoAccounts,
  fetchOfficerScope,
  loginPasswordStep,
  logoutOfficer,
  reviewChangeRequestApi,
  submitDistrictChange,
  updatePeriodStatusApi,
  verifyAuditChainApi,
  verifyTotpStep,
} from '../../services/riskApi.ts';
import type {
  AuditChainVerification,
  AuditEventType,
  AuditLogEntry,
  AuthUser,
  ChangeRequestRecord,
  DemoAccountInfo,
  DistrictEvaluation,
  ReportingPeriod,
} from '../../types/index.ts';

interface OfficerPortalModalProps {
  open: boolean;
  onClose: () => void;
  periods: readonly ReportingPeriod[];
  activePeriodId: string;
  authUser: AuthUser | null;
  csrfToken: string | null;
  demoMode: boolean;
  initialProvinceCode?: string | null;
  initialDistrictCode?: string | null;
  onAuthChanged: (user: AuthUser | null, csrfToken: string | null) => void;
  onDataMutated: (selectPeriodId?: string) => Promise<void>;
  onOpenDistrictEditor: (provinceCode: string, districtCode?: string) => void;
}

const DEMO_PASSWORDS: Readonly<Record<string, string>> = {
  am_5001: 'Ddpm@5001#2569',
  am_5007: 'Ddpm@5007#2569',
  am_1001: 'Ddpm@1001#2569',
  am_3801: 'Ddpm@3801#2569',
  am_8301: 'Ddpm@8301#2569',
  pv_50: 'Ddpm@Prov50#2569',
  pv_10: 'Ddpm@Prov10#2569',
  admin_ddpm: 'Ddpm@Central#2569',
};

const ROLE_LABELS_TH: Record<AuthUser['role'], string> = {
  district_officer: 'เจ้าหน้าที่ระดับอำเภอ/เขต',
  province_reviewer: 'ผู้ตรวจสอบและอนุมัติระดับจังหวัด',
  ddpm_central_admin: 'ผู้ดูแลระบบส่วนกลาง กรม ปภ.',
};

const AUDIT_EVENT_LABELS_TH: Record<AuditEventType, string> = {
  SYSTEM_GENESIS: 'เริ่มต้นฐานข้อมูลระบบ',
  DEMO_ACCOUNT_PROVISIONED: 'เปิดบัญชีสาธิตประจำพื้นที่',
  LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ (2FA)',
  LOGIN_FAILED: 'รหัสผ่านไม่ถูกต้อง',
  LOGIN_LOCKED: 'ระงับบัญชีชั่วคราว',
  TOTP_FAILED: 'รหัสยืนยัน 2 ชั้นไม่ถูกต้อง',
  LOGOUT: 'ออกจากระบบ',
  DISTRICT_DRAFT_SUBMITTED: 'ส่งคำขอแก้ไขระดับอำเภอ',
  DISTRICT_CHANGE_APPROVED: 'จังหวัดอนุมัติประกาศใช้',
  DISTRICT_CHANGE_REJECTED: 'จังหวัดส่งกลับแก้ไข',
  PERIOD_CREATED: 'เปิดงวดข้อมูลใหม่',
  PERIOD_STATUS_UPDATED: 'เปลี่ยนสถานะงวดข้อมูล',
  UNAUTHORIZED_SCOPE_ATTEMPT: 'สกัดกั้นการแก้ไขข้ามเขตสิทธิ์',
  CSRF_REJECTED: 'สกัดกั้นคำขอที่ไม่ผ่านการยืนยันความปลอดภัย',
};

type PortalTab = 'queue' | 'security' | 'periods' | 'audit';

function formatThaiTimestamp(iso: string): string {
  try {
    const dt = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yearBe = dt.getFullYear() + 543;
    return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${yearBe} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return iso;
  }
}

export function OfficerPortalModal({
  open,
  onClose,
  periods,
  activePeriodId,
  authUser,
  csrfToken,
  demoMode,
  initialProvinceCode,
  initialDistrictCode,
  onAuthChanged,
  onDataMutated,
  onOpenDistrictEditor,
}: OfficerPortalModalProps) {
  // Login 2-Step State
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountInfo[]>([]);
  const [demoPickerProv, setDemoPickerProv] = useState<string>(initialProvinceCode ?? '50');
  const [demoPickerDist, setDemoPickerDist] = useState<string>(initialDistrictCode ?? '5001');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaStep, setMfaStep] = useState<{
    challengeToken: string;
    userPreview: AuthUser;
    demoTotpCode?: string;
  } | null>(null);
  const [totpInput, setTotpInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Authenticated Workspace State
  const [activeTab, setActiveTab] = useState<PortalTab>('queue');
  const [workPeriodId, setWorkPeriodId] = useState(activePeriodId);
  const [assignedDistrict, setAssignedDistrict] = useState<DistrictEvaluation | null>(null);
  const [provinceDistricts, setProvinceDistricts] = useState<DistrictEvaluation[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditChain, setAuditChain] = useState<AuditChainVerification | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [securityTestResult, setSecurityTestResult] = useState<{
    attemptedDistrict: string;
    status: number;
    message: string;
  } | null>(null);

  // Review Notes & New Period Form
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [newPeriodId, setNewPeriodId] = useState('2569-Q4');
  const [newPeriodLabel, setNewPeriodLabel] = useState('ไตรมาส 4/2569 (ต.ค.-ธ.ค. 2569)');
  const [newPeriodDate, setNewPeriodDate] = useState('2026-10-01');

  useEffect(() => {
    setWorkPeriodId(activePeriodId);
  }, [activePeriodId]);

  useEffect(() => {
    if (initialDistrictCode && DISTRICT_BY_CODE[initialDistrictCode]) {
      const meta = DISTRICT_BY_CODE[initialDistrictCode];
      setDemoPickerProv(meta.provinceCode);
      setDemoPickerDist(meta.code);
      if (!authUser && demoMode) {
        setUsername(`am_${meta.code}`);
        setPassword(`Ddpm@${meta.code}#2569`);
      }
    } else if (initialProvinceCode && DISTRICTS_BY_PROVINCE[initialProvinceCode]?.[0]) {
      setDemoPickerProv(initialProvinceCode);
      setDemoPickerDist(DISTRICTS_BY_PROVINCE[initialProvinceCode][0].code);
    }
  }, [initialProvinceCode, initialDistrictCode, authUser, demoMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || authUser) return;
    fetchDemoAccounts()
      .then((list) => setDemoAccounts(list))
      .catch(() => setDemoAccounts([]));
  }, [open, authUser]);

  const loadWorkspaceData = useCallback(
    async (periodIdToLoad: string) => {
      if (!authUser) return;
      setLoadingWorkspace(true);
      try {
        const [scopeRes, auditRes] = await Promise.all([
          fetchOfficerScope(periodIdToLoad),
          fetchAuditLogs(),
        ]);
        setAssignedDistrict(scopeRes.assignedDistrict);
        setProvinceDistricts(scopeRes.provinceDistricts);
        setChangeRequests(scopeRes.changeRequests);
        setAuditLogs(auditRes.logs);
        setAuditChain(auditRes.chain);
      } catch (err) {
        setFeedback({
          kind: 'error',
          text: err instanceof Error ? err.message : 'ไม่สามารถเรียกข้อมูลระบบเจ้าหน้าที่ได้',
        });
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [authUser],
  );

  useEffect(() => {
    if (!open || !authUser) return;
    if (authUser.role === 'district_officer') setActiveTab('security');
    else if (authUser.role === 'province_reviewer') setActiveTab('queue');
    else setActiveTab('periods');
    setFeedback(null);
    setSecurityTestResult(null);
    loadWorkspaceData(workPeriodId);
  }, [open, authUser, workPeriodId, loadWorkspaceData]);

  const sortedProvinces = useMemo(
    () => [...PROVINCES_RISK_DATA].sort((a, b) => a.nameTh.localeCompare(b.nameTh, 'th')),
    [],
  );

  const pickerDistricts = useMemo(
    () => DISTRICTS_BY_PROVINCE[demoPickerProv] ?? [],
    [demoPickerProv],
  );

  const pendingCount = useMemo(
    () => changeRequests.filter((r) => r.status === 'pending').length,
    [changeRequests],
  );

  if (!open) return null;

  const handleStep1Login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await loginPasswordStep(username, password);
      setMfaStep({
        challengeToken: res.challengeToken,
        userPreview: res.userPreview,
        demoTotpCode: res.demoTotpCode,
      });
      setTotpInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleStep2Verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaStep) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await verifyTotpStep(mfaStep.challengeToken, totpInput);
      setMfaStep(null);
      setPassword('');
      setTotpInput('');
      onAuthChanged(res.user, res.csrfToken);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'รหัสยืนยัน 2 ชั้นไม่ถูกต้อง');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (csrfToken) {
      try {
        await logoutOfficer(csrfToken);
      } catch {
        // ล้างสถานะหน้าเว็บเสมอ
      }
    }
    setAssignedDistrict(null);
    setFeedback(null);
    onAuthChanged(null, null);
  };

  const handleRunCrossDistrictSecurityTest = async () => {
    if (!assignedDistrict || !csrfToken) return;
    const unauthorizedCode =
      assignedDistrict.district.code === '5001'
        ? '5007'
        : assignedDistrict.district.code === '5007'
          ? '5001'
          : '5001';
    const unauthorizedLabel =
      unauthorizedCode === '5007' ? 'อำเภอแม่ริม (5007)' : 'อำเภอเมืองเชียงใหม่ (5001)';

    try {
      await submitDistrictChange(
        unauthorizedCode,
        {
          periodId: workPeriodId,
          metrics: assignedDistrict.metrics,
          reasonTh: 'ทดสอบระบบป้องกันการแก้ไขข้อมูลข้ามเขตอำนาจ',
          referenceDoc: 'ทดสอบสิทธิ์ระบบ',
        },
        csrfToken,
      );
      setSecurityTestResult({
        attemptedDistrict: unauthorizedLabel,
        status: 200,
        message: 'คำเตือน: ระบบไม่ควรอนุญาตคำขอนี้',
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 403;
      setSecurityTestResult({
        attemptedDistrict: unauthorizedLabel,
        status,
        message: err instanceof Error ? err.message : 'ถูกปฏิเสธสิทธิ์',
      });
      await loadWorkspaceData(workPeriodId);
    }
  };

  const handleReviewDecision = async (reqId: number, decision: 'approve' | 'reject') => {
    if (!csrfToken) return;
    setFeedback(null);
    try {
      const note = reviewNotes[reqId] ?? '';
      await reviewChangeRequestApi(reqId, decision, note, csrfToken);
      setFeedback({
        kind: 'success',
        text:
          decision === 'approve'
            ? `อนุมัติคำขอเลขที่ ${reqId} เรียบร้อยแล้ว แผนที่ 77 จังหวัด ตาราง และแนวโน้มได้รับการอัปเดตทันที`
            : `ส่งกลับคำขอเลขที่ ${reqId} ให้เจ้าหน้าที่ทบทวนแล้ว`,
      });
      await onDataMutated(workPeriodId);
      await loadWorkspaceData(workPeriodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถพิจารณาคำขอได้',
      });
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken) return;
    setFeedback(null);
    try {
      const created = await createPeriodCloneApi(
        {
          periodId: newPeriodId.trim(),
          labelTh: newPeriodLabel.trim(),
          effectiveFrom: newPeriodDate,
          sourcePeriodId: workPeriodId,
        },
        csrfToken,
      );
      setFeedback({
        kind: 'success',
        text: `เปิดงวดข้อมูลใหม่ ${created.labelTh} โดยคัดลอกฐาน 928 อำเภอ/เขตเรียบร้อยแล้ว`,
      });
      await onDataMutated(created.periodId);
      setWorkPeriodId(created.periodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถสร้างงวดข้อมูลใหม่ได้',
      });
    }
  };

  const handleTogglePeriodLock = async (per: ReportingPeriod) => {
    if (!csrfToken) return;
    setFeedback(null);
    const nextStatus = per.status === 'locked' ? 'open' : 'locked';
    try {
      await updatePeriodStatusApi(per.periodId, nextStatus, csrfToken);
      setFeedback({
        kind: 'success',
        text: `เปลี่ยนสถานะงวด ${per.labelTh} เป็น "${nextStatus === 'locked' ? 'ปิดงวด (ล็อก)' : 'เปิดแก้ไข'}" แล้ว`,
      });
      await onDataMutated(workPeriodId);
      await loadWorkspaceData(workPeriodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถเปลี่ยนสถานะงวดได้',
      });
    }
  };

  const handleReverifyAuditChain = async () => {
    try {
      const res = await verifyAuditChainApi();
      setAuditChain(res);
      setFeedback({
        kind: res.valid ? 'success' : 'error',
        text: res.valid
          ? `ตรวจพิสูจน์สายโซ่แฮช SHA-256 ครบทั้ง ${res.totalEntries} รายการ สมบูรณ์ 100%`
          : `ตรวจพบความไม่สมบูรณ์ที่ลำดับ ${res.brokenAtSeq}`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถตรวจสอบสายโซ่แฮชได้',
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="officer-portal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* ส่วนหัวพอร์ทัลเจ้าหน้าที่ */}
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#C89B3C] bg-[#0C2340] px-5 py-3.5 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="officer-portal-title" className="truncate text-sm sm:text-base font-bold">
                ระบบบริหารจัดการฐานข้อมูลและอนุมัติ (เจ้าหน้าที่ ปภ.)
              </h2>
              <p className="text-xs text-slate-300 truncate">
                ยืนยันตัวตน 2 ชั้น (TOTP) • จำกัดสิทธิ์เฉพาะอำเภอ/จังหวัด • บันทึกตรวจสอบ SHA-256
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {authUser && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1 rounded-lg bg-white/12 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>ออกจากระบบ</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่างเจ้าหน้าที่"
              className="rounded-lg p-1.5 text-slate-200 hover:bg-white/15"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ==================== หน้าเข้าสู่ระบบ 2 ชั้น (2FA) ==================== */}
        {!authUser ? (
          <div className="overflow-y-auto p-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-6 space-y-4">
              {!mfaStep ? (
                <form onSubmit={handleStep1Login} className="space-y-3.5">
                  <div>
                    <h3 className="text-base font-bold text-[#0C2340]">
                      ขั้นที่ 1: ยืนยันชื่อผู้ใช้และรหัสผ่านเจ้าหน้าที่
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                      ระบบเข้ารหัสรหัสผ่านด้วย scrypt และบังคับยืนยันรหัส 6 หลัก (TOTP) พร้อมจำกัดการลองรหัสผิด 5 ครั้ง
                    </p>
                  </div>

                  {authError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <div>
                    <label htmlFor="officer-username" className="block text-xs font-semibold text-slate-700 mb-1">
                      ชื่อผู้ใช้งาน
                    </label>
                    <input
                      id="officer-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="เช่น am_5001, pv_50 หรือ admin_ddpm"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                    />
                  </div>

                  <div>
                    <label htmlFor="officer-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      รหัสผ่าน
                    </label>
                    <div className="relative">
                      <input
                        id="officer-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="กรอกรหัสผ่านเจ้าหน้าที่"
                        className="h-10 w-full rounded-lg border border-slate-300 px-3 pr-10 text-sm text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0C2340] py-2.5 text-sm font-semibold text-white hover:bg-[#16355B] disabled:opacity-50"
                  >
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    <span>{authBusy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบรหัสผ่านและไปขั้น 2FA'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStep2Verify} className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950 space-y-1">
                    <p className="font-bold text-sm">{mfaStep.userPreview.displayNameTh}</p>
                    <p>{mfaStep.userPreview.positionTh}</p>
                  </div>

                  {mfaStep.demoTotpCode && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-950 space-y-2">
                      <p className="font-semibold">
                        รหัสยืนยัน 2 ชั้น (TOTP รอบ 30 วินาที — เฉพาะโหมดสาธิต):
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-2xl font-bold tracking-widest text-[#0C2340] tabular-nums">
                          {mfaStep.demoTotpCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => setTotpInput(mfaStep.demoTotpCode ?? '')}
                          className="rounded-lg bg-[#0C2340] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#16355B]"
                        >
                          กรอกรหัสนี้
                        </button>
                      </div>
                    </div>
                  )}

                  {authError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <div>
                    <label htmlFor="officer-totp" className="block text-xs font-semibold text-slate-700 mb-1">
                      รหัสยืนยันตัวตน 6 หลัก (ห้ามใช้ซ้ำภายในรอบ 30 วินาที)
                    </label>
                    <input
                      id="officer-totp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={totpInput}
                      onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="h-11 w-full rounded-lg border border-slate-300 px-3 text-center font-mono text-lg font-bold tracking-[0.4em] text-[#0C2340]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMfaStep(null);
                        setAuthError(null);
                      }}
                      className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="submit"
                      disabled={authBusy || totpInput.length !== 6}
                      className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {authBusy ? 'กำลังยืนยัน...' : 'ยืนยันรหัส 6 หลักเข้าสู่ระบบ'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* ฝั่งขวา: ตัวเลือกบัญชีทดสอบตามพื้นที่ครบ 77 จังหวัด 928 อำเภอ (เฉพาะโหมดสาธิต) */}
            <div className="lg:col-span-6 space-y-4">
              {demoMode && (
                <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#115E59]">
                      เลือกบัญชีทดสอบตามพื้นที่ (ครบ 77 จังหวัด 928 อำเภอ/เขต)
                    </h3>
                    <p className="text-xs text-teal-900 mt-0.5">
                      ระบบสาธิตสร้างบัญชีตามพื้นที่ที่เลือกให้โดยอัตโนมัติ และจำกัดสิทธิ์แก้ไขเฉพาะอำเภอหรือจังหวัดนั้น
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor="demo-pick-prov" className="block text-xs font-medium text-teal-950 mb-1">
                        จังหวัด (77 จังหวัด)
                      </label>
                      <select
                        id="demo-pick-prov"
                        value={demoPickerProv}
                        onChange={(e) => {
                          const pCode = e.target.value;
                          setDemoPickerProv(pCode);
                          const firstD = DISTRICTS_BY_PROVINCE[pCode]?.[0];
                          if (firstD) setDemoPickerDist(firstD.code);
                        }}
                        className="h-9 w-full rounded-lg border border-teal-300 bg-white px-2.5 text-xs text-slate-900"
                      >
                        {sortedProvinces.map((p) => (
                          <option key={p.dopaCode} value={p.dopaCode}>
                            {p.nameTh} ({p.dopaCode})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="demo-pick-dist" className="block text-xs font-medium text-teal-950 mb-1">
                        อำเภอ/เขต ({pickerDistricts.length} แห่ง)
                      </label>
                      <select
                        id="demo-pick-dist"
                        value={demoPickerDist}
                        onChange={(e) => setDemoPickerDist(e.target.value)}
                        className="h-9 w-full rounded-lg border border-teal-300 bg-white px-2.5 text-xs text-slate-900"
                      >
                        {pickerDistricts.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.fullNameTh} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUsername(`am_${demoPickerDist}`);
                        setPassword(`Ddpm@${demoPickerDist}#2569`);
                        setMfaStep(null);
                        setAuthError(null);
                      }}
                      className="rounded-lg bg-[#0D9488] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0F766E]"
                    >
                      ใช้บัญชีอำเภอนี้ (am_{demoPickerDist})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUsername(`pv_${demoPickerProv}`);
                        setPassword(`Ddpm@Prov${demoPickerProv}#2569`);
                        setMfaStep(null);
                        setAuthError(null);
                      }}
                      className="rounded-lg border border-teal-400 bg-white px-3 py-2 text-xs font-semibold text-[#115E59] hover:bg-teal-100/60"
                    >
                      ใช้บัญชี ปภ.จังหวัด (pv_{demoPickerProv})
                    </button>
                  </div>
                </div>
              )}

              {demoAccounts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                  <h4 className="text-xs font-bold text-[#0C2340]">บัญชีตัวอย่างแนะนำ</h4>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {demoAccounts.map((acc) => (
                      <button
                        key={acc.username}
                        type="button"
                        onClick={() => {
                          setUsername(acc.username);
                          setPassword(DEMO_PASSWORDS[acc.username] ?? '');
                          setMfaStep(null);
                          setAuthError(null);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0C2340] truncate">
                            {acc.displayNameTh} ({acc.username})
                          </p>
                          <p className="text-xs text-slate-500 truncate">{acc.scopeLabelTh}</p>
                        </div>
                        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          เลือก
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ==================== พื้นที่บริหารจัดการหลังผ่าน 2FA ==================== */
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* แถบข้อมูลผู้ใช้ + ปุ่มไปหน้ากรอกคะแนนเต็มจอ */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-bold text-emerald-950">
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {ROLE_LABELS_TH[authUser.role]}
                </span>
                <span className="font-semibold text-[#0C2340]">{authUser.displayNameTh}</span>
                <span className="text-slate-500">({authUser.positionTh})</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDistrictEditor(
                      authUser.provinceCode ?? '50',
                      authUser.districtCode ?? undefined,
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>เปิดหน้ากรอกคะแนนรายอำเภอ</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* แถบเมนูแท็บ */}
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-5">
              {authUser.role === 'district_officer' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('security')}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold ${
                    activeTab === 'security'
                      ? 'border-[#0C2340] text-[#0C2340]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>สิทธิ์อำเภอและทดสอบความปลอดภัย</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold ${
                  activeTab === 'queue'
                    ? 'border-[#0C2340] text-[#0C2340]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>คิวอนุมัติและคำขอ ({pendingCount})</span>
              </button>
              {authUser.role === 'ddpm_central_admin' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('periods')}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold ${
                    activeTab === 'periods'
                      ? 'border-[#0C2340] text-[#0C2340]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>จัดการงวดข้อมูล ({periods.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold ${
                  activeTab === 'audit'
                    ? 'border-[#0C2340] text-[#0C2340]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>ประวัติตรวจสอบ SHA-256 ({auditLogs.length})</span>
              </button>
            </div>

            {/* เนื้อหาภายในแท็บ */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {feedback && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                    feedback.kind === 'success'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                      : 'border-rose-300 bg-rose-50 text-rose-950'
                  }`}
                >
                  {feedback.kind === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 mt-0.5" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              {loadingWorkspace ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  กำลังโหลดข้อมูลและตรวจสายโซ่ตรวจสอบ...
                </p>
              ) : (
                <>
                  {/* แท็บสิทธิ์เฉพาะอำเภอและการทดสอบสกัดกั้น HTTP 403 */}
                  {activeTab === 'security' && authUser.role === 'district_officer' && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                      <div className="lg:col-span-7 space-y-3">
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5">
                          <h3 className="text-sm font-bold text-[#115E59]">
                            เขตพื้นที่รับผิดชอบของท่าน: {authUser.districtNameTh}
                          </h3>
                          <p className="text-xs text-emerald-950 leading-relaxed">
                            ท่านสามารถแก้ไขคะแนนตัวแปรครบทั้ง 23 รายการของ{authUser.districtNameTh}ในหน้ากรอกคะแนนเต็มจอ
                            และส่งคำขอให้ ปภ.จังหวัดตรวจสอบอนุมัติประกาศใช้ได้ทันที
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenDistrictEditor(
                                authUser.provinceCode ?? '50',
                                authUser.districtCode ?? undefined,
                              );
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C2340] px-4 py-2 text-xs font-semibold text-white hover:bg-[#16355B]"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            <span>กรอกคะแนน 23 ตัวแปรของ{authUser.districtNameTh}</span>
                          </button>
                        </div>

                        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-2.5 text-xs">
                          <h4 className="font-bold text-rose-950 flex items-center gap-1.5">
                            <ShieldAlert className="h-4 w-4 text-rose-700" aria-hidden="true" />
                            ทดสอบระบบป้องกันการแก้ไขข้ามอำเภอ
                          </h4>
                          <p className="text-rose-900 leading-relaxed">
                            ทดลองส่งคำขอแก้ไขไปยังอำเภออื่นนอกเขตอำนาจ ระบบฝั่งเซิร์ฟเวอร์จะปฏิเสธสิทธิ์ (HTTP 403) และบันทึกเหตุการณ์ลงในสายโซ่ SHA-256 ทันที
                          </p>
                          <button
                            type="button"
                            onClick={handleRunCrossDistrictSecurityTest}
                            className="rounded-lg bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-800"
                          >
                            ทดสอบการสกัดกั้นการแก้ไขข้ามเขต
                          </button>
                          {securityTestResult && (
                            <div className="rounded-lg border border-rose-300 bg-white p-3 text-xs text-slate-800 space-y-1">
                              <p className="font-bold text-rose-800 tabular-nums">
                                {securityTestResult.status === 403
                                  ? 'ผลการทดสอบ: ระบบปฏิเสธสิทธิ์ตามเขตอำนาจ (HTTP 403)'
                                  : 'ผลการทดสอบ: พบการอนุญาตผิดปกติ'}
                              </p>
                              <p>เป้าหมายที่พยายามเข้าถึง: {securityTestResult.attemptedDistrict}</p>
                              <p className="text-slate-600">{securityTestResult.message}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                        <h4 className="text-xs font-bold text-[#0C2340]">
                          อำเภอทั้งหมดในจังหวัดเดียวกัน ({provinceDistricts.length} แห่ง)
                        </h4>
                        <ul className="max-h-72 overflow-y-auto space-y-1 text-xs">
                          {provinceDistricts.map((d) => {
                            const isMine = d.district.code === authUser.districtCode;
                            return (
                              <li
                                key={d.district.code}
                                className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${
                                  isMine
                                    ? 'bg-emerald-100 font-bold text-emerald-950'
                                    : 'bg-white text-slate-500 border border-slate-100'
                                }`}
                              >
                                <span className="truncate">{d.district.fullNameTh}</span>
                                {isMine ? (
                                  <span className="shrink-0 text-emerald-800">แก้ไขได้</span>
                                ) : (
                                  <span className="inline-flex shrink-0 items-center gap-1">
                                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                    อ่านอย่างเดียว
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* แท็บคิวอนุมัติจังหวัด */}
                  {activeTab === 'queue' && (
                    <div className="space-y-3">
                      {changeRequests.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                          ยังไม่มีรายการคำขอแก้ไขข้อมูลในขอบเขตพื้นที่รับผิดชอบของท่าน
                        </div>
                      ) : (
                        changeRequests.map((req) => {
                          const canReview =
                            req.status === 'pending' &&
                            req.submittedByUserId !== authUser.id &&
                            (authUser.role === 'ddpm_central_admin' ||
                              (authUser.role === 'province_reviewer' &&
                                authUser.provinceCode === req.provinceCode));
                          const statusBadge =
                            req.status === 'pending'
                              ? 'bg-amber-100 text-amber-950 border-amber-300'
                              : req.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                                : 'bg-rose-100 text-rose-950 border-rose-300';
                          const statusLabel =
                            req.status === 'pending'
                              ? 'รอจังหวัดพิจารณา'
                              : req.status === 'approved'
                                ? 'อนุมัติและประกาศใช้แล้ว'
                                : 'ส่งกลับแก้ไข';

                          return (
                            <div
                              key={req.id}
                              className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-bold text-[#0C2340] tabular-nums">
                                      คำขอเลขที่ {req.id}: {req.districtNameTh} (
                                      {req.provinceCode === '10'
                                        ? req.provinceNameTh
                                        : `จ.${req.provinceNameTh}`}
                                      )
                                    </span>
                                    <span
                                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}
                                    >
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                                    งวด {req.periodId} • ผู้เสนอ: {req.submittedByName} •{' '}
                                    {formatThaiTimestamp(req.submittedAt)}
                                    {req.referenceDoc ? ` • อ้างอิง: ${req.referenceDoc}` : ''}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-right text-xs tabular-nums">
                                  <p className="text-slate-500">ความเสี่ยงอำเภอ</p>
                                  <p className="font-bold text-[#0C2340] text-sm">
                                    {req.beforeDdpmScore.toFixed(2)} → {req.afterDdpmScore.toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                <strong>เหตุผล:</strong> {req.reasonTh}
                              </p>

                              <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="w-full text-left text-xs tabular-nums">
                                  <thead className="bg-slate-100 text-slate-600">
                                    <tr>
                                      <th className="px-3 py-2">ตัวชี้วัดที่ปรับปรุง</th>
                                      <th className="px-3 py-2 text-right">ค่าเดิม</th>
                                      <th className="px-3 py-2 text-right">ค่าใหม่</th>
                                      <th className="px-3 py-2 text-right">เปลี่ยนแปลง</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {req.diffItems.map((d) => (
                                      <tr key={`${d.group}-${d.key}`}>
                                        <td className="px-3 py-2 font-medium text-slate-800">{d.labelTh}</td>
                                        <td className="px-3 py-2 text-right text-slate-600">
                                          {d.before?.toFixed(2) ?? 'N/A'}
                                        </td>
                                        <td className="px-3 py-2 text-right font-bold text-[#0C2340]">
                                          {d.after?.toFixed(2) ?? 'N/A'}
                                        </td>
                                        <td
                                          className={`px-3 py-2 text-right font-semibold ${
                                            d.group === 'C'
                                              ? d.delta > 0
                                                ? 'text-emerald-700'
                                                : 'text-rose-700'
                                              : d.delta < 0
                                                ? 'text-emerald-700'
                                                : 'text-rose-700'
                                          }`}
                                        >
                                          {d.delta > 0 ? `+${d.delta.toFixed(2)}` : d.delta.toFixed(2)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {req.reviewedByName && (
                                <p className="text-xs text-slate-600 tabular-nums">
                                  พิจารณาโดย: <strong>{req.reviewedByName}</strong> (
                                  {req.reviewedAt ? formatThaiTimestamp(req.reviewedAt) : '-'})
                                  {req.reviewNoteTh ? ` • ความเห็น: ${req.reviewNoteTh}` : ''}
                                </p>
                              )}

                              {canReview && (
                                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                                  <input
                                    type="text"
                                    value={reviewNotes[req.id] ?? ''}
                                    onChange={(e) =>
                                      setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                                    }
                                    placeholder="บันทึกความเห็นผู้ตรวจสอบ (ไม่บังคับ)"
                                    className="h-9 flex-1 min-w-[200px] rounded-lg border border-slate-300 px-3 text-xs text-slate-900"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleReviewDecision(req.id, 'reject')}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-50"
                                  >
                                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                    ส่งกลับแก้ไข
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReviewDecision(req.id, 'approve')}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    อนุมัติและประกาศใช้
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* แท็บจัดการงวดข้อมูล */}
                  {activeTab === 'periods' && authUser.role === 'ddpm_central_admin' && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                      <form
                        onSubmit={handleCreatePeriod}
                        className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                      >
                        <h3 className="text-sm font-bold text-[#0C2340]">
                          เปิดงวดรายงานใหม่ (คัดลอกฐาน 928 อำเภอ/เขต)
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          ระบบจะสร้างงวดใหม่โดยคัดลอกค่าล่าสุดเป็นจุดตั้งต้น ข้อมูลงวดย้อนหลังทั้งหมดจะคงอยู่ครบถ้วน
                        </p>
                        <div>
                          <label htmlFor="new-period-id" className="block text-xs font-semibold text-slate-700 mb-1">
                            รหัสงวดเวลา (เช่น 2569-Q4)
                          </label>
                          <input
                            id="new-period-id"
                            type="text"
                            required
                            value={newPeriodId}
                            onChange={(e) => setNewPeriodId(e.target.value)}
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 tabular-nums"
                          />
                        </div>
                        <div>
                          <label htmlFor="new-period-label" className="block text-xs font-semibold text-slate-700 mb-1">
                            ชื่อแสดงผลงวดข้อมูล
                          </label>
                          <input
                            id="new-period-label"
                            type="text"
                            required
                            value={newPeriodLabel}
                            onChange={(e) => setNewPeriodLabel(e.target.value)}
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                          />
                        </div>
                        <div>
                          <label htmlFor="new-period-date" className="block text-xs font-semibold text-slate-700 mb-1">
                            วันที่มีผลบังคับใช้
                          </label>
                          <input
                            id="new-period-date"
                            type="date"
                            required
                            value={newPeriodDate}
                            onChange={(e) => setNewPeriodDate(e.target.value)}
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 tabular-nums"
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full rounded-xl bg-[#0C2340] py-2 text-xs font-semibold text-white hover:bg-[#16355B]"
                        >
                          เปิดงวดข้อมูลใหม่
                        </button>
                      </form>

                      <div className="lg:col-span-7 space-y-2">
                        <h3 className="text-sm font-bold text-[#0C2340]">
                          รายการงวดข้อมูลทั้งหมด ({periods.length} งวด)
                        </h3>
                        {periods.map((per) => (
                          <div
                            key={per.periodId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-xs"
                          >
                            <div>
                              <p className="font-bold text-[#0C2340] tabular-nums">
                                {per.labelTh}{' '}
                                {per.isCurrent && (
                                  <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
                                    งวดปัจจุบัน
                                  </span>
                                )}
                              </p>
                              <p className="text-slate-500 tabular-nums mt-0.5">
                                รหัส {per.periodId} • เริ่มมีผล {per.effectiveFrom}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTogglePeriodLock(per)}
                              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                                per.status === 'locked'
                                  ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                              }`}
                            >
                              {per.status === 'locked' ? (
                                <>
                                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                  เปิดแก้ไขอีกครั้ง
                                </>
                              ) : (
                                <>
                                  <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                                  ปิดงวดข้อมูล
                                </>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* แท็บประวัติตรวจสอบ SHA-256 */}
                  {activeTab === 'audit' && (
                    <div className="space-y-3">
                      {auditChain && (
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3.5 text-xs ${
                            auditChain.valid
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                              : 'border-rose-300 bg-rose-50 text-rose-950'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="font-bold flex items-center gap-1.5">
                              <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                              {auditChain.valid
                                ? `สายโซ่บันทึกตรวจสอบ SHA-256 สมบูรณ์ 100% (${auditChain.totalEntries} รายการ)`
                                : `ตรวจพบความไม่สมบูรณ์ที่ลำดับ ${auditChain.brokenAtSeq}`}
                            </p>
                            <p className="opacity-80 font-mono truncate max-w-md">
                              SHA-256 ล่าสุด: {auditChain.latestHash.slice(0, 32)}...
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleReverifyAuditChain}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-400 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            ตรวจสอบสายโซ่อีกครั้ง
                          </button>
                        </div>
                      )}

                      <div className="space-y-2">
                        {auditLogs.map((entry) => {
                          const isAlert =
                            entry.eventType === 'UNAUTHORIZED_SCOPE_ATTEMPT' ||
                            entry.eventType === 'LOGIN_LOCKED' ||
                            entry.eventType === 'CSRF_REJECTED' ||
                            entry.eventType === 'TOTP_FAILED';
                          return (
                            <div
                              key={entry.seq}
                              className={`rounded-xl border p-3 text-xs ${
                                isAlert
                                  ? 'border-rose-300 bg-rose-50/80'
                                  : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                    isAlert
                                      ? 'bg-rose-700 text-white'
                                      : 'bg-slate-100 text-slate-800'
                                  }`}
                                >
                                  ลำดับ {entry.seq} • {AUDIT_EVENT_LABELS_TH[entry.eventType]}
                                </span>
                                <span className="text-slate-500 tabular-nums">
                                  {formatThaiTimestamp(entry.createdAt)} • ผู้ดำเนินการ:{' '}
                                  {entry.actorUsername ?? 'ระบบ'}
                                </span>
                              </div>
                              <p className="mt-1.5 text-slate-800 leading-relaxed">{entry.summaryTh}</p>
                              <p className="mt-1 text-slate-400 font-mono truncate">
                                SHA-256: {entry.entryHash.slice(0, 28)}...
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
