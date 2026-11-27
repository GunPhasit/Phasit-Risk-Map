import { useMemo } from 'react';
import { ArrowRight, ShieldCheck, SlidersHorizontal, Table2 } from 'lucide-react';
import {
  CAPACITY_LEVEL_STYLES,
  getPaletteForDimension,
  REGION6_LABELS,
  REGION_FILTER_OPTIONS,
  RISK_LEVEL_LIST,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette.ts';
import { scoreToRiskLevel } from '../../domain/riskCalculator.ts';
import type {
  MapDimension,
  ProvinceEvaluation,
  RegionFilterKey,
  RiskLevel,
} from '../../types/index.ts';

interface NationalBriefStripProps {
  evaluations: readonly ProvinceEvaluation[];
  activeDimension: MapDimension;
  activePeriodLabelTh: string;
  regionFilter: RegionFilterKey;
  levelFilter: RiskLevel | null;
  onChangeRegionFilter: (region: RegionFilterKey) => void;
  onChangeLevelFilter: (level: RiskLevel | null) => void;
  onSelectProvince: (dopaCode: string) => void;
  onOpenFullTable: () => void;
  onOpenDistrictWorkspace: () => void;
}

export function NationalBriefStrip({
  evaluations,
  activeDimension,
  activePeriodLabelTh,
  regionFilter,
  levelFilter,
  onChangeRegionFilter,
  onChangeLevelFilter,
  onSelectProvince,
  onOpenFullTable,
  onOpenDistrictWorkspace,
}: NationalBriefStripProps) {
  const palette = getPaletteForDimension(activeDimension);
  const isCapacityMode = activeDimension === 'C';

  const stats = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalValid = 0;
    for (const ev of evaluations) {
      if (ev.level !== null) {
        counts[ev.level] += 1;
        totalValid += 1;
      }
    }

    const topRisk = [...evaluations]
      .filter((ev) => ev.score !== null)
      .sort((a, b) => (b.ddpmScore ?? 0) - (a.ddpmScore ?? 0))
      .slice(0, 5);

    const topCapacity = [...evaluations]
      .sort((a, b) => b.breakdown.effectiveCapacityScore - a.breakdown.effectiveCapacityScore)
      .slice(0, 5);

    return { counts, totalValid: Math.max(1, totalValid), topRisk, topCapacity };
  }, [evaluations]);

  return (
    <section
      aria-label="สรุปภาพรวม 77 จังหวัดแบบกระชับ"
      className="gov-card px-5 py-4 space-y-4"
    >
      {/* แถวหัวเรื่อง + ปุ่มเปิดตารางครบ 77 จังหวัด / กรอกคะแนน 928 อำเภอ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#0C2340]">
            สรุปภาพรวม 77 จังหวัด ({activePeriodLabelTh})
          </h2>
          <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
            เลือกดูรายจังหวัดจากรายการด้านล่าง หรือเปิดตาราง 77 จังหวัดเพื่อจัดลำดับและส่งออกไฟล์ CSV
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenDistrictWorkspace}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50/80 px-3.5 py-2 text-xs font-semibold text-[#115E59] hover:bg-teal-100/80 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>กรอกคะแนน 928 อำเภอ</span>
          </button>
          <button
            type="button"
            onClick={onOpenFullTable}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C2340] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#16355B] transition-colors"
          >
            <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>เปิดตารางครบ 77 จังหวัด</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* แถบสัดส่วน 5 ระดับ + ชิปกรองภูมิภาค */}
      <div className="space-y-2.5">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label="สัดส่วนจำนวนจังหวัดแยกตาม 5 ระดับคะแนน"
        >
          {RISK_LEVEL_LIST.map((lvl) => {
            const cnt = stats.counts[lvl];
            if (cnt === 0) return null;
            const pct = (cnt / stats.totalValid) * 100;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => onChangeLevelFilter(levelFilter === lvl ? null : lvl)}
                title={`ระดับ ${lvl} (${palette[lvl].shortLabelTh}): ${cnt} จังหวัด`}
                style={{ width: `${pct}%`, backgroundColor: palette[lvl].mapFill }}
                className="h-full transition-opacity hover:opacity-85"
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
            {RISK_LEVEL_LIST.map((lvl) => {
              const st = palette[lvl];
              const active = levelFilter === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onChangeLevelFilter(active ? null : lvl)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                    active
                      ? 'bg-[#0C2340] text-white font-semibold'
                      : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-100'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-slate-900/15"
                    style={{ backgroundColor: st.mapFill }}
                    aria-hidden="true"
                  />
                  <span>{st.shortLabelTh}</span>
                  <span className="font-bold">{stats.counts[lvl]}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {REGION_FILTER_OPTIONS.map((opt) => {
              const active = regionFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChangeRegionFilter(opt.key)}
                  aria-pressed={active}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? isCapacityMode
                        ? 'bg-[#0D9488] text-white'
                        : 'bg-[#0C2340] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {opt.labelTh.replace('ทุกภูมิภาค (77 จังหวัด)', 'ทุกภาค')}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* สรุป 2 คอลัมน์กะทัดรัด: 5 จังหวัดเฝ้าระวังสูงสุด และ 5 จังหวัดศักยภาพต้นแบบ */}
      <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3.5 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            5 จังหวัดความเสี่ยงสุทธิสูงสุด
          </h3>
          <ul className="divide-y divide-slate-100">
            {stats.topRisk.map((ev, idx) => {
              const lvl = scoreToRiskLevel(ev.ddpmScore);
              const st = RISK_LEVEL_STYLES[lvl];
              return (
                <li key={ev.province.dopaCode}>
                  <button
                    type="button"
                    onClick={() => onSelectProvince(ev.province.dopaCode)}
                    className="flex w-full items-center justify-between gap-2 py-2 px-2 -mx-2 rounded-lg text-left hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 text-xs font-bold text-slate-400 tabular-nums">
                        {idx + 1}
                      </span>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: st.mapFill }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[13px] font-semibold text-[#0C2340]">
                        {ev.province.nameTh}
                      </span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {REGION6_LABELS[ev.province.region6]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="text-[13px] font-bold text-slate-900">
                        {ev.ddpmScore.toFixed(2)}
                      </span>
                      <span
                        className="rounded-md px-1.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: st.tintBg, color: st.tintText }}
                      >
                        ระดับ {lvl}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="md:border-l md:border-slate-100 md:pl-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#0D9488] mb-2">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>5 จังหวัดศักยภาพความพร้อมสูงสุด</span>
          </h3>
          <ul className="divide-y divide-slate-100">
            {stats.topCapacity.map((ev, idx) => {
              const capScore = ev.breakdown.effectiveCapacityScore;
              const lvl = scoreToRiskLevel(capScore);
              const st = CAPACITY_LEVEL_STYLES[lvl];
              return (
                <li key={ev.province.dopaCode}>
                  <button
                    type="button"
                    onClick={() => onSelectProvince(ev.province.dopaCode)}
                    className="flex w-full items-center justify-between gap-2 py-2 px-2 -mx-2 rounded-lg text-left hover:bg-teal-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 text-xs font-bold text-slate-400 tabular-nums">
                        {idx + 1}
                      </span>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: st.mapFill }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[13px] font-semibold text-[#0C2340]">
                        {ev.province.nameTh}
                      </span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {REGION6_LABELS[ev.province.region6]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="text-[13px] font-bold text-[#115E59]">
                        {capScore.toFixed(2)}
                      </span>
                      <span
                        className="rounded-md px-1.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: st.tintBg, color: st.tintText }}
                      >
                        ระดับ {lvl}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
