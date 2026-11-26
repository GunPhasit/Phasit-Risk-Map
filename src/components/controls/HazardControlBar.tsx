import { CalendarClock, ChevronLeft, ChevronRight, HelpCircle, ShieldCheck } from 'lucide-react';
import { HAZARD_CATALOG } from '../../data/hazardCatalog';
import { getSubIndicatorsForPillar } from '../../data/indicatorCatalog';
import {
  MAP_DIMENSION_META,
  MAP_DIMENSIONS_ORDER,
  REGION_FILTER_OPTIONS,
} from '../../data/riskPalette';
import type {
  CompositeMode,
  LayerSelection,
  MapDimension,
  RegionFilterKey,
  ReportingPeriod,
  SubIndicatorId,
} from '../../types/index.ts';
import { HazardIcon } from '../common/RiskBadge';

interface HazardControlBarProps {
  activeDimension: MapDimension;
  onChangeDimension: (dim: MapDimension) => void;
  activeLayer: LayerSelection;
  onChangeLayer: (layer: LayerSelection) => void;
  activeSubIndicator: SubIndicatorId | null;
  onChangeSubIndicator: (subId: SubIndicatorId | null) => void;
  compositeMode: CompositeMode;
  onChangeCompositeMode: (mode: CompositeMode) => void;
  regionFilter: RegionFilterKey;
  onChangeRegionFilter: (region: RegionFilterKey) => void;
  periods: readonly ReportingPeriod[];
  activePeriodId: string;
  onChangePeriod: (periodId: string) => void;
  onOpenMethodology: () => void;
}

const COMPOSITE_MODES: readonly {
  id: CompositeMode;
  labelTh: string;
  shortLabelTh: string;
  hintTh: string;
}[] = [
  {
    id: 'ddpm64',
    labelTh: 'เกณฑ์แผน ปภ. 64-70',
    shortLabelTh: 'เกณฑ์ ปภ.',
    hintTh: 'ประเมินความเสี่ยงสุทธิจากภัยคุกคาม ความล่อแหลม ความเปราะบาง และหักลดด้วยศักยภาพพื้นที่ พร้อมเกณฑ์เฝ้าระวังขั้นต่ำ',
  },
  {
    id: 'eoc',
    labelTh: 'ภัยสูงสุด EOC',
    shortLabelTh: 'ภัยสูงสุด EOC',
    hintTh: 'แสดงระดับภัยคุกคามสูงสุดของจังหวัดโดยไม่หักลดด้วยศักยภาพ เพื่อใช้เฝ้าระวังเชิงป้องกัน',
  },
  {
    id: 'gross',
    labelTh: 'ก่อนหักศักยภาพ',
    shortLabelTh: 'ก่อนหักศักยภาพ',
    hintTh: 'ประเมินความเสี่ยงเบื้องต้นจากภัย ความล่อแหลม และความเปราะบาง เพื่อเทียบผลช่วยลดความเสี่ยงของศักยภาพพื้นที่',
  },
];

export function HazardControlBar({
  activeDimension,
  onChangeDimension,
  activeLayer,
  onChangeLayer,
  activeSubIndicator,
  onChangeSubIndicator,
  compositeMode,
  onChangeCompositeMode,
  regionFilter,
  onChangeRegionFilter,
  periods,
  activePeriodId,
  onChangePeriod,
  onOpenMethodology,
}: HazardControlBarProps) {
  const showHazardRibbon = activeDimension === 'R' || activeDimension === 'H';
  const pillarSubIndicators =
    activeDimension === 'E' || activeDimension === 'V' || activeDimension === 'C'
      ? getSubIndicatorsForPillar(activeDimension)
      : [];
  const activePeriodIdx = periods.findIndex((p) => p.periodId === activePeriodId);
  const canStepPrev = activePeriodIdx > 0;
  const canStepNext = activePeriodIdx >= 0 && activePeriodIdx < periods.length - 1;

  return (
    <section
      aria-label="แถบควบคุมมิติความเสี่ยง ประเภทสาธารณภัย ตัวชี้วัดย่อย ภูมิภาค และงวดข้อมูล"
      className="border-b border-slate-200 bg-white"
    >
      {/* แถวที่ 1: ตัวสลับ 5 มิติ (R / H / E / V / C) + โหมดสูตร (เมื่ออยู่ R) + ตัวกรองภาค */}
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
        {/* 5-Dimension Switcher (กะทัดรัด 1 แถว เลื่อนได้บนมือถือ 390px) */}
        <div
          role="group"
          aria-label="เลือกมิติปัจจัยความเสี่ยงตามแผน ปภ. ชาติ 2564-2570"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
        >
          {MAP_DIMENSIONS_ORDER.map((dim) => {
            const meta = MAP_DIMENSION_META[dim];
            const active = activeDimension === dim;
            const isCap = dim === 'C';
            return (
              <button
                key={dim}
                type="button"
                onClick={() => onChangeDimension(dim)}
                aria-pressed={active}
                title={`${meta.nameTh} (${meta.directionTagTh})`}
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? isCap
                      ? 'border-[#0F766E] bg-[#0F766E] text-white shadow-xs'
                      : 'border-[#0F294A] bg-[#0F294A] text-white shadow-xs'
                    : isCap
                      ? 'border-teal-200 bg-teal-50/70 text-teal-900 hover:bg-teal-100/80'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isCap && <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span>{meta.shortNameTh}</span>
              </button>
            );
          })}
        </div>

        {/* ส่วนขวา: สูตรคำนวณ (เฉพาะมิติ R) + ปุ่มสูตร + ตัวกรองภาค */}
        <div className="flex flex-wrap items-center gap-2">
          {activeDimension === 'R' && (
            <div
              role="group"
              aria-label="เลือกเกณฑ์การคำนวณความเสี่ยงสุทธิ"
              className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200"
            >
              {COMPOSITE_MODES.map((m) => {
                const selected = compositeMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChangeCompositeMode(m.id)}
                    aria-pressed={selected}
                    title={m.hintTh}
                    className={`rounded-md px-2 py-1 text-[11px] sm:text-xs font-medium transition-all ${
                      selected
                        ? 'bg-white text-[#0F294A] shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className="hidden lg:inline">{m.labelTh}</span>
                    <span className="lg:hidden">{m.shortLabelTh}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Dropdown ตัวชี้วัดย่อย (แสดงเฉพาะมิติ E, V, C — ซ่อนเมื่ออยู่ R/H ตาม Gate 13) */}
          {pillarSubIndicators.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="sub-indicator-select"
                className="text-xs font-medium text-slate-600 shrink-0 hidden sm:inline"
              >
                ตัวชี้วัดย่อย:
              </label>
              <select
                id="sub-indicator-select"
                value={activeSubIndicator ?? ''}
                onChange={(e) =>
                  onChangeSubIndicator(
                    e.target.value ? (e.target.value as SubIndicatorId) : null,
                  )
                }
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium max-w-[210px] sm:max-w-[270px] ${
                  activeDimension === 'C'
                    ? 'border-teal-300 bg-teal-50/50 text-teal-950 focus:border-[#0F766E]'
                    : 'border-slate-300 bg-white text-slate-800 focus:border-[#1D4ED8]'
                }`}
              >
                <option value="">
                  ภาพรวมทั้งหมด ({pillarSubIndicators.length} ตัวชี้วัด)
                </option>
                {pillarSubIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.shortNameTh} ({(ind.weight * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={onOpenMethodology}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            <HelpCircle className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
            <span className="hidden sm:inline">ระเบียบวิธีและตัวชี้วัด</span>
            <span className="sm:hidden">ระเบียบวิธี</span>
          </button>

          <div className="flex items-center gap-1">
            <label htmlFor="region-filter-select" className="sr-only">
              กรองตามภูมิภาค
            </label>
            <select
              id="region-filter-select"
              value={regionFilter}
              onChange={(e) => onChangeRegionFilter(e.target.value as RegionFilterKey)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:border-slate-300 focus:border-[#1D4ED8]"
            >
              {REGION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.labelTh}
                </option>
              ))}
            </select>
          </div>

          {/* ตัวเลือกงวดข้อมูล */}
          {periods.length > 0 && (
            <div
              role="group"
              aria-label="เลือกงวดข้อมูล"
              className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50/70 p-0.5 text-xs"
            >
              <button
                type="button"
                disabled={!canStepPrev}
                onClick={() => canStepPrev && onChangePeriod(periods[activePeriodIdx - 1].periodId)}
                aria-label="งวดข้อมูลก่อนหน้า"
                className="rounded p-1 text-[#0F294A] hover:bg-blue-100 disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <CalendarClock className="ml-0.5 h-3.5 w-3.5 text-[#1D4ED8] shrink-0 hidden sm:inline" aria-hidden="true" />
              <label htmlFor="period-switcher-select" className="sr-only">
                เลือกงวดข้อมูล
              </label>
              <select
                id="period-switcher-select"
                value={activePeriodId}
                onChange={(e) => onChangePeriod(e.target.value)}
                className="bg-transparent px-1.5 py-0.5 text-xs font-semibold text-[#0F294A] focus:outline-none tabular-nums max-w-[155px] sm:max-w-[200px]"
              >
                {periods.map((p) => (
                  <option key={p.periodId} value={p.periodId}>
                    {p.labelTh}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canStepNext}
                onClick={() => canStepNext && onChangePeriod(periods[activePeriodIdx + 1].periodId)}
                aria-label="งวดข้อมูลถัดไป"
                className="rounded p-1 text-[#0F294A] hover:bg-blue-100 disabled:opacity-35"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* แถวที่ 2: สลับระหว่างแถบ 10 สาธารณภัย (เมื่ออยู่ R/H) หรือแถบตัวชี้วัดย่อยแบบ 1-Click (เมื่ออยู่ E/V/C) */}
      <nav
        aria-label={
          showHazardRibbon ? 'เลือกประเภทสาธารณภัย' : 'เลือกตัวชี้วัดย่อยบนแผนที่'
        }
        className="mx-auto max-w-[1480px] px-3 py-1.5 sm:px-4"
      >
        {showHazardRibbon ? (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => onChangeLayer('composite')}
              aria-pressed={activeLayer === 'composite'}
              className={`sm:sticky sm:left-0 sm:z-10 inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all sm:shadow-[4px_0_8px_-4px_rgba(15,23,42,0.12)] ${
                activeLayer === 'composite'
                  ? 'border-[#0F294A] bg-[#0F294A] text-white'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <HazardIcon layer="composite" className="h-3.5 w-3.5 shrink-0" />
              <span>ภาพรวม 10 สาธารณภัย</span>
            </button>

            <div className="h-5 w-px shrink-0 bg-slate-200 mx-0.5" aria-hidden="true" />

            {HAZARD_CATALOG.map((hazard) => {
              const active = activeLayer === hazard.id;
              return (
                <button
                  key={hazard.id}
                  type="button"
                  onClick={() => onChangeLayer(hazard.id)}
                  aria-pressed={active}
                  title={`${hazard.nameTh} ค่าน้ำหนัก ${(hazard.weight * 100).toFixed(0)}%`}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <HazardIcon layer={hazard.id} className="h-3.5 w-3.5 shrink-0" />
                  <span>{hazard.shortNameTh}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => onChangeSubIndicator(null)}
              aria-pressed={activeSubIndicator === null}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                activeSubIndicator === null
                  ? activeDimension === 'C'
                    ? 'border-[#0F766E] bg-[#0F766E] text-white'
                    : 'border-[#0F294A] bg-[#0F294A] text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>
                ภาพรวม{MAP_DIMENSION_META[activeDimension].nameTh} ({pillarSubIndicators.length} ตัวชี้วัด)
              </span>
            </button>

            <div className="h-5 w-px shrink-0 bg-slate-200 mx-0.5" aria-hidden="true" />

            {pillarSubIndicators.map((ind) => {
              const active = activeSubIndicator === ind.id;
              return (
                <button
                  key={ind.id}
                  type="button"
                  onClick={() => onChangeSubIndicator(ind.id)}
                  aria-pressed={active}
                  title={`${ind.nameTh} (น้ำหนัก ${(ind.weight * 100).toFixed(0)}%)`}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? activeDimension === 'C'
                        ? 'border-[#0D9488] bg-[#0D9488] text-white shadow-xs'
                        : 'border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <span>{ind.shortNameTh}</span>
                  <span
                    className={`text-[10px] tabular-nums ${
                      active ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    {(ind.weight * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </nav>
    </section>
  );
}
