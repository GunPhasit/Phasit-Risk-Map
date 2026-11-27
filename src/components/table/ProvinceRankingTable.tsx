import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Download, GitCompareArrows, MapPin, Search } from 'lucide-react';
import { HAZARD_BY_ID } from '../../data/hazardCatalog.ts';
import { SUB_INDICATOR_BY_ID } from '../../data/indicatorCatalog.ts';
import {
  getPaletteForDimension,
  MAP_DIMENSION_META,
  NA_RISK_STYLE,
  REGION6_LABELS,
  RISK_LEVEL_LIST,
} from '../../data/riskPalette.ts';
import { triggerCsvDownload } from '../../domain/csvExporter.ts';
import type {
  LayerSelection,
  MapDimension,
  ProvinceEvaluation,
  RegionFilterKey,
  RiskLevel,
  SubIndicatorId,
} from '../../types/risk.ts';
import { RiskBadge } from '../common/RiskBadge.tsx';

interface ProvinceRankingTableProps {
  evaluations: readonly ProvinceEvaluation[];
  activeDimension: MapDimension;
  activeLayer: LayerSelection;
  activeSubIndicator: SubIndicatorId | null;
  activePeriodId: string;
  activePeriodLabelTh: string;
  regionFilter: RegionFilterKey;
  compareCodes: readonly string[];
  onSelectProvince: (dopaCode: string) => void;
  onToggleCompare: (dopaCode: string) => void;
}

type SortKey = 'rank' | 'name' | 'score' | 'H' | 'E' | 'V' | 'C';

function useIsDesktopMd(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export function ProvinceRankingTable({
  evaluations,
  activeDimension,
  activeLayer,
  activeSubIndicator,
  activePeriodId,
  activePeriodLabelTh,
  regionFilter,
  compareCodes,
  onSelectProvince,
  onToggleCompare,
}: ProvinceRankingTableProps) {
  const isDesktop = useIsDesktopMd();
  const [tableSearch, setTableSearch] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<RiskLevel[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);

  const palette = getPaletteForDimension(activeDimension);
  const isCapacityMode = activeDimension === 'C';

  const toggleLevel = (lvl: RiskLevel) => {
    setSelectedLevels((prev) =>
      prev.includes(lvl) ? prev.filter((item) => item !== lvl) : [...prev, lvl],
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === 'rank' || key === 'name');
    }
  };

  const ariaSortFor = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  };

  const filteredAndSorted = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const list = evaluations.filter((ev) => {
      const p = ev.province;
      const matchesRegion =
        regionFilter === 'all' ||
        (regionFilter === 'bma6' ? p.isBma6 : p.region6 === regionFilter);
      const matchesLevel =
        selectedLevels.length === 0 || (ev.level !== null && selectedLevels.includes(ev.level));
      const matchesQuery =
        !q ||
        p.nameTh.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.dopaCode.includes(q) ||
        p.shortAliases.some((a) => a.toLowerCase().includes(q));
      return matchesRegion && matchesLevel && matchesQuery;
    });

    return [...list].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortKey) {
        case 'rank':
          return (a.rank - b.rank) * dir;
        case 'name':
          return a.province.nameTh.localeCompare(b.province.nameTh, 'th') * dir;
        case 'score':
          return ((a.score ?? -1) - (b.score ?? -1)) * dir;
        case 'H':
          return (a.breakdown.hazardCompositeScore - b.breakdown.hazardCompositeScore) * dir;
        case 'E':
          return (a.breakdown.exposureScore - b.breakdown.exposureScore) * dir;
        case 'V':
          return (a.breakdown.vulnerabilityScore - b.breakdown.vulnerabilityScore) * dir;
        case 'C':
          return (
            (a.breakdown.effectiveCapacityScore - b.breakdown.effectiveCapacityScore) * dir
          );
      }
    });
  }, [evaluations, regionFilter, selectedLevels, tableSearch, sortKey, sortAsc]);

  const contextLabel = useMemo(() => {
    if (activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]) {
      return `${MAP_DIMENSION_META[activeDimension].shortNameTh}: ${SUB_INDICATOR_BY_ID[activeSubIndicator].shortNameTh}`;
    }
    if (activeDimension === 'R' || activeDimension === 'H') {
      const layerText =
        activeLayer === 'composite' ? 'รวม 10 ภัย' : HAZARD_BY_ID[activeLayer].shortNameTh;
      return `${MAP_DIMENSION_META[activeDimension].shortNameTh} • ${layerText}`;
    }
    return MAP_DIMENSION_META[activeDimension].nameTh;
  }, [activeDimension, activeLayer, activeSubIndicator]);

  return (
    <section
      aria-label="ตารางจัดอันดับ 77 จังหวัด ตามกรอบแผน ปภ. ชาติ พ.ศ. 2564-2570"
      className="gov-card overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/70 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-[#0C2340]">
            ตารางจัดอันดับ 77 จังหวัด ({contextLabel})
          </h2>
          <p className="text-xs text-slate-600 tabular-nums mt-0.5">
            แสดงผล {filteredAndSorted.length} จาก 77 จังหวัด ประจำ{activePeriodLabelTh} พร้อมคะแนนครบทั้ง 4 ปัจจัย
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            triggerCsvDownload(
              filteredAndSorted,
              `thailand-hevc-${activeDimension}-${activeLayer}`,
              activePeriodId,
            )
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C2340] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#16355B] transition-colors"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>ส่งออก CSV (ครบ 13 ตัวชี้วัด)</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-5 py-3">
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="ค้นหาชื่อจังหวัดหรือคำย่อในตาราง..."
            aria-label="กรองชื่อจังหวัดในตาราง"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1D4ED8]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {RISK_LEVEL_LIST.map((lvl) => {
            const st = palette[lvl];
            const active = selectedLevels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? isCapacityMode
                      ? 'border-[#0D9488] bg-[#0D9488] text-white'
                      : 'border-[#0C2340] bg-[#0C2340] text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-slate-900/15"
                  style={{ backgroundColor: st.mapFill }}
                  aria-hidden="true"
                />
                <span className="tabular-nums">ระดับ {lvl}</span>
              </button>
            );
          })}
          {selectedLevels.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedLevels([])}
              className="text-xs font-semibold text-[#1D4ED8] hover:underline px-1.5"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {/* เรนเดอร์เฉพาะชุดที่ตรงกับขนาดหน้าจอ (ลด DOM ลงครึ่งหนึ่ง) */}
      {isDesktop ? (
        <div className="overflow-x-auto max-h-[calc(100vh-260px)] overflow-y-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
              <tr>
                <th aria-sort={ariaSortFor('rank')} className="py-3 pl-5 pr-2 font-semibold w-16">
                  <button
                    type="button"
                    onClick={() => handleSort('rank')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    อันดับ <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th aria-sort={ariaSortFor('name')} className="py-3 px-2 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    จังหวัด <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th className="py-3 px-2 font-semibold">ภูมิภาค</th>
                <th aria-sort={ariaSortFor('score')} className="py-3 px-2 font-semibold text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('score')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    คะแนนมิตินี้ <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th className="py-3 px-2 font-semibold">ระดับ</th>
                <th aria-sort={ariaSortFor('H')} className="py-3 px-2 font-semibold text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('H')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    ภัยคุกคาม <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th aria-sort={ariaSortFor('E')} className="py-3 px-2 font-semibold text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('E')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    ล่อแหลม <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th aria-sort={ariaSortFor('V')} className="py-3 px-2 font-semibold text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('V')}
                    className="inline-flex items-center gap-1 hover:text-[#0C2340]"
                  >
                    เปราะบาง <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th
                  aria-sort={ariaSortFor('C')}
                  className="py-3 px-2 font-semibold text-right text-[#0D9488]"
                >
                  <button
                    type="button"
                    onClick={() => handleSort('C')}
                    className="inline-flex items-center gap-1 hover:text-[#115E59]"
                  >
                    ศักยภาพ <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th className="py-3 pl-2 pr-5 font-semibold text-center">เปรียบเทียบ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSorted.map((ev) => {
                const barColor =
                  ev.level !== null ? palette[ev.level].mapFill : NA_RISK_STYLE.mapFill;
                const isCompared = compareCodes.includes(ev.province.dopaCode);
                const compareFull = compareCodes.length >= 3 && !isCompared;
                return (
                  <tr key={ev.province.dopaCode} className="hover:bg-slate-50/90 transition-colors">
                    <td className="py-3 pl-5 pr-2 font-bold text-slate-500 tabular-nums">
                      {ev.rank}
                    </td>
                    <td className="py-3 px-2">
                      <button
                        type="button"
                        onClick={() => onSelectProvince(ev.province.dopaCode)}
                        className="flex items-center gap-2.5 text-left font-semibold text-[#0C2340] hover:text-[#1D4ED8] hover:underline"
                      >
                        <span
                          className="h-5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: barColor }}
                          aria-hidden="true"
                        />
                        <span>{ev.province.nameTh}</span>
                        {ev.breakdown.isSimulated && (
                          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-xs font-semibold text-teal-900">
                            จำลอง
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-2 text-xs text-slate-600">
                      {REGION6_LABELS[ev.province.region6]}
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      <div className="inline-flex items-center gap-2">
                        <div className="hidden lg:block w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          {ev.score !== null && (
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(ev.score / 5) * 100}%`,
                                backgroundColor: barColor,
                              }}
                            />
                          )}
                        </div>
                        <span className="font-bold text-slate-900">
                          {ev.score !== null ? ev.score.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <RiskBadge
                        level={ev.level}
                        dimension={activeDimension}
                        variant="tinted"
                        size="sm"
                        compact
                      />
                    </td>
                    <td className="py-3 px-2 text-right text-slate-700 tabular-nums">
                      {ev.breakdown.hazardCompositeScore.toFixed(2)}
                    </td>
                    <td className="py-3 px-2 text-right text-slate-700 tabular-nums">
                      {ev.breakdown.exposureScore.toFixed(2)}
                    </td>
                    <td className="py-3 px-2 text-right text-slate-700 tabular-nums">
                      {ev.breakdown.vulnerabilityScore.toFixed(2)}
                    </td>
                    <td className="py-3 px-2 text-right font-bold text-[#0D9488] tabular-nums">
                      {ev.breakdown.effectiveCapacityScore.toFixed(2)}
                    </td>
                    <td className="py-3 pl-2 pr-5 text-center">
                      <button
                        type="button"
                        disabled={compareFull}
                        onClick={() => onToggleCompare(ev.province.dopaCode)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isCompared
                            ? 'border-violet-600 bg-violet-600 text-white'
                            : compareFull
                              ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{isCompared ? 'เลือกแล้ว' : 'เทียบ'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredAndSorted.map((ev) => {
            const barColor =
              ev.level !== null ? palette[ev.level].mapFill : NA_RISK_STYLE.mapFill;
            const isCompared = compareCodes.includes(ev.province.dopaCode);
            return (
              <div key={ev.province.dopaCode} className="flex items-center justify-between gap-3 p-3.5">
                <button
                  type="button"
                  onClick={() => onSelectProvince(ev.province.dopaCode)}
                  className="flex items-start gap-2.5 text-left min-w-0 flex-1"
                >
                  <span
                    className="mt-0.5 h-11 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: barColor }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-500 tabular-nums">#{ev.rank}</span>
                      <span className="truncate text-sm font-semibold text-[#0C2340]">
                        {ev.province.nameTh}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{REGION6_LABELS[ev.province.region6]}</span>
                      <span>•</span>
                      <span>ภัย {ev.breakdown.hazardCompositeScore.toFixed(1)}</span>
                      <span className="text-[#0D9488] font-semibold">
                        ศักยภาพ {ev.breakdown.effectiveCapacityScore.toFixed(1)}
                      </span>
                    </p>
                  </div>
                </button>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {ev.score !== null ? ev.score.toFixed(2) : 'N/A'}
                    </span>
                    <RiskBadge
                      level={ev.level}
                      dimension={activeDimension}
                      variant="tinted"
                      size="sm"
                      compact
                    />
                  </div>
                  <button
                    type="button"
                    disabled={compareCodes.length >= 3 && !isCompared}
                    onClick={() => onToggleCompare(ev.province.dopaCode)}
                    className={`min-h-[36px] px-2 rounded-md text-xs font-semibold ${
                      isCompared ? 'bg-violet-50 text-violet-700' : 'text-[#1D4ED8]'
                    }`}
                  >
                    {isCompared ? 'เลือกเทียบแล้ว' : '+ เปรียบเทียบ'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
