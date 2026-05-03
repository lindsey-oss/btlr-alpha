/**
 * BTLR Score Audit Log
 * Patent Pending — Proprietary
 *
 * Structured types for full score transparency and reconstruction.
 * Every score snapshot contains enough information to:
 *   1. Reproduce the exact score from raw inputs
 *   2. Explain every deduction and credit
 *   3. Track changes over time
 *   4. Detect regressions if scoring logic changes
 */

import type { NormalizedItem, HomeHealthReport, CategoryScore } from "./scoring-engine";

// ─────────────────────────────────────────────────────────────────
// ENGINE VERSION — bump this any time scoring logic changes
// ─────────────────────────────────────────────────────────────────
export const SCORING_ENGINE_VERSION = "4.0.0"; // Phase 4: predictions engine + recommendations engine

// ─────────────────────────────────────────────────────────────────
// DEDUCTION RECORD
// One entry per scoring penalty applied to the final score
// ─────────────────────────────────────────────────────────────────
export interface ScoreDeduction {
  /** Which master category this deduction affects */
  category: string;

  /** Human-readable description of the item being penalized */
  item_description: string;

  /** What type of penalty this is */
  deduction_type:
    | "severity_penalty"       // from deficiency_severity field
    | "safety_penalty"         // from safety_impact field
    | "functional_adjustment"  // from functional_status field
    | "maintenance_adjustment" // from maintenance_state field
    | "life_remaining_penalty" // from estimated_remaining_life_percent
    | "system_age_penalty"     // synthetic items added by normalizeLegacyFindings
    | "confidence_blend";      // from confidence blending toward CONFIDENCE_NEUTRAL

  /** Negative value = deduction, positive = credit */
  points: number;

  /** Human-readable reason */
  reason: string;

  /** Source of the data driving this deduction */
  source: "inspection_report" | "system_age" | "user_input" | "repair_record" | "photo" | "unknown";

  /** Confidence of the input that generated this deduction (0–1) */
  confidence: number;

  /** The raw field values that produced this deduction */
  raw_inputs: Record<string, string | number | null>;
}

// ─────────────────────────────────────────────────────────────────
// RESOLVED ITEM RECORD
// Items that were credited (repairs, replacements, services)
// ─────────────────────────────────────────────────────────────────
export interface ResolvedItem {
  system: string | null;
  component: string | null;
  category: string;
  resolution_type: "repair_completed" | "component_replaced" | "system_serviced";
  confidence: number;
  source: "invoice" | "receipt" | "vendor_confirmation" | "user_report" | "inspection";
  points_restored: number;
  date_resolved?: string;
}

// ─────────────────────────────────────────────────────────────────
// CATEGORY SCORE AUDIT
// Per-category breakdown with full traceability
// ─────────────────────────────────────────────────────────────────
export interface CategoryScoreAudit {
  category: string;
  weight: number;               // from CATEGORY_WEIGHTS
  raw_item_count: number;
  avg_item_score: number;       // before confidence blending
  confidence_blended_score: number;
  final_score: number;          // rounded
  confidence: number;           // 0–1
  limited_data: boolean;
  top_deductions: ScoreDeduction[];
}

// ─────────────────────────────────────────────────────────────────
// NORMALIZED INPUT SUMMARY
// Compact representation of each input item for reconstruction
// ─────────────────────────────────────────────────────────────────
export interface NormalizedInputSummary {
  system: string | null;
  component: string | null;
  category: string;
  condition_score: number;
  deficiency_severity: string;
  safety_impact: string;
  functional_status: string;
  maintenance_state: string;
  estimated_remaining_life_percent: number;
  inspector_confidence: number;
  source_type: string;
  notes_truncated: string;  // first 120 chars only to keep logs compact
  estimated_age_years: number | null;
}

// ─────────────────────────────────────────────────────────────────
// SCORE SNAPSHOT
// Full audit record for a single score calculation
// ─────────────────────────────────────────────────────────────────
export interface ScoreSnapshot {
  /** Unique ID for this snapshot */
  snapshot_id: string;

  /** Property this score belongs to */
  property_id: string | number;

  /** ISO timestamp of when this score was computed */
  computed_at: string;

  /** Version of the scoring engine that produced this */
  engine_version: string;

  /** Which feature flags were active when this was computed */
  flags_active: Record<string, boolean>;

  // ── INPUTS ──────────────────────────────────────────────────
  /** Total number of normalized items fed into the engine */
  input_item_count: number;

  /** Compact summary of each normalized input — enough to reconstruct score */
  normalized_inputs: NormalizedInputSummary[];

  /** 0–1 fraction of inputs that came from verified sources (inspection, invoice) */
  data_completeness: number;

  /** Sorted list of all source types present (e.g. ["inspection_report","system_age"]) */
  source_types: string[];

  /** Hash of normalized inputs for determinism verification */
  input_hash: string;

  // ── OUTPUTS ─────────────────────────────────────────────────
  /** Final computed home health score */
  final_score: number;

  /** Verbal band: "Excellent" | "Good" | "Fair" | "Needs Attention" | "High Risk" */
  score_band: string;

  readiness_score: number;
  safety_score: number;
  maintenance_score: number;
  confidence_score: number;

  /** Per-category breakdown with full traceability */
  category_scores: CategoryScoreAudit[];

  // ── TRACEABILITY ─────────────────────────────────────────────
  /** All deductions applied, with reason and source */
  deductions: ScoreDeduction[];

  /** All items where a repair/service was credited */
  resolved_items: ResolvedItem[];

  /** Human-readable summary of what drove the score */
  score_narrative: string;

  // ── DIFF TRACKING (populated during dual-run) ────────────────
  /** Score from legacy engine — null unless dualRunComparison flag is on */
  legacy_score?: number;

  /** Difference between legacy and new score — null unless dual-run active */
  score_delta?: number;

  /** True if delta exceeds the regression threshold */
  regression_flag?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// DETERMINISM HASH
// Produces a stable string hash of the normalized inputs so we can
// verify: same hash → same inputs → must produce same score.
// Uses a simple djb2-style hash — deterministic, no external deps.
// ─────────────────────────────────────────────────────────────────
export function hashNormalizedInputs(items: NormalizedItem[]): string {
  // Serialize only the fields that affect scoring (excludes notes text)
  const canonical = items.map(i => [
    i.category,
    i.condition_score,
    i.deficiency_severity,
    i.safety_impact,
    i.functional_status,
    i.maintenance_state,
    Math.round(i.estimated_remaining_life_percent),
    Math.round(i.inspector_confidence * 100),
  ].join("|")).sort().join(";;");

  // djb2 hash
  let hash = 5381;
  for (let ci = 0; ci < canonical.length; ci++) {
    hash = ((hash << 5) + hash) ^ canonical.charCodeAt(ci);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

// ─────────────────────────────────────────────────────────────────
// SNAPSHOT ID GENERATOR
// ─────────────────────────────────────────────────────────────────
export function generateSnapshotId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `snap_${ts}_${rand}`;
}

// ─────────────────────────────────────────────────────────────────
// COMPACT SUMMARY BUILDER
// Converts a full NormalizedItem into a NormalizedInputSummary
// ─────────────────────────────────────────────────────────────────
export function summarizeInput(item: NormalizedItem): NormalizedInputSummary {
  return {
    system:                           item.system,
    component:                        item.component,
    category:                         item.category,
    condition_score:                  item.condition_score,
    deficiency_severity:              item.deficiency_severity,
    safety_impact:                    item.safety_impact,
    functional_status:                item.functional_status,
    maintenance_state:                item.maintenance_state,
    estimated_remaining_life_percent: Math.round(item.estimated_remaining_life_percent),
    inspector_confidence:             parseFloat(item.inspector_confidence.toFixed(2)),
    source_type:                      item.source_type,
    notes_truncated:                  (item.notes || "").slice(0, 120),
    estimated_age_years:              item.estimated_age_years,
  };
}

// ─────────────────────────────────────────────────────────────────
// DEDUCTION EXTRACTOR
// Reconstructs the deductions that the scoring engine applied
// without re-running the engine (for audit logging purposes)
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

export function extractDeductions(items: NormalizedItem[]): ScoreDeduction[] {
  const deductions: ScoreDeduction[] = [];

  for (const item of items) {
    const src = item.source_type as ScoreDeduction["source"] ?? "unknown";

    const defPts = -(DEFICIENCY_PENALTY[item.deficiency_severity] ?? 10);
    if (defPts < 0) {
      deductions.push({
        category: item.category,
        item_description: item.notes.slice(0, 80) || item.system || "",
        deduction_type: "severity_penalty",
        points: defPts,
        reason: `Deficiency severity "${item.deficiency_severity}" → ${Math.abs(defPts)} point penalty`,
        source: src,
        confidence: item.inspector_confidence,
        raw_inputs: { deficiency_severity: item.deficiency_severity },
      });
    }

    const safePts = -(SAFETY_PENALTY[item.safety_impact] ?? 0);
    if (safePts < 0) {
      deductions.push({
        category: item.category,
        item_description: item.notes.slice(0, 80) || item.system || "",
        deduction_type: "safety_penalty",
        points: safePts,
        reason: `Safety impact "${item.safety_impact}" → ${Math.abs(safePts)} point penalty`,
        source: src,
        confidence: item.inspector_confidence,
        raw_inputs: { safety_impact: item.safety_impact },
      });
    }

    const funcPts = FUNCTIONAL_ADJ[item.functional_status] ?? -3;
    if (funcPts < 0) {
      deductions.push({
        category: item.category,
        item_description: item.notes.slice(0, 80) || item.system || "",
        deduction_type: "functional_adjustment",
        points: funcPts,
        reason: `Functional status "${item.functional_status}" → ${Math.abs(funcPts)} point adjustment`,
        source: src,
        confidence: item.inspector_confidence,
        raw_inputs: { functional_status: item.functional_status },
      });
    }

    const maintPts = MAINTENANCE_ADJ[item.maintenance_state] ?? -2;
    if (maintPts !== 0) {
      deductions.push({
        category: item.category,
        item_description: item.notes.slice(0, 80) || item.system || "",
        deduction_type: "maintenance_adjustment",
        points: maintPts,
        reason: `Maintenance state "${item.maintenance_state}" → ${maintPts > 0 ? "+" : ""}${maintPts} point adjustment`,
        source: src,
        confidence: item.inspector_confidence,
        raw_inputs: { maintenance_state: item.maintenance_state },
      });
    }

    const lifePct = item.estimated_remaining_life_percent;
    let lifePts = 0;
    if      (lifePct >= 80) lifePts = 4;
    else if (lifePct >= 60) lifePts = 2;
    else if (lifePct >= 40) lifePts = 0;
    else if (lifePct >= 20) lifePts = -6;
    else if (lifePct >= 10) lifePts = -12;
    else                    lifePts = -18;

    if (lifePts !== 0) {
      deductions.push({
        category: item.category,
        item_description: item.notes.slice(0, 80) || item.system || "",
        deduction_type: item.source_type === "system_age" ? "system_age_penalty" : "life_remaining_penalty",
        points: lifePts,
        reason: `${Math.round(lifePct)}% remaining life → ${lifePts > 0 ? "+" : ""}${lifePts} point adjustment`,
        source: src,
        confidence: item.inspector_confidence,
        raw_inputs: {
          estimated_remaining_life_percent: Math.round(lifePct),
          estimated_age_years: item.estimated_age_years,
        },
      });
    }
  }

  return deductions;
}
