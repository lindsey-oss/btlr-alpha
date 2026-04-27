/**
 * BTLR Structured Cost Ranges
 * Patent Pending — Proprietary
 *
 * Defines estimated cost ranges by system and repair type.
 * Always returns a range — never a single number.
 * All values are labeled "estimated" and should never be presented as exact.
 *
 * ── Data Source Architecture ──────────────────────────────────────────────
 * Cost ranges are stored in one place only: STATIC_COST_TABLE below.
 * The UI and predictions engine NEVER reference the table directly —
 * they always call getCostRange() or getCostRangeForItem().
 *
 * To connect a real data source (HomeAdvisor, Angi, Zillow, regional API):
 *   1. Fetch ranges from the external source
 *   2. Call registerCostOverrides(overrides) at app startup
 *   3. getCostRange() will use your data automatically, falling back to
 *      the static table for any categories not covered by the override
 *
 * No UI or engine code needs to change when a real source is connected.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cost confidence levels:
 *   high   — well-established national market rates, low variance
 *   medium — moderate regional variance, reasonable estimate
 *   low    — highly variable by scope, extent of damage, or region
 *
 * Static ranges are national averages (USD, 2024–2025).
 */

export type RepairType =
  | "maintenance"   // routine service, cleaning, inspection
  | "minor_repair"  // small fix, single component
  | "major_repair"  // significant repair, multiple components or labor-intensive
  | "replacement";  // full system or component replacement

// ─────────────────────────────────────────────────────────────────
// COST RANGE SOURCE
// Tracks where a given range came from — static fallback or real data.
// ─────────────────────────────────────────────────────────────────
export type CostRangeSource = "static" | "external";

export interface CostRange {
  /** Lower bound of estimated cost (USD) */
  estimated_cost_min: number;
  /** Upper bound of estimated cost (USD) */
  estimated_cost_max: number;
  /** How reliable this estimate is given market rate variance */
  cost_confidence: "low" | "medium" | "high";
  /** Human-readable repair type label */
  label: string;
  /** Optional caveat surfaced to the user */
  note?: string;
  /** Where this range came from — "static" (built-in) or "external" (real data source) */
  source?: CostRangeSource;
}

// ─────────────────────────────────────────────────────────────────
// OVERRIDE REGISTRY
// Populated at runtime by registerCostOverrides().
// Takes precedence over STATIC_COST_TABLE for any keys present.
// ─────────────────────────────────────────────────────────────────
let _overrideTable: Partial<Record<string, Partial<Record<RepairType, CostRange>>>> = {};

/**
 * Register cost ranges from a real data source (HomeAdvisor, Angi, regional API, etc.).
 * Call this at app startup after fetching external data.
 * Any category+repairType pair present here will override the static table.
 * Missing pairs automatically fall back to the static table.
 *
 * @example
 * registerCostOverrides({
 *   roof_drainage_exterior: {
 *     replacement: { estimated_cost_min: 9500, estimated_cost_max: 22000,
 *                    cost_confidence: "high", label: "Full Replacement",
 *                    source: "external" }
 *   }
 * });
 */
export function registerCostOverrides(
  overrides: Partial<Record<string, Partial<Record<RepairType, CostRange>>>>
): void {
  _overrideTable = { ..._overrideTable, ...overrides };
}

/** Clears all overrides — restores static table behavior. Useful in tests. */
export function clearCostOverrides(): void {
  _overrideTable = {};
}

/** Returns true if any override data has been registered. */
export function hasCostOverrides(): boolean {
  return Object.keys(_overrideTable).length > 0;
}

// ─────────────────────────────────────────────────────────────────
// STATIC COST TABLE  (national averages, USD 2024–2025)
// This is the fallback when no external data source is connected.
// Do NOT reference this table directly outside this file.
// Always use getCostRange() so overrides are respected.
// ─────────────────────────────────────────────────────────────────
const STATIC_COST_TABLE: Record<string, Record<RepairType, CostRange>> = {

  structure_foundation: {
    maintenance:  { estimated_cost_min: 200,   estimated_cost_max: 800,    cost_confidence: "high",   label: "Maintenance",  note: "Annual crawl space / basement inspection." },
    minor_repair: { estimated_cost_min: 500,   estimated_cost_max: 2500,   cost_confidence: "medium", label: "Minor Repair",  note: "Crack sealing, minor settling correction." },
    major_repair: { estimated_cost_min: 3000,  estimated_cost_max: 15000,  cost_confidence: "low",    label: "Major Repair",  note: "Structural reinforcement, pier repair, beam replacement." },
    replacement:  { estimated_cost_min: 10000, estimated_cost_max: 50000,  cost_confidence: "low",    label: "Remediation",   note: "Full foundation remediation. Scope highly variable." },
  },

  roof_drainage_exterior: {
    maintenance:  { estimated_cost_min: 150,  estimated_cost_max: 500,   cost_confidence: "high",   label: "Maintenance",    note: "Gutter cleaning, inspection, minor caulking." },
    minor_repair: { estimated_cost_min: 300,  estimated_cost_max: 1500,  cost_confidence: "high",   label: "Minor Repair",   note: "Patching, flashing repair, isolated shingle replacement." },
    major_repair: { estimated_cost_min: 1500, estimated_cost_max: 5000,  cost_confidence: "medium", label: "Major Repair",   note: "Partial re-roof, section repair, fascia/soffit replacement." },
    replacement:  { estimated_cost_min: 8000, estimated_cost_max: 20000, cost_confidence: "medium", label: "Full Replacement", note: "Full re-roof. Cost varies by material (asphalt vs. metal vs. tile)." },
  },

  electrical: {
    maintenance:  { estimated_cost_min: 150,  estimated_cost_max: 400,   cost_confidence: "high",   label: "Maintenance",    note: "Panel inspection, safety check, GFCI testing." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 500,   cost_confidence: "high",   label: "Minor Repair",   note: "Outlet, switch, GFCI/AFCI replacement, junction box." },
    major_repair: { estimated_cost_min: 1500, estimated_cost_max: 6000,  cost_confidence: "medium", label: "Major Repair",   note: "Panel upgrade, service entrance repair, partial rewire." },
    replacement:  { estimated_cost_min: 8000, estimated_cost_max: 20000, cost_confidence: "low",    label: "Full Rewire",    note: "Whole-home rewiring. Cost varies significantly by home size." },
  },

  plumbing: {
    maintenance:  { estimated_cost_min: 100,  estimated_cost_max: 400,   cost_confidence: "high",   label: "Maintenance",    note: "Drain cleaning, inspection, shutoff valve check." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 600,   cost_confidence: "high",   label: "Minor Repair",   note: "Faucet, toilet, drain, hose bibb, or supply line repair." },
    major_repair: { estimated_cost_min: 600,  estimated_cost_max: 4000,  cost_confidence: "medium", label: "Major Repair",   note: "Pipe section replacement, sewer line repair, water line." },
    replacement:  { estimated_cost_min: 4000, estimated_cost_max: 15000, cost_confidence: "low",    label: "Full Repipe",    note: "Whole-home repiping. Cost varies by home size and pipe material." },
  },

  hvac: {
    maintenance:  { estimated_cost_min: 100,  estimated_cost_max: 300,   cost_confidence: "high",   label: "Annual Service", note: "Tune-up, filter replacement, coil cleaning." },
    minor_repair: { estimated_cost_min: 150,  estimated_cost_max: 800,   cost_confidence: "high",   label: "Minor Repair",   note: "Thermostat, capacitor, contactor, minor component." },
    major_repair: { estimated_cost_min: 800,  estimated_cost_max: 3500,  cost_confidence: "medium", label: "Major Repair",   note: "Compressor, evaporator coil, blower motor, refrigerant recharge." },
    replacement:  { estimated_cost_min: 5000, estimated_cost_max: 15000, cost_confidence: "medium", label: "Full Replacement", note: "Full HVAC system replacement. Cost varies by system type and home size." },
  },

  appliances_water_heater: {
    maintenance:  { estimated_cost_min: 50,   estimated_cost_max: 250,   cost_confidence: "high",   label: "Maintenance",    note: "Appliance servicing, water heater flush, filter replacement." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 600,   cost_confidence: "high",   label: "Repair",         note: "Single appliance repair (dishwasher, oven element, disposal)." },
    major_repair: { estimated_cost_min: 300,  estimated_cost_max: 1200,  cost_confidence: "medium", label: "Major Repair",   note: "Complex appliance repair or water heater repair." },
    replacement:  { estimated_cost_min: 800,  estimated_cost_max: 4000,  cost_confidence: "high",   label: "Replacement",    note: "Water heater $800–$1,500. Major appliance $600–$4,000 depending on type." },
  },

  interior_windows_doors: {
    maintenance:  { estimated_cost_min: 100,  estimated_cost_max: 500,   cost_confidence: "high",   label: "Maintenance",    note: "Weatherstripping, caulking, hardware adjustment." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 800,   cost_confidence: "high",   label: "Minor Repair",   note: "Single window seal, door hardware, floor patch, stair tread." },
    major_repair: { estimated_cost_min: 500,  estimated_cost_max: 4000,  cost_confidence: "medium", label: "Major Repair",   note: "Multiple window replacements, door replacement, floor section." },
    replacement:  { estimated_cost_min: 3000, estimated_cost_max: 15000, cost_confidence: "medium", label: "Full Replacement", note: "Full window or door replacement throughout. Cost varies by count and type." },
  },

  safety_environmental: {
    maintenance:  { estimated_cost_min: 25,   estimated_cost_max: 200,   cost_confidence: "high",   label: "Detector Replacement", note: "Smoke/CO detector replacement." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 800,   cost_confidence: "high",   label: "Minor Remediation",    note: "Small mold area, pest treatment, radon test." },
    major_repair: { estimated_cost_min: 1500, estimated_cost_max: 8000,  cost_confidence: "medium", label: "Remediation",          note: "Mold remediation, radon mitigation system, pest extermination." },
    replacement:  { estimated_cost_min: 3000, estimated_cost_max: 25000, cost_confidence: "low",    label: "Full Abatement",       note: "Asbestos or lead abatement. Scope and cost highly variable." },
  },

  site_grading_drainage: {
    maintenance:  { estimated_cost_min: 150,  estimated_cost_max: 600,   cost_confidence: "high",   label: "Maintenance",    note: "Downspout extension, minor regrading, erosion control." },
    minor_repair: { estimated_cost_min: 300,  estimated_cost_max: 2000,  cost_confidence: "high",   label: "Minor Repair",   note: "Grading correction, downspout redirect, small drainage fix." },
    major_repair: { estimated_cost_min: 2000, estimated_cost_max: 10000, cost_confidence: "medium", label: "Major Repair",   note: "French drain installation, retaining wall repair, lot drainage." },
    replacement:  { estimated_cost_min: 5000, estimated_cost_max: 20000, cost_confidence: "low",    label: "Full Correction", note: "Major drainage overhaul or retaining wall replacement." },
  },

  maintenance_upkeep: {
    maintenance:  { estimated_cost_min: 100,  estimated_cost_max: 500,   cost_confidence: "high",   label: "Routine Maintenance", note: "General upkeep and preventive service." },
    minor_repair: { estimated_cost_min: 100,  estimated_cost_max: 800,   cost_confidence: "medium", label: "Minor Repair",        note: "General minor repair." },
    major_repair: { estimated_cost_min: 500,  estimated_cost_max: 3000,  cost_confidence: "low",    label: "Major Repair",        note: "General significant repair." },
    replacement:  { estimated_cost_min: 1000, estimated_cost_max: 5000,  cost_confidence: "low",    label: "Replacement",         note: "General component replacement." },
  },
};

// ─────────────────────────────────────────────────────────────────
// REPAIR TYPE DERIVATION
// Maps NormalizedItem fields to a RepairType.
// Called by the predictions engine — not exposed directly to the UI.
// ─────────────────────────────────────────────────────────────────

/**
 * Derives the most appropriate RepairType for a normalized item.
 * Uses deficiency severity and remaining life as primary signals.
 */
export function deriveRepairType(
  deficiencySeverity: string,
  remainingLifePercent: number,
  replacementWindow: string,
): RepairType {
  // Replacement signals: near end of life or explicitly flagged
  if (
    replacementWindow === "immediate_to_1_year" ||
    remainingLifePercent <= 10 ||
    deficiencySeverity === "severe"
  ) return "replacement";

  if (
    replacementWindow === "1_to_3_years" ||
    remainingLifePercent <= 25 ||
    deficiencySeverity === "major"
  ) return "major_repair";

  if (deficiencySeverity === "moderate") return "minor_repair";
  if (deficiencySeverity === "minor")    return "minor_repair";
  if (deficiencySeverity === "none")     return "maintenance";

  return "minor_repair"; // safe fallback
}

// ─────────────────────────────────────────────────────────────────
// MAIN LOOKUP
// ─────────────────────────────────────────────────────────────────

/**
 * Returns the estimated cost range for a given system and repair type.
 * Always returns a range — never a single number.
 *
 * Lookup order:
 *   1. Override table (external data source, registered via registerCostOverrides)
 *   2. Static table (built-in national averages)
 *   3. maintenance_upkeep fallback (if category is unknown)
 */
export function getCostRange(
  category: string,
  repairType: RepairType,
): CostRange {
  // 1. Check override table first
  const override = _overrideTable[category]?.[repairType];
  if (override) return { ...override, source: "external" };

  // 2. Static table
  const systemRanges = STATIC_COST_TABLE[category] ?? STATIC_COST_TABLE["maintenance_upkeep"];
  return { ...systemRanges[repairType], source: "static" };
}

/**
 * Convenience: looks up cost range directly from NormalizedItem fields.
 * Derives repair type automatically.
 */
export function getCostRangeForItem(
  category: string,
  deficiencySeverity: string,
  remainingLifePercent: number,
  replacementWindow: string,
): CostRange {
  const repairType = deriveRepairType(deficiencySeverity, remainingLifePercent, replacementWindow);
  return getCostRange(category, repairType);
}

/**
 * Formats a cost range for display.
 * Example: "$1,500 – $5,000 (estimated)"
 */
export function formatCostRange(range: CostRange): string {
  const fmt = (n: number) => "$" + n.toLocaleString("en-US");
  return `${fmt(range.estimated_cost_min)} – ${fmt(range.estimated_cost_max)} (estimated)`;
}
