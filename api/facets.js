// api/facets.js
export const config = { runtime: "edge", regions: ["fra1"] };

let CACHE = { products: null };

async function loadProducts(req) {
  if (CACHE.products) return CACHE.products;
  const origin = new URL(req.url).origin;
  const fileUrl = `${origin}/products.jsonl`;
  const res = await fetch(fileUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load products.jsonl (${res.status})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  const items = [];
  for (const line of lines) { try { items.push(JSON.parse(line)); } catch (_) {} }
  if (!items.length) throw new Error("No products parsed");
  CACHE.products = items;
  return items;
}

// ---------- utils ----------
function norm(v){ return (v ?? "").toString().trim(); }
function lower(v){ return norm(v).toLowerCase(); }
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
function normPlatform(p){
  const s = norm(p).toUpperCase().replace(/\s+/g,"");
  const m = s.match(/^P?(\d{1,2})$/);
  return m ? `P${String(parseInt(m[1],10)).padStart(2,"0")}` : (s || null);
}
function parseRotation(val){
  const s = lower(val);
  if (!s) return "";
  if (/\b(with|mit|ja|yes|rotation|r-?schutz)\b/.test(s)) return "with";
  if (/\b(without|ohne|nein|no)\b/.test(s)) return "without";
  return "";
}
function getPartDiameter(r){
  if (r.diameter_mm != null && r.diameter_mm !== "") return toNum(r.diameter_mm);
  if (r.diameter_text) return toNum(r.diameter_text);
  return null;
}

// Derive the IMPLANT CONNECTION size (mm) from structured + name fields
function deriveConnectionMM(r, hintGingiva){
  // explicit field (if present)
  let cand = toNum(r.Platfform_Prothetikdurchmesser || r.plattform_prothetikdurchmesser || r.platform_prothetikdurchmesser);
  if (cand) return cand;

  const name = [r.name_de, r.name_long_de, r.Artikel_Name, r.Artikel_Name_long]
    .map(norm).filter(Boolean).join(" | ");

  // prioritize parentheses segments with interface keywords
  const parens = Array.from(name.matchAll(/\(([^)]+)\)/g)).map(m => m[1]);
  const pools = parens.length ? parens : [name];

  const mm = [];
  const kw = /(ext\s*hex|certain|internal|external|eztetic|tsx|platform|hex)/i;
  for (const seg of pools) {
    if (kw.test(seg)) {
      seg.replace(/(\d+[.,]\d+|\d+)\s*mm/gi, (m) => { const n = toNum(m); if (n!=null) mm.push(n); return m; });
    }
  }
  if (!mm.length) {
    name.replace(/(\d+[.,]\d+|\d+)\s*mm/gi, (m) => { const n = toNum(m); if (n!=null) mm.push(n); return m; });
  }

  // drop prosthetic/gingiva numbers; keep plausible connection range
  const partDia = getPartDiameter(r);
  const hint = toNum(hintGingiva);
  const filtered = mm.filter(v =>
    (partDia==null || !approxEq(v, partDia)) &&
    (hint==null || !approxEq(v, hint)) &&
    v >= 3.0 && v <= 6.5
  );

  if (filtered.length) return filtered[0];
  if (!partDia && mm.length === 1) return mm[0];
  return null;
}

function applyFilters(items, p) {
  const q = lower(p.get("q"));
  const platformIn = p.get("platform");
  const group = lower(p.get("group"));
  const prodGroup = lower(p.get("product_group"));

  const diameter = p.get("diameter_mm");          // part's prosthetic diameter
  const length = p.get("length_mm");
  const gingiva = p.get("gingiva_mm");
  const angulation = p.get("angulation_deg");

  const connection = p.get("connection_mm") || p.get("prothetik_diameter_mm"); // implant connection size

  const abformung = lower(p.get("abformung"));
  const color = lower(p.get("color"));
  const rotation = parseRotation(p.get("rotationsschutz"));
  const variant = lower(p.get("variant"));

  const platform = platformIn === "universal" ? "universal" : normPlatform(platformIn);

  return items.filter((r) => {
    if (q) {
      const hay = `${r.sku||""} ${r.mfg_code||""} ${r.name_de||""} ${r.name_long_de||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (platform) {
      if (platform === "universal") { if (r.platform) return false; }
      else { if ((r.platform || "").toUpperCase() !== platform) return false; }
    }
    if (group && lower(r.group) !== group) return false;
    if (prodGroup && lower(r.product_group) !== prodGroup) return false;

    if (diameter && !approxEq(r.diameter_mm, diameter)) return false;
    if (length && !approxEq(r.length_mm, length)) return false;
    if (gingiva && !approxEq(r.gingiva_mm, gingiva)) return false;
    if (angulation && !approxEq(r.angulation_deg, angulation)) return false;

    const conn = deriveConnectionMM(r, p.get("gingiva_mm"));
    if (connection && !approxEq(conn, connection)) return false;

    if (abformung && lower(r.abformung) !== abformung) return false;
    if (color && lower(r.color) !== color) return false;

    if (rotation) {
      const field = lower(r.rotationsschutz || "");
      const isWith = /\b(mit|ja|with|rotation|r-?schutz)\b/.test(field);
      const isWithout = /\b(ohne|nein|without)\b/.test(field);
      if (rotation === "with" && !isWith) return false;
      if (rotation === "without" && !isWithout) return false;
    }

    if (variant) {
      const blob = `${lower(r.ausfuehrung)} ${lower(r.rotationsschutz)} ${lower(r.zubehoer)}`;
      if (!blob.includes(variant)) return false;
    }
    return true;
  });
}

function countValues(items, field, numeric=false, mapper=null) {
  const map = new Map();
  for (const r of items) {
    let v = mapper ? mapper(r) : r[field];
    if (v == null || v === "" || (numeric && !Number.isFinite(toNum(v)))) continue;
    if (numeric) v = toNum(v).toFixed(1);
    const key = String(v);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 50)
    .map(([value, count]) => ({ value, count }));
}

export default async function handler(req) {
  try {
    const items = await loadProducts(req);
    const url = new URL(req.url);
    const filtered = applyFilters(items, url.searchParams);
    const gingivaHint = url.searchParams.get("gingiva_mm");

    // --- build connection facet from the strict single-value parser only ---
    function normConn(v){
      if (Math.abs(v - 3.75) < 0.06) return "3.75";
      return (Math.round(v * 10) / 10).toFixed(1);
    }

    const connMap = new Map();
    for (const r of filtered) {
      const v = deriveConnectionMM(r, gingivaHint);
      if (v == null) continue;
      const n = parseFloat(v);
      if (n < 3.0 || n > 6.5) continue;
      if (gingivaHint && Math.abs(n - parseFloat(gingivaHint)) < 0.11) continue;

      const sv = normConn(n);
      connMap.set(sv, (connMap.get(sv) || 0) + 1);
    }

    // remove singletons only if multiple options exist (cleans stray 5.7/6.0 noise)
    let entries = Array.from(connMap.entries());
    if (entries.length > 1) entries = entries.filter(([,count]) => count >= 2);

    const connFacet = entries
      .sort((a,b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }));

    // --- assemble response ---
    const facets = {
      platform:        { values: countValues(filtered, "platform") },
      platform_scope:  { values: [
        { value: "platform",  count: filtered.filter(r => !!r.platform).length },
        { value: "universal", count: filtered.filter(r => !r.platform).length }
      ]},
      product_group:   { values: countValues(filtered, "product_group") },
      group:           { values: countValues(filtered, "group") },

      // NUMERIC facets
      diameter_mm:     { values: countValues(filtered, "diameter_mm", true) },
      length_mm:       { values: countValues(filtered, "length_mm", true) },
      gingiva_mm:      { values: countValues(filtered, "gingiva_mm", true) },
      angulation_deg:  { values: countValues(filtered, "angulation_deg", true) },
      connection_mm:   { values: connFacet }, // cleaned, derived strictly

      // ENUM facets
      abformung:       { values: countValues(filtered, "abformung") },
      ausfuehrung:     { values: countValues(filtered, "ausfuehrung") },
      rotationsschutz: { values: countValues(filtered, "rotationsschutz") },
      color:           { values: countValues(filtered, "color") },
    };

    return new Response(JSON.stringify({ facets }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
