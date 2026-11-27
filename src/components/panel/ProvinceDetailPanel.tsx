import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileClock,
  Flag,
  GitCompareArrows,
  MapPin,
  Phone,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  TrendingDown,
} from 'lucide-react';
import { CORE_HOTLINES, HAZARD_BY_ID, HAZARD_CATALOG } from '../../data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  SUB_INDICATOR_BY_ID,
  VULNERABILITY_INDICATORS,
} from '../../data/indicatorCatalog.ts';
import {
  CAPACITY_LEVEL_STYLES,
  getPaletteForDimension,
  MAP_DIMENSION_META,
  NA_RISK_STYLE,
  REGION6_LABELS,
  RISK_LEVEL_LIST,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette.ts';
import { scoreToRiskLevel } from '../../domain/riskCalculator.ts';
import type {
  AuthUser,
  CapacityIndicatorId,
  CapacityOverrides,
  DistrictEvaluation,
  HazardId,
  LayerSelection,
  MapDimension,
  ProvinceEvaluation,
  ProvinceTrendPoint,
  SubIndicatorId,
} from '../../types/index.ts';
import { HazardIcon, RiskBadge } from '../common/RiskBadge.tsx';
import { ProvinceDistrictsTab } from './ProvinceDistrictsTab.tsx';
import { ProvinceTrendChart } from './ProvinceTrendChart.tsx';

interface ProvinceDetailPanelProps {
  evaluations: readonly ProvinceEvaluation[];
  selectedEvaluation: ProvinceEvaluation | null;
  activeDimension: MapDimension;
  activeLayer: LayerSelection;
  activeSubIndicator: SubIndicatorId | null;
  activePeriodId: string;
  activePeriodLabelTh: string;
  provinceDistricts: readonly DistrictEvaluation[];
  districtsLoading: boolean;
  provinceTrend: readonly ProvinceTrendPoint[];
  authUser: AuthUser | null;
  compareCodes: readonly string[];
  onSelectProvince: (dopaCode: string | null) => void;
  onSelectPeriod: (periodId: string) => void;
  onChangeDimension: (dim: MapDimension, subId?: SubIndicatorId | null) => void;
  onChangeLayer: (layer: LayerSelection) => void;
  onToggleCompare: (dopaCode: string) => void;
  onUpdateCapacityOverride: (dopaCode: string, overrides: CapacityOverrides | null) => void;
  onOpenDistrictEditor: (provinceCode: string, districtCode?: string) => void;
  onOpenChangelog: () => void;
  onOpenReportModal: (provinceNameTh?: string) => void;
}

type DetailTab = 'overview' | 'districts' | 'simulate';

export function ProvinceDetailPanel({
  evaluations,
  selectedEvaluation,
  activeDimension,
  activeLayer,
  activeSubIndicator,
  activePeriodId,
  activePeriodLabelTh,
  provinceDistricts,
  districtsLoading,
  provinceTrend,
  authUser,
  compareCodes,
  onSelectProvince,
  onSelectPeriod,
  onChangeDimension,
  onChangeLayer,
  onToggleCompare,
  onUpdateCapacityOverride,
  onOpenDistrictEditor,
  onOpenChangelog,
  onOpenReportModal,
}: ProvinceDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [openAccordion, setOpenAccordion] = useState<'H' | 'E' | 'V' | 'C'>('H');
  const [copiedLink, setCopiedLink] = useState(false);
  const [guidanceHazardOverride, setGuidanceHazardOverride] = useState<HazardId | null>(null);

  const palette = getPaletteForDimension(activeDimension);
  const isCapacityMode = activeDimension === 'C';

  const nationalSummary = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let validCount = 0;
    let sumH = 0;
    let sumE = 0;
    let sumV = 0;
    let sumC = 0;

    for (const ev of evaluations) {
      sumH += ev.breakdown.hazardCompositeScore;
      sumE += ev.breakdown.exposureScore;
      sumV += ev.breakdown.vulnerabilityScore;
      sumC += ev.breakdown.effectiveCapacityScore;
      if (ev.level !== null && ev.score !== null) {
        counts[ev.level] += 1;
        sum += ev.score;
        validCount += 1;
      }
    }

    const n = Math.max(1, evaluations.length);
    return {
      counts,
      avgScore: validCount > 0 ? sum / validCount : 0,
      avgH: sumH / n,
      avgE: sumE / n,
      avgV: sumV / n,
      avgC: sumC / n,
    };
  }, [evaluations]);

  const benchmarks = useMemo(() => {
    if (!selectedEvaluation) return null;
    const regionPeers = evaluations.filter(
      (ev) => ev.province.region6 === selectedEvaluation.province.region6 && ev.score !== null,
    );
    const countryPeers = evaluations.filter((ev) => ev.score !== null);
    const regionAvg =
      regionPeers.length > 0
        ? regionPeers.reduce((acc, ev) => acc + (ev.score ?? 0), 0) / regionPeers.length
        : 0;
    const countryAvg =
      countryPeers.length > 0
        ? countryPeers.reduce((acc, ev) => acc + (ev.score ?? 0), 0) / countryPeers.length
        : 0;
    return { regionAvg, countryAvg };
  }, [evaluations, selectedEvaluation]);

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  };

  // ==================== มุมมองเริ่มต้น: ภาพรวมประเทศแบบกระชับ ====================
  if (!selectedEvaluation) {
    const dimMeta = MAP_DIMENSION_META[activeDimension];
    const subTitle =
      activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]
        ? SUB_INDICATOR_BY_ID[activeSubIndicator].nameTh
        : activeDimension === 'R' || activeDimension === 'H'
          ? activeLayer === 'composite'
            ? `${dimMeta.nameTh} (รวม 10 ภัย)`
            : `${dimMeta.nameTh}: ${HAZARD_BY_ID[activeLayer].nameTh}`
          : dimMeta.nameTh;

    return (
      <aside
        aria-label="สรุปภาพรวมความเสี่ยงสาธารณภัยระดับประเทศ"
        className="gov-card flex flex-col gap-4 p-5"
      >
        <div className="border-b border-slate-100 pb-3.5">
          <p className="text-xs font-semibold text-[#1D4ED8]">
            ภาพรวม 77 จังหวัด • {activePeriodLabelTh}
          </p>
          <h2 className="mt-1 text-lg font-bold text-[#0C2340] leading-snug">{subTitle}</h2>
          <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed">
            เลือกจังหวัดบนแผนที่เพื่อดูองค์ประกอบ 4 ปัจจัย รายอำเภอ และจำลองแผนเพิ่มศักยภาพ
          </p>
        </div>

        {/* ค่าเฉลี่ย 4 ปัจจัยหลัก */}
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-2">ค่าเฉลี่ยระดับประเทศทั้ง 4 ปัจจัย</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {(
              [
                { dim: 'H' as const, label: 'ภัยคุกคาม', val: nationalSummary.avgH, isCap: false },
                { dim: 'E' as const, label: 'ล่อแหลม', val: nationalSummary.avgE, isCap: false },
                { dim: 'V' as const, label: 'เปราะบาง', val: nationalSummary.avgV, isCap: false },
                { dim: 'C' as const, label: 'ศักยภาพ', val: nationalSummary.avgC, isCap: true },
              ] as const
            ).map((box) => {
              const active = activeDimension === box.dim;
              return (
                <button
                  key={box.dim}
                  type="button"
                  onClick={() => onChangeDimension(box.dim, null)}
                  className={`rounded-xl p-2.5 transition-all ${
                    active
                      ? box.isCap
                        ? 'bg-teal-50 ring-2 ring-[#0D9488]'
                        : 'bg-blue-50/70 ring-2 ring-[#0C2340]'
                      : box.isCap
                        ? 'bg-teal-50/50 ring-1 ring-teal-200/80 hover:bg-teal-50'
                        : 'bg-slate-50 ring-1 ring-slate-200/80 hover:bg-slate-100'
                  }`}
                >
                  <p className="text-xs font-medium text-slate-600">{box.label}</p>
                  <p
                    className={`mt-1 text-base font-bold tabular-nums ${
                      box.isCap ? 'text-[#0D9488]' : 'text-[#0C2340]'
                    }`}
                  >
                    {box.val.toFixed(2)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* จำนวนจังหวัดแยกตาม 5 ระดับ */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">
              {isCapacityMode ? 'การกระจายตัวตามระดับศักยภาพ' : 'การกระจายตัวตามระดับคะแนน'}
            </span>
            <span className="text-slate-500 tabular-nums">
              เฉลี่ย {nationalSummary.avgScore.toFixed(2)} / 5.00
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {RISK_LEVEL_LIST.map((lvl) => {
              const style = palette[lvl];
              return (
                <div
                  key={lvl}
                  className="flex flex-col items-center rounded-xl p-2 text-center"
                  style={{ backgroundColor: style.tintBg }}
                >
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      backgroundColor: style.mapFill,
                      color: isCapacityMode && lvl <= 3 ? '#0F172A' : style.badgeText,
                    }}
                    aria-hidden="true"
                  >
                    {style.symbol}
                  </span>
                  <span className="mt-1 text-base font-bold text-slate-900 tabular-nums leading-none">
                    {nationalSummary.counts[lvl]}
                  </span>
                  <span className="mt-1 text-xs font-medium text-slate-700 leading-tight">
                    {style.shortLabelTh}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ทางลัดกรอกคะแนนรายอำเภอ */}
        <div className="rounded-xl bg-[#0C2340] p-4 text-white space-y-2">
          <p className="text-sm font-semibold">กรอกและประเมินคะแนนรายอำเภอทั้งประเทศ</p>
          <p className="text-xs text-slate-300 leading-relaxed">
            ครบทั้ง 928 อำเภอ/เขต ใน 77 จังหวัด ปรับคะแนนตัวแปรครบ 23 รายการ และดูผลรวมระดับจังหวัดได้ทันที
          </p>
          <button
            type="button"
            onClick={() => onOpenDistrictEditor('50')}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#0C2340] hover:bg-slate-100 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>เปิดหน้ากรอกคะแนน 928 อำเภอ/เขต</span>
          </button>
        </div>

        {/* สายด่วน 24 ชม. */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
          {CORE_HOTLINES.map((h) => (
            <a
              key={h.number}
              href={`tel:${h.number}`}
              className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/80 hover:bg-blue-50/60 transition-colors"
            >
              <Phone className="h-4 w-4 text-[#1D4ED8] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0C2340] tabular-nums leading-none">
                  {h.number}
                </p>
                <p className="truncate text-xs text-slate-600 mt-0.5">{h.agency}</p>
              </div>
            </a>
          ))}
        </div>
      </aside>
    );
  }

  // ==================== มุมมองเจาะลึกรายจังหวัด (กระชับ 3 แท็บ) ====================
  const province = selectedEvaluation.province;
  const provinceTitle = province.dopaCode === '10' ? province.nameTh : `จังหวัด${province.nameTh}`;
  const isCompared = compareCodes.includes(province.dopaCode);
  const compareFull = compareCodes.length >= 3 && !isCompared;
  const bd = selectedEvaluation.breakdown;
  const heroScore = bd.ddpmScore;
  const heroLevel = heroScore !== null ? scoreToRiskLevel(heroScore) : null;

  const sortedHazards = [...HAZARD_CATALOG].sort((a, b) => {
    const sa = province.hazards[a.id].score;
    const sb = province.hazards[b.id].score;
    if (sa === null && sb === null) return 0;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sb - sa;
  });

  const defaultGuidanceHazard: HazardId =
    activeLayer !== 'composite' ? activeLayer : bd.dominantHazardId;
  const currentGuidanceHazardId = guidanceHazardOverride ?? defaultGuidanceHazard;
  const currentGuidanceDef = HAZARD_BY_ID[currentGuidanceHazardId];

  const handleSliderChange = (indId: CapacityIndicatorId, value: number) => {
    onUpdateCapacityOverride(province.dopaCode, {
      ...bd.effectiveCapacityIndicators,
      [indId]: value,
    });
  };

  const applyPresetCellAndTraining = () => {
    onUpdateCapacityOverride(province.dopaCode, {
      ...bd.effectiveCapacityIndicators,
      c_cell_broadcast: Math.min(5.0, +(province.capacityIndicators.c_cell_broadcast + 1.0).toFixed(2)),
      c_ddpm_training: Math.min(5.0, +(province.capacityIndicators.c_ddpm_training + 1.0).toFixed(2)),
    });
  };

  const applyPresetModelProvince = () => {
    onUpdateCapacityOverride(province.dopaCode, {
      c_cell_broadcast: 4.8,
      c_ddpm_training: 4.5,
      c_medical_ems: 4.5,
      c_eoc_machinery: 4.5,
      c_local_plan_budget: 4.5,
    });
  };

  const unit = province.dopaCode === '10' ? 'เขต' : 'อำเภอ';

  return (
    <aside
      aria-label={`ข้อมูลความเสี่ยงเจาะลึก ${provinceTitle}`}
      className="gov-card flex flex-col overflow-hidden"
    >
      {/* ส่วนหัวจังหวัดแบบกระชับ */}
      <div className="border-b border-slate-100 px-4 pt-3.5 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setGuidanceHazardOverride(null);
              setActiveTab('overview');
              onSelectProvince(null);
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D4ED8] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>ภาพรวมประเทศ</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={compareFull}
              onClick={() => onToggleCompare(province.dopaCode)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                isCompared
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : compareFull
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isCompared ? `เทียบ (${compareCodes.length}/3)` : 'เทียบ'}</span>
            </button>
            <button
              type="button"
              onClick={handleCopyShareLink}
              title="คัดลอกลิงก์หน้าจังหวัดนี้"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copiedLink ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  <span className="text-emerald-800">คัดลอกแล้ว</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>แชร์</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* แถวชื่อจังหวัด + คะแนนความเสี่ยงสุทธิ */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[#0C2340] leading-tight truncate">
              {provinceTitle}
            </h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 tabular-nums">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <span>
                {REGION6_LABELS[province.region6]} • อันดับ {selectedEvaluation.rank}/77
              </span>
            </p>
          </div>

          <div className="flex flex-col items-end shrink-0 tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-[#0C2340] leading-none">
                {heroScore !== null ? heroScore.toFixed(2) : 'N/A'}
              </span>
              <span className="text-xs text-slate-400">/ 5</span>
            </div>
            <div className="mt-1">
              <RiskBadge level={heroLevel} variant="solid" size="sm" compact />
            </div>
          </div>
        </div>

        {/* แถบ 4 ปัจจัย H/E/V/C แบบเรียบ (คลิกสลับมิติบนแผนที่ได้ทันที) */}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {(
            [
              {
                dim: 'H' as const,
                label: 'ภัยคุกคาม',
                val: bd.hazardActiveScore ?? bd.hazardCompositeScore,
                isCap: false,
              },
              { dim: 'E' as const, label: 'ล่อแหลม', val: bd.exposureScore, isCap: false },
              { dim: 'V' as const, label: 'เปราะบาง', val: bd.vulnerabilityScore, isCap: false },
              {
                dim: 'C' as const,
                label: 'ศักยภาพ',
                val: bd.effectiveCapacityScore,
                isCap: true,
              },
            ] as const
          ).map((item) => {
            const lvl = scoreToRiskLevel(item.val);
            const st = item.isCap ? CAPACITY_LEVEL_STYLES[lvl] : RISK_LEVEL_STYLES[lvl];
            const isAct = activeDimension === item.dim;
            return (
              <button
                key={item.dim}
                type="button"
                onClick={() => {
                  onChangeDimension(item.dim, null);
                  setOpenAccordion(item.dim);
                  setActiveTab('overview');
                }}
                className={`rounded-xl px-2 py-2 transition-all ${
                  isAct ? 'ring-2 ring-[#0C2340]' : 'hover:opacity-90'
                }`}
                style={{ backgroundColor: st.tintBg }}
              >
                <p className="text-xs font-medium text-slate-600 leading-none">{item.label}</p>
                <p className="mt-1 text-sm font-bold text-slate-900 tabular-nums leading-none">
                  {item.val.toFixed(2)}
                </p>
                <div className="mt-1.5 h-1 w-full rounded-full bg-white/70 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(item.val / 5) * 100}%`, backgroundColor: st.mapFill }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 แท็บกระชับ: ภาพรวม | รายอำเภอ | จำลองแผน */}
      <div
        role="tablist"
        aria-label="หมวดข้อมูลรายละเอียดจังหวัด"
        className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/70"
      >
        {(
          [
            { id: 'overview' as const, label: 'ภาพรวม' },
            {
              id: 'districts' as const,
              label:
                provinceDistricts.length > 0
                  ? `ราย${unit} (${provinceDistricts.length})`
                  : `ราย${unit}`,
            },
            {
              id: 'simulate' as const,
              label: bd.isSimulated ? 'จำลองแผน •' : 'จำลองแผน',
            },
          ] as const
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-2 py-2.5 text-xs sm:text-[13px] font-semibold transition-colors tabular-nums ${
                active
                  ? tab.id === 'simulate'
                    ? 'border-[#0D9488] text-[#0D9488] bg-white'
                    : 'border-[#0C2340] text-[#0C2340] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* เนื้อหาภายในแท็บ (สูงสมดุลกับแผนที่) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[520px]">
        {activeTab === 'overview' && (
          <>
            <p className="text-[13px] leading-relaxed text-slate-700">
              {selectedEvaluation.summaryTh}
            </p>

            {/* ปุ่มเข้าสู่หน้ากรอกคะแนนรายอำเภอของจังหวัดนี้ */}
            <button
              type="button"
              onClick={() => onOpenDistrictEditor(province.dopaCode)}
              className="flex w-full items-center justify-between rounded-xl border border-teal-200 bg-teal-50/60 px-3.5 py-2.5 text-xs font-semibold text-[#115E59] hover:bg-teal-100/70 transition-colors"
            >
              <span>กรอกหรือปรับคะแนนตัวแปรราย{unit}ของ{provinceTitle}</span>
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>

            {/* Accordion 4 ปัจจัยแบบไร้กรอบซ้อน (เปิดทีละหมวด) */}
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white overflow-hidden">
              {/* ภัยคุกคาม 10 ประเภท */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === 'H' ? 'C' : 'H')}
                  aria-expanded={openAccordion === 'H'}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="text-[13px] font-semibold text-[#0C2340]">
                    ภัยคุกคาม 10 ประเภท
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#0C2340] tabular-nums">
                    {bd.hazardCompositeScore.toFixed(2)}
                    {openAccordion === 'H' ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </span>
                </button>
                {openAccordion === 'H' && (
                  <div className="border-t border-slate-100 px-3.5 py-2.5 space-y-2">
                    {sortedHazards.map((h) => {
                      const entry = province.hazards[h.id];
                      const lvl = entry.score !== null ? scoreToRiskLevel(entry.score) : null;
                      const barColor =
                        lvl !== null ? RISK_LEVEL_STYLES[lvl].mapFill : NA_RISK_STYLE.mapFill;
                      const isSel = activeLayer === h.id && (activeDimension === 'R' || activeDimension === 'H');
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => onChangeLayer(h.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
                            isSel ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'
                          }`}
                        >
                          <HazardIcon layer={h.id} className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className="w-28 truncate text-xs font-medium text-slate-800">
                            {h.shortNameTh}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            {entry.score !== null && (
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(entry.score / 5) * 100}%`, backgroundColor: barColor }}
                              />
                            )}
                          </div>
                          <span className="w-10 text-right text-xs font-bold text-slate-900 tabular-nums">
                            {entry.score !== null ? entry.score.toFixed(2) : 'N/A'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ศักยภาพ 5 ตัวชี้วัด */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === 'C' ? 'H' : 'C')}
                  aria-expanded={openAccordion === 'C'}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-teal-50/40"
                >
                  <span className="text-[13px] font-semibold text-[#115E59]">
                    ศักยภาพความพร้อม (5 ตัวชี้วัด)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#115E59] tabular-nums">
                    {bd.effectiveCapacityScore.toFixed(2)}
                    {openAccordion === 'C' ? (
                      <ChevronUp className="h-4 w-4 text-teal-600" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-teal-600" />
                    )}
                  </span>
                </button>
                {openAccordion === 'C' && (
                  <div className="border-t border-slate-100 px-3.5 py-2.5 space-y-2">
                    {CAPACITY_INDICATORS.map((ind) => {
                      const val = bd.effectiveCapacityIndicators[ind.id];
                      const st = CAPACITY_LEVEL_STYLES[scoreToRiskLevel(val)];
                      const activeSub = activeDimension === 'C' && activeSubIndicator === ind.id;
                      return (
                        <button
                          key={ind.id}
                          type="button"
                          onClick={() => onChangeDimension('C', ind.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
                            activeSub ? 'bg-teal-50 ring-1 ring-teal-300' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="w-36 truncate text-xs font-medium text-slate-800">
                            {ind.shortNameTh}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-bold text-[#115E59] tabular-nums">
                            {val.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ความล่อแหลม 4 ตัวชี้วัด */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === 'E' ? 'H' : 'E')}
                  aria-expanded={openAccordion === 'E'}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="text-[13px] font-semibold text-[#0C2340]">
                    ความล่อแหลม (4 ตัวชี้วัด)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#0C2340] tabular-nums">
                    {bd.exposureScore.toFixed(2)}
                    {openAccordion === 'E' ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </span>
                </button>
                {openAccordion === 'E' && (
                  <div className="border-t border-slate-100 px-3.5 py-2.5 space-y-2">
                    {EXPOSURE_INDICATORS.map((ind) => {
                      const val = province.exposureIndicators[ind.id];
                      const st = RISK_LEVEL_STYLES[scoreToRiskLevel(val)];
                      return (
                        <button
                          key={ind.id}
                          type="button"
                          onClick={() => onChangeDimension('E', ind.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-50"
                        >
                          <span className="w-36 truncate text-xs font-medium text-slate-800">
                            {ind.shortNameTh}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-bold text-slate-900 tabular-nums">
                            {val.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ความเปราะบาง 4 ตัวชี้วัด */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === 'V' ? 'H' : 'V')}
                  aria-expanded={openAccordion === 'V'}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="text-[13px] font-semibold text-[#0C2340]">
                    ความเปราะบาง (4 ตัวชี้วัด)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[#0C2340] tabular-nums">
                    {bd.vulnerabilityScore.toFixed(2)}
                    {openAccordion === 'V' ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </span>
                </button>
                {openAccordion === 'V' && (
                  <div className="border-t border-slate-100 px-3.5 py-2.5 space-y-2">
                    {VULNERABILITY_INDICATORS.map((ind) => {
                      const val = province.vulnerabilityIndicators[ind.id];
                      const st = RISK_LEVEL_STYLES[scoreToRiskLevel(val)];
                      return (
                        <button
                          key={ind.id}
                          type="button"
                          onClick={() => onChangeDimension('V', ind.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-50"
                        >
                          <span className="w-36 truncate text-xs font-medium text-slate-800">
                            {ind.shortNameTh}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-bold text-slate-900 tabular-nums">
                            {val.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ส่วนกางดูเพิ่มเติม (Progressive Disclosure): แนวโน้มรายงวด + จุดเฝ้าระวังรายอำเภอ */}
            {(provinceTrend.length >= 2 || province.districtDiagnostics) && (
              <details className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5">
                <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-semibold text-[#0C2340]">
                  <span>แนวโน้มรายงวดและจุดเฝ้าระวังราย{unit}</span>
                  <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                </summary>
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  {province.districtDiagnostics && (
                    <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                      <div className="rounded-lg bg-slate-50 p-2.5">
                        <p className="text-slate-500">ช่วงความเสี่ยงราย{unit}</p>
                        <p className="font-bold text-[#0C2340]">
                          {province.districtDiagnostics.riskMin.toFixed(2)} -{' '}
                          {province.districtDiagnostics.riskMax.toFixed(2)}
                        </p>
                        <p className="text-slate-600 truncate">
                          สูงสุด: {province.districtDiagnostics.highestRiskDistrict.fullNameTh}
                        </p>
                      </div>
                      <div className="rounded-lg bg-teal-50/70 p-2.5">
                        <p className="text-teal-800">ช่วงศักยภาพราย{unit}</p>
                        <p className="font-bold text-[#115E59]">
                          {province.districtDiagnostics.capacityMin.toFixed(2)} -{' '}
                          {province.districtDiagnostics.capacityMax.toFixed(2)}
                        </p>
                        <p className="text-teal-900 truncate">
                          ควรเสริม: {province.districtDiagnostics.priorityCapacityDistrict.fullNameTh}
                        </p>
                      </div>
                    </div>
                  )}
                  <ProvinceTrendChart
                    trend={provinceTrend}
                    activePeriodId={activePeriodId}
                    onSelectPeriod={onSelectPeriod}
                  />
                </div>
              </details>
            )}

            {/* ส่วนกางดูเพิ่มเติม: แนวทางปฏิบัติ 3 ระยะและข้อมูลอ้างอิง */}
            <details className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5">
              <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-semibold text-[#0C2340]">
                <span>แนวทางปฏิบัติ 3 ระยะ และค่าเทียบเคียง</span>
                <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </summary>
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-xs">
                <div className="flex items-center gap-2">
                  <label htmlFor="guidance-hazard-select" className="text-slate-600 shrink-0">
                    เลือกภัย:
                  </label>
                  <select
                    id="guidance-hazard-select"
                    value={currentGuidanceHazardId}
                    onChange={(e) => setGuidanceHazardOverride(e.target.value as HazardId)}
                    className="flex-1 h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800"
                  >
                    {HAZARD_CATALOG.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.nameTh}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {(
                    [
                      { title: 'ก่อนเกิดภัย', items: currentGuidanceDef.guidance.before, bg: 'bg-blue-50/70' },
                      { title: 'ขณะเกิดภัย', items: currentGuidanceDef.guidance.during, bg: 'bg-amber-50/70' },
                      { title: 'หลังเกิดภัย', items: currentGuidanceDef.guidance.after, bg: 'bg-emerald-50/70' },
                    ] as const
                  ).map((phase) => (
                    <div key={phase.title} className={`rounded-lg ${phase.bg} p-2.5 space-y-1`}>
                      <p className="font-semibold text-[#0C2340]">{phase.title}</p>
                      <ul className="list-disc pl-4 space-y-0.5 text-slate-700 leading-relaxed">
                        {phase.items.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {benchmarks && (
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center tabular-nums">
                    <div>
                      <p className="text-slate-500">จังหวัดนี้</p>
                      <p className="font-bold text-[#0C2340]">
                        {selectedEvaluation.score?.toFixed(2) ?? 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">เฉลี่ยภาค</p>
                      <p className="font-bold text-slate-800">{benchmarks.regionAvg.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">เฉลี่ยประเทศ</p>
                      <p className="font-bold text-slate-800">{benchmarks.countryAvg.toFixed(2)}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onOpenChangelog}
                    className="inline-flex items-center gap-1 font-medium text-[#1D4ED8] hover:underline"
                  >
                    <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>ประวัติปรับปรุง</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenReportModal(provinceTitle)}
                    className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline"
                  >
                    <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>แจ้งข้อมูลคลาดเคลื่อน</span>
                  </button>
                </div>
              </div>
            </details>
          </>
        )}

        {activeTab === 'districts' && (
          <ProvinceDistrictsTab
            provinceNameTh={provinceTitle}
            periodLabelTh={activePeriodLabelTh}
            districts={provinceDistricts}
            loading={districtsLoading}
            authUser={authUser}
            onOpenDistrictEditor={(districtCode) =>
              onOpenDistrictEditor(province.dopaCode, districtCode)
            }
          />
        )}

        {activeTab === 'simulate' && (
          <div className="space-y-3.5">
            <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#115E59]">
                  จำลองเพิ่มศักยภาพเฉพาะ{provinceTitle}
                </span>
                {bd.isSimulated && (
                  <button
                    type="button"
                    onClick={() => onUpdateCapacityOverride(province.dopaCode, null)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-teal-900 ring-1 ring-teal-300 hover:bg-teal-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>คืนค่าเริ่มต้น</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="rounded-lg bg-white p-2">
                  <p className="text-xs text-slate-500">เดิม</p>
                  <p className="text-base font-bold text-slate-800">
                    {bd.baseDdpmScore !== null ? bd.baseDdpmScore.toFixed(2) : 'N/A'}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-2 ring-1 ring-teal-300">
                  <p className="text-xs font-semibold text-teal-900">หลังปรับแผน</p>
                  <p className="text-base font-extrabold text-[#0C2340]">
                    {bd.ddpmScore !== null ? bd.ddpmScore.toFixed(2) : 'N/A'}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <p className="text-xs text-slate-500">ส่วนต่าง</p>
                  <p
                    className={`text-sm font-bold flex items-center justify-center gap-0.5 ${
                      bd.simulationDeltaR < 0
                        ? 'text-emerald-700'
                        : bd.simulationDeltaR > 0
                          ? 'text-rose-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {bd.simulationDeltaR < 0 && <TrendingDown className="h-3.5 w-3.5" />}
                    {bd.simulationDeltaR > 0 ? '+' : ''}
                    {bd.simulationDeltaR.toFixed(2)}
                  </p>
                </div>
              </div>

              {bd.guardrailApplied && (
                <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-950">
                  ภัยคุกคามอยู่ในเกณฑ์สูงมาก ระบบคงคะแนนเฝ้าระวังขั้นต่ำไว้ที่ {bd.guardrailFloor.toFixed(2)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={applyPresetCellAndTraining}
                className="rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50"
              >
                เพิ่ม Cell Broadcast และอบรม (+1.0)
              </button>
              <button
                type="button"
                onClick={applyPresetModelProvince}
                className="rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50"
              >
                เกณฑ์จังหวัดต้นแบบ
              </button>
            </div>

            <div className="space-y-2.5">
              {CAPACITY_INDICATORS.map((ind) => {
                const baseVal = province.capacityIndicators[ind.id];
                const currentVal = bd.effectiveCapacityIndicators[ind.id];
                const diff = +(currentVal - baseVal).toFixed(2);
                return (
                  <div key={ind.id} className="rounded-xl bg-slate-50 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <label htmlFor={`sim-slider-${ind.id}`} className="font-semibold text-slate-800">
                        {ind.shortNameTh}
                      </label>
                      <span className="font-bold text-[#0D9488] tabular-nums">
                        {currentVal.toFixed(2)}
                        {diff !== 0 && (
                          <span className={`ml-1 ${diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            ({diff > 0 ? '+' : ''}
                            {diff.toFixed(2)})
                          </span>
                        )}
                      </span>
                    </div>
                    <input
                      id={`sim-slider-${ind.id}`}
                      type="range"
                      min={1.0}
                      max={5.0}
                      step={0.05}
                      value={currentVal}
                      onChange={(e) => handleSliderChange(ind.id, parseFloat(e.target.value))}
                      className="w-full accent-[#0D9488] cursor-pointer"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
