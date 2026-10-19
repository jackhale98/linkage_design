// Fails if the gzipped JS + CSS shipped to the browser exceeds the budget in docs/DESIGN.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const dir = 'dist/assets';
let total = 0;
for (const f of readdirSync(dir)) {
  if (!/\.(js|css)$/.test(f)) continue;
  const kb = gzipSync(readFileSync(join(dir, f))).length / 1024;
  total += kb;
  console.log(`${f.padEnd(40)} ${kb.toFixed(1).padStart(7)} KB gz`);
}
console.log(`${'total'.padEnd(40)} ${total.toFixed(1).padStart(7)} KB gz (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`Bundle exceeds budget by ${(total - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
