import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Database,
  Lock,
  Map as MapIcon,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  X,
} from 'lucide-react';
import { getPaletteForDimension, NA_RISK_STYLE, REGION6_LABELS } from '../../data/riskPalette.ts';
import { THAILAND_DISTRICTS_CATALOG } from '../../data/thailandDistrictsCatalog.ts';
import { PROVINCE_BY_CODE } from '../../data/provincesRiskData.ts';
import type {
  AuthUser,
  MapDimension,
  ProvinceEvaluation,
  StorageMode,
} from '../../types/index.ts';

export type MainView = 'map' | 'table' | 'districts';

interface GovHeaderProps {
  evaluations: readonly ProvinceEvaluation[];
  activeDimension: MapDimension;
  activeView: MainView;
  authUser: AuthUser | null;
  dbConnected: boolean;
  storageMode: StorageMode | null;
  sandboxEditCount: number;
  onChangeView: (view: MainView) => void;
  onSelectProvince: (dopaCode: string) => void;
  onSelectDistrictFromSearch: (provinceCode: string, districtCode: string) => void;
  onOpenOfficerPortal: () => void;
}

const DISTRICT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '9011': ['หาดใหญ่', 'hat yai'],
  '2004': ['พัทยา', 'บางละมุง', 'pattaya'],
  '5709': ['แม่สาย', 'mae sai'],
  '6306': ['แม่สอด', 'mae sot'],
  '7707': ['หัวหิน', 'hua hin'],
  '8404': ['เกาะสมุย', 'สมุย', 'samui'],
  '8302': ['ป่าตอง', 'กะทู้', 'patong'],
  '1030': ['จตุจักร', 'หมอชิต'],
  '5001': ['ตัวเมืองเชียงใหม่', 'เมืองชม'],
};

function normalizeThaiQuery(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^(จังหวัด|จ\.|อำเภอ|อ\.|เขต|ข\.)\s*/g, '')
    .replace(/\s+/g, '');
}

type SearchResultItem =
  | {
      kind: 'province';
      id: string;
      code: string;
      label: string;
      sublabel: string;
      scoreText: string;
      dotColor: string;
    }
  | {
      kind: 'district';
      id: string;
      provinceCode: string;
      districtCode: string;
      label: string;
      sublabel: string;
    };

export function GovHeader({
  evaluations,
  activeDimension,
  activeView,
  authUser,
  dbConnected,
  storageMode,
  sandboxEditCount,
  onChangeView,
  onSelectProvince,
  onSelectDistrictFromSearch,
  onOpenOfficerPortal,
}: GovHeaderProps) {
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const palette = getPaletteForDimension(activeDimension);

  const searchGroups = useMemo(() => {
    const raw = query.trim().toLowerCase();
    const norm = normalizeThaiQuery(query);
    if (!raw) return { provinces: [] as SearchResultItem[], districts: [] as SearchResultItem[], flat: [] as SearchResultItem[] };

    const matchedProvinces: SearchResultItem[] = evaluations
      .filter((ev) => {
        const p = ev.province;
        return (
          p.nameTh.toLowerCase().includes(raw) ||
          normalizeThaiQuery(p.nameTh).includes(norm) ||
          p.nameEn.toLowerCase().includes(raw) ||
          p.dopaCode.includes(raw) ||
          p.isoCode.toLowerCase().includes(raw) ||
          p.shortAliases.some((a) => a.toLowerCase().includes(raw))
        );
      })
      .slice(0, 4)
      .map((ev) => ({
        kind: 'province' as const,
        id: `prov-${ev.province.dopaCode}`,
        code: ev.province.dopaCode,
        label: ev.province.dopaCode === '10' ? ev.province.nameTh : `จังหวัด${ev.province.nameTh}`,
        sublabel: REGION6_LABELS[ev.province.region6],
        scoreText: ev.score !== null ? ev.score.toFixed(2) : 'N/A',
        dotColor: ev.level !== null ? palette[ev.level].mapFill : NA_RISK_STYLE.mapFill,
      }));

    const matchedDistricts: SearchResultItem[] = THAILAND_DISTRICTS_CATALOG.filter((d) => {
      const prov = PROVINCE_BY_CODE[d.provinceCode];
      const aliases = DISTRICT_ALIASES[d.code] ?? [];
      return (
        d.fullNameTh.toLowerCase().includes(raw) ||
        d.nameTh.toLowerCase().includes(raw) ||
        normalizeThaiQuery(d.nameTh).includes(norm) ||
        d.nameEn.toLowerCase().includes(raw) ||
        d.code.includes(raw) ||
        aliases.some((a) => a.includes(raw) || a.includes(norm)) ||
        (prov && `${d.nameTh}${prov.nameTh}`.toLowerCase().includes(norm))
      );
    })
      .slice(0, 8)
      .map((d) => {
        const prov = PROVINCE_BY_CODE[d.provinceCode];
        const provLabel = prov ? (prov.dopaCode === '10' ? prov.nameTh : `จ.${prov.nameTh}`) : '';
        return {
          kind: 'district' as const,
          id: `dist-${d.code}`,
          provinceCode: d.provinceCode,
          districtCode: d.code,
          label: d.fullNameTh,
          sublabel: `${provLabel} • รหัส ${d.code}`,
        };
      });

    return {
      provinces: matchedProvinces,
      districts: matchedDistricts,
      flat: [...matchedProvinces, ...matchedDistricts],
    };
  }, [evaluations, query, palette]);

  const handleSelectResult = (item: SearchResultItem) => {
    setQuery('');
    setDropdownOpen(false);
    setActiveIndex(-1);
    if (item.kind === 'province') {
      onSelectProvince(item.code);
      if (activeView !== 'map') onChangeView('map');
    } else {
      onSelectDistrictFromSearch(item.provinceCode, item.districtCode);
    }
  };

  const storagePill = useMemo(() => {
    if (!dbConnected) {
      return {
        label: 'ค่าฐานจำลองในเครื่อง',
        tone: 'text-slate-300 bg-white/10',
        title: 'เชื่อมต่อเซิร์ฟเวอร์ฐานข้อมูลไม่ได้ ระบบแสดงชุดค่าฐานจำลอง 77 จังหวัด 928 อำเภอในเครื่อง',
      };
    }
    if (storageMode === 'netlify-blobs-sqlite' || storageMode === 'local-sqlite') {
      return {
        label: 'ฐานข้อมูลถาวร 928 อำเภอ',
        tone: 'text-emerald-200 bg-emerald-500/15 ring-1 ring-emerald-400/30',
        title:
          storageMode === 'netlify-blobs-sqlite'
            ? 'เชื่อมต่อฐานข้อมูล SQLite พร้อมบันทึกถาวรผ่าน Netlify Blobs'
            : 'เชื่อมต่อฐานข้อมูล SQLite บนเซิร์ฟเวอร์ในเครื่อง',
      };
    }
    return {
      label: 'ฐานข้อมูลสาธิตชั่วคราว',
      tone: 'text-amber-200 bg-amber-500/15 ring-1 ring-amber-400/30',
      title: 'ฐานข้อมูลทำงานในพื้นที่ชั่วคราวของเซิร์ฟเวอร์คลาวด์ ข้อมูลอาจเริ่มใหม่เมื่อระบบพักการทำงาน',
    };
  }, [dbConnected, storageMode]);

  return (
    <header className="sticky top-0 z-40 shadow-sm">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
      >
        ข้ามไปยังเนื้อหาหลักและแผนที่ความเสี่ยง
      </a>

      {/* แถบประกาศชี้แจงความโปร่งใสผสานสีกรมท่า (24px กระชับไม่แย่งสายตา) */}
      <div
        role="note"
        aria-label="ประกาศชี้แจงสถานะข้อมูลจำลองและฐานข้อมูล"
        className="bg-[#07172B] border-b border-white/10 text-slate-200"
      >
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-3 py-1 text-xs sm:px-4">
          <p className={`${bannerExpanded ? '' : 'truncate'} min-w-0 leading-snug text-slate-300`}>
            <span className="font-medium text-white">ค่าฐานจำลองเชิงสถิติ แผน ปภ. ชาติ 2564-2570</span>
            {' • '}ใช้เพื่อประกอบการวางแผนและเตรียมพร้อม มิใช่ประกาศแจ้งเตือนภัยขณะเกิดเหตุ
          </p>

          <div className="flex items-center gap-2 shrink-0">
            <span
              title={storagePill.title}
              className={`hidden md:inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${storagePill.tone}`}
            >
              <Database className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{storagePill.label}</span>
            </span>

            <a
              href="tel:1784"
              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/20 tabular-nums transition-colors"
            >
              <Phone className="h-3 w-3 text-amber-300" aria-hidden="true" />
              <span>ปภ. 1784</span>
            </a>

            <button
              type="button"
              onClick={() => setBannerExpanded((v) => !v)}
              className="sm:hidden inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-slate-200 hover:bg-white/10"
              aria-expanded={bannerExpanded}
            >
              {bannerExpanded ? 'ย่อ' : 'อ่านเพิ่ม'}
              {bannerExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* แถบนำทางหลัก Royal Navy + Gold Hairline */}
      <div className="bg-[#0C2340] text-white border-b-2 border-[#C89B3C]">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2.5 px-3 py-2 sm:px-4">
          {/* โลโก้และชื่อระบบ */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"
              aria-hidden="true"
            >
              <ShieldAlert className="h-5 w-5 text-[#E5B857]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm sm:text-base font-semibold tracking-tight leading-tight text-white">
                แผนที่ความเสี่ยงสาธารณภัยแห่งประเทศไทย
              </h1>
              <p className="hidden xl:block text-xs text-slate-300 leading-tight mt-0.5 tabular-nums">
                77 จังหวัด • 928 อำเภอ/เขต • 10 สาธารณภัย
              </p>
            </div>
          </div>

          {/* เมนูหลัก 3 มุมมอง */}
          <nav
            aria-label="มุมมองหลักของระบบ"
            className="order-3 lg:order-2 flex w-full lg:w-auto items-center justify-center rounded-xl bg-white/10 p-1 ring-1 ring-white/15"
          >
            {(
              [
                { id: 'map' as const, label: 'แผนที่ความเสี่ยง', shortLabel: 'แผนที่', icon: MapIcon },
                { id: 'table' as const, label: 'ตาราง 77 จังหวัด', shortLabel: '77 จังหวัด', icon: Table2 },
                {
                  id: 'districts' as const,
                  label: 'กรอกคะแนน 928 อำเภอ',
                  shortLabel: '928 อำเภอ',
                  icon: SlidersHorizontal,
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex-1 lg:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 min-h-[36px] text-xs sm:text-[13px] font-semibold transition-all ${
                    active
                      ? 'bg-white text-[#0C2340] shadow-xs'
                      : 'text-slate-200 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.shortLabel}</span>
                  {item.id === 'districts' && sandboxEditCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-xs font-bold tabular-nums ${
                        active ? 'bg-teal-700 text-white' : 'bg-teal-400 text-slate-950'
                      }`}
                    >
                      {sandboxEditCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* ค้นหาจังหวัด/อำเภอ + ปุ่มเจ้าหน้าที่ */}
          <div className="order-2 lg:order-3 flex items-center gap-2 ml-auto lg:ml-0">
            <div ref={searchBoxRef} className="relative w-44 sm:w-60 xl:w-64">
              <label htmlFor="global-location-search" className="sr-only">
                ค้นหาจังหวัดหรืออำเภอ เช่น เชียงใหม่ แม่สาย หาดใหญ่ เขตจตุจักร
              </label>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300"
                aria-hidden="true"
              />
              <input
                id="global-location-search"
                type="text"
                role="combobox"
                aria-expanded={dropdownOpen && query.trim().length > 0}
                aria-controls="global-location-listbox"
                aria-activedescendant={
                  activeIndex >= 0 && searchGroups.flat[activeIndex]
                    ? searchGroups.flat[activeIndex].id
                    : undefined
                }
                value={query}
                onFocus={() => setDropdownOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                  setActiveIndex(-1);
                }}
                onKeyDown={(e) => {
                  const total = searchGroups.flat.length;
                  if (e.key === 'ArrowDown' && total > 0) {
                    e.preventDefault();
                    setDropdownOpen(true);
                    setActiveIndex((prev) => (prev + 1) % total);
                  } else if (e.key === 'ArrowUp' && total > 0) {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev <= 0 ? total - 1 : prev - 1));
                  } else if (e.key === 'Enter' && activeIndex >= 0 && searchGroups.flat[activeIndex]) {
                    e.preventDefault();
                    handleSelectResult(searchGroups.flat[activeIndex]);
                  } else if (e.key === 'Escape') {
                    setDropdownOpen(false);
                    setActiveIndex(-1);
                  }
                }}
                placeholder="ค้นหาจังหวัดหรืออำเภอ..."
                className="h-9 w-full rounded-lg bg-white/12 pl-8 pr-7 text-xs sm:text-sm text-white placeholder:text-slate-300 ring-1 ring-white/20 focus:bg-white focus:text-slate-900 focus:placeholder:text-slate-400 focus:ring-2 focus:ring-amber-300 transition-colors"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setDropdownOpen(false);
                    setActiveIndex(-1);
                  }}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {dropdownOpen && query.trim().length > 0 && (
                <div
                  id="global-location-listbox"
                  role="listbox"
                  aria-label="ผลการค้นหาจังหวัดและอำเภอ"
                  className="absolute right-0 sm:left-0 sm:right-0 top-full z-50 mt-1.5 w-72 sm:w-auto max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 text-slate-900 shadow-xl"
                >
                  {searchGroups.flat.length === 0 ? (
                    <p className="px-3.5 py-3 text-xs text-slate-500">
                      ไม่พบจังหวัดหรืออำเภอที่ตรงกับ "{query}"
                    </p>
                  ) : (
                    <>
                      {searchGroups.provinces.length > 0 && (
                        <div role="group" aria-label="จังหวัด">
                          <p className="px-3.5 py-1 text-xs font-semibold text-slate-500 bg-slate-50">
                            จังหวัด (เปิดบนแผนที่)
                          </p>
                          {searchGroups.provinces.map((item, idx) => {
                            if (item.kind !== 'province') return null;
                            const highlighted = activeIndex === idx;
                            return (
                              <button
                                key={item.id}
                                id={item.id}
                                role="option"
                                aria-selected={highlighted}
                                type="button"
                                onClick={() => handleSelectResult(item)}
                                className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
                                  highlighted ? 'bg-blue-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-slate-900/15"
                                    style={{ backgroundColor: item.dotColor }}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate font-medium text-slate-900">{item.label}</span>
                                  <span className="text-xs text-slate-500 shrink-0">{item.sublabel}</span>
                                </div>
                                <span className="shrink-0 font-semibold text-[#0C2340] tabular-nums text-xs">
                                  {item.scoreText}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {searchGroups.districts.length > 0 && (
                        <div role="group" aria-label="อำเภอและเขต">
                          <p className="px-3.5 py-1 text-xs font-semibold text-slate-500 bg-slate-50 border-t border-slate-100">
                            อำเภอ/เขต (เปิดหน้ากรอกคะแนน)
                          </p>
                          {searchGroups.districts.map((item, dIdx) => {
                            if (item.kind !== 'district') return null;
                            const flatIdx = searchGroups.provinces.length + dIdx;
                            const highlighted = activeIndex === flatIdx;
                            return (
                              <button
                                key={item.id}
                                id={item.id}
                                role="option"
                                aria-selected={highlighted}
                                type="button"
                                onClick={() => handleSelectResult(item)}
                                className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
                                  highlighted ? 'bg-blue-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                <span className="truncate font-medium text-slate-900">{item.label}</span>
                                <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                                  {item.sublabel}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenOfficerPortal}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs sm:text-[13px] font-semibold transition-colors ${
                authUser
                  ? 'bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-300/60 hover:bg-emerald-500/30'
                  : 'bg-white/12 text-white ring-1 ring-white/25 hover:bg-white/20'
              }`}
            >
              {authUser ? (
                <>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  <span className="hidden md:inline max-w-[140px] truncate">
                    {authUser.districtNameTh ??
                      (authUser.provinceNameTh
                        ? authUser.provinceCode === '10'
                          ? 'ปภ.กทม.'
                          : `ปภ.จ.${authUser.provinceNameTh}`
                        : 'ส่วนกลาง ปภ.')}
                  </span>
                  <span className="md:hidden">เจ้าหน้าที่</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 shrink-0 text-[#E5B857]" aria-hidden="true" />
                  <span className="hidden sm:inline">เจ้าหน้าที่</span>
                  <span className="sm:hidden">เข้าสู่ระบบ</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
