import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Database,
  HelpCircle,
  Lock,
  Map as MapIcon,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { HAZARD_CATALOG, HAZARD_IDS } from '../../data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../../data/indicatorCatalog.ts';
import { PROVINCE_BY_CODE, PROVINCES_RISK_DATA } from '../../data/provincesRiskData.ts';
import {
  CAPACITY_LEVEL_STYLES,
  REGION6_LABELS,
  REGION_FILTER_OPTIONS,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette.ts';
import {
  DISTRICT_BY_CODE,
  DISTRICTS_BY_PROVINCE,
  THAILAND_DISTRICTS_CATALOG,
} from '../../data/thailandDistrictsCatalog.ts';
import {
  DISTRICT_GEO_CLASS_LABELS_TH,
  VARIABLE_RUBRICS,
  type VariableKey,
} from '../../data/variableRubricCatalog.ts';
import {
  aggregateDistrictsToProvince,
  evaluateDistrictMetrics,
} from '../../domain/districtRollup.ts';
import { clampScore, computeProvinceHevc, round2, scoreToRiskLevel } from '../../domain/riskCalculator.ts';
import {
  buildFallbackDistrictCatalogSummary,
  buildFallbackProvinceDistricts,
} from '../../services/districtFallback.ts';
import {
  fetchDistrictsCatalog,
  fetchProvinceDistricts,
  fetchProvinceProgress,
  submitDistrictChange,
} from '../../services/riskApi.ts';
import type {
  AuthUser,
  DistrictCatalogSummaryItem,
  DistrictEvaluation,
  DistrictGeoClass,
  DistrictMetricsPayload,
  ProvinceProgressResponse,
  ProvinceRiskRecord,
  RegionFilterKey,
  ReportingPeriod,
} from '../../types/index.ts';
import { RiskBadge } from '../common/RiskBadge.tsx';

interface DistrictScoreWorkspaceProps {
  periods: readonly ReportingPeriod[];
  activePeriodId: string;
  provincesData: readonly ProvinceRiskRecord[];
  initialProvinceCode: string | null;
  initialDistrictCode: string | null;
  authUser: AuthUser | null;
  csrfToken: string | null;
  dbConnected: boolean;
  sandboxMetricsByDistrict: Readonly<Record<string, DistrictMetricsPayload>>;
  onUpdateSandboxDistrict: (districtCode: string, metrics: DistrictMetricsPayload | null) => void;
  onClearAllSandbox: () => void;
  onChangePeriod: (periodId: string) => void;
  onOpenOfficerLoginForDistrict: (provinceCode: string, districtCode: string) => void;
  onOpenOfficerQueue: () => void;
  onJumpToProvinceOnMap: (provinceCode: string) => void;
  onDataMutated: (selectPeriodId?: string) => Promise<void>;
  onProvinceDistrictsLoaded: (provinceCode: string, districts: readonly DistrictEvaluation[]) => void;
  onAnnounce: (msg: string) => void;
}

type EntryMode = 'sandbox' | 'officer';
type PillarTab = 'H' | 'E' | 'V' | 'C';

function cloneMetrics(m: DistrictMetricsPayload): DistrictMetricsPayload {
  return {
    hazards: { ...m.hazards },
    exposureIndicators: { ...m.exposureIndicators },
    vulnerabilityIndicators: { ...m.vulnerabilityIndicators },
    capacityIndicators: { ...m.capacityIndicators },
  };
}

function countDiffsByPillar(
  base: DistrictMetricsPayload,
  draft: DistrictMetricsPayload,
): { H: number; E: number; V: number; C: number; total: number; maxDelta: number } {
  let H = 0;
  let E = 0;
  let V = 0;
  let C = 0;
  let maxDelta = 0;

  for (const id of HAZARD_IDS) {
    const b = base.hazards[id];
    const a = draft.hazards[id];
    if (b !== null && a !== null) {
      const diff = Math.abs(a - b);
      if (diff >= 0.005) {
        H += 1;
        if (diff > maxDelta) maxDelta = diff;
      }
    }
  }
  for (const ind of EXPOSURE_INDICATORS) {
    const diff = Math.abs(draft.exposureIndicators[ind.id] - base.exposureIndicators[ind.id]);
    if (diff >= 0.005) {
      E += 1;
      if (diff > maxDelta) maxDelta = diff;
    }
  }
  for (const ind of VULNERABILITY_INDICATORS) {
    const diff = Math.abs(draft.vulnerabilityIndicators[ind.id] - base.vulnerabilityIndicators[ind.id]);
    if (diff >= 0.005) {
      V += 1;
      if (diff > maxDelta) maxDelta = diff;
    }
  }
  for (const ind of CAPACITY_INDICATORS) {
    const diff = Math.abs(draft.capacityIndicators[ind.id] - base.capacityIndicators[ind.id]);
    if (diff >= 0.005) {
      C += 1;
      if (diff > maxDelta) maxDelta = diff;
    }
  }
  return { H, E, V, C, total: H + E + V + C, maxDelta: round2(maxDelta) };
}

function hasFlatlineScores(draft: DistrictMetricsPayload): boolean {
  const vals: number[] = [];
  for (const id of HAZARD_IDS) {
    const v = draft.hazards[id];
    if (v !== null) vals.push(v);
  }
  for (const ind of EXPOSURE_INDICATORS) vals.push(draft.exposureIndicators[ind.id]);
  for (const ind of VULNERABILITY_INDICATORS) vals.push(draft.vulnerabilityIndicators[ind.id]);
  for (const ind of CAPACITY_INDICATORS) vals.push(draft.capacityIndicators[ind.id]);
  if (vals.length === 0) return false;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return max - min < 0.05;
}

const GEO_FILTER_OPTIONS: readonly { key: 'all' | DistrictGeoClass; labelTh: string }[] = [
  { key: 'all', labelTh: 'ทุกพื้นที่' },
  { key: 'metro', labelTh: 'เขตเมือง' },
  { key: 'coastal', labelTh: 'ชายฝั่ง' },
  { key: 'mountain', labelTh: 'ภูเขา' },
  { key: 'river_basin', labelTh: 'ลุ่มน้ำ' },
  { key: 'rural', labelTh: 'ชนบท' },
];

export function DistrictScoreWorkspace({
  periods,
  activePeriodId,
  provincesData,
  initialProvinceCode,
  initialDistrictCode,
  authUser,
  csrfToken,
  dbConnected,
  sandboxMetricsByDistrict,
  onUpdateSandboxDistrict,
  onClearAllSandbox,
  onChangePeriod,
  onOpenOfficerLoginForDistrict,
  onOpenOfficerQueue,
  onJumpToProvinceOnMap,
  onDataMutated,
  onProvinceDistrictsLoaded,
  onAnnounce,
}: DistrictScoreWorkspaceProps) {
  const defaultDistrictCode = useMemo(() => {
    if (initialDistrictCode && DISTRICT_BY_CODE[initialDistrictCode]) return initialDistrictCode;
    if (initialProvinceCode && DISTRICTS_BY_PROVINCE[initialProvinceCode]?.[0]) {
      return DISTRICTS_BY_PROVINCE[initialProvinceCode][0].code;
    }
    if (authUser?.districtCode && DISTRICT_BY_CODE[authUser.districtCode]) {
      return authUser.districtCode;
    }
    return '5001'; // อำเภอเมืองเชียงใหม่
  }, [initialDistrictCode, initialProvinceCode, authUser]);

  const [entryMode, setEntryMode] = useState<EntryMode>(authUser ? 'officer' : 'sandbox');
  const [selectedDistrictCode, setSelectedDistrictCode] = useState<string>(defaultDistrictCode);
  const [regionFilter, setRegionFilter] = useState<RegionFilterKey>('all');
  const [provinceFilter, setProvinceFilter] = useState<string>(
    DISTRICT_BY_CODE[defaultDistrictCode]?.provinceCode ?? 'all',
  );
  const [geoFilter, setGeoFilter] = useState<'all' | DistrictGeoClass>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'modified' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(40);
  const [activePillar, setActivePillar] = useState<PillarTab>('H');
  const [openRubricKey, setOpenRubricKey] = useState<VariableKey | null>(null);

  // รายการ 928 อำเภอจาก API (fallback จากชุดในเครื่องทันที)
  const [catalogItems, setCatalogItems] = useState<DistrictCatalogSummaryItem[]>(() =>
    buildFallbackDistrictCatalogSummary(activePeriodId),
  );
  const [provinceDistrictsMap, setProvinceDistrictsMap] = useState<
    Record<string, readonly DistrictEvaluation[]>
  >({});
  const [officerDraft, setOfficerDraft] = useState<DistrictMetricsPayload | null>(null);
  const [reasonTh, setReasonTh] = useState('');
  const [referenceDoc, setReferenceDoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [provinceProgress, setProvinceProgress] = useState<ProvinceProgressResponse | null>(null);

  // ซิงก์เมื่อมีจังหวัด/อำเภอตั้งต้นส่งเข้ามาใหม่ (เช่น คลิกจากการค้นหาหรือแท็บรายอำเภอ)
  useEffect(() => {
    if (initialDistrictCode && DISTRICT_BY_CODE[initialDistrictCode]) {
      setSelectedDistrictCode(initialDistrictCode);
      setProvinceFilter(DISTRICT_BY_CODE[initialDistrictCode].provinceCode);
    } else if (initialProvinceCode && DISTRICTS_BY_PROVINCE[initialProvinceCode]?.[0]) {
      setProvinceFilter(initialProvinceCode);
      setSelectedDistrictCode(DISTRICTS_BY_PROVINCE[initialProvinceCode][0].code);
    }
  }, [initialProvinceCode, initialDistrictCode]);

  // เมื่อเจ้าหน้าที่เข้าสู่ระบบแล้ว ให้สลับเป็นโหมดบันทึกฐานข้อมูลและพาไปอำเภอในเขตสิทธิ์
  useEffect(() => {
    if (authUser) {
      setEntryMode('officer');
      if (authUser.districtCode && DISTRICT_BY_CODE[authUser.districtCode]) {
        setSelectedDistrictCode(authUser.districtCode);
        setProvinceFilter(authUser.provinceCode ?? 'all');
      } else if (authUser.provinceCode && DISTRICTS_BY_PROVINCE[authUser.provinceCode]?.[0]) {
        setProvinceFilter(authUser.provinceCode);
        setSelectedDistrictCode(DISTRICTS_BY_PROVINCE[authUser.provinceCode][0].code);
      }
    }
  }, [authUser]);

  // โหลดแคตตาล็อก 928 อำเภอจาก API (ถ้าออนไลน์)
  useEffect(() => {
    let cancelled = false;
    fetchDistrictsCatalog(activePeriodId)
      .then((res) => {
        if (!cancelled && res.districts.length > 0) {
          setCatalogItems(res.districts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogItems(buildFallbackDistrictCatalogSummary(activePeriodId));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePeriodId]);

  // โหลดข้อมูลทุกอำเภอของจังหวัดที่กำลังเลือก เพื่อคำนวณผลรวมระดับจังหวัดแบบแม่นยำ 7 โปรไฟล์
  const selectedDistrictMeta = DISTRICT_BY_CODE[selectedDistrictCode] ?? THAILAND_DISTRICTS_CATALOG[0];
  const selectedProvinceCode = selectedDistrictMeta.provinceCode;
  const selectedProvinceBase =
    provincesData.find((p) => p.dopaCode === selectedProvinceCode) ??
    PROVINCE_BY_CODE[selectedProvinceCode];

  useEffect(() => {
    let cancelled = false;
    fetchProvinceDistricts(selectedProvinceCode, activePeriodId)
      .then((res) => {
        if (cancelled) return;
        setProvinceDistrictsMap((prev) => ({ ...prev, [selectedProvinceCode]: res.districts }));
        onProvinceDistrictsLoaded(selectedProvinceCode, res.districts);
      })
      .catch(() => {
        if (cancelled) return;
        const fb = buildFallbackProvinceDistricts(selectedProvinceCode, activePeriodId);
        setProvinceDistrictsMap((prev) => ({ ...prev, [selectedProvinceCode]: fb }));
        onProvinceDistrictsLoaded(selectedProvinceCode, fb);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProvinceCode, activePeriodId, onProvinceDistrictsLoaded]);

  // โหลดแถบความคืบหน้าสำหรับเจ้าหน้าที่ที่ล็อกอินแล้ว
  useEffect(() => {
    if (!authUser || !dbConnected) {
      setProvinceProgress(null);
      return;
    }
    let cancelled = false;
    fetchProvinceProgress(activePeriodId)
      .then((res) => {
        if (!cancelled) setProvinceProgress(res);
      })
      .catch(() => {
        if (!cancelled) setProvinceProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, dbConnected, activePeriodId]);

  const currentProvinceDistricts = useMemo(() => {
    return (
      provinceDistrictsMap[selectedProvinceCode] ??
      buildFallbackProvinceDistricts(selectedProvinceCode, activePeriodId)
    );
  }, [provinceDistrictsMap, selectedProvinceCode, activePeriodId]);

  const selectedDistrictBaselineEval = useMemo(() => {
    return (
      currentProvinceDistricts.find((d) => d.district.code === selectedDistrictMeta.code) ??
      currentProvinceDistricts[0]
    );
  }, [currentProvinceDistricts, selectedDistrictMeta.code]);

  // รีเซ็ต officerDraft เมื่อเปลี่ยนอำเภอหรือเปลี่ยนงวด
  useEffect(() => {
    if (selectedDistrictBaselineEval) {
      setOfficerDraft(cloneMetrics(selectedDistrictBaselineEval.metrics));
      setSubmitFeedback(null);
    }
  }, [selectedDistrictBaselineEval]);

  const activePeriod = useMemo(
    () => periods.find((p) => p.periodId === activePeriodId) ?? periods[periods.length - 1],
    [periods, activePeriodId],
  );

  // ค่าที่กำลังแก้ไขในฟอร์มตอนนี้
  const workingMetrics: DistrictMetricsPayload | null = useMemo(() => {
    if (!selectedDistrictBaselineEval) return null;
    if (entryMode === 'sandbox') {
      return (
        sandboxMetricsByDistrict[selectedDistrictMeta.code] ?? selectedDistrictBaselineEval.metrics
      );
    }
    return officerDraft ?? selectedDistrictBaselineEval.metrics;
  }, [
    entryMode,
    sandboxMetricsByDistrict,
    selectedDistrictMeta.code,
    selectedDistrictBaselineEval,
    officerDraft,
  ]);

  // ตรวจสิทธิ์การแก้ไขในโหมดเจ้าหน้าที่
  const officerCanEditSelected = useMemo(() => {
    if (entryMode !== 'officer') return true;
    if (!authUser) return false;
    if (activePeriod?.status === 'locked') return false;
    if (authUser.role === 'district_officer') {
      return (
        authUser.districtCode === selectedDistrictMeta.code &&
        authUser.provinceCode === selectedDistrictMeta.provinceCode
      );
    }
    if (authUser.role === 'province_reviewer') {
      return authUser.provinceCode === selectedDistrictMeta.provinceCode;
    }
    return authUser.role === 'ddpm_central_admin';
  }, [entryMode, authUser, activePeriod, selectedDistrictMeta]);

  // คำนวณสด 2 ระดับ: ระดับอำเภอ + ระดับจังหวัดต้นสังกัด (7 โปรไฟล์ P1-P6b)
  const liveImpact = useMemo(() => {
    if (!selectedDistrictBaselineEval || !workingMetrics || !selectedProvinceBase) return null;

    const districtAfter = evaluateDistrictMetrics(
      selectedDistrictMeta,
      selectedProvinceBase,
      activePeriodId,
      selectedDistrictBaselineEval.version,
      workingMetrics,
      selectedDistrictBaselineEval.updatedBy,
      selectedDistrictBaselineEval.updatedAt,
    );

    const beforeRows = currentProvinceDistricts.map((row) => ({
      district: row.district,
      metrics: row.metrics,
    }));
    const afterRows = currentProvinceDistricts.map((row) => ({
      district: row.district,
      metrics:
        row.district.code === selectedDistrictMeta.code
          ? workingMetrics
          : entryMode === 'sandbox' && sandboxMetricsByDistrict[row.district.code]
            ? sandboxMetricsByDistrict[row.district.code]
            : row.metrics,
    }));

    const provBeforeRec = aggregateDistrictsToProvince(selectedProvinceBase, beforeRows);
    const provAfterRec = aggregateDistrictsToProvince(selectedProvinceBase, afterRows);
    const provBeforeBd = computeProvinceHevc(provBeforeRec, 'composite');
    const provAfterBd = computeProvinceHevc(provAfterRec, 'composite');

    const provBeforeR = provBeforeBd.ddpmScore ?? 1.0;
    const provAfterR = provAfterBd.ddpmScore ?? 1.0;
    const districtBeforeR = selectedDistrictBaselineEval.ddpmScore;
    const districtAfterR = districtAfter.ddpmScore;
    const districtBreakdown = computeProvinceHevc(
      {
        ...selectedProvinceBase,
        hazards: Object.fromEntries(
          HAZARD_IDS.map((h) => [
            h,
            {
              score: workingMetrics.hazards[h],
              applicable: workingMetrics.hazards[h] !== null,
            },
          ]),
        ) as ProvinceRiskRecord['hazards'],
        exposureIndicators: workingMetrics.exposureIndicators,
        vulnerabilityIndicators: workingMetrics.vulnerabilityIndicators,
        capacityIndicators: workingMetrics.capacityIndicators,
      },
      'composite',
    );

    const diffSummary = countDiffsByPillar(selectedDistrictBaselineEval.metrics, workingMetrics);
    const flatline = hasFlatlineScores(workingMetrics);
    const districtDeltaR = round2(districtAfterR - districtBeforeR);
    const provDeltaR = round2(provAfterR - provBeforeR);
    const requiresEvidence = diffSummary.maxDelta >= 1.5 || Math.abs(districtDeltaR) >= 0.8;
    const softJumpHint = !requiresEvidence && diffSummary.maxDelta >= 0.8;

    return {
      districtBefore: selectedDistrictBaselineEval,
      districtAfter,
      districtDeltaR,
      guardrailApplied: districtBreakdown.guardrailApplied,
      guardrailFloor: districtBreakdown.guardrailFloor,
      provBeforeR,
      provAfterR,
      provBeforeLevel: scoreToRiskLevel(provBeforeR),
      provAfterLevel: scoreToRiskLevel(provAfterR),
      provDeltaR,
      diffSummary,
      flatline,
      requiresEvidence,
      softJumpHint,
    };
  }, [
    selectedDistrictBaselineEval,
    workingMetrics,
    selectedProvinceBase,
    selectedDistrictMeta,
    activePeriodId,
    currentProvinceDistricts,
    entryMode,
    sandboxMetricsByDistrict,
  ]);

  // กรองรายชื่อ 928 อำเภอฝั่งซ้าย
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalogItems.filter((item) => {
      const prov = PROVINCE_BY_CODE[item.provinceCode];
      if (regionFilter !== 'all' && prov) {
        const matchReg =
          regionFilter === 'bma6' ? prov.isBma6 : prov.region6 === regionFilter;
        if (!matchReg) return false;
      }
      if (provinceFilter !== 'all' && item.provinceCode !== provinceFilter) return false;
      if (geoFilter !== 'all' && item.geoClass !== geoFilter) return false;
      if (statusFilter === 'modified') {
        const inSandbox = Boolean(sandboxMetricsByDistrict[item.code]);
        if (!inSandbox && !item.isModifiedFromBaseline) return false;
      }
      if (statusFilter === 'pending' && item.pendingCount === 0) return false;
      if (q) {
        const matchText =
          item.fullNameTh.toLowerCase().includes(q) ||
          item.nameTh.toLowerCase().includes(q) ||
          item.provinceNameTh.toLowerCase().includes(q) ||
          item.nameEn.toLowerCase().includes(q) ||
          item.code.includes(q);
        if (!matchText) return false;
      }
      return true;
    });
  }, [
    catalogItems,
    regionFilter,
    provinceFilter,
    geoFilter,
    statusFilter,
    searchQuery,
    sandboxMetricsByDistrict,
  ]);

  const sortedProvincesForDropdown = useMemo(
    () =>
      [...PROVINCES_RISK_DATA]
        .filter((p) => {
          if (regionFilter === 'all') return true;
          return regionFilter === 'bma6' ? p.isBma6 : p.region6 === regionFilter;
        })
        .sort((a, b) => a.nameTh.localeCompare(b.nameTh, 'th')),
    [regionFilter],
  );

  // ตรวจว่าจังหวัดชายฝั่งมีอำเภอติดทะเลหรือไม่ (สำหรับป้ายอธิบายสึนามิ)
  const coastalProvinceHasCoastalDistrict = useMemo(
    () => currentProvinceDistricts.some((d) => d.district.geoClass === 'coastal'),
    [currentProvinceDistricts],
  );

  const handleSetVariableValue = (
    group: PillarTab,
    key: VariableKey,
    rawVal: number,
  ) => {
    if (!workingMetrics || !officerCanEditSelected) return;
    const clamped = round2(clampScore(rawVal));
    const next = cloneMetrics(workingMetrics);
    if (group === 'H') {
      next.hazards[key as keyof DistrictMetricsPayload['hazards']] = clamped;
    } else if (group === 'E') {
      next.exposureIndicators[key as keyof DistrictMetricsPayload['exposureIndicators']] = clamped;
    } else if (group === 'V') {
      next.vulnerabilityIndicators[key as keyof DistrictMetricsPayload['vulnerabilityIndicators']] = clamped;
    } else {
      next.capacityIndicators[key as keyof DistrictMetricsPayload['capacityIndicators']] = clamped;
    }

    if (entryMode === 'sandbox') {
      onUpdateSandboxDistrict(selectedDistrictMeta.code, next);
    } else {
      setOfficerDraft(next);
    }
  };

  const handleResetDistrict = () => {
    if (!selectedDistrictBaselineEval) return;
    if (entryMode === 'sandbox') {
      onUpdateSandboxDistrict(selectedDistrictMeta.code, null);
    } else {
      setOfficerDraft(cloneMetrics(selectedDistrictBaselineEval.metrics));
    }
    setSubmitFeedback(null);
  };

  const handleResetCurrentPillar = () => {
    if (!selectedDistrictBaselineEval || !workingMetrics) return;
    const base = selectedDistrictBaselineEval.metrics;
    const next: DistrictMetricsPayload = {
      hazards: activePillar === 'H' ? { ...base.hazards } : { ...workingMetrics.hazards },
      exposureIndicators:
        activePillar === 'E'
          ? { ...base.exposureIndicators }
          : { ...workingMetrics.exposureIndicators },
      vulnerabilityIndicators:
        activePillar === 'V'
          ? { ...base.vulnerabilityIndicators }
          : { ...workingMetrics.vulnerabilityIndicators },
      capacityIndicators:
        activePillar === 'C'
          ? { ...base.capacityIndicators }
          : { ...workingMetrics.capacityIndicators },
    };
    if (entryMode === 'sandbox') {
      onUpdateSandboxDistrict(selectedDistrictMeta.code, next);
    } else {
      setOfficerDraft(next);
    }
  };

  const handleCopyPreviousPeriod = async () => {
    const idx = periods.findIndex((p) => p.periodId === activePeriodId);
    if (idx <= 0) return;
    const prevPeriodId = periods[idx - 1].periodId;
    try {
      const res = await fetchProvinceDistricts(selectedProvinceCode, prevPeriodId);
      const found = res.districts.find((d) => d.district.code === selectedDistrictMeta.code);
      if (found) {
        if (entryMode === 'sandbox') {
          onUpdateSandboxDistrict(selectedDistrictMeta.code, cloneMetrics(found.metrics));
        } else {
          setOfficerDraft(cloneMetrics(found.metrics));
        }
        onAnnounce(`คัดลอกคะแนน${selectedDistrictMeta.fullNameTh}จากงวด ${periods[idx - 1].labelTh} แล้ว`);
        return;
      }
    } catch {
      // fallback จากข้อมูลในเครื่อง
    }
    const fb = buildFallbackProvinceDistricts(selectedProvinceCode, prevPeriodId).find(
      (d) => d.district.code === selectedDistrictMeta.code,
    );
    if (fb) {
      if (entryMode === 'sandbox') {
        onUpdateSandboxDistrict(selectedDistrictMeta.code, cloneMetrics(fb.metrics));
      } else {
        setOfficerDraft(cloneMetrics(fb.metrics));
      }
    }
  };

  const handleImportSandboxToOfficer = () => {
    const sb = sandboxMetricsByDistrict[selectedDistrictMeta.code];
    if (sb) {
      setOfficerDraft(cloneMetrics(sb));
      setSubmitFeedback({
        kind: 'success',
        text: `นำค่าที่ทดลองกรอกไว้ของ${selectedDistrictMeta.fullNameTh}มาใส่ในฟอร์มส่งคำขอเรียบร้อยแล้ว`,
      });
    }
  };

  const handleOfficerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !csrfToken || !workingMetrics || !liveImpact) return;
    if (liveImpact.diffSummary.total === 0) {
      setSubmitFeedback({ kind: 'error', text: 'ยังไม่มีรายการตัวแปรที่เปลี่ยนแปลงจากค่าปัจจุบัน' });
      return;
    }
    if (liveImpact.requiresEvidence && (reasonTh.trim().length < 20 || referenceDoc.trim().length < 3)) {
      setSubmitFeedback({
        kind: 'error',
        text: 'มีการเปลี่ยนคะแนนก้าวกระโดด (ตั้งแต่ 1.50 คะแนนหรือความเสี่ยงสุทธิเปลี่ยนตั้งแต่ 0.80) กรุณาระบุเหตุผลอย่างน้อย 20 ตัวอักษรและเลขที่หนังสืออ้างอิง',
      });
      return;
    }

    setSubmitting(true);
    setSubmitFeedback(null);
    try {
      await submitDistrictChange(
        selectedDistrictMeta.code,
        {
          periodId: activePeriodId,
          metrics: workingMetrics,
          reasonTh: reasonTh.trim(),
          referenceDoc: referenceDoc.trim(),
        },
        csrfToken,
      );
      setReasonTh('');
      setReferenceDoc('');
      setSubmitFeedback({
        kind: 'success',
        text: `ส่งคำขอปรับปรุงคะแนน${selectedDistrictMeta.fullNameTh}เข้าสู่ระบบฐานข้อมูลแล้ว รอผู้ตรวจสอบ ปภ.จังหวัดอนุมัติ`,
      });
      onAnnounce(`ส่งคำขอปรับปรุงคะแนน${selectedDistrictMeta.fullNameTh}เรียบร้อยแล้ว`);
      await onDataMutated(activePeriodId);
      // โหลดรายชื่อและ progress ใหม่
      fetchDistrictsCatalog(activePeriodId)
        .then((res) => setCatalogItems(res.districts))
        .catch(() => {});
      fetchProvinceProgress(activePeriodId)
        .then((res) => setProvinceProgress(res))
        .catch(() => {});
    } catch (err) {
      setSubmitFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถส่งคำขอปรับปรุงข้อมูลได้',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sandboxCount = Object.keys(sandboxMetricsByDistrict).length;
  const provTitle =
    selectedProvinceBase?.dopaCode === '10'
      ? selectedProvinceBase.nameTh
      : `จังหวัด${selectedProvinceBase?.nameTh ?? ''}`;
  const isPrevPeriodAvailable = periods.findIndex((p) => p.periodId === activePeriodId) > 0;
  const hasSandboxForSelected = Boolean(sandboxMetricsByDistrict[selectedDistrictMeta.code]);

  // ฟังก์ชันเรนเดอร์การ์ดตัวแปร 1 รายการ (ใช้ร่วมกันทั้ง H, E, V, C)
  const renderVariableCard = (cfg: {
    group: PillarTab;
    key: VariableKey;
    titleTh: string;
    weightPct: number;
    baseVal: number | null;
    curVal: number | null;
    lockedNa?: boolean;
    extraNote?: string;
  }) => {
    const isCap = cfg.group === 'C';
    const rubric = VARIABLE_RUBRICS[cfg.key];
    const rubricOpen = openRubricKey === cfg.key;
    const diff =
      cfg.baseVal !== null && cfg.curVal !== null ? round2(cfg.curVal - cfg.baseVal) : 0;
    const isDirty = Math.abs(diff) >= 0.005;
    const isBigJump = Math.abs(diff) >= 1.5;
    const level = cfg.curVal !== null ? scoreToRiskLevel(cfg.curVal) : null;
    const style =
      level !== null
        ? isCap
          ? CAPACITY_LEVEL_STYLES[level]
          : RISK_LEVEL_STYLES[level]
        : null;

    const deltaColor = isCap
      ? diff > 0
        ? 'text-emerald-700 bg-emerald-50'
        : 'text-amber-800 bg-amber-50'
      : diff < 0
        ? 'text-emerald-700 bg-emerald-50'
        : 'text-rose-700 bg-rose-50';

    return (
      <div
        key={cfg.key}
        className={`rounded-xl border p-4 space-y-3 transition-colors ${
          isBigJump
            ? 'border-amber-400 bg-amber-50/30'
            : isDirty
              ? isCap
                ? 'border-teal-300 bg-teal-50/20'
                : 'border-blue-300 bg-blue-50/20'
              : 'border-slate-200/90 bg-white'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="text-sm font-semibold text-[#0C2340] leading-snug">{cfg.titleTh}</h4>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 tabular-nums">
                น้ำหนัก {cfg.weightPct}%
              </span>
            </div>
            {cfg.baseVal !== null && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                <span>ค่าฐาน {cfg.baseVal.toFixed(2)}</span>
                {isDirty && (
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${deltaColor}`}>
                    {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {style && level !== null && (
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold"
                style={{
                  backgroundColor: style.mapFill,
                  color: isCap && level <= 3 ? '#0F172A' : style.badgeText,
                }}
                title={`ระดับ ${level}: ${style.shortLabelTh}`}
              >
                {style.symbol}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpenRubricKey(rubricOpen ? null : cfg.key)}
              aria-expanded={rubricOpen}
              title="ดูเกณฑ์การให้คะแนน 1-5 และหน่วยงานอ้างอิง"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                rubricOpen
                  ? 'border-[#0C2340] bg-[#0C2340] text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* เกณฑ์ให้คะแนน 1-5 (กางดูเมื่อคลิก ?) */}
        {rubricOpen && rubric && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5 leading-relaxed">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#0C2340]">เกณฑ์แนะนำการให้คะแนน</span>
              <button
                type="button"
                onClick={() => setOpenRubricKey(null)}
                aria-label="ปิดเกณฑ์แนะนำ"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-slate-600">
              <strong>แหล่งข้อมูล:</strong> {rubric.agencyTh} ({rubric.rawDataTh})
            </p>
            <ul className="space-y-1 text-slate-700">
              <li>
                <strong className="text-slate-900">ระดับ 1 (1.00-1.79):</strong> {rubric.level1Th}
              </li>
              <li>
                <strong className="text-slate-900">ระดับ 3 (2.60-3.39):</strong> {rubric.level3Th}
              </li>
              <li>
                <strong className="text-slate-900">ระดับ 5 (4.20-5.00):</strong> {rubric.level5Th}
              </li>
            </ul>
            {rubric.noteTh && <p className="text-teal-800 font-medium">{rubric.noteTh}</p>}
          </div>
        )}

        {cfg.lockedNa || cfg.curVal === null ? (
          <div className="rounded-lg bg-slate-100 px-3 py-2.5 text-xs text-slate-600 flex items-center justify-between">
            <span className="font-semibold text-slate-700">N/A — จังหวัดไร้ชายฝั่งทะเลเปิด</span>
            <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* ปุ่มลัด 1-5 + ช่องพิมพ์ตัวเลข 2 ตำแหน่ง */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1" role="group" aria-label={`เลือกคะแนนหลัก ${cfg.titleTh}`}>
                {[1, 2, 3, 4, 5].map((preset) => {
                  const st = isCap
                    ? CAPACITY_LEVEL_STYLES[preset as 1 | 2 | 3 | 4 | 5]
                    : RISK_LEVEL_STYLES[preset as 1 | 2 | 3 | 4 | 5];
                  const active = Math.round(cfg.curVal!) === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={!officerCanEditSelected}
                      onClick={() => handleSetVariableValue(cfg.group, cfg.key, preset)}
                      className={`h-8 w-8 rounded-lg text-xs font-bold tabular-nums transition-all disabled:opacity-50 ${
                        active ? 'ring-2 ring-offset-1 ring-[#0C2340]' : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: active ? st.mapFill : st.tintBg,
                        color: active
                          ? isCap && preset <= 3
                            ? '#0F172A'
                            : st.badgeText
                          : st.tintText,
                      }}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              <input
                type="number"
                aria-label={`คะแนน ${cfg.titleTh}`}
                min={1}
                max={5}
                step={0.05}
                disabled={!officerCanEditSelected}
                value={cfg.curVal}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  if (Number.isFinite(parsed)) {
                    handleSetVariableValue(cfg.group, cfg.key, parsed);
                  }
                }}
                onBlur={(e) => {
                  const parsed = parseFloat(e.target.value);
                  handleSetVariableValue(
                    cfg.group,
                    cfg.key,
                    Number.isFinite(parsed) ? parsed : cfg.baseVal ?? 3.0,
                  );
                }}
                className="h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm font-bold text-[#0C2340] tabular-nums disabled:bg-slate-100"
              />
            </div>

            {/* Slider ละเอียดขั้นละ 0.05 */}
            <input
              type="range"
              aria-label={`แถบเลื่อนคะแนน ${cfg.titleTh}`}
              min={1}
              max={5}
              step={0.05}
              disabled={!officerCanEditSelected}
              value={cfg.curVal}
              onChange={(e) => handleSetVariableValue(cfg.group, cfg.key, parseFloat(e.target.value))}
              className={`w-full cursor-pointer disabled:opacity-50 ${
                isCap ? 'accent-[#0D9488]' : 'accent-[#0C2340]'
              }`}
            />
          </div>
        )}

        {cfg.extraNote && (
          <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
            {cfg.extraNote}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* แถบโหมดการทำงานด้านบน: ทดลองคำนวณครบ 928 อำเภอ vs บันทึกฐานข้อมูลเจ้าหน้าที่ */}
      <section className="gov-card px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#0C2340]">
              กรอกและประเมินคะแนนตัวแปรรายอำเภอทั้งประเทศ (928 อำเภอ/เขต)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              ครบทุกอำเภอและเขตใน 77 จังหวัด รองรับทั้ง 23 ตัวแปรหลัก (ภัยคุกคาม 10, ความล่อแหลม 4, ความเปราะบาง 4, ศักยภาพ 5)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="เลือกโหมดการกรอกคะแนน"
              className="inline-flex rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200"
            >
              <button
                type="button"
                onClick={() => setEntryMode('sandbox')}
                aria-pressed={entryMode === 'sandbox'}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  entryMode === 'sandbox'
                    ? 'bg-white text-[#0C2340] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>ทดลองคำนวณ (ครบ 928 แห่ง)</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('officer')}
                aria-pressed={entryMode === 'officer'}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  entryMode === 'officer'
                    ? 'bg-[#0C2340] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                <span>บันทึกเข้าฐานข้อมูล (เจ้าหน้าที่)</span>
              </button>
            </div>

            {periods.length > 0 && (
              <select
                aria-label="เลือกงวดข้อมูลสำหรับกรอกคะแนน"
                value={activePeriodId}
                onChange={(e) => onChangePeriod(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-[#0C2340] tabular-nums"
              >
                {periods.map((p) => (
                  <option key={p.periodId} value={p.periodId}>
                    {p.labelTh} {p.status === 'locked' ? '(ปิดงวด)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* แถบสถานะโหมดปัจจุบัน */}
        {entryMode === 'sandbox' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-teal-50/70 border border-teal-200 px-3.5 py-2.5 text-xs text-teal-950">
            <p>
              <strong>โหมดทดลองคำนวณ:</strong> เลือกอำเภอใดก็ได้จากทั้ง 928 แห่งเพื่อปรับคะแนนตัวแปร
              ผลลัพธ์จะอัปเดตบนแผนที่ 77 จังหวัดทันที โดยบันทึกไว้เฉพาะในเบราว์เซอร์นี้ (ยังไม่กระทบฐานข้อมูลกลาง)
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {sandboxCount > 0 && (
                <button
                  type="button"
                  onClick={onClearAllSandbox}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-900 ring-1 ring-teal-300 hover:bg-teal-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>ล้างค่าทดลอง ({sandboxCount} แห่ง)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onJumpToProvinceOnMap(selectedProvinceCode)}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>ดูผลบนแผนที่</span>
              </button>
            </div>
          </div>
        ) : !authUser ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-800">
            <div className="space-y-0.5">
              <p className="font-semibold text-[#0C2340]">
                โหมดบันทึกฐานข้อมูลกลางต้องยืนยันตัวตน 2 ชั้นตามเขตอำนาจอำเภอ/จังหวัด
              </p>
              <p className="text-slate-600">
                บัญชีเจ้าหน้าที่อำเภอแก้ไขได้เฉพาะอำเภอของตนเองเท่านั้น (รองรับบัญชีสาธิตครบทั้ง 928 อำเภอและ 77 จังหวัด)
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onOpenOfficerLoginForDistrict(selectedProvinceCode, selectedDistrictMeta.code)
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C2340] px-4 py-2 text-xs font-semibold text-white hover:bg-[#16355B] shrink-0"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>เข้าสู่ระบบเจ้าหน้าที่สำหรับ{selectedDistrictMeta.fullNameTh}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-950">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>
                เข้าสู่ระบบในฐานะ <strong>{authUser.displayNameTh}</strong> ({authUser.positionTh})
              </span>
              {provinceProgress && (
                <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-emerald-900 ring-1 ring-emerald-300 tabular-nums">
                  ปรับปรุงแล้ว {provinceProgress.updatedDistricts}/{provinceProgress.totalDistricts} แห่ง ({provinceProgress.completionPct.toFixed(0)}%)
                  {provinceProgress.pendingDistricts > 0
                    ? ` • รอตรวจ ${provinceProgress.pendingDistricts}`
                    : ''}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onOpenOfficerQueue}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#0C2340] ring-1 ring-emerald-300 hover:bg-emerald-100/60"
            >
              <span>คิวอนุมัติและประวัติตรวจสอบ</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {/* โครงสร้าง 2 คอลัมน์: ซ้ายรายชื่อ 928 อำเภอ | ขวาฟอร์ม 23 ตัวแปร + คำนวณสด 2 ระดับ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* ซ้าย: สารบบ 77 จังหวัด 928 อำเภอ/เขต */}
        <aside
          aria-label="สารบบ 928 อำเภอและเขตทั่วประเทศ"
          className="gov-card lg:col-span-4 xl:col-span-3 lg:sticky lg:top-[106px] flex flex-col overflow-hidden max-h-[760px]"
        >
          <div className="border-b border-slate-100 p-3.5 space-y-2.5 bg-slate-50/70">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#0C2340]">
                รายชื่ออำเภอ/เขต ({filteredCatalog.length} / 928)
              </span>
              {(provinceFilter !== 'all' || regionFilter !== 'all' || searchQuery || geoFilter !== 'all' || statusFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setRegionFilter('all');
                    setProvinceFilter('all');
                    setGeoFilter('all');
                    setStatusFilter('all');
                    setSearchQuery('');
                    setVisibleLimit(40);
                  }}
                  className="font-medium text-[#1D4ED8] hover:underline"
                >
                  แสดงทั้งหมด
                </button>
              )}
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="ค้นหาชื่ออำเภอ เขต จังหวัด หรือรหัส 4 หลัก"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleLimit(40);
                }}
                placeholder="ค้นหาอำเภอ เขต จังหวัด รหัส..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1D4ED8]"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label="กรองตามภูมิภาค"
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value as RegionFilterKey);
                  setProvinceFilter('all');
                  setVisibleLimit(40);
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800"
              >
                {REGION_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.labelTh.replace('ทุกภูมิภาค (77 จังหวัด)', 'ทุกภาค (77 จว.)')}
                  </option>
                ))}
              </select>

              <select
                aria-label="เลือกจังหวัด"
                value={provinceFilter}
                onChange={(e) => {
                  const nextProv = e.target.value;
                  setProvinceFilter(nextProv);
                  setVisibleLimit(60);
                  if (nextProv !== 'all' && DISTRICTS_BY_PROVINCE[nextProv]?.[0]) {
                    setSelectedDistrictCode(DISTRICTS_BY_PROVINCE[nextProv][0].code);
                  }
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800"
              >
                <option value="all">ทุกจังหวัด (77)</option>
                {sortedProvincesForDropdown.map((p) => (
                  <option key={p.dopaCode} value={p.dopaCode}>
                    {p.nameTh} ({(DISTRICTS_BY_PROVINCE[p.dopaCode] ?? []).length})
                  </option>
                ))}
              </select>
            </div>

            {/* ชิปกรองลักษณะพื้นที่และสถานะ */}
            <div className="flex flex-wrap items-center gap-1">
              {GEO_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setGeoFilter(opt.key)}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    geoFilter === opt.key
                      ? 'bg-[#0C2340] text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {opt.labelTh}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStatusFilter((s) => (s === 'modified' ? 'all' : 'modified'))}
                className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                  statusFilter === 'modified'
                    ? 'bg-[#0D9488] text-white'
                    : 'bg-white text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50'
                }`}
              >
                ปรับค่าแล้ว
              </button>
            </div>
          </div>

          {/* รายการอำเภอที่กรองแล้ว */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredCatalog.slice(0, visibleLimit).map((item) => {
              const selected = item.code === selectedDistrictMeta.code;
              const isInSandbox = Boolean(sandboxMetricsByDistrict[item.code]);
              const isAssigned =
                authUser?.role === 'district_officer' && authUser.districtCode === item.code;
              const riskStyle = RISK_LEVEL_STYLES[item.ddpmLevel];
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setSelectedDistrictCode(item.code)}
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors ${
                    selected
                      ? 'bg-blue-50/90 ring-1 ring-inset ring-blue-300'
                      : isAssigned
                        ? 'bg-emerald-50/40 hover:bg-emerald-50'
                        : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: riskStyle.mapFill }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[13px] font-semibold text-[#0C2340]">
                        {item.fullNameTh}
                      </span>
                      {isInSandbox && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-teal-600" title="ปรับค่าในโหมดทดลองแล้ว" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 truncate tabular-nums">
                      {item.provinceCode === '10' ? item.provinceNameTh : `จ.${item.provinceNameTh}`} •{' '}
                      {item.code}
                      {item.pendingCount > 0 ? ` • รอตรวจ` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-slate-800 tabular-nums">
                    {item.ddpmScore.toFixed(2)}
                  </span>
                </button>
              );
            })}

            {filteredCatalog.length > visibleLimit && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((n) => n + 60)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0C2340] hover:bg-slate-50 tabular-nums"
                >
                  แสดงเพิ่มอีก ({filteredCatalog.length - visibleLimit} แห่งที่เหลือ)
                </button>
              </div>
            )}

            {filteredCatalog.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-500">
                ไม่พบอำเภอหรือเขตตามเงื่อนไขที่เลือก
              </p>
            )}
          </div>
        </aside>

        {/* ขวา: พื้นที่กรอก 23 ตัวแปร + คำนวณสด 2 ระดับ */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-4">
          {liveImpact && workingMetrics && selectedDistrictBaselineEval && (
            <>
              {/* การ์ดคำนวณสด 2 ระดับ: อำเภอที่กำลังกรอก + ผลรวมระดับจังหวัดต้นสังกัด */}
              <div className="gov-card p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold text-[#0C2340]">
                        {selectedDistrictMeta.fullNameTh}
                      </h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">
                        รหัส {selectedDistrictMeta.code}
                      </span>
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#1D4ED8]">
                        {DISTRICT_GEO_CLASS_LABELS_TH[selectedDistrictMeta.geoClass]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {provTitle} ({REGION6_LABELS[selectedProvinceBase.region6]}) •{' '}
                      รวม {currentProvinceDistricts.length} {selectedProvinceCode === '10' ? 'เขต' : 'อำเภอ'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {entryMode === 'officer' && officerCanEditSelected && hasSandboxForSelected && (
                      <button
                        type="button"
                        onClick={handleImportSandboxToOfficer}
                        className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-[#115E59] hover:bg-teal-100"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>ดึงค่าที่ทดลองกรอกไว้</span>
                      </button>
                    )}
                    {isPrevPeriodAvailable && officerCanEditSelected && (
                      <button
                        type="button"
                        onClick={handleCopyPreviousPeriod}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>คัดลอกงวดก่อน</span>
                      </button>
                    )}
                    {liveImpact.diffSummary.total > 0 && officerCanEditSelected && (
                      <button
                        type="button"
                        onClick={handleResetDistrict}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>คืนค่าฐาน</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* เทียบคู่ 2 ระดับ: คะแนนอำเภอ <-> คะแนนจังหวัดต้นสังกัด */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {/* คะแนนระดับอำเภอ */}
                  <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-600">
                        คะแนนระดับ{selectedProvinceCode === '10' ? 'เขต' : 'อำเภอ'} ({selectedDistrictMeta.fullNameTh})
                      </span>
                      <RiskBadge level={liveImpact.districtAfter.ddpmLevel} size="sm" compact />
                    </div>
                    <div className="flex items-baseline gap-2 tabular-nums">
                      <span className="text-sm text-slate-500">
                        {liveImpact.districtBefore.ddpmScore.toFixed(2)}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="text-2xl font-bold text-[#0C2340]">
                        {liveImpact.districtAfter.ddpmScore.toFixed(2)}
                      </span>
                      {Math.abs(liveImpact.districtDeltaR) >= 0.01 && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${
                            liveImpact.districtDeltaR < 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {liveImpact.districtDeltaR > 0
                            ? `+${liveImpact.districtDeltaR.toFixed(2)}`
                            : liveImpact.districtDeltaR.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center text-xs tabular-nums">
                      <div className="rounded-lg bg-white py-1 px-1.5">
                        <span className="text-slate-500">ภัย </span>
                        <strong className="text-[#0C2340]">
                          {liveImpact.districtAfter.hazardCompositeScore.toFixed(2)}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-white py-1 px-1.5">
                        <span className="text-slate-500">ล่อแหลม </span>
                        <strong className="text-[#0C2340]">
                          {liveImpact.districtAfter.exposureScore.toFixed(2)}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-white py-1 px-1.5">
                        <span className="text-slate-500">เปราะบาง </span>
                        <strong className="text-[#0C2340]">
                          {liveImpact.districtAfter.vulnerabilityScore.toFixed(2)}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-teal-50 py-1 px-1.5">
                        <span className="text-teal-800">ศักยภาพ </span>
                        <strong className="text-[#115E59]">
                          {liveImpact.districtAfter.capacityScore.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* ผลกระทบต่อระดับจังหวัดต้นสังกัด */}
                  <div className="rounded-xl bg-blue-50/50 p-3.5 ring-1 ring-blue-200/80 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0C2340]">
                        ผลรวมระดับจังหวัด ({provTitle})
                      </span>
                      <RiskBadge level={liveImpact.provAfterLevel} size="sm" compact />
                    </div>
                    <div className="flex items-baseline gap-2 tabular-nums">
                      <span className="text-sm text-slate-500">
                        {liveImpact.provBeforeR.toFixed(2)}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="text-2xl font-bold text-[#0C2340]">
                        {liveImpact.provAfterR.toFixed(2)}
                      </span>
                      {Math.abs(liveImpact.provDeltaR) >= 0.01 && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${
                            liveImpact.provDeltaR < 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {liveImpact.provDeltaR > 0
                            ? `+${liveImpact.provDeltaR.toFixed(2)}`
                            : liveImpact.provDeltaR.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">
                      {liveImpact.provBeforeLevel !== liveImpact.provAfterLevel ? (
                        <strong className="text-amber-900">
                          ระดับความเสี่ยงจังหวัดเปลี่ยน: ระดับ {liveImpact.provBeforeLevel} (
                          {RISK_LEVEL_STYLES[liveImpact.provBeforeLevel].shortLabelTh}) → ระดับ{' '}
                          {liveImpact.provAfterLevel} (
                          {RISK_LEVEL_STYLES[liveImpact.provAfterLevel].shortLabelTh})
                        </strong>
                      ) : (
                        'คำนวณรวมจากทุกอำเภอในจังหวัดด้วยเกณฑ์ถ่วงน้ำหนัก 7 รูปแบบตามลักษณะข้อมูล'
                      )}
                    </p>
                  </div>
                </div>

                {/* แจ้งเตือนคุณภาพข้อมูลเชิงกฎ (Deterministic Hints) */}
                {(liveImpact.guardrailApplied ||
                  liveImpact.requiresEvidence ||
                  liveImpact.softJumpHint ||
                  liveImpact.flatline) && (
                  <div className="space-y-1.5 text-xs">
                    {liveImpact.guardrailApplied && (
                      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-950">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                        <span>
                          ภัยคุกคามสูงมาก ระบบคงคะแนนเฝ้าระวังขั้นต่ำไว้ที่{' '}
                          <strong className="tabular-nums">{liveImpact.guardrailFloor.toFixed(2)}</strong>
                        </span>
                      </div>
                    )}
                    {liveImpact.requiresEvidence && (
                      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-amber-950">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                        <span>
                          มีการเปลี่ยนแปลงก้าวกระโดด (ตั้งแต่ 1.50 คะแนนต่อตัวแปร หรือความเสี่ยงสุทธิเปลี่ยนตั้งแต่ 0.80) หากส่งบันทึกฐานข้อมูลต้องระบุเหตุผลอย่างน้อย 20 ตัวอักษรและเลขที่หนังสืออ้างอิง
                        </span>
                      </div>
                    )}
                    {liveImpact.softJumpHint && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700">
                        มีตัวแปรเปลี่ยนตั้งแต่ 0.80 คะแนนขึ้นไป แนะนำแนบแหล่งข้อมูลอ้างอิงเพื่อความสะดวกในการตรวจสอบ
                      </div>
                    )}
                    {liveImpact.flatline && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700">
                        คะแนนทุกตัวแปรมีค่าใกล้เคียงกันทั้งหมด กรุณาตรวจทานความแตกต่างของแต่ละด้านก่อนยืนยัน
                      </div>
                    )}
                  </div>
                )}

                {entryMode === 'officer' && authUser && !officerCanEditSelected && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <Lock className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                      {activePeriod?.status === 'locked'
                        ? `งวด ${activePeriod.labelTh} ถูกปิดงวดแล้ว ไม่สามารถแก้ไขย้อนหลังได้`
                        : `อ่านอย่างเดียว: บัญชีของท่านมีสิทธิ์บันทึกข้อมูลเฉพาะ${
                            authUser.districtNameTh ??
                            (authUser.provinceNameTh ? `จังหวัด${authUser.provinceNameTh}` : 'พื้นที่ที่ได้รับมอบหมาย')
                          }`}
                    </span>
                    {authUser.districtCode && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDistrictCode(authUser.districtCode!);
                          setProvinceFilter(authUser.provinceCode ?? 'all');
                        }}
                        className="shrink-0 font-semibold text-[#1D4ED8] hover:underline"
                      >
                        ไปยังพื้นที่รับผิดชอบของท่าน
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* แถบเลือก 4 หมวดตัวแปร H / E / V / C พร้อมตัวนับช่องที่แก้ไข */}
              <div className="gov-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="หมวดตัวแปร 4 ปัจจัยความเสี่ยง">
                    {(
                      [
                        { id: 'H' as const, label: 'ภัยคุกคาม', total: 10, dirty: liveImpact.diffSummary.H },
                        { id: 'E' as const, label: 'ความล่อแหลม', total: 4, dirty: liveImpact.diffSummary.E },
                        { id: 'V' as const, label: 'ความเปราะบาง', total: 4, dirty: liveImpact.diffSummary.V },
                        { id: 'C' as const, label: 'ศักยภาพ', total: 5, dirty: liveImpact.diffSummary.C },
                      ] as const
                    ).map((tab) => {
                      const active = activePillar === tab.id;
                      const isCap = tab.id === 'C';
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setActivePillar(tab.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-[13px] font-semibold transition-all tabular-nums ${
                            active
                              ? isCap
                                ? 'bg-[#0D9488] text-white shadow-xs'
                                : 'bg-[#0C2340] text-white shadow-xs'
                              : isCap
                                ? 'bg-teal-50 text-teal-900 hover:bg-teal-100'
                                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span className={active ? 'text-white/85' : 'text-slate-400'}>
                            ({tab.total})
                          </span>
                          {tab.dirty > 0 && (
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-xs font-bold ${
                                active ? 'bg-white/25 text-white' : 'bg-blue-100 text-[#0C2340]'
                              }`}
                            >
                              {tab.dirty}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="font-medium text-slate-600">
                      ปรับแล้ว {liveImpact.diffSummary.total}/23 รายการ
                    </span>
                    {officerCanEditSelected && liveImpact.diffSummary[activePillar] > 0 && (
                      <button
                        type="button"
                        onClick={handleResetCurrentPillar}
                        className="font-semibold text-[#1D4ED8] hover:underline"
                      >
                        คืนค่าหมวดนี้
                      </button>
                    )}
                  </div>
                </div>

                {/* คำอธิบายทิศทางคะแนนของหมวดที่เปิด */}
                <div
                  className={`px-4 py-2 text-xs border-b ${
                    activePillar === 'C'
                      ? 'bg-teal-50/70 border-teal-100 text-teal-950'
                      : 'bg-slate-50/40 border-slate-100 text-slate-600'
                  }`}
                >
                  {activePillar === 'C'
                    ? 'หมวดศักยภาพ (โทนสีมรกต): คะแนนยิ่งสูง (เข้าใกล้ 5.00) หมายถึงความพร้อมสูงขึ้น ซึ่งจะช่วยลดความเสี่ยงสุทธิของอำเภอและจังหวัด'
                    : 'คะแนนยิ่งสูง (เข้าใกล้ 5.00) หมายถึงระดับภัย ความล่อแหลม หรือความเปราะบางสูงขึ้น คลิกเครื่องหมาย ? ในแต่ละรายการเพื่อดูเกณฑ์ประเมิน 1-5 และหน่วยงานอ้างอิง'}
                </div>

                {/* กริดการ์ดตัวแปร 2 คอลัมน์ */}
                <div className="p-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {activePillar === 'H' &&
                    HAZARD_CATALOG.map((h) => {
                      const isInlandProv = selectedProvinceBase.coastalZone === 'inland';
                      const lockedNa = h.id === 'tsunami_coastal' && isInlandProv;
                      let extraNote: string | undefined;
                      if (h.id === 'tsunami_coastal' && !isInlandProv) {
                        if (selectedDistrictMeta.geoClass === 'coastal') {
                          extraNote = 'อำเภอพื้นที่ชายฝั่ง — ระบบนำคะแนนนี้ไปรวมสู่คะแนนสึนามิระดับจังหวัดโดยตรง';
                        } else if (coastalProvinceHasCoastalDistrict) {
                          extraNote = 'อำเภอตอนในของจังหวัดชายฝั่ง — ระบบคำนวณรวมจังหวัดจากอำเภอติดชายฝั่งเป็นหลัก';
                        }
                      }
                      return renderVariableCard({
                        group: 'H',
                        key: h.id,
                        titleTh: h.nameTh,
                        weightPct: Math.round(h.weight * 100),
                        baseVal: selectedDistrictBaselineEval.metrics.hazards[h.id],
                        curVal: workingMetrics.hazards[h.id],
                        lockedNa,
                        extraNote,
                      });
                    })}

                  {activePillar === 'E' &&
                    EXPOSURE_INDICATORS.map((ind) =>
                      renderVariableCard({
                        group: 'E',
                        key: ind.id,
                        titleTh: ind.nameTh,
                        weightPct: Math.round(ind.weight * 100),
                        baseVal: selectedDistrictBaselineEval.metrics.exposureIndicators[ind.id],
                        curVal: workingMetrics.exposureIndicators[ind.id],
                      }),
                    )}

                  {activePillar === 'V' &&
                    VULNERABILITY_INDICATORS.map((ind) =>
                      renderVariableCard({
                        group: 'V',
                        key: ind.id,
                        titleTh: ind.nameTh,
                        weightPct: Math.round(ind.weight * 100),
                        baseVal: selectedDistrictBaselineEval.metrics.vulnerabilityIndicators[ind.id],
                        curVal: workingMetrics.vulnerabilityIndicators[ind.id],
                      }),
                    )}

                  {activePillar === 'C' &&
                    CAPACITY_INDICATORS.map((ind) =>
                      renderVariableCard({
                        group: 'C',
                        key: ind.id,
                        titleTh: ind.nameTh,
                        weightPct: Math.round(ind.weight * 100),
                        baseVal: selectedDistrictBaselineEval.metrics.capacityIndicators[ind.id],
                        curVal: workingMetrics.capacityIndicators[ind.id],
                      }),
                    )}
                </div>

                {/* ส่วนท้ายฟอร์มส่งคำขอ (เฉพาะโหมดบันทึกฐานข้อมูลเจ้าหน้าที่ที่มีสิทธิ์) */}
                {entryMode === 'officer' && authUser && officerCanEditSelected && (
                  <form
                    onSubmit={handleOfficerSubmit}
                    className="border-t border-slate-200 bg-slate-50/80 p-4 space-y-3"
                  >
                    <h4 className="text-sm font-bold text-[#0C2340]">
                      ส่งคำขอปรับปรุงข้อมูล{selectedDistrictMeta.fullNameTh}เข้าสู่ฐานข้อมูล (รอบ {activePeriod?.labelTh})
                    </h4>

                    {submitFeedback && (
                      <div
                        className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                          submitFeedback.kind === 'success'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                            : 'border-rose-300 bg-rose-50 text-rose-950'
                        }`}
                      >
                        {submitFeedback.kind === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 mt-0.5" />
                        )}
                        <span>{submitFeedback.text}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <label htmlFor="ws-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                          เหตุผลประกอบการปรับปรุงคะแนน{' '}
                          {liveImpact.requiresEvidence ? '(บังคับอย่างน้อย 20 ตัวอักษร)' : '(จำเป็น)'}
                        </label>
                        <input
                          id="ws-reason"
                          type="text"
                          required
                          minLength={liveImpact.requiresEvidence ? 20 : 5}
                          maxLength={500}
                          value={reasonTh}
                          onChange={(e) => setReasonTh(e.target.value)}
                          placeholder="เช่น ขยายสัญญาณ Cell Broadcast ครบทุกตำบล และปรับข้อมูลน้ำท่วมซ้ำตามรายงาน ปภ.อำเภอ"
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                        />
                      </div>
                      <div>
                        <label htmlFor="ws-refdoc" className="block text-xs font-semibold text-slate-700 mb-1">
                          เลขที่หนังสือ/เอกสารอ้างอิง{' '}
                          {liveImpact.requiresEvidence ? '(บังคับ)' : '(ถ้ามี)'}
                        </label>
                        <input
                          id="ws-refdoc"
                          type="text"
                          required={liveImpact.requiresEvidence}
                          minLength={liveImpact.requiresEvidence ? 3 : 0}
                          maxLength={120}
                          value={referenceDoc}
                          onChange={(e) => setReferenceDoc(e.target.value)}
                          placeholder="เช่น ชม 0021.1/ว 2401"
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <p className="text-xs text-slate-600">
                        คำขอจะถูกส่งให้ผู้ตรวจสอบระดับจังหวัดพิจารณาอนุมัติก่อนประกาศใช้บนแผนที่สาธารณะ
                      </p>
                      <button
                        type="submit"
                        disabled={submitting || liveImpact.diffSummary.total === 0}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0C2340] px-5 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#16355B] disabled:opacity-45 transition-colors"
                      >
                        <Send className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {submitting
                            ? 'กำลังส่งคำขอ...'
                            : `ส่งคำขออนุมัติ (${liveImpact.diffSummary.total} รายการ)`}
                        </span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
