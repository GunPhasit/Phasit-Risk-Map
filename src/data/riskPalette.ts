import type { MapDimension, RiskLevel } from '../types/risk';

export interface RiskLevelStyle {
  readonly level: RiskLevel;
  readonly labelTh: string;
  readonly shortLabelTh: string;
  readonly rangeLabel: string;
  readonly actionToneTh: string;
  readonly mapFill: string;
  readonly badgeBg: string;
  readonly badgeText: string;
  readonly tintBg: string;
  readonly tintText: string;
  readonly tintBorder: string;
  readonly symbol: string;
  readonly patternId: string;
}

/**
 * ระบบสีความเสี่ยง 5 ระดับ (สำหรับ R, H, E, V — คะแนนสูง = ความเสี่ยงสูงขึ้น):
 * น้ำเงิน (1) -> เขียว (2) -> เหลือง (3) -> ส้ม (4) -> แดง (5)
 * คู่สีข้อความทั้งหมดผ่านเกณฑ์ WCAG 2.1 AA (Contrast >= 4.5:1)
 */
export const RISK_LEVEL_STYLES: Record<RiskLevel, RiskLevelStyle> = {
  1: {
    level: 1,
    labelTh: 'ต่ำมาก (สภาวะปกติ)',
    shortLabelTh: 'ต่ำมาก',
    rangeLabel: '1.00 - 1.79',
    actionToneTh: 'ติดตามข้อมูลข่าวสารตามปกติ',
    mapFill: '#2563EB',
    badgeBg: '#1D4ED8',
    badgeText: '#FFFFFF',
    tintBg: '#EFF6FF',
    tintText: '#1E40AF',
    tintBorder: '#93C5FD',
    symbol: '●',
    patternId: 'risk-pattern-1',
  },
  2: {
    level: 2,
    labelTh: 'ต่ำ (เฝ้าระวังเบื้องต้น)',
    shortLabelTh: 'ต่ำ',
    rangeLabel: '1.80 - 2.59',
    actionToneTh: 'รับทราบข้อมูลและเตรียมความพร้อมพื้นฐาน',
    mapFill: '#16A34A',
    badgeBg: '#15803D',
    badgeText: '#FFFFFF',
    tintBg: '#F0FDF4',
    tintText: '#166534',
    tintBorder: '#86EFAC',
    symbol: '■',
    patternId: 'risk-pattern-2',
  },
  3: {
    level: 3,
    labelTh: 'ปานกลาง (เฝ้าระวัง)',
    shortLabelTh: 'ปานกลาง',
    rangeLabel: '2.60 - 3.39',
    actionToneTh: 'เพิ่มความระมัดระวังและติดตามประกาศจากทางราชการ',
    mapFill: '#EAB308',
    badgeBg: '#FACC15',
    badgeText: '#422006',
    tintBg: '#FEFCE8',
    tintText: '#854D0E',
    tintBorder: '#FDE047',
    symbol: '◆',
    patternId: 'risk-pattern-3',
  },
  4: {
    level: 4,
    labelTh: 'สูง (เตือนภัย)',
    shortLabelTh: 'สูง',
    rangeLabel: '3.40 - 4.19',
    actionToneTh: 'เตรียมความพร้อมรับมือและวางแผนป้องกันล่วงหน้า',
    mapFill: '#F97316',
    badgeBg: '#C2410C',
    badgeText: '#FFFFFF',
    tintBg: '#FFF7ED',
    tintText: '#9A3412',
    tintBorder: '#FDBA74',
    symbol: '▲',
    patternId: 'risk-pattern-4',
  },
  5: {
    level: 5,
    labelTh: 'สูงมาก (เฝ้าระวังพิเศษ)',
    shortLabelTh: 'สูงมาก',
    rangeLabel: '4.20 - 5.00',
    actionToneTh: 'พื้นที่เฝ้าระวังเป็นพิเศษ ติดตามและปฏิบัติตามคำแนะนำของหน่วยงานรัฐอย่างใกล้ชิด',
    mapFill: '#DC2626',
    badgeBg: '#B91C1C',
    badgeText: '#FFFFFF',
    tintBg: '#FEF2F2',
    tintText: '#991B1B',
    tintBorder: '#FCA5A5',
    symbol: '⬢',
    patternId: 'risk-pattern-5',
  },
};

/**
 * ระบบสีเฉพาะโทนมรกต 5 เฉด สำหรับมิติศักยภาพในการจัดการความเสี่ยง (C)
 * อ่อน -> เข้ม (ยิ่งเข้ม = ยิ่งมีศักยภาพสูง ช่วยลดความเสี่ยงสุทธิ R ได้มาก)
 * ใช้ถ้อยคำเชิงสร้างสรรค์ไม่ตีตราจังหวัด (Anti-Stigma) และผ่าน WCAG 2.1 AA ทุกคู่สี
 */
export const CAPACITY_LEVEL_STYLES: Record<RiskLevel, RiskLevelStyle> = {
  1: {
    level: 1,
    labelTh: 'พื้นที่เป้าหมายเสริมสร้างศักยภาพเร่งด่วน',
    shortLabelTh: 'เร่งเสริมศักยภาพ',
    rangeLabel: '1.00 - 1.79',
    actionToneTh: 'พื้นที่เป้าหมายลำดับแรกในการสนับสนุนระบบเตือนภัย การอบรม และเครื่องจักรกล',
    mapFill: '#CBD5E1',
    badgeBg: '#475569',
    badgeText: '#FFFFFF',
    tintBg: '#F1F5F9',
    tintText: '#334155',
    tintBorder: '#94A3B8',
    symbol: '○',
    patternId: 'cap-pattern-1',
  },
  2: {
    level: 2,
    labelTh: 'พื้นที่เป้าหมายเสริมสร้างศักยภาพ',
    shortLabelTh: 'เสริมศักยภาพ',
    rangeLabel: '1.80 - 2.59',
    actionToneTh: 'ควรเพิ่มความครอบคลุม Cell Broadcast และการฝึกอบรมเครือข่าย อปพร./ชุมชน',
    mapFill: '#99F6E4',
    badgeBg: '#0F766E',
    badgeText: '#FFFFFF',
    tintBg: '#CCFBF1',
    tintText: '#115E59',
    tintBorder: '#5EEAD4',
    symbol: '◔',
    patternId: 'cap-pattern-2',
  },
  3: {
    level: 3,
    labelTh: 'ศักยภาพระดับมาตรฐาน',
    shortLabelTh: 'มาตรฐาน',
    rangeLabel: '2.60 - 3.39',
    actionToneTh: 'มีความพร้อมตามมาตรฐานพื้นฐาน ควรซักซ้อมแผนเผชิญเหตุอย่างสม่ำเสมอ',
    mapFill: '#2DD4BF',
    badgeBg: '#0F766E',
    badgeText: '#FFFFFF',
    tintBg: '#99F6E4',
    tintText: '#134E4A',
    tintBorder: '#2DD4BF',
    symbol: '◑',
    patternId: 'cap-pattern-3',
  },
  4: {
    level: 4,
    labelTh: 'ศักยภาพระดับเข้มแข็ง',
    shortLabelTh: 'เข้มแข็ง',
    rangeLabel: '3.40 - 4.19',
    actionToneTh: 'มีระบบเตือนภัย ศูนย์ EOC และการแพทย์ฉุกเฉินพร้อมลดผลกระทบได้ดี',
    mapFill: '#0D9488',
    badgeBg: '#0F766E',
    badgeText: '#FFFFFF',
    tintBg: '#CCFBF1',
    tintText: '#115E59',
    tintBorder: '#0D9488',
    symbol: '◕',
    patternId: 'cap-pattern-4',
  },
  5: {
    level: 5,
    labelTh: 'ศักยภาพต้นแบบ',
    shortLabelTh: 'ต้นแบบ',
    rangeLabel: '4.20 - 5.00',
    actionToneTh: 'มีความพร้อมสูงรอบด้านและสามารถสนับสนุนจังหวัดใกล้เคียงในภาวะสาธารณภัยได้',
    mapFill: '#115E59',
    badgeBg: '#115E59',
    badgeText: '#FFFFFF',
    tintBg: '#F0FDFA',
    tintText: '#115E59',
    tintBorder: '#0F766E',
    symbol: '★',
    patternId: 'cap-pattern-5',
  },
};

export function getPaletteForDimension(dimension: MapDimension): Record<RiskLevel, RiskLevelStyle> {
  return dimension === 'C' ? CAPACITY_LEVEL_STYLES : RISK_LEVEL_STYLES;
}

export const MAP_DIMENSION_META: Record<
  MapDimension,
  {
    readonly id: MapDimension;
    readonly code: string;
    readonly nameTh: string;
    readonly shortNameTh: string;
    readonly directionTagTh: string;
    readonly summaryTh: string;
  }
> = {
  R: {
    id: 'R',
    code: 'R',
    nameTh: 'ความเสี่ยงสุทธิ',
    shortNameTh: 'เสี่ยงสุทธิ',
    directionTagTh: 'เพิ่มจากภัย ล่อแหลม เปราะบาง และลดจากศักยภาพ',
    summaryTh: 'ดัชนีความเสี่ยงสุทธิตามแผน ปภ. ชาติ พ.ศ. 2564-2570 ประเมินจากภัยคุกคาม ความล่อแหลม ความเปราะบาง และหักลดด้วยศักยภาพพื้นที่',
  },
  H: {
    id: 'H',
    code: 'H',
    nameTh: 'ภัยคุกคาม',
    shortNameTh: 'ภัยคุกคาม',
    directionTagTh: 'ยิ่งสูง ความเสี่ยงยิ่งเพิ่ม',
    summaryTh: 'ความรุนแรงและความถี่ของสาธารณภัยทั้ง 10 ประเภท',
  },
  E: {
    id: 'E',
    code: 'E',
    nameTh: 'ความล่อแหลม',
    shortNameTh: 'ความล่อแหลม',
    directionTagTh: 'ยิ่งสูง ความเสี่ยงยิ่งเพิ่ม',
    summaryTh: 'ประชากร เศรษฐกิจ โครงสร้างพื้นฐาน และชุมชนที่ตั้งอยู่ในเขตเสี่ยงภัย (4 ตัวชี้วัด)',
  },
  V: {
    id: 'V',
    code: 'V',
    nameTh: 'ความเปราะบาง',
    shortNameTh: 'ความเปราะบาง',
    directionTagTh: 'ยิ่งสูง ความเสี่ยงยิ่งเพิ่ม',
    summaryTh: 'กลุ่มเปราะบาง ฐานะเศรษฐกิจครัวเรือน สภาพที่อยู่อาศัย และข้อจำกัดด้านสุขภาพ (4 ตัวชี้วัด)',
  },
  C: {
    id: 'C',
    code: 'C',
    nameTh: 'ศักยภาพพื้นที่',
    shortNameTh: 'ศักยภาพ',
    directionTagTh: 'ยิ่งสูง ความเสี่ยงยิ่งลดลง',
    summaryTh: 'ความพร้อมด้าน Cell Broadcast การฝึกอบรม ปภ. การแพทย์ฉุกเฉิน 1669 ศูนย์ EOC และแผน อปท. (5 ตัวชี้วัด)',
  },
};

export const MAP_DIMENSIONS_ORDER: readonly MapDimension[] = ['R', 'H', 'E', 'V', 'C'];

export const NA_RISK_STYLE = {
  labelTh: 'ไม่เข้าข่ายเชิงภูมิศาสตร์ (N/A)',
  shortLabelTh: 'N/A',
  rangeLabel: 'ไม่มีพื้นที่เสี่ยงกายภาพ',
  mapFill: '#E2E8F0',
  badgeBg: '#E2E8F0',
  badgeText: '#334155',
  tintBg: '#F1F5F9',
  tintText: '#475569',
  tintBorder: '#CBD5E1',
  symbol: '—',
  patternId: 'risk-pattern-na',
} as const;

export const RISK_LEVEL_LIST: readonly RiskLevel[] = [1, 2, 3, 4, 5];

export const REGION6_LABELS: Record<
  'north' | 'northeast' | 'central' | 'east' | 'west' | 'south',
  string
> = {
  north: 'ภาคเหนือ',
  northeast: 'ภาคตะวันออกเฉียงเหนือ',
  central: 'ภาคกลาง',
  east: 'ภาคตะวันออก',
  west: 'ภาคตะวันตก',
  south: 'ภาคใต้',
};

export const REGION_FILTER_OPTIONS = [
  { key: 'all', labelTh: 'ทั้งประเทศ (77)' },
  { key: 'bma6', labelTh: 'กทม. และปริมณฑล (6)' },
  { key: 'north', labelTh: 'ภาคเหนือ (9)' },
  { key: 'northeast', labelTh: 'ภาคตะวันออกเฉียงเหนือ (20)' },
  { key: 'central', labelTh: 'ภาคกลาง (22)' },
  { key: 'east', labelTh: 'ภาคตะวันออก (7)' },
  { key: 'west', labelTh: 'ภาคตะวันตก (5)' },
  { key: 'south', labelTh: 'ภาคใต้ (14)' },
] as const;
