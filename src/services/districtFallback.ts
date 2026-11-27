import { PROVINCE_BY_CODE, PROVINCES_RISK_DATA } from '../data/provincesRiskData.ts';
import {
  DISTRICT_BY_CODE,
  DISTRICTS_BY_PROVINCE,
  THAILAND_DISTRICTS_CATALOG,
} from '../data/thailandDistrictsCatalog.ts';
import {
  aggregateDistrictsToProvince,
  deriveHistoricalPeriodMetrics,
  evaluateDistrictMetrics,
  generateProvinceDistrictBaseline,
} from '../domain/districtRollup.ts';
import type {
  DistrictCatalogSummaryItem,
  DistrictEvaluation,
  DistrictMetricsPayload,
  ProvinceRiskRecord,
} from '../types/index.ts';

const baselineCacheByProvince = new Map<string, Map<string, DistrictMetricsPayload>>();

function getProvinceBaselineMap(provinceCode: string): Map<string, DistrictMetricsPayload> {
  const existing = baselineCacheByProvince.get(provinceCode);
  if (existing) return existing;
  const prov = PROVINCE_BY_CODE[provinceCode];
  const dists = DISTRICTS_BY_PROVINCE[provinceCode] ?? [];
  const map = prov ? generateProvinceDistrictBaseline(prov, dists) : new Map();
  baselineCacheByProvince.set(provinceCode, map);
  return map;
}

export function buildFallbackDistrictMetrics(
  districtCode: string,
  periodId = '2569-Q3',
): DistrictMetricsPayload | null {
  const meta = DISTRICT_BY_CODE[districtCode];
  if (!meta) return null;
  const prov = PROVINCE_BY_CODE[meta.provinceCode];
  if (!prov) return null;
  const baseMap = getProvinceBaselineMap(meta.provinceCode);
  const currentMetrics = baseMap.get(districtCode);
  if (!currentMetrics) return null;
  return deriveHistoricalPeriodMetrics(currentMetrics, prov.region6, periodId);
}

export function buildFallbackProvinceDistricts(
  provinceCode: string,
  periodId = '2569-Q3',
): DistrictEvaluation[] {
  const prov = PROVINCE_BY_CODE[provinceCode];
  const dists = DISTRICTS_BY_PROVINCE[provinceCode] ?? [];
  if (!prov || dists.length === 0) return [];
  const baseMap = getProvinceBaselineMap(provinceCode);

  return dists.map((meta) => {
    const baseCurrent = baseMap.get(meta.code)!;
    const metrics = deriveHistoricalPeriodMetrics(baseCurrent, prov.region6, periodId);
    return evaluateDistrictMetrics(
      meta,
      prov,
      periodId,
      1,
      metrics,
      'ชุดข้อมูลค่าฐานจำลอง ปภ. 64-70',
      '2026-07-01T08:00:00.000Z',
      null,
    );
  });
}

export function buildFallbackDistrictCatalogSummary(
  periodId = '2569-Q3',
): DistrictCatalogSummaryItem[] {
  const out: DistrictCatalogSummaryItem[] = [];
  for (const prov of PROVINCES_RISK_DATA) {
    const evals = buildFallbackProvinceDistricts(prov.dopaCode, periodId);
    for (const ev of evals) {
      out.push({
        code: ev.district.code,
        provinceCode: ev.district.provinceCode,
        provinceNameTh: prov.nameTh,
        prefixTh: ev.district.prefixTh,
        nameTh: ev.district.nameTh,
        fullNameTh: ev.district.fullNameTh,
        nameEn: ev.district.nameEn,
        geoClass: ev.district.geoClass,
        ddpmScore: ev.ddpmScore,
        ddpmLevel: ev.ddpmLevel,
        capacityScore: ev.capacityScore,
        version: ev.version,
        updatedAt: ev.updatedAt,
        pendingCount: 0,
        isModifiedFromBaseline: false,
      });
    }
  }
  return out;
}

/**
 * รวมค่าทดลองกรอกรายอำเภอ (Sandbox Overrides) เข้ากับฐานจังหวัด 77 จังหวัดแบบทันที
 * ใช้สูตร 7 โปรไฟล์ (P1-P6b) ชุดเดียวกับฝั่งเซิร์ฟเวอร์เพื่อให้คะแนนบนแผนที่ตรง 100%
 */
export function applyDistrictSandboxToProvinces(
  baseProvinces: readonly ProvinceRiskRecord[],
  sandboxByDistrict: Readonly<Record<string, DistrictMetricsPayload>>,
  periodId: string,
  cachedProvinceDistricts?: Readonly<Record<string, readonly DistrictEvaluation[]>>,
): ProvinceRiskRecord[] {
  const touchedProvinceCodes = new Set<string>();
  for (const dCode of Object.keys(sandboxByDistrict)) {
    const meta = DISTRICT_BY_CODE[dCode];
    if (meta) touchedProvinceCodes.add(meta.provinceCode);
  }
  if (touchedProvinceCodes.size === 0) {
    return [...baseProvinces];
  }

  return baseProvinces.map((prov) => {
    if (!touchedProvinceCodes.has(prov.dopaCode)) return prov;

    const existingRows = cachedProvinceDistricts?.[prov.dopaCode];
    const districtRows =
      existingRows && existingRows.length > 0
        ? existingRows.map((row) => ({
            district: row.district,
            metrics: sandboxByDistrict[row.district.code] ?? row.metrics,
          }))
        : buildFallbackProvinceDistricts(prov.dopaCode, periodId).map((row) => ({
            district: row.district,
            metrics: sandboxByDistrict[row.district.code] ?? row.metrics,
          }));

    return aggregateDistrictsToProvince(prov, districtRows);
  });
}

export const TOTAL_THAILAND_DISTRICTS = THAILAND_DISTRICTS_CATALOG.length;
