import fs from 'node:fs';
import path from 'node:path';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import topoRaw from '../src/data/thailand-provinces.topo.json';
import { HAZARD_CATALOG } from '../src/data/hazardCatalog';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../src/data/indicatorCatalog';
import { PROVINCES_RISK_DATA } from '../src/data/provincesRiskData';
import { CAPACITY_LEVEL_STYLES, RISK_LEVEL_STYLES } from '../src/data/riskPalette';
import { buildRiskCsvContent, sanitizeCsvCell } from '../src/domain/csvExporter';
import {
  computeDdpmRiskScore,
  computeProvinceHevc,
  evaluateAllProvinces,
  scoreToRiskLevel,
} from '../src/domain/riskCalculator';
import type { MapDimension } from '../src/types/risk';

const THAI_NUMERAL_REGEX = /[\u0E50-\u0E59]/;
const BLACKLIST_PHRASES = [
  'พื้นที่วิกฤตห้ามเข้า',
  'กำลังจะเกิดภัยพิบัติ',
  'คำสั่งอพยพทันที',
  'ยกระดับ EOC ทันที',
  'ประกาศเตือนภัยฉุกเฉินขณะนี้',
  'ข้อมูลจริง',
  'ศักยภาพต่ำ',
  'ทั้งนี้ ข้อมูลดังกล่าว',
  'เหตุการณ์สด',
  'What-If',
  'ΔR',
];

describe('Thailand DDPM 2564-2570 Dataset Integrity (77 Provinces x 10 Hazards + 13 Sub-Indicators)', () => {
  it('has exactly 77 unique provinces including Bueng Kan (38 / TH-38) matching TopoJSON < 90 KB', () => {
    expect(PROVINCES_RISK_DATA).toHaveLength(77);
    const dopaCodes = new Set(PROVINCES_RISK_DATA.map((p) => p.dopaCode));
    const isoCodes = new Set(PROVINCES_RISK_DATA.map((p) => p.isoCode));
    expect(dopaCodes.size).toBe(77);
    expect(isoCodes.size).toBe(77);
    expect(dopaCodes.has('38')).toBe(true);
    expect(isoCodes.has('TH-38')).toBe(true);

    const topoGeoms = (
      topoRaw as { objects: { provinces: { geometries: Array<{ properties: { dopaCode: string } }> } } }
    ).objects.provinces.geometries;
    expect(topoGeoms).toHaveLength(77);
    const topoCodes = new Set(topoGeoms.map((g) => g.properties.dopaCode));
    for (const code of dopaCodes) {
      expect(topoCodes.has(code)).toBe(true);
    }
    const topoBytes = fs.statSync(
      path.resolve(process.cwd(), 'src/data/thailand-provinces.topo.json'),
    ).size;
    expect(topoBytes / 1024).toBeLessThan(90);
  });

  it('has 10 hazards and 13 HEVC sub-indicators with weights summing to 1.00 in every pillar', () => {
    expect(HAZARD_CATALOG).toHaveLength(10);
    expect(EXPOSURE_INDICATORS).toHaveLength(4);
    expect(VULNERABILITY_INDICATORS).toHaveLength(4);
    expect(CAPACITY_INDICATORS).toHaveLength(5);

    const sumW = (arr: readonly { weight: number }[]) => arr.reduce((a, x) => a + x.weight, 0);
    expect(Math.abs(sumW(HAZARD_CATALOG) - 1.0)).toBeLessThan(1e-9);
    expect(Math.abs(sumW(EXPOSURE_INDICATORS) - 1.0)).toBeLessThan(1e-9);
    expect(Math.abs(sumW(VULNERABILITY_INDICATORS) - 1.0)).toBeLessThan(1e-9);
    expect(Math.abs(sumW(CAPACITY_INDICATORS) - 1.0)).toBeLessThan(1e-9);

    // ตรวจสอบว่ามีตัวชี้วัด Cell Broadcast และการฝึกอบรม ปภ.
    expect(CAPACITY_INDICATORS.some((c) => c.id === 'c_cell_broadcast')).toBe(true);
    expect(CAPACITY_INDICATORS.some((c) => c.id === 'c_ddpm_training')).toBe(true);
  });

  it('has 6 standard regions and restricts N/A strictly to tsunami_coastal for 54 inland provinces', () => {
    const coastal = PROVINCES_RISK_DATA.filter((p) => p.coastalZone !== 'inland');
    const inland = PROVINCES_RISK_DATA.filter((p) => p.coastalZone === 'inland');
    expect(coastal).toHaveLength(23);
    expect(inland).toHaveLength(54);

    for (const p of PROVINCES_RISK_DATA) {
      for (const h of HAZARD_CATALOG) {
        const entry = p.hazards[h.id];
        if (h.id === 'tsunami_coastal' && p.coastalZone === 'inland') {
          expect(entry.applicable).toBe(false);
          expect(entry.score).toBeNull();
        } else {
          expect(entry.applicable).toBe(true);
          expect(entry.score!).toBeGreaterThanOrEqual(1.0);
          expect(entry.score!).toBeLessThanOrEqual(5.0);
        }
      }
      for (const e of EXPOSURE_INDICATORS) {
        expect(p.exposureIndicators[e.id]).toBeGreaterThanOrEqual(1.0);
        expect(p.exposureIndicators[e.id]).toBeLessThanOrEqual(5.0);
      }
      for (const v of VULNERABILITY_INDICATORS) {
        expect(p.vulnerabilityIndicators[v.id]).toBeGreaterThanOrEqual(1.0);
        expect(p.vulnerabilityIndicators[v.id]).toBeLessThanOrEqual(5.0);
      }
      for (const c of CAPACITY_INDICATORS) {
        expect(p.capacityIndicators[c.id]).toBeGreaterThanOrEqual(1.0);
        expect(p.capacityIndicators[c.id]).toBeLessThanOrEqual(5.0);
      }
    }
  });
});

describe('DDPM 2564-2570 Symmetric Formula R = f(H, E, V ÷ C) & Gate 11-14 Tests', () => {
  it('satisfies exact symmetry (3.00 -> 3.00), exact bounds [1.00, 5.00], and strict HEVC monotonicity', () => {
    // กลางสมมาตรเป๊ะ
    expect(computeDdpmRiskScore(3.0, 3.0, 3.0, 3.0).finalScore).toBe(3.0);
    // ขอบล่างเป๊ะ (ภัย/ล่อแหลม/เปราะบาง ต่ำสุด + ศักยภาพสูงสุด)
    expect(computeDdpmRiskScore(1.0, 1.0, 1.0, 5.0).finalScore).toBe(1.0);
    // ขอบบนเป๊ะ (ภัย/ล่อแหลม/เปราะบาง สูงสุด + ศักยภาพต่ำสุด)
    expect(computeDdpmRiskScore(5.0, 5.0, 5.0, 1.0).finalScore).toBe(5.0);

    // เพิ่ม H, E, V ต้องเพิ่มความเสี่ยง R
    const base = computeDdpmRiskScore(3.0, 3.0, 3.0, 3.0).finalScore;
    expect(computeDdpmRiskScore(3.5, 3.0, 3.0, 3.0).finalScore).toBeGreaterThan(base);
    expect(computeDdpmRiskScore(3.0, 3.8, 3.0, 3.0).finalScore).toBeGreaterThan(base);
    expect(computeDdpmRiskScore(3.0, 3.0, 3.8, 3.0).finalScore).toBeGreaterThan(base);

    // เพิ่มศักยภาพ C ต้องลดความเสี่ยง R!
    expect(computeDdpmRiskScore(3.0, 3.0, 3.0, 4.5).finalScore).toBeLessThan(base);
    expect(computeDdpmRiskScore(3.0, 3.0, 3.0, 1.5).finalScore).toBeGreaterThan(base);
  });

  it('enforces Safety Guardrail so extreme hazard (H >= 4.60) cannot be eclipsed below Level 4 even at C = 5.00', () => {
    const res = computeDdpmRiskScore(4.8, 2.0, 2.0, 5.0);
    expect(res.guardrailApplied).toBe(true);
    expect(res.finalScore).toBeGreaterThanOrEqual(3.5);
    expect(scoreToRiskLevel(res.finalScore)).toBeGreaterThanOrEqual(4);
  });

  it('updates ONLY the simulated province in What-If Capacity Simulator without mutating other provinces', () => {
    const maeHongSon = PROVINCES_RISK_DATA.find((p) => p.dopaCode === '58')!;
    const baseline = computeProvinceHevc(maeHongSon, 'composite');
    const simulated = computeProvinceHevc(maeHongSon, 'composite', {
      c_cell_broadcast: 5.0,
      c_ddpm_training: 5.0,
      c_medical_ems: 4.8,
      c_eoc_machinery: 4.8,
      c_local_plan_budget: 4.8,
    });

    expect(simulated.isSimulated).toBe(true);
    expect(simulated.effectiveCapacityScore).toBeGreaterThan(baseline.baseCapacityScore);
    expect(simulated.ddpmScore!).toBeLessThan(baseline.ddpmScore!);
    expect(simulated.simulationDeltaR).toBeLessThan(0);

    // ตรวจสอบระดับทั้งประเทศว่ามีเพียงจังหวัด 58 เท่านั้นที่ถูกจำลอง
    const allWithSim = evaluateAllProvinces(PROVINCES_RISK_DATA, 'R', 'composite', 'ddpm64', null, {
      '58': { c_cell_broadcast: 5.0, c_ddpm_training: 5.0 },
    });
    expect(allWithSim.filter((e) => e.breakdown.isSimulated)).toHaveLength(1);
    expect(allWithSim.find((e) => e.province.dopaCode === '58')!.breakdown.isSimulated).toBe(true);
  });

  it('maps boundary values cleanly without overlap after 2-decimal rounding', () => {
    expect(scoreToRiskLevel(1.79)).toBe(1);
    expect(scoreToRiskLevel(1.796)).toBe(2);
    expect(scoreToRiskLevel(2.59)).toBe(2);
    expect(scoreToRiskLevel(2.6)).toBe(3);
    expect(scoreToRiskLevel(3.39)).toBe(3);
    expect(scoreToRiskLevel(3.4)).toBe(4);
    expect(scoreToRiskLevel(4.19)).toBe(4);
    expect(scoreToRiskLevel(4.2)).toBe(5);
  });

  it('spans all 5 color levels (Blue, Green, Yellow, Orange, Red) on default DDPM 64-70 Risk Map (R)', () => {
    const evals = evaluateAllProvinces(PROVINCES_RISK_DATA, 'R', 'composite', 'ddpm64');
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const ev of evals) {
      if (ev.level !== null) counts[ev.level] += 1;
    }
    expect(counts[1]).toBeGreaterThanOrEqual(4);
    expect(counts[2]).toBeGreaterThanOrEqual(8);
    expect(counts[3]).toBeGreaterThanOrEqual(15);
    expect(counts[4]).toBeGreaterThanOrEqual(10);
    expect(counts[5]).toBeGreaterThanOrEqual(4);
  });

  it('rewinds all 77 TopoJSON province polygons to valid d3-geo clockwise spherical area (< 0.05 sr)', () => {
    const topology = topoRaw as unknown as Parameters<typeof feature>[0] & {
      objects: { provinces: Parameters<typeof feature>[1] };
    };
    const fc = feature(topology, topology.objects.provinces) as unknown as FeatureCollection<Geometry>;
    const rewindRings = (rings: Position[][]): Position[][] =>
      geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI
        ? rings.map((r) => [...r].reverse())
        : rings;

    expect(fc.features).toHaveLength(77);
    for (const f of fc.features as Feature<Geometry>[]) {
      let rewound: Geometry = f.geometry;
      if (f.geometry.type === 'Polygon') {
        rewound = { type: 'Polygon', coordinates: rewindRings(f.geometry.coordinates) };
      } else if (f.geometry.type === 'MultiPolygon') {
        rewound = { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(rewindRings) };
      }
      const area = geoArea(rewound);
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(0.05);
    }
  });

  it('enforces 100% Arabic numerals and Anti-Stigma DDPM language across all 5 dimensions (R, H, E, V, C)', () => {
    const dims: readonly MapDimension[] = ['R', 'H', 'E', 'V', 'C'];
    for (const dim of dims) {
      const results = evaluateAllProvinces(PROVINCES_RISK_DATA, dim, 'composite', 'ddpm64');
      expect(results).toHaveLength(77);
      for (const r of results) {
        expect(THAI_NUMERAL_REGEX.test(r.summaryTh)).toBe(false);
        for (const phrase of BLACKLIST_PHRASES) {
          expect(r.summaryTh.includes(phrase)).toBe(false);
        }
      }
    }
  });

  it('maintains Blue->Red risk palette, Emerald Capacity palette, and OWASP-safe UTF-8 BOM CSV export', () => {
    expect(RISK_LEVEL_STYLES[1].mapFill).toBe('#2563EB');
    expect(RISK_LEVEL_STYLES[5].mapFill).toBe('#DC2626');
    expect(CAPACITY_LEVEL_STYLES[1].mapFill).toBe('#CBD5E1');
    expect(CAPACITY_LEVEL_STYLES[5].mapFill).toBe('#115E59');
    expect(CAPACITY_LEVEL_STYLES[1].labelTh.includes('ศักยภาพต่ำ')).toBe(false);

    expect(sanitizeCsvCell('=CMD|calc')).toBe(`"'=CMD|calc"`);
    const evals = evaluateAllProvinces(PROVINCES_RISK_DATA, 'R', 'composite', 'ddpm64');
    const csv = buildRiskCsvContent(evals);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.includes('c_cell_broadcast')).toBe(true);
    expect(csv.includes('c_ddpm_training')).toBe(true);
    expect(csv.includes('SIMULATED_MODEL')).toBe(true);
    expect(THAI_NUMERAL_REGEX.test(csv)).toBe(false);
  });
});
