/**
 * BTLR Feature Flag System
 * Patent Pending — Proprietary
 *
 * Central switch board for progressive rollout of new scoring modules.
 * All flags default to false — the existing baseline engine runs unchanged
 * until explicitly enabled.
 *
 * Usage:
 *   import { FLAGS, isEnabled } from "./feature-flags";
 *   if (isEnabled("logScoreSnapshots")) { ... }
 */

export interface FeatureFlagConfig {
  /**
   * Primary safety flag — when true, runs the NEW modular scoring pipeline.
   * When false (default), uses the existing baseline engine unchanged.
   * Only flip this after the regression suite passes.
   */
  useNewScoring: boolean;

  /**
   * Log every score computation to the audit store.
   * Safe to enable immediately — purely additive, no score changes.
   */
  logScoreSnapshots: boolean;

  /**
   * Enable dual-run mode: run BOTH old and new scoring, log any differences.
   * Requires useNewScoring = true to be meaningful, but harmless if false.
   */
  dualRunComparison: boolean;

  /**
   * Apply time-based decay to scores. DISABLED until decay module is validated.
   * When false, the decay module computes but does NOT modify final score.
   */
  enableDecay: boolean;

  /**
   * Apply confidence weighting as a score modifier.
   * When false, confidence is attached as metadata only (current behavior).
   */
  enableConfidenceWeighting: boolean;

  /**
   * Run the prediction module (failure window, cost range, urgency).
   * When false, predictions are computed but not surfaced in scoring output.
   */
  enablePredictions: boolean;

  /**
   * Generate action recommendations from findings.
   * When false, recommendations are computed but not attached to the score report.
   */
  enableRecommendations: boolean;

  /**
   * Apply the Extended Condition (Tier 2) modifier on top of the Core Score.
   * When true: computes a ±8 modifier from supplemental items (deck, pool,
   * garage, fireplace, driveway, landscape, cosmetic finishes) and shows a
   * separate Excellent / Good / Fair / Poor condition label in the UI.
   * When false: modifier is always 0, no condition label is shown.
   */
  enableExtendedCondition: boolean;

  /**
   * Emit diff logs to console when dualRunComparison is active.
   */
  verboseDiffLogging: boolean;
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE FLAGS
// ─────────────────────────────────────────────────────────────────
// To change a flag: edit this object ONLY. Never scatter flag checks
// through business logic — always call isEnabled() or read FLAGS.
export const FLAGS: Readonly<FeatureFlagConfig> = {
  useNewScoring:             true,   // ← Phase 2: ✓ 6-system weighted engine active
  logScoreSnapshots:         true,   // ← ON: audit trail active
  dualRunComparison:         false,  // ← Phase 2: N/A — engine rebuilt in-place
  enableDecay:               true,   // ← Phase 3: ✓ time-based decay active
  enableConfidenceWeighting: true,   // ← Phase 3: ✓ confidence-weighted category averages active
  enablePredictions:         true,   // ← Phase 4: ✓ failure window + cost range active
  enableRecommendations:     true,   // ← Phase 4: ✓ action recommendation engine active
  enableExtendedCondition:   true,   // ← Phase 5: ✓ Tier 2 extended condition modifier active
  verboseDiffLogging:        false,
} as const;

/** Type-safe flag check. Prefer over direct FLAGS access at call sites. */
export function isEnabled(flag: keyof FeatureFlagConfig): boolean {
  return FLAGS[flag] === true;
}

/** Returns a frozen snapshot of all current flags — useful for embedding in score logs. */
export function flagSnapshot(): Readonly<FeatureFlagConfig> {
  return { ...FLAGS };
}
