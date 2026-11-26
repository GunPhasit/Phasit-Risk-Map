export type HazardId =
  | 'flood'
  | 'pm25_wildfire'
  | 'drought'
  | 'windstorm'
  | 'landslide'
  | 'toxic_pollution'
  | 'heatwave'
  | 'epidemic'
  | 'earthquake'
  | 'tsunami_coastal';

export type LayerSelection = 'composite' | HazardId;

/**
 * 5 มิติการแสดงผลบนแผนที่ 77 จังหวัด ตามแผน ปภ. ชาติ พ.ศ. 2564-2570
 * R: ระดับความเสี่ยงสุทธิ (เพิ่มจาก H, E, V และลดจาก C)
 * H: ภัยคุกคาม (10 ภัย + รวม)
 * E: ความล่อแหลม (4 ตัวชี้วัดย่อย)
 * V: ความเปราะบาง (4 ตัวชี้วัดย่อย)
 * C: ศักยภาพในการจัดการความเสี่ยง (5 ตัวชี้วัดย่อย — คะแนนสูงช่วยลดความเสี่ยง)
 */
export type MapDimension = 'R' | 'H' | 'E' | 'V' | 'C';

/**
 * 3 โหมดสูตรคำนวณสำหรับมิติ R
 * ddpm64: แผน ปภ. ชาติ 2564-2570 — R = H^0.40 * E^0.20 * V^0.20 * (6 - C)^0.20 + Guardrail (ค่าเริ่มต้น)
 * eoc: เฝ้าระวังภัยสูงสุด EOC — ใช้ H_max ไม่หักลดด้วย C
 * gross: ความเสี่ยงฐานก่อนหักลดด้วยศักยภาพ C — R_gross = H^0.50 * E^0.25 * V^0.25 (ดู C-Impact)
 */
export type CompositeMode = 'ddpm64' | 'eoc' | 'gross';

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export type ThailandRegion6 =
  | 'north'
  | 'northeast'
  | 'central'
  | 'east'
  | 'west'
  | 'south';

export type RegionFilterKey = 'all' | 'bma6' | ThailandRegion6;

export type ExposureIndicatorId =
  | 'e_pop_urban'
  | 'e_economy_gpp'
  | 'e_critical_infra'
  | 'e_hazard_zone_pop';

export type VulnerabilityIndicatorId =
  | 'v_vulnerable_groups'
  | 'v_socio_economic'
  | 'v_housing_fragility'
  | 'v_health_access';

export type CapacityIndicatorId =
  | 'c_cell_broadcast'
  | 'c_ddpm_training'
  | 'c_medical_ems'
  | 'c_eoc_machinery'
  | 'c_local_plan_budget';

export type SubIndicatorId =
  | ExposureIndicatorId
  | VulnerabilityIndicatorId
  | CapacityIndicatorId;

export interface SubIndicatorDefinition<T extends SubIndicatorId = SubIndicatorId> {
  readonly id: T;
  readonly pillar: 'E' | 'V' | 'C';
  readonly nameTh: string;
  readonly shortNameTh: string;
  readonly weight: number;
  readonly unitHintTh: string;
  readonly agencySourceTh: string;
  readonly descriptionTh: string;
}

export interface HotlineContact {
  readonly number: string;
  readonly agency: string;
  readonly note: string;
}

export interface ThreePhaseGuidance {
  readonly before: readonly [string, string, string];
  readonly during: readonly [string, string, string];
  readonly after: readonly [string, string, string];
}

export interface HazardDefinition {
  readonly id: HazardId;
  readonly nameTh: string;
  readonly shortNameTh: string;
  readonly nameEn: string;
  readonly category: 'core' | 'extended';
  readonly weight: number;
  readonly peakSeasonTh: string;
  readonly agenciesTh: string;
  readonly keyIndicatorsTh: string;
  readonly hotlines: readonly HotlineContact[];
  readonly guidance: ThreePhaseGuidance;
}

export interface HazardScoreEntry {
  readonly score: number | null; // 1.00 - 5.00 หรือ null เมื่อ applicable === false
  readonly applicable: boolean;
}

export interface DistrictSpotSummary {
  readonly code: string;
  readonly fullNameTh: string;
  readonly score: number;
  readonly level: RiskLevel;
}

export interface ProvinceDistrictDiagnostics {
  readonly districtCount: number;
  readonly riskMin: number;
  readonly riskMax: number;
  readonly riskMean: number;
  readonly riskSpread: number; // riskMax - riskMean
  readonly weightedIqr: number; // Q3 - Q1
  readonly highestRiskDistrict: DistrictSpotSummary;
  readonly highRiskDistrictCount: number; // >= 3.40
  readonly criticalRiskDistrictCount: number; // >= 4.20
  readonly capacityMin: number;
  readonly capacityMax: number;
  readonly capacityMean: number;
  readonly capacityGap: number; // capacityMean - capacityMin
  readonly priorityCapacityDistrict: DistrictSpotSummary;
  readonly priorityCapacityDistrictCount: number; // < 2.60
  readonly hasRiskHotspotAlert: boolean;
  readonly hasCapacityGapAlert: boolean;
}

export interface ProvinceRiskRecord {
  readonly dopaCode: string; // รหัสกรมการปกครอง 2 หลัก เช่น "10", "38", "50"
  readonly isoCode: string; // ISO 3166-2:TH เช่น "TH-10", "TH-38", "TH-50"
  readonly nameTh: string;
  readonly nameEn: string;
  readonly shortAliases: readonly string[];
  readonly region6: ThailandRegion6;
  readonly isBma6: boolean;
  readonly coastalZone: 'andaman' | 'gulf' | 'inland';
  readonly geographicNoteTh: string;
  readonly hazards: Record<HazardId, HazardScoreEntry>;
  readonly exposureIndicators: Record<ExposureIndicatorId, number>;
  readonly vulnerabilityIndicators: Record<VulnerabilityIndicatorId, number>;
  readonly capacityIndicators: Record<CapacityIndicatorId, number>;
  readonly districtDiagnostics?: ProvinceDistrictDiagnostics;
}

export type CapacityOverrides = Partial<Record<CapacityIndicatorId, number>>;

export interface HevcBreakdown {
  readonly hazardCompositeScore: number; // H_composite (Hybrid Power Mean + Safety Floor)
  readonly hazardActiveScore: number | null; // H ของชั้นข้อมูลที่เลือก (composite หรือ single hazard)
  readonly maxHazardScore: number;
  readonly powerMeanScore: number;
  readonly highHazardCount: number;
  readonly compoundBonus: number;
  readonly exposureScore: number; // E รวมจาก 4 ตัวชี้วัดย่อย
  readonly vulnerabilityScore: number; // V รวมจาก 4 ตัวชี้วัดย่อย
  readonly baseCapacityScore: number; // C ค่าฐานจำลองจาก 5 ตัวชี้วัดย่อย
  readonly effectiveCapacityScore: number; // C หลังรวม What-If Simulation (เท่ากับ baseC เมื่อไม่ได้จำลอง)
  readonly effectiveCapacityIndicators: Record<CapacityIndicatorId, number>;
  readonly capacityGapFactor: number; // (6.00 - C)
  readonly ddpmRawScore: number | null; // H^0.4 * E^0.2 * V^0.2 * (6-C)^0.2 ก่อน Guardrail
  readonly guardrailApplied: boolean;
  readonly guardrailFloor: number;
  readonly baseDdpmScore: number | null; // R สุทธิค่าฐานจำลอง (ก่อน What-If)
  readonly ddpmScore: number | null; // R สุทธิแผน ปภ. ชาติ 64-70 (หลัง What-If ถ้ามี)
  readonly grossRiskScore: number | null; // R_gross ก่อนหักลดด้วย C (H^0.5 * E^0.25 * V^0.25)
  readonly cImpactDelta: number | null; // ddpmScore - grossRiskScore (ค่าลบ = ศักยภาพช่วยลดความเสี่ยง)
  readonly simulationDeltaR: number; // ddpmScore - baseDdpmScore (เมื่อปรับ Slider What-If)
  readonly simulationReductionPct: number; // ร้อยละการลดความเสี่ยงจาก What-If
  readonly isSimulated: boolean;
  readonly applicableCount: number;
  readonly dominantHazardId: HazardId;
  readonly secondaryHazardId: HazardId;
  readonly elevatedHazardIds: readonly HazardId[];
}

export interface ProvinceEvaluation {
  readonly province: ProvinceRiskRecord;
  readonly activeDimension: MapDimension;
  readonly activeLayer: LayerSelection;
  readonly activeSubIndicator: SubIndicatorId | null;
  readonly compositeMode: CompositeMode;
  /** คะแนนที่แสดงบนแผนที่ในมิติ/ตัวชี้วัดปัจจุบัน (1.00 - 5.00 หรือ null เมื่อ N/A) */
  readonly score: number | null;
  readonly level: RiskLevel | null;
  readonly applicable: boolean;
  /** คะแนนสำคัญของ 3 โหมดหลักสำหรับแสดงเปรียบเทียบและตาราง */
  readonly ddpmScore: number;
  readonly ddpmLevel: RiskLevel;
  readonly eocScore: number;
  readonly eocLevel: RiskLevel;
  readonly grossScore: number;
  readonly grossLevel: RiskLevel;
  readonly breakdown: HevcBreakdown;
  readonly summaryTh: string;
  readonly rank: number;
}
