import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ChevronDown, ChevronUp, Edit3, Search } from 'lucide-react';
import { HAZARD_BY_ID } from '../../data/hazardCatalog.ts';
import { CAPACITY_INDICATORS } from '../../data/indicatorCatalog.ts';
import { CAPACITY_LEVEL_STYLES, RISK_LEVEL_STYLES } from '../../data/riskPalette.ts';
import { DISTRICT_GEO_CLASS_LABELS_TH } from '../../data/variableRubricCatalog.ts';
import { scoreToRiskLevel } from '../../domain/riskCalculator.ts';
import type { AuthUser, DistrictEvaluation } from '../../types/index.ts';
import { RiskBadge } from '../common/RiskBadge.tsx';

interface ProvinceDistrictsTabProps {
  provinceNameTh: string;
  periodLabelTh: string;
  districts: readonly DistrictEvaluation[];
  loading: boolean;
  authUser: AuthUser | null;
  onOpenDistrictEditor: (districtCode: string) => void;
}

export function ProvinceDistrictsTab({
  provinceNameTh,
  periodLabelTh,
  districts,
  loading,
  authUser,
  onOpenDistrictEditor,
}: ProvinceDistrictsTabProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'risk' | 'capacity' | 'name'>('risk');
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? districts.filter(
          (d) =>
            d.district.fullNameTh.toLowerCase().includes(q) ||
            d.district.nameEn.toLowerCase().includes(q) ||
            d.district.code.includes(q),
        )
      : [...districts];

    list.sort((a, b) => {
      if (sortBy === 'risk') {
        if (b.ddpmScore !== a.ddpmScore) return b.ddpmScore - a.ddpmScore;
        return a.district.code.localeCompare(b.district.code);
      }
      if (sortBy === 'capacity') {
        if (b.capacityScore !== a.capacityScore) return b.capacityScore - a.capacityScore;
        return a.district.code.localeCompare(b.district.code);
      }
      return a.district.nameTh.localeCompare(b.district.nameTh, 'th');
    });
    return list;
  }, [districts, search, sortBy]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-slate-500">
        กำลังโหลดข้อมูลรายอำเภอของ{provinceNameTh}...
      </div>
    );
  }

  if (districts.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-600">
        ไม่พบรายการอำเภอในงวด {periodLabelTh}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="ค้นหาชื่ออำเภอหรือรหัส 4 หลัก"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาอำเภอ/เขต หรือรหัส 4 หลัก"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1D4ED8]"
          />
        </div>

        <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs focus-within:ring-2 focus-within:ring-[#1D4ED8]">
          <ArrowDownWideNarrow className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <select
            aria-label="เรียงลำดับรายอำเภอ"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'risk' | 'capacity' | 'name')}
            className="bg-transparent font-medium text-slate-700"
          >
            <option value="risk">เสี่ยงสูงสุด</option>
            <option value="capacity">ศักยภาพสูง</option>
            <option value="name">เรียง ก-ฮ</option>
          </select>
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white overflow-hidden">
        {filtered.map((item) => {
          const isExpanded = expandedCode === item.district.code;
          const isOfficerAssigned =
            authUser?.role === 'district_officer' &&
            authUser.districtCode === item.district.code &&
            authUser.provinceCode === item.district.provinceCode;
          const riskStyle = RISK_LEVEL_STYLES[item.ddpmLevel];
          const delta = item.deltaFromPrevious;

          return (
            <div key={item.district.code} className={isOfficerAssigned ? 'bg-emerald-50/40' : ''}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedCode(isExpanded ? null : item.district.code)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50/80 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: riskStyle.mapFill }}
                      aria-hidden="true"
                    />
                    <span className="text-[13px] font-semibold text-[#0C2340] truncate">
                      {item.district.fullNameTh}
                    </span>
                    {isOfficerAssigned && (
                      <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">
                        พื้นที่รับผิดชอบของท่าน
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                    {DISTRICT_GEO_CLASS_LABELS_TH[item.district.geoClass]} • ภัยเด่น:{' '}
                    {HAZARD_BY_ID[item.dominantHazardId].shortNameTh}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <div className="text-right">
                    <span className="text-sm font-bold text-[#0C2340]">
                      {item.ddpmScore.toFixed(2)}
                    </span>
                    {delta !== null && Math.abs(delta) >= 0.01 && (
                      <p
                        className={`text-xs font-medium ${
                          delta < 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)}
                      </p>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3 space-y-2.5 text-xs">
                  <div className="grid grid-cols-4 gap-1.5 text-center tabular-nums">
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-slate-500">ภัย</p>
                      <p className="font-bold text-[#0C2340]">{item.hazardCompositeScore.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-slate-500">ล่อแหลม</p>
                      <p className="font-bold text-[#0C2340]">{item.exposureScore.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-slate-500">เปราะบาง</p>
                      <p className="font-bold text-[#0C2340]">{item.vulnerabilityScore.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg bg-teal-50 p-2 ring-1 ring-teal-200/70">
                      <p className="text-teal-800">ศักยภาพ</p>
                      <p className="font-bold text-[#115E59]">{item.capacityScore.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {CAPACITY_INDICATORS.map((ind) => {
                      const val = item.metrics.capacityIndicators[ind.id];
                      const st = CAPACITY_LEVEL_STYLES[scoreToRiskLevel(val)];
                      return (
                        <div key={ind.id} className="flex items-center gap-2 text-xs">
                          <span className="w-36 truncate text-slate-600">{ind.shortNameTh}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(val / 5) * 100}%`, backgroundColor: st.mapFill }}
                            />
                          </div>
                          <span className="w-9 text-right font-semibold text-[#115E59] tabular-nums">
                            {val.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <RiskBadge level={item.ddpmLevel} size="sm" compact />
                    <button
                      type="button"
                      onClick={() => onOpenDistrictEditor(item.district.code)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C2340] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#16355B] transition-colors"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>กรอกคะแนนอำเภอนี้</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
