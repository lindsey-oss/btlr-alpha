/**
 * BTLR canonical category system.
 * The ONLY place category keys are defined.
 * Both route.js and page.tsx import from here.
 *
 * CORE SCORED CATEGORIES (10) — included in the weighted Home Health Score:
 *   structure_foundation, roof_drainage_exterior, plumbing, electrical, hvac,
 *   interior_windows_doors, appliances_water_heater, safety_environmental,
 *   site_grading_drainage, maintenance_upkeep
 *
 * OPTIONAL / SUPPLEMENTAL CATEGORIES — repair-trackable but NOT scored:
 *   pool_spa — pools, spas, hot tubs, and all associated equipment
 */

export const BTLR_CATEGORIES = [
  // ── Core scored categories ──────────────────────────────────────
  "structure_foundation",
  "roof_drainage_exterior",
  "plumbing",
  "electrical",
  "hvac",
  "interior_windows_doors",
  "appliances_water_heater",
  "safety_environmental",
  "site_grading_drainage",
  "maintenance_upkeep",
  // ── Supplemental (tracked but not scored) ──────────────────────
  "pool_spa",
] as const;

export type BtlrCategory = (typeof BTLR_CATEGORIES)[number];

/**
 * Categories excluded from the weighted Home Health Score.
 * Findings in these categories are fully tracked (repairs, costs, status)
 * but their scorable flag is always false.
 */
export const UNSCORED_CATEGORIES: ReadonlySet<BtlrCategory> = new Set([
  "pool_spa",
]);

/**
 * Maps any raw AI category string to one of the canonical BTLR category keys.
 * Deterministic: same input always produces same output.
 *
 * Pool/spa detection runs BEFORE the maintenance_upkeep fallback so pool
 * findings never get silently absorbed into the core score bucket.
 */
export function toCategoryKey(raw: string): BtlrCategory {
  const c = (raw || "").toLowerCase();

  if (
    c.includes("struct") || c.includes("found") ||
    c.includes("crawl") || c.includes("basement") ||
    c.includes("pier") || c.includes("slab")
  ) return "structure_foundation";

  if (
    c.includes("roof") || c.includes("gutter") ||
    c.includes("soffit") || c.includes("fascia") ||
    c.includes("siding") || c.includes("flashing") ||
    c.includes("downspout") || c.includes("eave") ||
    (c.includes("exterior") && !c.includes("deck") && !c.includes("patio"))
  ) return "roof_drainage_exterior";

  if (
    c.includes("plumb") || c.includes("pipe") ||
    c.includes("water heater") || c.includes("water supply") ||
    c.includes("sewer") || c.includes("drain") ||
    c.includes("toilet") || c.includes("sink") ||
    c.includes("faucet") || c.includes("hose bibb") ||
    c.includes("shut-off") || c.includes("shutoff")
  ) return "plumbing";

  if (
    c.includes("electr") || c.includes("panel") ||
    c.includes("wiring") || c.includes("outlet") ||
    c.includes("circuit") || c.includes("gfci") ||
    c.includes("afci") || c.includes("breaker") ||
    c.includes("junction") || c.includes("switch")
  ) return "electrical";

  if (
    c.includes("hvac") || c.includes("furnace") ||
    c.includes("heat pump") || c.includes("air handler") ||
    c.includes("thermostat") || c.includes("ductwork") ||
    c.includes("duct") || c.includes("ventilat") ||
    c.includes("cooling") || c.includes("heating") ||
    (c.includes("air") && (c.includes("condition") || c.includes("unit"))) ||
    (c.includes("heat") && !c.includes("water heater"))
  ) return "hvac";

  if (
    c.includes("window") || c.includes("door") ||
    c.includes("interior") || c.includes("floor") ||
    c.includes("ceiling") || c.includes("wall") ||
    c.includes("stair") || c.includes("handrail") ||
    c.includes("guardrail") || c.includes("trim") ||
    c.includes("drywall") || c.includes("insulation")
  ) return "interior_windows_doors";

  if (
    c.includes("applian") || c.includes("dishwash") ||
    c.includes("oven") || c.includes("range") ||
    c.includes("refriger") || c.includes("dryer") ||
    c.includes("washer") || c.includes("stove") ||
    c.includes("microwave") || c.includes("garbage disposal") ||
    (c.includes("water heater") && !c.includes("plumb"))
  ) return "appliances_water_heater";

  if (
    c.includes("safety") || c.includes("smoke") ||
    c.includes("carbon") || c.includes("co detector") ||
    c.includes("detector") || c.includes("mold") ||
    c.includes("mildew") || c.includes("pest") ||
    c.includes("termite") || c.includes("radon") ||
    c.includes("asbestos") || c.includes("lead") ||
    c.includes("environmental") || c.includes("hazard")
  ) return "safety_environmental";

  if (
    c.includes("grading") || c.includes("drainage") ||
    c.includes("retaining wall") || c.includes("landscap") ||
    c.includes("erosion") || c.includes("lot") ||
    c.includes("site")
  ) return "site_grading_drainage";

  // ── Pool / spa — must run BEFORE maintenance_upkeep fallback ───
  // Prevents pool findings from silently entering the core score bucket.
  if (
    c.includes("pool") || c.includes("spa") ||
    c.includes("hot tub") || c.includes("hottub") ||
    c.includes("skimmer") || c.includes("pool pump") ||
    c.includes("pool filter") || c.includes("pool heater") ||
    c.includes("pool fence") || c.includes("pool gate") ||
    c.includes("pool deck") || c.includes("pool drain") ||
    c.includes("pool plaster") || c.includes("pool tile") ||
    c.includes("pool coping") || c.includes("pool cover") ||
    c.includes("pool equipment") || c.includes("pool light") ||
    c.includes("jacuzzi") || c.includes("whirlpool")
  ) return "pool_spa";

  return "maintenance_upkeep";
}
