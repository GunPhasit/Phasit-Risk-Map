import type {
  CapacityIndicatorId,
  ExposureIndicatorId,
  SubIndicatorDefinition,
  SubIndicatorId,
  VulnerabilityIndicatorId,
} from '../types/risk';

/**
 * ตัวชี้วัดย่อย 13 รายการ ตามกรอบแผนการป้องกันและบรรเทาสาธารณภัยแห่งชาติ พ.ศ. 2564-2570
 * ผลรวมค่าน้ำหนักในแต่ละปัจจัย (E, V, C) เท่ากับ 1.00
 */

export const EXPOSURE_INDICATORS: readonly SubIndicatorDefinition<ExposureIndicatorId>[] = [
  {
    id: 'e_pop_urban',
    pillar: 'E',
    nameTh: 'ความหนาแน่นประชากรและพื้นที่ชุมชนเมือง',
    shortNameTh: 'ประชากรและเมือง',
    weight: 0.30,
    unitHintTh: 'คนต่อตารางกิโลเมตร และสัดส่วนเขตเมือง',
    agencySourceTh: 'กรมการปกครอง / สำนักงานสถิติแห่งชาติ',
    descriptionTh: 'จำนวนประชากรและความหนาแน่นของชุมชนในพื้นที่ ซึ่งอาจได้รับผลกระทบพร้อมกันเมื่อเกิดภัย',
  },
  {
    id: 'e_economy_gpp',
    pillar: 'E',
    nameTh: 'มูลค่าผลิตภัณฑ์จังหวัด นิคมอุตสาหกรรม และพื้นที่เกษตรหลัก',
    shortNameTh: 'เศรษฐกิจ/นิคม/เกษตร',
    weight: 0.25,
    unitHintTh: 'ล้านบาทต่อปี และพื้นที่เศรษฐกิจหลัก',
    agencySourceTh: 'สำนักงานสภาพัฒนาการเศรษฐกิจและสังคมแห่งชาติ / กรมโรงงานอุตสาหกรรม',
    descriptionTh: 'ขนาดมูลค่าทางเศรษฐกิจ นิคมอุตสาหกรรม แหล่งท่องเที่ยว และพื้นที่เกษตรที่อยู่ในแนวเสี่ยงภัย',
  },
  {
    id: 'e_critical_infra',
    pillar: 'E',
    nameTh: 'โครงสร้างพื้นฐานสำคัญ (คมนาคม ไฟฟ้า ประปา โรงพยาบาล แหล่งน้ำ)',
    shortNameTh: 'โครงสร้างพื้นฐานสำคัญ',
    weight: 0.25,
    unitHintTh: 'จำนวนโครงข่ายคมนาคมและสาธารณูปโภคหลัก',
    agencySourceTh: 'กระทรวงคมนาคม / กฟภ. / กปภ. / กระทรวงสาธารณสุข',
    descriptionTh: 'ความหนาแน่นของถนนสายหลัก สนามบิน ท่าเรือ โรงพยาบาล และสาธารณูปโภคในพื้นที่เสี่ยง',
  },
  {
    id: 'e_hazard_zone_pop',
    pillar: 'E',
    nameTh: 'สัดส่วนชุมชนและพื้นที่เศรษฐกิจที่ตั้งในเขตเสี่ยงภัยซ้ำซาก',
    shortNameTh: 'ชุมชนในเขตเสี่ยงซ้ำซาก',
    weight: 0.20,
    unitHintTh: 'ร้อยละชุมชนในพื้นที่น้ำท่วม เชิงลาด และชายฝั่ง',
    agencySourceTh: 'ปภ. / GISTDA / กรมโยธาธิการและผังเมือง',
    descriptionTh: 'สัดส่วนพื้นที่อยู่อาศัยและย่านเศรษฐกิจที่ทับซ้อนกับพื้นที่เสี่ยงภัยธรรมชาติและเขตอุตสาหกรรม',
  },
];

export const VULNERABILITY_INDICATORS: readonly SubIndicatorDefinition<VulnerabilityIndicatorId>[] = [
  {
    id: 'v_vulnerable_groups',
    pillar: 'V',
    nameTh: 'สัดส่วนกลุ่มเปราะบาง (ผู้สูงอายุ 60 ปีขึ้นไป เด็กเล็ก คนพิการ และผู้ป่วยติดเตียง)',
    shortNameTh: 'ผู้สูงอายุ/เด็ก/คนพิการ',
    weight: 0.30,
    unitHintTh: 'ร้อยละประชากรกลุ่มเปราะบาง',
    agencySourceTh: 'กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์ / กรมการปกครอง',
    descriptionTh: 'ประชากรกลุ่มที่ต้องการความช่วยเหลือพิเศษในการเคลื่อนย้ายและการดูแลสุขภาพขณะเกิดสาธารณภัย',
  },
  {
    id: 'v_socio_economic',
    pillar: 'V',
    nameTh: 'ครัวเรือนรายได้น้อยและการพึ่งพาเกษตรนอกเขตชลประทาน',
    shortNameTh: 'เศรษฐกิจครัวเรือนเปราะบาง',
    weight: 0.25,
    unitHintTh: 'ร้อยละครัวเรือนเปราะบางทางรายได้',
    agencySourceTh: 'สำนักงานสภาพัฒนาการเศรษฐกิจและสังคมแห่งชาติ / กรมการพัฒนาชุมชน',
    descriptionTh: 'ข้อจำกัดด้านรายได้ของครัวเรือนและศักยภาพในการฟื้นตัวทางอาชีพหลังประสบภัย',
  },
  {
    id: 'v_housing_fragility',
    pillar: 'V',
    nameTh: 'สภาพความมั่นคงของที่อยู่อาศัยและอาคารในพื้นที่เสี่ยง',
    shortNameTh: 'ความมั่นคงที่อยู่อาศัย',
    weight: 0.25,
    unitHintTh: 'ร้อยละอาคารและบ้านเรือนกลุ่มเปราะบาง',
    agencySourceTh: 'กรมโยธาธิการและผังเมือง / อปท.',
    descriptionTh: 'สัดส่วนบ้านเรือนไม่มั่นคงถาวร ชุมชนริมน้ำ อาคารเก่าในเขตแผ่นดินไหว และที่พักเชิงลาดชัน',
  },
  {
    id: 'v_health_access',
    pillar: 'V',
    nameTh: 'ภาระโรคเรื้อรังและข้อจำกัดการเข้าถึงข้อมูลและบริการพื้นฐาน',
    shortNameTh: 'สุขภาพและการเข้าถึงบริการ',
    weight: 0.20,
    unitHintTh: 'อัตราโรคทางเดินหายใจและระยะทางเข้าถึงบริการ',
    agencySourceTh: 'กระทรวงสาธารณสุข / กสทช.',
    descriptionTh: 'อัตราผู้ป่วยโรคทางเดินหายใจและหลอดเลือด รวมถึงข้อจำกัดด้านระยะทางและภาษาในการรับสื่อแจ้งเตือนภัย',
  },
];

export const CAPACITY_INDICATORS: readonly SubIndicatorDefinition<CapacityIndicatorId>[] = [
  {
    id: 'c_cell_broadcast',
    pillar: 'C',
    nameTh: 'อัตราการเข้าถึงระบบแจ้งเตือนภัย Cell Broadcast ในจังหวัด',
    shortNameTh: 'การเข้าถึง Cell Broadcast',
    weight: 0.25,
    unitHintTh: 'ร้อยละความครอบคลุมสัญญาณ 4G/5G และอุปกรณ์รองรับ',
    agencySourceTh: 'ปภ. / กสทช. / กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม',
    descriptionTh: 'ความครอบคลุมของระบบแจ้งเตือนภัยฉุกเฉินผ่าน Cell Broadcast สู่โทรศัพท์เคลื่อนที่ของประชาชนในทุกอำเภอรวมถึงพื้นที่หุบเขา',
  },
  {
    id: 'c_ddpm_training',
    pillar: 'C',
    nameTh: 'การฝึกอบรมป้องกันและบรรเทาสาธารณภัย (ประชาชน อปพร. และชุมชนจัดการภัย)',
    shortNameTh: 'การฝึกอบรม ปภ./อปพร.',
    weight: 0.20,
    unitHintTh: 'สัดส่วนผู้ผ่านการฝึกอบรมและอาสาสมัครต่อประชากร',
    agencySourceTh: 'กรมป้องกันและบรรเทาสาธารณภัย / อปท.',
    descriptionTh: 'จำนวนและสัดส่วนประชาชน อาสาสมัคร อปพร. มิสเตอร์เตือนภัย และชุมชนจัดการภัยพิบัติที่ผ่านการอบรมและซ้อมแผนประจำปี',
  },
  {
    id: 'c_medical_ems',
    pillar: 'C',
    nameTh: 'ศักยภาพระบบการแพทย์ฉุกเฉินและสาธารณสุข (สพฉ. 1669 แพทย์ และเตียง)',
    shortNameTh: 'การแพทย์ฉุกเฉิน 1669',
    weight: 0.20,
    unitHintTh: 'แพทย์ เตียง และชุดปฏิบัติการกู้ชีพต่อ 100,000 คน',
    agencySourceTh: 'สถาบันการแพทย์ฉุกเฉินแห่งชาติ / กระทรวงสาธารณสุข',
    descriptionTh: 'ความพร้อมของโรงพยาบาล เตียงรองรับผู้ป่วยฉุกเฉิน ทีมกู้ชีพ 1669 และระยะเวลาเข้าถึงจุดเกิดเหตุ',
  },
  {
    id: 'c_eoc_machinery',
    pillar: 'C',
    nameTh: 'ความพร้อมศูนย์บัญชาการเหตุการณ์ (EOC) เครื่องจักรกล และศูนย์พักพิง',
    shortNameTh: 'ศูนย์ EOC/เครื่องจักรกล',
    weight: 0.20,
    unitHintTh: 'ความพร้อมเครื่องสูบน้ำ สะพานเบลีย์ และศูนย์พักพิงมาตรฐาน',
    agencySourceTh: 'สำนักงาน ปภ. จังหวัด / ศูนย์ ปภ. เขต 18 เขต',
    descriptionTh: 'ความพร้อมของเครื่องจักรกลสาธารณภัย รถกู้ภัย ระบบสื่อสารสำรอง และจำนวนศูนย์พักพิงชั่วคราวตามมาตรฐาน',
  },
  {
    id: 'c_local_plan_budget',
    pillar: 'C',
    nameTh: 'แผนเผชิญเหตุ อปท. เครือข่าย 8 หน่วยงาน และงบสำรองฉุกเฉิน',
    shortNameTh: 'แผน อปท. และงบฉุกเฉิน',
    weight: 0.15,
    unitHintTh: 'ร้อยละ อปท. ที่ซักซ้อมแผนประจำปีและมีความพร้อมด้านงบประมาณ',
    agencySourceTh: 'ปภ. / กรมส่งเสริมการปกครองท้องถิ่น',
    descriptionTh: 'ความครบถ้วนของแผนเผชิญเหตุระดับจังหวัดและท้องถิ่น การซักซ้อมแผนร่วม 8 หน่วยงาน และการเบิกจ่ายงบเชิงป้องกัน',
  },
];

export const ALL_SUB_INDICATORS: readonly SubIndicatorDefinition[] = [
  ...EXPOSURE_INDICATORS,
  ...VULNERABILITY_INDICATORS,
  ...CAPACITY_INDICATORS,
];

export const SUB_INDICATOR_BY_ID: Record<SubIndicatorId, SubIndicatorDefinition> =
  ALL_SUB_INDICATORS.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<SubIndicatorId, SubIndicatorDefinition>,
  );

export function getSubIndicatorsForPillar(
  pillar: 'E' | 'V' | 'C',
): readonly SubIndicatorDefinition[] {
  if (pillar === 'E') return EXPOSURE_INDICATORS;
  if (pillar === 'V') return VULNERABILITY_INDICATORS;
  return CAPACITY_INDICATORS;
}
