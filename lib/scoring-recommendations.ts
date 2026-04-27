/**
 * BTLR Recommendations Engine
 * Patent Pending — Proprietary
 *
 * Generates intelligent, bundled action recommendations from normalized
 * inspection data. Smarter than a raw sorted list:
 *   - Bundles related findings in the same system into one action
 *   - Sequences by ROI: safety-critical first, then high-impact/low-cost
 *   - Adds contractor type, seasonal timing, and DIY eligibility
 *   - Flags when items can be addressed together to reduce mobilization cost
 *
 * Gated by: enableRecommendations feature flag.
 * When flag is OFF — not computed.
 * When flag is ON  — appears on HomeHealthReport.recommendations.
 */

import type { NormalizedItem } from "./scoring-engine";
import {
  getCostRangeForItem,
  deriveRepairType,
  type CostRange,
} from "./scoring-cost-ranges";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export type ActionType =
  | "immediate_safety"  // safety hazard — act now
  | "urgent_repair"     // significant deficiency, act within 3 months
  | "planned_repair"    // action needed within 12 months, schedulable
  | "maintenance"       // routine upkeep, low urgency
  | "monitor";          // watch and reassess at next inspection

export interface Recommendation {
  /** Display priority (1 = highest) */
  priority: number;
  /** Short action title */
  title: string;
  /** Full description of what needs to be done */
  description: string;
  /** Systems this recommendation touches */
  categories: string[];
  /** Specific finding descriptions bundled into this recommendation */
  findings: string[];
  /** Action type determines display tier in the UI */
  action_type: ActionType;
  /** Type of contractor to engage */
  contractor_type: string;
  /** Optional seasonal timing note */
  seasonal_note: string | null;
  /** Whether a DIY-capable homeowner can address this */
  diy_eligible: boolean;
  /** Whether multiple findings are bundled — alerts user they save on mobilization */
  bundled: boolean;
  /** Number of individual findings bundled into this recommendation */
  finding_count: number;
  /** Estimated cost range for this recommendation */
  cost_range: CostRange;
  /** Formatted cost string */
  cost_range_formatted: string;
  /** Internal ROI score used for sorting (not exposed to user) */
  _roi_score: number;
}

// ─────────────────────────────────────────────────────────────────
// CONTRACTOR TYPE MAP
// ─────────────────────────────────────────────────────────────────
const CONTRACTOR_TYPES: Record<string, string> = {
  structure_foundation:    "Structural Engineer or Foundation Contractor",
  roof_drainage_exterior:  "Licensed Roofing Contractor",
  electrical:              "Licensed Electrician",
  plumbing:                "Licensed Plumber",
  hvac:                    "HVAC Technician (NATE Certified)",
  appliances_water_heater: "Appliance Repair Technician or Plumber",
  interior_windows_doors:  "General Contractor or Handyman",
  safety_environmental:    "Certified Remediation Specialist",
  site_grading_drainage:   "Grading & Drainage Contractor or Landscaper",
  maintenance_upkeep:      "General Contractor or Handyman",
};

// ─────────────────────────────────────────────────────────────────
// SEASONAL NOTES
// Returns a timing suggestion based on system and current month.
// ─────────────────────────────────────────────────────────────────
function getSeasonalNote(category: string): string | null {
  const month = new Date().getMonth(); // 0 = Jan, 11 = Dec
  const isWinter = month <= 1 || month === 11;
  const isFall   = month >= 8 && month <= 10;
  const isSpring = month >= 2 && month <= 4;
  const isSummer = month >= 5 && month <= 7;

  switch (category) {
    case "roof_drainage_exterior":
      if (isWinter) return "Schedule before spring — roofing contractors book quickly in March–April.";
      if (isFall)   return "Address before winter to prevent ice dam and moisture damage.";
      return "Spring and fall are ideal for roof work.";

    case "hvac":
      if (isWinter) return "Service heating system now — avoid emergency calls during cold snaps.";
      if (isSummer) return "Service cooling system now — avoid emergency calls during heat waves.";
      if (isSpring) return "Spring is ideal for AC tune-up before cooling season.";
      return "Fall is ideal for furnace tune-up before heating season.";

    case "plumbing":
      if (isWinter) return "Insulate exposed pipes before freezing temperatures arrive.";
      return null;

    case "site_grading_drainage":
      if (isWinter) return "Schedule for spring when ground thaws for easier grading work.";
      if (isFall)   return "Address before winter rains to prevent foundation moisture issues.";
      return null;

    case "interior_windows_doors":
      if (isWinter) return "Air sealing and weatherstripping work best before heating season.";
      return null;

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// DIY ELIGIBILITY
// ─────────────────────────────────────────────────────────────────
function isDiyEligible(category: string, deficiencySeverity: string): boolean {
  // Safety, structural, electrical, plumbing — licensed only unless truly minor
  const licensedOnly = new Set(["structure_foundation", "electrical", "plumbing", "safety_environmental"]);
  if (licensedOnly.has(category) && deficiencySeverity !== "none") return false;

  // HVAC — maintenance is DIY (filters), repairs are not
  if (category === "hvac") return deficiencySeverity === "none" || deficiencySeverity === "minor";

  // Roof — minor maintenance (caulking, gutter cleaning) is DIY; repairs are not
  if (category === "roof_drainage_exterior") return deficiencySeverity === "none";

  // Interior / appliances / site — minor work is DIY-eligible
  return deficiencySeverity === "none" || deficiencySeverity === "minor";
}

// ─────────────────────────────────────────────────────────────────
// ACTION TYPE DERIVATION
// ─────────────────────────────────────────────────────────────────
function deriveActionType(item: NormalizedItem): ActionType {
  if (item.safety_impact === "critical" || item.safety_impact === "high") return "immediate_safety";
  if (item.deficiency_severity === "severe" || item.deficiency_severity === "major") return "urgent_repair";
  if (item.deficiency_severity === "moderate") return "planned_repair";
  if (item.deficiency_severity === "minor")    return "planned_repair";
  if (item.deficiency_severity === "none" && item.maintenance_state === "deferred") return "maintenance";
  if (item.deficiency_severity === "none")     return "monitor";
  return "planned_repair";
}

// ─────────────────────────────────────────────────────────────────
// ROI SCORE
// Higher = should be done sooner. Drives final sort order.
// Factors: urgency, safety, score impact, cost efficiency
// ─────────────────────────────────────────────────────────────────
const ACTION_TYPE_ORDER: Record<ActionType, number> = {
  immediate_safety: 1000,
  urgent_repair:     500,
  planned_repair:    200,
  maintenance:        50,
  monitor:            10,
};

const SEVERITY_SCORES: Record<string, number> = {
  severe: 80, major: 60, moderate: 40, minor: 20, none: 5,
};

const SAFETY_SCORES: Record<string, number> = {
  critical: 100, high: 75, medium: 40, low: 10, none: 0, unknown: 0,
};

function computeRoiScore(
  actionType: ActionType,
  deficiencySeverity: string,
  safetyImpact: string,
  costRange: CostRange,
): number {
  const urgencyScore   = ACTION_TYPE_ORDER[actionType] ?? 0;
  const severityScore  = SEVERITY_SCORES[deficiencySeverity] ?? 0;
  const safetyScore    = SAFETY_SCORES[safetyImpact] ?? 0;
  // Cost efficiency: lower cost = higher ROI for same severity
  const costMidpoint   = (costRange.estimated_cost_min + costRange.estimated_cost_max) / 2;
  const costEfficiency = costMidpoint > 0 ? Math.min(50, 5000 / costMidpoint) : 0;

  return urgencyScore + severityScore + safetyScore + costEfficiency;
}

// ─────────────────────────────────────────────────────────────────
// RECOMMENDATION TITLE BUILDER
// ─────────────────────────────────────────────────────────────────
function buildTitle(category: string, actionType: ActionType, findingCount: number): string {
  const systemLabel: Record<string, string> = {
    structure_foundation:    "Foundation",
    roof_drainage_exterior:  "Roof & Exterior",
    electrical:              "Electrical",
    plumbing:                "Plumbing",
    hvac:                    "HVAC",
    appliances_water_heater: "Appliances & Water Heater",
    interior_windows_doors:  "Interior & Windows",
    safety_environmental:    "Safety",
    site_grading_drainage:   "Drainage & Grading",
    maintenance_upkeep:      "General Maintenance",
  };

  const system = systemLabel[category] ?? category;
  const countNote = findingCount > 1 ? ` (${findingCount} items)` : "";

  switch (actionType) {
    case "immediate_safety": return `Address ${system} Safety Issue${findingCount > 1 ? "s" : ""}${countNote}`;
    case "urgent_repair":    return `Repair ${system}${countNote}`;
    case "planned_repair":   return `Schedule ${system} Repair${countNote}`;
    case "maintenance":      return `${system} Maintenance${countNote}`;
    case "monitor":          return `Monitor ${system}${countNote}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// FORMAT COST RANGE
// ─────────────────────────────────────────────────────────────────
function formatCost(range: CostRange): string {
  const fmt = (n: number) => "$" + n.toLocaleString("en-US");
  return `${fmt(range.estimated_cost_min)} – ${fmt(range.estimated_cost_max)} (estimated)`;
}

// ─────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────

/**
 * Generates bundled, prioritized action recommendations from normalized items.
 * Groups findings by category + action type, bundles related ones together.
 * Returns sorted by ROI score (safety critical first, then urgency, then cost efficiency).
 *
 * Called inside runScoringPipeline() when enableRecommendations flag is on.
 */
export function computeRecommendations(items: NormalizedItem[]): Recommendation[] {
  // Only recommend on items with actual deficiencies or safety concerns
  const actionableItems = items.filter(i =>
    i.deficiency_severity !== "none" ||
    (i.safety_impact !== "none" && i.safety_impact !== "unknown") ||
    i.maintenance_state === "deferred" ||
    i.maintenance_state === "poor"
  );

  if (!actionableItems.length) return [];

  // Group by category + action_type for bundling
  const buckets = new Map<string, NormalizedItem[]>();
  for (const item of actionableItems) {
    const actionType = deriveActionType(item);
    const key = `${item.category}::${actionType}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }

  const recommendations: Recommendation[] = [];

  for (const [key, bucketItems] of buckets) {
    const [category, actionType] = key.split("::") as [string, ActionType];

    // Pick the worst item in the bucket to drive the cost range and description
    const worstItem = bucketItems.reduce((worst, item) => {
      const ws = (SAFETY_SCORES[worst.safety_impact] ?? 0) + (SEVERITY_SCORES[worst.deficiency_severity] ?? 0);
      const is = (SAFETY_SCORES[item.safety_impact]  ?? 0) + (SEVERITY_SCORES[item.deficiency_severity]  ?? 0);
      return is > ws ? item : worst;
    });

    const repairType = deriveRepairType(
      worstItem.deficiency_severity,
      worstItem.estimated_remaining_life_percent,
      worstItem.replacement_window,
    );
    const costRange = getCostRangeForItem(
      category,
      worstItem.deficiency_severity,
      worstItem.estimated_remaining_life_percent,
      worstItem.replacement_window,
    );

    const roiScore = computeRoiScore(
      actionType,
      worstItem.deficiency_severity,
      worstItem.safety_impact,
      costRange,
    );

    const findings = bucketItems
      .map(i => i.notes || i.recommended_action || `${i.system} — ${i.condition_label}`)
      .filter(Boolean)
      .slice(0, 5);

    // Build description
    const primaryFinding = findings[0] ?? "";
    const extraCount = bucketItems.length - 1;
    const description = extraCount > 0
      ? `${primaryFinding} — plus ${extraCount} related item${extraCount > 1 ? "s" : ""} in this system.`
      : primaryFinding;

    recommendations.push({
      priority:             0, // assigned after sort
      title:                buildTitle(category, actionType, bucketItems.length),
      description,
      categories:           [category],
      findings,
      action_type:          actionType,
      contractor_type:      CONTRACTOR_TYPES[category] ?? "Licensed Contractor",
      seasonal_note:        getSeasonalNote(category),
      diy_eligible:         isDiyEligible(category, worstItem.deficiency_severity),
      bundled:              bucketItems.length > 1,
      finding_count:        bucketItems.length,
      cost_range:           costRange,
      cost_range_formatted: formatCost(costRange),
      _roi_score:           roiScore,
    });
  }

  // Sort by ROI score descending, assign priorities
  recommendations.sort((a, b) => b._roi_score - a._roi_score);
  recommendations.forEach((r, i) => { r.priority = i + 1; });

  return recommendations;
}
