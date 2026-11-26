import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ChevronDown, ChevronUp, Edit3, Lock, Search } from 'lucide-react';
import { HAZARD_BY_ID } from '../../data/hazardCatalog.ts';
import { CAPACITY_INDICATORS } from '../../data/indicatorCatalog.ts';
import { CAPACITY_LEVEL_STYLES, RISK_LEVEL_STYLES } from '../../data/riskPalette.ts';
import { scoreToRiskLevel } from '../../domain/riskCalculator.ts';
import type { AuthUser, DistrictEvaluation } from '../../types/index.ts';
import { RiskBadge } from '../common/RiskBadge.tsx';

interface ProvinceDistrictsTabProps {
  provinceNameTh: string;
  periodLabelTh: string;
  districts: readonly DistrictEvaluation[];
  loading: boolean;
  authUser: AuthUser | null;
  onOpenOfficerEdit: (districtCode: string) => void;
}

const GEO_CLASS_LABELS: Record<DistrictEvaluation['district']['geoClass'], string> = {
  metro: 'เขตเมืองหลัก',
  coastal: 'พื้นที่ชายฝั่ง',
  mountain: 'พื้นที่ภูเขา/ลาดชัน',
  river_basin: 'พื้นที่ลุ่มน้ำ',
  rural: 'พื้นที่เกษตรกรรม',
};

export function ProvinceDistrictsTab({
  provinceNameTh,
  periodLabelTh,
  districts,
  loading,
  authUser,
  onOpenOfficerEdit,
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
        กำลังดึงข้อมูลรายอำเภอของ{provinceNameTh}...
      </div>
    );
  }

  if (districts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-600">
        ยังไม่มีข้อมูลรายอำเภอในขณะนี้ ระบบกำลังแสดงข้อมูลภาพรวมระดับจังหวัด
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-700 leading-relaxed">
        ข้อมูลครบทั้ง {districts.length} อำเภอ/เขต ประจำ<strong>{periodLabelTh}</strong>{' '}
        โดยคะแนนระดับจังหวัดคำนวณรวมจากข้อมูลรายอำเภอ
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่ออำเภอ/เขต หรือรหัส 4 หลัก"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 focus:border-[#1D4ED8]"
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]">
          <ArrowDownWideNarrow className="h-3 w-3 text-slate-400" aria-hidden="true" />
          <select
            aria-label="เรียงลำดับรายอำเภอ"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'risk' | 'capacity' | 'name')}
            className="bg-transparent font-medium text-slate-700 focus:outline-none"
          >
            <option value="risk">เสี่ยงสูงสุด</option>
            <option value="capacity">ศักยภาพสูงสุด</option>
            <option value="name">เรียง ก-ฮ</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        {filtered.map((item) => {
          const isExpanded = expandedCode === item.district.code;
          const canEditThisDistrict =
            authUser?.role === 'district_officer' &&
            authUser.districtCode === item.district.code &&
            authUser.provinceCode === item.district.provinceCode;
          const isOtherOfficerLocked =
            authUser?.role === 'district_officer' && !canEditThisDistrict;
          const riskStyle = RISK_LEVEL_STYLES[item.ddpmLevel];
          const delta = item.deltaFromPrevious;

          return (
            <div
              key={item.district.code}
              className={`rounded-xl border transition-colors ${
                canEditThisDistrict
                  ? 'border-emerald-300 bg-emerald-50/35'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedCode(isExpanded ? null : item.district.code)
                }
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50/70 rounded-xl"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-[#0F294A] truncate">
                      {item.district.fullNameTh}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 tabular-nums">
                      {item.district.code}
                    </span>
                    {canEditThisDistrict && (
                      <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        เขตพื้นที่รับผิดชอบของท่าน
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                    {GEO_CLASS_LABELS[item.district.geoClass]} | ภัยเด่น:{' '}
                    {HAZARD_BY_ID[item.dominantHazardId].shortNameTh} | ศักยภาพ{' '}
                    {item.capacityScore.toFixed(2)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right tabular-nums">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-sm font-bold text-[#0F294A]">
                        {item.ddpmScore.toFixed(2)}
                      </span>
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold"
                        style={{
                          backgroundColor: riskStyle.badgeBg,
                          color: riskStyle.badgeText,
                        }}
                      >
                        {riskStyle.symbol}
                      </span>
                    </div>
                    {delta !== null && Math.abs(delta) >= 0.01 && (
                      <p
                        className={`text-[10px] font-semibold ${
                          delta < 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)} จากงวดก่อน
                      </p>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 px-3 py-2.5 space-y-2.5 text-xs">
                  <div className="grid grid-cols-4 gap-1.5 text-center tabular-nums">
                    <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
                      <p className="text-[10px] text-slate-500">ภัยคุกคาม</p>
                      <p className="font-bold text-[#0F294A]">
                        {item.hazardCompositeScore.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
                      <p className="text-[10px] text-slate-500">ล่อแหลม</p>
                      <p className="font-bold text-[#0F294A]">{item.exposureScore.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
                      <p className="text-[10px] text-slate-500">เปราะบาง</p>
                      <p className="font-bold text-[#0F294A]">
                        {item.vulnerabilityScore.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-teal-50 p-1.5 border border-teal-100">
                      <p className="text-[10px] text-teal-800">ศักยภาพ</p>
                      <p className="font-bold text-[#115E59]">{item.capacityScore.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-[#115E59]">
                      ตัวชี้วัดศักยภาพรายอำเภอ (5 ด้าน)
                    </p>
                    {CAPACITY_INDICATORS.map((ind) => {
                      const val = item.metrics.capacityIndicators[ind.id];
                      const st = CAPACITY_LEVEL_STYLES[scoreToRiskLevel(val)];
                      return (
                        <div key={ind.id} className="flex items-center gap-2 text-[11px]">
                          <span className="w-36 truncate text-slate-600">{ind.shortNameTh}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(val / 5) * 100}%`,
                                backgroundColor: st.mapFill,
                              }}
                            />
                          </div>
                          <span className="w-8 text-right font-semibold text-[#115E59] tabular-nums">
                            {val.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-500 tabular-nums">
                    <span>
                      ปรับปรุงครั้งที่ {item.version} | โดย {item.updatedBy}
                    </span>
                    <RiskBadge level={item.ddpmLevel} size="sm" compact />
                  </div>

                  {canEditThisDistrict && (
                    <button
                      type="button"
                      onClick={() => onOpenOfficerEdit(item.district.code)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0F294A] py-1.5 text-xs font-semibold text-white hover:bg-[#163A66]"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      แก้ไขข้อมูล{item.district.fullNameTh}
                    </button>
                  )}

                  {isOtherOfficerLocked && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-600">
                      <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      อ่านอย่างเดียว (บัญชีของท่านมีสิทธิ์แก้ไขเฉพาะ{authUser.districtNameTh}เท่านั้น)
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
