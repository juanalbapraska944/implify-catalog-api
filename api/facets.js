export const config = { runtime: "edge", regions: ["fra1"] };

let CACHE = { products: null };

async function loadProducts(req) {
  if (CACHE.products) return CACHE.products;
  const origin = new URL(req.url).origin;
  const fileUrl = `${origin}/products.jsonl`; // change to /public/products.jsonl if that's where your file is
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

function norm(v){ return (v ?? "").toString().trim(); }
function lower(v){ return norm(v).toLowerCase(); }
function normPlatform(p){
  const s = norm(p).toUpperCase().replace(/\s+/g,"");
  const m = s.match(/^P?(\d{1,2})$/);
  return m ? `P${String(parseInt(m[1],10)).padStart(2,"0")}` : (s || null);
}
function approxEq(a,b){
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na-nb) < 0.11;
}

function applyFilters(items, p) {
  const q = lower(p.get("q"));
  const platformIn = p.get("platform");
  const group = lower(p.get("group"));
  const prodGroup = lower(p.get("product_group"));
  const diameter = p.get("diameter_mm");
  const length = p.get("length_mm");
  const gingiva = p.get("gingiva_mm");
  const angulation = p.get("angulation_deg");
  const abformung = lower(p.get("abformung"));
  const color = lower(p.get("color"));
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

    if (abformung && lower(r.abformung) !== abformung) return false;
    if (color && lower(r.color) !== color) return false;

    if (variant) {
      const blob = `${lower(r.ausfuehrung)} ${lower(r.rotationsschutz)} ${lower(r.zubehoer)}`;
      if (!blob.includes(variant)) return false;
    }
    return true;
  });
}

function countValues(items, field, numeric=false) {
  const map = new Map();
  for (const r of items) {
    let v = r[field];
    if (v == null || v === "") continue;
    if (numeric) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      v = n.toFixed(1);
    }
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

    const facets = {
      platform: { values: countValues(filtered, "platform") },
      platform_scope: { values: [
        { value: "platform", count: filtered.filter(r => !!r.platform).length },
        { value: "universal", count: filtered.filter(r => !r.platform).length }
      ]},
      product_group: { values: countValues(filtered, "product_group") },
      group: { values: countValues(filtered, "group") },
      diameter_mm: { values: countValues(filtered, "diameter_mm", true) },
      length_mm: { values: countValues(filtered, "length_mm", true) },
      gingiva_mm: { values: countValues(filtered, "gingiva_mm", true) },
      angulation_deg: { values: countValues(filtered, "angulation_deg", true) },
      abformung: { values: countValues(filtered, "abformung") },
      ausfuehrung: { values: countValues(filtered, "ausfuehrung") },
      rotationsschutz: { values: countValues(filtered, "rotationsschutz") },
      color: { values: countValues(filtered, "color") },
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
