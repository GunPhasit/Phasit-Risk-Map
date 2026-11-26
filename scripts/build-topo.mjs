import fs from 'node:fs';
import path from 'node:path';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';

const root = process.cwd();
const rawPath = path.resolve(root, 'scripts/raw-provinces.geojson');
const outPath = path.resolve(root, 'src/data/thailand-provinces.topo.json');

const geo = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

if (!Array.isArray(geo.features) || geo.features.length !== 77) {
  throw new Error(`Expected 77 features in raw GeoJSON, got ${geo.features?.length}`);
}

const normalizedGeo = {
  type: 'FeatureCollection',
  features: geo.features.map((f) => {
    const code = String(f.properties.code).padStart(2, '0');
    return {
      type: 'Feature',
      id: code,
      properties: {
        dopaCode: code,
        isoCode: `TH-${code}`,
        nameTh: String(f.properties.name_th ?? '').trim(),
        nameEn: String(f.properties.name_en ?? '').trim(),
      },
      geometry: f.geometry,
    };
  }),
};

// แปลงเป็น TopoJSON พร้อม Quantization 1e4 และลดจุดยอดแบบรักษาความต่อสนิทของขอบเขตจังหวัด
let topo = topology({ provinces: normalizedGeo }, 1e4);
topo = presimplify(topo);
const minWeight = quantile(topo, 0.045);
topo = simplify(topo, minWeight);

// ลบ property ที่ไม่จำเป็นและเขียนไฟล์แบบกระชับ
const outputJson = JSON.stringify(topo);
fs.writeFileSync(outPath, outputJson, 'utf8');

const sizeKb = Buffer.byteLength(outputJson, 'utf8') / 1024;
console.log(`Built ${outPath} (${sizeKb.toFixed(1)} KB, ${topo.objects.provinces.geometries.length} provinces)`);

// ลบไฟล์ raw GeoJSON ขนาดใหญ่หลังแปลงเสร็จเพื่อให้โปรเจกต์สะอาด
fs.unlinkSync(rawPath);
console.log('Removed temporary raw-provinces.geojson');
