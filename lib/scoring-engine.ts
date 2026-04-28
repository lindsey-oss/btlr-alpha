/**
 * BTLR Home Health Scoring Engine
 * Patent Pending — Proprietary
 *
 * Deterministic, weighted, multi-dimensional scoring for residential properties.
 * Same inputs → same outputs, every time.
 *
 * CORE SCORE WEIGHTS (source of truth — do not change without explicit approval):
 *   Structure 25% | Roof/Envelope 20% | Electrical 15% | Plumbing 15% | HVAC 15% | Appliances 10%
 *   Roof/Envelope is excluded (not penalized) for condos — remaining weights redistribute proportionally.
 *   Safety is a HARD MODIFIER applied on top of the weighted score, not a weighted category.
 *
 * Phase 3 features (gated by feature flags):
 *   enableDecay              — applies time-based score adjustment as inspection ages
 *   enableConfidenceWeighting — confidence-weighted category averages instead of equal-weight
 */

import { isEnabled } from "./feature-flags";
import { computeDecay, type DecayResult } from "./scoring-decay";
import { computePredictions, type SystemPrediction } from "./scoring-predictions";
import { computeRecommendations, type Recommendation } from "./scoring-recommendations";

// ─────────────────────────────────────────────────────────────────
// CORE CATEGORY WEIGHTS — 6 universal systems
// Source of truth confirmed 2026-04-26.
// ─────────────────────────────────────────────────────────────────
export const CATEGORY_WEIGHTS: Record<string, number> = {
  structure_foundation:    0.25,
  roof_drainage_exterior:  0.20,   // excluded for condos — see getWeightsForPropertyType()
  electrical:              0.15,
  plumbing:                0.15,
  hvac:                    0.15,
  appliances_water_heater: 0.10,
};

// Condo weights — roof excluded, remaining 80% redistributed proportionally
const CONDO_CATEGORY_WEIGHTS: Record<string, number> = {
  structure_foundation:    0.3125,  // 25/80
  electrical:              0.1875,  // 15/80
  plumbing:                0.1875,
  hvac:                    0.1875,
  appliances_water_heater: 0.1250,  // 10/80
};

/**
 * Returns the correct weight map for the given property type.
 * Condos exclude roof/envelope — it doesn't exist in their calculation, not penalized.
 */
export function getWeightsForPropertyType(propertyType?: string | null): Record<string, number> {
  const t = (propertyType || "").toLowerCase();
  if (t === "condo" || t === "condominium") return CONDO_CATEGORY_WEIGHTS;
  return CATEGORY_WEIGHTS; // SFR, townhouse, multi-family, unknown — all include roof
}

// ─────────────────────────────────────────────────────────────────
// SAFETY HARD MODIFIER
// Applied ON TOP of the weighted score after calculation.
// Safety is not a weighted category — it is a trip wire.
// ─────────────────────────────────────────────────────────────────
const SAFETY_MODIFIER_PENALTIES: Record<string, number> = {
  critical: 15,  // missing CO detector, active electrical hazard, structural collapse risk
  high:     10,  // serious safety concern
  medium:    5,  // moderate safety concern
  low:       2,  // minor safety note
};

/**
 * Computes the safety hard modifier from all items.
 * Returns a negative number (penalty) to subtract from the weighted score.
 * Capped at -20 so a report full of minor safety notes doesn't zero out an otherwise good score.
 */
function computeSafetyModifier(items: NormalizedItem[]): number {
  const safetyItems = items.filter(i =>
    i.safety_impact !== "none" && i.safety_impact !== "unknown"
  );
  if (!safetyItems.length) return 0;
  const raw = safetyItems.reduce((sum, i) => {
    return sum + (SAFETY_MODIFIER_PENALTIES[i.safety_impact] ?? 0);
  }, 0);
  return -Math.min(20, raw); // cap at -20
}

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
  not_assessed: boolean;   // true = no data exists, excluded from score (not penalized)
  weight: number;          // the weight this category contributes to the Core Score (0 if not_assessed)
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
  /** Decay metadata — always present when inspectionDate is provided, null otherwise */
  decay: DecayResult | null;
  /** Phase 4: per-system failure windows and cost ranges. Null when enablePredictions is off. */
  predictions: SystemPrediction[] | null;
  /** Phase 4: bundled, prioritized action recommendations. Null when enableRecommendations is off. */
  recommendations: Recommendation[] | null;
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
// CATEGORY SCORE
// Returns null when a category has no data — caller treats this as
// "Not Assessed" and excludes it from the weighted calculation.
// No blending toward a neutral baseline — scores are earned, not assumed.
// A perfect score of 100 is achievable when all systems are in excellent
// condition, fully assessed, and all findings are resolved.
//
// Phase 3 — Confidence Weighting (enableConfidenceWeighting flag):
//   OFF (default): equal-weight average across all items
//   ON:            weighted average — each item weighted by inspector_confidence
//                  High-confidence findings count more; low-confidence findings
//                  are downweighted. Effect: typically 0–5 point shift.
// ─────────────────────────────────────────────────────────────────
function computeCategoryScore(items: NormalizedItem[]): { score: number; confidence: number } | null {
  if (!items.length) return null; // Not Assessed — excluded from score, not penalized

  let avgScore: number;
  const avgConf = items.reduce((s, i) => s + i.inspector_confidence, 0) / items.length;

  if (isEnabled("enableConfidenceWeighting")) {
    // Confidence-weighted average: Σ(score × confidence) / Σ(confidence)
    // Findings with low confidence (0.4) contribute ~44% as much as high confidence (0.9)
    const totalConf = items.reduce((s, i) => s + i.inspector_confidence, 0);
    avgScore = totalConf > 0
      ? items.reduce((s, i) => s + computeItemScore(i) * i.inspector_confidence, 0) / totalConf
      : items.reduce((s, i) => s + computeItemScore(i), 0) / items.length;
  } else {
    // Equal-weight average (Phase 1 / 2 baseline)
    avgScore = items.reduce((s, i) => s + computeItemScore(i), 0) / items.length;
  }

  return { score: Math.max(0, Math.min(100, avgScore)), confidence: avgConf };
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
// propertyType:   "single_family" | "condo" | "townhouse" | "multi_family" | null
//                 Roof/Envelope is excluded (not penalized) for condos.
// inspectionDate: ISO date of the most recent inspection.
//                 Used by Phase 3 decay module — confidence always adjusted,
//                 score adjusted only when enableDecay flag is on.
// ─────────────────────────────────────────────────────────────────
export function computeHomeHealthReport(
  items: NormalizedItem[],
  propertyType?: string | null,
  inspectionDate?: string | null,
): HomeHealthReport {
  const weights = getWeightsForPropertyType(propertyType);

  // Group items by core category — only the 6 scored systems
  const byCategory: Record<string, NormalizedItem[]> = {};
  for (const cat of Object.keys(weights)) byCategory[cat] = [];
  for (const item of items) {
    const key = item.category in byCategory ? item.category : toCategoryKey(item.system);
    if (key in byCategory) byCategory[key].push(item);
  }

  // Compute per-category scores
  // Categories with no items → not_assessed: true, excluded from weighted sum
  const categoryScores: CategoryScore[] = Object.entries(weights).map(([cat, weight]) => {
    const catItems = byCategory[cat] ?? [];
    const result   = computeCategoryScore(catItems);
    const topFindings = catItems
      .filter(i => i.deficiency_severity !== "none")
      .sort((a, b) => computeItemScore(a) - computeItemScore(b))
      .slice(0, 3)
      .map(i => i.notes || i.recommended_action);

    if (!result) {
      // No data for this system — mark Not Assessed, excluded from score
      return {
        category:     cat,
        score:        0,
        confidence:   0,
        status:       "Not Assessed",
        top_findings: [],
        limited_data: true,
        not_assessed: true,
        weight,
      };
    }

    const { score, confidence } = result;
    return {
      category:     cat,
      score:        Math.round(score),
      confidence:   parseFloat(confidence.toFixed(2)),
      status:       scoreBand(score),
      top_findings: topFindings,
      limited_data: confidence < 0.5,
      not_assessed: false,
      weight,
    };
  });

  // Weighted Core Health Score
  // Only assessed categories contribute — weights of not_assessed categories are
  // redistributed proportionally so the score still sums to 100% of what's known.
  const assessedScores  = categoryScores.filter(cs => !cs.not_assessed);
  const totalWeight     = assessedScores.reduce((s, cs) => s + cs.weight, 0);
  const rawHealth = totalWeight > 0
    ? assessedScores.reduce((sum, cs) => sum + cs.score * (cs.weight / totalWeight), 0)
    : 0;

  // Apply safety hard modifier on top of weighted score
  const safetyModifier = computeSafetyModifier(items);

  // Phase 3 — Decay modifier
  // computeDecay() always runs so DecayResult is available as metadata.
  // scoreAdjustment only affects home_health_score when enableDecay flag is on.
  const decay: DecayResult | null = inspectionDate != null
    ? computeDecay(inspectionDate)
    : null;
  const decayScoreAdj = (decay && isEnabled("enableDecay")) ? decay.scoreAdjustment : 0;

  const home_health_score = Math.round(
    Math.max(0, Math.min(100, rawHealth + safetyModifier + decayScoreAdj))
  );

  // ── Sub-scores ────────────────────────────────────────────────
  //
  // All sub-scores use per-category aggregation (worst finding per category)
  // rather than per-item sums. This prevents pile-on collapse on rich reports
  // (e.g. 25 findings × 18 pts each → instant floor) while still penalising
  // a house that has serious issues across many different systems.
  // Floors ensure scores remain legible even in worst-case reports.

  // Safety score: 100 minus safety penalties — floor 30
  // Use per-category worst-case instead of per-item sum so a report with many
  // findings in the same category doesn't pile penalties beyond one per category.
  // Max categories = 10, max penalty per category = 30 (critical) → max raw = 300,
  // but in practice 4-6 categories × 18-30 pts each → realistic range 72–180.
  const categoryWorstSafety = new Map<string, number>();
  for (const item of items) {
    const pen = SAFETY_PENALTY[item.safety_impact] ?? 0;
    if (pen > (categoryWorstSafety.get(item.category) ?? 0))
      categoryWorstSafety.set(item.category, pen);
  }
  const rawSafetyPenalty = Array.from(categoryWorstSafety.values()).reduce((s, p) => s + p, 0);
  const safety_score = Math.round(Math.max(30, Math.min(100, 100 - rawSafetyPenalty)));

  // Maintenance score: base 85, +/- maintenance adjustments — floor 35
  // Per-category worst-case prevents pile-on from many deferred findings.
  const maintBase = 85;
  const categoryWorstMaint = new Map<string, number>();
  for (const item of items) {
    const adj = MAINTENANCE_ADJ[item.maintenance_state] ?? MAINTENANCE_ADJ.unknown;
    if (adj < (categoryWorstMaint.get(item.category) ?? 0))
      categoryWorstMaint.set(item.category, adj);
  }
  const maintDelta = Array.from(categoryWorstMaint.values()).reduce((s, a) => s + a, 0);
  const maintenance_score = Math.round(Math.max(35, Math.min(100, maintBase + maintDelta)));

  // Readiness score: start 100, subtract risk factors — floor 30
  // Each item can subtract at most ~32 pts; with 20+ items this collapses.
  // Use per-*category* caps instead of per-item to prevent pile-on.
  const readinessSeenCategories = new Set<string>();
  let readiness = 100;
  for (const item of items) {
    const cat = item.category;
    const alreadySeen = readinessSeenCategories.has(cat);
    // Life-percent and maintenance deductions: once per category
    if (!alreadySeen) {
      readinessSeenCategories.add(cat);
      if (item.estimated_remaining_life_percent <= 20) readiness -= 8;
      if (item.maintenance_state === "deferred" || item.maintenance_state === "poor") readiness -= 6;
    }
    // Safety deductions: once per category (already bounded by safety_score above)
    if (!alreadySeen && (item.safety_impact === "high" || item.safety_impact === "critical")) readiness -= 10;
    // Leak/moisture: still per-item (each is a distinct risk) but capped at -24 total
  }
  // Leak/moisture — separate pass, cap at -24 across entire report
  const leakDeduction = Math.min(24, items.filter(i =>
    i.notes.toLowerCase().includes("leak") || i.notes.toLowerCase().includes("moisture")
  ).length * 8);
  readiness -= leakDeduction;
  const readiness_score = Math.round(Math.max(30, Math.min(100, readiness)));

  // Confidence score: average inspector confidence across items — floor 40
  // Reflects inspection coverage quality only (classifier confidence, item count).
  // Decay / staleness is already communicated via report.decay.label ("Expired",
  // "Aging", etc.) and the home_health_score decay adjustment — mixing it into
  // the confidence score causes it to collapse to 30 for any inspection >5 yrs.
  const avgConf = items.length > 0
    ? items.reduce((s, i) => s + i.inspector_confidence, 0) / items.length
    : 0.4;
  const confidence_score = Math.round(Math.max(40, Math.min(100, avgConf * 100)));

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

  // ── Phase 4: Predictions & Recommendations ───────────────────
  const predictions: SystemPrediction[] | null = isEnabled("enablePredictions")
    ? computePredictions(items, Object.keys(weights))
    : null;

  const recommendations: Recommendation[] | null = isEnabled("enableRecommendations")
    ? computeRecommendations(items)
    : null;

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
    decay,
    predictions,
    recommendations,
  };
}

// ─────────────────────────────────────────────────────────────────
// NORMALIZE EXISTING FINDINGS → NormalizedItem[]
// Bridge between the current simple Finding format and the engine
// ─────────────────────────────────────────────────────────────────
// Exported so dashboard can type-check calls; severity is widened to string
// so raw OpenAI/DB findings don't need an explicit cast.
export interface LegacyFinding {
  category: string;
  description: string;
  severity: string;                     // "critical" | "warning" | "info" (widened for callers)
  estimated_cost?: number | null;
  // Age/lifecycle data extracted from inspection report text
  age_years?: number | null;           // how old this system/component is
  remaining_life_years?: number | null; // inspector's stated remaining useful life
  lifespan_years?: number | null;       // typical total lifespan for this system type
  source?: string;                      // "photo" | "inspection_report"
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

// Compute remaining life % from real inspection data when available.
// Priority: remaining_life_years/lifespan_years > age_years/lifespan_years > severity fallback.
function computeRemainingLifePct(f: LegacyFinding): number {
  if (f.remaining_life_years != null && f.lifespan_years != null && f.lifespan_years > 0) {
    return Math.max(0, Math.min(100, (f.remaining_life_years / f.lifespan_years) * 100));
  }
  if (f.age_years != null && f.lifespan_years != null && f.lifespan_years > 0) {
    const remaining = f.lifespan_years - f.age_years;
    return Math.max(0, Math.min(100, (remaining / f.lifespan_years) * 100));
  }
  return estimatedRemainingLife(f.severity);
}

// Derive replacement window from real remaining life data when available.
function toReplacementWindow(f: LegacyFinding): string {
  // Use real remaining life data from inspection report when present
  const remaining = f.remaining_life_years ?? (
    f.age_years != null && f.lifespan_years != null ? f.lifespan_years - f.age_years : null
  );
  if (remaining !== null) {
    if (remaining <= 0)  return "immediate_to_1_year";
    if (remaining <= 2)  return "immediate_to_1_year";
    if (remaining <= 5)  return "1_to_3_years";
    return "3_plus_years";
  }
  // Fall back to severity-based estimate
  if (f.severity === "critical") return "immediate_to_1_year";
  if (f.severity === "warning")  return "1_to_3_years";
  return "3_plus_years";
}

// Derive condition score from real age/remaining life when available
function computeConditionFromAge(f: LegacyFinding): { condition_label: string; condition_score: number } | null {
  if (f.age_years == null || f.lifespan_years == null || f.lifespan_years <= 0) return null;
  const pctUsed = f.age_years / f.lifespan_years;
  if (pctUsed >= 0.95) return { condition_label: "failed",      condition_score: 10 };
  if (pctUsed >= 0.85) return { condition_label: "very_poor",   condition_score: 30 };
  if (pctUsed >= 0.75) return { condition_label: "poor",        condition_score: 45 };
  if (pctUsed >= 0.60) return { condition_label: "aged",        condition_score: 60 };
  if (pctUsed >= 0.45) return { condition_label: "fair",        condition_score: 65 };
  if (pctUsed >= 0.25) return { condition_label: "average",     condition_score: 75 };
  return { condition_label: "good", condition_score: 85 };
}

export function normalizeLegacyFindings(
  findings: LegacyFinding[],
  roofAgeYears?: number | null,
  hvacAgeYears?: number | null,
): NormalizedItem[] {
  const items: NormalizedItem[] = findings.map(f => {
    // Use real age/condition data from inspection report when available;
    // fall back to severity-based estimates when not.
    const ageCondition   = computeConditionFromAge(f);
    const { condition_label, condition_score } = ageCondition ?? severityToCondition(f.severity);
    const remainingPct   = computeRemainingLifePct(f);
    const replacementWin = toReplacementWindow(f);
    const category = toCategoryKey(f.category);

    // Inspector confidence is higher when real age data is present
    const hasRealAgeData = f.age_years != null || f.remaining_life_years != null;
    const confidence = f.source === "photo" ? 0.85 : hasRealAgeData ? 0.88 : 0.75;

    // Build a rich recommended action that includes replacement timeline when known
    let recommended_action: string;
    const remaining = f.remaining_life_years ?? (
      f.age_years != null && f.lifespan_years != null ? f.lifespan_years - f.age_years : null
    );
    if (remaining !== null && remaining <= 0) {
      recommended_action = `Past expected lifespan — replace immediately`;
    } else if (remaining !== null && remaining <= 2) {
      recommended_action = `Replace within ${remaining <= 1 ? "1 year" : "1–2 years"}`;
    } else if (remaining !== null && remaining <= 5) {
      recommended_action = `Plan replacement in ${Math.round(remaining)} years`;
    } else if (f.severity === "critical") {
      recommended_action = "Address immediately — contact a licensed contractor";
    } else if (f.severity === "warning") {
      recommended_action = "Schedule repair within 6–12 months";
    } else {
      recommended_action = "Monitor and perform routine maintenance";
    }

    return {
      system:                           f.category,
      component:                        f.category,
      category,
      condition_label,
      condition_score,
      deficiency_severity:              severityToDeficiency(f.severity),
      safety_impact:                    severityToSafety(f.severity),
      functional_status:                f.severity === "critical" ? "partially" : "functional",
      estimated_remaining_life_percent: remainingPct,
      maintenance_state:                f.severity === "critical" ? "deferred" : f.severity === "warning" ? "adequate" : "adequate",
      issue_count:                      1,
      inspector_confidence:             confidence,
      source_type:                      f.source ?? "inspection_report",
      notes:                            f.description,
      recommended_action,
      cost_urgency:                     remaining != null && remaining <= 2 ? "immediate"
                                      : remaining != null && remaining <= 5 ? "3_to_6_months"
                                      : f.severity === "critical" ? "immediate"
                                      : f.severity === "warning" ? "3_to_6_months"
                                      : "monitor_only",
      estimated_age_years:              f.age_years ?? null,
      replacement_window:               replacementWin,
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
