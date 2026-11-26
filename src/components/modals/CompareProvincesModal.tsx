import { useEffect } from 'react';
import { Download, GitCompareArrows, Trash2, X } from 'lucide-react';
import { HAZARD_CATALOG } from '../../data/hazardCatalog';
import { CAPACITY_INDICATORS } from '../../data/indicatorCatalog';
import {
  CAPACITY_LEVEL_STYLES,
  REGION6_LABELS,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette';
import { triggerCsvDownload } from '../../domain/csvExporter';
import { scoreToRiskLevel } from '../../domain/riskCalculator';
import type { ProvinceEvaluation } from '../../types/risk';
import { RiskBadge } from '../common/RiskBadge';

interface CompareTrayProps {
  comparedEvaluations: readonly ProvinceEvaluation[];
  onRemove: (dopaCode: string) => void;
  onClearAll: () => void;
  onOpenModal: () => void;
}

export function CompareTray({
  comparedEvaluations,
  onRemove,
  onClearAll,
  onOpenModal,
}: CompareTrayProps) {
  if (comparedEvaluations.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="ถาดเปรียบเทียบจังหวัด"
      className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-24px)] max-w-2xl -translate-x-1/2 rounded-2xl border border-slate-300 bg-[#0F294A] p-3 text-white shadow-2xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 mr-1 tabular-nums">
            <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
            เปรียบเทียบ ({comparedEvaluations.length}/3):
          </span>
          {comparedEvaluations.map((ev) => (
            <span
              key={ev.province.dopaCode}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium"
            >
              <span>{ev.province.nameTh}</span>
              <button
                type="button"
                onClick={() => onRemove(ev.province.dopaCode)}
                aria-label={`นำ${ev.province.nameTh}ออกจากการเปรียบเทียบ`}
                className="rounded-full p-0.5 hover:bg-white/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            ล้างทั้งหมด
          </button>
          <button
            type="button"
            onClick={onOpenModal}
            className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 transition-colors"
          >
            เปิดตารางเปรียบเทียบ
          </button>
        </div>
      </div>
    </div>
  );
}

interface CompareProvincesModalProps {
  open: boolean;
  comparedEvaluations: readonly ProvinceEvaluation[];
  onClose: () => void;
  onRemove: (dopaCode: string) => void;
}

export function CompareProvincesModal({
  open,
  comparedEvaluations,
  onClose,
  onRemove,
}: CompareProvincesModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || comparedEvaluations.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F294A] px-5 py-3.5 text-white">
          <div>
            <h2 id="compare-modal-title" className="text-base font-bold">
              ตารางเปรียบเทียบจังหวัดตามแผน ปภ. ชาติ 2564-2570 (สูงสุด 3 จังหวัด)
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              เปรียบเทียบ R สุทธิ, ปัจจัย H · E · V · C, 5 ตัวชี้วัดศักยภาพ และ 10 สาธารณภัย
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => triggerCsvDownload(comparedEvaluations, 'thailand-hevc-compare')}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">ส่งออก CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่างเปรียบเทียบจังหวัด"
              className="rounded-lg p-1.5 text-slate-200 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="py-2.5 px-3 font-semibold text-slate-700 min-w-[175px]">รายการประเมิน</th>
                {comparedEvaluations.map((ev) => (
                  <th key={ev.province.dopaCode} className="py-2.5 px-3 min-w-[170px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-[#0F294A]">{ev.province.nameTh}</p>
                        <p className="text-[11px] font-normal text-slate-500">
                          {REGION6_LABELS[ev.province.region6]} • #{ev.rank}/77
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(ev.province.dopaCode)}
                        aria-label={`นำ${ev.province.nameTh}ออก`}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-blue-50/40">
                <td className="py-2.5 px-3 font-bold text-[#0F294A]">ความเสี่ยงสุทธิ R (ปภ. 64-70)</td>
                {comparedEvaluations.map((ev) => (
                  <td key={ev.province.dopaCode} className="py-2.5 px-3 tabular-nums">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{ev.ddpmScore.toFixed(2)}</span>
                      <RiskBadge level={ev.ddpmLevel} variant="solid" size="sm" compact />
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 px-3 font-medium text-slate-700">ภัยคุกคามรวม (H)</td>
                {comparedEvaluations.map((ev) => (
                  <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums font-semibold text-slate-800">
                    {ev.breakdown.hazardCompositeScore.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 px-3 font-medium text-slate-700">ความล่อแหลม (E)</td>
                {comparedEvaluations.map((ev) => (
                  <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums font-semibold text-slate-800">
                    {ev.breakdown.exposureScore.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 px-3 font-medium text-slate-700">ความเปราะบาง (V)</td>
                {comparedEvaluations.map((ev) => (
                  <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums font-semibold text-slate-800">
                    {ev.breakdown.vulnerabilityScore.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr className="bg-teal-50/50">
                <td className="py-2 px-3 font-bold text-[#115E59]">ศักยภาพ (C — ลดความเสี่ยง)</td>
                {comparedEvaluations.map((ev) => (
                  <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#115E59]">
                        {ev.breakdown.effectiveCapacityScore.toFixed(2)}
                      </span>
                      <RiskBadge
                        level={scoreToRiskLevel(ev.breakdown.effectiveCapacityScore)}
                        dimension="C"
                        variant="tinted"
                        size="sm"
                        compact
                      />
                    </div>
                  </td>
                ))}
              </tr>

              {/* 5 ตัวชี้วัดย่อยศักยภาพ C */}
              <tr className="bg-teal-100/50">
                <td colSpan={comparedEvaluations.length + 1} className="py-1.5 px-3 text-xs font-bold text-[#115E59]">
                  ตัวชี้วัดย่อยด้านศักยภาพ (C • 5 รายการ)
                </td>
              </tr>
              {CAPACITY_INDICATORS.map((ind) => (
                <tr key={ind.id}>
                  <td className="py-2 px-3 text-xs font-medium text-slate-800">{ind.shortNameTh}</td>
                  {comparedEvaluations.map((ev) => {
                    const val = ev.breakdown.effectiveCapacityIndicators[ind.id];
                    const st = CAPACITY_LEVEL_STYLES[scoreToRiskLevel(val)];
                    return (
                      <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-[#115E59]">{val.toFixed(2)}</span>
                          <span className="text-[10px] font-semibold" style={{ color: st.tintText }}>
                            {st.symbol} {st.shortLabelTh}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* 10 สาธารณภัย */}
              <tr className="bg-slate-100/80">
                <td colSpan={comparedEvaluations.length + 1} className="py-1.5 px-3 text-xs font-bold text-slate-600">
                  คะแนนภัยคุกคามรายภัย (H • 10 สาธารณภัย)
                </td>
              </tr>
              {HAZARD_CATALOG.map((h) => (
                <tr key={h.id}>
                  <td className="py-2 px-3 text-xs font-medium text-slate-800">{h.nameTh}</td>
                  {comparedEvaluations.map((ev) => {
                    const entry = ev.province.hazards[h.id];
                    const isNa = !entry.applicable || entry.score === null;
                    const lvl = isNa ? null : scoreToRiskLevel(entry.score!);
                    const st = lvl !== null ? RISK_LEVEL_STYLES[lvl] : null;
                    return (
                      <td key={ev.province.dopaCode} className="py-2 px-3 tabular-nums">
                        {isNa ? (
                          <span className="text-xs text-slate-400">ไม่เข้าข่าย (N/A)</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-900">{entry.score!.toFixed(2)}</span>
                              <span className="font-semibold" style={{ color: st!.tintText }}>
                                {st!.symbol} ระดับ {lvl}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(entry.score! / 5) * 100}%`,
                                  backgroundColor: st!.mapFill,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
