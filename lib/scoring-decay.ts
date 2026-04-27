/**
 * BTLR Inspection Age Decay Module
 * Patent Pending — Proprietary
 *
 * As time passes since the last inspection, data becomes stale.
 * This module computes two outputs:
 *
 *   scoreAdjustment     — negative modifier applied to home_health_score
 *                         Reflects that an aging report may understate problems
 *                         that have developed since the inspection.
 *
 *   confidenceMultiplier — 0.3–1.0 multiplier applied to confidence_score
 *                          Communicates to the user how fresh/reliable the data is.
 *
 * When enableDecay flag is OFF:
 *   - scoreAdjustment is always 0 (score is not affected)
 *   - confidenceMultiplier still applies (confidence metadata is always accurate)
 *
 * When enableDecay flag is ON:
 *   - scoreAdjustment is applied to home_health_score
 *
 * Decay curve:
 *   0–6 months     Fresh    — no adjustment, full confidence
 *   6–12 months    Current  — -1 pt, 0.90 confidence
 *   12–18 months   Aging    — -2 pts, 0.80 confidence
 *   18–24 months   Aging    — -4 pts, 0.70 confidence
 *   24–36 months   Stale    — -6 pts, 0.60 confidence
 *   36–48 months   Stale    — -8 pts, 0.50 confidence
 *   48+ months     Expired  — -10 pts, 0.40 confidence
 *
 * The confidence floor is 0.40 (not 0). A 5-year-old report still tells us
 * something — it's just significantly less reliable than a fresh one.
 */

export interface DecayResult {
  /** Months elapsed since inspection date (0 if unknown) */
  monthsElapsed: number;

  /** Applied to home_health_score when enableDecay flag is on. Always ≤ 0. */
  scoreAdjustment: number;

  /** Multiplied against confidence_score. Range: 0.40–1.00. Always applied. */
  confidenceMultiplier: number;

  /** Human-readable freshness label */
  label: "Fresh" | "Current" | "Aging" | "Stale" | "Expired";

  /** User-facing explanation of the decay state */
  description: string;
}

/** Returned when no inspection date is available — treat as unknown freshness */
const UNKNOWN_DECAY: DecayResult = {
  monthsElapsed:        0,
  scoreAdjustment:      0,
  confidenceMultiplier: 0.80,  // slight confidence discount for missing date
  label:                "Current",
  description:          "Inspection date unknown — score confidence reduced slightly.",
};

/**
 * Computes the decay result for a given inspection date.
 * Safe to call with null/undefined — returns UNKNOWN_DECAY.
 *
 * @param inspectionDate  ISO date string (YYYY-MM-DD or full ISO timestamp)
 * @param now             Override current date (for testing). Defaults to Date.now().
 */
export function computeDecay(
  inspectionDate: string | null | undefined,
  now: Date = new Date(),
): DecayResult {
  if (!inspectionDate) return UNKNOWN_DECAY;

  const inspected = new Date(inspectionDate);
  if (isNaN(inspected.getTime())) return UNKNOWN_DECAY;

  const msElapsed = now.getTime() - inspected.getTime();
  if (msElapsed < 0) return UNKNOWN_DECAY; // future date — treat as fresh

  const monthsElapsed = msElapsed / (1000 * 60 * 60 * 24 * 30.44);

  if (monthsElapsed < 12) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      0,
      confidenceMultiplier: 1.00,
      label:                "Fresh",
      description:          "Inspection is under 1 year old — full score confidence.",
    };
  }
  if (monthsElapsed < 18) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      -1,
      confidenceMultiplier: 0.90,
      label:                "Current",
      description:          "Inspection is over 1 year old — slight confidence reduction.",
    };
  }
  if (monthsElapsed < 24) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      -2,
      confidenceMultiplier: 0.80,
      label:                "Aging",
      description:          "Inspection is approaching 2 years old. Consider a re-inspection for key systems.",
    };
  }
  if (monthsElapsed < 36) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      -4,
      confidenceMultiplier: 0.70,
      label:                "Aging",
      description:          "Inspection is over 2 years old. Score confidence reduced.",
    };
  }
  if (monthsElapsed < 48) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      -6,
      confidenceMultiplier: 0.60,
      label:                "Stale",
      description:          "Inspection is over 3 years old. A fresh inspection is recommended.",
    };
  }
  if (monthsElapsed < 60) {
    return {
      monthsElapsed:        Math.round(monthsElapsed),
      scoreAdjustment:      -8,
      confidenceMultiplier: 0.50,
      label:                "Stale",
      description:          "Inspection is over 4 years old. Score reliability is significantly reduced.",
    };
  }
  return {
    monthsElapsed:        Math.round(monthsElapsed),
    scoreAdjustment:      -10,
    confidenceMultiplier: 0.40,
    label:                "Expired",
    description:          "Inspection is over 5 years old. A new inspection is strongly recommended.",
  };
}
