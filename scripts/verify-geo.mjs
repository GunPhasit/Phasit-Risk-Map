import fs from 'node:fs';
import path from 'node:path';

const topoPath = path.resolve(process.cwd(), 'src/data/thailand-provinces.topo.json');

if (!fs.existsSync(topoPath)) {
  console.error('Missing TopoJSON file at:', topoPath);
  process.exit(1);
}

const stats = fs.statSync(topoPath);
const sizeKb = stats.size / 1024;
const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
const geometries = topo?.objects?.provinces?.geometries ?? [];

if (geometries.length !== 77) {
  console.error(`Expected 77 provinces, found ${geometries.length}`);
  process.exit(1);
}

const codes = new Set(geometries.map((g) => String(g.properties?.dopaCode ?? '')));
if (codes.size !== 77) {
  console.error(`Expected 77 unique DOPA codes, found ${codes.size}`);
  process.exit(1);
}

if (!codes.has('38')) {
  console.error('Missing Bueng Kan (DOPA code 38 / TH-38)!');
  process.exit(1);
}

console.log(`Geo integrity OK: 77 provinces verified (including Bueng Kan 38), TopoJSON size = ${sizeKb.toFixed(1)} KB`);
if (sizeKb > 150) {
  console.warn(`Warning: TopoJSON size (${sizeKb.toFixed(1)} KB) exceeds 150 KB target.`);
}
