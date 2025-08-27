export const config = { runtime: "edge", regions: ["fra1"] }; // EU region

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

function norm(s) {
  return (s ?? "").toString().trim();
}
function normLower(s) {
  return norm(s).toLowerCase();
}
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
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return Math.abs(na - nb) < 0.11; // ~0.1mm tolerance
}

export default async function handler(req) {
  const items = await loadProducts(req);
  const url = new URL(req.url);
  const p = url.searchParams;

  const q = (p.get("q") || "").toLowerCase();
  const platformIn = p.get("platform");
  const group = (p.get("group") || "").toLowerCase();
  const prodGroup = (p.get("product_group") || "").toLowerCase();
  const diameter = p.get("diameter_mm");
  const length = p.get("length_mm");
  const gingiva = p.get("gingiva_mm");
  const angulation = p.get("angulation_deg");
  const abformung = (p.get("abformung") || "").toLowerCase(); // "open"/"closed"
  const color = (p.get("color") || "").toLowerCase();
  const variant = (p.get("variant") || "").toLowerCase(); // matches ausfuehrung/rotationsschutz/zubehoer
  const limit = Math.max(1, Math.min(50, parseInt(p.get("limit") || "10", 10)));

  const platform = platformIn === "universal" ? "universal" : normPlatform(platformIn);

  let result = items.filter((r) => {
    // text query
    if (q) {
      const hay =
        (r.sku || "") +
        " " +
        (r.mfg_code || "") +
        " " +
        (r.name_de || "") +
        " " +
        (r.name_long_de || "");
      if (!hay.toLowerCase().includes(q)) return false;
    }
    // platform / universal
    if (platform) {
      if (platform === "universal") {
        const isUni = !r.platform || r.platform === "";
        if (!isUni) return false;
      } else {
        if ((r.platform || "").toUpperCase() !== platform) return false;
      }
    }
    // group / product_group
    if (group && normLower(r.group) !== group) return false;
    if (prodGroup && normLower(r.product_group) !== prodGroup) return false;

    // numeric filters
    if (diameter && !approxEq(r.diameter_mm, diameter)) return false;
    if (length && !approxEq(r.length_mm, length)) return false;
    if (gingiva && !approxEq(r.gingiva_mm, gingiva)) return false;
    if (angulation && !approxEq(r.angulation_deg, angulation)) return false;

    // enums
    if (abformung && normLower(r.abformung) !== abformung) return false;
    if (color && normLower(r.color) !== color) return false;

    // variant fuzzy: match against ausfuehrung/rotationsschutz/zubehoer
    if (variant) {
      const blob = `${normLower(r.ausfuehrung)} ${normLower(r.rotationsschutz)} ${normLower(r.zubehoer)}`;
      if (!blob.includes(variant)) return false;
    }
    return true;
  });

  // shape and limit
  result = result.slice(0, limit).map((r) => ({
    sku: r.sku,
    mfg_code: r.mfg_code || null,
    name_de: r.name_de || null,
    platform: r.platform || null,
    platform_scope: r.platform_scope || (r.platform ? "platform" : "universal"),
    product_group: r.product_group || null,
    group: r.group || null,
    diameter_mm: r.diameter_mm ?? null,
    length_mm: r.length_mm ?? null,
    gingiva_mm: r.gingiva_mm ?? null,
    angulation_deg: r.angulation_deg ?? null,
    abformung: r.abformung || null,
    ausfuehrung: r.ausfuehrung || null,
    rotationsschutz: r.rotationsschutz || null,
    color: r.color || null,
  }));

  return new Response(JSON.stringify({ items: result }, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
