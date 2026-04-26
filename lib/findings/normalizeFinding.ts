/**
 * BTLR deterministic finding normalization pipeline.
 *
 * Takes raw AI-extracted findings and produces:
 *  - Canonical category key (one of the fixed BTLR categories)
 *  - Derived issue_type  (pattern-matched, not AI-generated)
 *  - Derived component   (pattern-matched, not AI-generated)
 *  - Extracted location  (pattern-matched, not AI-generated)
 *  - Stable normalized_finding_key
 *  - Scoring eligibility + score_impact
 *
 * Same input → same output, every time.
 */

import { toCategoryKey, BtlrCategory } from "./categoryMap";
import { isScorable } from "./scorableRules";

// ─────────────────────────────────────────────────────────────────
// STOP WORDS — filtered out of the description slug (display only)
// ─────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "on",
  "at", "by", "for", "with", "from", "into", "through", "and", "or",
  "but", "if", "as", "it", "its", "this", "that", "these", "those",
  "not", "no", "nor", "there", "their", "they", "found", "noted",
  "observed", "recommend", "recommended", "appears", "appear", "needs",
  "need", "requires", "required", "shows", "shown", "visible", "present",
  "appear", "was", "were", "appears", "note", "indicate", "indicated",
]);

// ─────────────────────────────────────────────────────────────────
// ISSUE TYPE PATTERNS
//
// Matched in order — first match wins.
// Rules:
//  - Phrase patterns (multi-word) come before single-word patterns
//    so "hard to open" doesn't fragment into individual word matches.
//  - More specific patterns come before broader ones
//    ("crack" before "damaged_component" so cracked foundation → crack).
//  - All synonyms for the same concept map to one canonical key.
// ─────────────────────────────────────────────────────────────────
const ISSUE_PATTERNS: [RegExp, string][] = [
  // ── Phrase-based (multi-word) — must come first ──────────────
  [/hard\s+to\s+open|difficult\s+to\s+open|does\s+not\s+open\s+smoothly|binding|sticks?\b|sticking/i,
                                                               "hard_to_open"      ],
  [/not\s+work(ing)?|does\s+not\s+(operate|function|work)|fails?\s+to\s+(operate|function)/i,
                                                               "inoperable"        ],
  [/not\s+present|not\s+installed|not\s+secured/i,            "missing_component" ],
  [/end[\s-]of[\s-]life|low\s+efficiency|near\s+end|past\s+useful/i,
                                                               "end_of_life"       ],
  [/water\s+intrusion|water\s+penetrat/i,                      "moisture"          ],
  [/deferred\s+maintenance/i,                                  "deferred_maint"    ],

  // ── Single-word / short patterns ────────────────────────────
  [/\bleak(ing|age|s)?\b/i,                                    "leak"              ],
  [/\bcrack(ed|ing|s)?\b/i,                                    "crack"             ],
  [/\bmissing\b|\babsent\b|\bremoved\b/i,                      "missing_component" ],
  [/\bloose\b|\bwobbly\b/i,                                    "loose_component"   ],
  [/\bdamage[ds]?\b|\bbroken\b/i,                              "damaged_component" ],
  [/\bcorrod(ed|ing|es)?\b|\brust(ed|ing|y)?\b/i,              "corrosion"         ],
  [/\bimproper(ly)?\b|\bincorrect(ly)?\b|\bwrong(ly)?\b/i,     "improper_install"  ],
  [/\bworn?\b|\bdeteriorat(ed|ing)?\b|\bwear\b/i,              "wear"              ],
  [/\baging\b|\bobsolete\b/i,                                  "end_of_life"       ],
  [/\binoperable\b|\bnon.?function/i,                          "inoperable"        ],
  [/\bneeds?.replac\b|\breplacement\b/i,                       "needs_replacement" ],
  [/\bhazard(ous)?\b|\bunsafe\b/i,                             "safety_hazard"     ],
  [/\bmold\b|\bmildew\b/i,                                     "mold"              ],
  [/\bpest\b|\btermite\b|\brodent\b|\binsect\b/i,              "pest"              ],
  [/\bmoisture\b|\bdamp(ness)?\b|\bwet\b/i,                    "moisture"          ],
  [/\bblock(ed|age)?\b|\bclog(ged)?\b|\bobstruct/i,            "obstruction"       ],
  [/\btrip\s+hazard\b|\bfall\s+hazard\b/i,                     "trip_hazard"       ],
  [/\bnoisy\b|\bnoise\b|\bloud\b|\bratl?(ing|es)?\b|\bgrind(ing)?\b|\bsqueal(ing)?\b|\bvibrat(ion|ing)?\b/i,
                                                               "noisy_operation"   ],
  [/\bservice\b|\bmaintenance\b|\bclean(ing)?\b|\badjust(ment)?\b|\blubricate\b|\blubricat(ion|ing)?\b/i,
                                                               "maintenance_needed"],
  [/\bnot\s+secured\b|\bwobbl(y|ing)?\b/i,                     "loose_component"   ],
  [/\bnot\s+level\b|\buneven\b/i,                              "improper_install"  ],
  [/\bdeferred\b|\bneglect(ed)?\b/i,                           "deferred_maint"    ],
  [/\binefficient\b/i,                                         "inefficiency"      ],
  [/\baged?\b|\bold\b/i,                                       "aging"             ],
];

// ─────────────────────────────────────────────────────────────────
// LOCATION PATTERNS
//
// Positional/directional prefixes (front, back, side) come first
// so "front door" → location "front" not "unknown".
// Room/area names come next.
// Pool locations are at the end.
// ─────────────────────────────────────────────────────────────────
const LOCATION_PATTERNS: [RegExp, string][] = [
  // ── Positional prefixes (checked before room names) ─────────
  [/\bfront\b/i,              "front"        ],
  [/\brear\b|\bback\b/i,      "back"         ],
  [/\bentry\b|\bentrance\b/i, "entry"        ],
  [/\bside\b/i,               "side"         ],
  [/\bleft\b/i,               "left"         ],
  [/\bright\b/i,              "right"        ],
  // ── Rooms / structural areas ─────────────────────────────────
  [/\bbasement\b/i,           "basement"     ],
  [/\bgarage\b/i,             "garage"       ],
  [/\battic\b/i,              "attic"        ],
  [/\bcrawl.?space\b/i,       "crawlspace"   ],
  [/\bkitchen\b/i,            "kitchen"      ],
  [/\bbath(room)?\b/i,        "bathroom"     ],
  [/\bliving.?room\b/i,       "living_room"  ],
  [/\bbedroom\b/i,            "bedroom"      ],
  [/\blaundry\b/i,            "laundry"      ],
  [/\butility\b/i,            "utility"      ],
  [/\bexterior\b|\boutside\b/i, "exterior"  ],
  [/\broof\b/i,               "roof"         ],
  [/\bpanel\b/i,              "panel"        ],
  [/\bfoundation\b/i,         "foundation"   ],
  [/\bsump\b/i,               "sump"         ],
  // ── Pool / spa (after interior so "pool bathroom" → "bathroom") ─
  [/\bpool.?deck\b/i,         "pool_deck"    ],
  [/\bpool.?equipment\b|\bequipment.?room\b/i, "pool_equipment"],
  [/\bpool\b|\bspa\b|\bhot.?tub\b|\bjacuzzi\b/i, "pool"       ],
];

// ─────────────────────────────────────────────────────────────────
// COMPONENT PATTERNS (general — non-pool findings)
//
// Each entry: [regex, component_slug, system_group_slug]
// system_group is a coarse grouping used in the identity key so
// "front door" and "back door" share system "door" but differ by
// component ("front_door" vs "back_door").
// ─────────────────────────────────────────────────────────────────
const COMPONENT_PATTERNS: [RegExp, string, string][] = [
  // ── Doors ───────────────────────────────────────────────────
  [/\bfront\s+door\b/i,                    "front_door",       "door"        ],
  [/\b(back|rear)\s+door\b/i,              "back_door",        "door"        ],
  [/\bgarage\s+door\b/i,                   "garage_door",      "door"        ],
  [/\bentry\s+door\b|\bexterior\s+door\b/i,"exterior_door",    "door"        ],
  [/\bslid(ing|er)?\s+door\b/i,            "sliding_door",     "door"        ],
  [/\bscreen\s+door\b/i,                   "screen_door",      "door"        ],
  [/\bdoor\b/i,                            "door",             "door"        ],
  // ── Windows ─────────────────────────────────────────────────
  [/\bwindow\b/i,                          "window",           "window"      ],
  // ── HVAC ────────────────────────────────────────────────────
  [/\bfurnace\b/i,                         "furnace",          "hvac"        ],
  [/\bheat\s+pump\b/i,                     "heat_pump",        "hvac"        ],
  [/\bair\s+handler\b/i,                   "air_handler",      "hvac"        ],
  [/\bcondenser\b/i,                       "condenser",        "hvac"        ],
  [/\bduct(work)?\b/i,                     "ductwork",         "hvac"        ],
  [/\bthermostat\b/i,                      "thermostat",       "hvac"        ],
  [/\bexhaust\s+fan\b/i,                   "exhaust_fan",      "hvac"        ],
  [/\battic\s+fan\b/i,                     "attic_fan",        "hvac"        ],
  [/\bceiling\s+fan\b/i,                   "ceiling_fan",      "fan"         ],
  [/\bfan\b/i,                             "fan",              "fan"         ],
  // ── Plumbing ────────────────────────────────────────────────
  [/\bwater\s+heater\b/i,                  "water_heater",     "plumbing"    ],
  [/\bsump\s+pump\b/i,                     "sump_pump",        "plumbing"    ],
  [/\btoilet\b/i,                          "toilet",           "plumbing"    ],
  [/\bshower\b/i,                          "shower",           "plumbing"    ],
  [/\bbathtub\b|\btub\b/i,                 "bathtub",          "plumbing"    ],
  [/\bsink\b/i,                            "sink",             "plumbing"    ],
  [/\bfaucet\b/i,                          "faucet",           "plumbing"    ],
  [/\bhose\s+bib(b)?\b/i,                  "hose_bibb",        "plumbing"    ],
  // ── Electrical ──────────────────────────────────────────────
  [/\b(electrical|main|service)\s+panel\b/i, "electrical_panel","electrical" ],
  [/\bcircuit\s+breaker\b|\bbreaker\b/i,   "circuit_breaker",  "electrical"  ],
  [/\bgfci\b/i,                            "gfci_outlet",      "electrical"  ],
  [/\boutlet\b|\breceptacle\b/i,           "outlet",           "electrical"  ],
  [/\bswitch\b/i,                          "switch",           "electrical"  ],
  [/\bwiring\b/i,                          "wiring",           "electrical"  ],
  [/\bjunction\s+box\b/i,                  "junction_box",     "electrical"  ],
  // ── Roofing / exterior ──────────────────────────────────────
  [/\bshingles?\b/i,                       "shingles",         "roof"        ],
  [/\bflashing\b/i,                        "flashing",         "roof"        ],
  [/\bgutter\b/i,                          "gutter",           "roof"        ],
  [/\bdownspout\b/i,                       "downspout",        "roof"        ],
  [/\bsoffit\b/i,                          "soffit",           "roof"        ],
  [/\bfascia\b/i,                          "fascia",           "roof"        ],
  [/\bchimney\b/i,                         "chimney",          "exterior"    ],
  [/\bsiding\b/i,                          "siding",           "exterior"    ],
  // ── Structural ──────────────────────────────────────────────
  [/\bfoundation\b/i,                      "foundation",       "structure"   ],
  [/\bhandrail\b/i,                        "handrail",         "structure"   ],
  [/\bguardrail\b/i,                       "guardrail",        "structure"   ],
  [/\bstair(s|case)?\b/i,                  "stairs",           "structure"   ],
  // ── Interior surfaces ────────────────────────────────────────
  [/\bfloor(ing)?\b/i,                     "flooring",         "interior"    ],
  [/\bceiling\b/i,                         "ceiling",          "interior"    ],
  [/\bwall\b/i,                            "wall",             "interior"    ],
  [/\bdrywall\b/i,                         "drywall",          "interior"    ],
  [/\binsulation\b/i,                      "insulation",       "interior"    ],
  // ── Appliances ──────────────────────────────────────────────
  [/\bdishwasher\b/i,                      "dishwasher",       "appliance"   ],
  [/\boven\b|\brange\b|\bstove\b/i,        "range",            "appliance"   ],
  [/\brefrigerator\b/i,                    "refrigerator",     "appliance"   ],
  [/\bwash(er|ing\s+machine)\b/i,          "washer",           "appliance"   ],
  [/\bdryer\b/i,                           "dryer",            "appliance"   ],
  [/\bgarbage\s+disposal\b/i,              "garbage_disposal", "appliance"   ],
  [/\bmicrowave\b/i,                       "microwave",        "appliance"   ],
  // ── Safety / environmental ───────────────────────────────────
  [/\bsmoke\s+detector\b|\bsmoke\s+alarm\b/i, "smoke_detector","safety"     ],
  [/\bco\s+detector\b|\bcarbon\s+monoxide\b/i, "co_detector",  "safety"     ],
  [/\bdetector\b/i,                        "detector",         "safety"      ],
];

// ─────────────────────────────────────────────────────────────────
// POOL COMPONENT PATTERNS
// ─────────────────────────────────────────────────────────────────
const POOL_COMPONENT_PATTERNS: [RegExp, string][] = [
  [/\bskimmer\b/i,                          "skimmer"        ],
  [/\bpump\b/i,                             "pump"           ],
  [/\bfilter\b/i,                           "filter"         ],
  [/\bheater\b/i,                           "heater"         ],
  [/\bmain.?drain\b|\bdrain\b/i,            "drain"          ],
  [/\bplaster\b/i,                          "plaster"        ],
  [/\btile\b/i,                             "tile"           ],
  [/\bcoping\b/i,                           "coping"         ],
  [/\bfence\b|\bgate\b/i,                   "fence_gate"     ],
  [/\bcover\b/i,                            "cover"          ],
  [/\blight\b/i,                            "light"          ],
  [/\bvalve\b/i,                            "valve"          ],
  [/\bsalt.?cell\b|\bchlorin(ator)?\b/i,    "chlorinator"    ],
  [/\bauto.?fill\b|\bfill.?valve\b/i,       "autofill"       ],
  [/\bdeck\b/i,                             "deck"           ],
  [/\bspa\b|\bhot.?tub\b|\bjacuzzi\b/i,     "spa"            ],
  [/\bsurface\b|\bshell\b/i,               "shell"          ],
];

// ─────────────────────────────────────────────────────────────────
// SLUG HELPERS
// ─────────────────────────────────────────────────────────────────

/** Stable slug from a short label (category, component, location, issue_type). */
export function slugLabel(s: string): string {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "unknown";
}

/**
 * Stable 5-word content slug from a description.
 * Stop words removed, first 5 significant words kept.
 * Used for display/debug only — NOT part of the identity key.
 */
export function slugDesc(text: string): string {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 5);
  return words.join("_") || "unknown";
}

// ─────────────────────────────────────────────────────────────────
// DERIVATION HELPERS
// ─────────────────────────────────────────────────────────────────

function deriveIssueType(description: string): string {
  for (const [pattern, type] of ISSUE_PATTERNS) {
    if (pattern.test(description)) return type;
  }
  return "general";
}

function deriveLocation(description: string, explicitLocation?: string): string {
  if (explicitLocation) return explicitLocation.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  for (const [pattern, loc] of LOCATION_PATTERNS) {
    if (pattern.test(description)) return loc;
  }
  return "unknown";
}

/**
 * For general (non-pool) findings: derive component + system from description.
 * Returns [component_slug, system_group_slug].
 * component: specific part (front_door, exhaust_fan, circuit_breaker…)
 * system:    coarse group (door, hvac, electrical…) used in the identity key
 */
function deriveComponentAndSystem(
  description:       string,
  explicitComponent: string | undefined,
  explicitSystem:    string | undefined,
  fallbackCategory:  string,
): [string, string] {
  // Explicit values from AI or upstream injection take precedence
  if (explicitComponent && explicitSystem) {
    return [
      slugLabel(explicitComponent),
      slugLabel(explicitSystem),
    ];
  }

  const text = (description || "").toLowerCase();
  for (const [pattern, component, system] of COMPONENT_PATTERNS) {
    if (pattern.test(text)) {
      return [
        explicitComponent ? slugLabel(explicitComponent) : component,
        explicitSystem    ? slugLabel(explicitSystem)    : system,
      ];
    }
  }

  // Fall back: use explicit values individually if only one is present,
  // otherwise use the AI category string so the key stays meaningful.
  const comp = explicitComponent ? slugLabel(explicitComponent) : slugLabel(fallbackCategory);
  const sys  = explicitSystem    ? slugLabel(explicitSystem)    : slugLabel(fallbackCategory);
  return [comp, sys];
}

/**
 * For pool_spa findings: derive component from pool-specific patterns.
 * Falls back to "pool_equipment" so pool findings never get "unknown".
 */
function derivePoolComponent(description: string, explicitComponent?: string): string {
  if (explicitComponent) return explicitComponent.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const text = (description || "").toLowerCase();
  for (const [pattern, component] of POOL_COMPONENT_PATTERNS) {
    if (pattern.test(text)) return component;
  }
  return "pool_equipment";
}

// ─────────────────────────────────────────────────────────────────
// RAW FINDING INPUT (matches AI output schema)
// ─────────────────────────────────────────────────────────────────
export interface RawFinding {
  category:              string;
  description:           string;
  severity?:             string;
  estimated_cost?:       number | null;
  age_years?:            number | null;
  remaining_life_years?: number | null;
  lifespan_years?:       number | null;
  // Optional fields AI may provide or we inject
  location?:             string;
  system?:               string;
  component?:            string;
  issue_type?:           string;
}

// ─────────────────────────────────────────────────────────────────
// NORMALIZED FINDING OUTPUT (maps 1:1 to findings table columns)
// ─────────────────────────────────────────────────────────────────
export interface NormalizedFinding {
  // DB row fields
  normalized_finding_key: string;
  title:                  string;
  category:               BtlrCategory;   // canonical key stored in DB
  system:                 string;         // coarse system group (door, hvac, plumbing…)
  component:              string;         // specific component (front_door, furnace…)
  issue_type:             string;
  description:            string;
  location:               string;
  severity:               "critical" | "warning" | "info";
  scorable:               boolean;
  score_impact:           "high" | "medium" | "low" | "none";
  recommended_action:     string;
  estimated_cost_min:     number | null;
  estimated_cost_max:     number | null;
  raw_finding:            RawFinding;

  // Legacy compat — used by scoring engine and dashboard state
  is_scorable:            boolean;
  status:                 "open";
  estimated_cost:         number | null;
  age_years:              number | null;
  remaining_life_years:   number | null;
  lifespan_years:         number | null;
}

// ─────────────────────────────────────────────────────────────────
// KEY GENERATION
//
// Format (5 parts):
//   {canonical_category}__{system}__{component}__{location}__{issue_type}
//
// All five parts are derived from deterministic pattern-matching —
// never from free-form AI description text.
//
// Adding component gives enough specificity to distinguish:
//   "front door hard to open"  → …__door__front_door__front__hard_to_open
//   "back door hard to open"   → …__door__back_door__back__hard_to_open
//   "noisy exhaust fan"        → hvac__hvac__exhaust_fan__unknown__noisy_operation
//   "missing pool skimmer"     → pool_spa__pool__skimmer__pool__missing_component
//
// Guarantee: same inspection finding = same key, always.
// ─────────────────────────────────────────────────────────────────
export function generateNormalizedFindingKey(
  canonicalCategory: BtlrCategory,
  system:            string,
  component:         string,
  location:          string,
  issueType:         string,
): string {
  return [
    slugLabel(canonicalCategory),
    slugLabel(system    || canonicalCategory),
    slugLabel(component || system || canonicalCategory),
    slugLabel(location  || "unknown"),
    slugLabel(issueType || "general"),
  ].join("__").slice(0, 250);
}

// ─────────────────────────────────────────────────────────────────
// MAIN NORMALIZATION FUNCTION
// ─────────────────────────────────────────────────────────────────
export function normalizeFinding(raw: RawFinding): NormalizedFinding {
  // 1. Map to canonical category
  const canonicalCategory = toCategoryKey(raw.category);

  // 2. Validate / coerce severity
  const rawSev = (raw.severity || "info").toLowerCase();
  const severity: "critical" | "warning" | "info" =
    rawSev === "critical" ? "critical"
    : rawSev === "warning" ? "warning"
    : "info";

  // 3. Derive issue_type (prefer explicit AI value, fall back to pattern match)
  const issueType = raw.issue_type
    ? slugLabel(raw.issue_type)
    : deriveIssueType(raw.description || "");

  // 4. Extract location
  const location = deriveLocation(raw.description || "", raw.location);

  // 5. Derive system + component
  //    pool_spa: uses dedicated pool component patterns; system is always "pool"
  //    all others: COMPONENT_PATTERNS gives both component and system group
  const isPoolSpa = canonicalCategory === "pool_spa";
  let system:    string;
  let component: string;

  if (isPoolSpa) {
    system    = "pool";
    component = derivePoolComponent(raw.description || "", raw.component);
  } else {
    [component, system] = deriveComponentAndSystem(
      raw.description || "",
      raw.component,
      raw.system,
      raw.category,
    );
  }

  // 6. Description slug — display/debug only, intentionally excluded from key
  const descSlug = slugDesc(raw.description || "");
  void descSlug;

  // 7. Generate 5-part identity key
  const normalized_finding_key = generateNormalizedFindingKey(
    canonicalCategory, system, component, location, issueType,
  );

  // 8. Scoring eligibility
  //    pool_spa always returns false via UNSCORED_CATEGORIES (Rule 1 in isScorable)
  const scorable = isScorable(canonicalCategory, raw.description);
  const score_impact: "high" | "medium" | "low" | "none" =
    !scorable                ? "none"
    : severity === "critical" ? "high"
    : severity === "warning"  ? "medium"
    : "low";

  // 9. Human-readable title
  //    pool_spa: "Pool & Spa — Skimmer — Missing Component"
  //    others:   "Hvac — Noisy Operation"  →  title-cased below
  const categoryLabel = canonicalCategory === "pool_spa"
    ? "Pool & Spa"
    : canonicalCategory.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const componentLabel = component.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const issueLabel     = issueType .replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const title = isPoolSpa
    ? `${categoryLabel} — ${componentLabel} — ${issueLabel}`
    : `${categoryLabel} — ${issueLabel}`;

  // 10. Default recommended action
  const recommended_action =
    severity === "critical" ? "Address immediately — contact a licensed contractor" :
    severity === "warning"  ? "Schedule repair within 6–12 months"                  :
                              "Monitor and perform routine maintenance";

  // 11. Cost range (±25% of point estimate when available)
  const estimated_cost_min = raw.estimated_cost != null
    ? Math.round(raw.estimated_cost * 0.75) : null;
  const estimated_cost_max = raw.estimated_cost != null
    ? Math.round(raw.estimated_cost * 1.25) : null;

  return {
    normalized_finding_key,
    title,
    category:          canonicalCategory,
    system,
    component,
    issue_type:        issueType,
    description:       raw.description || "",
    location,
    severity,
    scorable,
    score_impact,
    recommended_action,
    estimated_cost_min,
    estimated_cost_max,
    raw_finding:       raw,

    // Legacy compat fields consumed by scoring engine + existing dashboard code
    is_scorable:          scorable,
    status:               "open",
    estimated_cost:       raw.estimated_cost       ?? null,
    age_years:            raw.age_years            ?? null,
    remaining_life_years: raw.remaining_life_years ?? null,
    lifespan_years:       raw.lifespan_years        ?? null,
  };
}

/**
 * Normalize an array of raw findings.
 * Deduplicates by normalized_finding_key (keeps highest severity on collision).
 */
export function normalizeFindings(raws: RawFinding[]): NormalizedFinding[] {
  const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  const seen = new Map<string, NormalizedFinding>();

  for (const raw of raws) {
    const nf = normalizeFinding(raw);
    const existing = seen.get(nf.normalized_finding_key);
    if (!existing) {
      seen.set(nf.normalized_finding_key, nf);
    } else {
      const existRank = SEVERITY_RANK[existing.severity] ?? 0;
      const newRank   = SEVERITY_RANK[nf.severity]       ?? 0;
      if (newRank > existRank) seen.set(nf.normalized_finding_key, nf);
    }
  }

  return Array.from(seen.values());
}
