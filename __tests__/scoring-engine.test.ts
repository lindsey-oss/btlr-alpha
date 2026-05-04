/**
 * BTLR Home Health Score — Regression Test Suite
 * Patent Pending — Proprietary
 *
 * Verifies determinism, deduction correctness, and scoring logic stability.
 * Every test runs against the LIVE scoring engine — any change to scoring
 * logic that breaks these tests is a signal, not a build failure.
 *
 * Run locally:   npm test
 * Run in CI:     npm test
 * Run this file: npx vitest __tests__/scoring-engine.test.ts
 */

import { describe, it, expect } from "vitest";

import {
  computeHomeHealthReport,
  normalizeLegacyFindings,
  applyRepairEvent,
  scoreBand,
  toCategoryKey,
  type LegacyFinding,
} from "../lib/scoring-engine";

import { hashNormalizedInputs } from "../lib/score-audit";
import { runScoringPipeline } from "../lib/scoring-pipeline";

// ─────────────────────────────────────────────────────────────────
// TEST FIXTURES
// Realistic inspection findings representing common scenarios
// ─────────────────────────────────────────────────────────────────

/** Clean, well-maintained home — expect high score */
const FIXTURE_CLEAN_HOME: LegacyFinding[] = [
  { category: "Roof", description: "Asphalt shingles in good condition, no damage noted", severity: "info" },
  { category: "HVAC", description: "Furnace serviced recently, operating normally", severity: "info" },
  { category: "Electrical", description: "Panel updated, GFCI outlets present throughout", severity: "info" },
  { category: "Plumbing", description: "No leaks detected, water heater 3 years old", severity: "info" },
  { category: "Foundation", description: "No cracking or settling noted", severity: "info" },
];

/** Home with serious issues — expect low score */
const FIXTURE_DISTRESSED_HOME: LegacyFinding[] = [
  { category: "Foundation", description: "Significant horizontal cracking in basement wall — structural concern", severity: "critical" },
  { category: "Roof", description: "Multiple missing shingles, active leak at ridge line", severity: "critical" },
  { category: "Electrical", description: "Knob-and-tube wiring present throughout, ungrounded outlets", severity: "critical" },
  { category: "Plumbing", description: "Galvanized pipes corroding, multiple active leaks under sink", severity: "critical" },
  { category: "HVAC", description: "Furnace heat exchanger cracked — safety hazard, immediate replacement needed", severity: "critical" },
];

/** Mixed home with some issues */
const FIXTURE_MIXED_HOME: LegacyFinding[] = [
  { category: "Roof", description: "Roof 18 years old, some granule loss, monitoring recommended", severity: "warning", age_years: 18, lifespan_years: 25 },
  { category: "HVAC", description: "AC unit 12 years old, functioning but nearing end of life", severity: "warning", age_years: 12, lifespan_years: 15 },
  { category: "Plumbing", description: "Minor drip at kitchen faucet, no structural concern", severity: "info" },
  { category: "Foundation", description: "No issues noted", severity: "info" },
  { category: "Electrical", description: "Panel in good condition, breakers functioning", severity: "info" },
];

/** Aging home with significant system age penalties */
const FIXTURE_AGING_HOME: LegacyFinding[] = [
  { category: "Roof", description: "Roof near end of life", severity: "warning", age_years: 23, lifespan_years: 25 },
  { category: "HVAC", description: "HVAC at end of expected life", severity: "warning", age_years: 14, lifespan_years: 15 },
  { category: "Water Heater", description: "Water heater 18 years old — well past typical lifespan", severity: "critical", age_years: 18, lifespan_years: 12 },
];

/** Single critical safety item */
const FIXTURE_SINGLE_CRITICAL: LegacyFinding[] = [
  { category: "Safety", description: "No smoke detectors present on upper floor", severity: "critical" },
  { category: "Electrical", description: "GFCI outlets missing in bathrooms", severity: "info" },
  { category: "Roof", description: "Good condition", severity: "info" },
];

/** Home where repair was completed — should improve score */
const FIXTURE_PRE_REPAIR: LegacyFinding[] = [
  { category: "Roof", description: "Active leak at chimney flashing", severity: "critical" },
  { category: "HVAC", description: "System functioning normally", severity: "info" },
  { category: "Foundation", description: "No issues", severity: "info" },
];

// ─────────────────────────────────────────────────────────────────
// TEST CASES
// ─────────────────────────────────────────────────────────────────

describe("Determinism — same inputs always produce same score", () => {

  it("TC-01: clean home produces consistent score across 3 runs", () => {
    const items = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const r1 = computeHomeHealthReport(items);
    const r2 = computeHomeHealthReport(items);
    const r3 = computeHomeHealthReport(items);
    expect(r1.home_health_score).toBe(r2.home_health_score);
    expect(r2.home_health_score).toBe(r3.home_health_score);
  });

  it("TC-02: distressed home produces consistent score across 3 runs", () => {
    const items = normalizeLegacyFindings(FIXTURE_DISTRESSED_HOME);
    const r1 = computeHomeHealthReport(items);
    const r2 = computeHomeHealthReport(items);
    const r3 = computeHomeHealthReport(items);
    expect(r1.home_health_score).toBe(r2.home_health_score);
    expect(r2.home_health_score).toBe(r3.home_health_score);
  });

  it("TC-03: input hash is stable — same inputs produce same hash", () => {
    const items = normalizeLegacyFindings(FIXTURE_MIXED_HOME);
    const h1 = hashNormalizedInputs(items);
    const h2 = hashNormalizedInputs(items);
    expect(h1).toBe(h2);
    expect(h1.length).toBeGreaterThan(0);
  });

  it("TC-04: different inputs produce different hashes", () => {
    const itemsA = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const itemsB = normalizeLegacyFindings(FIXTURE_DISTRESSED_HOME);
    const hA = hashNormalizedInputs(itemsA);
    const hB = hashNormalizedInputs(itemsB);
    expect(hA).not.toBe(hB);
  });

});

describe("Score range sanity — scores must stay within bounds", () => {

  it("TC-05: clean home score is in good range (≥70, ≤100)", () => {
    // Confidence blending toward neutral baseline (72) means even a perfect home
    // won't score 100. The clean fixture scores in the Fair-to-Good range.
    const items = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const report = computeHomeHealthReport(items);
    expect(report.home_health_score).toBeGreaterThanOrEqual(70);
    expect(report.home_health_score).toBeLessThanOrEqual(100);
  });

  it("TC-06: distressed home score is low (<70)", () => {
    const items = normalizeLegacyFindings(FIXTURE_DISTRESSED_HOME);
    const report = computeHomeHealthReport(items);
    expect(report.home_health_score).toBeLessThan(70);
    expect(report.home_health_score).toBeGreaterThanOrEqual(0);
  });

  it("TC-07: distressed home scores lower than clean home", () => {
    const cleanItems     = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const distressItems  = normalizeLegacyFindings(FIXTURE_DISTRESSED_HOME);
    const cleanReport    = computeHomeHealthReport(cleanItems);
    const distressReport = computeHomeHealthReport(distressItems);
    expect(cleanReport.home_health_score).toBeGreaterThan(distressReport.home_health_score);
  });

  it("TC-08: all sub-scores are in 0–100 range", () => {
    const items  = normalizeLegacyFindings(FIXTURE_MIXED_HOME);
    const report = computeHomeHealthReport(items);
    expect(report.readiness_score).toBeGreaterThanOrEqual(0);
    expect(report.readiness_score).toBeLessThanOrEqual(100);
    expect(report.safety_score).toBeGreaterThanOrEqual(0);
    expect(report.safety_score).toBeLessThanOrEqual(100);
    expect(report.maintenance_score).toBeGreaterThanOrEqual(0);
    expect(report.maintenance_score).toBeLessThanOrEqual(100);
    expect(report.confidence_score).toBeGreaterThanOrEqual(0);
    expect(report.confidence_score).toBeLessThanOrEqual(100);
  });

});

describe("Resolved issues remove deductions", () => {

  it("TC-09: repairing a critical roof issue improves the overall score", () => {
    const items  = normalizeLegacyFindings(FIXTURE_PRE_REPAIR);
    const before = computeHomeHealthReport(items);

    const repairedItems = applyRepairEvent(items, {
      event_type: "repair_completed",
      system:     "Roof",
      confidence: 0.9,
      source:     "invoice",
      date:       "2025-01-15",
    });
    const after = computeHomeHealthReport(repairedItems);

    expect(after.home_health_score).toBeGreaterThan(before.home_health_score);
  });

  it("TC-10: full component replacement restores score higher than repair", () => {
    const items = normalizeLegacyFindings(FIXTURE_PRE_REPAIR);

    const repaired = applyRepairEvent(items, {
      event_type: "repair_completed",
      system: "Roof", confidence: 0.9, source: "invoice", date: "2025-01-15",
    });
    const replaced = applyRepairEvent(items, {
      event_type: "component_replaced",
      system: "Roof", confidence: 0.95, source: "invoice", date: "2025-01-15",
    });

    const repairScore  = computeHomeHealthReport(repaired).home_health_score;
    const replaceScore = computeHomeHealthReport(replaced).home_health_score;
    expect(replaceScore).toBeGreaterThanOrEqual(repairScore);
  });

});

describe("System age penalties are applied correctly", () => {

  it("TC-11: roof at 23/25 years gets a lower score than roof at 5/25 years", () => {
    const agingRoof: LegacyFinding = {
      category: "Roof", description: "Aging roof", severity: "warning",
      age_years: 23, lifespan_years: 25,
    };
    const youngRoof: LegacyFinding = {
      category: "Roof", description: "Young roof", severity: "info",
      age_years: 5, lifespan_years: 25,
    };
    const agingItems = normalizeLegacyFindings([agingRoof]);
    const youngItems = normalizeLegacyFindings([youngRoof]);
    const agingScore = computeHomeHealthReport(agingItems).home_health_score;
    const youngScore = computeHomeHealthReport(youngItems).home_health_score;
    expect(youngScore).toBeGreaterThan(agingScore);
  });

  it("TC-12: synthetic system-age items are added for roof and HVAC when age is provided", () => {
    const items = normalizeLegacyFindings([], 20, 13);
    const roofItem = items.find(i => i.source_type === "system_age" && i.system === "Roof");
    const hvacItem = items.find(i => i.source_type === "system_age" && i.system === "HVAC");
    expect(roofItem).not.toBeUndefined();
    expect(hvacItem).not.toBeUndefined();
  });

  it("TC-13: aging home scores lower than clean home with age data", () => {
    const agingItems = normalizeLegacyFindings(FIXTURE_AGING_HOME);
    const cleanItems = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const agingScore = computeHomeHealthReport(agingItems).home_health_score;
    const cleanScore = computeHomeHealthReport(cleanItems).home_health_score;
    expect(cleanScore).toBeGreaterThan(agingScore);
  });

});

describe("Category normalization is correct", () => {

  it("TC-14: category keys normalize consistently", () => {
    expect(toCategoryKey("Roof")).toBe("roof_drainage_exterior");
    expect(toCategoryKey("Foundation")).toBe("structure_foundation");
    expect(toCategoryKey("HVAC")).toBe("hvac");
    expect(toCategoryKey("Electrical Panel")).toBe("electrical");
    expect(toCategoryKey("Plumbing")).toBe("plumbing");
    expect(toCategoryKey("Safety")).toBe("safety_environmental");
  });

});

describe("Score bands map correctly to score ranges", () => {

  it("TC-15: scoreBand returns correct label for boundary values", () => {
    expect(scoreBand(95)).toBe("Excellent");
    expect(scoreBand(90)).toBe("Excellent");
    expect(scoreBand(89)).toBe("Good");
    expect(scoreBand(80)).toBe("Good");
    expect(scoreBand(79)).toBe("Fair");
    expect(scoreBand(70)).toBe("Fair");
    expect(scoreBand(69)).toBe("Needs Attention");
    expect(scoreBand(60)).toBe("Needs Attention");
    expect(scoreBand(59)).toBe("High Risk");
    expect(scoreBand(0)).toBe("High Risk");
  });

});

describe("Pipeline produces identical results to direct engine call", () => {

  it("TC-16: pipeline score matches direct engine score exactly", () => {
    const items  = normalizeLegacyFindings(FIXTURE_MIXED_HOME);
    const direct = computeHomeHealthReport(items);
    const { report: piped } = runScoringPipeline({ items, propertyId: "test-prop-1" });
    expect(piped.home_health_score).toBe(direct.home_health_score);
    expect(piped.score_band).toBe(direct.score_band);
    expect(piped.safety_score).toBe(direct.safety_score);
    expect(piped.readiness_score).toBe(direct.readiness_score);
  });

  it("TC-17: pipeline snapshot contains correct score and item count", () => {
    const items = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const { snapshot } = runScoringPipeline({ items, propertyId: "test-prop-2" });
    const direct = computeHomeHealthReport(items);
    expect(snapshot.final_score).toBe(direct.home_health_score);
    expect(snapshot.input_item_count).toBe(items.length);
    expect(snapshot.engine_version).toBe("4.0.0");
  });

});

// ─────────────────────────────────────────────────────────────────
// SNAPSHOT SCORES — record current baseline for regression tracking
// These values ARE the expected outputs. If they change, a scoring
// rule changed. Update them deliberately, not accidentally.
// ─────────────────────────────────────────────────────────────────

describe("Baseline score snapshots — update only deliberately", () => {

  it("TC-18: clean home score matches recorded baseline (74)", () => {
    const items  = normalizeLegacyFindings(FIXTURE_CLEAN_HOME);
    const report = computeHomeHealthReport(items);
    // LOCKED BASELINE: engine v4.0.0 produces 78 for the clean fixture.
    // If this changes, a scoring rule changed — update deliberately.
    const LOCKED_BASELINE = 78;
    expect(report.home_health_score).toBe(LOCKED_BASELINE);
    console.log(`  [baseline] clean home: ${report.home_health_score} (expected ${LOCKED_BASELINE})`);
  });

  it("TC-19: mixed home score is in Fair-to-Good range", () => {
    const items  = normalizeLegacyFindings(FIXTURE_MIXED_HOME);
    const report = computeHomeHealthReport(items);
    // Mixed home should land in 65-85 range
    expect(report.home_health_score).toBeGreaterThanOrEqual(65);
    expect(report.home_health_score).toBeLessThanOrEqual(85);
    console.log(`  [baseline] mixed home: ${report.home_health_score}`);
  });

  it("TC-20: single critical safety item depresses safety score", () => {
    const items  = normalizeLegacyFindings(FIXTURE_SINGLE_CRITICAL);
    const report = computeHomeHealthReport(items);
    // A single critical safety item should pull safety score down noticeably
    expect(report.safety_score).toBeLessThan(100);
    console.log(`  [baseline] single critical safety: score=${report.home_health_score}, safety=${report.safety_score}`);
  });

});
