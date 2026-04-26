/**
 * BTLR scoring eligibility rules.
 * Single source of truth — imported by both route.js and page.tsx.
 * Do NOT duplicate this logic anywhere else.
 */

import { UNSCORED_CATEGORIES } from "./categoryMap";

/**
 * Systems that are supplemental to the home — present in many inspections
 * but excluded from the Home Health Score because they are optional features,
 * not core structural/mechanical systems.
 *
 * Checked against BOTH category string AND description so a finding labelled
 * "Exterior — uneven deck boards" is correctly excluded even when the raw
 * category alone would match a scored keyword.
 *
 * NOTE: "pool", "spa", "hot tub", "skimmer" are listed here so that
 * description-level detection works even when the AI uses a generic category
 * (e.g. "Equipment — missing pool skimmer"). The canonical pool_spa category
 * is excluded via UNSCORED_CATEGORIES before we ever reach the keyword check.
 */
export const SUPPLEMENTAL_SYSTEMS: readonly string[] = [
  "fireplace", "chimney", "flue",
  "pool", "spa", "hot tub", "skimmer",
  "jacuzzi", "whirlpool",
  "deck", "patio", "pergola",
  "fence", "gate",
  "driveway", "walkway", "sidewalk", "pavement",
  "sprinkler", "irrigation",
  "shed", "outbuilding",
  "attic fan",      // cosmetic ventilation fan — not the HVAC system
  "ceiling fan",    // cosmetic
  "exhaust fan",    // bathroom exhaust — cosmetic
  "security system",
  "security camera",
  "surveillance",
  "alarm system",
];

/**
 * Returns true when a finding should affect the Home Health Score.
 *
 * Rules (evaluated in order):
 *  1. If the canonical category is in UNSCORED_CATEGORIES → NOT scorable
 *     (catches pool_spa even when the description contains no pool keywords)
 *  2. If category or description mentions a supplemental system → NOT scorable
 *     (catches pool findings that slipped through with a generic category)
 *  3. If category/description contains a scored-system keyword → scorable
 *  4. Otherwise → not scorable (safety net for unknown categories)
 */
export function isScorable(category: string, description?: string): boolean {
  const t = (category    || "").toLowerCase();
  const d = (description || "").toLowerCase();

  // Rule 1: canonical unscored category (pool_spa, and any future additions)
  // Cast is safe — UNSCORED_CATEGORIES only contains valid BtlrCategory values.
  if (UNSCORED_CATEGORIES.has(category as Parameters<typeof UNSCORED_CATEGORIES["has"]>[0])) return false;

  // Rule 2: supplemental keyword exclusion (both category string and description)
  if (SUPPLEMENTAL_SYSTEMS.some(s => t.includes(s) || d.includes(s))) return false;

  // Rule 3: scored-system keyword match
  return (
    t.includes("roof")      || t.includes("gutter")    || t.includes("exterior")  ||
    t.includes("siding")    || t.includes("fascia")     || t.includes("soffit")    ||
    t.includes("drain")     || t.includes("grading")    || t.includes("flashing")  ||
    t.includes("foundation")|| t.includes("structural") || t.includes("structure") ||
    t.includes("basement")  || t.includes("crawl")      || t.includes("settling")  ||
    t.includes("plumb")     || t.includes("pipe")       || t.includes("water heater") ||
    t.includes("sewer")     || t.includes("hose")       || t.includes("toilet")    ||
    t.includes("sink")      || t.includes("faucet")     ||
    t.includes("electr")    || t.includes("panel")      || t.includes("wiring")    ||
    t.includes("outlet")    || t.includes("gfci")       || t.includes("circuit")   ||
    t.includes("breaker")   ||
    t.includes("hvac")      || t.includes("heat")       || t.includes("cool")      ||
    t.includes("furnace")   || t.includes("duct")       || t.includes("air handler")||
    t.includes("thermostat")|| t.includes("ventilat")   ||
    t.includes("safety")    || t.includes("smoke")      || t.includes("carbon")    ||
    t.includes("detector")  || t.includes("mold")       || t.includes("pest")      ||
    t.includes("termite")   || t.includes("radon")      || t.includes("asbestos")  ||
    t.includes("lead")      ||
    t.includes("window")    || t.includes("door")       || t.includes("floor")     ||
    t.includes("ceiling")   || t.includes("wall")       || t.includes("stair")     ||
    t.includes("interior")  || t.includes("handrail")   ||
    t.includes("appliance") || t.includes("washer")     || t.includes("dryer")     ||
    t.includes("dishwasher")|| t.includes("oven")       || t.includes("range")     ||
    t.includes("refrigerator") || t.includes("stove")
  );
}
