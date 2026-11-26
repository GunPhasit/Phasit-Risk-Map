import { HAZARD_BY_ID, HAZARD_CATALOG } from '../data/hazardCatalog.ts';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../data/indicatorCatalog.ts';
import { CAPACITY_LEVEL_STYLES, RISK_LEVEL_STYLES } from '../data/riskPalette.ts';
import type {
  CapacityIndicatorId,
  CapacityOverrides,
  CompositeMode,
  HazardId,
  HevcBreakdown,
  LayerSelection,
  MapDimension,
  ProvinceEvaluation,
  ProvinceRiskRecord,
  RiskLevel,
  SubIndicatorId,
} from '../types/risk';

/**
 * ค่าคงที่แบบจำลองความเสี่ยงตามแผน ปภ. แห่งชาติ พ.ศ. 2564-2570
 * R_ddpm = H^0.40 * E^0.20 * V^0.20 * (6 - C)^0.20 พร้อม Safety Guardrail
 */
export const ENGINE_CONSTANTS = {
  // ค่าน้ำหนัก 4 ปัจจัยหลักตามมติเอกฉันท์ (รวม = 1.00)
  weightH: 0.40,
  weightE: 0.20,
  weightV: 0.20,
  weightC: 0.20,
  // ค่าน้ำหนักสำหรับ R_gross ก่อนหักลดด้วยศักยภาพ C (รวม = 1.00)
  grossWeightH: 0.50,
  grossWeightE: 0.25,
  grossWeightV: 0.25,
  // พารามิเตอร์รวม 10 สาธารณภัยเป็น H_composite (Hybrid Power Mean)
  powerP: 3,
  alpha: 0.55,
  highHazardThreshold: 3.4,
  compoundStep: 0.06,
  compoundMaxBonus: 0.24,
  hazardFloorExtremeThreshold: 4.6,
  hazardFloorExtremeValue: 4.2,
  hazardFloorLevel5Threshold: 4.2,
  hazardFloorLevel5Value: 3.8,
  hazardFloorLevel4Threshold: 3.4,
  hazardFloorLevel4Value: 3.0,
  // Safety Guardrail สำหรับ R สุทธิ: ป้องกันไม่ให้ C กลบภัยวิกฤตจนตกเป็นสีน้ำเงิน/เขียว
  ddpmGuardrailExtremeH: 4.6,
  ddpmGuardrailExtremeBase: 3.4,
  ddpmGuardrailExtremeSlope: 0.5,
  ddpmGuardrailHighH: 3.8,
  ddpmGuardrailHighFloor: 2.6,
} as const;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 1.0;
  return Math.min(5.0, Math.max(1.0, value));
}

/**
 * แปลงคะแนน (1.00 - 5.00) เป็นระดับ 1 - 5
 * ปัดเศษทศนิยม 2 ตำแหน่งก่อนเทียบเกณฑ์ช่วงกึ่งเปิดเพื่อป้องกันรอยต่อทับซ้อน
 */
export function scoreToRiskLevel(rawScore: number): RiskLevel {
  const s = round2(clampScore(rawScore));
  if (s < 1.8) return 1;
  if (s < 2.6) return 2;
  if (s < 3.4) return 3;
  if (s < 4.2) return 4;
  return 5;
}

export function computeHazardSafetyFloor(maxHazardScore: number): number {
  if (maxHazardScore >= ENGINE_CONSTANTS.hazardFloorExtremeThreshold) {
    return ENGINE_CONSTANTS.hazardFloorExtremeValue;
  }
  if (maxHazardScore >= ENGINE_CONSTANTS.hazardFloorLevel5Threshold) {
    return ENGINE_CONSTANTS.hazardFloorLevel5Value;
  }
  if (maxHazardScore >= ENGINE_CONSTANTS.hazardFloorLevel4Threshold) {
    return ENGINE_CONSTANTS.hazardFloorLevel4Value;
  }
  return 1.0;
}

export function computeDdpmGuardrail(hazardScore: number): number {
  const h = round2(clampScore(hazardScore));
  if (h >= ENGINE_CONSTANTS.ddpmGuardrailExtremeH) {
    return round2(
      ENGINE_CONSTANTS.ddpmGuardrailExtremeBase +
        ENGINE_CONSTANTS.ddpmGuardrailExtremeSlope * (h - ENGINE_CONSTANTS.ddpmGuardrailExtremeH),
    );
  }
  if (h >= ENGINE_CONSTANTS.ddpmGuardrailHighH) {
    return ENGINE_CONSTANTS.ddpmGuardrailHighFloor;
  }
  return 1.0;
}

/**
 * สูตรความเสี่ยงสุทธิ แผน ปภ. ชาติ พ.ศ. 2564-2570 แบบสมมาตรบนสเกล [1.00, 5.00]
 * R_ddpm = H^0.40 * E^0.20 * V^0.20 * (6 - C)^0.20
 * ที่ค่ากลาง H = E = V = C = 3.00 -> R_ddpm = 3.00 พอดี
 */
export function computeDdpmRiskScore(
  H: number,
  E: number,
  V: number,
  C: number,
): { rawScore: number; finalScore: number; guardrailApplied: boolean; guardrailFloor: number } {
  const h = clampScore(H);
  const e = clampScore(E);
  const v = clampScore(V);
  const c = clampScore(C);
  const capacityGap = clampScore(6.0 - c);

  const raw =
    Math.pow(h, ENGINE_CONSTANTS.weightH) *
    Math.pow(e, ENGINE_CONSTANTS.weightE) *
    Math.pow(v, ENGINE_CONSTANTS.weightV) *
    Math.pow(capacityGap, ENGINE_CONSTANTS.weightC);

  const guardrailFloor = computeDdpmGuardrail(h);
  const guardrailApplied = guardrailFloor > raw && guardrailFloor > 1.0;
  const finalScore = round2(clampScore(Math.max(raw, guardrailFloor)));

  return {
    rawScore: round2(clampScore(raw)),
    finalScore,
    guardrailApplied,
    guardrailFloor,
  };
}

export function computeGrossRiskScore(H: number, E: number, V: number): number {
  const h = clampScore(H);
  const e = clampScore(E);
  const v = clampScore(V);
  return round2(
    clampScore(
      Math.pow(h, ENGINE_CONSTANTS.grossWeightH) *
        Math.pow(e, ENGINE_CONSTANTS.grossWeightE) *
        Math.pow(v, ENGINE_CONSTANTS.grossWeightV),
    ),
  );
}

export function computePillarScores(
  province: ProvinceRiskRecord,
  capacityOverrides?: CapacityOverrides,
): {
  exposureScore: number;
  vulnerabilityScore: number;
  baseCapacityScore: number;
  effectiveCapacityScore: number;
  effectiveCapacityIndicators: Record<CapacityIndicatorId, number>;
  isSimulated: boolean;
} {
  const exposureScore = round2(
    clampScore(
      EXPOSURE_INDICATORS.reduce(
        (sum, ind) => sum + ind.weight * clampScore(province.exposureIndicators[ind.id]),
        0,
      ),
    ),
  );

  const vulnerabilityScore = round2(
    clampScore(
      VULNERABILITY_INDICATORS.reduce(
        (sum, ind) => sum + ind.weight * clampScore(province.vulnerabilityIndicators[ind.id]),
        0,
      ),
    ),
  );

  const baseCapacityScore = round2(
    clampScore(
      CAPACITY_INDICATORS.reduce(
        (sum, ind) => sum + ind.weight * clampScore(province.capacityIndicators[ind.id]),
        0,
      ),
    ),
  );

  const effectiveCapacityIndicators = { ...province.capacityIndicators };
  let isSimulated = false;
  if (capacityOverrides) {
    for (const ind of CAPACITY_INDICATORS) {
      const overrideVal = capacityOverrides[ind.id];
      if (overrideVal !== undefined && Number.isFinite(overrideVal)) {
        const clamped = round2(clampScore(overrideVal));
        effectiveCapacityIndicators[ind.id] = clamped;
        if (Math.abs(clamped - province.capacityIndicators[ind.id]) >= 0.01) {
          isSimulated = true;
        }
      }
    }
  }

  const effectiveCapacityScore = round2(
    clampScore(
      CAPACITY_INDICATORS.reduce(
        (sum, ind) => sum + ind.weight * clampScore(effectiveCapacityIndicators[ind.id]),
        0,
      ),
    ),
  );

  return {
    exposureScore,
    vulnerabilityScore,
    baseCapacityScore,
    effectiveCapacityScore,
    effectiveCapacityIndicators,
    isSimulated,
  };
}

export function computeProvinceHevc(
  province: ProvinceRiskRecord,
  activeLayer: LayerSelection,
  capacityOverrides?: CapacityOverrides,
): HevcBreakdown {
  const applicableEntries: Array<{ id: HazardId; score: number; weight: number }> = [];

  for (const def of HAZARD_CATALOG) {
    const entry = province.hazards[def.id];
    if (entry && entry.applicable && entry.score !== null && Number.isFinite(entry.score)) {
      applicableEntries.push({
        id: def.id,
        score: clampScore(entry.score),
        weight: def.weight,
      });
    }
  }

  if (applicableEntries.length === 0) {
    throw new Error(`Province ${province.dopaCode} (${province.nameTh}) has no applicable hazards.`);
  }

  const totalWeight = applicableEntries.reduce((sum, item) => sum + item.weight, 0);
  const sortedByScore = [...applicableEntries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.id.localeCompare(b.id);
  });

  const maxHazardScore = sortedByScore[0].score;
  const dominantHazardId = sortedByScore[0].id;
  const secondaryHazardId = (sortedByScore[1] ?? sortedByScore[0]).id;

  const weightedCubedSum = applicableEntries.reduce((sum, item) => {
    const normalizedWeight = item.weight / totalWeight;
    return sum + normalizedWeight * Math.pow(item.score, ENGINE_CONSTANTS.powerP);
  }, 0);

  const powerMeanScore = Math.cbrt(weightedCubedSum);
  const blendedHazard =
    ENGINE_CONSTANTS.alpha * maxHazardScore + (1 - ENGINE_CONSTANTS.alpha) * powerMeanScore;

  const elevatedHazardIds = sortedByScore
    .filter((item) => round2(item.score) >= ENGINE_CONSTANTS.highHazardThreshold)
    .map((item) => item.id);

  const highHazardCount = elevatedHazardIds.length;
  const compoundBonus =
    highHazardCount <= 1
      ? 0
      : Math.min(
          ENGINE_CONSTANTS.compoundMaxBonus,
          ENGINE_CONSTANTS.compoundStep * (highHazardCount - 1),
        );

  const hazardFloor = computeHazardSafetyFloor(round2(maxHazardScore));
  const hazardCompositeScore = round2(
    clampScore(Math.max(blendedHazard + compoundBonus, hazardFloor)),
  );

  // H ที่ใช้คำนวณจริงตามชั้นข้อมูลที่เลือก (composite หรือ single hazard)
  let hazardActiveScore: number | null;
  if (activeLayer === 'composite') {
    hazardActiveScore = hazardCompositeScore;
  } else {
    const entry = province.hazards[activeLayer];
    hazardActiveScore =
      entry && entry.applicable && entry.score !== null ? round2(clampScore(entry.score)) : null;
  }

  const pillars = computePillarScores(province, capacityOverrides);

  let ddpmRawScore: number | null = null;
  let guardrailApplied = false;
  let guardrailFloor = 1.0;
  let baseDdpmScore: number | null = null;
  let ddpmScore: number | null = null;
  let grossRiskScore: number | null = null;
  let cImpactDelta: number | null = null;
  let simulationDeltaR = 0;
  let simulationReductionPct = 0;

  if (hazardActiveScore !== null) {
    const baseCalc = computeDdpmRiskScore(
      hazardActiveScore,
      pillars.exposureScore,
      pillars.vulnerabilityScore,
      pillars.baseCapacityScore,
    );
    const effCalc = computeDdpmRiskScore(
      hazardActiveScore,
      pillars.exposureScore,
      pillars.vulnerabilityScore,
      pillars.effectiveCapacityScore,
    );
    baseDdpmScore = baseCalc.finalScore;
    ddpmScore = effCalc.finalScore;
    ddpmRawScore = effCalc.rawScore;
    guardrailApplied = effCalc.guardrailApplied;
    guardrailFloor = effCalc.guardrailFloor;
    grossRiskScore = computeGrossRiskScore(
      hazardActiveScore,
      pillars.exposureScore,
      pillars.vulnerabilityScore,
    );
    cImpactDelta = round2(ddpmScore - grossRiskScore);
    simulationDeltaR = round2(ddpmScore - baseDdpmScore);
    simulationReductionPct =
      baseDdpmScore > 0 ? round2(((baseDdpmScore - ddpmScore) / baseDdpmScore) * 100) : 0;
  }

  return {
    hazardCompositeScore,
    hazardActiveScore,
    maxHazardScore: round2(maxHazardScore),
    powerMeanScore: round2(powerMeanScore),
    highHazardCount,
    compoundBonus: round2(compoundBonus),
    exposureScore: pillars.exposureScore,
    vulnerabilityScore: pillars.vulnerabilityScore,
    baseCapacityScore: pillars.baseCapacityScore,
    effectiveCapacityScore: pillars.effectiveCapacityScore,
    effectiveCapacityIndicators: pillars.effectiveCapacityIndicators,
    capacityGapFactor: round2(clampScore(6.0 - pillars.effectiveCapacityScore)),
    ddpmRawScore,
    guardrailApplied,
    guardrailFloor,
    baseDdpmScore,
    ddpmScore,
    grossRiskScore,
    cImpactDelta,
    simulationDeltaR,
    simulationReductionPct,
    isSimulated: pillars.isSimulated,
    applicableCount: applicableEntries.length,
    dominantHazardId,
    secondaryHazardId,
    elevatedHazardIds,
  };
}

const INDICATOR_PROSE_TH: Record<SubIndicatorId, string> = {
  e_pop_urban: 'ความหนาแน่นประชากรและพื้นที่เมือง',
  e_economy_gpp: 'มูลค่าเศรษฐกิจและพื้นที่เกษตร',
  e_critical_infra: 'โครงสร้างพื้นฐานสำคัญ',
  e_hazard_zone_pop: 'ชุมชนในเขตเสี่ยงภัยซ้ำซาก',
  v_vulnerable_groups: 'สัดส่วนผู้สูงอายุ เด็กเล็ก และคนพิการ',
  v_socio_economic: 'ข้อจำกัดทางรายได้ของครัวเรือน',
  v_housing_fragility: 'สภาพความมั่นคงของที่อยู่อาศัย',
  v_health_access: 'ภาระโรคเรื้อรังและข้อจำกัดการเข้าถึงบริการ',
  c_cell_broadcast: 'ระบบแจ้งเตือนภัย Cell Broadcast',
  c_ddpm_training: 'การฝึกอบรม ปภ. และเครือข่าย อปพร.',
  c_medical_ems: 'ระบบการแพทย์ฉุกเฉิน 1669',
  c_eoc_machinery: 'ความพร้อมศูนย์ EOC และเครื่องจักรกล',
  c_local_plan_budget: 'แผนเผชิญเหตุ อปท. และงบสำรองฉุกเฉิน',
};

/**
 * สร้างบทสรุปสถานการณ์รายจังหวัด ภาษาราชการสมัยใหม่ กระชับ โทนสงบ Anti-Stigma และเลขอารบิก 100%
 */
export function generateProvinceSummaryTh(
  province: ProvinceRiskRecord,
  activeDimension: MapDimension,
  activeLayer: LayerSelection,
  activeSubIndicator: SubIndicatorId | null,
  score: number | null,
  level: RiskLevel | null,
  breakdown: HevcBreakdown,
): string {
  const provinceTitle =
    province.dopaCode === '10' ? province.nameTh : `จังหวัด${province.nameTh}`;
  const dominantName = HAZARD_BY_ID[breakdown.dominantHazardId].nameTh;
  const secondaryName = HAZARD_BY_ID[breakdown.secondaryHazardId].nameTh;

  if (score === null || level === null) {
    const hazardName =
      activeLayer === 'composite' ? 'สาธารณภัยรวม' : HAZARD_BY_ID[activeLayer].nameTh;
    return `${provinceTitle}ไม่มีแนวชายฝั่งทะเลเปิด จึงไม่เข้าข่ายพื้นที่เสี่ยง${hazardName} (N/A) โดยระบบคำนวณภาพรวมจากสาธารณภัยที่เกี่ยวข้องในพื้นที่จำนวน ${breakdown.applicableCount} ประเภท`;
  }

  const scoreStr = score.toFixed(2);

  const topExposure = [...EXPOSURE_INDICATORS].sort(
    (a, b) => province.exposureIndicators[b.id] - province.exposureIndicators[a.id],
  )[0];
  const topVulnerability = [...VULNERABILITY_INDICATORS].sort(
    (a, b) => province.vulnerabilityIndicators[b.id] - province.vulnerabilityIndicators[a.id],
  )[0];
  const sortedCap = [...CAPACITY_INDICATORS].sort(
    (a, b) =>
      breakdown.effectiveCapacityIndicators[b.id] -
      breakdown.effectiveCapacityIndicators[a.id],
  );
  const strongestCap = sortedCap[0];
  const priorityCap = sortedCap[sortedCap.length - 1];

  if (activeDimension === 'C') {
    const capInfo = CAPACITY_LEVEL_STYLES[level];
    if (activeSubIndicator) {
      const indLabel = INDICATOR_PROSE_TH[activeSubIndicator];
      const simNote = breakdown.isSimulated
        ? ` หลังจำลองปรับเพิ่มจากค่าฐาน ${breakdown.baseCapacityScore.toFixed(2)}`
        : '';
      return `${provinceTitle}มีคะแนนความพร้อมด้าน${indLabel}อยู่ที่ ${scoreStr} จาก 5.00 จัดอยู่ในกลุ่ม${capInfo.labelTh}${simNote}`;
    }
    const simNote = breakdown.isSimulated
      ? ` (จำลองปรับเพิ่มจากค่าฐาน ${breakdown.baseCapacityScore.toFixed(2)})`
      : '';
    const detailClause =
      level >= 4
        ? `จุดแข็งหลักอยู่ที่${INDICATOR_PROSE_TH[strongestCap.id]} และควรสานต่อความพร้อมด้าน${INDICATOR_PROSE_TH[priorityCap.id]} อย่างต่อเนื่อง`
        : `ด้านที่มีความพร้อมเด่นคือ${INDICATOR_PROSE_TH[strongestCap.id]} โดยระยะต่อไปควรให้ความสำคัญกับการเสริม${INDICATOR_PROSE_TH[priorityCap.id]} เป็นลำดับแรก`;
    return `${provinceTitle}มีศักยภาพการจัดการความเสี่ยงโดยรวมในกลุ่ม${capInfo.labelTh} (${scoreStr} คะแนน)${simNote} ${detailClause}`;
  }

  if (activeDimension === 'E' || activeDimension === 'V') {
    const pillarName = activeDimension === 'E' ? 'ความล่อแหลม' : 'ความเปราะบาง';
    const levelInfo = RISK_LEVEL_STYLES[level];
    if (activeSubIndicator) {
      const indLabel = INDICATOR_PROSE_TH[activeSubIndicator];
      return `${provinceTitle}มีระดับ${pillarName}ด้าน${indLabel}ในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) ซึ่งเป็นเงื่อนไขสำคัญที่ต้องพิจารณาควบคู่กับการรับมือ${dominantName}`;
    }
    const mainDriver =
      activeDimension === 'E'
        ? INDICATOR_PROSE_TH[topExposure.id]
        : INDICATOR_PROSE_TH[topVulnerability.id];
    return `${provinceTitle}มีระดับ${pillarName}โดยรวมในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) ปัจจัยหลักมาจาก${mainDriver} ซึ่งส่งผลต่อขนาดความเสียหายเมื่อเกิด${dominantName}ในพื้นที่`;
  }

  if (activeDimension === 'H') {
    const levelInfo = RISK_LEVEL_STYLES[level];
    if (activeLayer !== 'composite') {
      const hazardDef = HAZARD_BY_ID[activeLayer];
      return `${provinceTitle}มีระดับภัยคุกคามด้าน${hazardDef.nameTh}ในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) โดยมีช่วงเฝ้าระวังสำคัญระหว่าง${hazardDef.peakSeasonTh}`;
    }
    const multiHazardClause =
      breakdown.highHazardCount >= 3
        ? `พื้นที่ต้องเฝ้าระวังภัยระดับสูงถึง ${breakdown.highHazardCount} ประเภท โดยมี${dominantName}เป็นภัยหลัก รองลงมาคือ${secondaryName}`
        : breakdown.highHazardCount === 2
          ? `ต้องเฝ้าระวังภัยร่วมกัน 2 ด้านหลัก ได้แก่ ${dominantName} รองลงมาคือ${secondaryName}`
          : `ภัยเด่นอันดับแรกคือ${dominantName} รองลงมาคือ${secondaryName}`;
    return `${provinceTitle}มีระดับภัยคุกคามรวมในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) ${multiHazardClause}`;
  }

  // มิติความเสี่ยงสุทธิ (R)
  const levelInfo = RISK_LEVEL_STYLES[level];
  const dominantPillarText =
    breakdown.exposureScore >= breakdown.vulnerabilityScore
      ? `ความล่อแหลมด้าน${INDICATOR_PROSE_TH[topExposure.id]}`
      : `ความเปราะบางด้าน${INDICATOR_PROSE_TH[topVulnerability.id]}`;

  let leadSentence: string;
  if (activeLayer !== 'composite') {
    const hName = HAZARD_BY_ID[activeLayer].nameTh;
    leadSentence = `${provinceTitle}มีความเสี่ยงสุทธิด้าน${hName}ในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) โดยมีปัจจัยร่วมสำคัญจาก${dominantPillarText}`;
  } else if (level >= 4 && breakdown.highHazardCount >= 2) {
    leadSentence = `${provinceTitle}จัดอยู่ในพื้นที่ความเสี่ยงสุทธิเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) จากการเผชิญภัยเด่นหลายด้าน นำโดย${dominantName} รองลงมาคือ${secondaryName}`;
  } else if (level <= 2) {
    leadSentence = `ภาพรวมความเสี่ยงสุทธิของ${provinceTitle}อยู่ในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) โดยมี${dominantName}เป็นประเด็นเฝ้าระวังหลักของพื้นที่`;
  } else {
    leadSentence = `${provinceTitle}มีความเสี่ยงสุทธิภาพรวมในเกณฑ์${levelInfo.shortLabelTh} (ระดับ ${level} คะแนน ${scoreStr}) ปัจจัยขับเคลื่อนหลักมาจาก${dominantName}ร่วมกับ${dominantPillarText}`;
  }

  let capacitySentence: string;
  if (breakdown.isSimulated && breakdown.baseDdpmScore !== null) {
    if (breakdown.simulationDeltaR < -0.01) {
      capacitySentence = ` หลังจำลองแผนเพิ่มศักยภาพ คะแนนความเสี่ยงลดลง ${Math.abs(breakdown.simulationDeltaR).toFixed(2)} คะแนน จากค่าฐาน ${breakdown.baseDdpmScore.toFixed(2)}`;
    } else if (breakdown.simulationDeltaR > 0.01) {
      capacitySentence = ` หลังปรับค่าจำลอง คะแนนความเสี่ยงเพิ่มขึ้น ${breakdown.simulationDeltaR.toFixed(2)} คะแนน จากค่าฐาน ${breakdown.baseDdpmScore.toFixed(2)}`;
    } else {
      capacitySentence = ` หลังปรับค่าจำลอง คะแนนความเสี่ยงยังคงใกล้เคียงค่าฐานเดิมที่ ${breakdown.baseDdpmScore.toFixed(2)}`;
    }
  } else if (breakdown.cImpactDelta !== null && breakdown.cImpactDelta <= -0.15) {
    capacitySentence = ` ความพร้อมของพื้นที่ โดยเฉพาะ${INDICATOR_PROSE_TH[strongestCap.id]} ช่วยพยุงและลดความเสี่ยงสุทธิลงได้ ${Math.abs(breakdown.cImpactDelta).toFixed(2)} คะแนน`;
  } else if (breakdown.cImpactDelta !== null && breakdown.cImpactDelta < -0.04) {
    capacitySentence = ` ศักยภาพด้าน${INDICATOR_PROSE_TH[strongestCap.id]} ช่วยลดความเสี่ยงลงได้บางส่วน และยังเสริมความพร้อมด้าน${INDICATOR_PROSE_TH[priorityCap.id]} เพิ่มเติมได้`;
  } else if (breakdown.cImpactDelta !== null && breakdown.cImpactDelta > 0.05) {
    capacitySentence = ` ระยะต่อไปควรเร่งสนับสนุน${INDICATOR_PROSE_TH[priorityCap.id]} เพื่อช่วยลดความเสี่ยงสุทธิของจังหวัด`;
  } else {
    capacitySentence = ` หากเสริมความพร้อมด้าน${INDICATOR_PROSE_TH[priorityCap.id]} เพิ่มเติม จะช่วยลดความเสี่ยงสุทธิของพื้นที่ลงได้`;
  }

  const guardrailSentence = breakdown.guardrailApplied
    ? ` เนื่องจากระดับภัยคุกคามอยู่ในเกณฑ์สูงมาก ระบบจึงคงคะแนนเฝ้าระวังขั้นต่ำไว้ที่ ${breakdown.guardrailFloor.toFixed(2)}`
    : '';

  return `${leadSentence}${capacitySentence}${guardrailSentence}`;
}

export function evaluateAllProvinces(
  provinces: readonly ProvinceRiskRecord[],
  activeDimension: MapDimension,
  activeLayer: LayerSelection,
  compositeMode: CompositeMode,
  activeSubIndicator: SubIndicatorId | null = null,
  capacityOverridesByProvince?: Record<string, CapacityOverrides>,
): ProvinceEvaluation[] {
  const prelim = provinces.map((province) => {
    const overrides = capacityOverridesByProvince?.[province.dopaCode];
    const breakdown = computeProvinceHevc(province, activeLayer, overrides);

    // คำนวณ 3 โหมดหลักบน composite (เพื่อแสดงในตารางและ Modal เปรียบเทียบเสมอ)
    const compositeHevc =
      activeLayer === 'composite'
        ? breakdown
        : computeProvinceHevc(province, 'composite', overrides);

    const ddpmScore = compositeHevc.ddpmScore ?? 1.0;
    const eocScore = compositeHevc.maxHazardScore;
    const grossScore = compositeHevc.grossRiskScore ?? 1.0;

    // ตัดสินคะแนนที่จะแสดงบนแผนที่ตามมิติและตัวชี้วัดย่อยที่เลือก
    let score: number | null;
    let applicable = true;

    if (activeDimension === 'E') {
      if (activeSubIndicator && activeSubIndicator in province.exposureIndicators) {
        score = round2(
          clampScore(
            province.exposureIndicators[activeSubIndicator as keyof typeof province.exposureIndicators],
          ),
        );
      } else {
        score = breakdown.exposureScore;
      }
    } else if (activeDimension === 'V') {
      if (activeSubIndicator && activeSubIndicator in province.vulnerabilityIndicators) {
        score = round2(
          clampScore(
            province.vulnerabilityIndicators[
              activeSubIndicator as keyof typeof province.vulnerabilityIndicators
            ],
          ),
        );
      } else {
        score = breakdown.vulnerabilityScore;
      }
    } else if (activeDimension === 'C') {
      if (activeSubIndicator && activeSubIndicator in breakdown.effectiveCapacityIndicators) {
        score = round2(
          clampScore(
            breakdown.effectiveCapacityIndicators[
              activeSubIndicator as keyof typeof breakdown.effectiveCapacityIndicators
            ],
          ),
        );
      } else {
        score = breakdown.effectiveCapacityScore;
      }
    } else if (activeDimension === 'H') {
      score = breakdown.hazardActiveScore;
      applicable = score !== null;
    } else {
      // มิติ R: ความเสี่ยงสุทธิ
      if (activeLayer === 'composite') {
        if (compositeMode === 'ddpm64') {
          score = breakdown.ddpmScore;
        } else if (compositeMode === 'eoc') {
          score = breakdown.maxHazardScore;
        } else {
          score = breakdown.grossRiskScore;
        }
      } else {
        // รายภัยเดี่ยวในมิติ R ยังใช้กรอบแผน ปภ. ชาติ (H_i, E, V, C) หรือ Gross/EOC ตามโหมดที่เลือก!
        if (breakdown.hazardActiveScore === null) {
          score = null;
          applicable = false;
        } else if (compositeMode === 'ddpm64') {
          score = breakdown.ddpmScore;
        } else if (compositeMode === 'eoc') {
          score = breakdown.hazardActiveScore;
        } else {
          score = breakdown.grossRiskScore;
        }
      }
    }

    const level = score !== null ? scoreToRiskLevel(score) : null;
    const summaryTh = generateProvinceSummaryTh(
      province,
      activeDimension,
      activeLayer,
      activeSubIndicator,
      score,
      level,
      breakdown,
    );

    return {
      province,
      activeDimension,
      activeLayer,
      activeSubIndicator,
      compositeMode,
      score,
      level,
      applicable,
      ddpmScore,
      ddpmLevel: scoreToRiskLevel(ddpmScore),
      eocScore,
      eocLevel: scoreToRiskLevel(eocScore),
      grossScore,
      grossLevel: scoreToRiskLevel(grossScore),
      breakdown,
      summaryTh,
      rank: 0,
    };
  });

  // จัดอันดับ: ในมิติ R, H, E, V เรียงคะแนนสูงสุดเป็นอันดับ 1; ในมิติ C เรียงศักยภาพสูงสุดเป็นอันดับ 1 เช่นกัน (ชัดเจนในหัวตาราง)
  const rankedOrder = [...prelim].sort((a, b) => {
    if (a.score === null && b.score === null) {
      return a.province.dopaCode.localeCompare(b.province.dopaCode);
    }
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.ddpmScore !== a.ddpmScore) return b.ddpmScore - a.ddpmScore;
    return a.province.dopaCode.localeCompare(b.province.dopaCode);
  });

  const rankByCode = new Map<string, number>();
  rankedOrder.forEach((item, index) => {
    rankByCode.set(item.province.dopaCode, index + 1);
  });

  return prelim.map((item) => ({
    ...item,
    rank: rankByCode.get(item.province.dopaCode) ?? 77,
  }));
}
