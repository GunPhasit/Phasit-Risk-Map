import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { HAZARD_CATALOG } from '../../data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../../data/indicatorCatalog.ts';
import { PROVINCE_BY_CODE } from '../../data/provincesRiskData.ts';
import { evaluateDistrictMetrics } from '../../domain/districtRollup.ts';
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
  DistrictMetricsPayload,
  ReportingPeriod,
} from '../../types/index.ts';
import { RiskBadge } from '../common/RiskBadge.tsx';

interface OfficerPortalModalProps {
  open: boolean;
  onClose: () => void;
  periods: readonly ReportingPeriod[];
  activePeriodId: string;
  authUser: AuthUser | null;
  csrfToken: string | null;
  onAuthChanged: (user: AuthUser | null, csrfToken: string | null) => void;
  onDataMutated: (selectPeriodId?: string) => Promise<void>;
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

type PortalTab = 'edit' | 'queue' | 'periods' | 'audit';

function cloneMetrics(m: DistrictMetricsPayload): DistrictMetricsPayload {
  return {
    hazards: { ...m.hazards },
    exposureIndicators: { ...m.exposureIndicators },
    vulnerabilityIndicators: { ...m.vulnerabilityIndicators },
    capacityIndicators: { ...m.capacityIndicators },
  };
}

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
  onAuthChanged,
  onDataMutated,
}: OfficerPortalModalProps) {
  // Login 2-Step State
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountInfo[]>([]);
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
  const [activeTab, setActiveTab] = useState<PortalTab>('edit');
  const [workPeriodId, setWorkPeriodId] = useState(activePeriodId);
  const [assignedDistrict, setAssignedDistrict] = useState<DistrictEvaluation | null>(null);
  const [provinceDistricts, setProvinceDistricts] = useState<DistrictEvaluation[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditChain, setAuditChain] = useState<AuditChainVerification | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // District Editor State
  const [draftMetrics, setDraftMetrics] = useState<DistrictMetricsPayload | null>(null);
  const [editSection, setEditSection] = useState<'C' | 'H' | 'E' | 'V'>('C');
  const [reasonTh, setReasonTh] = useState('');
  const [referenceDoc, setReferenceDoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [securityTestResult, setSecurityTestResult] = useState<{
    attemptedDistrict: string;
    status: number;
    message: string;
  } | null>(null);

  // Province Review Note by request ID
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // Central Admin New Period Form
  const [newPeriodId, setNewPeriodId] = useState('2569-Q4');
  const [newPeriodLabel, setNewPeriodLabel] = useState('ไตรมาส 4/2569 (ต.ค.-ธ.ค. 2569)');
  const [newPeriodDate, setNewPeriodDate] = useState('2026-10-01');

  useEffect(() => {
    setWorkPeriodId(activePeriodId);
  }, [activePeriodId]);

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

        if (scopeRes.assignedDistrict) {
          setDraftMetrics(cloneMetrics(scopeRes.assignedDistrict.metrics));
        } else {
          setDraftMetrics(null);
        }
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
    if (authUser.role === 'district_officer') setActiveTab('edit');
    else if (authUser.role === 'province_reviewer') setActiveTab('queue');
    else setActiveTab('periods');
    setFeedback(null);
    setSecurityTestResult(null);
    loadWorkspaceData(workPeriodId);
  }, [open, authUser, workPeriodId, loadWorkspaceData]);

  const workPeriod = useMemo(
    () => periods.find((p) => p.periodId === workPeriodId) ?? periods[periods.length - 1],
    [periods, workPeriodId],
  );

  // คำนวณ Draft Impact Preview ทันทีเมื่อเจ้าหน้าที่อำเภอปรับตัวชี้วัด
  const draftPreview = useMemo(() => {
    if (!assignedDistrict || !draftMetrics) return null;
    const prov = PROVINCE_BY_CODE[assignedDistrict.district.provinceCode];
    if (!prov) return null;
    return evaluateDistrictMetrics(
      assignedDistrict.district,
      prov,
      workPeriodId,
      assignedDistrict.version,
      draftMetrics,
      '',
      '',
    );
  }, [assignedDistrict, draftMetrics, workPeriodId]);

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
        // เคลียร์สถานะฝั่งหน้าเว็บเสมอ
      }
    }
    setAssignedDistrict(null);
    setDraftMetrics(null);
    setFeedback(null);
    onAuthChanged(null, null);
  };

  const handleSubmitDistrictEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedDistrict || !draftMetrics || !csrfToken) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await submitDistrictChange(
        assignedDistrict.district.code,
        {
          periodId: workPeriodId,
          metrics: draftMetrics,
          reasonTh,
          referenceDoc,
        },
        csrfToken,
      );
      setReasonTh('');
      setReferenceDoc('');
      setFeedback({
        kind: 'success',
        text: `ส่งคำขอปรับปรุงข้อมูล${assignedDistrict.district.fullNameTh}เรียบร้อยแล้ว ขณะนี้อยู่ระหว่างรอหัวหน้าสำนักงาน ปภ. จังหวัดตรวจสอบและอนุมัติ`,
      });
      await loadWorkspaceData(workPeriodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถบันทึกคำขอแก้ไขได้',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ทดสอบยิงคำขอแก้ไขข้ามอำเภอจริงไปยังเซิร์ฟเวอร์เพื่อให้ผู้ใช้เห็นการสกัดกั้น HTTP 403 และ Audit Log
  const handleRunCrossDistrictSecurityTest = async () => {
    if (!assignedDistrict || !draftMetrics || !csrfToken) return;
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
          metrics: draftMetrics,
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
            ? `อนุมัติคำขอเลขที่ ${reqId} เรียบร้อยแล้ว ระบบปรับปรุงแผนที่ 77 จังหวัด ตารางจัดอันดับ และกราฟแนวโน้มแล้ว`
            : `ส่งกลับคำขอเลขที่ ${reqId} ให้เจ้าหน้าที่ทบทวนแล้ว`,
      });
      await onDataMutated(workPeriodId);
      await loadWorkspaceData(workPeriodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถดำเนินการพิจารณาคำขอได้',
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
        },
        csrfToken,
      );
      setFeedback({
        kind: 'success',
        text: `เปิดงวดข้อมูลใหม่ "${created.labelTh}" พร้อมคัดลอกฐานข้อมูล 928 อำเภอ/เขตเรียบร้อยแล้ว`,
      });
      await onDataMutated(created.periodId);
      await loadWorkspaceData(created.periodId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถเปิดงวดข้อมูลใหม่ได้',
      });
    }
  };

  const handleTogglePeriodLock = async (per: ReportingPeriod) => {
    if (!csrfToken) return;
    setFeedback(null);
    const nextStatus = per.status === 'open' ? 'locked' : 'open';
    try {
      await updatePeriodStatusApi(per.periodId, nextStatus, csrfToken);
      setFeedback({
        kind: 'success',
        text: `ปรับสถานะงวด ${per.periodId} เป็น "${nextStatus === 'locked' ? 'ปิดงวดข้อมูล' : 'เปิดรับการปรับปรุง'}" แล้ว`,
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
      const verified = await verifyAuditChainApi();
      setAuditChain(verified);
      setFeedback({
        kind: verified.valid ? 'success' : 'error',
        text: verified.valid
          ? `ตรวจพิสูจน์สายโซ่บันทึกตรวจสอบ SHA-256 ครบทั้ง ${verified.totalEntries} รายการ ไม่พบการแก้ไขย้อนหลัง`
          : `แจ้งเตือนความปลอดภัย: พบความไม่สมบูรณ์ของบันทึกที่ลำดับ ${verified.brokenAtSeq}`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถตรวจพิสูจน์สายโซ่บันทึกตรวจสอบได้',
      });
    }
  };

  const scopeBadgeText = authUser
    ? authUser.role === 'district_officer'
      ? `แก้ไขได้เฉพาะ: ${authUser.districtNameTh} ${authUser.provinceCode === '10' ? authUser.provinceNameTh : `จังหวัด${authUser.provinceNameTh}`}`
      : authUser.role === 'province_reviewer'
        ? `อนุมัติข้อมูลเฉพาะ: ${authUser.provinceCode === '10' ? authUser.provinceNameTh : `จังหวัด${authUser.provinceNameTh}`}`
        : 'กำกับดูแลส่วนกลาง 77 จังหวัด 928 อำเภอ/เขต'
    : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="officer-portal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* ส่วนหัวพอร์ทัล */}
        <div className="flex items-center justify-between gap-3 bg-[#0F294A] px-4 py-3 text-white border-b-2 border-[#D97706] sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
              <ShieldCheck className="h-4.5 w-4.5 text-amber-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="officer-portal-title" className="truncate text-sm sm:text-base font-bold">
                ระบบจัดการฐานข้อมูลความเสี่ยงสำหรับเจ้าหน้าที่ ปภ.
              </h2>
              <p className="text-[11px] text-slate-300 truncate">
                ยืนยันตัวตน 2 ชั้น และจำกัดสิทธิ์แก้ไขเฉพาะเขตอำเภอในจังหวัดที่สังกัด
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างระบบเจ้าหน้าที่"
            className="rounded-lg p-1.5 text-slate-200 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ==================== หน้าจอเข้าสู่ระบบ (ยังไม่ล็อกอิน) ==================== */}
        {!authUser ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* ฟอร์มเข้าสู่ระบบ 2 ขั้น */}
              <div className="lg:col-span-6 space-y-4">
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-slate-700 leading-relaxed">
                  <p className="font-semibold text-[#0F294A] flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                    ประกาศคุ้มครองข้อมูลส่วนบุคคลและความปลอดภัยไซเบอร์
                  </p>
                  <p className="mt-1">
                    พื้นที่นี้สงวนไว้สำหรับเจ้าหน้าที่ที่ได้รับอนุญาต ระบบใช้ข้อมูลการเข้าสู่ระบบชั่วคราวเพื่อยืนยันตัวตน
                    และบันทึกประวัติการแก้ไขตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)
                    โดยหน้าแผนที่ประชาชนทั่วไปไม่มีการเก็บคุกกี้ติดตาม
                  </p>
                </div>

                {authError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 flex items-start gap-2"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{authError}</span>
                  </div>
                )}

                {!mfaStep ? (
                  <form onSubmit={handleStep1Login} className="space-y-3.5">
                    <h3 className="text-sm font-bold text-[#0F294A]">
                      ขั้นตอนที่ 1: ยืนยันรหัสประจำตัวเจ้าหน้าที่
                    </h3>

                    <div>
                      <label htmlFor="officer-username" className="block text-xs font-semibold text-slate-700 mb-1">
                        ชื่อบัญชีเจ้าหน้าที่
                      </label>
                      <input
                        id="officer-username"
                        type="text"
                        required
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="เช่น am_5001, pv_50 หรือ admin_ddpm"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8]"
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
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm text-slate-900 focus:border-[#1D4ED8]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={authBusy}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F294A] py-2.5 text-sm font-semibold text-white hover:bg-[#163A66] disabled:opacity-60"
                    >
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      {authBusy ? 'กำลังตรวจสอบสิทธิ์...' : 'ถัดไป: ยืนยันตัวตน 2 ชั้น (2FA)'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleStep2Verify} className="space-y-3.5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
                      <p className="font-bold text-emerald-950">{mfaStep.userPreview.displayNameTh}</p>
                      <p className="text-emerald-800">{mfaStep.userPreview.positionTh}</p>
                    </div>

                    <h3 className="text-sm font-bold text-[#0F294A]">
                      ขั้นตอนที่ 2: กรอกรหัสยืนยัน 2 ชั้น (6 หลัก เปลี่ยนทุก 30 วินาที)
                    </h3>

                    {mfaStep.demoTotpCode && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs space-y-1.5">
                        <p className="font-semibold text-amber-950">
                          รหัสยืนยัน 2 ชั้นสำหรับทดสอบในเครื่อง (โหมดสาธิตเท่านั้น)
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xl font-extrabold tracking-widest text-[#0F294A] tabular-nums">
                            {mfaStep.demoTotpCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => setTotpInput(mfaStep.demoTotpCode ?? '')}
                            className="rounded-lg bg-amber-900 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-950"
                          >
                            ใช้รหัสนี้
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label htmlFor="officer-totp" className="block text-xs font-semibold text-slate-700 mb-1">
                        รหัสยืนยัน 6 หลัก (ห้ามใช้ซ้ำ)
                      </label>
                      <input
                        id="officer-totp"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={totpInput}
                        onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-bold tracking-[0.35em] text-[#0F294A] tabular-nums focus:border-[#1D4ED8]"
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
                        {authBusy ? 'กำลังยืนยัน...' : 'ยืนยันตัวตนเข้าสู่ระบบ'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* รายการบัญชีตัวอย่างเพื่อทดสอบขอบเขตสิทธิ์แต่ละระดับ */}
              <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-[#0F294A]">
                  บัญชีตัวอย่างสำหรับทดสอบระบบสิทธิ์ (คลิกเพื่อกรอกอัตโนมัติ)
                </h3>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  เลือกเข้าสู่ระบบในฐานะ <strong>เจ้าหน้าที่อำเภอเมืองเชียงใหม่</strong> เพื่อส่งคำขอแก้ไขเฉพาะเขตอำเภอ
                  จากนั้นสลับเป็น <strong>หัวหน้าสำนักงาน ปภ. จังหวัดเชียงใหม่</strong> เพื่อตรวจอนุมัติและดูผลปรับปรุงบนแผนที่ทันที
                </p>

                <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                  {demoAccounts.map((acc) => {
                    const roleColor =
                      acc.role === 'district_officer'
                        ? 'bg-blue-100 text-blue-900'
                        : acc.role === 'province_reviewer'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-amber-100 text-amber-950';
                    return (
                      <button
                        key={acc.username}
                        type="button"
                        onClick={() => {
                          setMfaStep(null);
                          setAuthError(null);
                          setUsername(acc.username);
                          setPassword(DEMO_PASSWORDS[acc.username] ?? '');
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-[#1D4ED8] hover:bg-blue-50/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#0F294A]">{acc.displayNameTh}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColor}`}>
                            {ROLE_LABELS_TH[acc.role]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-700">{acc.scopeLabelTh}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                          ชื่อผู้ใช้: <strong>{acc.username}</strong>
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ==================== พื้นที่ทำงานเจ้าหน้าที่ (ล็อกอินแล้ว) ==================== */
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* แถบระบุขอบเขตสิทธิ์อย่างชัดเจน */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 px-4 py-2.5 border-b border-slate-200 text-xs">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#0F294A] px-2.5 py-1 font-semibold text-white">
                  <UserCheck className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                  {authUser.displayNameTh}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-1 font-bold text-emerald-950">
                  <Lock className="h-3 w-3 text-emerald-800" aria-hidden="true" />
                  {scopeBadgeText}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="เลือกงวดข้อมูลสำหรับจัดการ"
                  value={workPeriodId}
                  onChange={(e) => setWorkPeriodId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-[#0F294A]"
                >
                  {periods.map((p) => (
                    <option key={p.periodId} value={p.periodId}>
                      {p.labelTh} {p.status === 'locked' ? '(ปิดงวด)' : '(เปิดแก้ไข)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-800 hover:border-rose-200"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  ออกจากระบบ
                </button>
              </div>
            </div>

            {/* แถบเมนูแท็บการทำงาน */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 pt-2">
              {authUser.role === 'district_officer' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('edit')}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
                    activeTab === 'edit'
                      ? 'border-[#0F294A] text-[#0F294A]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  แก้ไขข้อมูลอำเภอของท่าน
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
                  activeTab === 'queue'
                    ? 'border-[#0F294A] text-[#0F294A]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {authUser.role === 'district_officer'
                  ? 'สถานะคำขอของอำเภอ'
                  : 'รายการรอตรวจอนุมัติ'}
                {pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white tabular-nums">
                    {pendingCount}
                  </span>
                )}
              </button>

              {authUser.role === 'ddpm_central_admin' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('periods')}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
                    activeTab === 'periods'
                      ? 'border-[#0F294A] text-[#0F294A]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  จัดการงวดรายงาน
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
                  activeTab === 'audit'
                    ? 'border-[#0F294A] text-[#0F294A]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                ประวัติตรวจสอบและความปลอดภัย
              </button>
            </div>

            {/* เนื้อหาหลักของแต่ละแท็บ */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {feedback && (
                <div
                  role="status"
                  className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium flex items-start gap-2 ${
                    feedback.kind === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
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
                <div className="py-10 text-center text-xs text-slate-500">
                  กำลังดึงข้อมูลจากระบบ...
                </div>
              ) : (
                <>
                  {/* ==================== แท็บ 1: แก้ไขข้อมูลเฉพาะอำเภอของตนเอง ==================== */}
                  {activeTab === 'edit' && authUser.role === 'district_officer' && assignedDistrict && draftMetrics && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                      <form onSubmit={handleSubmitDistrictEdit} className="lg:col-span-8 space-y-4">
                        {workPeriod?.status === 'locked' && (
                          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                            <strong>งวดข้อมูลนี้ปิดรับการแก้ไขแล้ว:</strong> งวด {workPeriod.labelTh} เป็นข้อมูลย้อนหลังสำหรับอ้างอิงเท่านั้น
                            กรุณาเลือกงวดปัจจุบันที่เปิดแก้ไขได้จากแถบด้านบน
                          </div>
                        )}

                        {/* การ์ดเปรียบเทียบผลลัพธ์ก่อน-หลังแบบเรียลไทม์ */}
                        {draftPreview && (
                          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center tabular-nums">
                            <div className="rounded-lg bg-white p-2 border border-slate-200">
                              <p className="text-[10px] text-slate-500">ความเสี่ยงอำเภอเดิม</p>
                              <p className="text-lg font-bold text-slate-800">
                                {assignedDistrict.ddpmScore.toFixed(2)}
                              </p>
                              <RiskBadge level={assignedDistrict.ddpmLevel} size="sm" compact variant="tinted" />
                            </div>
                            <div className="rounded-lg bg-white p-2 border border-blue-200 ring-1 ring-blue-300">
                              <p className="text-[10px] font-semibold text-[#0F294A]">
                                คาดการณ์หลังอนุมัติ
                              </p>
                              <p className="text-lg font-extrabold text-[#0F294A]">
                                {draftPreview.ddpmScore.toFixed(2)}
                              </p>
                              <RiskBadge level={draftPreview.ddpmLevel} size="sm" compact />
                            </div>
                            <div className="rounded-lg bg-white p-2 border border-slate-200 flex flex-col justify-center">
                              <p className="text-[10px] text-slate-500">ผลต่างความเสี่ยง</p>
                              <p
                                className={`text-base font-bold ${
                                  draftPreview.ddpmScore - assignedDistrict.ddpmScore < -0.005
                                    ? 'text-emerald-700'
                                    : draftPreview.ddpmScore - assignedDistrict.ddpmScore > 0.005
                                      ? 'text-rose-700'
                                      : 'text-slate-600'
                                }`}
                              >
                                {draftPreview.ddpmScore - assignedDistrict.ddpmScore > 0 ? '+' : ''}
                                {(draftPreview.ddpmScore - assignedDistrict.ddpmScore).toFixed(2)}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                ศักยภาพ {draftPreview.capacityScore.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* เลือกหมวดตัวชี้วัดที่จะแก้ไข */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {(
                            [
                              { id: 'C' as const, label: 'ศักยภาพ (5)' },
                              { id: 'H' as const, label: 'ภัยคุกคาม (10)' },
                              { id: 'E' as const, label: 'ล่อแหลม (4)' },
                              { id: 'V' as const, label: 'เปราะบาง (4)' },
                            ] as const
                          ).map((sec) => (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() => setEditSection(sec.id)}
                              className={`rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                                editSection === sec.id
                                  ? sec.id === 'C'
                                    ? 'border-[#0F766E] bg-[#0F766E] text-white'
                                    : 'border-[#0F294A] bg-[#0F294A] text-white'
                                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {sec.label}
                            </button>
                          ))}
                        </div>

                        {/* ตัวเลื่อนปรับคะแนน 1.00 - 5.00 */}
                        <div className="space-y-2.5 max-h-[270px] overflow-y-auto pr-1">
                          {editSection === 'C' &&
                            CAPACITY_INDICATORS.map((ind) => {
                              const orig = assignedDistrict.metrics.capacityIndicators[ind.id];
                              const val = draftMetrics.capacityIndicators[ind.id];
                              return (
                                <div
                                  key={ind.id}
                                  className="rounded-xl border border-teal-200 bg-teal-50/40 p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <label htmlFor={`edit-${ind.id}`} className="font-semibold text-slate-800">
                                      {ind.nameTh}
                                    </label>
                                    <span className="shrink-0 font-bold text-[#0F766E] tabular-nums">
                                      {orig.toFixed(2)} → {val.toFixed(2)}
                                    </span>
                                  </div>
                                  <input
                                    id={`edit-${ind.id}`}
                                    type="range"
                                    min={1}
                                    max={5}
                                    step={0.05}
                                    disabled={workPeriod?.status === 'locked'}
                                    value={val}
                                    onChange={(e) =>
                                      setDraftMetrics((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              capacityIndicators: {
                                                ...prev.capacityIndicators,
                                                [ind.id]: parseFloat(e.target.value),
                                              },
                                            }
                                          : prev,
                                      )
                                    }
                                    className="w-full accent-[#0F766E]"
                                  />
                                </div>
                              );
                            })}

                          {editSection === 'H' &&
                            HAZARD_CATALOG.map((haz) => {
                              const orig = assignedDistrict.metrics.hazards[haz.id];
                              const val = draftMetrics.hazards[haz.id];
                              if (orig === null || val === null) {
                                return (
                                  <div
                                    key={haz.id}
                                    className="rounded-xl border border-slate-200 bg-slate-100 p-2.5 text-xs text-slate-500 flex items-center justify-between"
                                  >
                                    <span>{haz.nameTh}</span>
                                    <span>ไม่เข้าข่ายเชิงภูมิศาสตร์ (N/A)</span>
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={haz.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <label htmlFor={`edit-${haz.id}`} className="font-semibold text-slate-800">
                                      {haz.nameTh}
                                    </label>
                                    <span className="shrink-0 font-bold text-[#0F294A] tabular-nums">
                                      {orig.toFixed(2)} → {val.toFixed(2)}
                                    </span>
                                  </div>
                                  <input
                                    id={`edit-${haz.id}`}
                                    type="range"
                                    min={1}
                                    max={5}
                                    step={0.05}
                                    disabled={workPeriod?.status === 'locked'}
                                    value={val}
                                    onChange={(e) =>
                                      setDraftMetrics((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              hazards: {
                                                ...prev.hazards,
                                                [haz.id]: parseFloat(e.target.value),
                                              },
                                            }
                                          : prev,
                                      )
                                    }
                                    className="w-full accent-[#0F294A]"
                                  />
                                </div>
                              );
                            })}

                          {editSection === 'E' &&
                            EXPOSURE_INDICATORS.map((ind) => {
                              const orig = assignedDistrict.metrics.exposureIndicators[ind.id];
                              const val = draftMetrics.exposureIndicators[ind.id];
                              return (
                                <div
                                  key={ind.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <label htmlFor={`edit-${ind.id}`} className="font-semibold text-slate-800">
                                      {ind.nameTh}
                                    </label>
                                    <span className="shrink-0 font-bold text-[#0F294A] tabular-nums">
                                      {orig.toFixed(2)} → {val.toFixed(2)}
                                    </span>
                                  </div>
                                  <input
                                    id={`edit-${ind.id}`}
                                    type="range"
                                    min={1}
                                    max={5}
                                    step={0.05}
                                    disabled={workPeriod?.status === 'locked'}
                                    value={val}
                                    onChange={(e) =>
                                      setDraftMetrics((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              exposureIndicators: {
                                                ...prev.exposureIndicators,
                                                [ind.id]: parseFloat(e.target.value),
                                              },
                                            }
                                          : prev,
                                      )
                                    }
                                    className="w-full accent-[#0F294A]"
                                  />
                                </div>
                              );
                            })}

                          {editSection === 'V' &&
                            VULNERABILITY_INDICATORS.map((ind) => {
                              const orig = assignedDistrict.metrics.vulnerabilityIndicators[ind.id];
                              const val = draftMetrics.vulnerabilityIndicators[ind.id];
                              return (
                                <div
                                  key={ind.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <label htmlFor={`edit-${ind.id}`} className="font-semibold text-slate-800">
                                      {ind.nameTh}
                                    </label>
                                    <span className="shrink-0 font-bold text-[#0F294A] tabular-nums">
                                      {orig.toFixed(2)} → {val.toFixed(2)}
                                    </span>
                                  </div>
                                  <input
                                    id={`edit-${ind.id}`}
                                    type="range"
                                    min={1}
                                    max={5}
                                    step={0.05}
                                    disabled={workPeriod?.status === 'locked'}
                                    value={val}
                                    onChange={(e) =>
                                      setDraftMetrics((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              vulnerabilityIndicators: {
                                                ...prev.vulnerabilityIndicators,
                                                [ind.id]: parseFloat(e.target.value),
                                              },
                                            }
                                          : prev,
                                      )
                                    }
                                    className="w-full accent-[#0F294A]"
                                  />
                                </div>
                              );
                            })}
                        </div>

                        {/* ช่องเหตุผลและเอกสารอ้างอิง */}
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          <div className="sm:col-span-2">
                            <label htmlFor="submit-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                              เหตุผลประกอบการปรับปรุงข้อมูล (จำเป็น)
                            </label>
                            <input
                              id="submit-reason"
                              type="text"
                              required
                              minLength={5}
                              maxLength={500}
                              disabled={workPeriod?.status === 'locked'}
                              value={reasonTh}
                              onChange={(e) => setReasonTh(e.target.value)}
                              placeholder="เช่น ติดตั้งเสาสัญญาณ Cell Broadcast เพิ่มและอบรม อปพร. 350 คน"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                            />
                          </div>
                          <div>
                            <label htmlFor="submit-ref" className="block text-xs font-semibold text-slate-700 mb-1">
                              เลขที่หนังสืออ้างอิง
                            </label>
                            <input
                              id="submit-ref"
                              type="text"
                              maxLength={120}
                              disabled={workPeriod?.status === 'locked'}
                              value={referenceDoc}
                              onChange={(e) => setReferenceDoc(e.target.value)}
                              placeholder="เช่น ชม 0021.1/ว 2045"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setDraftMetrics(cloneMetrics(assignedDistrict.metrics))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            คืนค่าปัจจุบัน
                          </button>
                          <button
                            type="submit"
                            disabled={submitting || workPeriod?.status === 'locked'}
                            className="rounded-xl bg-[#0F294A] px-5 py-2 text-xs font-semibold text-white hover:bg-[#163A66] disabled:opacity-50"
                          >
                            {submitting
                              ? 'กำลังส่งคำขอ...'
                              : `ส่งคำขอปรับปรุงข้อมูล${assignedDistrict.district.fullNameTh}`}
                          </button>
                        </div>
                      </form>

                      {/* ด้านขวา: แสดงรายการอำเภออื่นที่ถูกล็อก + ปุ่มทดสอบการสกัดกั้นข้ามเขต */}
                      <div className="lg:col-span-4 space-y-3">
                        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 space-y-2 text-xs">
                          <h4 className="font-bold text-rose-950 flex items-center gap-1.5">
                            <ShieldAlert className="h-4 w-4 text-rose-700" aria-hidden="true" />
                            ทดสอบระบบป้องกันการแก้ไขข้ามอำเภอ
                          </h4>
                          <p className="text-[11px] text-rose-900 leading-relaxed">
                            ทดลองส่งคำขอแก้ไขข้อมูลไปยังอำเภออื่นนอกเขตอำนาจ
                            ระบบจะตรวจสอบสิทธิ์บัญชีโดยตรง ปฏิเสธคำขอทันที และบันทึกเหตุการณ์ลงในประวัติตรวจสอบ
                          </p>
                          <button
                            type="button"
                            onClick={handleRunCrossDistrictSecurityTest}
                            className="w-full rounded-lg bg-rose-700 py-1.5 text-xs font-semibold text-white hover:bg-rose-800"
                          >
                            ทดสอบการสกัดกั้นการแก้ไขข้ามเขต
                          </button>
                          {securityTestResult && (
                            <div className="rounded-lg border border-rose-300 bg-white p-2 text-[11px] text-slate-800 space-y-0.5">
                              <p className="font-bold text-rose-800 tabular-nums">
                                {securityTestResult.status === 403
                                  ? 'ผลการตรวจสอบ: ระบบปฏิเสธสิทธิ์ตามเขตอำนาจ'
                                  : 'ผลการตรวจสอบ: พบการอนุญาตผิดปกติ'}
                              </p>
                              <p>เป้าหมายที่พยายามเข้าถึง: {securityTestResult.attemptedDistrict}</p>
                              <p className="text-slate-600">{securityTestResult.message}</p>
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                          <h4 className="text-xs font-bold text-[#0F294A]">
                            อำเภออื่นในจังหวัดเดียวกัน (อ่านอย่างเดียว)
                          </h4>
                          <ul className="max-h-[210px] overflow-y-auto space-y-1 text-[11px]">
                            {provinceDistricts.map((d) => {
                              const isMine = d.district.code === authUser.districtCode;
                              return (
                                <li
                                  key={d.district.code}
                                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${
                                    isMine
                                      ? 'bg-emerald-100 font-bold text-emerald-950'
                                      : 'bg-white text-slate-500 border border-slate-100'
                                  }`}
                                >
                                  <span className="truncate">{d.district.fullNameTh}</span>
                                  {isMine ? (
                                    <span className="shrink-0 text-[10px] text-emerald-800">
                                      แก้ไขได้
                                    </span>
                                  ) : (
                                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px]">
                                      <Lock className="h-3 w-3" aria-hidden="true" />
                                      จำกัดสิทธิ์
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ==================== แท็บ 2: คิวอนุมัติจังหวัด / ติดตามคำขอ ==================== */}
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
                              className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-bold text-[#0F294A] tabular-nums">
                                      คำขอเลขที่ {req.id}: {req.districtNameTh} (
                                      {req.provinceCode === '10'
                                        ? req.provinceNameTh
                                        : `จ.${req.provinceNameTh}`}
                                      )
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge}`}
                                    >
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                                    งวด {req.periodId} | ผู้เสนอ: {req.submittedByName} |{' '}
                                    {formatThaiTimestamp(req.submittedAt)}
                                    {req.referenceDoc ? ` | อ้างอิง: ${req.referenceDoc}` : ''}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1 text-right text-xs tabular-nums">
                                  <p className="text-[10px] text-slate-500">ความเสี่ยงอำเภอ</p>
                                  <p className="font-bold text-[#0F294A]">
                                    {req.beforeDdpmScore.toFixed(2)} → {req.afterDdpmScore.toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                <strong>เหตุผล:</strong> {req.reasonTh}
                              </p>

                              {/* ตารางเทียบค่าเดิม -> ค่าใหม่ */}
                              <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="w-full text-left text-[11px] tabular-nums">
                                  <thead className="bg-slate-100 text-slate-600">
                                    <tr>
                                      <th className="px-2.5 py-1.5">ตัวชี้วัดที่ปรับปรุง</th>
                                      <th className="px-2.5 py-1.5 text-right">ค่าเดิม</th>
                                      <th className="px-2.5 py-1.5 text-right">ค่าใหม่</th>
                                      <th className="px-2.5 py-1.5 text-right">เปลี่ยนแปลง</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {req.diffItems.map((d) => (
                                      <tr key={`${d.group}-${d.key}`}>
                                        <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                          {d.labelTh}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-right text-slate-600">
                                          {d.before?.toFixed(2) ?? 'N/A'}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-right font-bold text-[#0F294A]">
                                          {d.after?.toFixed(2) ?? 'N/A'}
                                        </td>
                                        <td
                                          className={`px-2.5 py-1.5 text-right font-semibold ${
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
                                <p className="text-[11px] text-slate-600 tabular-nums">
                                  พิจารณาโดย: <strong>{req.reviewedByName}</strong> (
                                  {req.reviewedAt ? formatThaiTimestamp(req.reviewedAt) : '-'})
                                  {req.reviewNoteTh ? ` | ความเห็น: ${req.reviewNoteTh}` : ''}
                                </p>
                              )}

                              {canReview && (
                                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                                  <input
                                    type="text"
                                    value={reviewNotes[req.id] ?? ''}
                                    onChange={(e) =>
                                      setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                                    }
                                    placeholder="บันทึกความเห็นผู้ตรวจสอบ (ไม่บังคับ)"
                                    className="flex-1 min-w-[200px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleReviewDecision(req.id, 'reject')}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50"
                                  >
                                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                    ส่งกลับแก้ไข
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReviewDecision(req.id, 'approve')}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    อนุมัติและประกาศใช้ทันที
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* ==================== แท็บ 3: จัดการงวดข้อมูลตามกาลเวลา (ส่วนกลาง ปภ.) ==================== */}
                  {activeTab === 'periods' && authUser.role === 'ddpm_central_admin' && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                      <form
                        onSubmit={handleCreatePeriod}
                        className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                      >
                        <h3 className="text-sm font-bold text-[#0F294A]">
                          เปิดงวดรายงานใหม่ (คัดลอกฐาน 928 อำเภอ/เขต)
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          ระบบจะสร้างงวดเวลาใหม่โดยคัดลอกค่าล่าสุดเป็นจุดตั้งต้น ข้อมูลในงวดย้อนหลังทั้งหมดจะคงอยู่ครบถ้วนไม่ถูกเขียนทับ
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
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 tabular-nums"
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
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
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
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 tabular-nums"
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full rounded-xl bg-[#0F294A] py-2 text-xs font-semibold text-white hover:bg-[#163A66]"
                        >
                          เปิดงวดข้อมูลใหม่ทันที
                        </button>
                      </form>

                      <div className="lg:col-span-7 space-y-2">
                        <h3 className="text-sm font-bold text-[#0F294A]">
                          รายการงวดข้อมูลทั้งหมด ({periods.length} งวด)
                        </h3>
                        {periods.map((per) => (
                          <div
                            key={per.periodId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs"
                          >
                            <div>
                              <p className="font-bold text-[#0F294A] tabular-nums">
                                {per.labelTh}{' '}
                                {per.isCurrent && (
                                  <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-900">
                                    งวดปัจจุบัน
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-slate-500 tabular-nums">
                                รหัส {per.periodId} | เริ่มมีผล {per.effectiveFrom}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTogglePeriodLock(per)}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
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

                  {/* ==================== แท็บ 4: ประวัติตรวจสอบย้อนหลังและสายโซ่ SHA-256 ==================== */}
                  {activeTab === 'audit' && (
                    <div className="space-y-3">
                      {auditChain && (
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
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
                                : `ตรวจพบความไม่สมบูรณ์ของสายโซ่ข้อมูลที่ลำดับ ${auditChain.brokenAtSeq}`}
                            </p>
                            <p className="text-[11px] opacity-80 font-mono truncate max-w-md">
                              รหัสตรวจสอบล่าสุด (SHA-256): {auditChain.latestHash.slice(0, 32)}...
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleReverifyAuditChain}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-400 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            ตรวจสอบความถูกต้องอีกครั้ง
                          </button>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {auditLogs.map((entry) => {
                          const isAlert =
                            entry.eventType === 'UNAUTHORIZED_SCOPE_ATTEMPT' ||
                            entry.eventType === 'LOGIN_LOCKED' ||
                            entry.eventType === 'CSRF_REJECTED' ||
                            entry.eventType === 'TOTP_FAILED';
                          return (
                            <div
                              key={entry.seq}
                              className={`rounded-xl border p-2.5 text-xs ${
                                isAlert
                                  ? 'border-rose-300 bg-rose-50/80'
                                  : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    isAlert
                                      ? 'bg-rose-700 text-white'
                                      : 'bg-slate-100 text-slate-800'
                                  }`}
                                >
                                  ลำดับ {entry.seq} {AUDIT_EVENT_LABELS_TH[entry.eventType]}
                                </span>
                                <span className="text-[10px] text-slate-500 tabular-nums">
                                  {formatThaiTimestamp(entry.createdAt)} | ผู้ดำเนินการ:{' '}
                                  {entry.actorUsername ?? 'ระบบ'}
                                </span>
                              </div>
                              <p className="mt-1 text-slate-800 leading-relaxed">{entry.summaryTh}</p>
                              <p className="mt-1 text-[10px] text-slate-400 font-mono truncate">
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
