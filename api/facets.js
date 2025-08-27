export const config = { runtime: "edge", regions: ["fra1"] };

let CACHE = { products: null };

async function loadProducts(req) {
  if (CACHE.products) return CACHE.products;
  const url = new URL("/public/products.jsonl", req.url);
  const res = await fetch(url.toString());
  const text = await res.text();
  CACHE.products = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return CACHE.products;
}

function norm(s) { return (s ?? "").toString().trim(); }
function normLower(s) { return norm(s).toLowerCase(); }
function normPlatform(p) {
  const s = norm(p).toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^P?(\d{1,2})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return `P${String(n).padStart(2, "0")}`;
  }
  return s || null;
}
function approxEq(a, b) {
  if (a == null || b == null) return false;
  const na = Number(a), nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return Math.abs(na - nb) < 0.11;
}

function applyFilters(items, p) {
  const q = (p.get("q") || "").toLowerCase();
  const platformIn = p.get("platform");
  const group = (p.get("group") || "").toLowerCase();
  const prodGroup = (p.get("product_group") || "").toLowerCase();
  const diameter = p.get("diameter_mm");
  const length = p.get("length_mm");
  const gingiva = p.get("gingiva_mm");
  const angulation = p.get("angulation_deg");
  const abformung = (p.get("abformung") || "").toLowerCase();
  const color = (p.get("color") || "").toLowerCase();
  const variant = (p.get("variant") || "").toLowerCase();

  const platform = platformIn === "universal" ? "universal" : normPlatform(platformIn);

  return items.filter((r) => {
    if (q) {
      const hay = `${r.sku||""} ${r.mfg_code||""} ${r.name_de||""} ${r.name_long_de||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (platform) {
      if (platform === "universal") {
        if (r.platform) return false;
      } else {
        if ((r.platform || "").toUpperCase() !== platform) return false;
      }
    }
    if (group && normLower(r.group) !== group) return false;
    if (prodGroup && normLower(r.product_group) !== prodGroup) return false;

    if (diameter && !approxEq(r.diameter_mm, diameter)) return false;
    if (length && !approxEq(r.length_mm, length)) return false;
    if (gingiva && !approxEq(r.gingiva_mm, gingiva)) return false;
    if (angulation && !approxEq(r.angulation_deg, angulation)) return false;

    if (abformung && normLower(r.abformung) !== abformung) return false;
    if (color && normLower(r.color) !== color) return false;

    if (variant) {
      const blob = `${normLower(r.ausfuehrung)} ${normLower(r.rotationsschutz)} ${normLower(r.zubehoer)}`;
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
    if (numeric) v = Number(v).toFixed(1);
    const key = String(v);
    map.set(key, (map.get(key) || 0) + 1);
  }
  // sort by count desc
  return Array.from(map.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 50)
    .map(([value, count]) => ({ value, count }));
}

export default async function handler(req) {
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
}
