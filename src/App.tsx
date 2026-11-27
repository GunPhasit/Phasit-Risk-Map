import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  FileClock,
  Flag,
  HelpCircle,
  Phone,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { HAZARD_BY_ID, HAZARD_IDS } from './data/hazardCatalog.ts';
import { SUB_INDICATOR_BY_ID } from './data/indicatorCatalog.ts';
import { PROVINCE_BY_CODE, PROVINCES_RISK_DATA } from './data/provincesRiskData.ts';
import { MAP_DIMENSION_META } from './data/riskPalette.ts';
import { DISTRICT_BY_CODE } from './data/thailandDistrictsCatalog.ts';
import { evaluateAllProvinces } from './domain/riskCalculator.ts';
import {
  applyDistrictSandboxToProvinces,
  buildFallbackProvinceDistricts,
} from './services/districtFallback.ts';
import {
  fetchCurrentSession,
  fetchPeriods,
  fetchProvinceDistricts,
  fetchProvincesForPeriod,
  fetchProvinceTrend,
  fetchSystemHealth,
} from './services/riskApi.ts';
import type {
  AuthUser,
  CapacityOverrides,
  CompositeMode,
  DistrictEvaluation,
  DistrictMetricsPayload,
  LayerSelection,
  MapDimension,
  ProvinceRiskRecord,
  ProvinceTrendPoint,
  RegionFilterKey,
  ReportingPeriod,
  RiskLevel,
  StorageMode,
  SubIndicatorId,
} from './types/index.ts';
import { GovHeader, type MainView } from './components/layout/GovHeader.tsx';
import { HazardControlBar } from './components/controls/HazardControlBar.tsx';
import { ThailandRiskMap } from './components/map/ThailandRiskMap.tsx';
import { ProvinceDetailPanel } from './components/panel/ProvinceDetailPanel.tsx';
import { NationalBriefStrip } from './components/summary/NationalBriefStrip.tsx';
import { ProvinceRankingTable } from './components/table/ProvinceRankingTable.tsx';
import { DistrictScoreWorkspace } from './components/districts/DistrictScoreWorkspace.tsx';
import { MethodologyModal } from './components/modals/MethodologyModal.tsx';
import {
  CompareProvincesModal,
  CompareTray,
} from './components/modals/CompareProvincesModal.tsx';
import {
  ChangelogModal,
  ReportDiscrepancyModal,
} from './components/modals/GovernanceModals.tsx';
import { OfficerPortalModal } from './components/portal/OfficerPortalModal.tsx';

const SANDBOX_STORAGE_KEY = 'ddpm_district_sandbox_v1';

const FALLBACK_PERIOD: ReportingPeriod = {
  periodId: '2569-Q3',
  labelTh: 'ไตรมาส 3/2569 (ปัจจุบัน)',
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  status: 'open',
  isCurrent: true,
  createdBy: 'กรมป้องกันและบรรเทาสาธารณภัย',
  createdAt: '2026-11-26T09:00:00.000Z',
};

function loadSandboxFromStorage(): Record<string, DistrictMetricsPayload> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SANDBOX_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DistrictMetricsPayload>;
    if (!parsed || typeof parsed !== 'object') return {};
    const safe: Record<string, DistrictMetricsPayload> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (DISTRICT_BY_CODE[k] && v && typeof v === 'object' && v.hazards && v.capacityIndicators) {
        safe[k] = v;
      }
    }
    return safe;
  } catch {
    return {};
  }
}

function parseUrlState(): {
  view: MainView;
  dimension: MapDimension;
  layer: LayerSelection;
  subIndicator: SubIndicatorId | null;
  mode: CompositeMode;
  periodId: string;
  provinceCode: string | null;
  districtCode: string | null;
  compare: string[];
  pattern: boolean;
} {
  if (typeof window === 'undefined') {
    return {
      view: 'map',
      dimension: 'R',
      layer: 'composite',
      subIndicator: null,
      mode: 'ddpm64',
      periodId: FALLBACK_PERIOD.periodId,
      provinceCode: null,
      districtCode: null,
      compare: [],
      pattern: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get('view');
  const view: MainView =
    rawView === 'table' || rawView === 'districts' || rawView === 'map' ? rawView : 'map';

  const rawDim = params.get('dim');
  const dimension: MapDimension =
    rawDim === 'R' || rawDim === 'H' || rawDim === 'E' || rawDim === 'V' || rawDim === 'C'
      ? rawDim
      : 'R';

  const rawHazard = params.get('hazard');
  const layer: LayerSelection =
    rawHazard && (HAZARD_IDS as readonly string[]).includes(rawHazard)
      ? (rawHazard as LayerSelection)
      : 'composite';

  const rawSub = params.get('sub') as SubIndicatorId | null;
  const subIndicator =
    rawSub && SUB_INDICATOR_BY_ID[rawSub] && SUB_INDICATOR_BY_ID[rawSub].pillar === dimension
      ? rawSub
      : null;

  const rawMode = params.get('mode');
  const mode: CompositeMode =
    rawMode === 'eoc' || rawMode === 'gross' || rawMode === 'ddpm64' ? rawMode : 'ddpm64';

  const rawPeriod = params.get('period')?.trim();
  const periodId =
    rawPeriod && /^25\d{2}-(Q[1-4]|\d{2})$/.test(rawPeriod)
      ? rawPeriod
      : FALLBACK_PERIOD.periodId;

  const rawDist = params.get('district')?.trim() ?? null;
  const districtCode = rawDist && DISTRICT_BY_CODE[rawDist] ? rawDist : null;

  const rawProv = params.get('province')?.replace(/^TH-/i, '') ?? null;
  const provinceCode =
    rawProv && PROVINCE_BY_CODE[rawProv]
      ? rawProv
      : districtCode
        ? DISTRICT_BY_CODE[districtCode].provinceCode
        : null;

  const rawCompare = params.get('compare');
  const compare = rawCompare
    ? rawCompare
        .split(',')
        .map((c) => c.trim().replace(/^TH-/i, ''))
        .filter((c, idx, arr) => Boolean(PROVINCE_BY_CODE[c]) && arr.indexOf(c) === idx)
        .slice(0, 3)
    : [];

  const pattern = params.get('pattern') === '1';

  return { view, dimension, layer, subIndicator, mode, periodId, provinceCode, districtCode, compare, pattern };
}

export default function App() {
  const initial = useMemo(() => parseUrlState(), []);

  const [activeView, setActiveView] = useState<MainView>(initial.view);
  const [activeDimension, setActiveDimension] = useState<MapDimension>(initial.dimension);
  const [activeLayer, setActiveLayer] = useState<LayerSelection>(initial.layer);
  const [activeSubIndicator, setActiveSubIndicator] = useState<SubIndicatorId | null>(
    initial.subIndicator,
  );
  const [compositeMode, setCompositeMode] = useState<CompositeMode>(initial.mode);
  const [selectedProvinceCode, setSelectedProvinceCode] = useState<string | null>(
    initial.provinceCode,
  );
  const [selectedDistrictCode, setSelectedDistrictCode] = useState<string | null>(
    initial.districtCode,
  );
  const [compareCodes, setCompareCodes] = useState<string[]>(initial.compare);
  const [regionFilter, setRegionFilter] = useState<RegionFilterKey>('all');
  const [levelFilter, setLevelFilter] = useState<RiskLevel | null>(null);
  const [patternMode, setPatternMode] = useState<boolean>(initial.pattern);
  const [capacityOverridesByProvince, setCapacityOverridesByProvince] = useState<
    Record<string, CapacityOverrides>
  >({});

  // ค่าทดลองกรอกคะแนนรายอำเภอ (เก็บใน localStorage และซิงก์คำนวณแผนที่ 77 จังหวัดสด)
  const [sandboxDistrictMetrics, setSandboxDistrictMetrics] = useState<
    Record<string, DistrictMetricsPayload>
  >(() => loadSandboxFromStorage());

  // สถานะฐานข้อมูลรายช่วงเวลา
  const [periods, setPeriods] = useState<ReportingPeriod[]>([FALLBACK_PERIOD]);
  const [activePeriodId, setActivePeriodId] = useState<string>(initial.periodId);
  const [provincesData, setProvincesData] = useState<readonly ProvinceRiskRecord[]>(
    PROVINCES_RISK_DATA,
  );
  const [dbConnected, setDbConnected] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode | null>(null);
  const [serverDemoMode, setServerDemoMode] = useState(true);
  const [dataRevision, setDataRevision] = useState(0);

  // แคชรายอำเภอตามจังหวัดเพื่อใช้ทั้งใน ProvinceDetailPanel และคำนวณ Sandbox Rollup
  const [cachedProvinceDistricts, setCachedProvinceDistricts] = useState<
    Record<string, readonly DistrictEvaluation[]>
  >({});
  const [provinceDistricts, setProvinceDistricts] = useState<readonly DistrictEvaluation[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(false);
  const [provinceTrend, setProvinceTrend] = useState<readonly ProvinceTrendPoint[]>([]);

  // สถานะเจ้าหน้าที่ ปภ.
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [officerPortalState, setOfficerPortalState] = useState<{
    open: boolean;
    provinceCode?: string | null;
    districtCode?: string | null;
  }>({ open: false });

  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [reportState, setReportState] = useState<{ open: boolean; provinceName?: string }>({
    open: false,
  });
  const [announcementOverride, setAnnouncementOverride] = useState<string | null>(null);

  // บันทึกค่า Sandbox ลง localStorage
  useEffect(() => {
    try {
      if (Object.keys(sandboxDistrictMetrics).length === 0) {
        window.localStorage.removeItem(SANDBOX_STORAGE_KEY);
      } else {
        window.localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(sandboxDistrictMetrics));
      }
    } catch {
      // ข้ามหากพื้นที่เก็บของเบราว์เซอร์จำกัด
    }
  }, [sandboxDistrictMetrics]);

  // รองรับปุ่มย้อนกลับของเบราว์เซอร์ (popstate)
  useEffect(() => {
    const onPopState = () => {
      const next = parseUrlState();
      setActiveView(next.view);
      setActiveDimension(next.dimension);
      setActiveLayer(next.layer);
      setActiveSubIndicator(next.subIndicator);
      setCompositeMode(next.mode);
      setSelectedProvinceCode(next.provinceCode);
      setSelectedDistrictCode(next.districtCode);
      setPatternMode(next.pattern);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadPeriodsAndProvinces = useCallback(async (targetPeriodId?: string) => {
    try {
      const [health, list] = await Promise.all([
        fetchSystemHealth().catch(() => null),
        fetchPeriods(),
      ]);
      if (health) {
        setStorageMode(health.storageMode);
        setServerDemoMode(health.demoMode);
      }
      if (list.length > 0) {
        setPeriods(list);
        const resolvedId =
          targetPeriodId && list.some((p) => p.periodId === targetPeriodId)
            ? targetPeriodId
            : (list.find((p) => p.isCurrent) ?? list[list.length - 1]).periodId;
        setActivePeriodId(resolvedId);
        const res = await fetchProvincesForPeriod(resolvedId);
        setProvincesData(res.provinces);
        setDbConnected(true);
      }
    } catch {
      setDbConnected(false);
      setStorageMode(null);
    }
  }, []);

  useEffect(() => {
    loadPeriodsAndProvinces(initial.periodId);
    fetchCurrentSession()
      .then((sess) => {
        if (sess.authenticated && sess.user && sess.csrfToken) {
          setAuthUser(sess.user);
          setCsrfToken(sess.csrfToken);
        }
      })
      .catch(() => {
        // ทำงานโหมดสาธารณะต่อตามปกติ
      });
  }, [initial.periodId, loadPeriodsAndProvinces]);

  const handleSelectPeriod = useCallback(async (nextPeriodId: string) => {
    setActivePeriodId(nextPeriodId);
    setCachedProvinceDistricts({});
    try {
      const res = await fetchProvincesForPeriod(nextPeriodId);
      setProvincesData(res.provinces);
      setDbConnected(true);
    } catch {
      // คงค่าเดิมหากไม่พบเซิร์ฟเวอร์
    }
  }, []);

  const handleProvinceDistrictsLoaded = useCallback(
    (provinceCode: string, districts: readonly DistrictEvaluation[]) => {
      setCachedProvinceDistricts((prev) => ({ ...prev, [provinceCode]: districts }));
    },
    [],
  );

  // โหลดรายอำเภอและกราฟแนวโน้มเมื่อเลือกจังหวัดบนแผนที่
  useEffect(() => {
    if (!selectedProvinceCode) {
      setProvinceDistricts([]);
      setProvinceTrend([]);
      return;
    }
    let cancelled = false;
    setDistrictsLoading(true);
    Promise.all([
      fetchProvinceDistricts(selectedProvinceCode, activePeriodId),
      fetchProvinceTrend(selectedProvinceCode),
    ])
      .then(([distRes, trendRes]) => {
        if (cancelled) return;
        setProvinceDistricts(distRes.districts);
        setCachedProvinceDistricts((prev) => ({
          ...prev,
          [selectedProvinceCode]: distRes.districts,
        }));
        setProvinceTrend(trendRes);
      })
      .catch(() => {
        if (cancelled) return;
        const fallbackDists = buildFallbackProvinceDistricts(selectedProvinceCode, activePeriodId);
        setProvinceDistricts(fallbackDists);
        setProvinceTrend([]);
      })
      .finally(() => {
        if (!cancelled) setDistrictsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProvinceCode, activePeriodId, dataRevision]);

  const activePeriod = useMemo(
    () =>
      periods.find((p) => p.periodId === activePeriodId) ??
      periods[periods.length - 1] ??
      FALLBACK_PERIOD,
    [periods, activePeriodId],
  );

  // รวมค่าทดลองกรอกรายอำเภอ (Sandbox) เข้ากับ 77 จังหวัดแบบสดด้วยสูตร 7 โปรไฟล์
  const effectiveProvincesData = useMemo(
    () =>
      applyDistrictSandboxToProvinces(
        provincesData,
        sandboxDistrictMetrics,
        activePeriodId,
        cachedProvinceDistricts,
      ),
    [provincesData, sandboxDistrictMetrics, activePeriodId, cachedProvinceDistricts],
  );

  const sandboxStats = useMemo(() => {
    const distCodes = Object.keys(sandboxDistrictMetrics);
    const provSet = new Set<string>();
    for (const c of distCodes) {
      const m = DISTRICT_BY_CODE[c];
      if (m) provSet.add(m.provinceCode);
    }
    return { districtCount: distCodes.length, provinceCount: provSet.size };
  }, [sandboxDistrictMetrics]);

  // ประมวลผล 77 จังหวัดจากแหล่งกลางเดียว (ซิงก์แผนที่ แผงขวา แถบสรุป ตาราง เปรียบเทียบ และ CSV)
  const evaluations = useMemo(
    () =>
      evaluateAllProvinces(
        effectiveProvincesData,
        activeDimension,
        activeLayer,
        compositeMode,
        activeSubIndicator,
        capacityOverridesByProvince,
      ),
    [
      effectiveProvincesData,
      activeDimension,
      activeLayer,
      compositeMode,
      activeSubIndicator,
      capacityOverridesByProvince,
    ],
  );

  const selectedEvaluation = useMemo(
    () =>
      selectedProvinceCode
        ? evaluations.find((ev) => ev.province.dopaCode === selectedProvinceCode) ?? null
        : null,
    [evaluations, selectedProvinceCode],
  );

  const comparedEvaluations = useMemo(
    () =>
      compareCodes
        .map((code) => evaluations.find((ev) => ev.province.dopaCode === code))
        .filter((ev): ev is NonNullable<typeof ev> => Boolean(ev)),
    [compareCodes, evaluations],
  );

  const simulatedCount = useMemo(
    () => evaluations.filter((ev) => ev.breakdown.isSimulated).length,
    [evaluations],
  );

  // ซิงก์ URL Deep-Linking และ SEO Meta Tags
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeView !== 'map') params.set('view', activeView);
    params.set('dim', activeDimension);
    params.set('period', activePeriodId);
    if (activeDimension === 'R' || activeDimension === 'H') {
      params.set('hazard', activeLayer);
    }
    if (activeDimension === 'R') {
      params.set('mode', compositeMode);
    }
    if (activeSubIndicator) {
      params.set('sub', activeSubIndicator);
    }
    if (selectedProvinceCode) {
      params.set('province', `TH-${selectedProvinceCode}`);
    }
    if (activeView === 'districts' && selectedDistrictCode) {
      params.set('district', selectedDistrictCode);
    }
    if (compareCodes.length > 0) {
      params.set('compare', compareCodes.map((c) => `TH-${c}`).join(','));
    }
    if (patternMode) {
      params.set('pattern', '1');
    }

    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    if (window.location.search !== `?${params.toString()}`) {
      window.history.replaceState(null, '', nextUrl);
    }

    const dimName = MAP_DIMENSION_META[activeDimension].shortNameTh;
    const detailName =
      activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]
        ? SUB_INDICATOR_BY_ID[activeSubIndicator].shortNameTh
        : activeDimension === 'R' || activeDimension === 'H'
          ? activeLayer === 'composite'
            ? '10 สาธารณภัย'
            : HAZARD_BY_ID[activeLayer].shortNameTh
          : 'ภาพรวมตัวชี้วัด';

    if (activeView === 'districts') {
      const dist = selectedDistrictCode ? DISTRICT_BY_CODE[selectedDistrictCode] : null;
      document.title = dist
        ? `${dist.fullNameTh} - กรอกคะแนน 928 อำเภอ | แผนที่ความเสี่ยง ปภ.`
        : 'กรอกคะแนนตัวแปรรายอำเภอ 928 แห่ง | แผนที่ความเสี่ยงสาธารณภัยแห่งประเทศไทย';
    } else if (activeView === 'table') {
      document.title = `ตารางจัดอันดับ 77 จังหวัด (${dimName}) | แผนที่ความเสี่ยง ปภ.`;
    } else if (selectedEvaluation) {
      const pName =
        selectedEvaluation.province.dopaCode === '10'
          ? selectedEvaluation.province.nameTh
          : `จังหวัด${selectedEvaluation.province.nameTh}`;
      document.title = `${pName} - ${dimName}: ${detailName} | แผนที่ความเสี่ยง ปภ.`;
    } else {
      document.title = `${dimName}: ${detailName} | แผนที่ความเสี่ยงสาธารณภัยแห่งประเทศไทย 77 จังหวัด`;
    }
  }, [
    activeView,
    activeDimension,
    activeLayer,
    activeSubIndicator,
    compositeMode,
    activePeriodId,
    selectedProvinceCode,
    selectedDistrictCode,
    compareCodes,
    patternMode,
    selectedEvaluation,
  ]);

  const handleChangeView = (nextView: MainView) => {
    setActiveView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeDimension = (dim: MapDimension, subId: SubIndicatorId | null = null) => {
    setActiveDimension(dim);
    setActiveSubIndicator(subId);
    setLevelFilter(null);
  };

  const handleUpdateCapacityOverride = (
    dopaCode: string,
    overrides: CapacityOverrides | null,
  ) => {
    setCapacityOverridesByProvince((prev) => {
      const next = { ...prev };
      if (!overrides) delete next[dopaCode];
      else next[dopaCode] = overrides;
      return next;
    });
  };

  const handleUpdateSandboxDistrict = useCallback(
    (districtCode: string, metrics: DistrictMetricsPayload | null) => {
      setSandboxDistrictMetrics((prev) => {
        const next = { ...prev };
        if (!metrics) delete next[districtCode];
        else next[districtCode] = metrics;
        return next;
      });
    },
    [],
  );

  const handleToggleCompare = (dopaCode: string) => {
    setCompareCodes((prev) => {
      if (prev.includes(dopaCode)) return prev.filter((c) => c !== dopaCode);
      if (prev.length >= 3) return prev;
      return [...prev, dopaCode];
    });
  };

  const handleSelectFromTable = (dopaCode: string) => {
    setSelectedProvinceCode(dopaCode);
    setActiveView('map');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenDistrictEditor = (provinceCode: string, districtCode?: string) => {
    setSelectedProvinceCode(provinceCode);
    setSelectedDistrictCode(districtCode ?? null);
    setActiveView('districts');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDataMutated = useCallback(
    async (selectPeriodId?: string) => {
      await loadPeriodsAndProvinces(selectPeriodId ?? activePeriodId);
      setDataRevision((n) => n + 1);
    },
    [activePeriodId, loadPeriodsAndProvinces],
  );

  const liveAnnouncement = useMemo(() => {
    if (announcementOverride) return announcementOverride;
    const lvl5Count = evaluations.filter((e) => e.level === 5).length;
    const dimLabel = MAP_DIMENSION_META[activeDimension].nameTh;
    const lvl5Label = activeDimension === 'C' ? 'ระดับ 5 ศักยภาพต้นแบบ' : 'ระดับ 5 สูงมาก';
    return `กำลังแสดงแผนที่${dimLabel} ประจำ${activePeriod.labelTh} มีจังหวัดในเกณฑ์${lvl5Label} จำนวน ${lvl5Count} จาก 77 จังหวัด`;
  }, [announcementOverride, evaluations, activeDimension, activePeriod.labelTh]);

  const footerStorageText = useMemo(() => {
    if (!dbConnected) return 'ชุดข้อมูลค่าฐานจำลองในเครื่อง (77 จังหวัด 928 อำเภอ)';
    if (storageMode === 'netlify-blobs-sqlite') {
      return `ฐานข้อมูลถาวร 928 อำเภอ/เขต (Netlify Blobs + SQLite) ประจำ${activePeriod.labelTh}`;
    }
    if (storageMode === 'local-sqlite') {
      return `ฐานข้อมูลถาวร 928 อำเภอ/เขต (SQLite) ประจำ${activePeriod.labelTh}`;
    }
    return `ฐานข้อมูลสาธิตชั่วคราว 928 อำเภอ/เขต ประจำ${activePeriod.labelTh}`;
  }, [dbConnected, storageMode, activePeriod.labelTh]);

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F9] text-slate-900">
      <GovHeader
        evaluations={evaluations}
        activeDimension={activeDimension}
        activeView={activeView}
        authUser={authUser}
        dbConnected={dbConnected}
        storageMode={storageMode}
        sandboxEditCount={sandboxStats.districtCount}
        onChangeView={handleChangeView}
        onSelectProvince={(code) => setSelectedProvinceCode(code)}
        onSelectDistrictFromSearch={(pCode, dCode) => handleOpenDistrictEditor(pCode, dCode)}
        onOpenOfficerPortal={() =>
          setOfficerPortalState({
            open: true,
            provinceCode: selectedProvinceCode,
            districtCode: selectedDistrictCode,
          })
        }
      />

      {/* ซ่อนแถบควบคุมแผนที่เมื่ออยู่ในหน้ากรอกคะแนน 928 อำเภอ เพื่อให้พื้นที่กรอกโปร่งสบายตา */}
      {activeView !== 'districts' && (
        <HazardControlBar
          activeDimension={activeDimension}
          onChangeDimension={(dim) => handleChangeDimension(dim, null)}
          activeLayer={activeLayer}
          onChangeLayer={(layer) => {
            setActiveLayer(layer);
            setLevelFilter(null);
          }}
          activeSubIndicator={activeSubIndicator}
          onChangeSubIndicator={(sub) => {
            setActiveSubIndicator(sub);
            setLevelFilter(null);
          }}
          compositeMode={compositeMode}
          onChangeCompositeMode={setCompositeMode}
          regionFilter={regionFilter}
          onChangeRegionFilter={setRegionFilter}
          periods={periods}
          activePeriodId={activePeriodId}
          onChangePeriod={handleSelectPeriod}
          onOpenMethodology={() => setMethodologyOpen(true)}
        />
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <main
        id="main-content"
        className={`mx-auto w-full max-w-[1480px] flex-1 px-3 py-4 sm:px-4 ${
          compareCodes.length > 0 ? 'pb-24' : 'pb-10'
        }`}
      >
        {/* แถบแจ้งเตือนบางๆ เมื่อแผนที่กำลังแสดงร่วมกับค่าทดลองรายอำเภอ */}
        {activeView !== 'districts' && sandboxStats.districtCount > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-300 bg-teal-50/90 px-4 py-2.5 text-xs text-teal-950">
            <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
              <SlidersHorizontal className="h-4 w-4 text-[#0D9488] shrink-0" aria-hidden="true" />
              กำลังแสดงผลร่วมกับค่าทดลองกรอกรายอำเภอ ({sandboxStats.districtCount} อำเภอ ใน{' '}
              {sandboxStats.provinceCount} จังหวัด) — ยังไม่บันทึกลงฐานข้อมูลกลาง
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleChangeView('districts')}
                className="rounded-lg bg-white px-2.5 py-1 font-semibold text-[#115E59] ring-1 ring-teal-300 hover:bg-teal-100"
              >
                กลับไปแก้รายอำเภอ
              </button>
              <button
                type="button"
                onClick={() => setSandboxDistrictMetrics({})}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0D9488] px-2.5 py-1 font-semibold text-white hover:bg-[#0F766E]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>ล้างค่าทดลองทั้งหมด</span>
              </button>
            </div>
          </div>
        )}

        {activeView === 'map' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
              <div className="lg:col-span-7 xl:col-span-8">
                <ThailandRiskMap
                  evaluations={evaluations}
                  activeDimension={activeDimension}
                  activeLayer={activeLayer}
                  activeSubIndicator={activeSubIndicator}
                  selectedProvinceCode={selectedProvinceCode}
                  compareCodes={compareCodes}
                  regionFilter={regionFilter}
                  levelFilter={levelFilter}
                  simulatedCount={simulatedCount}
                  patternMode={patternMode}
                  onTogglePatternMode={() => setPatternMode((v) => !v)}
                  onResetAllSimulations={() => setCapacityOverridesByProvince({})}
                  onChangeLevelFilter={setLevelFilter}
                  onSelectProvince={(code) => setSelectedProvinceCode(code)}
                />
              </div>

              <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-[106px]">
                <ProvinceDetailPanel
                  evaluations={evaluations}
                  selectedEvaluation={selectedEvaluation}
                  activeDimension={activeDimension}
                  activeLayer={activeLayer}
                  activeSubIndicator={activeSubIndicator}
                  activePeriodId={activePeriodId}
                  activePeriodLabelTh={activePeriod.labelTh}
                  provinceDistricts={provinceDistricts}
                  districtsLoading={districtsLoading}
                  provinceTrend={provinceTrend}
                  authUser={authUser}
                  compareCodes={compareCodes}
                  onSelectProvince={setSelectedProvinceCode}
                  onSelectPeriod={handleSelectPeriod}
                  onChangeDimension={handleChangeDimension}
                  onChangeLayer={(layer) => {
                    if (activeDimension !== 'R' && activeDimension !== 'H') {
                      setActiveDimension('R');
                      setActiveSubIndicator(null);
                    }
                    setActiveLayer(layer);
                    setLevelFilter(null);
                  }}
                  onToggleCompare={handleToggleCompare}
                  onUpdateCapacityOverride={handleUpdateCapacityOverride}
                  onOpenDistrictEditor={handleOpenDistrictEditor}
                  onOpenChangelog={() => setChangelogOpen(true)}
                  onOpenReportModal={(name) =>
                    setReportState({ open: true, provinceName: name })
                  }
                />
              </div>
            </div>

            {/* แถบสรุป 77 จังหวัดแบบกระชับ แทนที่ตารางขนาดใหญ่เดิม */}
            <NationalBriefStrip
              evaluations={evaluations}
              activeDimension={activeDimension}
              activePeriodLabelTh={activePeriod.labelTh}
              regionFilter={regionFilter}
              levelFilter={levelFilter}
              onChangeRegionFilter={setRegionFilter}
              onChangeLevelFilter={setLevelFilter}
              onSelectProvince={(code) => {
                setSelectedProvinceCode(code);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenFullTable={() => handleChangeView('table')}
              onOpenDistrictWorkspace={() => handleChangeView('districts')}
            />
          </div>
        )}

        {activeView === 'table' && (
          <ProvinceRankingTable
            evaluations={evaluations}
            activeDimension={activeDimension}
            activeLayer={activeLayer}
            activeSubIndicator={activeSubIndicator}
            activePeriodId={activePeriodId}
            activePeriodLabelTh={activePeriod.labelTh}
            regionFilter={regionFilter}
            compareCodes={compareCodes}
            onSelectProvince={handleSelectFromTable}
            onToggleCompare={handleToggleCompare}
          />
        )}

        {activeView === 'districts' && (
          <DistrictScoreWorkspace
            periods={periods}
            activePeriodId={activePeriodId}
            provincesData={provincesData}
            initialProvinceCode={selectedProvinceCode}
            initialDistrictCode={selectedDistrictCode}
            authUser={authUser}
            csrfToken={csrfToken}
            dbConnected={dbConnected}
            sandboxMetricsByDistrict={sandboxDistrictMetrics}
            onUpdateSandboxDistrict={handleUpdateSandboxDistrict}
            onClearAllSandbox={() => setSandboxDistrictMetrics({})}
            onChangePeriod={handleSelectPeriod}
            onOpenOfficerLoginForDistrict={(pCode, dCode) =>
              setOfficerPortalState({ open: true, provinceCode: pCode, districtCode: dCode })
            }
            onOpenOfficerQueue={() =>
              setOfficerPortalState({ open: true, provinceCode: selectedProvinceCode, districtCode: selectedDistrictCode })
            }
            onJumpToProvinceOnMap={(pCode) => {
              setSelectedProvinceCode(pCode);
              handleChangeView('map');
            }}
            onDataMutated={handleDataMutated}
            onProvinceDistrictsLoaded={handleProvinceDistrictsLoaded}
            onAnnounce={(msg) => setAnnouncementOverride(msg)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200/90 bg-white text-slate-600">
        <div className="mx-auto max-w-[1480px] px-4 py-6 space-y-4">
          <div className="rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-4 text-xs leading-relaxed text-slate-700">
            <strong className="text-[#0C2340]">คำชี้แจงการใช้ข้อมูล:</strong>{' '}
            ข้อมูลในระบบนี้จัดทำขึ้นจากค่าฐานจำลองเชิงสถิติ 77 จังหวัด 928 อำเภอ/เขต ตามกรอบแผนการป้องกันและบรรเทาสาธารณภัยแห่งชาติ พ.ศ. 2564-2570
            เพื่อใช้ประกอบการวางแผนและเตรียมพร้อม มิใช่ประกาศเขตพื้นที่ประสบสาธารณภัยหรือคำสั่งอพยพตามกฎหมาย
            หากพบเหตุฉุกเฉินโปรดแจ้งสายด่วนนิรภัย ปภ.{' '}
            <a href="tel:1784" className="font-bold text-[#0C2340] underline tabular-nums">
              1784
            </a>{' '}
            หรือเจ็บป่วยฉุกเฉิน สพฉ.{' '}
            <a href="tel:1669" className="font-bold text-[#0C2340] underline tabular-nums">
              1669
            </a>{' '}
            ตลอด 24 ชั่วโมง
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-slate-500 tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                ไม่เก็บคุกกี้ติดตามหน้าสาธารณะ (PDPA) และมาตรฐานสี WCAG 2.1 AA
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <Database className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                {footerStorageText}
              </span>
              <span>อ้างอิงขอบเขต 77 จังหวัด กรมการปกครอง</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setMethodologyOpen(true)}
                className="inline-flex items-center gap-1 font-medium text-[#1D4ED8] hover:underline"
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                ระเบียบวิธีและตัวชี้วัด
              </button>
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline"
              >
                <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                ประวัติการปรับปรุงข้อมูล
              </button>
              <button
                type="button"
                onClick={() => setReportState({ open: true })}
                className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline"
              >
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                แจ้งข้อมูลคลาดเคลื่อน
              </button>
              <a
                href="tel:1784"
                className="inline-flex items-center gap-1 rounded-full bg-[#0C2340] px-3 py-1 font-semibold text-white hover:bg-[#16355B] tabular-nums"
              >
                <Phone className="h-3 w-3" aria-hidden="true" />
                สายด่วน 1784
              </a>
            </div>
          </div>
        </div>
      </footer>

      <CompareTray
        comparedEvaluations={comparedEvaluations}
        onRemove={handleToggleCompare}
        onClearAll={() => setCompareCodes([])}
        onOpenModal={() => setCompareModalOpen(true)}
      />

      <MethodologyModal open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
      <CompareProvincesModal
        open={compareModalOpen}
        comparedEvaluations={comparedEvaluations}
        onClose={() => setCompareModalOpen(false)}
        onRemove={handleToggleCompare}
      />
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ReportDiscrepancyModal
        open={reportState.open}
        initialProvinceName={reportState.provinceName}
        onClose={() => setReportState({ open: false })}
      />
      <OfficerPortalModal
        open={officerPortalState.open}
        onClose={() => setOfficerPortalState({ open: false })}
        periods={periods}
        activePeriodId={activePeriodId}
        authUser={authUser}
        csrfToken={csrfToken}
        demoMode={serverDemoMode}
        initialProvinceCode={officerPortalState.provinceCode}
        initialDistrictCode={officerPortalState.districtCode}
        onAuthChanged={(nextUser, nextCsrf) => {
          setAuthUser(nextUser);
          setCsrfToken(nextCsrf);
        }}
        onDataMutated={handleDataMutated}
        onOpenDistrictEditor={handleOpenDistrictEditor}
      />
    </div>
  );
}
