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
  useNewScoring:             false,  // ← Phase 2: flip after regression suite passes
  logScoreSnapshots:         true,   // ← ON: audit trail is safe to enable now
  dualRunComparison:         false,  // ← Phase 2: enable after new pipeline exists
  enableDecay:               false,  // ← Phase 3: time-based decay
  enableConfidenceWeighting: false,  // ← Phase 3: confidence as score modifier
  enablePredictions:         false,  // ← Phase 4: failure window + cost range
  enableRecommendations:     false,  // ← Phase 4: action recommendation engine
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
