import { useMemo, useRef, useState, useEffect } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lock,
  Map as MapIcon,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react';
import { getPaletteForDimension, NA_RISK_STYLE, REGION6_LABELS } from '../../data/riskPalette';
import type { AuthUser, MapDimension, ProvinceEvaluation } from '../../types/index.ts';

interface GovHeaderProps {
  evaluations: readonly ProvinceEvaluation[];
  activeDimension: MapDimension;
  activeView: 'map' | 'table';
  authUser: AuthUser | null;
  onChangeView: (view: 'map' | 'table') => void;
  onSelectProvince: (dopaCode: string) => void;
  onOpenOfficerPortal: () => void;
}

export function GovHeader({
  evaluations,
  activeDimension,
  activeView,
  authUser,
  onChangeView,
  onSelectProvince,
  onOpenOfficerPortal,
}: GovHeaderProps) {
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return evaluations
      .filter((ev) => {
        const p = ev.province;
        return (
          p.nameTh.toLowerCase().includes(q) ||
          p.nameEn.toLowerCase().includes(q) ||
          p.dopaCode.includes(q) ||
          p.isoCode.toLowerCase().includes(q) ||
          p.shortAliases.some((a) => a.toLowerCase().includes(q))
        );
      })
      .slice(0, 8);
  }, [evaluations, query]);

  const palette = getPaletteForDimension(activeDimension);

  return (
    <header className="sticky top-0 z-40 shadow-sm">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
      >
        ข้ามไปยังเนื้อหาหลักและแผนที่ความเสี่ยง
      </a>

      {/* แถบประกาศชี้แจงความโปร่งใส (ยุบได้บนมือถือ) */}
      <div
        role="note"
        aria-label="ประกาศชี้แจงสถานะข้อมูลจำลอง"
        className="bg-amber-50 border-b border-amber-200 text-amber-950"
      >
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-2 px-3 py-1.5 text-xs sm:px-4">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 mt-0.5 sm:mt-0" aria-hidden="true" />
            <p className={`${bannerExpanded ? '' : 'truncate sm:whitespace-normal'} leading-snug`}>
              <strong className="font-semibold">ข้อมูลชุดนี้เป็นค่าฐานจำลองเชิงสถิติตามแผน ปภ. ชาติ พ.ศ. 2564-2570</strong>
              {' '}ใช้ประกอบการวางแผนและเตรียมพร้อม มิใช่ประกาศแจ้งเตือนภัยขณะเกิดเหตุ
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="tel:1784"
              className="hidden md:inline-flex items-center gap-1 rounded-full bg-amber-900/10 px-2.5 py-0.5 font-semibold text-amber-950 hover:bg-amber-900/20 tabular-nums"
            >
              <Phone className="h-3 w-3" aria-hidden="true" />
              ปภ. 1784
            </a>
            <button
              type="button"
              onClick={() => setBannerExpanded((v) => !v)}
              className="sm:hidden inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
              aria-expanded={bannerExpanded}
            >
              {bannerExpanded ? 'ย่อ' : 'อ่านเพิ่ม'}
              {bannerExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* แถบหัวข้อหลัก Modern Thai GovTech */}
      <div className="bg-[#0F294A] text-white border-b-2 border-[#D97706]">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20"
              aria-hidden="true"
            >
              <ShieldAlert className="h-5 w-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base lg:text-lg leading-tight">
                ระบบแผนที่ความเสี่ยงสาธารณภัยแห่งประเทศไทย
              </h1>
              <p className="hidden sm:block text-xs text-slate-300 leading-tight mt-0.5 tabular-nums">
                กรอบแผนการป้องกันและบรรเทาสาธารณภัยแห่งชาติ พ.ศ. 2564-2570 ครอบคลุม 77 จังหวัด 10 ประเภทสาธารณภัย
              </p>
            </div>
          </div>

          <div className="flex w-full sm:w-auto items-center gap-2">
            {/* ค้นหาจังหวัด */}
            <div ref={searchBoxRef} className="relative flex-1 sm:w-64 md:w-72">
              <label htmlFor="province-search-input" className="sr-only">
                ค้นหาจังหวัด เช่น เชียงใหม่ กรุงเทพมหานคร นครราชสีมา บึงกาฬ
              </label>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="province-search-input"
                type="text"
                value={query}
                onFocus={() => setDropdownOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                placeholder="ค้นหาจังหวัด เช่น เชียงใหม่ กทม. บึงกาฬ"
                className="w-full rounded-lg bg-white/10 py-1.5 pl-8 pr-7 text-xs sm:text-sm text-white placeholder:text-slate-300 ring-1 ring-white/20 focus:bg-white focus:text-slate-900 focus:placeholder:text-slate-400 focus:ring-2 focus:ring-amber-400 transition-colors"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setDropdownOpen(false);
                  }}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {dropdownOpen && query.trim().length > 0 && (
                <ul
                  role="listbox"
                  aria-label="ผลการค้นหาจังหวัด"
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-slate-900 shadow-xl"
                >
                  {searchResults.length === 0 ? (
                    <li className="px-3 py-2.5 text-xs text-slate-500">
                      ไม่พบจังหวัดที่ตรงกับ "{query}"
                    </li>
                  ) : (
                    searchResults.map((ev) => {
                      const dotColor =
                        ev.level !== null ? palette[ev.level].mapFill : NA_RISK_STYLE.mapFill;
                      return (
                        <li key={ev.province.dopaCode}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectProvince(ev.province.dopaCode);
                              setQuery('');
                              setDropdownOpen(false);
                              if (activeView !== 'map') {
                                onChangeView('map');
                              }
                            }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs sm:text-sm hover:bg-slate-50"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-slate-900/15"
                                style={{ backgroundColor: dotColor }}
                                aria-hidden="true"
                              />
                              <span className="truncate font-medium text-slate-900">
                                {ev.province.nameTh}
                              </span>
                              <span className="hidden sm:inline text-[11px] text-slate-500">
                                ({REGION6_LABELS[ev.province.region6]})
                              </span>
                            </div>
                            <span className="shrink-0 font-semibold text-slate-700 tabular-nums">
                              {ev.score !== null ? ev.score.toFixed(2) : 'N/A'}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>

            {/* สลับมุมมอง แผนที่ / ตาราง */}
            <div
              role="group"
              aria-label="สลับมุมมองการแสดงผล"
              className="inline-flex shrink-0 rounded-lg bg-white/10 p-0.5 ring-1 ring-white/20"
            >
              <button
                type="button"
                onClick={() => onChangeView('map')}
                aria-pressed={activeView === 'map'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeView === 'map'
                    ? 'bg-white text-[#0F294A] shadow-xs'
                    : 'text-slate-200 hover:text-white'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>แผนที่</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeView('table')}
                aria-pressed={activeView === 'table'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeView === 'table'
                    ? 'bg-white text-[#0F294A] shadow-xs'
                    : 'text-slate-200 hover:text-white'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">ตาราง 77 จังหวัด</span>
                <span className="sm:hidden">ตาราง</span>
              </button>
            </div>

            {/* ปุ่มเข้าสู่ระบบเจ้าหน้าที่ ปภ. (แยกขาดจากมุมมองประชาชน) */}
            <button
              type="button"
              onClick={onOpenOfficerPortal}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                authUser
                  ? 'bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-300/60 hover:bg-emerald-500/30'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              {authUser ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                  <span className="hidden md:inline max-w-[155px] truncate">
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
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">สำหรับเจ้าหน้าที่</span>
                  <span className="sm:hidden">เจ้าหน้าที่</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
