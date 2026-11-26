import { HAZARD_CATALOG, HAZARD_IDS } from '../data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../data/indicatorCatalog.ts';
import {
  clampScore,
  computeProvinceHevc,
  round2,
  scoreToRiskLevel,
} from './riskCalculator.ts';
import type {
  CapacityIndicatorId,
  DistrictEvaluation,
  DistrictGeoClass,
  DistrictMeta,
  DistrictMetricsPayload,
  ExposureIndicatorId,
  HazardId,
  HazardScoreEntry,
  ProvinceDistrictDiagnostics,
  ProvinceRiskRecord,
  SubIndicatorId,
  VulnerabilityIndicatorId,
} from '../types/index.ts';

// ==================== 6-Group (7-Profile) Statistical Aggregation System ====================

export type AggregationProfileId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6a' | 'P6b';

export interface AggregationProfileMeta {
  readonly id: AggregationProfileId;
  readonly nameTh: string;
  readonly distributionTh: string;
  readonly weightBasisTh: string;
  readonly formulaSummaryTh: string;
  readonly rationaleTh: string;
  readonly membersTh: string;
}

export const AGGREGATION_PROFILES: readonly AggregationProfileMeta[] = [
  {
    id: 'P1',
    nameTh: 'ภัยเฉพาะจุดรุนแรง',
    distributionTh: 'เบ้ขวาจัด เกิดเฉพาะอำเภอเชิงเขา นิคม หรือชายฝั่ง',
    weightBasisTh: 'น้ำหนักเท่ากันทุกอำเภอที่เข้าข่าย',
    formulaSummaryTh: '0.35 M3 + 0.35 UpperCVaR(20%) + 0.30 Max',
    rationaleTh: 'ป้องกันไม่ให้พื้นที่ปกติกลบอำเภอที่เสี่ยงสูงมาก โดยยังแยกแยะจำนวนอำเภอเสี่ยงได้และไม่คลาดเคลื่อนจากค่าต่ำสุดเหมือนค่าเฉลี่ยพิสัย',
    membersTh: 'ดินโคลนถล่ม, สารพิษในอากาศและน้ำ, แผ่นดินไหว, สึนามิและภัยชายฝั่ง',
  },
  {
    id: 'P2',
    nameTh: 'ภัยแนวลุ่มน้ำและแนวพายุ',
    distributionTh: 'เกิดเป็นกลุ่มอำเภอต่อเนื่องตามลุ่มน้ำและเส้นทางพายุ',
    weightBasisTh: 'ถ่วงน้ำหนักประชากรอำเภอ',
    formulaSummaryTh: '0.55 M2 + 0.45 UpperCVaR(20%)',
    rationaleTh: 'ให้น้ำหนักกลุ่มอำเภอลุ่มน้ำหลักและพื้นที่ประชากรหนาแน่นที่ได้รับผลกระทบพร้อมกัน',
    membersTh: 'อุทกภัย, วาตภัย',
  },
  {
    id: 'P3',
    nameTh: 'ภัยแผ่กว้างทั้งพื้นที่',
    distributionTh: 'กระจายวงกว้างข้ามหลายอำเภอ มีจุดพุ่งสูงเฉพาะย่าน',
    weightBasisTh: 'ถ่วงน้ำหนักประชากรอำเภอ',
    formulaSummaryTh: '0.75 M1.5 + 0.25 UpperCVaR(20%)',
    rationaleTh: 'แสดงภาพรวมทั้งจังหวัดควบคู่กับการตรวจจับจุดที่มีค่าฝุ่น ความร้อน หรือโรคระบาดสูงผิดปกติ',
    membersTh: 'PM2.5 และไฟป่า, ภัยแล้ง, คลื่นความร้อน, โรคระบาดและภัยชีวภาพ',
  },
  {
    id: 'P4',
    nameTh: 'ความล่อแหลม (E)',
    distributionTh: 'กระจุกตัวสูงในอำเภอเมือง นิคม และศูนย์กลางเศรษฐกิจ',
    weightBasisTh: 'ถ่วงน้ำหนักประชากรอำเภอ',
    formulaSummaryTh: '0.60 M2 + 0.40 UpperCVaR(20%)',
    rationaleTh: 'ประเมินมูลค่าความเสียหายที่อาจเกิดขึ้นในอำเภอศูนย์กลางโดยไม่ถูกอำเภอขนาดเล็กเฉลี่ยทอน',
    membersTh: 'ตัวชี้วัดความล่อแหลมทั้ง 4 ด้าน',
  },
  {
    id: 'P5',
    nameTh: 'ความเปราะบาง (V)',
    distributionTh: 'ความเปราะบางมักกระจุกตัวในอำเภอห่างไกลและพื้นที่ชนบท',
    weightBasisTh: 'รากที่สองของประชากร (ลดอิทธิพลเขตเมืองกลบชนบท)',
    formulaSummaryTh: '0.60 M1.5 + 0.40 UpperCVaR(20%)',
    rationaleTh: 'ป้องกันไม่ให้อำเภอเมืองที่มีประชากรมากกลบสัดส่วนกลุ่มเปราะบางในอำเภอห่างไกล',
    membersTh: 'ตัวชี้วัดความเปราะบางทั้ง 4 ด้าน',
  },
  {
    id: 'P6a',
    nameTh: 'ศักยภาพเฉพาะถิ่น (ถ่ายโอนไม่ได้)',
    distributionTh: 'ต้องพร้อมในพื้นที่โดยตรง หากบางอำเภอยังขาดความพร้อมจะกระทบภาพรวมทันที',
    weightBasisTh: 'รากที่สองของประชากร',
    formulaSummaryTh: '0.50 Harmonic(M-1) + 0.30 LowerCVaR(20%) + 0.20 Min',
    rationaleTh: 'ระบบแจ้งเตือนและทักษะชุมชนไม่สามารถทดแทนด้วยกำลังจากอำเภออื่นได้ จึงเน้นตรวจจับอำเภอที่ควรเร่งเสริมความพร้อม',
    membersTh: 'การเข้าถึง Cell Broadcast, การฝึกอบรม ปภ./อปพร.',
  },
  {
    id: 'P6b',
    nameTh: 'ศักยภาพส่วนกลาง (เคลื่อนย้ายสนับสนุนได้)',
    distributionTh: 'ทรัพยากรระดับจังหวัดที่ระดมช่วยเหลือข้ามอำเภอได้',
    weightBasisTh: 'ถ่วงน้ำหนักประชากรอำเภอ',
    formulaSummaryTh: '0.75 M1 + 0.25 LowerCVaR(20%)',
    rationaleTh: 'คำนวณจากทรัพยากรรวมจังหวัดที่ส่งกำลังไปช่วยได้ พร้อมหักเผื่อข้อจำกัดระยะทางไปยังอำเภอห่างไกล',
    membersTh: 'การแพทย์ฉุกเฉิน 1669, ศูนย์ EOC/เครื่องจักรกล, แผน อปท. และงบฉุกเฉิน',
  },
];

export const HAZARD_AGGREGATION_PROFILE: Readonly<Record<HazardId, AggregationProfileId>> = {
  landslide: 'P1',
  toxic_pollution: 'P1',
  earthquake: 'P1',
  tsunami_coastal: 'P1',
  flood: 'P2',
  windstorm: 'P2',
  pm25_wildfire: 'P3',
  drought: 'P3',
  heatwave: 'P3',
  epidemic: 'P3',
};

export const CAPACITY_AGGREGATION_PROFILE: Readonly<Record<CapacityIndicatorId, AggregationProfileId>> = {
  c_cell_broadcast: 'P6a',
  c_ddpm_training: 'P6a',
  c_medical_ems: 'P6b',
  c_eoc_machinery: 'P6b',
  c_local_plan_budget: 'P6b',
};

export function getAggregationProfileForSubIndicator(id: SubIndicatorId): AggregationProfileId {
  if (id.startsWith('e_')) return 'P4';
  if (id.startsWith('v_')) return 'P5';
  return CAPACITY_AGGREGATION_PROFILE[id as CapacityIndicatorId] ?? 'P6b';
}

export interface WeightedValue {
  readonly score: number;
  readonly weight: number;
}

function normalizeWeights(items: readonly WeightedValue[]): Array<{ score: number; w: number }> {
  const safe = items.map((item) => ({
    score: clampScore(item.score),
    weight: Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1,
  }));
  const total = safe.reduce((acc, item) => acc + item.weight, 0) || 1;
  return safe.map((item) => ({ score: item.score, w: item.weight / total }));
}

/**
 * Weighted Generalized Power Mean: M_p(x, w) = (sum w_i * x_i^p)^(1/p)
 * รองรับทั้ง p > 0 (เน้นหางบน), p = 1 (Arithmetic), p = 0 (Geometric) และ p < 0 (Harmonic / เน้นหางล่าง)
 * เป็นฟังก์ชัน Strict Monotonic และคงค่าอยู่ในช่วง [1.00, 5.00] เสมอ
 */
export function weightedPowerMean(items: readonly WeightedValue[], p: number): number {
  if (items.length === 0) return 1.0;
  const norm = normalizeWeights(items);
  if (Math.abs(p) < 1e-6) {
    const logSum = norm.reduce((acc, item) => acc + item.w * Math.log(item.score), 0);
    return clampScore(Math.exp(logSum));
  }
  const sum = norm.reduce((acc, item) => acc + item.w * Math.pow(item.score, p), 0);
  return clampScore(Math.pow(sum, 1 / p));
}

/**
 * Weighted Conditional Value at Risk (Upper/Lower alpha-tail Mean)
 * คำนวณค่าเฉลี่ยถ่วงน้ำหนักแบบต่อเนื่องของกลุ่มมวลบนสุดหรือล่างสุด alpha (เช่น 0.20 = 20%)
 * Coherent, Strict Monotonic และ Scale-Invariant ตั้งแต่ 3 อำเภอ (ภูเก็ต) จนถึง 50 เขต (กทม.)
 */
export function weightedTailCvar(
  items: readonly WeightedValue[],
  alpha: number,
  side: 'upper' | 'lower',
): number {
  if (items.length === 0) return 1.0;
  const norm = normalizeWeights(items);
  const sorted = [...norm].sort((a, b) =>
    side === 'upper' ? b.score - a.score : a.score - b.score,
  );
  const targetMass = Math.min(1, Math.max(1e-6, alpha));
  let remaining = targetMass;
  let weightedSum = 0;

  for (const item of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(item.w, remaining);
    weightedSum += take * item.score;
    remaining -= take;
  }

  return clampScore(weightedSum / targetMass);
}

/**
 * Weighted Quantile (สำหรับคำนวณ Weighted IQR = Q3 - Q1 ในดัชนีการกระจายตัว)
 */
export function weightedQuantile(items: readonly WeightedValue[], q: number): number {
  if (items.length === 0) return 1.0;
  const norm = normalizeWeights(items);
  const sorted = [...norm].sort((a, b) => a.score - b.score);
  const target = Math.min(1, Math.max(0, q));
  let cum = 0;
  for (const item of sorted) {
    cum += item.w;
    if (cum >= target - 1e-9) {
      return item.score;
    }
  }
  return sorted[sorted.length - 1].score;
}

/**
 * ฟังก์ชันรวมคะแนนระดับอำเภอสู่จังหวัดตามโปรไฟล์ทั้ง 7 (P1 - P6b)
 */
export function aggregateByProfile(
  items: readonly WeightedValue[],
  profile: AggregationProfileId,
): number {
  if (items.length === 0) return 1.0;

  // ปรับฐานน้ำหนักตามมติเอกฉันท์ของแต่ละโปรไฟล์
  const weightedForProfile: WeightedValue[] = items.map((item) => {
    const baseW = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    if (profile === 'P1') return { score: item.score, weight: 1 }; // น้ำหนักเท่ากันเพื่อไม่ให้เขตเมืองกลบอำเภอเฉพาะจุด
    if (profile === 'P5' || profile === 'P6a') {
      return { score: item.score, weight: Math.sqrt(baseW) }; // รากประชากร ต้าน Urban Masking
    }
    return { score: item.score, weight: baseW };
  });

  let maxVal = 1.0;
  let minVal = 5.0;
  for (const it of weightedForProfile) {
    const s = clampScore(it.score);
    if (s > maxVal) maxVal = s;
    if (s < minVal) minVal = s;
  }

  let result: number;
  switch (profile) {
    case 'P1': {
      // ภัยเฉพาะจุดรุนแรง: 0.35 M_3 + 0.35 UpperCVaR_20 + 0.30 Max
      const m3 = weightedPowerMean(weightedForProfile, 3);
      const u20 = weightedTailCvar(weightedForProfile, 0.2, 'upper');
      result = 0.35 * m3 + 0.35 * u20 + 0.3 * maxVal;
      break;
    }
    case 'P2': {
      // ภัยแนวลุ่มน้ำและพายุ: 0.55 M_2 + 0.45 UpperCVaR_20
      const m2 = weightedPowerMean(weightedForProfile, 2);
      const u20 = weightedTailCvar(weightedForProfile, 0.2, 'upper');
      result = 0.55 * m2 + 0.45 * u20;
      break;
    }
    case 'P3': {
      // ภัยแผ่กว้าง: 0.75 M_1.5 + 0.25 UpperCVaR_20
      const m15 = weightedPowerMean(weightedForProfile, 1.5);
      const u20 = weightedTailCvar(weightedForProfile, 0.2, 'upper');
      result = 0.75 * m15 + 0.25 * u20;
      break;
    }
    case 'P4': {
      // ความล่อแหลม (E): 0.60 M_2 + 0.40 UpperCVaR_20
      const m2 = weightedPowerMean(weightedForProfile, 2);
      const u20 = weightedTailCvar(weightedForProfile, 0.2, 'upper');
      result = 0.6 * m2 + 0.4 * u20;
      break;
    }
    case 'P5': {
      // ความเปราะบาง (V): 0.60 M_1.5 + 0.40 UpperCVaR_20 (ฐานรากประชากร)
      const m15 = weightedPowerMean(weightedForProfile, 1.5);
      const u20 = weightedTailCvar(weightedForProfile, 0.2, 'upper');
      result = 0.6 * m15 + 0.4 * u20;
      break;
    }
    case 'P6a': {
      // ศักยภาพเฉพาะถิ่น (ถ่ายโอนไม่ได้): 0.50 M_-1 (Harmonic) + 0.30 LowerCVaR_20 + 0.20 Min
      const mNeg1 = weightedPowerMean(weightedForProfile, -1);
      const l20 = weightedTailCvar(weightedForProfile, 0.2, 'lower');
      result = 0.5 * mNeg1 + 0.3 * l20 + 0.2 * minVal;
      break;
    }
    case 'P6b': {
      // ศักยภาพส่วนกลาง (เคลื่อนย้ายได้): 0.75 M_1 + 0.25 LowerCVaR_20
      const m1 = weightedPowerMean(weightedForProfile, 1);
      const l20 = weightedTailCvar(weightedForProfile, 0.2, 'lower');
      result = 0.75 * m1 + 0.25 * l20;
      break;
    }
  }

  return round2(clampScore(result));
}

// ฟังก์ชันสะดวกใช้งานเฉพาะกลุ่ม (Backward-compatible helpers)
export function rollupHazardFromDistricts(
  values: readonly WeightedValue[],
  hazardId: HazardId = 'flood',
): number {
  return aggregateByProfile(values, HAZARD_AGGREGATION_PROFILE[hazardId]);
}

export function rollupExposureFromDistricts(values: readonly WeightedValue[]): number {
  return aggregateByProfile(values, 'P4');
}

export function rollupVulnerabilityFromDistricts(values: readonly WeightedValue[]): number {
  return aggregateByProfile(values, 'P5');
}

export function rollupCapacityFromDistricts(
  values: readonly WeightedValue[],
  indicatorId: CapacityIndicatorId = 'c_cell_broadcast',
): number {
  return aggregateByProfile(values, CAPACITY_AGGREGATION_PROFILE[indicatorId]);
}

/**
 * แปลงคะแนนระดับอำเภอ 1 อำเภอ เป็นโครงสร้าง ProvinceRiskRecord ชั่วคราวเพื่อคำนวณ HEVC ด้วย Engine เดียวกัน 100%
 */
export function districtMetricsToRecord(
  district: DistrictMeta,
  provinceBase: ProvinceRiskRecord,
  metrics: DistrictMetricsPayload,
): ProvinceRiskRecord {
  const hazards = {} as Record<HazardId, HazardScoreEntry>;
  for (const hId of HAZARD_IDS) {
    const raw = metrics.hazards[hId];
    if (hId === 'tsunami_coastal' && provinceBase.coastalZone === 'inland') {
      hazards[hId] = { score: null, applicable: false };
    } else if (raw === null || !Number.isFinite(raw)) {
      hazards[hId] = { score: null, applicable: false };
    } else {
      hazards[hId] = { score: round2(clampScore(raw)), applicable: true };
    }
  }

  return {
    ...provinceBase,
    nameTh: district.fullNameTh,
    nameEn: district.nameEn,
    hazards,
    exposureIndicators: { ...metrics.exposureIndicators },
    vulnerabilityIndicators: { ...metrics.vulnerabilityIndicators },
    capacityIndicators: { ...metrics.capacityIndicators },
  };
}

export function evaluateDistrictMetrics(
  district: DistrictMeta,
  provinceBase: ProvinceRiskRecord,
  periodId: string,
  version: number,
  metrics: DistrictMetricsPayload,
  updatedBy: string,
  updatedAt: string,
  previousMetrics?: DistrictMetricsPayload | null,
): DistrictEvaluation {
  const rec = districtMetricsToRecord(district, provinceBase, metrics);
  const bd = computeProvinceHevc(rec, 'composite');
  const ddpmScore = bd.ddpmScore ?? 1.0;

  let previousDdpmScore: number | null = null;
  let deltaFromPrevious: number | null = null;
  if (previousMetrics) {
    const prevRec = districtMetricsToRecord(district, provinceBase, previousMetrics);
    const prevBd = computeProvinceHevc(prevRec, 'composite');
    previousDdpmScore = prevBd.ddpmScore ?? 1.0;
    deltaFromPrevious = round2(ddpmScore - previousDdpmScore);
  }

  return {
    district,
    periodId,
    version,
    metrics,
    hazardCompositeScore: bd.hazardCompositeScore,
    exposureScore: bd.exposureScore,
    vulnerabilityScore: bd.vulnerabilityScore,
    capacityScore: bd.effectiveCapacityScore,
    ddpmScore,
    ddpmLevel: scoreToRiskLevel(ddpmScore),
    dominantHazardId: bd.dominantHazardId,
    previousDdpmScore,
    deltaFromPrevious,
    updatedBy,
    updatedAt,
  };
}

/**
 * คำนวณดัชนีการกระจายตัวและจุดเฝ้าระวังระดับอำเภอในจังหวัด (ป้องกันตัวเลขเดียวหลอกตา)
 */
export function computeProvinceDistrictDiagnostics(
  provinceBase: ProvinceRiskRecord,
  districtRows: ReadonlyArray<{ district: DistrictMeta; metrics: DistrictMetricsPayload }>,
): ProvinceDistrictDiagnostics | undefined {
  if (districtRows.length === 0) return undefined;

  const riskItems: Array<{ district: DistrictMeta; score: number; weight: number }> = [];
  const capItems: Array<{ district: DistrictMeta; score: number; weight: number }> = [];

  for (const row of districtRows) {
    const rec = districtMetricsToRecord(row.district, provinceBase, row.metrics);
    const bd = computeProvinceHevc(rec, 'composite');
    const rScore = bd.ddpmScore ?? 1.0;
    riskItems.push({ district: row.district, score: rScore, weight: row.district.popWeight });
    capItems.push({
      district: row.district,
      score: bd.effectiveCapacityScore,
      weight: row.district.popWeight,
    });
  }

  const sortedRisk = [...riskItems].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.district.code.localeCompare(b.district.code),
  );
  const sortedCap = [...capItems].sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.district.code.localeCompare(b.district.code),
  );

  const highestRisk = sortedRisk[0];
  const lowestRisk = sortedRisk[sortedRisk.length - 1];
  const lowestCap = sortedCap[0];
  const highestCap = sortedCap[sortedCap.length - 1];

  const riskMean = round2(weightedPowerMean(riskItems, 1));
  const capMean = round2(weightedPowerMean(capItems, 1));
  const q1 = weightedQuantile(riskItems, 0.25);
  const q3 = weightedQuantile(riskItems, 0.75);
  const riskSpread = round2(Math.max(0, highestRisk.score - riskMean));
  const capacityGap = round2(Math.max(0, capMean - lowestCap.score));

  const highRiskDistrictCount = riskItems.filter((x) => x.score >= 3.4).length;
  const criticalRiskDistrictCount = riskItems.filter((x) => x.score >= 4.2).length;
  const priorityCapacityDistrictCount = capItems.filter((x) => x.score < 2.6).length;

  return {
    districtCount: districtRows.length,
    riskMin: round2(lowestRisk.score),
    riskMax: round2(highestRisk.score),
    riskMean,
    riskSpread,
    weightedIqr: round2(Math.max(0, q3 - q1)),
    highestRiskDistrict: {
      code: highestRisk.district.code,
      fullNameTh: highestRisk.district.fullNameTh,
      score: round2(highestRisk.score),
      level: scoreToRiskLevel(highestRisk.score),
    },
    highRiskDistrictCount,
    criticalRiskDistrictCount,
    capacityMin: round2(lowestCap.score),
    capacityMax: round2(highestCap.score),
    capacityMean: capMean,
    capacityGap,
    priorityCapacityDistrict: {
      code: lowestCap.district.code,
      fullNameTh: lowestCap.district.fullNameTh,
      score: round2(lowestCap.score),
      level: scoreToRiskLevel(lowestCap.score),
    },
    priorityCapacityDistrictCount,
    hasRiskHotspotAlert: riskSpread >= 1.2 || highestRisk.score >= 4.2,
    hasCapacityGapAlert: capacityGap >= 1.2 || lowestCap.score <= 1.79,
  };
}

/**
 * รวมคะแนนทุกอำเภอในจังหวัดขึ้นเป็น ProvinceRiskRecord ของงวดเวลานั้น
 * ใช้ระบบ 6 กลุ่ม (7 โปรไฟล์ P1 - P6b) ตามลักษณะการกระจายตัวของข้อมูล + Active-District Masking สำหรับสึนามิ
 */
export function aggregateDistrictsToProvince(
  provinceBase: ProvinceRiskRecord,
  districtRows: ReadonlyArray<{ district: DistrictMeta; metrics: DistrictMetricsPayload }>,
): ProvinceRiskRecord {
  if (districtRows.length === 0) return provinceBase;

  const hazards = {} as Record<HazardId, HazardScoreEntry>;
  const coastalDistrictRows = districtRows.filter((r) => r.district.geoClass === 'coastal');

  for (const hDef of HAZARD_CATALOG) {
    if (hDef.id === 'tsunami_coastal' && provinceBase.coastalZone === 'inland') {
      hazards[hDef.id] = { score: null, applicable: false };
      continue;
    }

    // Active-District Masking: สำหรับสึนามิในจังหวัดชายฝั่ง ใช้เฉพาะอำเภอที่มีพื้นที่ติดทะเลจริง (หากมีแท็ก coastal)
    const candidateRows =
      hDef.id === 'tsunami_coastal' && coastalDistrictRows.length > 0
        ? coastalDistrictRows
        : districtRows;

    const applicableVals: WeightedValue[] = [];
    for (const row of candidateRows) {
      const val = row.metrics.hazards[hDef.id];
      if (val !== null && Number.isFinite(val)) {
        applicableVals.push({ score: val, weight: row.district.popWeight });
      }
    }
    if (applicableVals.length === 0) {
      hazards[hDef.id] = { score: null, applicable: false };
    } else {
      hazards[hDef.id] = {
        score: rollupHazardFromDistricts(applicableVals, hDef.id),
        applicable: true,
      };
    }
  }

  const exposureIndicators = {} as Record<ExposureIndicatorId, number>;
  for (const ind of EXPOSURE_INDICATORS) {
    exposureIndicators[ind.id] = rollupExposureFromDistricts(
      districtRows.map((r) => ({
        score: r.metrics.exposureIndicators[ind.id],
        weight: r.district.popWeight,
      })),
    );
  }

  const vulnerabilityIndicators = {} as Record<VulnerabilityIndicatorId, number>;
  for (const ind of VULNERABILITY_INDICATORS) {
    vulnerabilityIndicators[ind.id] = rollupVulnerabilityFromDistricts(
      districtRows.map((r) => ({
        score: r.metrics.vulnerabilityIndicators[ind.id],
        weight: r.district.popWeight,
      })),
    );
  }

  const capacityIndicators = {} as Record<CapacityIndicatorId, number>;
  for (const ind of CAPACITY_INDICATORS) {
    capacityIndicators[ind.id] = rollupCapacityFromDistricts(
      districtRows.map((r) => ({
        score: r.metrics.capacityIndicators[ind.id],
        weight: r.district.popWeight,
      })),
      ind.id,
    );
  }

  const districtDiagnostics = computeProvinceDistrictDiagnostics(provinceBase, districtRows);

  return {
    ...provinceBase,
    hazards,
    exposureIndicators,
    vulnerabilityIndicators,
    capacityIndicators,
    districtDiagnostics,
  };
}

// ==================== Deterministic Geographic Seed + Bisection Calibration ====================

function deterministicNoise(seedKey: string): number {
  let h = 2166136261;
  for (let i = 0; i < seedKey.length; i += 1) {
    h ^= seedKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function geoOffsetForMetric(
  geoClass: DistrictGeoClass,
  group: 'H' | 'E' | 'V' | 'C',
  metricId: string,
): number {
  if (group === 'E') {
    if (geoClass === 'metro') return 0.55;
    if (geoClass === 'coastal') return 0.18;
    if (geoClass === 'river_basin') return 0.10;
    if (geoClass === 'mountain') return -0.35;
    return -0.22;
  }
  if (group === 'V') {
    if (geoClass === 'metro') return -0.32;
    if (geoClass === 'mountain') return 0.42;
    if (geoClass === 'rural') return 0.22;
    if (geoClass === 'river_basin') return 0.10;
    return 0.0;
  }
  if (group === 'C') {
    if (geoClass === 'metro') return 0.48;
    if (geoClass === 'coastal') return 0.10;
    if (geoClass === 'mountain') return -0.38;
    if (geoClass === 'rural') return -0.18;
    return -0.05;
  }
  if (metricId === 'flood') {
    if (geoClass === 'river_basin') return 0.36;
    if (geoClass === 'metro') return 0.15;
    if (geoClass === 'mountain') return -0.22;
    return 0.0;
  }
  if (metricId === 'landslide' || metricId === 'pm25_wildfire' || metricId === 'earthquake') {
    if (geoClass === 'mountain') return 0.42;
    if (geoClass === 'metro') return -0.18;
    return 0.0;
  }
  if (metricId === 'toxic_pollution' || metricId === 'heatwave' || metricId === 'epidemic') {
    if (geoClass === 'metro') return 0.36;
    if (geoClass === 'mountain') return -0.28;
    return -0.08;
  }
  if (metricId === 'tsunami_coastal' || metricId === 'windstorm') {
    if (geoClass === 'coastal') return 0.40;
    if (geoClass === 'mountain') return -0.25;
    return 0.0;
  }
  if (metricId === 'drought') {
    if (geoClass === 'rural') return 0.28;
    if (geoClass === 'metro') return -0.25;
    return 0.0;
  }
  return 0.0;
}

/**
 * ปรับจูนค่าฐานรายอำเภอด้วย Bisection 14 รอบ เพื่อให้เมื่อรวมด้วยระบบ 7 โปรไฟล์แล้วตรงฐาน 77 จังหวัด (< 0.01)
 */
function calibrateVector(
  rawValues: readonly number[],
  weights: readonly number[],
  target: number,
  aggregator: (items: readonly WeightedValue[]) => number,
  activeMask?: readonly boolean[],
): number[] {
  let lo = -3.0;
  let hi = 3.0;
  let bestDelta = 0;

  for (let iter = 0; iter < 14; iter += 1) {
    const mid = (lo + hi) / 2;
    const candidate: WeightedValue[] = [];
    for (let idx = 0; idx < rawValues.length; idx += 1) {
      if (activeMask && !activeMask[idx]) continue;
      candidate.push({
        score: clampScore(rawValues[idx] + mid),
        weight: weights[idx],
      });
    }
    const agg = aggregator(candidate);
    bestDelta = mid;
    if (agg < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return rawValues.map((v) => round2(clampScore(v + bestDelta)));
}

export function generateProvinceDistrictBaseline(
  province: ProvinceRiskRecord,
  districts: readonly DistrictMeta[],
): Map<string, DistrictMetricsPayload> {
  const weights = districts.map((d) => d.popWeight);
  const coastalMask = districts.map((d) => d.geoClass === 'coastal');
  const hasCoastalDistrict = coastalMask.some(Boolean);
  const hazardMatrix: Record<HazardId, (number | null)[]> = {} as Record<HazardId, (number | null)[]>;

  for (const hDef of HAZARD_CATALOG) {
    const entry = province.hazards[hDef.id];
    if (!entry.applicable || entry.score === null) {
      hazardMatrix[hDef.id] = districts.map(() => null);
    } else {
      const target = entry.score;
      const rawVals = districts.map((d) => {
        const offset = geoOffsetForMetric(d.geoClass, 'H', hDef.id);
        const jitter = deterministicNoise(`H:${d.code}:${hDef.id}`) * 0.16;
        return clampScore(target + offset + jitter);
      });
      const mask = hDef.id === 'tsunami_coastal' && hasCoastalDistrict ? coastalMask : undefined;
      hazardMatrix[hDef.id] = calibrateVector(
        rawVals,
        weights,
        target,
        (items) => rollupHazardFromDistricts(items, hDef.id),
        mask,
      );
    }
  }

  const eMatrix = {} as Record<ExposureIndicatorId, number[]>;
  for (const ind of EXPOSURE_INDICATORS) {
    const target = province.exposureIndicators[ind.id];
    const rawVals = districts.map((d) => {
      const offset = geoOffsetForMetric(d.geoClass, 'E', ind.id);
      const jitter = deterministicNoise(`E:${d.code}:${ind.id}`) * 0.14;
      return clampScore(target + offset + jitter);
    });
    eMatrix[ind.id] = calibrateVector(rawVals, weights, target, rollupExposureFromDistricts);
  }

  const vMatrix = {} as Record<VulnerabilityIndicatorId, number[]>;
  for (const ind of VULNERABILITY_INDICATORS) {
    const target = province.vulnerabilityIndicators[ind.id];
    const rawVals = districts.map((d) => {
      const offset = geoOffsetForMetric(d.geoClass, 'V', ind.id);
      const jitter = deterministicNoise(`V:${d.code}:${ind.id}`) * 0.14;
      return clampScore(target + offset + jitter);
    });
    vMatrix[ind.id] = calibrateVector(rawVals, weights, target, rollupVulnerabilityFromDistricts);
  }

  const cMatrix = {} as Record<CapacityIndicatorId, number[]>;
  for (const ind of CAPACITY_INDICATORS) {
    const target = province.capacityIndicators[ind.id];
    const rawVals = districts.map((d) => {
      const offset = geoOffsetForMetric(d.geoClass, 'C', ind.id);
      const jitter = deterministicNoise(`C:${d.code}:${ind.id}`) * 0.14;
      return clampScore(target + offset + jitter);
    });
    cMatrix[ind.id] = calibrateVector(rawVals, weights, target, (items) =>
      rollupCapacityFromDistricts(items, ind.id),
    );
  }

  const result = new Map<string, DistrictMetricsPayload>();
  districts.forEach((d, idx) => {
    const hazards = {} as Record<HazardId, number | null>;
    for (const hId of HAZARD_IDS) {
      hazards[hId] = hazardMatrix[hId][idx];
    }
    const exposureIndicators = {} as Record<ExposureIndicatorId, number>;
    for (const ind of EXPOSURE_INDICATORS) {
      exposureIndicators[ind.id] = eMatrix[ind.id][idx];
    }
    const vulnerabilityIndicators = {} as Record<VulnerabilityIndicatorId, number>;
    for (const ind of VULNERABILITY_INDICATORS) {
      vulnerabilityIndicators[ind.id] = vMatrix[ind.id][idx];
    }
    const capacityIndicators = {} as Record<CapacityIndicatorId, number>;
    for (const ind of CAPACITY_INDICATORS) {
      capacityIndicators[ind.id] = cMatrix[ind.id][idx];
    }
    result.set(d.code, {
      hazards,
      exposureIndicators,
      vulnerabilityIndicators,
      capacityIndicators,
    });
  });

  return result;
}

/**
 * สร้างค่าจำลองย้อนหลังตามฤดูกาลและพัฒนาการศักยภาพ ปภ. สำหรับ 4 ไตรมาส (2568-Q4 -> 2569-Q3)
 */
export function deriveHistoricalPeriodMetrics(
  currentMetrics: DistrictMetricsPayload,
  provinceRegion: ProvinceRiskRecord['region6'],
  periodId: string,
): DistrictMetricsPayload {
  if (periodId === '2569-Q3') return currentMetrics;

  const h = { ...currentMetrics.hazards };
  const e = { ...currentMetrics.exposureIndicators };
  const v = { ...currentMetrics.vulnerabilityIndicators };
  const c = { ...currentMetrics.capacityIndicators };

  const adjust = (val: number | null, delta: number): number | null =>
    val === null ? null : round2(clampScore(val + delta));
  const adjustNum = (val: number, delta: number): number => round2(clampScore(val + delta));

  if (periodId === '2568-Q4') {
    h.flood = adjust(h.flood, provinceRegion === 'south' ? 0.35 : -0.10);
    h.pm25_wildfire = adjust(h.pm25_wildfire, -0.15);
    h.heatwave = adjust(h.heatwave, -0.35);
    c.c_cell_broadcast = adjustNum(c.c_cell_broadcast, -0.65);
    c.c_ddpm_training = adjustNum(c.c_ddpm_training, -0.35);
    c.c_eoc_machinery = adjustNum(c.c_eoc_machinery, -0.20);
    c.c_local_plan_budget = adjustNum(c.c_local_plan_budget, -0.18);
  } else if (periodId === '2569-Q1') {
    h.pm25_wildfire = adjust(h.pm25_wildfire, provinceRegion === 'north' ? 0.38 : 0.16);
    h.drought = adjust(h.drought, provinceRegion === 'northeast' ? 0.30 : 0.15);
    h.flood = adjust(h.flood, -0.35);
    c.c_cell_broadcast = adjustNum(c.c_cell_broadcast, -0.40);
    c.c_ddpm_training = adjustNum(c.c_ddpm_training, -0.22);
    c.c_eoc_machinery = adjustNum(c.c_eoc_machinery, -0.10);
  } else if (periodId === '2569-Q2') {
    h.heatwave = adjust(h.heatwave, 0.32);
    h.windstorm = adjust(h.windstorm, 0.28);
    h.flood = adjust(h.flood, -0.18);
    c.c_cell_broadcast = adjustNum(c.c_cell_broadcast, -0.18);
    c.c_ddpm_training = adjustNum(c.c_ddpm_training, -0.10);
  }

  return {
    hazards: h,
    exposureIndicators: e,
    vulnerabilityIndicators: v,
    capacityIndicators: c,
  };
}
