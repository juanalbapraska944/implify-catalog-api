// scripts/enrich-connections.js
// Usage: node scripts/enrich-connections.js
import fs from "fs";
import path from "path";
import readline from "readline";

const SRC = path.resolve("public/products.jsonl");
const OUT = path.resolve("public/products.enriched.jsonl");

// Normalize decimals and extract number
function toNum(x){
  if (x == null) return null;
  const s = String(x).replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function approxEq(a,b){
  const na = toNum(a), nb = toNum(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na-nb) < 0.11;
}
function getPartDiameter(r){
  if (r.diameter_mm != null && r.diameter_mm !== "") return toNum(r.diameter_mm);
  if (r.diameter_text) return toNum(r.diameter_text);
  return null;
}
function normStr(v){ return (v ?? "").toString().trim(); }

// Strict parser for **implant connection** from fields + name
function deriveConnectionMM(r){
  // If an explicit field already exists, respect it
  if (r.connection_mm != null && r.connection_mm !== "") return toNum(r.connection_mm);

  // Known platform defaults (extend as needed)
  // NOTE: these are safe only when the platform family truly fixes the connection
  const plat = normStr(r.platform).toUpperCase();
  if (plat === "P06") return 4.1; // Certain 4.1 family
  if (plat === "P07") return 5.0; // Certain 5.0 family

  // Parse from name fields
  const name = [r.name_de, r.name_long_de, r.Artikel_Name, r.Artikel_Name_long]
    .map(normStr).filter(Boolean).join(" | ");

  // Prefer parentheses segments with interface keywords
  const parens = Array.from(name.matchAll(/\(([^)]+)\)/g)).map(m => m[1]);
  const pools = parens.length ? parens : [name];

  const mm = [];
  const kw = /(ext\s*hex|certain|internal|external|eztetic|tsx|platform|hex|connection)/i;
  for (const seg of pools) {
    if (kw.test(seg)) {
      seg.replace(/(\d+[.,]\d+|\d+)\s*mm/gi, (m) => { const n = toNum(m); if (n!=null) mm.push(n); return m; });
    }
  }
  if (!mm.length) {
    name.replace(/(\d+[.,]\d+|\d+)\s*mm/gi, (m) => { const n = toNum(m); if (n!=null) mm.push(n); return m; });
  }

  const partDia = getPartDiameter(r);
  const filtered = mm.filter(v =>
    (partDia==null || !approxEq(v, partDia)) &&
    v >= 3.0 && v <= 6.5 // plausible connection range
  );

  // Whitelist real connection sizes; snap 3.75
  const allow = new Set(["3.3","3.4","3.5","3.75","4.1","4.5","4.8","5.0","5.5","5.7"]);
  function normConn(v){
    if (Math.abs(v - 3.75) < 0.06) return 3.75;
    return Math.round(v * 10) / 10;
  }
  for (const v of filtered) {
    const vv = normConn(v);
    if (allow.has(vv.toFixed(2)) || allow.has(vv.toFixed(1))) {
      return vv;
    }
  }
  return null;
}

async function run(){
  if (!fs.existsSync(SRC)) {
    console.error("File not found:", SRC);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: fs.createReadStream(SRC, "utf8"), crlfDelay: Infinity });
  const out = fs.createWriteStream(OUT, "utf8");

  let total=0, set=0;
  for await (const line of rl) {
    const s = line.trim();
    if (!s || !s.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(s); } catch { continue; }
    total++;

    const conn = deriveConnectionMM(obj);
    if (conn != null) {
      obj.connection_mm = conn; // write explicit field
      set++;
    }

    out.write(JSON.stringify(obj) + "\n");
  }
  out.end();
  console.log(`Enriched ${set}/${total} items. Wrote → ${OUT}`);
}

run().catch(e => { console.error(e); process.exit(1); });
