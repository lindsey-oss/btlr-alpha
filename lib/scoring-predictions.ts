/**
 * BTLR Predictions Engine
 * Patent Pending — Proprietary
 *
 * Generates per-system failure windows and cost range predictions from
 * normalized inspection data. One prediction per scored system.
 *
 * Gated by: enablePredictions feature flag.
 * When flag is OFF — predictions are computed but not attached to the report.
 * When flag is ON  — predictions appear on HomeHealthReport.predictions.
 *
 * Inputs:  NormalizedItem[] (the same items fed to the scoring engine)
 * Outputs: SystemPrediction[] — one entry per system, sorted by urgency
 */

import type { NormalizedItem } from "./scoring-engine";
import {
  getCostRangeForItem,
  deriveRepairType,
  type CostRange,
  type RepairType,
} from "./scoring-cost-ranges";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export type FailureWindow =
  | "immediate"       // act now — past end of life or critical safety
  | "0_to_1_year"     // within the next year
  | "1_to_3_years"    // planning horizon
  | "3_to_5_years"    // watch list
  | "5_plus_years"    // long-term, low urgency
  | "no_action_needed"; // system is in good shape

export type PredictionUrgency = "critical" | "high" | "medium" | "low" | "monitor";

export interface SystemPrediction {
  /** BTLR canonical category key */
  category: string;
  /** Human-readable system name */
  system_label: string;
  /** Estimated window before action is required */
  failure_window: FailureWindow;
  /** User-facing failure window label */
  failure_window_label: string;
  /** What type of repair/action is predicted */
  repair_type: RepairType;
  /** Repair type label */
  repair_type_label: string;
  /** Estimated cost range for the predicted action */
  cost_range: CostRange;
  /** Formatted cost string — e.g. "$1,500 – $5,000 (estimated)" */
  cost_range_formatted: string;
  /** How urgent this prediction is */
  urgency: PredictionUrgency;
  /** Primary finding driving this prediction */
  driver: string;
  /** Confidence in this prediction */
  confidence: "low" | "medium" | "high";
  /** True when no inspection data exists for this system */
  not_assessed: boolean;
}

// ─────────────────────────────────────────────────────────────────
// SYSTEM LABELS
// ─────────────────────────────────────────────────────────────────
const SYSTEM_LABELS: Record<string, string> = {
  structure_foundation:    "Structure & Foundation",
  roof_drainage_exterior:  "Roof & Exterior",
  electrical:              "Electrical",
  plumbing:                "Plumbing",
  hvac:                    "HVAC",
  appliances_water_heater: "Appliances & Water Heater",
  interior_windows_doors:  "Interior, Windows & Doors",
  safety_environmental:    "Safety & Environmental",
  site_grading_drainage:   "Site & Drainage",
  maintenance_upkeep:      "General Maintenance",
};

const REPAIR_TYPE_LABELS: Record<RepairType, string> = {
  maintenance:  "Routine Maintenance",
  minor_repair: "Minor Repair",
  major_repair: "Major Repair",
  replacement:  "Replacement",
};

// ─────────────────────────────────────────────────────────────────
// FAILURE WINDOW DERIVATION
// ─────────────────────────────────────────────────────────────────

function deriveFailureWindow(
  remainingLifePercent: number,
  replacementWindow: string,
  deficiencySeverity: string,
  safetyImpact: string,
): FailureWindow {
  // Safety or severe deficiency → immediate
  if (safetyImpact === "critical" || deficiencySeverity === "severe") return "immediate";

  // Explicit replacement window takes priority
  if (replacementWindow === "immediate_to_1_year" || remainingLifePercent <= 5)  return "immediate";
  if (remainingLifePercent <= 15) return "0_to_1_year";
  if (replacementWindow === "1_to_3_years" || remainingLifePercent <= 30)        return "1_to_3_years";
  if (remainingLifePercent <= 55) return "3_to_5_years";

  // Major or high safety issue still flags a window
  if (deficiencySeverity === "major" || safetyImpact === "high") return "1_to_3_years";
  if (deficiencySeverity === "moderate" || safetyImpact === "medium")            return "3_to_5_years";
  if (deficiencySeverity === "minor")                                             return "5_plus_years";

  return "no_action_needed";
}

const FAILURE_WINDOW_LABELS: Record<FailureWindow, string> = {
  immediate:        "Act Immediately",
  "0_to_1_year":    "Within 1 Year",
  "1_to_3_years":   "Within 1–3 Years",
  "3_to_5_years":   "Within 3–5 Years",
  "5_plus_years":   "5+ Years",
  no_action_needed: "No Action Needed",
};

// ─────────────────────────────────────────────────────────────────
// URGENCY DERIVATION
// ─────────────────────────────────────────────────────────────────

function deriveUrgency(
  failureWindow: FailureWindow,
  safetyImpact: string,
): PredictionUrgency {
  if (safetyImpact === "critical" || failureWindow === "immediate") return "critical";
  if (safetyImpact === "high"     || failureWindow === "0_to_1_year") return "high";
  if (safetyImpact === "medium"   || failureWindow === "1_to_3_years") return "medium";
  if (failureWindow === "3_to_5_years") return "low";
  return "monitor";
}

// ─────────────────────────────────────────────────────────────────
// PREDICTION CONFIDENCE
// ─────────────────────────────────────────────────────────────────

function derivePredictionConfidence(
  items: NormalizedItem[],
  failureWindow: FailureWindow,
): "low" | "medium" | "high" {
  if (!items.length) return "low";

  const avgConf = items.reduce((s, i) => s + i.inspector_confidence, 0) / items.length;
  const hasRealAgeData = items.some(i => i.estimated_age_years != null);

  // Immediate and near-term predictions need corroboration to be high confidence
  if (failureWindow === "immediate" || failureWindow === "0_to_1_year") {
    return hasRealAgeData && avgConf >= 0.8 ? "high" : avgConf >= 0.6 ? "medium" : "low";
  }
  if (avgConf >= 0.8) return "high";
  if (avgConf >= 0.6) return "medium";
  return "low";
}

// ─────────────────────────────────────────────────────────────────
// WORST-ITEM SELECTOR
// Picks the single item most driving the system's prediction.
// Prioritizes: safety > severity > remaining life
// ─────────────────────────────────────────────────────────────────

const SAFETY_ORDER: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, none: 0, unknown: 0,
};
const SEVERITY_ORDER: Record<string, number> = {
  severe: 5, major: 4, moderate: 3, minor: 2, none: 1,
};

function pickWorstItem(items: NormalizedItem[]): NormalizedItem {
  return items.reduce((worst, item) => {
    const worstScore =
      (SAFETY_ORDER[worst.safety_impact]   ?? 0) * 100 +
      (SEVERITY_ORDER[worst.deficiency_severity] ?? 0) * 10 +
      (100 - worst.estimated_remaining_life_percent);
    const itemScore =
      (SAFETY_ORDER[item.safety_impact]    ?? 0) * 100 +
      (SEVERITY_ORDER[item.deficiency_severity]  ?? 0) * 10 +
      (100 - item.estimated_remaining_life_percent);
    return itemScore > worstScore ? item : worst;
  });
}

// ─────────────────────────────────────────────────────────────────
// URGENCY SORT ORDER
// ─────────────────────────────────────────────────────────────────

const URGENCY_ORDER: Record<PredictionUrgency, number> = {
  critical: 5, high: 4, medium: 3, low: 2, monitor: 1,
};

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
 * Generates one SystemPrediction per system from normalized inspection items.
 * Sorted by urgency (critical first).
 *
 * Called inside runScoringPipeline() when enablePredictions flag is on.
 * Safe to call with an empty array — returns not_assessed entries for all systems.
 */
export function computePredictions(
  items: NormalizedItem[],
  categories: string[],
): SystemPrediction[] {
  const predictions: SystemPrediction[] = [];

  for (const category of categories) {
    const catItems = items.filter(i => i.category === category);

    // Not Assessed — no data for this system
    if (!catItems.length) {
      predictions.push({
        category,
        system_label:        SYSTEM_LABELS[category] ?? category,
        failure_window:      "no_action_needed",
        failure_window_label: FAILURE_WINDOW_LABELS["no_action_needed"],
        repair_type:         "maintenance",
        repair_type_label:   REPAIR_TYPE_LABELS["maintenance"],
        cost_range:          getCostRangeForItem(category, "none", 100, "3_plus_years"),
        cost_range_formatted: formatCost(getCostRangeForItem(category, "none", 100, "3_plus_years")),
        urgency:             "monitor",
        driver:              "No inspection data available for this system.",
        confidence:          "low",
        not_assessed:        true,
      });
      continue;
    }

    const worst       = pickWorstItem(catItems);
    const failWindow  = deriveFailureWindow(
      worst.estimated_remaining_life_percent,
      worst.replacement_window,
      worst.deficiency_severity,
      worst.safety_impact,
    );
    const repairType  = deriveRepairType(
      worst.deficiency_severity,
      worst.estimated_remaining_life_percent,
      worst.replacement_window,
    );
    const urgency     = deriveUrgency(failWindow, worst.safety_impact);
    const costRange   = getCostRangeForItem(
      category,
      worst.deficiency_severity,
      worst.estimated_remaining_life_percent,
      worst.replacement_window,
    );
    const confidence  = derivePredictionConfidence(catItems, failWindow);
    const driver      = worst.notes || worst.recommended_action || `${worst.system} — ${worst.condition_label}`;

    predictions.push({
      category,
      system_label:         SYSTEM_LABELS[category] ?? category,
      failure_window:       failWindow,
      failure_window_label: FAILURE_WINDOW_LABELS[failWindow],
      repair_type:          repairType,
      repair_type_label:    REPAIR_TYPE_LABELS[repairType],
      cost_range:           costRange,
      cost_range_formatted: formatCost(costRange),
      urgency,
      driver,
      confidence,
      not_assessed:         false,
    });
  }

  // Sort: critical → high → medium → low → monitor, not_assessed last
  return predictions.sort((a, b) => {
    if (a.not_assessed !== b.not_assessed) return a.not_assessed ? 1 : -1;
    return (URGENCY_ORDER[b.urgency] ?? 0) - (URGENCY_ORDER[a.urgency] ?? 0);
  });
}
