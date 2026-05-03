/**
 * BTLR Extended Condition Layer (Tier 2)
 * Patent Pending — Proprietary
 *
 * Captures the condition of supplemental features — deck, driveway, pool,
 * fireplace, garage, landscape, and cosmetic finishes. This is NOT the Core
 * Score. It is a modifier applied on top.
 *
 * Rules:
 *   - Modifier range: −8 to +8 applied on top of the Core Score
 *   - No Tier 2 items found → modifier = 0 (absence of amenities is NEVER penalized)
 *   - Displayed separately as a condition label: Excellent / Good / Fair / Poor
 *   - Not part of the 6-system Core Score calculation
 */

// ─────────────────────────────────────────────────────────────────
// TIER 2 KEYWORD LIST
// Identifies findings that belong to the Extended Condition layer.
// Checked against BOTH category string AND description.
// ─────────────────────────────────────────────────────────────────
export const TIER2_KEYWORDS: readonly string[] = [
  // Outdoor structures & surfaces
  "deck", "patio", "pergola", "porch",
  "driveway", "walkway", "sidewalk", "pavement", "pathway",
  "fence", "gate",
  // Water features / leisure amenities
  "pool", "spa", "hot tub", "jacuzzi", "whirlpool",
  // Interior combustion / heating amenities
  "fireplace", "chimney", "flue", "firebox", "hearth",
  // Vehicle storage
  "garage",
  // Site / landscape finishes
  "landscap", "garden", "lawn", "irrigation", "sprinkler",
  // Cosmetic interior finishes (distinct from structural walls/floors)
  "countertop", "cabinet",
  "carpet", "tile grout", "caulking",
];

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────
export interface ExtendedItem {
  category:    string;
  description: string;
  severity:    "critical" | "warning" | "info";
}

export type ExtendedConditionLabel = "Excellent" | "Good" | "Fair" | "Poor";

export interface ExtendedConditionResult {
  /**
   * null when no Tier 2 items were found.
   * Modifier is always 0 in this case — absence is never penalized.
   */
  label:     ExtendedConditionLabel | null;
  /** ±8 modifier applied on top of the Core Score. 0 when label is null. */
  modifier:  number;
  itemCount: number;
  items:     ExtendedItem[];
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Returns true when a finding belongs to the Extended Condition layer.
 * Checks both the category string and the description.
 */
export function isExtendedItem(category: string | null | undefined, description?: string): boolean {
  const c = (category    || "").toLowerCase();
  const d = (description || "").toLowerCase();
  return TIER2_KEYWORDS.some(kw => c.includes(kw) || d.includes(kw));
}

/**
 * Extended condition score formula:
 *
 *   Starts at 90 (assume good unless issues are found)
 *   Each critical finding: −12  (uncapped — 4 criticals pushes into Poor)
 *   Each warning finding:  −5   (capped at −20 total across all warnings)
 *
 * Resulting bands → label → modifier:
 *   ≥ 85 → Excellent  → +8
 *   ≥ 70 → Good       → +4
 *   ≥ 50 → Fair       →  0
 *   < 50 → Poor       → −8
 *
 * Examples:
 *   Info-only findings    → 90 → Excellent → +8
 *   1 warning             → 85 → Excellent → +8
 *   2 warnings            → 80 → Good      → +4
 *   1 critical            → 78 → Good      → +4
 *   2 criticals           → 66 → Fair      →  0
 *   3 criticals           → 54 → Fair      →  0
 *   4+ criticals          → 42 → Poor      → −8
 */
function computeExtendedScore(criticalCount: number, warningCount: number): number {
  const critPen = criticalCount * 12;
  const warnPen = Math.min(20, warningCount * 5);
  return Math.max(10, 90 - critPen - warnPen);
}

function scoreToLabel(score: number): ExtendedConditionLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

const LABEL_MODIFIER: Record<ExtendedConditionLabel, number> = {
  Excellent:  8,
  Good:       4,
  Fair:       0,
  Poor:      -8,
};

// ─────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the Extended Condition result from a set of findings.
 *
 * Findings that don't match any Tier 2 keyword are ignored.
 * Returns { label: null, modifier: 0 } when no Tier 2 items are found —
 * a home without a pool/deck/garage is not penalized for their absence.
 */
export function computeExtendedCondition(
  findings: { category: string | null; description: string; severity: string }[],
): ExtendedConditionResult {
  const extItems: ExtendedItem[] = findings
    .filter(f => isExtendedItem(f.category, f.description))
    .map(f => ({
      category:    f.category ?? "general",
      description: f.description,
      severity:    (["critical", "warning", "info"].includes((f.severity || "").toLowerCase())
                     ? f.severity.toLowerCase()
                     : "info") as "critical" | "warning" | "info",
    }));

  if (extItems.length === 0) {
    return { label: null, modifier: 0, itemCount: 0, items: [] };
  }

  const criticals = extItems.filter(i => i.severity === "critical").length;
  const warnings  = extItems.filter(i => i.severity === "warning").length;

  const score   = computeExtendedScore(criticals, warnings);
  const label   = scoreToLabel(score);

  return {
    label,
    modifier:  LABEL_MODIFIER[label],
    itemCount: extItems.length,
    items:     extItems,
  };
}
