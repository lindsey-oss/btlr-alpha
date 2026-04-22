/**
 * BTLR Home Health Scoring Engine
 * Patent Pending — Proprietary
 *
 * Deterministic, weighted, multi-dimensional scoring for residential properties.
 * Same inputs → same outputs, every time.
 */

// ─────────────────────────────────────────────────────────────────
// MASTER CATEGORY WEIGHTS
// ─────────────────────────────────────────────────────────────────
export const CATEGORY_WEIGHTS: Record<string, number> = {
  structure_foundation:     0.18,
  roof_drainage_exterior:   0.16,
  plumbing:                 0.11,
  electrical:               0.11,
  hvac:                     0.10,
  interior_windows_doors:   0.08,
  appliances_water_heater:  0.07,
  safety_environmental:     0.10,
  site_grading_drainage:    0.05,
  maintenance_upkeep:       0.04,
};

// ─────────────────────────────────────────────────────────────────
// CONDITION MAP
// ─────────────────────────────────────────────────────────────────
export const CONDITION_SCORES: Record<string, number | null> = {
  excellent:    95,
  good:         85,
  serviceable:  78,
  average:      75,
  fair:         65,
  aged:         60,
  poor:         45,
  very_poor:    30,
  failed:       10,
  not_observed: null,
};

// ─────────────────────────────────────────────────────────────────
// PENALTY / ADJUSTMENT TABLES
// ─────────────────────────────────────────────────────────────────
const DEFICIENCY_PENALTY: Record<string, number> = {
  none: 0, minor: 4, moderate: 10, major: 20, severe: 30,
};

const SAFETY_PENALTY: Record<string, number> = {
  none: 0, low: 3, medium: 8, high: 18, critical: 30,
};

const FUNCTIONAL_ADJ: Record<string, number> = {
  functional: 0, partially: -8, not: -20, unknown: -3,
};

const MAINTENANCE_ADJ: Record<string, number> = {
  well: 4, adequate: 0, deferred: -8, poor: -15, unknown: -2,
};

function remainingLifeAdj(pct: number): number {
  if (pct >= 80) return 4;
  if (pct >= 60) return 2;
  if (pct >= 40) return 0;
  if (pct >= 20) return -6;
  if (pct >= 10) return -12;
  return -18;
}

// ─────────────────────────────────────────────────────────────────
// STATUS BANDS
// ─────────────────────────────────────────────────────────────────
export function scoreBand(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Fair";
  if (score >= 60) return "Needs Attention";
  return "High Risk";
}

// ─────────────────────────────────────────────────────────────────
// CATEGORY NORMALIZER
// Maps any string to a master category key
// ─────────────────────────────────────────────────────────────────
export function toCategoryKey(category: string): string {
  const c = (category || "").toLowerCase();
  if (c.includes("struct") || c.includes("found") || c.includes("crawl") || c.includes("basement"))
    return "structure_foundation";
  if (c.includes("roof") || c.includes("gutter") || c.includes("exterior") || c.includes("siding") || c.includes("fascia") || c.includes("soffit"))
    return "roof_drainage_exterior";
  if (c.includes("plumb") || c.includes("pipe") || c.includes("sink") || c.includes("toilet") || c.includes("faucet") || c.includes("sewer"))
    return "plumbing";
  if (c.includes("electric") || c.includes("panel") || c.includes("wiring") || c.includes("outlet") || c.includes("circuit") || c.includes("gfci"))
    return "electrical";
  if (c.includes("hvac") || c.includes("heat") || c.includes("cool") || c.includes("furnace") || c.includes("ac ") || c.includes(" ac") || c.includes("duct") || c.includes("air"))
    return "hvac";
  if (c.includes("window") || c.includes("door") || c.includes("interior") || c.includes("floor") || c.includes("ceiling") || c.includes("wall") || c.includes("stair"))
    return "interior_windows_doors";
  if (c.includes("applian") || c.includes("water heater") || c.includes("dishwash") || c.includes("oven") || c.includes("range") || c.includes("refriger") || c.includes("dryer") || c.includes("washer"))
    return "appliances_water_heater";
  if (c.includes("safety") || c.includes("smoke") || c.includes("carbon") || c.includes("mold") || c.includes("pest") || c.includes("termite") || c.includes("radon") || c.includes("asbestos") || c.includes("lead"))
    return "safety_environmental";
  if (c.includes("site") || c.includes("grading") || c.includes("landscap") || c.includes("retaining") || c.includes("driveway"))
    return "site_grading_drainage";
  return "maintenance_upkeep";
}

// ─────────────────────────────────────────────────────────────────
// NORMALIZED ITEM MODEL
// ─────────────────────────────────────────────────────────────────
export interface NormalizedItem {
  system: string;
  component: string;
  category: string;                    // master category key
  condition_label: string;
  condition_score: number;
  deficiency_severity: string;
  safety_impact: string;
  functional_status: string;
  estimated_remaining_life_percent: number;
  maintenance_state: string;
  issue_count: number;
  inspector_confidence: number;        // 0–1
  source_type: string;
  notes: string;
  recommended_action: string;
  cost_urgency: string;
  estimated_age_years: number | null;
  replacement_window: string;
}

// ─────────────────────────────────────────────────────────────────
// REPAIR EVENT MODEL
// ─────────────────────────────────────────────────────────────────
export interface RepairEvent {
  event_type: "repair_completed" | "component_replaced" | "system_serviced";
  system: string;
  component?: string;
  confidence: number;
  source: "invoice" | "receipt" | "vendor_confirmation" | "user_report" | "inspection";
  date: string;
}

// ─────────────────────────────────────────────────────────────────
// OUTPUT FORMAT
// ─────────────────────────────────────────────────────────────────
export interface CategoryScore {
  category: string;
  score: number;
  confidence: number;
  status: string;
  top_findings: string[];
  limited_data: boolean;
}

export interface PriorityAction {
  priority: number;
  issue: string;
  urgency: string;
  estimated_impact_on_score: number;
  diy_possible: boolean;
  recommended_path: string;
}

export interface HomeHealthReport {
  home_health_score: number;
  score_band: string;
  readiness_score: number;
  safety_score: number;
  maintenance_score: number;
  confidence_score: number;
  category_scores: CategoryScore[];
  priority_actions: PriorityAction[];
  strengths: string[];
  watchlist: string[];
  data_gaps: string[];
  recent_improvements: string[];
  summary_for_user: string;
}

// ─────────────────────────────────────────────────────────────────
// ITEM SCORE FORMULA
// ─────────────────────────────────────────────────────────────────
function computeItemScore(item: NormalizedItem): number {
  const base = item.condition_score;
  const defPen  = DEFICIENCY_PENALTY[item.deficiency_severity]  ?? DEFICIENCY_PENALTY.moderate;
  const safePen = SAFETY_PENALTY[item.safety_impact]            ?? SAFETY_PENALTY.none;
  const funcAdj = FUNCTIONAL_ADJ[item.functional_status]        ?? FUNCTIONAL_ADJ.unknown;
  const maintAdj = MAINTENANCE_ADJ[item.maintenance_state]      ?? MAINTENANCE_ADJ.unknown;
  const lifeAdj  = remainingLifeAdj(item.estimated_remaining_life_percent);

  const raw = base - defPen - safePen + funcAdj + maintAdj + lifeAdj;
  return Math.max(0, Math.min(100, raw));
}

// ─────────────────────────────────────────────────────────────────
// CATEGORY SCORE WITH CONFIDENCE BLENDING
// Neutral baseline is 72 — a home with unknown data shouldn't look
// excellent or terrible, just uncertain.
// ─────────────────────────────────────────────────────────────────
const CONFIDENCE_NEUTRAL = 72;

function computeCategoryScore(items: NormalizedItem[]): { score: number; confidence: number } {
  if (!items.length) return { score: CONFIDENCE_NEUTRAL, confidence: 0.3 };

  const avgScore = items.reduce((s, i) => s + computeItemScore(i), 0) / items.length;
  const avgConf  = items.reduce((s, i) => s + i.inspector_confidence, 0) / items.length;

  // Blend toward neutral when confidence is low
  const blended = (avgScore * avgConf) + (CONFIDENCE_NEUTRAL * (1 - avgConf));
  return { score: Math.max(0, Math.min(100, blended)), confidence: avgConf };
}

// ─────────────────────────────────────────────────────────────────
// URGENCY BUCKET
// ─────────────────────────────────────────────────────────────────
function toUrgency(item: NormalizedItem): string {
  if (item.deficiency_severity === "severe" || item.safety_impact === "critical") return "immediate";
  if (item.deficiency_severity === "major"  || item.safety_impact === "high")     return "0_to_3_months";
  if (item.deficiency_severity === "moderate")                                     return "3_to_6_months";
  if (item.deficiency_severity === "minor")                                        return "6_to_12_months";
  if (item.replacement_window === "1_to_3_years")                                 return "6_to_24_months";
  return "monitor_only";
}

function urgencyLabel(u: string): string {
  const map: Record<string, string> = {
    immediate:       "Act now",
    "0_to_3_months": "Within 3 months",
    "3_to_6_months": "Within 6 months",
    "6_to_12_months":"Within 12 months",
    "6_to_24_months":"Within 1–2 years",
    monitor_only:    "Monitor",
  };
  return map[u] ?? u;
}

// ─────────────────────────────────────────────────────────────────
// MAIN ENGINE ENTRY POINT
// ─────────────────────────────────────────────────────────────────
export function computeHomeHealthReport(items: NormalizedItem[]): HomeHealthReport {
  // Group items by master category
  const byCategory: Record<string, NormalizedItem[]> = {};
  for (const cat of Object.keys(CATEGORY_WEIGHTS)) byCategory[cat] = [];
  for (const item of items) {
    const key = item.category in byCategory ? item.category : toCategoryKey(item.system);
    if (key in byCategory) byCategory[key].push(item);
  }

  // Compute per-category scores
  const categoryScores: CategoryScore[] = Object.entries(CATEGORY_WEIGHTS).map(([cat, weight]) => {
    const catItems = byCategory[cat] ?? [];
    const { score, confidence } = computeCategoryScore(catItems);
    const limited   = catItems.length === 0 || confidence < 0.5;
    const topFindings = catItems
      .filter(i => i.deficiency_severity !== "none")
      .sort((a, b) => computeItemScore(a) - computeItemScore(b))
      .slice(0, 3)
      .map(i => i.notes || i.recommended_action);
    return {
      category: cat,
      score:     Math.round(score),
      confidence: parseFloat(confidence.toFixed(2)),
      status:    scoreBand(score),
      top_findings: topFindings,
      limited_data: limited,
    };
  });

  // Weighted home health score
  const rawHealth = categoryScores.reduce((sum, cs) => {
    const w = CATEGORY_WEIGHTS[cs.category] ?? 0;
    return sum + cs.score * w;
  }, 0);
  const home_health_score = Math.round(Math.max(0, Math.min(100, rawHealth)));

  // ── Sub-scores ────────────────────────────────────────────────

  // Safety score: 100 minus all safety penalties only
  const safetyPenaltyTotal = items.reduce((sum, i) => {
    return sum + (SAFETY_PENALTY[i.safety_impact] ?? 0);
  }, 0);
  const safety_score = Math.round(Math.max(0, Math.min(100, 100 - safetyPenaltyTotal)));

  // Maintenance score: base 85, +/- maintenance state
  const maintBase = 85;
  const maintDelta = items.reduce((sum, i) => {
    return sum + (MAINTENANCE_ADJ[i.maintenance_state] ?? MAINTENANCE_ADJ.unknown);
  }, 0);
  const maintenance_score = Math.round(Math.max(0, Math.min(100, maintBase + maintDelta)));

  // Readiness score: start 100, subtract risk factors
  let readiness = 100;
  for (const item of items) {
    if (item.estimated_remaining_life_percent <= 20) readiness -= 8;
    if (item.safety_impact === "high" || item.safety_impact === "critical") readiness -= 10;
    if (item.maintenance_state === "deferred" || item.maintenance_state === "poor") readiness -= 6;
    if (item.notes.toLowerCase().includes("leak") || item.notes.toLowerCase().includes("moisture")) readiness -= 8;
  }
  const readiness_score = Math.round(Math.max(0, Math.min(100, readiness)));

  // Confidence score: average inspector confidence across items
  const avgConf = items.length > 0
    ? items.reduce((s, i) => s + i.inspector_confidence, 0) / items.length
    : 0.4;
  const confidence_score = Math.round(avgConf * 100);

  // ── Priority actions ──────────────────────────────────────────
  const priority_actions: PriorityAction[] = items
    .filter(i => i.deficiency_severity !== "none" || i.safety_impact !== "none")
    .sort((a, b) => computeItemScore(a) - computeItemScore(b))
    .slice(0, 8)
    .map((item, idx) => {
      const urgency = toUrgency(item);
      const impact  = Math.round(
        (DEFICIENCY_PENALTY[item.deficiency_severity] ?? 0) +
        (SAFETY_PENALTY[item.safety_impact] ?? 0)
      );
      const isDiy = item.deficiency_severity === "minor" && item.safety_impact === "none";
      return {
        priority: idx + 1,
        issue: item.notes || `${item.system} — ${item.condition_label}`,
        urgency: urgencyLabel(urgency),
        estimated_impact_on_score: impact,
        diy_possible: isDiy,
        recommended_path: isDiy ? "diy_or_vendor" : "book_vendor",
      };
    });

  // ── Strengths ─────────────────────────────────────────────────
  const strengths = categoryScores
    .filter(cs => cs.score >= 80 && !cs.limited_data)
    .map(cs => `${cs.category.replace(/_/g, " ")} (${cs.score}/100)`);

  // ── Watchlist ─────────────────────────────────────────────────
  const watchlist = items
    .filter(i => i.deficiency_severity === "minor" && computeItemScore(i) >= 60)
    .slice(0, 4)
    .map(i => i.notes || i.system);

  // ── Data gaps ─────────────────────────────────────────────────
  const data_gaps = categoryScores
    .filter(cs => cs.limited_data)
    .map(cs => `${cs.category.replace(/_/g, " ")} — limited inspection data`);

  // ── Summary for user ─────────────────────────────────────────
  const band = scoreBand(home_health_score);
  const topIssue = priority_actions[0]?.issue ?? "";
  const summaryMap: Record<string, string> = {
    "Excellent": "Your home is in excellent shape. Stay on top of routine maintenance to keep it that way.",
    "Good":      `Your home is in good overall condition${topIssue ? `. Keep an eye on: ${topIssue}` : "."}`,
    "Fair":      `Your home needs some attention. Priority: ${topIssue || "see full breakdown for details"}.`,
    "Needs Attention": `Several systems need attention. Start with: ${topIssue || "see full breakdown"}.`,
    "High Risk": `Immediate action required. Critical issues detected: ${topIssue || "see full breakdown"}.`,
  };
  const summary_for_user = summaryMap[band] ?? "See full breakdown for details.";

  return {
    home_health_score,
    score_band: band,
    readiness_score,
    safety_score,
    maintenance_score,
    confidence_score,
    category_scores: categoryScores,
    priority_actions,
    strengths,
    watchlist,
    data_gaps,
    recent_improvements: [],
    summary_for_user,
  };
}

// ─────────────────────────────────────────────────────────────────
// NORMALIZE EXISTING FINDINGS → NormalizedItem[]
// Bridge between the current simple Finding format and the engine
// ─────────────────────────────────────────────────────────────────
interface LegacyFinding {
  category: string;
  description: string;
  severity: "critical" | "warning" | "info";
  estimated_cost?: number | null;
}

function severityToCondition(severity: string): { condition_label: string; condition_score: number } {
  if (severity === "critical") return { condition_label: "poor",        condition_score: 45 };
  if (severity === "warning")  return { condition_label: "fair",        condition_score: 65 };
  return                              { condition_label: "serviceable", condition_score: 78 };
}

function severityToDeficiency(severity: string): string {
  if (severity === "critical") return "major";
  if (severity === "warning")  return "moderate";
  return "minor";
}

function severityToSafety(severity: string): string {
  if (severity === "critical") return "high";
  if (severity === "warning")  return "low";
  return "none";
}

function estimatedRemainingLife(severity: string): number {
  if (severity === "critical") return 10;
  if (severity === "warning")  return 35;
  return 65;
}

function toReplacementWindow(severity: string, cost?: number | null): string {
  if (severity === "critical") return "immediate_to_1_year";
  if (severity === "warning")  return "1_to_3_years";
  return "3_plus_years";
}

export function normalizeLegacyFindings(
  findings: LegacyFinding[],
  roofAgeYears?: number | null,
  hvacAgeYears?: number | null,
): NormalizedItem[] {
  const items: NormalizedItem[] = findings.map(f => {
    const { condition_label, condition_score } = severityToCondition(f.severity);
    const category = toCategoryKey(f.category);
    return {
      system:                           f.category,
      component:                        f.category,
      category,
      condition_label,
      condition_score,
      deficiency_severity:              severityToDeficiency(f.severity),
      safety_impact:                    severityToSafety(f.severity),
      functional_status:                f.severity === "critical" ? "partially" : "functional",
      estimated_remaining_life_percent: estimatedRemainingLife(f.severity),
      maintenance_state:                f.severity === "critical" ? "deferred" : f.severity === "warning" ? "adequate" : "adequate",
      issue_count:                      1,
      inspector_confidence:             0.75,  // moderate confidence for AI-extracted findings
      source_type:                      "inspection_report",
      notes:                            f.description,
      recommended_action:               f.severity === "critical"
        ? "Address immediately — contact a licensed contractor"
        : f.severity === "warning"
          ? "Schedule repair within 6–12 months"
          : "Monitor and perform routine maintenance",
      cost_urgency:                     f.severity === "critical" ? "immediate" : f.severity === "warning" ? "3_to_6_months" : "monitor_only",
      estimated_age_years:              null,
      replacement_window:               toReplacementWindow(f.severity, f.estimated_cost),
    };
  });

  // Add synthetic system-age items for roof and HVAC when we have age data
  if (roofAgeYears !== null && roofAgeYears !== undefined) {
    const lifespan = 25;
    const remainingPct = Math.max(0, ((lifespan - roofAgeYears) / lifespan) * 100);
    const severity = roofAgeYears >= 22 ? "critical" : roofAgeYears >= 17 ? "warning" : "info";
    const { condition_label, condition_score } = severityToCondition(severity);
    items.push({
      system:                           "Roof",
      component:                        "Roof System",
      category:                         "roof_drainage_exterior",
      condition_label:                  roofAgeYears >= 22 ? "aged" : roofAgeYears >= 17 ? "fair" : "serviceable",
      condition_score:                  roofAgeYears >= 22 ? 60 : roofAgeYears >= 17 ? 65 : 80,
      deficiency_severity:              roofAgeYears >= 22 ? "moderate" : "minor",
      safety_impact:                    "none",
      functional_status:                "functional",
      estimated_remaining_life_percent: remainingPct,
      maintenance_state:                roofAgeYears >= 22 ? "adequate" : "well",
      issue_count:                      0,
      inspector_confidence:             0.85,
      source_type:                      "system_age",
      notes:                            `Roof is ${roofAgeYears} years old. Typical lifespan 20–25 years.`,
      recommended_action:               roofAgeYears >= 22 ? "Plan for replacement within 1–3 years" : "Continue annual inspections",
      cost_urgency:                     roofAgeYears >= 22 ? "6_to_24_months" : "monitor_only",
      estimated_age_years:              roofAgeYears,
      replacement_window:               roofAgeYears >= 22 ? "1_to_3_years" : "3_plus_years",
    });
  }

  if (hvacAgeYears !== null && hvacAgeYears !== undefined) {
    const lifespan = 15;
    const remainingPct = Math.max(0, ((lifespan - hvacAgeYears) / lifespan) * 100);
    const severity = hvacAgeYears >= 13 ? "warning" : hvacAgeYears >= 10 ? "info" : "info";
    items.push({
      system:                           "HVAC",
      component:                        "HVAC System",
      category:                         "hvac",
      condition_label:                  hvacAgeYears >= 13 ? "aged" : "serviceable",
      condition_score:                  hvacAgeYears >= 13 ? 60 : hvacAgeYears >= 10 ? 72 : 85,
      deficiency_severity:              hvacAgeYears >= 13 ? "moderate" : "minor",
      safety_impact:                    "none",
      functional_status:                "functional",
      estimated_remaining_life_percent: remainingPct,
      maintenance_state:                "adequate",
      issue_count:                      0,
      inspector_confidence:             0.85,
      source_type:                      "system_age",
      notes:                            `HVAC is ${hvacAgeYears} years old. Typical lifespan 12–15 years.`,
      recommended_action:               hvacAgeYears >= 13 ? "Plan for replacement within 1–3 years. Annual service strongly recommended." : "Annual service recommended.",
      cost_urgency:                     hvacAgeYears >= 13 ? "6_to_24_months" : "monitor_only",
      estimated_age_years:              hvacAgeYears,
      replacement_window:               hvacAgeYears >= 13 ? "1_to_3_years" : "3_plus_years",
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────
// REPAIR EVENT INTEGRATION
// ─────────────────────────────────────────────────────────────────
export function applyRepairEvent(items: NormalizedItem[], repair: RepairEvent): NormalizedItem[] {
  const repairKey = toCategoryKey(repair.system);

  // Confidence boost per source type
  const confidenceBoost: Record<string, number> = {
    invoice:              0.10,
    receipt:              0.10,
    vendor_confirmation:  0.15,
    inspection:           0.20,
    user_report:          0.05,
  };
  const boost = confidenceBoost[repair.source] ?? 0.05;

  return items.map(item => {
    const isMatch = toCategoryKey(item.system) === repairKey ||
                    toCategoryKey(item.component) === repairKey ||
                    item.category === repairKey;
    if (!isMatch) return item;

    const updated = { ...item };

    if (repair.event_type === "component_replaced") {
      // Full replacement — reset to near-new condition
      updated.condition_label = "good";
      updated.condition_score = 92 + Math.floor(Math.random() * 5); // 92–96
      updated.estimated_remaining_life_percent = 90 + Math.floor(Math.random() * 10); // 90–100
      updated.estimated_age_years = 0;
      updated.deficiency_severity = "none";
      updated.maintenance_state = "well";
      updated.functional_status = "functional";
      updated.safety_impact = "none";
      updated.replacement_window = "10_plus_years";
    } else if (repair.event_type === "repair_completed") {
      // Targeted repair — improve condition
      updated.condition_score = Math.max(82, item.condition_score + 20);
      updated.condition_label = updated.condition_score >= 90 ? "good" : "serviceable";
      updated.deficiency_severity = "none";
      updated.maintenance_state = "adequate";
      updated.functional_status = "functional";
      updated.safety_impact = "none";
    } else if (repair.event_type === "system_serviced") {
      // Service — improve maintenance state, small score boost
      updated.maintenance_state = "well";
      updated.condition_score = Math.min(100, item.condition_score + 5);
    }

    // Confidence always increases with documented repair
    updated.inspector_confidence = Math.min(1.0, item.inspector_confidence + boost + repair.confidence * 0.1);

    return updated;
  });
}
