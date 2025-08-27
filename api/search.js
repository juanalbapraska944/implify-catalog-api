// api/search.js
export const config = { runtime: "edge", regions: ["fra1"] };

let CACHE = { products: null };

async function loadProducts(req) {
  if (CACHE.products) return CACHE.products;

  const origin = new URL(req.url).origin;
  const fileUrl = `${origin}/products.jsonl`; // served from /public at site root
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
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na-nb) < 0.11; // ~0.1 mm tolerance
}
function parseRotation(val){
  const s = lower(val);
  if (!s) return "";
  if (/\b(with|mit|ja|yes|rotation|r-?schutz)\b/.test(s)) return "with";
  if (/\b(without|ohne|nein|no)\b/.test(s)) return "without";
  return ""; // unknown → no filter
}

export default async function handler(req) {
  try {
    const items = await loadProducts(req);
    const url = new URL(req.url), p = url.searchParams;

    // Text / identity
    const q = lower(p.get("q"));
    const platformIn = p.get("platform");
    const group = lower(p.get("group"));                // high-level category
    const prodGroup = lower(p.get("product_group"));    // e.g., Abutment, Gingivaformer, Abformpfosten

    // NUMERICS on the PART itself
    const diameter = p.get("diameter_mm");              // prosthetic diameter of the part
    const length = p.get("length_mm");
    const gingiva = p.get("gingiva_mm");
    const angulation = p.get("angulation_deg");

    // CONNECTION size (implant interface) — accept either param name
    const connection = p.get("connection_mm") || p.get("prothetik_diameter_mm");

    // ENUMS
    const abformung = lower(p.get("abformung"));        // "open" | "closed"
    const color = lower(p.get("color"));
    const rotation = parseRotation(p.get("rotationsschutz")); // "with" | "without" | ""

    // fuzzy variants bucket
    const variant = lower(p.get("variant"));

    const limit = Math.max(1, Math.min(50, parseInt(p.get("limit") || "10", 10)));
    const platform = platformIn === "universal" ? "universal" : normPlatform(platformIn);

    // Filter
    let result = items.filter((r) => {
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

      if (diameter && !approxEq(r.diameter_mm, diameter)) return false;                 // part's prosthetic diameter
      if (length && !approxEq(r.length_mm, length)) return false;
      if (gingiva && !approxEq(r.gingiva_mm, gingiva)) return false;
      if (angulation && !approxEq(r.angulation_deg, angulation)) return false;

      if (connection && !approxEq(r.prothetik_diameter_mm, connection)) return false;   // implant connection size

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

    // Shape & limit
    result = result.slice(0, limit).map((r) => ({
      sku: r.sku,
      mfg_code: r.mfg_code || null,
      name_de: r.name_de || null,
      platform: r.platform || null,
      platform_scope: r.platform ? "platform" : "universal",
      product_group: r.product_group || null,
      group: r.group || null,

      // PART measures
      diameter_mm: r.diameter_mm ?? null,
      length_mm: r.length_mm ?? null,
      gingiva_mm: r.gingiva_mm ?? null,
      angulation_deg: r.angulation_deg ?? null,

      // CONNECTION size
      connection_mm: r.prothetik_diameter_mm ?? null,

      // Variants
      abformung: r.abformung || null,
      ausfuehrung: r.ausfuehrung || null,
      rotationsschutz: r.rotationsschutz || null,
      color: r.color || null,
    }));

    return new Response(JSON.stringify({ items: result }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
