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

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE-SCORED CLASSIFICATION (Pass 3)
//
// Builds on toCategoryKey() without replacing it.
// Adds two corroboration signals to each classification:
//
//   Signal A — CATEGORY STRING matched a named rule in toCategoryKey()
//   Signal B — DESCRIPTION independently contains keywords for that category
//
// Confidence:
//   "high"        — both signals confirmed (AI label + description corroborate)
//   "medium"      — only the AI category string matched a named rule
//   "low"         — matched only via maintenance_upkeep fallback with
//                   a recognized maintenance/general label
//   "unconfirmed" — fell through to maintenance_upkeep with NO recognizable
//                   keywords in either category OR description
//
// "unconfirmed" findings are flagged needs_review=true in NormalizedFinding.
// They are NOT removed or reassigned — they stay in maintenance_upkeep so
// the app continues to display them, but the flag is a signal for future
// human review or a more targeted AI re-pass.
//
// toCategoryKey() is intentionally unchanged — all existing callers are safe.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  category:   BtlrCategory;
  /** How confident the rule engine is in this classification. */
  confidence: "high" | "medium" | "low" | "unconfirmed";
  /** Human-readable explanation of what triggered the classification. */
  reason:     string;
}

/**
 * Per-category description keywords used to corroborate the AI's category label.
 * These are intentionally broader than the category-string rules in toCategoryKey()
 * so description text can independently confirm a classification.
 */
const DESC_KEYWORDS: Record<BtlrCategory, string[]> = {
  structure_foundation:    ["crack", "settl", "heav", "foundation", "crawl", "basement", "pier", "slab", "struct", "beam", "joist", "framing"],
  roof_drainage_exterior:  ["shingle", "roof", "gutter", "fascia", "soffit", "flashing", "downspout", "siding", "eave", "chimney", "exterior"],
  plumbing:                ["pipe", "drain", "toilet", "sink", "faucet", "water heater", "sewer", "leak", "water supply", "hose", "shutoff", "valve"],
  electrical:              ["electr", "panel", "wiring", "outlet", "breaker", "gfci", "afci", "romex", "circuit", "junction", "switch", "voltage"],
  hvac:                    ["furnace", "hvac", "duct", "thermostat", "condenser", "heat pump", "air handler", "refrigerant", "compressor", "evaporator"],
  interior_windows_doors:  ["window", "door", "floor", "stair", "ceiling", "wall", "handrail", "guardrail", "drywall", "insulation", "trim"],
  appliances_water_heater: ["dishwasher", "oven", "range", "refriger", "dryer", "washer", "stove", "microwave", "disposal", "appliance"],
  safety_environmental:    ["smoke detector", "carbon monoxide", "co detector", "mold", "mildew", "pest", "termite", "radon", "asbestos", "lead", "detector", "hazard"],
  site_grading_drainage:   ["grading", "drainage", "retaining", "erosion", "slope", "lot", "landscap", "runoff"],
  pool_spa:                ["pool", "spa", "skimmer", "hot tub", "jacuzzi", "whirlpool", "pool pump", "pool filter"],
  maintenance_upkeep:      ["maintenance", "general", "upkeep", "repair", "service", "misc"],
};

/** Returns true if the description contains at least one keyword for the given category. */
function descriptionCorroborates(category: BtlrCategory, description: string): boolean {
  const d = description.toLowerCase();
  return DESC_KEYWORDS[category]?.some(kw => d.includes(kw)) ?? false;
}

/** Returns true when the category string matched a NAMED rule (not the fallback). */
function categoryStringMatchedNamedRule(rawCategory: string): boolean {
  return toCategoryKey(rawCategory) !== "maintenance_upkeep";
}

/**
 * Classify a finding with an explicit confidence score and reason string.
 *
 * Drop-in safe — does NOT change toCategoryKey() or any existing pipeline.
 * Called inside normalizeFinding() to enrich NormalizedFinding with
 * confidence_score, classification_reason, and needs_review.
 */
export function classifyFinding(rawCategory: string, description: string): ClassificationResult {
  const category     = toCategoryKey(rawCategory);
  const namedMatch   = categoryStringMatchedNamedRule(rawCategory);
  const descMatch    = descriptionCorroborates(category, description);
  const catLower     = (rawCategory || "").toLowerCase();

  // ── Pool / spa: always deterministic — single source of truth ────────────
  if (category === "pool_spa") {
    const why = namedMatch
      ? `category "${rawCategory}" matched pool/spa rule`
      : `description contains pool/spa keyword`;
    return { category, confidence: "high", reason: why };
  }

  // ── Named category matched ────────────────────────────────────────────────
  if (namedMatch) {
    if (descMatch) {
      return {
        category,
        confidence: "high",
        reason:     `category "${rawCategory}" + description both confirm ${category}`,
      };
    }
    return {
      category,
      confidence: "medium",
      reason:     `category "${rawCategory}" matched ${category} rule; description not independently verified`,
    };
  }

  // ── Fell through to maintenance_upkeep ────────────────────────────────────
  // Check whether description at least has maintenance-adjacent keywords.
  if (descMatch) {
    // Description had keywords that match maintenance_upkeep — low but not unconfirmed
    return {
      category,
      confidence: "low",
      reason:     `no named category match; description confirms maintenance_upkeep`,
    };
  }

  // The AI's label had nothing recognizable and neither did the description.
  // This is a genuinely ambiguous finding — flag for review.
  const unknownLabel = catLower.length > 0 ? `"${rawCategory}"` : "(blank)";
  return {
    category,
    confidence: "unconfirmed",
    reason:     `category ${unknownLabel} and description did not match any classification rule — needs review`,
  };
}
