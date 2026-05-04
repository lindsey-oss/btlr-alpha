/**
 * BTLR Scoring Pipeline
 * Patent Pending — Proprietary
 *
 * Thin wrapper around the baseline scoring engine.
 * Adds: audit logging, regression detection, dual-run comparison, feature flags.
 * DOES NOT modify any scoring logic — same inputs, same outputs as calling
 * computeHomeHealthReport() directly.
 *
 * Usage (drop-in replacement):
 *   // Before:
 *   const report = computeHomeHealthReport(items);
 *
 *   // After (identical score, adds audit trail):
 *   const { report } = runScoringPipeline({ items, propertyId });
 */

import {
  computeHomeHealthReport,
  getWeightsForPropertyType,
  type NormalizedItem,
  type HomeHealthReport,
} from "./scoring-engine";

import { FLAGS, flagSnapshot } from "./feature-flags";

import {
  SCORING_ENGINE_VERSION,
  hashNormalizedInputs,
  generateSnapshotId,
  summarizeInput,
  extractDeductions,
  type ScoreSnapshot,
  type CategoryScoreAudit,
} from "./score-audit";

import {
  persistSnapshot,
  checkForRegression,
} from "./score-snapshot-store";

// ─────────────────────────────────────────────────────────────────
// PIPELINE INPUT
// ─────────────────────────────────────────────────────────────────
export interface PipelineInput {
  items: NormalizedItem[];
  propertyId: string | number;

  /** Property type for condo-aware weight redistribution.
   *  "condo" / "condominium" → roof excluded, 5-system weights.
   *  All other values (or null/undefined) → standard 6-system weights.
   */
  propertyType?: string | null;

  /** ISO date of the most recent inspection (YYYY-MM-DD or full timestamp).
   *  Used by Phase 3 decay module. Confidence always adjusted; score adjusted
   *  only when enableDecay flag is on.
   */
  inspectionDate?: string | null;

  /** Pass true when an inspection has been completed but ALL findings are now resolved.
   *  Prevents the score from collapsing to 0 when items[] is empty after all repairs done.
   *  When true and items is empty, all unpenalized categories score 100 (clean bill of health).
   */
  hasCompletedInspection?: boolean;

  /** Optional: resolved items for audit log enrichment */
  resolvedItems?: Array<{
    system: string;
    component: string;
    category: string;
    resolution_type: "repair_completed" | "component_replaced" | "system_serviced";
    confidence: number;
    source: "invoice" | "receipt" | "vendor_confirmation" | "user_report" | "inspection";
    date_resolved?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────
// PIPELINE OUTPUT
// ─────────────────────────────────────────────────────────────────
export interface PipelineOutput {
  /** The scoring report — IDENTICAL to calling computeHomeHealthReport(items) directly */
  report: HomeHealthReport;

  /** Full audit snapshot for this computation */
  snapshot: ScoreSnapshot;

  /** Any regression detected vs. the last snapshot for this property */
  regression: { detected: boolean; message: string; delta: number };
}

// ─────────────────────────────────────────────────────────────────
// MAIN PIPELINE FUNCTION
// ─────────────────────────────────────────────────────────────────
export function runScoringPipeline(input: PipelineInput): PipelineOutput {
  const { items, propertyId, propertyType = null, inspectionDate = null, resolvedItems = [], hasCompletedInspection = false } = input;

  // ── Step 1: Run baseline engine (property-type-aware, decay-aware) ───
  const report = computeHomeHealthReport(items, propertyType, inspectionDate, hasCompletedInspection);

  // ── Step 2: Build audit snapshot ─────────────────────────────
  const snapshot = buildSnapshot(items, report, propertyId, propertyType, inspectionDate, resolvedItems);

  // ── Step 3: Regression check ──────────────────────────────────
  const regression = checkForRegression(snapshot);
  if (regression.detected) {
    console.error("[scoring-pipeline] REGRESSION DETECTED:", regression.message);
    // In future: send alert to monitoring
  }

  // ── Step 4: Dual-run comparison ───────────────────────────────
  // (Placeholder — runs when useNewScoring is enabled in Phase 2)
  if (FLAGS.dualRunComparison && FLAGS.useNewScoring) {
    runDualComparison(report, items, snapshot);
  }

  // ── Step 5: Persist snapshot ──────────────────────────────────
  if (FLAGS.logScoreSnapshots) {
    persistSnapshot(snapshot);
  }

  // ── Step 6: Dev logging ───────────────────────────────────────
  if (process.env.NODE_ENV === "development") {
    logDev(snapshot, regression);
  }

  return { report, snapshot, regression };
}

// ─────────────────────────────────────────────────────────────────
// SNAPSHOT BUILDER
// ─────────────────────────────────────────────────────────────────
function buildSnapshot(
  items: NormalizedItem[],
  report: HomeHealthReport,
  propertyId: string | number,
  propertyType: string | null | undefined,
  inspectionDate: string | null | undefined,
  resolvedItems: PipelineInput["resolvedItems"] = [],
): ScoreSnapshot {
  const weights = getWeightsForPropertyType(propertyType);
  const deductions     = extractDeductions(items);
  const inputSummaries = items.map(summarizeInput);
  const inputHash      = hashNormalizedInputs(items);

  const sourceTypes = Array.from(
    new Set(items.map(i => i.source_type || "unknown"))
  ).sort();

  const verifiedSources = new Set(["inspection_report", "invoice", "receipt", "vendor_confirmation"]);
  const verifiedCount   = items.filter(i => verifiedSources.has(i.source_type)).length;
  const dataCompleteness = items.length > 0 ? parseFloat((verifiedCount / items.length).toFixed(2)) : 0;

  // Per-category audit rows
  const categoryAudits: CategoryScoreAudit[] = report.category_scores.map(cs => {
    const catItems = items.filter(i => i.category === cs.category);
    // Not Assessed → no items, no avg score (null/0 — never blend toward a baseline)
    const avgItemScore = catItems.length > 0
      ? catItems.reduce((s, i) => {
          const base = i.condition_score;
          const pen  = deductions
            .filter(d => d.category === i.category && d.item_description.startsWith((i.notes || i.system || "").slice(0, 40)))
            .reduce((s2, d) => s2 + d.points, 0);
          return s + Math.max(0, Math.min(100, base + pen));
        }, 0) / catItems.length
      : 0; // Not Assessed — no score to report
    const topDeductions = deductions
      .filter(d => d.category === cs.category && d.points < 0)
      .sort((a, b) => a.points - b.points)
      .slice(0, 3);

    return {
      category:                 cs.category,
      weight:                   weights[cs.category] ?? 0,   // property-type-aware
      raw_item_count:           catItems.length,
      avg_item_score:           Math.round(avgItemScore),
      confidence_blended_score: cs.score,
      final_score:              cs.score,
      confidence:               cs.confidence,
      limited_data:             cs.limited_data,
      top_deductions:           topDeductions,
    };
  });

  // Score narrative
  const topIssue = report.priority_actions[0]?.issue ?? "";
  const decayNote = report.decay
    ? ` Inspection: ${report.decay.label} (${report.decay.monthsElapsed}mo ago, confidence ×${report.decay.confidenceMultiplier.toFixed(2)}).`
    : "";
  const narrative = `Score ${report.home_health_score} (${report.score_band}). `
    + `${items.length} inputs from ${sourceTypes.join(", ")}. `
    + `Data completeness: ${Math.round(dataCompleteness * 100)}%.`
    + decayNote
    + (topIssue ? ` Top issue: ${topIssue}.` : " No major issues flagged.");

  return {
    snapshot_id:      generateSnapshotId(),
    property_id:      propertyId,
    computed_at:      new Date().toISOString(),
    engine_version:   SCORING_ENGINE_VERSION,
    flags_active:     flagSnapshot() as unknown as Record<string, boolean>,
    input_item_count: items.length,
    normalized_inputs: inputSummaries,
    data_completeness: dataCompleteness,
    source_types:     sourceTypes,
    input_hash:       inputHash,
    final_score:      report.home_health_score,
    score_band:       report.score_band,
    readiness_score:  report.readiness_score,
    safety_score:     report.safety_score,
    maintenance_score: report.maintenance_score,
    confidence_score: report.confidence_score,
    category_scores:  categoryAudits,
    deductions,
    resolved_items:   resolvedItems.map(r => ({ ...r, points_restored: 0 })),
    score_narrative:  narrative,
  };
}

// ─────────────────────────────────────────────────────────────────
// DUAL-RUN COMPARISON PLACEHOLDER
// Will diff old vs new engine when useNewScoring is enabled.
// ─────────────────────────────────────────────────────────────────
const DUAL_RUN_DIFF_THRESHOLD = 2;

function runDualComparison(
  legacyReport: HomeHealthReport,
  items: NormalizedItem[],
  snapshot: ScoreSnapshot,
): void {
  // TODO (Phase 2): import and call new engine here
  // const newReport = computeNewScoringEngine(items);
  // const delta = Math.abs(legacyReport.home_health_score - newReport.home_health_score);
  // snapshot.legacy_score = legacyReport.home_health_score;
  // snapshot.score_delta  = delta;
  // snapshot.regression_flag = delta > DUAL_RUN_DIFF_THRESHOLD;
  // if (FLAGS.verboseDiffLogging && delta > 0) {
  //   console.log("[dual-run] score diff:", delta, { legacy: legacyReport, new: newReport });
  // }

  console.log("[dual-run] Placeholder: new engine not yet implemented. Legacy score:", legacyReport.home_health_score);
  void items; void snapshot; void DUAL_RUN_DIFF_THRESHOLD;
}

// ─────────────────────────────────────────────────────────────────
// DEV LOGGING
// ─────────────────────────────────────────────────────────────────
function logDev(snapshot: ScoreSnapshot, regression: { detected: boolean; message: string }): void {
  const topDeductions = snapshot.deductions
    .filter(d => d.points < 0)
    .sort((a, b) => a.points - b.points)
    .slice(0, 5);

  console.groupCollapsed(
    `[scoring-pipeline] Score: ${snapshot.final_score} (${snapshot.score_band}) · ${snapshot.input_item_count} inputs · hash: ${snapshot.input_hash}`
  );
  console.log("Snapshot ID:", snapshot.snapshot_id);
  console.log("Engine version:", snapshot.engine_version);
  console.log("Sources:", snapshot.source_types.join(", "));
  console.log("Data completeness:", Math.round(snapshot.data_completeness * 100) + "%");
  if (topDeductions.length) {
    console.log("Top deductions:", topDeductions.map(d => `${d.points} pts — ${d.reason}`).join("\n"));
  }
  if (regression.detected) {
    console.error("REGRESSION:", regression.message);
  } else {
    console.log("Regression check:", regression.message);
  }
  console.groupEnd();
}
