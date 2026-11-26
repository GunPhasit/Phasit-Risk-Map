import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const rawPath = path.resolve(root, 'scripts/raw-districts.json');
const outPath = path.resolve(root, 'server/data/thailand-districts.json');

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const COASTAL_PROVINCES = new Set([
  '10', '11', '20', '21', '22', '23', '24', '74', '75', '76', '77',
  '80', '81', '82', '83', '84', '85', '86', '90', '91', '92', '94', '96',
]);

const MOUNTAIN_PROVINCES = new Set([
  '42', '50', '51', '52', '53', '54', '55', '56', '57', '58', '63', '67', '71',
]);

const RIVER_BASIN_PROVINCES = new Set([
  '12', '13', '14', '15', '16', '17', '18', '19', '25', '26',
  '33', '34', '40', '45', '60', '61', '65', '66', '72', '73',
  '80', '84', '90', '94', '95', '96',
]);

const MAJOR_URBAN_NAMES = [
  'หาดใหญ่', 'ศรีราชา', 'บางละมุง', 'ปากเกร็ด', 'ธัญบุรี', 'คลองหลวง',
  'ลำลูกกา', 'บางพลี', 'พระประแดง', 'กระทุ่มแบน', 'เกาะสมุย', 'กะทู้',
  'ถลาง', 'แม่สอด', 'หัวหิน', 'ชะอำ', 'ปากช่อง', 'วารินชำราบ',
  'สันทราย', 'หางดง', 'สารภี', 'แม่ริม', 'บ้านฉาง', 'ปลวกแดง',
];

const COASTAL_KEYWORDS = [
  'เกาะ', 'บางขุนเทียน', 'พระสมุทรเจดีย์', 'บางบ่อ', 'บางปะกง',
  'ศรีราชา', 'บางละมุง', 'สัตหีบ', 'บ้านฉาง', 'แกลง', 'ท่าใหม่',
  'แหลมสิงห์', 'คลองใหญ่', 'ชะอำ', 'หัวหิน', 'ปราณบุรี', 'สามร้อยยอด',
  'กุยบุรี', 'ทับสะแก', 'บางสะพาน', 'ปะทิว', 'หลังสวน', 'ละแม',
  'ไชยา', 'ท่าชนะ', 'กาญจนดิษฐ์', 'ดอนสัก', 'ขนอม', 'สิชล', 'ท่าศาลา',
  'ปากพนัง', 'หัวไทร', 'ระโนด', 'สทิงพระ', 'สิงหนคร', 'จะนะ', 'เทพา',
  'หนองจิก', 'ยะหริ่ง', 'ปะนาเระ', 'สายบุรี', 'ไม้แก่น', 'บาเจาะ', 'ตากใบ',
  'กะเปอร์', 'สุขสำราญ', 'คุระบุรี', 'ตะกั่วป่า', 'ท้ายเหมือง', 'ตะกั่วทุ่ง',
  'กะทู้', 'ถลาง', 'อ่าวลึก', 'เหนือคลอง', 'คลองท่อม', 'สิเกา', 'กันตัง',
  'ปะเหลียน', 'หาดสำราญ', 'ทุ่งหว้า', 'ละงู', 'ท่าแพ',
];

const MOUNTAIN_KEYWORDS = [
  'แม่', 'อมก๋อย', 'ฝาง', 'ไชยปราการ', 'เชียงดาว', 'พร้าว', 'สะเมิง', 'กัลยาณิวัฒนา',
  'ปาย', 'ปางมะผ้า', 'สบเมย', 'ขุนยวม', 'อุ้มผาง', 'ท่าสองยาง', 'พบพระ',
  'ทองผาภูมิ', 'สังขละบุรี', 'ศรีสวัสดิ์', 'บ่อเกลือ', 'เฉลิมพระเกียรติ', 'ปัว',
  'สองแคว', 'ทุ่งช้าง', 'เชียงของ', 'เวียงแก่น', 'เทิง', 'เขาค้อ', 'น้ำหนาว',
  'ด่านซ้าย', 'ภูเรือ', 'นาแห้ว', 'ภูหลวง', 'เบตง', 'ธารโต', 'จะแนะ', 'สุคิริน',
];

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

const activeDistricts = raw
  .filter((d) => {
    if (d.deleted_at) return false;
    const code = String(d.id).padStart(4, '0');
    if (code.length !== 4) return false;
    const suffix = Number(code.slice(2));
    // กรองรหัสท้องถิ่นเทศบาลพิเศษ (suffix > 50 เช่น 7074, 9077) ออก คงเฉพาะ 928 อำเภอ/เขตมาตรฐาน มท.
    if (suffix < 1 || suffix > 50) return false;
    return true;
  })
  .map((d) => {
    const code = String(d.id).padStart(4, '0');
    const provinceCode = code.slice(0, 2);
    const suffix = Number(code.slice(2));
    const prefixTh = String(d.prefix?.th ?? (provinceCode === '10' ? 'เขต' : 'อำเภอ')).trim();
    const nameTh = String(d.name?.th ?? '').trim();
    const nameEn = String(d.name?.en ?? '').trim();
    const fullNameTh = `${prefixTh}${nameTh}`;

    let geoClass = 'rural';
    if (provinceCode === '10') {
      geoClass = code === '1021' ? 'coastal' : 'metro';
    } else if (suffix === 1 || nameTh.startsWith('เมือง') || MAJOR_URBAN_NAMES.some((n) => nameTh.includes(n))) {
      geoClass = 'metro';
    } else if (COASTAL_PROVINCES.has(provinceCode) && COASTAL_KEYWORDS.some((k) => nameTh.includes(k))) {
      geoClass = 'coastal';
    } else if (MOUNTAIN_PROVINCES.has(provinceCode) && MOUNTAIN_KEYWORDS.some((k) => nameTh.includes(k))) {
      geoClass = 'mountain';
    } else if (MOUNTAIN_PROVINCES.has(provinceCode) && hashCode(code) > 0.45) {
      geoClass = 'mountain';
    } else if (RIVER_BASIN_PROVINCES.has(provinceCode) && hashCode(code) > 0.35) {
      geoClass = 'river_basin';
    }

    const jitter = 0.85 + hashCode(`pop-${code}`) * 0.35;
    let popWeight = 1.0 * jitter;
    if (provinceCode === '10') {
      popWeight = 1.0 + hashCode(`bkk-${code}`) * 0.9;
    } else if (suffix === 1 || nameTh.startsWith('เมือง')) {
      popWeight = 2.15 + hashCode(`cap-${code}`) * 0.4;
    } else if (geoClass === 'metro') {
      popWeight = 1.65 + hashCode(`hub-${code}`) * 0.35;
    } else if (geoClass === 'mountain') {
      popWeight = 0.62 + hashCode(`mnt-${code}`) * 0.25;
    }

    return {
      code,
      provinceCode,
      prefixTh,
      nameTh,
      fullNameTh,
      nameEn,
      geoClass,
      popWeight: Math.round(popWeight * 100) / 100,
    };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const provSet = new Set(activeDistricts.map((d) => d.provinceCode));
if (provSet.size !== 77) {
  throw new Error(`Expected 77 provinces, found ${provSet.size}`);
}
if (activeDistricts.length !== 928) {
  throw new Error(`Expected exactly 928 districts (878 amphoe + 50 BMA khet), found ${activeDistricts.length}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(activeDistricts), 'utf8');
const kb = fs.statSync(outPath).size / 1024;
console.log(`Built ${outPath}: ${activeDistricts.length} districts across ${provSet.size} provinces (${kb.toFixed(1)} KB)`);

fs.unlinkSync(rawPath);
console.log('Cleaned up scripts/raw-districts.json');
