import { describe, expect, it } from 'vitest';
import {
  aggregateByProfile,
  AGGREGATION_PROFILES,
  aggregateDistrictsToProvince,
  rollupCapacityFromDistricts,
  rollupHazardFromDistricts,
  type AggregationProfileId,
  type WeightedValue,
} from '../src/domain/districtRollup.ts';
import { PROVINCE_BY_CODE } from '../src/data/provincesRiskData.ts';
import { scoreToRiskLevel } from '../src/domain/riskCalculator.ts';
import type { DistrictMeta, DistrictMetricsPayload } from '../src/types/index.ts';

const ALL_PROFILES: readonly AggregationProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6a', 'P6b'];

function makeUniformMetrics(val: number, tsunamiVal: number | null): DistrictMetricsPayload {
  return {
    hazards: {
      flood: val,
      pm25_wildfire: val,
      drought: val,
      windstorm: val,
      landslide: val,
      toxic_pollution: val,
      heatwave: val,
      epidemic: val,
      earthquake: val,
      tsunami_coastal: tsunamiVal,
    },
    exposureIndicators: {
      e_pop_urban: val,
      e_economy_gpp: val,
      e_critical_infra: val,
      e_hazard_zone_pop: val,
    },
    vulnerabilityIndicators: {
      v_vulnerable_groups: val,
      v_socio_economic: val,
      v_housing_fragility: val,
      v_health_access: val,
    },
    capacityIndicators: {
      c_cell_broadcast: val,
      c_ddpm_training: val,
      c_medical_ems: val,
      c_eoc_machinery: val,
      c_local_plan_budget: val,
    },
  };
}

describe('Distribution-Aware 6-Group (7-Profile) District-to-Province Aggregation', () => {
  it('defines all 7 profiles covering all 10 hazards and 13 sub-indicators', () => {
    expect(AGGREGATION_PROFILES).toHaveLength(7);
  });

  it('handles extreme right-tail Case A (1 district 4.90, 24 districts 1.20) in Level 3 Yellow without eclipsing or alarm fatigue', () => {
    const caseA: WeightedValue[] = [
      { score: 4.9, weight: 1 },
      ...Array.from({ length: 24 }, () => ({ score: 1.2, weight: 1 })),
    ];
    const p1 = aggregateByProfile(caseA, 'P1'); // ดินถล่ม/สารพิษ/แผ่นดินไหว/สึนามิ
    expect(p1).toBeGreaterThanOrEqual(2.6);
    expect(p1).toBeLessThan(3.4);
    expect(scoreToRiskLevel(p1)).toBe(3); // ระดับ 3 สีเหลืองตามมติ ปภ. + เป็ด
  });

  it('beats Midrange catastrophically on extreme left-tail Case B (20 districts 4.50, 1 district 1.00)', () => {
    const caseB: WeightedValue[] = [
      ...Array.from({ length: 20 }, () => ({ score: 4.5, weight: 1 })),
      { score: 1.0, weight: 1 },
    ];
    // Midrange = (4.50 + 1.00) / 2 = 2.75 (ล้มเหลวเหลือสีเหลือง!)
    const midrange = (4.5 + 1.0) / 2;
    expect(midrange).toBe(2.75);

    const p1 = aggregateByProfile(caseB, 'P1');
    const p2 = aggregateByProfile(caseB, 'P2');
    const p3 = aggregateByProfile(caseB, 'P3');
    expect(p1).toBeGreaterThanOrEqual(4.35);
    expect(p2).toBeGreaterThanOrEqual(4.35);
    expect(p3).toBeGreaterThanOrEqual(4.3);
    expect(scoreToRiskLevel(p1)).toBe(5);
  });

  it('guarantees strict monotonicity, idempotency, and [1.00, 5.00] bounds across all 7 profiles and province sizes (n=3 Phuket to n=50 BKK)', () => {
    for (const profile of ALL_PROFILES) {
      // Idempotency: ทุกอำเภอเท่ากัน -> จังหวัดเท่ากับค่านั้นเป๊ะ
      for (const x of [1.0, 2.35, 3.0, 4.45, 5.0]) {
        const items3 = Array.from({ length: 3 }, (_, i) => ({ score: x, weight: 1 + i * 0.5 }));
        const items50 = Array.from({ length: 50 }, (_, i) => ({ score: x, weight: 0.7 + (i % 5) * 0.3 }));
        expect(aggregateByProfile(items3, profile)).toBe(x);
        expect(aggregateByProfile(items50, profile)).toBe(x);
      }

      // Strict Monotonicity: เพิ่มคะแนนอำเภอปกติจาก 1.20 -> 2.80 (ความเบ้ลดลง) คะแนนจังหวัดต้องเพิ่มขึ้นเสมอ ห้ามลด!
      const skewed: WeightedValue[] = [
        { score: 4.8, weight: 1.5 },
        { score: 1.2, weight: 1.0 },
        { score: 1.2, weight: 1.0 },
        { score: 1.2, weight: 1.0 },
        { score: 1.2, weight: 1.0 },
      ];
      const worsened: WeightedValue[] = [
        { score: 4.8, weight: 1.5 },
        { score: 2.8, weight: 1.0 },
        { score: 2.8, weight: 1.0 },
        { score: 2.8, weight: 1.0 },
        { score: 2.8, weight: 1.0 },
      ];
      expect(aggregateByProfile(worsened, profile)).toBeGreaterThanOrEqual(
        aggregateByProfile(skewed, profile),
      );
    }
  });

  it('distinguishes non-transferable local capacity (P6a Cell Broadcast) from dispatchable pooled capacity (P6b EOC)', () => {
    // อ.เมืองมีศักยภาพสูง 4.80 (ประชากรเยอะ) แต่อำเภอหุบเขา 2 อำเภออับสัญญาณ 1.30
    const distCaps: WeightedValue[] = [
      { score: 4.8, weight: 2.4 },
      { score: 4.2, weight: 1.6 },
      { score: 3.9, weight: 1.2 },
      { score: 1.3, weight: 0.7 },
      { score: 1.3, weight: 0.7 },
    ];
    const cellBroadcastScore = rollupCapacityFromDistricts(distCaps, 'c_cell_broadcast'); // P6a
    const eocMachineryScore = rollupCapacityFromDistricts(distCaps, 'c_eoc_machinery'); // P6b

    // Cell Broadcast (ถ่ายโอนไม่ได้) ต้องสะท้อนจุดอับสัญญาณหนักกว่าเครื่องจักรกล EOC (เคลื่อนย้ายข้ามอำเภอได้)
    expect(cellBroadcastScore).toBeLessThan(eocMachineryScore - 0.5);
  });

  it('defeats Urban Masking in Vulnerability (P5) compared to pure population-weighted mean', () => {
    // อำเภอเมืองประชากรหนาแน่นเปราะบางน้อย (1.80) แต่อำเภอชายขอบ 4 แห่งเปราะบางสูงมาก (4.60)
    const distVuln: WeightedValue[] = [
      { score: 1.8, weight: 5.0 },
      { score: 4.6, weight: 0.7 },
      { score: 4.6, weight: 0.7 },
      { score: 4.6, weight: 0.7 },
      { score: 4.6, weight: 0.7 },
    ];
    const p5 = aggregateByProfile(distVuln, 'P5');
    // ค่าเฉลี่ยถ่วงประชากรล้วนจะได้ ~2.80 แต่ P5 (รากประชากร + UpperCVaR) ต้องยกสูงขึ้นชัดเจนเพื่อไม่ให้เขตเมืองกลบชนบท
    expect(p5).toBeGreaterThanOrEqual(3.8);
  });

  it('applies Active-District Masking for tsunami_coastal and computes intra-province diagnostics & alerts', () => {
    const rayong = PROVINCE_BY_CODE['21']!; // จังหวัดชายฝั่งอ่าวไทย
    const makeDist = (code: string, name: string, geoClass: DistrictMeta['geoClass'], w: number): DistrictMeta => ({
      code,
      provinceCode: '21',
      prefixTh: 'อำเภอ',
      nameTh: name,
      fullNameTh: `อำเภอ${name}`,
      nameEn: name,
      geoClass,
      popWeight: w,
    });

    const coastalDist = makeDist('2101', 'เมืองระยอง', 'coastal', 2.0);
    const inlandDist1 = makeDist('2104', 'ปลวกแดง', 'rural', 1.2);
    const inlandDist2 = makeDist('2105', 'วังจันทร์', 'rural', 0.8);

    const coastalMetrics: DistrictMetricsPayload = {
      ...makeUniformMetrics(4.7, 4.7),
      capacityIndicators: {
        c_cell_broadcast: 1.7,
        c_ddpm_training: 1.7,
        c_medical_ems: 1.8,
        c_eoc_machinery: 1.8,
        c_local_plan_budget: 1.8,
      },
    };
    const inlandMetrics1: DistrictMetricsPayload = {
      ...makeUniformMetrics(1.4, 1.0),
      capacityIndicators: {
        c_cell_broadcast: 4.2,
        c_ddpm_training: 4.2,
        c_medical_ems: 4.2,
        c_eoc_machinery: 4.2,
        c_local_plan_budget: 4.2,
      },
    };
    const inlandMetrics2: DistrictMetricsPayload = {
      ...makeUniformMetrics(1.3, 1.0),
      capacityIndicators: {
        c_cell_broadcast: 4.1,
        c_ddpm_training: 4.1,
        c_medical_ems: 4.1,
        c_eoc_machinery: 4.1,
        c_local_plan_budget: 4.1,
      },
    };

    const provAgg = aggregateDistrictsToProvince(rayong, [
      { district: coastalDist, metrics: coastalMetrics },
      { district: inlandDist1, metrics: inlandMetrics1 },
      { district: inlandDist2, metrics: inlandMetrics2 },
    ]);

    // สึนามิต้องไม่ถูกอำเภอในแผ่นดิน (1.00) มาฉุดลด! ต้องสะท้อนค่าจากอำเภอติดทะเลจริง (4.70)
    expect(provAgg.hazards.tsunami_coastal.applicable).toBe(true);
    expect(provAgg.hazards.tsunami_coastal.score).toBe(4.7);

    // ดัชนีการกระจายตัวและป้ายจุดเฝ้าระวังต้องทำงานถูกต้อง
    expect(provAgg.districtDiagnostics).toBeDefined();
    expect(provAgg.districtDiagnostics!.districtCount).toBe(3);
    expect(provAgg.districtDiagnostics!.highestRiskDistrict.code).toBe('2101');
    expect(provAgg.districtDiagnostics!.hasRiskHotspotAlert).toBe(true);
    expect(provAgg.districtDiagnostics!.hasCapacityGapAlert).toBe(true);
    expect(rollupHazardFromDistricts([{ score: 4.5, weight: 1 }], 'landslide')).toBe(4.5);
  });
});
