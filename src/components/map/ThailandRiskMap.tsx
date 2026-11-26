import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoArea, geoMercator, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature, mesh } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { Crosshair, Eye, Minus, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import topoRaw from '../../data/thailand-provinces.topo.json';
import { HAZARD_BY_ID } from '../../data/hazardCatalog';
import { SUB_INDICATOR_BY_ID } from '../../data/indicatorCatalog';
import {
  getPaletteForDimension,
  MAP_DIMENSION_META,
  NA_RISK_STYLE,
  REGION6_LABELS,
  RISK_LEVEL_LIST,
} from '../../data/riskPalette';
import type {
  LayerSelection,
  MapDimension,
  ProvinceEvaluation,
  RegionFilterKey,
  RiskLevel,
  SubIndicatorId,
} from '../../types/risk';

interface ProvinceFeatureProps {
  dopaCode: string;
  isoCode: string;
  nameTh: string;
  nameEn: string;
}

type ProvinceFeature = Feature<Geometry, ProvinceFeatureProps>;
type ProvinceCollection = FeatureCollection<Geometry, ProvinceFeatureProps>;

interface ThailandRiskMapProps {
  evaluations: readonly ProvinceEvaluation[];
  activeDimension: MapDimension;
  activeLayer: LayerSelection;
  activeSubIndicator: SubIndicatorId | null;
  selectedProvinceCode: string | null;
  compareCodes: readonly string[];
  regionFilter: RegionFilterKey;
  levelFilter: RiskLevel | null;
  simulatedCount: number;
  onResetAllSimulations: () => void;
  onChangeLevelFilter: (level: RiskLevel | null) => void;
  onSelectProvince: (dopaCode: string) => void;
}

const MAP_WIDTH = 620;
const MAP_HEIGHT = 820;

const BMA6_CODES = new Set(['10', '11', '12', '13', '73', '74']);
const PHUKET_CODES = new Set(['83']);

function rewindRingsIfInverted(rings: Position[][]): Position[][] {
  const area = geoArea({ type: 'Polygon', coordinates: rings });
  if (area > 2 * Math.PI) {
    return rings.map((ring) => [...ring].reverse());
  }
  return rings;
}

function rewindFeatureForD3(f: ProvinceFeature): ProvinceFeature {
  if (!f.geometry) return f;
  if (f.geometry.type === 'Polygon') {
    return {
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: rewindRingsIfInverted(f.geometry.coordinates),
      },
    };
  }
  if (f.geometry.type === 'MultiPolygon') {
    return {
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: f.geometry.coordinates.map((poly) => rewindRingsIfInverted(poly)),
      },
    };
  }
  return f;
}

export function ThailandRiskMap({
  evaluations,
  activeDimension,
  activeLayer,
  activeSubIndicator,
  selectedProvinceCode,
  compareCodes,
  regionFilter,
  levelFilter,
  simulatedCount,
  onResetAllSimulations,
  onChangeLevelFilter,
  onSelectProvince,
}: ThailandRiskMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(() => zoomIdentity);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; width: number }>({
    x: 0,
    y: 0,
    width: 600,
  });
  const [patternMode, setPatternMode] = useState(false);

  const palette = getPaletteForDimension(activeDimension);
  const isCapacityMode = activeDimension === 'C';

  const evalByCode = useMemo(() => {
    const map = new Map<string, ProvinceEvaluation>();
    for (const ev of evaluations) {
      map.set(ev.province.dopaCode, ev);
    }
    return map;
  }, [evaluations]);

  const compareSet = useMemo(() => new Set(compareCodes), [compareCodes]);

  const geoData = useMemo(() => {
    const topology = topoRaw as unknown as Parameters<typeof feature>[0] & {
      objects: { provinces: Parameters<typeof feature>[1] };
    };
    const rawCollection = feature(
      topology,
      topology.objects.provinces,
    ) as unknown as ProvinceCollection;
    const collection: ProvinceCollection = {
      type: 'FeatureCollection',
      features: rawCollection.features.map(rewindFeatureForD3),
    };
    const borderMesh = mesh(
      topology,
      topology.objects.provinces as unknown as Parameters<typeof mesh>[1],
    );

    const mainProjection = geoMercator().fitExtent(
      [
        [34, 24],
        [MAP_WIDTH - 24, MAP_HEIGHT - 24],
      ],
      collection,
    );
    const mainPathGen = geoPath(mainProjection);

    const bmaCollection: ProvinceCollection = {
      type: 'FeatureCollection',
      features: collection.features.filter((f) => BMA6_CODES.has(f.properties.dopaCode)),
    };
    const bmaProjection = geoMercator().fitExtent(
      [
        [12, 26],
        [182, 174],
      ],
      bmaCollection,
    );
    const bmaPathGen = geoPath(bmaProjection);

    const phuketCollection: ProvinceCollection = {
      type: 'FeatureCollection',
      features: collection.features.filter((f) => PHUKET_CODES.has(f.properties.dopaCode)),
    };
    const phuketProjection = geoMercator().fitExtent(
      [
        [18, 28],
        [114, 126],
      ],
      phuketCollection,
    );
    const phuketPathGen = geoPath(phuketProjection);

    const mainPaths = collection.features.map((f) => ({
      dopaCode: f.properties.dopaCode,
      d: mainPathGen(f) ?? '',
    }));

    const bmaPaths = bmaCollection.features.map((f) => ({
      dopaCode: f.properties.dopaCode,
      d: bmaPathGen(f) ?? '',
      centroid: bmaPathGen.centroid(f),
    }));

    const phuketPaths = phuketCollection.features.map((f) => ({
      dopaCode: f.properties.dopaCode,
      d: phuketPathGen(f) ?? '',
    }));

    return {
      collection,
      mainPathGen,
      mainPaths,
      bmaPaths,
      phuketPaths,
      borderMeshD: mainPathGen(borderMesh) ?? '',
    };
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 9])
      .translateExtent([
        [-120, -120],
        [MAP_WIDTH + 120, MAP_HEIGHT + 120],
      ])
      .on('zoom', (event) => {
        setTransform(event.transform);
      });

    zoomBehaviorRef.current = behavior;
    select(svgEl).call(behavior);

    return () => {
      select(svgEl).on('.zoom', null);
    };
  }, []);

  const zoomToCodes = useCallback(
    (codes: ReadonlySet<string>, padding = 48) => {
      const svgEl = svgRef.current;
      const behavior = zoomBehaviorRef.current;
      if (!svgEl || !behavior) return;

      const matched = geoData.collection.features.filter((f) =>
        codes.has(f.properties.dopaCode),
      );
      if (matched.length === 0) return;

      const subCollection: ProvinceCollection = {
        type: 'FeatureCollection',
        features: matched as ProvinceFeature[],
      };
      const [[x0, y0], [x1, y1]] = geoData.mainPathGen.bounds(subCollection);
      const dx = Math.max(12, x1 - x0);
      const dy = Math.max(12, y1 - y0);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const scale = Math.max(
        1,
        Math.min(7.5, Math.min((MAP_WIDTH - padding * 2) / dx, (MAP_HEIGHT - padding * 2) / dy)),
      );
      const tx = MAP_WIDTH / 2 - scale * cx;
      const ty = MAP_HEIGHT / 2 - scale * cy;

      select(svgEl).call(behavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
    },
    [geoData],
  );

  const resetZoom = useCallback(() => {
    const svgEl = svgRef.current;
    const behavior = zoomBehaviorRef.current;
    if (!svgEl || !behavior) return;
    select(svgEl).call(behavior.transform, zoomIdentity);
  }, []);

  const stepZoom = useCallback((factor: number) => {
    const svgEl = svgRef.current;
    const behavior = zoomBehaviorRef.current;
    if (!svgEl || !behavior) return;
    select(svgEl).call(behavior.scaleBy, factor);
  }, []);

  useEffect(() => {
    if (regionFilter === 'all') {
      resetZoom();
      return;
    }
    const matchingCodes = new Set(
      evaluations
        .filter((ev) =>
          regionFilter === 'bma6'
            ? ev.province.isBma6
            : ev.province.region6 === regionFilter,
        )
        .map((ev) => ev.province.dopaCode),
    );
    zoomToCodes(matchingCodes, 64);
  }, [regionFilter, evaluations, zoomToCodes, resetZoom]);

  const getFillAndOpacity = (dopaCode: string) => {
    const ev = evalByCode.get(dopaCode);
    if (!ev) {
      return {
        baseFill: NA_RISK_STYLE.mapFill,
        patternId: NA_RISK_STYLE.patternId,
        dimmed: false,
        isNa: true,
        isSimulated: false,
      };
    }

    const matchesRegion =
      regionFilter === 'all' ||
      (regionFilter === 'bma6' ? ev.province.isBma6 : ev.province.region6 === regionFilter);

    const matchesLevel = levelFilter === null || ev.level === levelFilter;
    const dimmed = !matchesRegion || !matchesLevel;

    if (ev.level === null) {
      return {
        baseFill: NA_RISK_STYLE.mapFill,
        patternId: NA_RISK_STYLE.patternId,
        dimmed,
        isNa: true,
        isSimulated: ev.breakdown.isSimulated,
      };
    }

    const style = palette[ev.level];
    return {
      baseFill: style.mapFill,
      patternId: style.patternId,
      dimmed,
      isNa: false,
      isSimulated: ev.breakdown.isSimulated,
    };
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
    });
  };

  const hoveredEval = hoveredCode ? evalByCode.get(hoveredCode) ?? null : null;

  const levelCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let naCount = 0;
    for (const ev of evaluations) {
      if (ev.level === null) naCount += 1;
      else counts[ev.level] += 1;
    }
    return { counts, naCount };
  }, [evaluations]);

  const activeMapHeading = useMemo(() => {
    if (activeDimension === 'R') {
      return activeLayer === 'composite'
        ? 'แผนที่ความเสี่ยงสุทธิรวม 10 สาธารณภัย'
        : `แผนที่ความเสี่ยงสุทธิ: ${HAZARD_BY_ID[activeLayer].nameTh}`;
    }
    if (activeDimension === 'H') {
      return activeLayer === 'composite'
        ? 'แผนที่ระดับภัยคุกคามรวม 10 สาธารณภัย'
        : `แผนที่ระดับภัยคุกคาม: ${HAZARD_BY_ID[activeLayer].nameTh}`;
    }
    const dimMeta = MAP_DIMENSION_META[activeDimension];
    if (activeSubIndicator && SUB_INDICATOR_BY_ID[activeSubIndicator]) {
      return `แผนที่${dimMeta.nameTh}: ${SUB_INDICATOR_BY_ID[activeSubIndicator].shortNameTh}`;
    }
    return `แผนที่${dimMeta.nameTh}`;
  }, [activeDimension, activeLayer, activeSubIndicator]);

  const defaultBorderStroke = isCapacityMode ? '#64748B' : '#FFFFFF';

  const renderProvincePaths = (
    items: readonly { dopaCode: string; d: string }[],
    strokeBaseWidth: number,
  ) =>
    items.map(({ dopaCode, d }) => {
      const ev = evalByCode.get(dopaCode);
      const { baseFill, patternId, dimmed, isNa, isSimulated } = getFillAndOpacity(dopaCode);
      const isSelected = selectedProvinceCode === dopaCode;
      const isHovered = hoveredCode === dopaCode;
      const isCompared = compareSet.has(dopaCode);

      const ariaLabel = ev
        ? `${ev.province.dopaCode === '10' ? ev.province.nameTh : `จังหวัด${ev.province.nameTh}`} ${
            ev.level !== null
              ? `ระดับ ${ev.level} ${palette[ev.level].shortLabelTh} คะแนน ${ev.score?.toFixed(2)} จาก 5.00`
              : 'ไม่เข้าข่ายเชิงภูมิศาสตร์ N/A'
          } กด Enter เพื่อดูรายละเอียด`
        : dopaCode;

      const strokeColor = isSelected
        ? '#0F294A'
        : isSimulated
          ? '#0D9488'
          : isHovered
            ? '#0F172A'
            : isCompared
              ? '#7C3AED'
              : defaultBorderStroke;

      const strokeWidth = isSelected
        ? strokeBaseWidth * 2.8
        : isSimulated
          ? strokeBaseWidth * 2.6
          : isHovered
            ? strokeBaseWidth * 2.2
            : isCompared
              ? strokeBaseWidth * 2.4
              : strokeBaseWidth;

      const dashArray = isSimulated || (isCompared && !isSelected) ? '4 2' : undefined;

      return (
        <g
          key={dopaCode}
          style={{ opacity: dimmed && !isSelected && !isHovered ? 0.17 : 1 }}
          className="transition-opacity duration-200"
        >
          <path
            d={d}
            fill={baseFill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            vectorEffect="non-scaling-stroke"
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={ariaLabel}
            className="cursor-pointer transition-[fill] duration-200 outline-none focus-visible:stroke-[#1D4ED8] focus-visible:stroke-[3px]"
            onMouseEnter={() => setHoveredCode(dopaCode)}
            onMouseLeave={() => setHoveredCode((prev) => (prev === dopaCode ? null : prev))}
            onFocus={() => setHoveredCode(dopaCode)}
            onBlur={() => setHoveredCode((prev) => (prev === dopaCode ? null : prev))}
            onClick={() => onSelectProvince(dopaCode)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectProvince(dopaCode);
              }
            }}
          />
          {(isNa || patternMode) && (
            <path d={d} fill={`url(#${patternId})`} pointerEvents="none" />
          )}
        </g>
      );
    });

  return (
    <div className="relative flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      {/* แถบหัวแผนที่ + ปุ่ม Quick Zoom + สถานะโหมดจำลองสถานการณ์ */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4 ${
          isCapacityMode
            ? 'border-teal-200 bg-teal-50/70'
            : 'border-slate-100 bg-slate-50/70'
        }`}
      >
        <div className="min-w-0">
          <h2
            id="map-heading"
            className={`truncate text-sm sm:text-base font-semibold ${
              isCapacityMode ? 'text-[#115E59]' : 'text-[#0F294A]'
            }`}
          >
            {activeMapHeading}
          </h2>
          <p id="map-summary" className="text-[11px] sm:text-xs text-slate-600 tabular-nums">
            {isCapacityMode
              ? 'สีมรกตยิ่งเข้ม แสดงว่าจังหวัดมีความพร้อมและศักยภาพในการรับมือสูงขึ้น'
              : 'เลือกจังหวัดบนแผนที่เพื่อดูรายละเอียดรายปัจจัยและจำลองแผนเพิ่มศักยภาพ'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {simulatedCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-teal-500 bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white">
              <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">กำลังจำลองแผน ({simulatedCount} จังหวัด)</span>
              <button
                type="button"
                onClick={onResetAllSimulations}
                className="ml-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[10px] hover:bg-white/30"
              >
                คืนค่าเริ่มต้น
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => zoomToCodes(BMA6_CODES, 80)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            title="ขยายแผนที่กรุงเทพมหานครและปริมณฑล 6 จังหวัด"
          >
            <Crosshair className="h-3 w-3 text-[#1D4ED8]" aria-hidden="true" />
            <span>ขยาย กทม.-ปริมณฑล</span>
          </button>
          <button
            type="button"
            onClick={() => zoomToCodes(PHUKET_CODES, 140)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            title="ขยายแผนที่จังหวัดภูเก็ต"
          >
            <Crosshair className="h-3 w-3 text-[#1D4ED8]" aria-hidden="true" />
            <span>ขยายภูเก็ต</span>
          </button>
          <button
            type="button"
            onClick={() => setPatternMode((v) => !v)}
            aria-pressed={patternMode}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              patternMode
                ? 'border-[#0F294A] bg-[#0F294A] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            title="แสดงลวดลายซ้อนทับสีแผนที่ เพื่อช่วยให้ผู้มีภาวะตาบอดสีแยกแยะระดับได้ชัดเจนขึ้น"
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            <span className="hidden sm:inline">ลวดลายช่วยแยกสี</span>
            <span className="sm:hidden">ลวดลาย</span>
          </button>
        </div>
      </div>

      {/* พื้นที่แผนที่ SVG หลัก + กรอบขยาย Inset (แยกจากชั้นซูม และพอดีหน้าจอ Desktop 1440x900) */}
      <div
        className="relative w-full bg-[#EAF2F8] h-[52dvh] min-h-[380px] sm:h-[530px] lg:h-[550px] xl:h-[570px] select-none"
        onMouseMove={handlePointerMove}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="group"
          aria-labelledby="map-heading map-summary"
          className="h-full w-full touch-pan-y cursor-grab active:cursor-grabbing"
        >
          <defs>
            {/* ลวดลายสำหรับ R/H/E/V */}
            <pattern id="risk-pattern-1" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="1.1" fill="rgba(255,255,255,0.45)" />
            </pattern>
            <pattern id="risk-pattern-2" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 4 H8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
            </pattern>
            <pattern id="risk-pattern-3" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M-2 6 L6 -2 M2 10 L10 2" stroke="rgba(15,23,42,0.32)" strokeWidth="1.3" />
            </pattern>
            <pattern id="risk-pattern-4" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M-1 5 L5 -1 M1 7 L7 1" stroke="rgba(255,255,255,0.48)" strokeWidth="1.4" />
            </pattern>
            <pattern id="risk-pattern-5" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 0 L7 7 M7 0 L0 7" stroke="rgba(255,255,255,0.52)" strokeWidth="1.3" />
            </pattern>
            {/* ลวดลายสำหรับ C (ศักยภาพ) */}
            <pattern id="cap-pattern-1" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="1.1" fill="rgba(15,23,42,0.35)" />
            </pattern>
            <pattern id="cap-pattern-2" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 4 H8" stroke="rgba(15,23,42,0.28)" strokeWidth="1.2" />
            </pattern>
            <pattern id="cap-pattern-3" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M-2 6 L6 -2 M2 10 L10 2" stroke="rgba(15,23,42,0.28)" strokeWidth="1.2" />
            </pattern>
            <pattern id="cap-pattern-4" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M-1 5 L5 -1 M1 7 L7 1" stroke="rgba(255,255,255,0.42)" strokeWidth="1.3" />
            </pattern>
            <pattern id="cap-pattern-5" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 0 L7 7 M7 0 L0 7" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
            </pattern>
            <pattern id="risk-pattern-na" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M-2 6 L6 -2 M2 10 L10 2" stroke="#94A3B8" strokeWidth="1.2" />
            </pattern>
          </defs>

          <g transform={transform.toString()}>
            {renderProvincePaths(geoData.mainPaths, 0.85)}
            <path
              d={geoData.borderMeshD}
              fill="none"
              stroke={isCapacityMode ? 'rgba(71,85,105,0.55)' : 'rgba(255,255,255,0.55)'}
              strokeWidth={0.65}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        </svg>

        {/* กรอบขยาย Inset (แยกขาดจากชั้น d3-zoom) */}
        <div className="hidden md:flex flex-col gap-1.5 absolute left-2.5 bottom-2.5 z-10 pointer-events-auto">
          <div className="w-[164px] rounded-xl border border-slate-300/90 bg-white/95 p-1.5 shadow-md backdrop-blur-xs">
            <div className="px-1 pb-0.5">
              <span className="text-[10px] font-semibold text-[#0F294A]">
                กทม. และปริมณฑล (6 จังหวัด)
              </span>
            </div>
            <svg viewBox="0 0 194 182" className="w-full h-[112px] rounded-lg bg-[#EAF2F8]">
              {renderProvincePaths(geoData.bmaPaths, 1.1)}
              {geoData.bmaPaths
                .filter((p) => p.dopaCode === '10')
                .map((p) => (
                  <text
                    key="bkk-label"
                    x={p.centroid[0]}
                    y={p.centroid[1]}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none fill-white text-[11px] font-bold"
                    style={{ paintOrder: 'stroke', stroke: '#0F172A', strokeWidth: '2.5px' }}
                  >
                    กทม.
                  </text>
                ))}
            </svg>
          </div>

          <div className="w-[114px] rounded-xl border border-slate-300/90 bg-white/95 p-1.5 shadow-md backdrop-blur-xs">
            <div className="px-1 pb-0.5">
              <span className="text-[10px] font-semibold text-[#0F294A]">ขยายพื้นที่: ภูเก็ต</span>
            </div>
            <svg viewBox="0 0 132 138" className="w-full h-[74px] rounded-lg bg-[#EAF2F8]">
              {renderProvincePaths(geoData.phuketPaths, 1.2)}
            </svg>
          </div>
        </div>

        {/* ปุ่มซูม +/-/Reset */}
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => stepZoom(1.45)}
            aria-label="ขยายแผนที่"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => stepZoom(0.68)}
            aria-label="ย่อแผนที่"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            aria-label="แสดงภาพรวมทั้งประเทศ"
            title="แสดงภาพรวมทั้งประเทศ"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        {/* Hover Tooltip */}
        {hoveredEval && (
          <div
            role="status"
            aria-live="off"
            className="pointer-events-none absolute z-30 w-64 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-xl backdrop-blur-xs"
            style={{
              left: Math.min(Math.max(12, tooltipPos.x + 14), Math.max(12, tooltipPos.width - 268)),
              top: Math.max(12, tooltipPos.y - 12),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm text-slate-900 truncate">
                {hoveredEval.province.dopaCode === '10'
                  ? hoveredEval.province.nameTh
                  : `จังหวัด${hoveredEval.province.nameTh}`}
              </p>
              <span className="text-[11px] font-medium text-slate-500 shrink-0 tabular-nums">
                #{hoveredEval.rank}/77
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-1.5">
              {REGION6_LABELS[hoveredEval.province.region6]}
              {hoveredEval.breakdown.isSimulated ? ' (กำลังจำลองแผน)' : ''}
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                  style={{
                    backgroundColor:
                      hoveredEval.level !== null
                        ? palette[hoveredEval.level].badgeBg
                        : NA_RISK_STYLE.badgeBg,
                    color:
                      hoveredEval.level !== null
                        ? palette[hoveredEval.level].badgeText
                        : NA_RISK_STYLE.badgeText,
                  }}
                >
                  {hoveredEval.level !== null
                    ? palette[hoveredEval.level].symbol
                    : NA_RISK_STYLE.symbol}
                </span>
                <span className="text-xs font-medium text-slate-800 truncate">
                  {hoveredEval.level !== null
                    ? `ระดับ ${hoveredEval.level} ${palette[hoveredEval.level].shortLabelTh}`
                    : 'ไม่เข้าข่าย (N/A)'}
                </span>
              </div>
              <span className="text-sm font-bold text-[#0F294A] tabular-nums shrink-0">
                {hoveredEval.score !== null ? hoveredEval.score.toFixed(2) : '—'}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center text-[10px] tabular-nums">
              <div className="rounded bg-slate-100 py-0.5 text-slate-700">
                <span className="block text-[9px] text-slate-500">ภัย</span>
                <strong>{hoveredEval.breakdown.hazardCompositeScore.toFixed(1)}</strong>
              </div>
              <div className="rounded bg-slate-100 py-0.5 text-slate-700">
                <span className="block text-[9px] text-slate-500">ล่อแหลม</span>
                <strong>{hoveredEval.breakdown.exposureScore.toFixed(1)}</strong>
              </div>
              <div className="rounded bg-slate-100 py-0.5 text-slate-700">
                <span className="block text-[9px] text-slate-500">เปราะบาง</span>
                <strong>{hoveredEval.breakdown.vulnerabilityScore.toFixed(1)}</strong>
              </div>
              <div className="rounded bg-teal-50 py-0.5 text-teal-900">
                <span className="block text-[9px] text-teal-700">ศักยภาพ</span>
                <strong>{hoveredEval.breakdown.effectiveCapacityScore.toFixed(1)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* แถบคำอธิบายสัญลักษณ์ 5 ระดับ (น้ำเงิน->แดง สำหรับ R/H/E/V | มรกตอ่อน->เข้ม สำหรับ C) */}
      <div
        className={`border-t px-3 py-2 sm:px-4 ${
          isCapacityMode ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={
              isCapacityMode
                ? 'คำอธิบายระดับศักยภาพ 5 ระดับสีมรกต'
                : 'คำอธิบายและกรองระดับสีความเสี่ยง 5 ระดับ'
            }
          >
            {RISK_LEVEL_LIST.map((lvl) => {
              const style = palette[lvl];
              const active = levelFilter === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onChangeLevelFilter(active ? null : lvl)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all ${
                    active
                      ? isCapacityMode
                        ? 'border-[#115E59] bg-[#115E59] text-white shadow-xs'
                        : 'border-[#0F294A] bg-slate-900 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-bold ring-1 ring-slate-900/10"
                    style={{
                      backgroundColor: style.mapFill,
                      color: isCapacityMode && lvl <= 3 ? '#0F172A' : style.badgeText,
                    }}
                    aria-hidden="true"
                  >
                    {style.symbol}
                  </span>
                  <span className="font-medium tabular-nums">
                    {lvl}. {style.shortLabelTh}
                  </span>
                  <span
                    className={`text-[11px] tabular-nums ${
                      active ? 'text-white/80' : 'text-slate-500'
                    }`}
                  >
                    ({levelCounts.counts[lvl]})
                  </span>
                </button>
              );
            })}

            {levelCounts.naCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-600 tabular-nums">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-sm border border-slate-400"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(45deg, #E2E8F0, #E2E8F0 3px, #94A3B8 3px, #94A3B8 4.5px)',
                  }}
                  aria-hidden="true"
                />
                <span>ไม่เข้าข่าย ({levelCounts.naCount})</span>
              </span>
            )}
          </div>

          {levelFilter !== null && (
            <button
              type="button"
              onClick={() => onChangeLevelFilter(null)}
              className="text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              แสดงทุกระดับ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
