/**
 * BTLR Guided Self-Inspection Questionnaire
 * Patent Pending — Proprietary
 *
 * Defines the multi-step questionnaire for Free-tier users to self-report
 * their home's condition. Each answered question generates a LegacyFinding
 * that feeds directly into the standard scoring pipeline.
 *
 * Flow:
 *   User answers 7 steps (6 core systems + Safety)
 *   → generateSelfInspectionFindings(answers) → LegacyFinding[]
 *   → normalizeLegacyFindings() → NormalizedItem[]
 *   → computeHomeHealthReport() / computeHealthScore()
 *
 * Saving:
 *   Findings saved to the `findings` table with finding_source = 'self_inspection'.
 *   Old self-inspection findings are deleted before inserting new ones so each
 *   re-inspection is a clean slate. Professional inspection findings are untouched.
 */

import type { LegacyFinding } from "./scoring-engine";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

/** A single selectable answer within a question. */
export interface SelfInspectOption {
  value:    string;
  label:    string;
  subLabel?: string;
  /** Maps to LegacyFinding.severity */
  severity: "critical" | "warning" | "info";
  /** Human-readable description written into the finding */
  note:     string;
  /** Optional age hint for water heater / HVAC age questions */
  age_years?: number;
  lifespan_years?: number;
}

/** A single question within a step. */
export interface SelfInspectQuestion {
  id:       string;         // unique — used as normalized_finding_key suffix
  category: string;         // BTLR canonical category key
  label:    string;         // question text
  hint?:    string;         // supporting context
  options:  SelfInspectOption[];
}

/** One system step in the questionnaire (groups 2-3 questions). */
export interface SelfInspectStep {
  key:         string;    // system key slug
  systemName:  string;    // "Structure & Foundation"
  emoji:       string;    // visual icon
  description: string;    // what this system covers
  questions:   SelfInspectQuestion[];
}

// ─────────────────────────────────────────────────────────────────
// QUESTIONNAIRE DATA
// 7 steps — 6 core systems + Safety
// ─────────────────────────────────────────────────────────────────
export const SELF_INSPECT_STEPS: SelfInspectStep[] = [

  // ── Step 1: Structure & Foundation ───────────────────────────
  {
    key:        "structure",
    systemName: "Structure & Foundation",
    emoji:      "🏗️",
    description: "Covers your foundation, load-bearing walls, basement, and floor framing.",
    questions: [
      {
        id:       "struct_cracks",
        category: "structure_foundation",
        label:    "Do you see cracks in your foundation, basement walls, or around door/window frames?",
        hint:     "Look for stair-step cracks, wide gaps (> ¼ inch), or horizontal cracks.",
        options: [
          { value: "none",     label: "None visible",                  subLabel: "No cracks observed",          severity: "info",     note: "No structural cracks observed in foundation or walls." },
          { value: "hairline", label: "Hairline cracks only",          subLabel: "Small, thin cracks < ¼ inch",  severity: "warning",  note: "Hairline cracks noted in foundation or walls — monitor annually for changes." },
          { value: "wide",     label: "Wide or stair-step cracks",     subLabel: "Cracks ¼ inch or larger",      severity: "critical", note: "Significant cracks in foundation or walls — professional structural evaluation recommended." },
        ],
      },
      {
        id:       "struct_floors",
        category: "structure_foundation",
        label:    "Do floors feel bouncy, uneven, or sagging anywhere?",
        hint:     "Walk through each room, especially over crawl spaces.",
        options: [
          { value: "solid",    label: "Solid and level",              subLabel: "No bounce or unevenness",       severity: "info",     note: "Floors appear solid and level throughout." },
          { value: "minor",    label: "Minor bouncing in 1-2 spots",  subLabel: "Small area, not worsening",     severity: "warning",  note: "Minor floor deflection noted in 1-2 areas — may indicate sub-floor or joist wear." },
          { value: "sagging",  label: "Noticeable sagging or soft",   subLabel: "Multiple areas or worsening",   severity: "critical", note: "Floor sagging or soft spots observed — structural sub-floor review recommended." },
        ],
      },
      {
        id:       "struct_doors",
        category: "structure_foundation",
        label:    "Do interior doors or windows stick, bind, or have uneven gaps?",
        hint:     "This can indicate foundation settlement.",
        options: [
          { value: "fine",     label: "All open and close fine",      subLabel: "No sticking or binding",        severity: "info",     note: "Doors and windows operate normally with no signs of settlement." },
          { value: "some",     label: "A few stick slightly",         subLabel: "1-2 doors, minor",              severity: "warning",  note: "A few doors or windows sticking slightly — may indicate minor seasonal settling." },
          { value: "many",     label: "Multiple doors/windows bind",  subLabel: "3+ or getting worse",           severity: "warning",  note: "Multiple sticking doors or windows — possible ongoing foundation movement, monitor closely." },
        ],
      },
    ],
  },

  // ── Step 2: Roof & Exterior ───────────────────────────────────
  {
    key:        "roof",
    systemName: "Roof & Exterior",
    emoji:      "🏠",
    description: "Covers roofing, gutters, siding, and the exterior envelope.",
    questions: [
      {
        id:       "roof_condition",
        category: "roof_drainage_exterior",
        label:    "What's the visible condition of your roof from outside or the attic?",
        hint:     "Look for damaged/missing shingles, curling, or sagging areas.",
        options: [
          { value: "good",     label: "Looks good / recently replaced", subLabel: "No visible damage",            severity: "info",     note: "Roof appears to be in good condition with no visible damage observed." },
          { value: "aging",    label: "Showing age or weathering",     subLabel: "Worn but intact",               severity: "warning",  note: "Roof shows signs of aging and weathering — monitor and plan for replacement within a few years." },
          { value: "damaged",  label: "Visible damage or missing",     subLabel: "Missing/curling shingles",      severity: "critical", note: "Visible roof damage or missing shingles — professional inspection and repair recommended promptly." },
        ],
      },
      {
        id:       "roof_leaks",
        category: "roof_drainage_exterior",
        label:    "Any water stains on ceilings, walls, or in the attic?",
        hint:     "Check attic corners, around skylights, and chimney areas.",
        options: [
          { value: "none",     label: "No stains or leaks",           subLabel: "Ceilings and attic dry",        severity: "info",     note: "No water stains or evidence of roof leaks observed." },
          { value: "old",      label: "Old / dried stains",           subLabel: "Past issue, appears resolved",  severity: "warning",  note: "Old water staining observed — verify source has been repaired." },
          { value: "active",   label: "Recent or active staining",    subLabel: "New stains or wet areas",       severity: "critical", note: "Active or recent water intrusion evidence — source must be identified and repaired." },
        ],
      },
      {
        id:       "roof_gutters",
        category: "roof_drainage_exterior",
        label:    "What's the condition of your gutters and downspouts?",
        options: [
          { value: "good",     label: "Clean and draining well",      subLabel: "Attached, no blockages",        severity: "info",     note: "Gutters and downspouts appear clear and properly attached." },
          { value: "dirty",    label: "Need cleaning or minor repair", subLabel: "Clogged or slightly detached",  severity: "warning",  note: "Gutters need cleaning or minor repairs to maintain proper drainage." },
          { value: "damaged",  label: "Damaged, missing, or failing", subLabel: "Sections missing or pulling away", severity: "warning", note: "Gutters are damaged or missing sections — water intrusion risk increases." },
        ],
      },
    ],
  },

  // ── Step 3: Electrical ────────────────────────────────────────
  {
    key:        "electrical",
    systemName: "Electrical",
    emoji:      "⚡",
    description: "Covers your electrical panel, wiring, outlets, and circuit protection.",
    questions: [
      {
        id:       "elec_breakers",
        category: "electrical",
        label:    "Do circuit breakers trip repeatedly, or do lights flicker?",
        hint:     "Frequent tripping or flickering can signal overloaded circuits or failing components.",
        options: [
          { value: "never",    label: "Never",                        subLabel: "No tripping or flickering",     severity: "info",     note: "No circuit breaker trips or flickering lights observed." },
          { value: "occasional", label: "Occasional tripping",        subLabel: "Once a month or less",          severity: "warning",  note: "Occasional circuit breaker trips or flickering — evaluate load and panel condition." },
          { value: "frequent", label: "Frequent tripping or smells",  subLabel: "Weekly or burning smell",       severity: "critical", note: "Frequent breaker trips or burning odor — potential wiring or panel issue requiring electrical inspection." },
        ],
      },
      {
        id:       "elec_gfci",
        category: "electrical",
        label:    "Do you have GFCI-protected outlets in kitchens, bathrooms, garage, and outdoors?",
        hint:     "GFCI outlets have Test/Reset buttons and protect against electrocution near water.",
        options: [
          { value: "yes",      label: "Yes, all wet locations",       subLabel: "Kitchen, baths, garage, outside", severity: "info",   note: "GFCI protection present in all required wet-area locations." },
          { value: "partial",  label: "Some areas only / unsure",     subLabel: "May have gaps",                 severity: "warning",  note: "GFCI coverage appears incomplete — verify all wet-area outlets are protected." },
          { value: "no",       label: "No GFCI outlets",              subLabel: "None visible",                  severity: "critical", note: "No GFCI protection observed — safety hazard in wet locations, installation required." },
        ],
      },
      {
        id:       "elec_outlets",
        category: "electrical",
        label:    "Any non-working outlets, discolored plates, or outlets warm to the touch?",
        options: [
          { value: "fine",     label: "All outlets working fine",     subLabel: "No discoloration or heat",      severity: "info",     note: "All visible outlets appear to be working properly with no signs of overheating." },
          { value: "few",      label: "1-2 non-working outlets",      subLabel: "Isolated, not warm",            severity: "warning",  note: "One or two non-working outlets observed — evaluate for wiring issues." },
          { value: "multiple", label: "Multiple issues or warm",      subLabel: "Warm, discolored, or sparking", severity: "critical", note: "Multiple outlet issues or heat/discoloration observed — electrical hazard, professional evaluation needed." },
        ],
      },
    ],
  },

  // ── Step 4: Plumbing ──────────────────────────────────────────
  {
    key:        "plumbing",
    systemName: "Plumbing",
    emoji:      "🔧",
    description: "Covers pipes, fixtures, water heater, and drainage.",
    questions: [
      {
        id:       "plumb_leaks",
        category: "plumbing",
        label:    "Any dripping faucets, running toilets, or visible water leaks?",
        hint:     "Check under sinks, around toilets, and near the water heater.",
        options: [
          { value: "none",     label: "No leaks or drips",            subLabel: "All dry and tight",             severity: "info",     note: "No visible water leaks or dripping fixtures observed." },
          { value: "minor",    label: "Minor dripping faucet(s)",     subLabel: "Slow drip, not urgent",         severity: "warning",  note: "Dripping faucet(s) noted — repair to prevent water waste and potential damage." },
          { value: "active",   label: "Active leak or multiple",      subLabel: "Wet area, staining, or pooling", severity: "critical", note: "Active water leak observed — immediate repair needed to prevent water damage." },
        ],
      },
      {
        id:       "plumb_pressure",
        category: "plumbing",
        label:    "How's the water pressure throughout your home?",
        hint:     "Run multiple fixtures at once to test consistency.",
        options: [
          { value: "good",     label: "Good and consistent",          subLabel: "Strong throughout",             severity: "info",     note: "Water pressure appears normal and consistent throughout the home." },
          { value: "low",      label: "Low or inconsistent",          subLabel: "Weak in some fixtures",         severity: "warning",  note: "Low or inconsistent water pressure observed — may indicate pipe scale, leak, or supply issue." },
          { value: "very_low", label: "Very low or no hot water",     subLabel: "Significant problem",           severity: "critical", note: "Significantly low water pressure or hot water issues — plumbing system evaluation recommended." },
        ],
      },
      {
        id:       "plumb_water_heater",
        category: "appliances_water_heater",
        label:    "How old is your water heater? (Approximate)",
        hint:     "Check the label on the unit — manufacture date is usually stamped.",
        options: [
          { value: "young",    label: "Under 6 years",                subLabel: "Recently replaced",             severity: "info",     note: "Water heater is relatively new — operating within normal lifespan.", age_years: 3, lifespan_years: 12 },
          { value: "mid",      label: "6–10 years",                   subLabel: "Mid-life, monitor",             severity: "warning",  note: "Water heater is approaching mid-life — plan for replacement within a few years.", age_years: 8, lifespan_years: 12 },
          { value: "old",      label: "10+ years / Unknown",          subLabel: "Past or near end of life",      severity: "critical", note: "Water heater is at or past typical lifespan — replacement planning recommended.", age_years: 11, lifespan_years: 12 },
        ],
      },
    ],
  },

  // ── Step 5: HVAC ──────────────────────────────────────────────
  {
    key:        "hvac",
    systemName: "Heating & Cooling",
    emoji:      "🌡️",
    description: "Covers furnace, air conditioner, ductwork, and ventilation.",
    questions: [
      {
        id:       "hvac_service",
        category: "hvac",
        label:    "When was your HVAC system last professionally serviced?",
        hint:     "Annual tune-ups extend system life and catch problems early.",
        options: [
          { value: "recent",   label: "Within the last year",         subLabel: "Up to date",                    severity: "info",     note: "HVAC serviced within the past year — maintenance appears current." },
          { value: "overdue",  label: "1–3 years ago",                subLabel: "Slightly overdue",              severity: "warning",  note: "HVAC service is overdue — schedule a professional tune-up to maintain efficiency." },
          { value: "long",     label: "3+ years / Never",             subLabel: "Significant maintenance gap",   severity: "critical", note: "HVAC has not been serviced in 3+ years — risk of efficiency loss, breakdown, and early failure." },
        ],
      },
      {
        id:       "hvac_performance",
        category: "hvac",
        label:    "Does your HVAC heat and cool your home evenly?",
        options: [
          { value: "good",     label: "Very consistent throughout",   subLabel: "All rooms comfortable",         severity: "info",     note: "HVAC system heats and cools the home evenly with no comfort complaints." },
          { value: "some",     label: "A few rooms too hot or cold",  subLabel: "1-2 rooms off",                 severity: "warning",  note: "Uneven heating/cooling in 1-2 areas — duct balance or system capacity issue possible." },
          { value: "major",    label: "Major areas don't heat/cool",  subLabel: "Several rooms or whole floors", severity: "critical", note: "Significant HVAC performance issues — system may be undersized, failing, or have duct problems." },
        ],
      },
      {
        id:       "hvac_age",
        category: "hvac",
        label:    "How old is your heating/cooling system?",
        hint:     "Age is found on the manufacturer label inside the unit.",
        options: [
          { value: "young",    label: "Under 8 years",                subLabel: "Relatively new",                severity: "info",     note: "HVAC system is relatively new and well within typical service life.", age_years: 4, lifespan_years: 15 },
          { value: "mid",      label: "8–12 years",                   subLabel: "Monitor, plan ahead",           severity: "warning",  note: "HVAC system is in the later half of its expected lifespan — begin planning for eventual replacement.", age_years: 10, lifespan_years: 15 },
          { value: "old",      label: "12+ years / Unknown",          subLabel: "Near or past end of life",      severity: "critical", note: "HVAC system is approaching or past its typical 12-15 year lifespan — replacement planning recommended.", age_years: 13, lifespan_years: 15 },
        ],
      },
    ],
  },

  // ── Step 6: Appliances ────────────────────────────────────────
  {
    key:        "appliances",
    systemName: "Appliances",
    emoji:      "🍳",
    description: "Covers built-in kitchen appliances, washer/dryer connections, and water heater.",
    questions: [
      {
        id:       "appl_kitchen",
        category: "appliances_water_heater",
        label:    "Are all major kitchen appliances working properly?",
        hint:     "Stove, oven, dishwasher, refrigerator, garbage disposal.",
        options: [
          { value: "all_good", label: "All working well",             subLabel: "No issues",                     severity: "info",     note: "All major kitchen appliances are operational with no observed deficiencies." },
          { value: "minor",    label: "One has a minor issue",        subLabel: "Still functional",              severity: "warning",  note: "One kitchen appliance has a minor issue — monitor and schedule repair as needed." },
          { value: "multiple", label: "Multiple issues or not working", subLabel: "2+ appliances affected",     severity: "warning",  note: "Multiple kitchen appliances have issues — evaluation and repair recommended." },
        ],
      },
      {
        id:       "appl_laundry",
        category: "appliances_water_heater",
        label:    "Is your washer/dryer setup working properly?",
        options: [
          { value: "good",     label: "Working fine",                 subLabel: "No issues",                     severity: "info",     note: "Washer and dryer operating normally." },
          { value: "minor",    label: "Minor issues",                 subLabel: "Still functional",              severity: "warning",  note: "Minor washer or dryer issue observed — monitor and service as needed." },
          { value: "na",       label: "Not applicable / None",        subLabel: "No laundry appliances",         severity: "info",     note: "No in-unit washer/dryer present." },
        ],
      },
    ],
  },

  // ── Step 7: Safety ────────────────────────────────────────────
  {
    key:        "safety",
    systemName: "Safety",
    emoji:      "🛡️",
    description: "Covers smoke detectors, CO detectors, and known hazards.",
    questions: [
      {
        id:       "safety_smoke",
        category: "safety_environmental",
        label:    "Do you have working smoke detectors on every level of your home?",
        hint:     "Test each detector by pressing the test button.",
        options: [
          { value: "all",      label: "Yes, tested and working",      subLabel: "All levels covered",            severity: "info",     note: "Working smoke detectors present on all levels — safety requirement met." },
          { value: "partial",  label: "Some floors only / untested",  subLabel: "May have gaps",                 severity: "critical", note: "Smoke detector coverage appears incomplete — install or test detectors on all levels immediately." },
          { value: "no",       label: "No or not sure",               subLabel: "Cannot confirm",                severity: "critical", note: "Smoke detector status unconfirmed or absent — install working detectors on all levels." },
        ],
      },
      {
        id:       "safety_co",
        category: "safety_environmental",
        label:    "Do you have carbon monoxide detectors near sleeping areas?",
        hint:     "Required if you have a gas furnace, gas appliances, or attached garage.",
        options: [
          { value: "yes",      label: "Yes, near sleeping areas",     subLabel: "CO protection in place",        severity: "info",     note: "Carbon monoxide detectors present near sleeping areas." },
          { value: "unsure",   label: "Not sure",                     subLabel: "Cannot confirm",                severity: "warning",  note: "Carbon monoxide detector status is uncertain — verify or install near sleeping areas." },
          { value: "no",       label: "No CO detectors",              subLabel: "None present",                  severity: "critical", note: "No carbon monoxide detectors present — install immediately if home has gas appliances or attached garage." },
        ],
      },
      {
        id:       "safety_hazards",
        category: "safety_environmental",
        label:    "Any known hazards — mold, active pests, or gas smell?",
        hint:     "Check under sinks, in bathrooms, basement/crawl, and near gas appliances.",
        options: [
          { value: "none",     label: "None observed",               subLabel: "No hazards seen or smelled",     severity: "info",     note: "No mold, pest activity, or gas odors observed." },
          { value: "potential", label: "Minor concern or potential",  subLabel: "Needs monitoring",              severity: "warning",  note: "Possible minor mold or pest activity noted — inspect and remediate as needed." },
          { value: "active",   label: "Active mold, pests, or gas",  subLabel: "Requires action",               severity: "critical", note: "Active mold growth, pest infestation, or gas odor present — immediate professional remediation required." },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
// ANSWER → LEGACY FINDING MAPPER
// ─────────────────────────────────────────────────────────────────

/** Answers keyed by question.id → option.value */
export type SelfInspectAnswers = Record<string, string>;

/**
 * Converts a completed self-inspection answer set into LegacyFindings.
 *
 * - One LegacyFinding per answered question
 * - "info" findings ARE included — they tell the scoring engine the system
 *   was assessed and found to be in good condition (positive signal)
 * - Unanswered questions are skipped (no assumption either way)
 */
export function generateSelfInspectionFindings(
  answers: SelfInspectAnswers,
): (LegacyFinding & { normalized_finding_key: string; source: string })[] {
  const results: (LegacyFinding & { normalized_finding_key: string; source: string })[] = [];

  for (const step of SELF_INSPECT_STEPS) {
    for (const question of step.questions) {
      const value = answers[question.id];
      if (!value) continue; // unanswered — skip

      const option = question.options.find(o => o.value === value);
      if (!option) continue;

      results.push({
        category:                `${question.category}`,
        description:             option.note,
        severity:                option.severity,
        estimated_cost:          null,
        age_years:               option.age_years ?? null,
        lifespan_years:          option.lifespan_years ?? null,
        remaining_life_years:    (option.age_years != null && option.lifespan_years != null)
                                   ? Math.max(0, option.lifespan_years - option.age_years)
                                   : null,
        source:                  "self_inspection",
        // Stable dedup key — re-doing the self-inspection overwrites these rows
        normalized_finding_key:  `self__${step.key}__${question.id}__${value}__v1`,
      });
    }
  }

  return results;
}

/** Returns all question IDs for a given step key. Used to check completion. */
export function stepQuestionIds(stepKey: string): string[] {
  const step = SELF_INSPECT_STEPS.find(s => s.key === stepKey);
  return step?.questions.map(q => q.id) ?? [];
}

/** Returns true when all required questions in a step are answered. */
export function isStepComplete(stepKey: string, answers: SelfInspectAnswers): boolean {
  return stepQuestionIds(stepKey).every(id => !!answers[id]);
}

/** Returns the total number of questions across all steps. */
export const TOTAL_QUESTIONS = SELF_INSPECT_STEPS.reduce(
  (sum, step) => sum + step.questions.length, 0,
);
