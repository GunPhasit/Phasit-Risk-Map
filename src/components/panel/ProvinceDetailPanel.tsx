import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileClock,
  Flag,
  GitCompareArrows,
  Info,
  Map as MapIcon,
  MapPin,
  Phone,
  RotateCcw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
} from 'lucide-react';
import { CORE_HOTLINES, HAZARD_BY_ID, HAZARD_CATALOG } from '../../data/hazardCatalog';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  SUB_INDICATOR_BY_ID,
  VULNERABILITY_INDICATORS,
} from '../../data/indicatorCatalog';
import {
  CAPACITY_LEVEL_STYLES,
  getPaletteForDimension,
  MAP_DIMENSION_META,
  NA_RISK_STYLE,
  REGION6_LABELS,
  RISK_LEVEL_LIST,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette';
import { scoreToRiskLevel } from '../../domain/riskCalculator';
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
import { HazardIcon, RiskBadge } from '../common/RiskBadge';
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
  onOpenOfficerEdit: (districtCode: string) => void;
  onOpenChangelog: () => void;
  onOpenReportModal: (provinceNameTh?: string) => void;
}

type DetailTab = 'hevc' | 'districts' | 'guidance' | 'governance';
type PanelMode = 'baseline' | 'simulator';

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
  onOpenOfficerEdit,
  onOpenChangelog,
  onOpenReportModal,
}: ProvinceDetailPanelProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>('baseline');
  const [activeTab, setActiveTab] = useState<DetailTab>('hevc');
  const [openAccordion, setOpenAccordion] = useState<'H' | 'E' | 'V' | 'C'>('C');
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

    const top6 = [...evaluations]
      .filter((e) => e.score !== null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 6);

    const n = Math.max(1, evaluations.length);
    return {
      counts,
      avgScore: validCount > 0 ? sum / validCount : 0,
      avgH: sumH / n,
      avgE: sumE / n,
      avgV: sumV / n,
      avgC: sumC / n,
      top6,
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

  // ==================== มุมมองเริ่มต้น: ภาพรวมระดับประเทศ ====================
  if (!selectedEvaluation) {
    const dimMeta = MAP_DIMENSION_META[activeDimension];
    const subTitle =
      activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]
        ? SUB_INDICATOR_BY_ID[activeSubIndicator].nameTh
        : activeDimension === 'R' || activeDimension === 'H'
          ? activeLayer === 'composite'
            ? `${dimMeta.nameTh} (ภาพรวม 10 สาธารณภัย)`
            : `${dimMeta.nameTh}: ${HAZARD_BY_ID[activeLayer].nameTh}`
          : dimMeta.nameTh;

    return (
      <aside
        aria-label="สรุปภาพรวมความเสี่ยงสาธารณภัยระดับประเทศ"
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
      >
        <div className="border-b border-slate-100 pb-3">
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">
            ภาพรวมระดับประเทศ (77 จังหวัด)
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-[#0F294A] leading-snug">
            {subTitle}
          </h2>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            ความเสี่ยงสุทธิประเมินจาก <strong>ภัยคุกคาม</strong> <strong>ความล่อแหลม</strong> และ{' '}
            <strong>ความเปราะบาง</strong> โดยมี <strong>ศักยภาพของพื้นที่</strong> ช่วยลดความเสี่ยง
            เลือกจังหวัดบนแผนที่เพื่อดูรายละเอียดและจำลองแผนเพิ่มศักยภาพ
          </p>
        </div>

        {/* แถบคะแนนเฉลี่ยระดับประเทศทั้ง 4 ปัจจัย */}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {(
            [
              { dim: 'H' as const, label: 'ภัยคุกคาม', val: nationalSummary.avgH, isCap: false },
              { dim: 'E' as const, label: 'ความล่อแหลม', val: nationalSummary.avgE, isCap: false },
              { dim: 'V' as const, label: 'ความเปราะบาง', val: nationalSummary.avgV, isCap: false },
              { dim: 'C' as const, label: 'ศักยภาพ', val: nationalSummary.avgC, isCap: true },
            ] as const
          ).map((box) => {
            const active = activeDimension === box.dim;
            return (
              <button
                key={box.dim}
                type="button"
                onClick={() => onChangeDimension(box.dim, null)}
                className={`rounded-xl border p-2 transition-all ${
                  active
                    ? box.isCap
                      ? 'border-[#0F766E] bg-teal-50 ring-1 ring-[#0F766E]'
                      : 'border-[#0F294A] bg-blue-50/70 ring-1 ring-[#0F294A]'
                    : box.isCap
                      ? 'border-teal-200 bg-teal-50/40 hover:bg-teal-50'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100'
                }`}
              >
                <p className="text-[10px] font-semibold text-slate-600">{box.label}</p>
                <p
                  className={`mt-0.5 text-sm font-bold tabular-nums ${
                    box.isCap ? 'text-[#0F766E]' : 'text-[#0F294A]'
                  }`}
                >
                  {box.val.toFixed(2)}
                </p>
              </button>
            );
          })}
        </div>

        {/* จำนวนจังหวัดแยกตาม 5 ระดับ */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">
              {isCapacityMode
                ? 'จำนวนจังหวัดแยกตามระดับศักยภาพ'
                : 'จำนวนจังหวัดแยกตามระดับคะแนน'}
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
                  className="flex flex-col items-center rounded-xl border p-2 text-center"
                  style={{
                    backgroundColor: style.tintBg,
                    borderColor: style.tintBorder,
                  }}
                >
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
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
                  <span className="mt-1 text-[10px] font-medium text-slate-700 leading-tight">
                    {style.shortLabelTh}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 6 อันดับแรก */}
        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-xs font-semibold text-slate-700 mb-2">
            {isCapacityMode
              ? '6 จังหวัดที่มีศักยภาพสูงสุด'
              : '6 จังหวัดที่มีคะแนนสูงสุด'}
          </h3>
          <ul className="space-y-1.5">
            {nationalSummary.top6.map((ev) => {
              const style = ev.level !== null ? palette[ev.level] : null;
              return (
                <li key={ev.province.dopaCode}>
                  <button
                    type="button"
                    onClick={() => onSelectProvince(ev.province.dopaCode)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 text-xs font-bold text-slate-500 tabular-nums">
                        {ev.rank}.
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {ev.province.nameTh}
                        </p>
                        <p className="truncate text-[11px] text-slate-500 tabular-nums">
                          {REGION6_LABELS[ev.province.region6]} | ภัย {ev.breakdown.hazardCompositeScore.toFixed(1)} ศักยภาพ{' '}
                          {ev.breakdown.effectiveCapacityScore.toFixed(1)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-[#0F294A] tabular-nums">
                        {ev.score?.toFixed(2)}
                      </span>
                      {style && (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold"
                          style={{
                            backgroundColor: style.mapFill,
                            color: isCapacityMode && ev.level! <= 3 ? '#0F172A' : style.badgeText,
                          }}
                          aria-label={`ระดับ ${ev.level}`}
                        >
                          {style.symbol}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* สายด่วน 24 ชม. */}
        <div className="mt-auto rounded-xl border border-blue-100 bg-blue-50/70 p-3">
          <p className="text-xs font-semibold text-[#0F294A] mb-1.5">
            สายด่วนแจ้งเหตุสาธารณภัยตลอด 24 ชั่วโมง
          </p>
          <div className="grid grid-cols-2 gap-2">
            {CORE_HOTLINES.map((h) => (
              <a
                key={h.number}
                href={`tel:${h.number}`}
                className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-2.5 py-2 hover:bg-blue-50 transition-colors"
              >
                <Phone className="h-4 w-4 text-[#1D4ED8] shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0F294A] tabular-nums leading-none">
                    {h.number}
                  </p>
                  <p className="truncate text-[10px] text-slate-600 mt-0.5">{h.agency}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  // ==================== มุมมองเจาะลึกรายจังหวัด (HEVC + What-If Simulator) ====================
  const province = selectedEvaluation.province;
  const provinceTitle = province.dopaCode === '10' ? province.nameTh : `จังหวัด${province.nameTh}`;
  const isCompared = compareCodes.includes(province.dopaCode);
  const compareFull = compareCodes.length >= 3 && !isCompared;
  const bd = selectedEvaluation.breakdown;

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

  return (
    <aside
      aria-label={`ข้อมูลความเสี่ยงเจาะลึก ${provinceTitle}`}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden"
    >
      {/* ส่วนหัวคงที่: ชื่อจังหวัด + แถบสลับ ค่าฐานจำลอง / โหมดจำลองสถานการณ์ */}
      <div className="border-b border-slate-200 bg-slate-50/80 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => {
                setGuidanceHazardOverride(null);
                setPanelMode('baseline');
                onSelectProvince(null);
              }}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              กลับสู่ภาพรวมประเทศ
            </button>
            <h2 className="text-lg font-bold text-[#0F294A] leading-tight">{provinceTitle}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-600 tabular-nums">
              <MapPin className="h-3 w-3 text-slate-400" aria-hidden="true" />
              <span>
                {REGION6_LABELS[province.region6]} (อันดับที่ {selectedEvaluation.rank} จาก 77 จังหวัด)
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyShareLink}
            title="คัดลอกลิงก์หน้าจังหวัดนี้"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            {copiedLink ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />
                <span className="text-green-800">คัดลอกแล้ว</span>
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>แชร์</span>
              </>
            )}
          </button>
        </div>

        {/* ปุ่มสลับ 2 โหมด: ค่าฐานจำลอง vs จำลองเพิ่มศักยภาพ */}
        <div
          role="group"
          aria-label="สลับระหว่างค่าฐานจำลองกับโหมดจำลองเพิ่มศักยภาพ"
          className="grid grid-cols-2 rounded-xl bg-slate-200/80 p-1 text-xs font-semibold"
        >
          <button
            type="button"
            onClick={() => setPanelMode('baseline')}
            aria-pressed={panelMode === 'baseline'}
            className={`rounded-lg py-1.5 transition-all ${
              panelMode === 'baseline'
                ? 'bg-white text-[#0F294A] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ค่าฐานจำลอง
          </button>
          <button
            type="button"
            onClick={() => setPanelMode('simulator')}
            aria-pressed={panelMode === 'simulator'}
            className={`inline-flex items-center justify-center gap-1 rounded-lg py-1.5 transition-all ${
              panelMode === 'simulator'
                ? 'bg-[#0F766E] text-white shadow-xs'
                : 'text-teal-900 hover:bg-teal-50/70'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>จำลองเพิ่มศักยภาพ</span>
            {bd.isSimulated && (
              <span className="ml-0.5 h-2 w-2 rounded-full bg-amber-300" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* องค์ประกอบความเสี่ยง 4 ปัจจัย คลิกแต่ละกล่องเพื่อสลับมิติบนแผนที่ */}
        <div
          className="rounded-xl border border-slate-200 bg-white p-2.5"
          title="คลิกแต่ละปัจจัยเพื่อแสดงผลบนแผนที่ 77 จังหวัด"
        >
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[#0F294A]">องค์ประกอบความเสี่ยง 4 ปัจจัย</span>
            <button
              type="button"
              disabled={compareFull}
              onClick={() => onToggleCompare(province.dopaCode)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                isCompared
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : compareFull
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <GitCompareArrows className="h-3 w-3" aria-hidden="true" />
              <span>{isCompared ? `เทียบ (${compareCodes.length}/3)` : `+ เทียบ (${compareCodes.length}/3)`}</span>
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1 text-center">
            {(
              [
                {
                  dim: 'H' as const,
                  label: 'ภัยคุกคาม',
                  val: bd.hazardActiveScore ?? bd.hazardCompositeScore,
                  sign: '↑ เพิ่ม',
                  isCap: false,
                },
                {
                  dim: 'E' as const,
                  label: 'ล่อแหลม',
                  val: bd.exposureScore,
                  sign: '↑ เพิ่ม',
                  isCap: false,
                },
                {
                  dim: 'V' as const,
                  label: 'เปราะบาง',
                  val: bd.vulnerabilityScore,
                  sign: '↑ เพิ่ม',
                  isCap: false,
                },
                {
                  dim: 'C' as const,
                  label: 'ศักยภาพ',
                  val: bd.effectiveCapacityScore,
                  sign: '↓ ลดเสี่ยง',
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
                  }}
                  className={`rounded-lg border p-1.5 transition-all ${
                    isAct ? 'ring-2 ring-[#0F294A]' : 'hover:opacity-90'
                  }`}
                  style={{ backgroundColor: st.tintBg, borderColor: st.tintBorder }}
                >
                  <p className="text-[10px] font-semibold text-slate-700 leading-none">{item.label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900 tabular-nums leading-none">
                    {item.val.toFixed(2)}
                  </p>
                  <p className="mt-0.5 text-[9px] font-semibold" style={{ color: st.tintText }}>
                    {item.sign}
                  </p>
                </button>
              );
            })}

            {/* กล่องผลลัพธ์ R สุทธิ */}
            <button
              type="button"
              onClick={() => onChangeDimension('R', null)}
              className={`rounded-lg border p-1.5 transition-all ${
                activeDimension === 'R' ? 'ring-2 ring-[#0F294A]' : ''
              }`}
              style={{
                backgroundColor:
                  bd.ddpmScore !== null
                    ? RISK_LEVEL_STYLES[scoreToRiskLevel(bd.ddpmScore)].badgeBg
                    : NA_RISK_STYLE.badgeBg,
                color:
                  bd.ddpmScore !== null
                    ? RISK_LEVEL_STYLES[scoreToRiskLevel(bd.ddpmScore)].badgeText
                    : NA_RISK_STYLE.badgeText,
                borderColor: 'transparent',
              }}
            >
              <p className="text-[10px] font-semibold leading-none opacity-90">เสี่ยงสุทธิ</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums leading-none">
                {bd.ddpmScore !== null ? bd.ddpmScore.toFixed(2) : 'N/A'}
              </p>
              <p className="mt-0.5 text-[9px] font-semibold opacity-95">
                {bd.ddpmScore !== null ? `ระดับ ${scoreToRiskLevel(bd.ddpmScore)}` : 'N/A'}
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* ==================== โหมดจำลองแผนเพิ่มศักยภาพ ==================== */}
      {panelMode === 'simulator' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[560px]">
          <div className="rounded-xl border border-teal-300 bg-teal-50/80 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#0F766E] px-2.5 py-0.5 text-[11px] font-bold text-white">
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                จำลองแผนเพิ่มศักยภาพ
              </span>
              {bd.isSimulated && (
                <button
                  type="button"
                  onClick={() => onUpdateCapacityOverride(province.dopaCode, null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-teal-400 bg-white px-2 py-1 text-[11px] font-semibold text-teal-900 hover:bg-teal-100"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  คืนค่าเริ่มต้น
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white p-2 border border-teal-100">
                <p className="text-[10px] text-slate-500">ความเสี่ยงเดิม</p>
                <p className="text-base font-bold text-slate-800 tabular-nums">
                  {bd.baseDdpmScore !== null ? bd.baseDdpmScore.toFixed(2) : 'N/A'}
                </p>
                {bd.baseDdpmScore !== null && (
                  <RiskBadge
                    level={scoreToRiskLevel(bd.baseDdpmScore)}
                    variant="tinted"
                    size="sm"
                    compact
                  />
                )}
              </div>

              <div className="rounded-lg bg-white p-2 border border-teal-200 ring-1 ring-teal-300">
                <p className="text-[10px] font-semibold text-teal-900">ความเสี่ยงหลังปรับแผน</p>
                <p className="text-base font-extrabold text-[#0F294A] tabular-nums">
                  {bd.ddpmScore !== null ? bd.ddpmScore.toFixed(2) : 'N/A'}
                </p>
                {bd.ddpmScore !== null && (
                  <RiskBadge
                    level={scoreToRiskLevel(bd.ddpmScore)}
                    variant="solid"
                    size="sm"
                    compact
                  />
                )}
              </div>

              <div className="rounded-lg bg-white p-2 border border-teal-100 flex flex-col justify-center">
                <p className="text-[10px] text-slate-500">ผลต่างความเสี่ยง</p>
                <p
                  className={`text-sm font-bold tabular-nums flex items-center justify-center gap-0.5 ${
                    bd.simulationDeltaR < 0
                      ? 'text-emerald-700'
                      : bd.simulationDeltaR > 0
                        ? 'text-rose-700'
                        : 'text-slate-600'
                  }`}
                >
                  {bd.simulationDeltaR < 0 && <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                  {bd.simulationDeltaR > 0 ? '+' : ''}
                  {bd.simulationDeltaR.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-600 tabular-nums">
                  {bd.simulationReductionPct > 0
                    ? `ลดลง ${bd.simulationReductionPct.toFixed(1)}%`
                    : bd.simulationReductionPct < 0
                      ? `เพิ่มขึ้น ${Math.abs(bd.simulationReductionPct).toFixed(1)}%`
                      : 'เท่าค่าฐาน'}
                </p>
              </div>
            </div>

            {bd.guardrailApplied && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-950">
                <strong>เกณฑ์เฝ้าระวังขั้นต่ำ:</strong> เนื่องจากจังหวัดมีระดับภัยคุกคามสูงมาก ({bd.hazardActiveScore?.toFixed(2)} คะแนน)
                ระบบจึงคงคะแนนความเสี่ยงขั้นต่ำไว้ที่ {bd.guardrailFloor.toFixed(2)} เพื่อให้เฝ้าระวังต่อเนื่องแม้มีความพร้อมสูง
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={applyPresetCellAndTraining}
              className="rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-teal-900 hover:bg-teal-50"
            >
              เพิ่ม Cell Broadcast และอบรม ปภ. (+1.0)
            </button>
            <button
              type="button"
              onClick={applyPresetModelProvince}
              className="rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-teal-900 hover:bg-teal-50"
            >
              ยกระดับสู่เกณฑ์จังหวัดต้นแบบ
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-bold text-[#0F294A]">
                ปรับระดับศักยภาพรายด้าน (รวม {bd.effectiveCapacityScore.toFixed(2)} / 5.00)
              </h3>
              <span className="text-[11px] text-teal-800 tabular-nums">
                ค่าฐาน {bd.baseCapacityScore.toFixed(2)}
              </span>
            </div>

            {CAPACITY_INDICATORS.map((ind) => {
              const baseVal = province.capacityIndicators[ind.id];
              const currentVal = bd.effectiveCapacityIndicators[ind.id];
              const diff = +(currentVal - baseVal).toFixed(2);
              return (
                <div
                  key={ind.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <label htmlFor={`slider-${ind.id}`} className="text-xs font-semibold text-slate-800">
                      {ind.shortNameTh}{' '}
                      <span className="font-normal text-slate-500 tabular-nums">
                        (น้ำหนัก {(ind.weight * 100).toFixed(0)}%)
                      </span>
                    </label>
                    <span className="shrink-0 text-xs font-bold text-[#0F766E] tabular-nums">
                      {currentVal.toFixed(2)}
                      {diff !== 0 && (
                        <span className={`ml-1 text-[10px] ${diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          ({diff > 0 ? '+' : ''}
                          {diff.toFixed(2)})
                        </span>
                      )}
                    </span>
                  </div>
                  <input
                    id={`slider-${ind.id}`}
                    type="range"
                    min={1.0}
                    max={5.0}
                    step={0.1}
                    value={currentVal}
                    onChange={(e) => handleSliderChange(ind.id, parseFloat(e.target.value))}
                    className="w-full accent-[#0F766E] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 tabular-nums">
                    <span>1.00 (เร่งเสริมศักยภาพ)</span>
                    <span>ค่าฐาน {baseVal.toFixed(2)}</span>
                    <span>5.00 (ต้นแบบ)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* แถบ 4 แท็บในโหมดค่าฐานจำลอง (รวมรายอำเภอ) */}
          <div
            role="tablist"
            aria-label="หมวดข้อมูลรายละเอียดจังหวัด"
            className="grid grid-cols-4 border-b border-slate-200 bg-white"
          >
            {(
              [
                { id: 'hevc', label: '4 ปัจจัย' },
                {
                  id: 'districts',
                  label:
                    provinceDistricts.length > 0
                      ? `รายอำเภอ (${provinceDistricts.length})`
                      : 'รายอำเภอ',
                },
                { id: 'guidance', label: 'ปฏิบัติ 3 ระยะ' },
                { id: 'governance', label: 'อ้างอิง' },
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
                  className={`border-b-2 px-1.5 py-2.5 text-[11px] sm:text-xs font-semibold transition-colors tabular-nums ${
                    active
                      ? 'border-[#0F294A] text-[#0F294A] bg-slate-50/70'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[540px]">
            {activeTab === 'hevc' && (
              <>
                {/* สรุปภาพรวมรายจังหวัด */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold text-[#0F294A] mb-1">
                    สรุปภาพรวมรายจังหวัด ({activePeriodLabelTh})
                  </p>
                  <p className="text-xs leading-relaxed text-slate-700">
                    {selectedEvaluation.summaryTh}
                  </p>
                </div>

                {/* กราฟแนวโน้มรายงวดเวลา (ความเสี่ยงสุทธิ vs ศักยภาพ) */}
                <ProvinceTrendChart
                  trend={provinceTrend}
                  activePeriodId={activePeriodId}
                  onSelectPeriod={onSelectPeriod}
                />

                {/* ภาพรวมและจุดเฝ้าระวังรายอำเภอ/เขต */}
                {province.districtDiagnostics && (() => {
                  const unit = province.dopaCode === '10' ? 'เขต' : 'อำเภอ';
                  const diag = province.districtDiagnostics;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#0F294A] tabular-nums">
                          ภาพรวมราย{unit} ({diag.districtCount} แห่ง)
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab('districts')}
                          className="text-[11px] font-semibold text-[#1D4ED8] hover:underline"
                        >
                          ดูครบทุก{unit}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">ช่วงความเสี่ยงราย{unit}</p>
                          <p className="font-bold text-[#0F294A]">
                            {diag.riskMin.toFixed(2)} - {diag.riskMax.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-600 truncate">
                            สูงสุด: {diag.highestRiskDistrict.fullNameTh}
                          </p>
                        </div>
                        <div className="rounded-lg bg-teal-50/50 border border-teal-100 p-2">
                          <p className="text-teal-800">ช่วงศักยภาพราย{unit}</p>
                          <p className="font-bold text-[#115E59]">
                            {diag.capacityMin.toFixed(2)} - {diag.capacityMax.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-teal-900 truncate">
                            ควรเร่งเสริม: {diag.priorityCapacityDistrict.fullNameTh}
                          </p>
                        </div>
                      </div>

                      {diag.hasRiskHotspotAlert && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('districts')}
                          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left text-[11px] text-amber-950 hover:bg-amber-100/70 transition-colors tabular-nums"
                        >
                          <strong>พบจุดเฝ้าระวังพิเศษเฉพาะ{unit}:</strong>{' '}
                          {diag.highestRiskDistrict.fullNameTh} (
                          {diag.highestRiskDistrict.score.toFixed(2)} คะแนน)
                          {diag.criticalRiskDistrictCount > 0
                            ? ` | มี ${diag.criticalRiskDistrictCount} ${unit}ในเกณฑ์สูงมาก`
                            : ''}
                        </button>
                      )}

                      {diag.hasCapacityGapAlert && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('districts')}
                          className="w-full rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-left text-[11px] text-teal-950 hover:bg-teal-100/70 transition-colors tabular-nums"
                        >
                          <strong>พบ{unit}เป้าหมายเร่งเสริมศักยภาพ:</strong>{' '}
                          {diag.priorityCapacityDistrict.fullNameTh} (ศักยภาพ{' '}
                          {diag.priorityCapacityDistrict.score.toFixed(2)})
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Accordion 4 ปัจจัย */}
                <div className="space-y-2">
                  <div className="rounded-xl border border-teal-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAccordion(openAccordion === 'C' ? 'H' : 'C')}
                      className="flex w-full items-center justify-between bg-teal-50/70 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-[#0F766E]" aria-hidden="true" />
                        <span className="text-xs font-bold text-[#115E59]">
                          ศักยภาพในการรับมือ (5 ตัวชี้วัด)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#115E59] tabular-nums">
                          {bd.effectiveCapacityScore.toFixed(2)}
                        </span>
                        {openAccordion === 'C' ? (
                          <ChevronUp className="h-4 w-4 text-teal-700" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-teal-700" />
                        )}
                      </div>
                    </button>
                    {openAccordion === 'C' && (
                      <div className="divide-y divide-teal-100 bg-white p-2 space-y-1.5">
                        {CAPACITY_INDICATORS.map((ind) => {
                          const val = bd.effectiveCapacityIndicators[ind.id];
                          const lvl = scoreToRiskLevel(val);
                          const st = CAPACITY_LEVEL_STYLES[lvl];
                          const isProjected =
                            activeDimension === 'C' && activeSubIndicator === ind.id;
                          return (
                            <div key={ind.id} className="pt-1.5 first:pt-0">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-slate-800 truncate" title={ind.nameTh}>
                                  {ind.shortNameTh}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-bold text-[#115E59] tabular-nums">
                                    {val.toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onChangeDimension('C', ind.id)}
                                    title="แสดงตัวชี้วัดนี้บนแผนที่ 77 จังหวัด"
                                    className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                                      isProjected
                                        ? 'border-[#0F766E] bg-[#0F766E] text-white'
                                        : 'border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100'
                                    }`}
                                  >
                                    <MapIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                    แผนที่
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                                />
                              </div>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setPanelMode('simulator')}
                          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0F766E] py-1.5 text-xs font-semibold text-white hover:bg-[#115E59]"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          จำลองแผนเพิ่มศักยภาพจังหวัดนี้
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 2. ภัยคุกคาม */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAccordion(openAccordion === 'H' ? 'E' : 'H')}
                      className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-left"
                    >
                      <span className="text-xs font-bold text-[#0F294A]">
                        ภัยคุกคาม (10 ประเภทภัย)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0F294A] tabular-nums">
                          {bd.hazardCompositeScore.toFixed(2)}
                        </span>
                        {openAccordion === 'H' ? (
                          <ChevronUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </button>
                    {openAccordion === 'H' && (
                      <div className="bg-white p-2 space-y-1.5">
                        {sortedHazards.map((hazard) => {
                          const entry = province.hazards[hazard.id];
                          const isNa = !entry.applicable || entry.score === null;
                          const lvl = isNa ? null : scoreToRiskLevel(entry.score!);
                          const st = lvl !== null ? RISK_LEVEL_STYLES[lvl] : null;
                          const isCurrent =
                            (activeDimension === 'R' || activeDimension === 'H') &&
                            activeLayer === hazard.id;
                          return (
                            <button
                              key={hazard.id}
                              type="button"
                              onClick={() => onChangeLayer(hazard.id)}
                              className={`w-full rounded-lg border p-1.5 text-left transition-colors ${
                                isCurrent
                                  ? 'border-[#1D4ED8] bg-blue-50/60'
                                  : 'border-slate-100 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex items-center gap-1.5 font-medium text-slate-800 truncate">
                                  <HazardIcon layer={hazard.id} className="h-3.5 w-3.5 text-slate-500" />
                                  <span className="truncate">{hazard.nameTh}</span>
                                </span>
                                <span className="flex items-center gap-1.5 shrink-0 tabular-nums">
                                  <span className="font-bold text-slate-900">
                                    {isNa ? 'N/A' : entry.score!.toFixed(2)}
                                  </span>
                                  <span
                                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: st ? st.tintBg : NA_RISK_STYLE.tintBg,
                                      color: st ? st.tintText : NA_RISK_STYLE.tintText,
                                    }}
                                  >
                                    {st ? `${st.symbol} ระดับ ${lvl}` : '— N/A'}
                                  </span>
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                {!isNa && st && (
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${(entry.score! / 5) * 100}%`,
                                      backgroundColor: st.mapFill,
                                    }}
                                  />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 3. ความล่อแหลม (E • 4 ตัวชี้วัดย่อย) */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAccordion(openAccordion === 'E' ? 'V' : 'E')}
                      className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-left"
                    >
                      <span className="text-xs font-bold text-[#0F294A]">
                        ความล่อแหลม (4 ตัวชี้วัด)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0F294A] tabular-nums">
                          {bd.exposureScore.toFixed(2)}
                        </span>
                        {openAccordion === 'E' ? (
                          <ChevronUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </button>
                    {openAccordion === 'E' && (
                      <div className="divide-y divide-slate-100 bg-white p-2 space-y-1.5">
                        {EXPOSURE_INDICATORS.map((ind) => {
                          const val = province.exposureIndicators[ind.id];
                          const st = RISK_LEVEL_STYLES[scoreToRiskLevel(val)];
                          const isProjected =
                            activeDimension === 'E' && activeSubIndicator === ind.id;
                          return (
                            <div key={ind.id} className="pt-1.5 first:pt-0">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-slate-800 truncate" title={ind.nameTh}>
                                  {ind.shortNameTh}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-bold text-slate-900 tabular-nums">
                                    {val.toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onChangeDimension('E', ind.id)}
                                    className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                                      isProjected
                                        ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white'
                                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <MapIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                    แผนที่
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 4. ความเปราะบาง (V • 4 ตัวชี้วัดย่อย) */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAccordion(openAccordion === 'V' ? 'C' : 'V')}
                      className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-left"
                    >
                      <span className="text-xs font-bold text-[#0F294A]">
                        ความเปราะบาง (4 ตัวชี้วัด)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0F294A] tabular-nums">
                          {bd.vulnerabilityScore.toFixed(2)}
                        </span>
                        {openAccordion === 'V' ? (
                          <ChevronUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </button>
                    {openAccordion === 'V' && (
                      <div className="divide-y divide-slate-100 bg-white p-2 space-y-1.5">
                        {VULNERABILITY_INDICATORS.map((ind) => {
                          const val = province.vulnerabilityIndicators[ind.id];
                          const st = RISK_LEVEL_STYLES[scoreToRiskLevel(val)];
                          const isProjected =
                            activeDimension === 'V' && activeSubIndicator === ind.id;
                          return (
                            <div key={ind.id} className="pt-1.5 first:pt-0">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-slate-800 truncate" title={ind.nameTh}>
                                  {ind.shortNameTh}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-bold text-slate-900 tabular-nums">
                                    {val.toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onChangeDimension('V', ind.id)}
                                    className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                                      isProjected
                                        ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white'
                                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <MapIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                    แผนที่
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'districts' && (
              <ProvinceDistrictsTab
                provinceNameTh={provinceTitle}
                periodLabelTh={activePeriodLabelTh}
                districts={provinceDistricts}
                loading={districtsLoading}
                authUser={authUser}
                onOpenOfficerEdit={onOpenOfficerEdit}
              />
            )}

            {activeTab === 'guidance' && (
              <>
                <div>
                  <label
                    htmlFor="guidance-hazard-select"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    เลือกประเภทสาธารณภัยเพื่ออ่านแนวทางปฏิบัติตน:
                  </label>
                  <select
                    id="guidance-hazard-select"
                    value={currentGuidanceHazardId}
                    onChange={(e) => setGuidanceHazardOverride(e.target.value as HazardId)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                  >
                    {sortedHazards.map((h) => {
                      const sc = province.hazards[h.id].score;
                      return (
                        <option key={h.id} value={h.id}>
                          {h.nameTh} ({sc !== null ? `คะแนน ${sc.toFixed(2)}` : 'ไม่เข้าข่าย N/A'})
                        </option>
                      );
                    })}
                  </select>
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    <strong className="text-slate-800">ช่วงเฝ้าระวังหลัก:</strong>{' '}
                    {currentGuidanceDef.peakSeasonTh}
                  </p>
                </div>

                <div className="space-y-2.5">
                  {(
                    [
                      {
                        title: 'ระยะที่ 1: ก่อนเกิดภัย (การเตรียมความพร้อม)',
                        items: currentGuidanceDef.guidance.before,
                        accent: 'border-blue-200 bg-blue-50/50 text-blue-950',
                      },
                      {
                        title: 'ระยะที่ 2: ขณะเกิดภัย (การปฏิบัติตนอย่างปลอดภัย)',
                        items: currentGuidanceDef.guidance.during,
                        accent: 'border-amber-200 bg-amber-50/50 text-amber-950',
                      },
                      {
                        title: 'ระยะที่ 3: หลังเกิดภัย (การตรวจสอบและฟื้นฟู)',
                        items: currentGuidanceDef.guidance.after,
                        accent: 'border-emerald-200 bg-emerald-50/50 text-emerald-950',
                      },
                    ] as const
                  ).map((phase) => (
                    <div key={phase.title} className={`rounded-xl border p-3 ${phase.accent}`}>
                      <h3 className="text-xs font-bold mb-1.5 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {phase.title}
                      </h3>
                      <ol className="list-decimal pl-4 space-y-1 text-xs leading-relaxed">
                        {phase.items.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-xs font-bold text-[#0F294A] mb-2">
                    สายด่วนแจ้งเหตุและหน่วยงานอ้างอิง ({currentGuidanceDef.shortNameTh})
                  </h3>
                  <div className="space-y-1.5">
                    {[...CORE_HOTLINES, ...currentGuidanceDef.hotlines]
                      .filter(
                        (item, idx, arr) => arr.findIndex((x) => x.number === item.number) === idx,
                      )
                      .map((contact) => (
                        <a
                          key={contact.number}
                          href={`tel:${contact.number}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {contact.agency}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">{contact.note}</p>
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0F294A] px-2.5 py-1 text-xs font-bold text-white tabular-nums">
                            <Phone className="h-3 w-3" aria-hidden="true" />
                            {contact.number}
                          </span>
                        </a>
                      ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'governance' && (
              <>
                {/* ผลของศักยภาพพื้นที่ต่อความเสี่ยงสุทธิ */}
                {bd.grossRiskScore !== null && bd.ddpmScore !== null && bd.cImpactDelta !== null && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3">
                    <h3 className="text-xs font-bold text-[#115E59] mb-2">
                      ผลของศักยภาพพื้นที่ต่อความเสี่ยงสุทธิ
                    </h3>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-white p-2 border border-slate-200">
                        <p className="text-[10px] text-slate-500">ก่อนหักศักยภาพ</p>
                        <p className="text-sm font-bold text-slate-800 tabular-nums">
                          {bd.grossRiskScore.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-slate-200">
                        <p className="text-[10px] text-slate-500">ความเสี่ยงสุทธิ</p>
                        <p className="text-sm font-bold text-[#0F294A] tabular-nums">
                          {bd.ddpmScore.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-teal-200">
                        <p className="text-[10px] text-teal-900">ผลต่อความเสี่ยง</p>
                        <p
                          className={`text-sm font-bold tabular-nums ${
                            bd.cImpactDelta <= 0 ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {bd.cImpactDelta > 0 ? '+' : ''}
                          {bd.cImpactDelta.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {benchmarks && selectedEvaluation.score !== null && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-xs font-semibold text-[#0F294A] mb-2">
                      เปรียบเทียบกับค่าเฉลี่ยภาคและประเทศ
                    </h3>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-blue-50 p-2">
                        <p className="text-[11px] text-slate-600">{province.nameTh}</p>
                        <p className="text-base font-bold text-[#0F294A] tabular-nums">
                          {selectedEvaluation.score.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[11px] text-slate-600">
                          เฉลี่ย{REGION6_LABELS[province.region6]}
                        </p>
                        <p className="text-base font-bold text-slate-800 tabular-nums">
                          {benchmarks.regionAvg.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[11px] text-slate-600">เฉลี่ยทั้งประเทศ</p>
                        <p className="text-base font-bold text-slate-800 tabular-nums">
                          {benchmarks.countryAvg.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                  <h3 className="font-semibold text-[#0F294A] flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                    บริบทภูมิศาสตร์และลักษณะพื้นที่
                  </h3>
                  <p className="text-slate-700 leading-relaxed">{province.geographicNoteTh}</p>
                  <p className="text-[11px] text-slate-600 border-t border-slate-200 pt-2">
                    <strong>สถานะชายฝั่งทะเลเปิด:</strong>{' '}
                    {province.coastalZone === 'andaman'
                      ? 'ชายฝั่งทะเลอันดามัน เฝ้าระวังสึนามิและภัยชายฝั่ง ประเมินครบ 10 ประเภทภัย'
                      : province.coastalZone === 'gulf'
                        ? 'ชายฝั่งอ่าวไทย เฝ้าระวังคลื่นพายุซัดฝั่งและการกัดเซาะ ประเมินครบ 10 ประเภทภัย'
                        : 'ไม่มีแนวชายฝั่งทะเลเปิด ไม่เข้าข่ายภัยสึนามิ (N/A) คำนวณค่าน้ำหนักจาก 9 ประเภทภัยที่เกี่ยวข้อง'}
                  </p>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => onOpenReportModal(province.nameTh)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Flag className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                    แจ้งข้อมูลคลาดเคลื่อน ({province.nameTh})
                  </button>
                  <button
                    type="button"
                    onClick={onOpenChangelog}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <FileClock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    ประวัติการปรับปรุงชุดข้อมูล
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
