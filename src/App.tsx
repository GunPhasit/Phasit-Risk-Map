import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, FileClock, Flag, HelpCircle, Phone, ShieldCheck } from 'lucide-react';
import { HAZARD_BY_ID, HAZARD_IDS } from './data/hazardCatalog';
import { SUB_INDICATOR_BY_ID } from './data/indicatorCatalog';
import { PROVINCE_BY_CODE, PROVINCES_RISK_DATA } from './data/provincesRiskData';
import { MAP_DIMENSION_META } from './data/riskPalette';
import { evaluateAllProvinces } from './domain/riskCalculator';
import {
  fetchCurrentSession,
  fetchPeriods,
  fetchProvinceDistricts,
  fetchProvincesForPeriod,
  fetchProvinceTrend,
} from './services/riskApi.ts';
import type {
  AuthUser,
  CapacityOverrides,
  CompositeMode,
  DistrictEvaluation,
  LayerSelection,
  MapDimension,
  ProvinceRiskRecord,
  ProvinceTrendPoint,
  RegionFilterKey,
  ReportingPeriod,
  RiskLevel,
  SubIndicatorId,
} from './types/index.ts';
import { GovHeader } from './components/layout/GovHeader';
import { HazardControlBar } from './components/controls/HazardControlBar';
import { ThailandRiskMap } from './components/map/ThailandRiskMap';
import { ProvinceDetailPanel } from './components/panel/ProvinceDetailPanel';
import { ProvinceRankingTable } from './components/table/ProvinceRankingTable';
import { MethodologyModal } from './components/modals/MethodologyModal';
import {
  CompareProvincesModal,
  CompareTray,
} from './components/modals/CompareProvincesModal';
import {
  ChangelogModal,
  ReportDiscrepancyModal,
} from './components/modals/GovernanceModals';
import { OfficerPortalModal } from './components/portal/OfficerPortalModal.tsx';

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

function parseInitialUrlState(): {
  dimension: MapDimension;
  layer: LayerSelection;
  subIndicator: SubIndicatorId | null;
  mode: CompositeMode;
  periodId: string;
  provinceCode: string | null;
  compare: string[];
} {
  if (typeof window === 'undefined') {
    return {
      dimension: 'R',
      layer: 'composite',
      subIndicator: null,
      mode: 'ddpm64',
      periodId: FALLBACK_PERIOD.periodId,
      provinceCode: null,
      compare: [],
    };
  }
  const params = new URLSearchParams(window.location.search);
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

  const rawProv = params.get('province')?.replace(/^TH-/i, '') ?? null;
  const provinceCode = rawProv && PROVINCE_BY_CODE[rawProv] ? rawProv : null;

  const rawCompare = params.get('compare');
  const compare = rawCompare
    ? rawCompare
        .split(',')
        .map((c) => c.trim().replace(/^TH-/i, ''))
        .filter((c, idx, arr) => Boolean(PROVINCE_BY_CODE[c]) && arr.indexOf(c) === idx)
        .slice(0, 3)
    : [];

  return { dimension, layer, subIndicator, mode, periodId, provinceCode, compare };
}

export default function App() {
  const initial = useMemo(() => parseInitialUrlState(), []);

  const [activeDimension, setActiveDimension] = useState<MapDimension>(initial.dimension);
  const [activeLayer, setActiveLayer] = useState<LayerSelection>(initial.layer);
  const [activeSubIndicator, setActiveSubIndicator] = useState<SubIndicatorId | null>(
    initial.subIndicator,
  );
  const [compositeMode, setCompositeMode] = useState<CompositeMode>(initial.mode);
  const [selectedProvinceCode, setSelectedProvinceCode] = useState<string | null>(
    initial.provinceCode,
  );
  const [compareCodes, setCompareCodes] = useState<string[]>(initial.compare);
  const [regionFilter, setRegionFilter] = useState<RegionFilterKey>('all');
  const [levelFilter, setLevelFilter] = useState<RiskLevel | null>(null);
  const [activeView, setActiveView] = useState<'map' | 'table'>('map');
  const [capacityOverridesByProvince, setCapacityOverridesByProvince] = useState<
    Record<string, CapacityOverrides>
  >({});

  // สถานะฐานข้อมูลรายช่วงเวลา (Temporal DB State)
  const [periods, setPeriods] = useState<ReportingPeriod[]>([FALLBACK_PERIOD]);
  const [activePeriodId, setActivePeriodId] = useState<string>(initial.periodId);
  const [provincesData, setProvincesData] = useState<readonly ProvinceRiskRecord[]>(
    PROVINCES_RISK_DATA,
  );
  const [dbConnected, setDbConnected] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);

  // ข้อมูลรายอำเภอและกราฟแนวโน้มของจังหวัดที่เลือก
  const [provinceDistricts, setProvinceDistricts] = useState<readonly DistrictEvaluation[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(false);
  const [provinceTrend, setProvinceTrend] = useState<readonly ProvinceTrendPoint[]>([]);

  // สถานะเจ้าหน้าที่ ปภ. (แยกจากหน้าประชาชน)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [officerPortalOpen, setOfficerPortalOpen] = useState(false);

  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [reportState, setReportState] = useState<{ open: boolean; provinceName?: string }>({
    open: false,
  });

  // โหลดรายการงวดเวลาและตรวจเซสชันเจ้าหน้าที่ครั้งแรก
  const loadPeriodsAndProvinces = useCallback(async (targetPeriodId?: string) => {
    try {
      const list = await fetchPeriods();
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
        // ทำงานโหมดแผนที่สาธารณะต่อไปได้ตามปกติ
      });
  }, [initial.periodId, loadPeriodsAndProvinces]);

  // เมื่อผู้ใช้เปลี่ยนงวดเวลา ให้โหลดฐานข้อมูลจังหวัด 77 จังหวัดของงวดนั้นทันที
  const handleSelectPeriod = useCallback(async (nextPeriodId: string) => {
    setActivePeriodId(nextPeriodId);
    try {
      const res = await fetchProvincesForPeriod(nextPeriodId);
      setProvincesData(res.provinces);
      setDbConnected(true);
    } catch {
      // คงค่าเดิมหากไม่พบเซิร์ฟเวอร์
    }
  }, []);

  // เมื่อเลือกจังหวัดหรือเปลี่ยนงวดหรือมีการอนุมัติข้อมูลใหม่ ให้โหลดรายอำเภอและกราฟแนวโน้มทันที
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
        setProvinceTrend(trendRes);
      })
      .catch(() => {
        if (cancelled) return;
        setProvinceDistricts([]);
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
    () => periods.find((p) => p.periodId === activePeriodId) ?? periods[periods.length - 1] ?? FALLBACK_PERIOD,
    [periods, activePeriodId],
  );

  // ประมวลผลทั้ง 77 จังหวัดจากแหล่งข้อมูลกลางเดียว (ซิงก์แผนที่ กราฟ ตาราง เปรียบเทียบ และ CSV พร้อมกัน)
  const evaluations = useMemo(
    () =>
      evaluateAllProvinces(
        provincesData,
        activeDimension,
        activeLayer,
        compositeMode,
        activeSubIndicator,
        capacityOverridesByProvince,
      ),
    [
      provincesData,
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

  // ซิงก์สถานะกับ URL Deep-Linking และ document.title
  useEffect(() => {
    const params = new URLSearchParams();
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
    if (compareCodes.length > 0) {
      params.set('compare', compareCodes.map((c) => `TH-${c}`).join(','));
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', nextUrl);

    const dimName = MAP_DIMENSION_META[activeDimension].shortNameTh;
    const detailName =
      activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]
        ? SUB_INDICATOR_BY_ID[activeSubIndicator].shortNameTh
        : activeDimension === 'R' || activeDimension === 'H'
          ? activeLayer === 'composite'
            ? '10 สาธารณภัย'
            : HAZARD_BY_ID[activeLayer].shortNameTh
          : 'ภาพรวมตัวชี้วัด';

    if (selectedEvaluation) {
      const pName =
        selectedEvaluation.province.dopaCode === '10'
          ? selectedEvaluation.province.nameTh
          : `จังหวัด${selectedEvaluation.province.nameTh}`;
      document.title = `${pName} - ${dimName}: ${detailName} | แผนที่ความเสี่ยง ปภ.`;
    } else {
      document.title = `${dimName}: ${detailName} | ระบบแผนที่ความเสี่ยงสาธารณภัยแห่งประเทศไทย 77 จังหวัด`;
    }
  }, [
    activeDimension,
    activeLayer,
    activeSubIndicator,
    compositeMode,
    activePeriodId,
    selectedProvinceCode,
    compareCodes,
    selectedEvaluation,
  ]);

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
      if (!overrides) {
        delete next[dopaCode];
      } else {
        next[dopaCode] = overrides;
      }
      return next;
    });
  };

  const handleToggleCompare = (dopaCode: string) => {
    setCompareCodes((prev) => {
      if (prev.includes(dopaCode)) {
        return prev.filter((c) => c !== dopaCode);
      }
      if (prev.length >= 3) return prev;
      return [...prev, dopaCode];
    });
  };

  const handleSelectFromTable = (dopaCode: string) => {
    setSelectedProvinceCode(dopaCode);
    setActiveView('map');
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
    const lvl5Count = evaluations.filter((e) => e.level === 5).length;
    const dimLabel = MAP_DIMENSION_META[activeDimension].nameTh;
    const lvl5Label = activeDimension === 'C' ? 'ระดับ 5 ศักยภาพต้นแบบ' : 'ระดับ 5 สูงมาก';
    return `กำลังแสดงแผนที่${dimLabel} ประจำ${activePeriod.labelTh} มีจังหวัดในเกณฑ์${lvl5Label} จำนวน ${lvl5Count} จาก 77 จังหวัด`;
  }, [evaluations, activeDimension, activePeriod.labelTh]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <GovHeader
        evaluations={evaluations}
        activeDimension={activeDimension}
        activeView={activeView}
        authUser={authUser}
        onChangeView={setActiveView}
        onSelectProvince={(code) => setSelectedProvinceCode(code)}
        onOpenOfficerPortal={() => setOfficerPortalOpen(true)}
      />

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

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <main
        id="main-content"
        className={`mx-auto w-full max-w-[1480px] flex-1 px-3 py-4 sm:px-4 ${
          compareCodes.length > 0 ? 'pb-24' : 'pb-8'
        }`}
      >
        {activeView === 'map' ? (
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
                  onResetAllSimulations={() => setCapacityOverridesByProvince({})}
                  onChangeLevelFilter={setLevelFilter}
                  onSelectProvince={(code) => setSelectedProvinceCode(code)}
                />
              </div>

              <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-[116px]">
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
                  onOpenOfficerEdit={() => setOfficerPortalOpen(true)}
                  onOpenChangelog={() => setChangelogOpen(true)}
                  onOpenReportModal={(name) =>
                    setReportState({ open: true, provinceName: name })
                  }
                />
              </div>
            </div>

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
          </div>
        ) : (
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
      </main>

      <footer className="border-t border-slate-200 bg-white text-slate-600">
        <div className="mx-auto max-w-[1480px] px-4 py-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700">
            <strong className="text-[#0F294A]">คำชี้แจงการใช้ข้อมูล:</strong>{' '}
            ข้อมูลในระบบนี้จัดทำขึ้นจากค่าฐานจำลองเชิงสถิติ 77 จังหวัด 928 อำเภอ/เขต ตามกรอบแผนการป้องกันและบรรเทาสาธารณภัยแห่งชาติ พ.ศ. 2564-2570
            เพื่อใช้ประกอบการวางแผนและเตรียมพร้อม มิใช่ประกาศเขตพื้นที่ประสบสาธารณภัยหรือคำสั่งอพยพตามกฎหมาย
            หากพบเหตุฉุกเฉินโปรดแจ้งสายด่วนนิรภัย ปภ.{' '}
            <a href="tel:1784" className="font-bold text-[#0F294A] underline tabular-nums">
              1784
            </a>{' '}
            หรือเจ็บป่วยฉุกเฉิน สพฉ.{' '}
            <a href="tel:1669" className="font-bold text-[#0F294A] underline tabular-nums">
              1669
            </a>{' '}
            ตลอด 24 ชั่วโมง
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 tabular-nums">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                ไม่เก็บคุกกี้ติดตามหน้าสาธารณะ (PDPA) และมาตรฐานสี WCAG 2.1 AA
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                <Database className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                {dbConnected
                  ? `ฐานข้อมูล 928 อำเภอ/เขต ประจำ${activePeriod.labelTh}`
                  : 'ชุดข้อมูลค่าฐานจำลองในเครื่อง (77 จังหวัด)'}
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
                className="inline-flex items-center gap-1 rounded-full bg-[#0F294A] px-2.5 py-1 font-semibold text-white hover:bg-[#163A66] tabular-nums"
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
        open={officerPortalOpen}
        onClose={() => setOfficerPortalOpen(false)}
        periods={periods}
        activePeriodId={activePeriodId}
        authUser={authUser}
        csrfToken={csrfToken}
        onAuthChanged={(nextUser, nextCsrf) => {
          setAuthUser(nextUser);
          setCsrfToken(nextCsrf);
        }}
        onDataMutated={handleDataMutated}
      />
    </div>
  );
}
