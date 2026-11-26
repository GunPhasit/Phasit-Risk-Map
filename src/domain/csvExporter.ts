import { HAZARD_BY_ID, HAZARD_CATALOG } from '../data/hazardCatalog';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../data/indicatorCatalog';
import { getPaletteForDimension, REGION6_LABELS } from '../data/riskPalette';
import type { ProvinceEvaluation } from '../types/risk';

export const MODEL_VERSION = '2026.2-DDPM64-70-SIMULATED';

/**
 * ป้องกัน CSV Formula Injection ตามมาตรฐาน OWASP
 * และครอบฟิลด์ตามมาตรฐาน RFC 4180
 */
export function sanitizeCsvCell(rawValue: string | number | null | undefined): string {
  if (rawValue === null || rawValue === undefined) {
    return '""';
  }
  let text = String(rawValue);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildRiskCsvContent(
  evaluations: readonly ProvinceEvaluation[],
  periodId = '2569-Q3',
): string {
  const headers = [
    'reporting_period',
    'rank',
    'dopa_code',
    'iso_3166_2',
    'province_th',
    'province_en',
    'region_6_standard',
    'active_dimension',
    'active_layer',
    'active_sub_indicator',
    'composite_mode',
    'active_score',
    'active_level',
    'active_level_label_th',
    'R_ddpm_64_70',
    'R_gross_before_C',
    'C_impact_delta',
    'H_composite',
    'E_exposure',
    'V_vulnerability',
    'C_capacity',
    'dominant_hazard_th',
    ...HAZARD_CATALOG.map((h) => `H_${h.id}`),
    ...EXPOSURE_INDICATORS.map((e) => e.id),
    ...VULNERABILITY_INDICATORS.map((v) => v.id),
    ...CAPACITY_INDICATORS.map((c) => c.id),
    'is_what_if_simulated',
    'data_status',
    'model_version',
  ];

  const rows = evaluations.map((ev) => {
    const palette = getPaletteForDimension(ev.activeDimension);
    const levelLabel =
      ev.level !== null ? palette[ev.level].labelTh : 'ไม่เข้าข่ายเชิงภูมิศาสตร์ (N/A)';

    const hazardScores = HAZARD_CATALOG.map((h) => {
      const entry = ev.province.hazards[h.id];
      return entry.applicable && entry.score !== null ? entry.score.toFixed(2) : 'N/A';
    });

    const eScores = EXPOSURE_INDICATORS.map((e) =>
      ev.province.exposureIndicators[e.id].toFixed(2),
    );
    const vScores = VULNERABILITY_INDICATORS.map((v) =>
      ev.province.vulnerabilityIndicators[v.id].toFixed(2),
    );
    const cScores = CAPACITY_INDICATORS.map((c) =>
      ev.breakdown.effectiveCapacityIndicators[c.id].toFixed(2),
    );

    const cols: Array<string | number> = [
      periodId,
      ev.rank,
      ev.province.dopaCode,
      ev.province.isoCode,
      ev.province.nameTh,
      ev.province.nameEn,
      REGION6_LABELS[ev.province.region6],
      ev.activeDimension,
      ev.activeLayer,
      ev.activeSubIndicator ?? 'ALL',
      ev.compositeMode,
      ev.score !== null ? ev.score.toFixed(2) : 'N/A',
      ev.level !== null ? ev.level : 'N/A',
      levelLabel,
      ev.ddpmScore.toFixed(2),
      ev.grossScore.toFixed(2),
      ev.breakdown.cImpactDelta !== null ? ev.breakdown.cImpactDelta.toFixed(2) : 'N/A',
      ev.breakdown.hazardCompositeScore.toFixed(2),
      ev.breakdown.exposureScore.toFixed(2),
      ev.breakdown.vulnerabilityScore.toFixed(2),
      ev.breakdown.effectiveCapacityScore.toFixed(2),
      HAZARD_BY_ID[ev.breakdown.dominantHazardId].nameTh,
      ...hazardScores,
      ...eScores,
      ...vScores,
      ...cScores,
      ev.breakdown.isSimulated ? 'WHAT_IF_SIMULATED' : 'BASELINE',
      'SIMULATED_MODEL',
      MODEL_VERSION,
    ];

    return cols.map(sanitizeCsvCell).join(',');
  });

  // ใส่ UTF-8 BOM (\uFEFF) หน้าสุดเสมอ เพื่อให้เปิดใน Microsoft Excel ภาษาไทยไม่เพี้ยน
  return `\uFEFF${headers.map(sanitizeCsvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

export function triggerCsvDownload(
  evaluations: readonly ProvinceEvaluation[],
  filenamePrefix: string,
  periodId = '2569-Q3',
): void {
  const csvContent = buildRiskCsvContent(evaluations, periodId);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenamePrefix}-${periodId}-ddpm6470-${dateStamp}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
