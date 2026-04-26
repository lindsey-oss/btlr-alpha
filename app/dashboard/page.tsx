"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  Home as HomeIcon, Upload, FileText, Activity,
  Wrench, Users, Settings, Send, Loader2, CheckCircle2,
  AlertTriangle, AlertCircle, Info, ChevronRight, ChevronDown, Sparkles, X, CloudUpload,
  LogOut, User, MapPin, Link as LinkIcon, TrendingDown, Briefcase,
  DollarSign, Shield, Zap, Droplets, Wind, Eye, Bug,
  ExternalLink, ArrowRight, BarChart3, Clock, TrendingUp,
  Mic, MicOff, Volume2, VolumeX, Check, Plus, PiggyBank,
} from "lucide-react";
import VendorsView from "../components/VendorsView";
import MyJobsView from "../components/MyJobsView";
import type { HomeHealthReport } from "../../lib/scoring-engine";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../lib/scoring-engine";
import { isScorable } from "../../lib/findings/scorableRules";

// ── Types ─────────────────────────────────────────────────────────────────
interface TimelineEvent { date: string; event: string }
interface Doc { id: string; name: string; path: string; url?: string; document_type: string }
type FindingStatus = "open" | "completed" | "monitored" | "not_sure" | "dismissed";

interface Finding {
  category: string;
  description: string;
  is_scorable?: boolean;   // set by parser — mirrors isScorable()
  scorable?: boolean;      // alias from normalizeFinding output
  score_impact?: "high" | "medium" | "low" | "none";
  severity: string;
  estimated_cost: number | null;
  source?: "photo" | "inspection" | string; // "photo" = from image analysis
  age_years?: number | null;           // how old this system is (from inspection report)
  remaining_life_years?: number | null; // inspector's stated remaining useful life
  lifespan_years?: number | null;       // typical total lifespan for this system
  status?: FindingStatus; // injected client-side from findingStatuses map
  // Normalized pipeline fields (from normalizeFinding.ts)
  normalized_finding_key?: string;
  title?: string;
  system?: string;
  component?: string;
  issue_type?: string;
  location?: string;
  recommended_action?: string;
  estimated_cost_min?: number | null;
  estimated_cost_max?: number | null;
  // Pass 3 classification confidence
  confidence_score?:       "high" | "medium" | "low" | "unconfirmed";
  classification_reason?:  string;
  needs_review?:           boolean;
}

// Normalize a finding category to a stable key for status lookup
function toCategoryKey(category: string): string {
  return (category || "general").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/// Per-finding status key.
// Uses normalized_finding_key when available (stable across re-uploads of same report).
// Falls back to category+index for legacy / photo findings that predate the pipeline.
function findingKey(findingOrCategory: Finding | string, index: number): string {
  if (typeof findingOrCategory === "object" && findingOrCategory.normalized_finding_key) {
    return findingOrCategory.normalized_finding_key;
  }
  const cat = typeof findingOrCategory === "string" ? findingOrCategory : findingOrCategory.category;
  return `${toCategoryKey(cat)}_${index}`;
}

// isScoredFinding — thin alias for the shared isScorable from scorableRules.ts.
// Single source of truth: route.js and dashboard now call the same function.
// Supplemental systems (pool, spa, deck, fireplace, etc.) are excluded.
const isScoredFinding = isScorable;

// Returns score impact metadata for a finding — used in the Repairs tab
// to badge, color-code, and explain why a repair affects the Home Health Score.
type ScoreImpact =
  | { affects: true;  level: "high" | "medium" | "low"; color: string; bg: string; label: string; reason: string }
  | { affects: false; color: string; bg: string; label: string };

function getScoreImpact(category: string, severity?: string, description?: string): ScoreImpact {
  const scored = isScoredFinding(category, description);
  if (!scored) {
    return { affects: false, color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Informational" };
  }
  const t = (category || "").toLowerCase();
  // Derive a plain-language reason from the category
  let reason = "Affects your overall Home Health Score";
  if (t.includes("roof") || t.includes("gutter"))          reason = "Roof condition directly impacts the Roof & Drainage score";
  else if (t.includes("foundation") || t.includes("structural") || t.includes("settling") || t.includes("crawl") || t.includes("basement"))
                                                             reason = "Structural integrity is the highest-weighted score category";
  else if (t.includes("electr") || t.includes("panel") || t.includes("wiring") || t.includes("outlet") || t.includes("gfci") || t.includes("circuit"))
                                                             reason = "Electrical issues affect the Electrical score";
  else if (t.includes("plumb") || t.includes("pipe") || t.includes("water heater") || t.includes("sewer") || t.includes("toilet") || t.includes("sink"))
                                                             reason = "Plumbing condition affects the Plumbing score";
  else if (t.includes("hvac") || t.includes("heat") || t.includes("cool") || t.includes("furnace") || t.includes("duct"))
                                                             reason = "HVAC condition affects the Heating & Cooling score";
  else if (t.includes("safety") || t.includes("smoke") || t.includes("carbon") || t.includes("mold") || t.includes("radon") || t.includes("asbestos") || t.includes("lead") || t.includes("pest") || t.includes("termite"))
                                                             reason = "Safety & environmental hazards affect the Safety score";
  else if (t.includes("window") || t.includes("door") || t.includes("floor") || t.includes("ceiling") || t.includes("interior") || t.includes("stair"))
                                                             reason = "Interior condition affects the Interior score";
  else if (t.includes("appliance") || t.includes("washer") || t.includes("dryer") || t.includes("dishwasher") || t.includes("oven") || t.includes("range"))
                                                             reason = "Appliance condition affects the Appliances score";
  else if (t.includes("exterior") || t.includes("siding") || t.includes("fascia") || t.includes("soffit") || t.includes("grading"))
                                                             reason = "Exterior condition affects the Roof & Drainage score";

  const sev = (severity || "").toLowerCase();
  if (sev === "critical") return { affects: true, level: "high",   color: "#ef4444", bg: "rgba(239,68,68,0.10)",   label: "High Impact",   reason };
  if (sev === "warning")  return { affects: true, level: "medium", color: "#f97316", bg: "rgba(249,115,22,0.10)", label: "Medium Impact", reason };
  return                         { affects: true, level: "low",    color: "#eab308", bg: "rgba(234,179,8,0.12)",   label: "Low Impact",    reason };
}

// Maps a raw finding category to a broader display group key
function toGroupKey(category: string): string {
  const t = category.toLowerCase();
  if (t.includes("roof"))                                                       return "roof";
  if (t.includes("garage"))                                                     return "garage";
  if (t.includes("exterior") || t.includes("siding") || t.includes("deck") ||
      t.includes("patio") || t.includes("fence") || t.includes("driveway") ||
      t.includes("walkway") || t.includes("cladding"))                         return "exterior";
  if (t.includes("plumb") || t.includes("sink") || t.includes("drain") ||
      t.includes("toilet") || t.includes("pipe") || t.includes("water heater") ||
      t.includes("sewer") || t.includes("hose bibb"))                          return "plumbing";
  if (t.includes("electric") || t.includes("panel") || t.includes("outlet") ||
      t.includes("wiring") || t.includes("gfci") || t.includes("circuit"))    return "electrical";
  if (t.includes("hvac") || t.includes("heat") || t.includes("cool") ||
      t.includes("furnace") || t.includes("ductwork") || t.includes("air handler") ||
      t.includes(" ac ") || t.includes("thermostat"))                          return "hvac";
  if (t.includes("found") || t.includes("crawl") || t.includes("basement") ||
      t.includes("structural") || t.includes("settling"))                      return "foundation";
  if (t.includes("attic") || t.includes("insul"))                             return "attic";
  if (t.includes("window") || t.includes("door"))                             return "windows";
  if (t.includes("appliance") || t.includes("washer") || t.includes("dryer") ||
      t.includes("dishwasher") || t.includes("oven") || t.includes("stove") ||
      t.includes("refrigerator") || t.includes("range") || t.includes("hood"))return "appliances";
  if (t.includes("safety") || t.includes("smoke") || t.includes("carbon") ||
      t.includes("radon") || t.includes("pest") || t.includes("termite") ||
      t.includes("mold") || t.includes("bug"))                                 return "safety";
  if (t.includes("interior") || t.includes("floor") || t.includes("ceiling") ||
      t.includes("stair") || t.includes("handrail") || t.includes("paint"))   return "interior";
  return "general";
}

// Display label + icon for each group key
const GROUP_META: Record<string, { label: string; iconFn: (color: string) => React.ReactNode }> = {
  roof:       { label: "Roof",            iconFn: c => <HomeIcon    size={16} color={c}/> },
  exterior:   { label: "Exterior",        iconFn: c => <Shield      size={16} color={c}/> },
  garage:     { label: "Garage",          iconFn: c => <HomeIcon    size={16} color={c}/> },
  plumbing:   { label: "Plumbing",        iconFn: c => <Droplets    size={16} color={c}/> },
  electrical: { label: "Electrical",      iconFn: c => <Zap         size={16} color={c}/> },
  hvac:       { label: "HVAC",            iconFn: c => <Wind        size={16} color={c}/> },
  foundation: { label: "Foundation",      iconFn: c => <Activity    size={16} color={c}/> },
  attic:      { label: "Attic",           iconFn: c => <HomeIcon    size={16} color={c}/> },
  windows:    { label: "Windows & Doors", iconFn: c => <Eye         size={16} color={c}/> },
  appliances: { label: "Appliances",      iconFn: c => <Wrench      size={16} color={c}/> },
  safety:     { label: "Safety",          iconFn: c => <AlertTriangle size={16} color={c}/> },
  interior:   { label: "Interior",        iconFn: c => <HomeIcon    size={16} color={c}/> },
  general:    { label: "General",         iconFn: c => <Wrench      size={16} color={c}/> },
};

/** Human-readable display label for any raw category key or free-form string. */
function categoryLabel(category: string): string {
  return GROUP_META[toGroupKey(category)]?.label ?? formatLabel(category);
}

/** Consistent, user-facing severity label. */
function severityLabel(severity?: string | null): string {
  switch (severity) {
    case "critical": return "High Priority";
    case "warning":  return "Medium Priority";
    default:         return "Informational";
  }
}

/**
 * Converts any raw DB key or AI string to a human-readable label.
 * Used everywhere user-facing text might contain underscores or raw system keys.
 * Examples: "pool_spa" → "Pool & Spa", "hvac" → "HVAC", "safety_environmental" → "Safety & Environmental"
 */
function formatLabel(raw: string | undefined | null): string {
  if (!raw) return "General";
  // Try GROUP_META lookup first (covers all canonical BTLR display groups)
  const groupKey = toGroupKey(raw);
  if (GROUP_META[groupKey] && groupKey !== "general") {
    return GROUP_META[groupKey].label;
  }
  // Exact overrides for canonical DB category keys not covered by GROUP_META
  const LABEL_OVERRIDES: Record<string, string> = {
    pool_spa:                  "Pool & Spa",
    safety_environmental:      "Safety & Environmental",
    safety_security:           "Safety & Security",
    hvac:                      "HVAC",
    structure_foundation:      "Foundation",
    roof_drainage_exterior:    "Roof & Drainage",
    interior_windows_doors:    "Interior & Windows",
    appliances_water_heater:   "Appliances",
    site_grading_drainage:     "Site & Drainage",
    maintenance_upkeep:        "Maintenance",
    not_sure:                  "Not Sure",
    open:                      "Open",
    completed:                 "Completed",
    monitored:                 "Monitoring",
    dismissed:                 "Dismissed",
  };
  const key = raw.toLowerCase().trim();
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  // Generic fallback: replace underscores/hyphens with spaces, title-case each word
  return raw
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// Findings are "active" if status is open, not_sure, or not yet set
// index = position in the global allFindings array
function isActiveFinding(finding: Finding, index: number, statuses: Record<string, FindingStatus>): boolean {
  const key = findingKey(finding, index);
  const status = statuses[key] ?? "open";
  return status === "open" || status === "not_sure";
}

// ── Deterministic Health Score Engine ────────────────────────────────────

interface ScoreDeduction {
  id:        string;
  category:  string;
  reason:    string;
  points:    number;          // always negative
  source:    "finding" | "system_age";
  severity?: string;          // "critical" | "warning" | "info"
}

interface ScoreBreakdown {
  score:              number;
  deductions:         ScoreDeduction[];  // active — subtract from 100
  resolvedDeductions: ScoreDeduction[];  // removed by repairs — shown as restored
  totalDeducted:      number;
}

// Pure function — same inputs always produce the same score
function computeHealthScore(
  allFindings:  Finding[],
  statuses:     Record<string, FindingStatus>,
  roofYear:     string,
  hvacYear:     string,
  currentYear:  number,
): ScoreBreakdown {
  const deductions:         ScoreDeduction[] = [];
  const resolvedDeductions: ScoreDeduction[] = [];

  function add(ded: ScoreDeduction, isResolved: boolean) {
    (isResolved ? resolvedDeductions : deductions).push(ded);
  }

  // A. System age deductions ─────────────────────────────────────────
  const roofAge = roofYear ? currentYear - Number(roofYear) : null;
  const hvacAge = hvacYear ? currentYear - Number(hvacYear) : null;

  if (roofAge !== null) {
    let pts = 0, note = "";
    if      (roofAge >= 25) { pts = -12; note = `${roofAge} yrs old — past 25yr lifespan`;       }
    else if (roofAge >= 19) { pts = -7;  note = `${roofAge} yrs old — approaching end of life`;  }
    else if (roofAge >= 13) { pts = -3;  note = `${roofAge} yrs old — aging`;                    }
    if (pts !== 0) {
      const resolved = statuses[toCategoryKey("Roof")] === "completed" || statuses[toCategoryKey("Roof")] === "dismissed";
      add({ id: "age_roof", category: "Roof", reason: `Roof: ${note}`, points: pts, source: "system_age" }, resolved);
    }
  }

  if (hvacAge !== null) {
    let pts = 0, note = "";
    if      (hvacAge >= 15) { pts = -10; note = `${hvacAge} yrs old — past 15yr lifespan`;      }
    else if (hvacAge >= 12) { pts = -7;  note = `${hvacAge} yrs old — nearing end of life`;     }
    else if (hvacAge >= 8)  { pts = -3;  note = `${hvacAge} yrs old — aging`;                   }
    if (pts !== 0) {
      const resolved = statuses[toCategoryKey("HVAC")] === "completed" || statuses[toCategoryKey("HVAC")] === "dismissed";
      add({ id: "age_hvac", category: "HVAC", reason: `HVAC: ${note}`, points: pts, source: "system_age" }, resolved);
    }
  }

  // B. Finding deductions — ONE deduction per system, not per finding ────
  //
  // Root-cause of the "score = 8" bug: the old logic looped over every critical
  // finding and subtracted -15 each. A rich 25-finding report with 8 criticals
  // across 6 categories produced -120 from criticals alone, crushing the score
  // to 0 before age deductions even ran.
  //
  // Fix: deduct once per *system* (category group), then apply a hard total cap
  // so richer inspection data never catastrophically penalises a normal home.
  //
  //   Critical system  : -8  (regardless of how many criticals are in it)
  //   Warning system   : -3  (system has ≥1 warning but no criticals)
  //   Info-only system : -1
  //   Total cap        : -60  (score floor = 40 for the absolute worst homes)

  const byKey = new Map<string, { f: Finding; idx: number }[]>();
  for (let i = 0; i < allFindings.length; i++) {
    const f = allFindings[i];
    const k = toCategoryKey(f.category);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({ f, idx: i });
  }

  for (const [key, items] of byKey.entries()) {
    const findings = items.map(it => it.f);
    const category = findings[0].category;

    const criticalItems = items.filter(it => it.f.severity === "critical");
    const ncItems       = items.filter(it => it.f.severity !== "critical");
    const criticals     = criticalItems.map(it => it.f);
    const ncs           = ncItems.map(it => it.f);

    // Resolve each severity group independently:
    //   critical deduction clears when ALL critical findings in that category are done
    //   non-critical deduction clears when ALL non-critical findings are done
    // This way marking all the critical issues resolved removes the -8 even if
    // minor warnings remain, and vice versa.
    const criticalsResolved = criticalItems.length > 0 && criticalItems.every(it => {
      const s = statuses[findingKey(it.f, it.idx)] ?? "open";
      return s === "completed" || s === "dismissed";
    });
    const ncsResolved = ncItems.length > 0 && ncItems.every(it => {
      const s = statuses[findingKey(it.f, it.idx)] ?? "open";
      return s === "completed" || s === "dismissed";
    });

    // One deduction for the whole system if it has any critical findings
    if (criticals.length > 0) {
      const desc = criticals.length === 1
        ? (criticals[0].description.length > 72 ? criticals[0].description.slice(0, 72) + "…" : criticals[0].description)
        : `${criticals.length} critical issues — ${category}`;
      add({ id: `crit_${key}`, category, reason: desc, points: -8, source: "finding", severity: "critical" }, criticalsResolved);
    }

    // One deduction for the whole system for non-critical findings
    if (ncs.length > 0) {
      const hasWarning = ncs.some(f => f.severity === "warning");
      const pts = hasWarning ? -3 : -1;
      const sev = hasWarning ? "warning" : "info";
      const desc = ncs.length === 1
        ? (ncs[0].description.length > 72 ? ncs[0].description.slice(0, 72) + "…" : ncs[0].description)
        : `${ncs.length} issue${ncs.length > 1 ? "s" : ""} in ${category}`;
      add({ id: `nc_${key}`, category, reason: desc, points: pts, source: "finding", severity: sev }, ncsResolved);
    }
  }

  // Hard cap: total deductions cannot exceed -60 regardless of finding count.
  // This prevents a richer inspection report from producing a lower score than
  // a sparse one — the cap ensures the score reflects home condition, not data volume.
  const rawDeductions = deductions.reduce((sum, d) => sum + d.points, 0);
  const totalDeducted = Math.max(-60, rawDeductions);
  const score         = Math.max(0, Math.min(100, 100 + totalDeducted));
  return { score, deductions, resolvedDeductions, totalDeducted };
}

// ── Vendor key normalizer ─────────────────────────────────────────────────
// Maps any trade label / finding category to a VendorsView category key
function toVendorKey(trade: string): string {
  const t = trade.toLowerCase();
  if (t.includes("roof"))                                                    return "roofing";
  if (t.includes("plumb") || t.includes("sink") || t.includes("drain") ||
      t.includes("toilet") || t.includes("pipe"))                            return "plumbing";
  if (t.includes("electric") || t.includes("outlet") || t.includes("wiring") ||
      t.includes("panel"))                                                   return "electrical";
  if (t.includes("hvac") || t.includes("heat") || t.includes("cool") ||
      t.includes("furnace") || t.includes("ac") || t.includes("air"))       return "hvac";
  if (t.includes("pest") || t.includes("termite") || t.includes("bug") ||
      t.includes("rodent"))                                                  return "pest";
  if (t.includes("found") || t.includes("struct") || t.includes("crack") ||
      t.includes("settling"))                                                return "foundation";
  if (t.includes("mold") || t.includes("water intrusion") ||
      t.includes("moisture") || t.includes("waterproof"))                   return "mold";
  if (t.includes("window") || t.includes("door") || t.includes("seal"))    return "windows";
  if (t.includes("insul"))                                                   return "insulation";
  if (t.includes("floor"))                                                   return "flooring";
  if (t.includes("paint"))                                                   return "painting";
  return "general";
}

interface CostItem {
  label: string;
  horizon: string;
  amount: number;
  severity: string;
  finding?: Finding;
  systemAge?: number;
  tradeCategory?: string;
  bucket?: "known" | "risk" | "maintenance"; // which of the 3 calculation buckets
  probability?: number;                       // 0–1, for risk bucket items
  isEstimate?: boolean;                       // true = probability-weighted, not a firm cost
}

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  bg:       "#F7F2EC",   // warm linen
  surface:  "#FFFFFF",   // card white
  surface2: "#EDE5D4",   // warm gray for subtle sections
  navy:     "#1B2D47",   // dark navy (sidebar, headings)
  accent:   "#2C5F8A",   // steel blue
  accentDk: "#1E4568",   // darker steel blue for hover/active
  accentLt: "#5C8FB8",   // light steel blue for subtle tints
  accentBg: "rgba(44,95,138,0.08)", // tint bg
  text:     "#1C1914",   // warm near-black
  text2:    "#4A453E",   // warm medium
  text3:    "#6B6558",   // warm muted
  border:   "rgba(28,25,20,0.08)", // warm border
  green:    "#2D6A4F",
  greenBg:  "#F0FAF4",
  amber:    "#92400E",
  amberBg:  "#FFFBEB",
  red:      "#991B1B",
  redBg:    "#FEF2F2",
};

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.surface, borderRadius: 16,
    border: `1px solid ${C.border}`,
    boxShadow: "0 1px 4px rgba(15,31,61,0.06), 0 4px 16px rgba(15,31,61,0.04)",
    padding: 26, ...extra,
  };
}

function systemStatus(age: number | null, warn: number, crit: number) {
  if (age === null) return { label: "Unknown",      color: C.text3, bg: C.bg,      dot: C.text3 };
  if (age >= crit)  return { label: "Replace Soon", color: C.red,   bg: C.redBg,   dot: C.red   };
  if (age >= warn)  return { label: "Aging",        color: C.amber, bg: C.amberBg, dot: C.amber };
  return                   { label: "Good",         color: C.green, bg: C.greenBg, dot: C.green };
}

// ── Trade category → vendor search mapping ────────────────────────────────
const TRADE_MAP: Record<string, string> = {
  roof:        "Roofing",
  roofing:     "Roofing",
  hvac:        "HVAC",
  heating:     "HVAC",
  cooling:     "HVAC",
  electrical:  "Electrical",
  electric:    "Electrical",
  plumbing:    "Plumbing",
  plumber:     "Plumbing",
  foundation:  "Foundation",
  mold:        "Mold Remediation",
  pest:        "Pest Control",
  termite:     "Pest Control",
  window:      "Windows & Doors",
  door:        "Windows & Doors",
  insulation:  "Insulation",
  waterproof:  "Waterproofing",
  flooring:    "Flooring",
  painting:    "Painting",
  general:     "General Contractor",
};

function tradeForCategory(category: string): string {
  const key = category.toLowerCase();
  for (const [k, v] of Object.entries(TRADE_MAP)) {
    if (key.includes(k)) return v;
  }
  return "General Contractor";
}

// ── Title Case Helper ────────────────────────────────────────────────────────
function toTitleCase(str: string): string {
  if (!str || str === "My Home") return str;
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .replace(/\b(Ca|Fl|Tx|Ny|Az|Co|Wa|Or|Nv|Ut|Id|Mt|Wy|Nd|Sd|Ne|Ks|Ok|Mn|Ia|Mo|Wi|Il|In|Mi|Oh|Ky|Tn|Ms|Al|Ga|Sc|Nc|Va|Wv|Md|De|Nj|Pa|Ny|Ct|Ri|Ma|Vt|Nh|Me|Ak|Hi)\b/g, m => m.toUpperCase());
}

// ── House Photo ───────────────────────────────────────────────────────────
function HousePhoto({ address, height = 200 }: { address: string; height?: number }) {
  // "streetview" → try Street View; on fail → "satellite" → try Maps Static;
  // on fail → "none" → show SVG only
  const [imgMode, setImgMode] = useState<"streetview" | "satellite" | "none">("streetview");
  const mapsKey    = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  const hasKey     = mapsKey?.startsWith("AIza");
  const hasAddress = address && address !== "My Home" && address.length > 5;
  const encoded    = hasAddress ? encodeURIComponent(address) : null;

  // Reset mode whenever address changes so a new property always tries Street View first
  useEffect(() => { setImgMode("streetview"); }, [address]);

  // Street View Static API — max size per dimension is 640px (hard Google limit).
  // Requesting larger than 640 causes an API error, which is why the image failed before.
  // objectFit:cover handles scaling to fill any container size.
  const streetViewUrl = hasKey && encoded && imgMode === "streetview"
    ? `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${encoded}&key=${mapsKey}&fov=90&pitch=5&source=outdoor&return_error_code=true`
    : null;

  // Maps Static API (satellite/hybrid) — fallback when Street View has no coverage
  const satelliteUrl = hasKey && encoded && imgMode === "satellite"
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=19&size=640x400&maptype=hybrid&key=${mapsKey}`
    : null;

  // Keep legacy variable name for the label below
  const hasRealKey = hasKey;

  const FallbackHouse = () => (
    <svg viewBox="0 0 900 200" style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2D47"/><stop offset="100%" stopColor="#2C5F8A"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2C5F8A" stopOpacity="0"/>
          <stop offset="50%" stopColor="#2C5F8A" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#2C5F8A" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect width="900" height="200" fill="url(#sky)"/>
      <rect width="900" height="200" fill="url(#glow)"/>
      <rect x="0" y="170" width="900" height="30" fill="rgba(255,255,255,0.05)"/>
      <rect x="280" y="90" width="340" height="80" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <polygon points="270,92 450,30 630,92" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <rect x="428" y="130" width="44" height="40" rx="3" fill="rgba(44,95,138,0.35)" stroke="rgba(44,95,138,0.5)" strokeWidth="1"/>
      <rect x="305" y="108" width="60" height="42" rx="3" fill="rgba(44,95,138,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
      <line x1="335" y1="108" x2="335" y2="150" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <line x1="305" y1="129" x2="365" y2="129" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <rect x="535" y="108" width="60" height="42" rx="3" fill="rgba(44,95,138,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
      <line x1="565" y1="108" x2="565" y2="150" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <line x1="535" y1="129" x2="595" y2="129" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <rect x="80" y="110" width="160" height="60" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      <polygon points="72,112 160,70 248,112" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      <rect x="660" y="105" width="160" height="65" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      <polygon points="652,107 740,62 828,107" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      <line x1="0" y1="170" x2="900" y2="170" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
    </svg>
  );

  return (
    <div style={{ width: "100%", height, borderRadius: 14, overflow: "hidden", position: "relative",
      background: `linear-gradient(135deg, ${C.navy} 0%, ${C.accentDk} 60%, ${C.accent} 100%)` }}>
      <FallbackHouse />
      {streetViewUrl && (
        <img src={streetViewUrl} alt={address}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgMode("satellite")} />
      )}
      {satelliteUrl && (
        <img src={satelliteUrl} alt={address}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgMode("none")} />
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
        background: "linear-gradient(transparent, rgba(10,20,45,0.92))",
        padding: "32px 20px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <MapPin size={14} color="rgba(255,255,255,0.6)"/>
        <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.2px" }}>
          {hasAddress ? address : "Add your address in Settings"}
        </span>
        {!hasRealKey && hasAddress && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>
            Add Google Maps key for street photo
          </span>
        )}
      </div>
    </div>
  );
}

// ── Inspection Review Modal ───────────────────────────────────────────────
// Shown after inspection upload — lets user mark findings as completed/open/not_sure
function InspectionReviewModal({
  findings,
  initialStatuses,
  saving,
  onSave,
  onSkip,
}: {
  findings: Finding[];
  initialStatuses: Record<string, FindingStatus>;
  saving: boolean;
  onSave: (statuses: Record<string, FindingStatus>) => void;
  onSkip: () => void;
}) {
  const [localStatuses, setLocalStatuses] = useState<Record<string, FindingStatus>>(() => {
    const init: Record<string, FindingStatus> = {};
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const key = findingKey(f, i);
      init[key] = initialStatuses[key] ?? "open";
    }
    return init;
  });

  function setStatus(index: number, finding: Finding, status: FindingStatus) {
    setLocalStatuses(prev => ({ ...prev, [findingKey(finding, index)]: status }));
  }

  const completedCount = Object.values(localStatuses).filter(s => s === "completed" || s === "dismissed").length;

  const statusOptions: { value: FindingStatus; label: string; bg: string; color: string }[] = [
    { value: "completed",  label: "Already Fixed",  bg: C.greenBg, color: C.green  },
    { value: "open",       label: "Still Needed",   bg: C.redBg,   color: C.red    },
    { value: "not_sure",   label: "Not Sure",       bg: C.amberBg, color: C.amber  },
    { value: "monitored",  label: "Monitoring",     bg: "#eff6ff",  color: C.accent },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,31,61,0.7)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px 16px",
    }}>
      <div style={{
        background: C.surface, borderRadius: 20, maxWidth: 640, width: "100%",
        maxHeight: "85vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(15,31,61,0.35)",
      }}>
        {/* Header */}
        <div style={{ padding: "24px 28px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <CheckCircle2 size={20} color={C.green}/>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
              Inspection Analyzed — Review Your Findings
            </h2>
          </div>
          <p style={{ fontSize: 14, color: C.text3, margin: 0, lineHeight: 1.5 }}>
            Have any of these been completed after the inspection was completed?
            Your answers update your Home Health Score to reflect current reality.
          </p>
        </div>

        {/* Findings list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {findings.map((finding, i) => {
            const key = findingKey(finding, i);
            const currentStatus = localStatuses[key] ?? "open";
            const sevColor = finding.severity === "critical" ? C.red : finding.severity === "warning" ? C.amber : C.text3;

            return (
              <div key={i} style={{
                background: currentStatus === "completed" || currentStatus === "dismissed"
                  ? C.greenBg : C.bg,
                border: `1px solid ${currentStatus === "completed" || currentStatus === "dismissed" ? "#bbf7d0" : C.border}`,
                borderRadius: 12, padding: "14px 16px", marginBottom: 10,
                transition: "all 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", background: sevColor,
                    flexShrink: 0, marginTop: 5,
                  }}/>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: C.text, margin: "0 0 3px" }}>
                      {GROUP_META[toGroupKey(finding.category)]?.label ?? finding.category}
                      {finding.estimated_cost ? (
                        <span style={{ fontWeight: 500, fontSize: 13, color: C.text3, marginLeft: 8 }}>
                          ~${finding.estimated_cost.toLocaleString()}
                        </span>
                      ) : null}
                    </p>
                    <p style={{ fontSize: 12, color: C.text2, margin: 0, lineHeight: 1.5 }}>
                      {finding.description}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {statusOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(i, finding, opt.value)}
                      style={{
                        padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", border: `1.5px solid ${currentStatus === opt.value ? opt.color : C.border}`,
                        background: currentStatus === opt.value ? opt.bg : "transparent",
                        color: currentStatus === opt.value ? opt.color : C.text3,
                        transition: "all 0.12s",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "10px 24px 4px", borderTop: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 12, color: C.text3, margin: 0, lineHeight: 1.5 }}>
            To see the full list of all repairs, click the <strong style={{ color: C.accent }}>Repairs tab</strong>.
          </p>
        </div>
        <div style={{
          padding: "10px 24px 18px",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          {completedCount > 0 && (
            <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>
              <CheckCircle2 size={13} style={{ verticalAlign: "middle", marginRight: 4 }}/>
              {completedCount} issue{completedCount > 1 ? "s" : ""} marked resolved
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button onClick={onSkip} style={{
              padding: "10px 18px", borderRadius: 10, border: `1.5px solid ${C.border}`,
              background: "transparent", color: C.text3, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
              Skip for now
            </button>
            <button onClick={() => onSave(localStatuses)} disabled={saving} style={{
              padding: "10px 22px", borderRadius: 10, background: C.accent,
              border: "none", color: "white", fontSize: 14, fontWeight: 700,
              cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              {saving ? <><Loader2 size={13} className="animate-spin"/> Saving…</> : "Save & Update Score"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Health Score Modal ────────────────────────────────────────────────────
// ── Score Dimensions with click-to-reveal info panels ───────────────────────
const DIMENSION_INFO: Record<string, { what: string; how: string }> = {
  Safety: {
    what: "Measures exposure to health and safety hazards — electrical issues, gas leaks, mold, structural risks, and missing safety devices.",
    how:  "Starts at 100. Each safety-related finding deducts points based on severity: critical hazards (−30), high (−18), medium (−8), low (−3). A score of 100 means no safety concerns were found.",
  },
  Readiness: {
    what: "How prepared your home is for the unexpected — aging systems, deferred maintenance, and conditions that could quickly escalate into costly emergencies.",
    how:  "Starts at 100. Deductions for systems near end-of-life (−8 each), active safety risks (−10), deferred maintenance (−6), and moisture or leak indicators (−8). Higher means fewer near-term risk factors.",
  },
  Maintenance: {
    what: "Reflects how well the home has been maintained over time — routine upkeep, servicing, and preventative care across all major systems.",
    how:  "Baseline of 85. Adjusted up for well-maintained systems (+4) and down for deferred (−8) or poor maintenance (−15). Reflects the cumulative care history across all findings.",
  },
  Confidence: {
    what: "How complete and reliable the data behind your score is — based on inspection coverage, document quality, and how many systems were actually observed.",
    how:  "Average inspector confidence across all findings (0–100%). Low confidence means some areas had limited data and scores are blended toward a neutral baseline of 72. Upload more inspection documents to raise this.",
  },
};

function RichScoreDimensions({ report }: { report: HomeHealthReport }) {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const dims = [
    { label: "Safety",      val: report.safety_score,      color: report.safety_score >= 80 ? C.green : report.safety_score >= 60 ? C.amber : C.red },
    { label: "Readiness",   val: report.readiness_score,   color: report.readiness_score >= 80 ? C.green : report.readiness_score >= 60 ? C.amber : C.red },
    { label: "Maintenance", val: report.maintenance_score, color: report.maintenance_score >= 80 ? C.green : report.maintenance_score >= 60 ? C.amber : C.red },
    { label: "Confidence",  val: report.confidence_score,  color: C.text2 },
  ];

  return (
    <div style={{ padding: "18px 28px", borderTop: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>Score Dimensions</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {dims.map(({ label, val, color }) => {
          const isOpen = activeTooltip === label;
          const info = DIMENSION_INFO[label];
          return (
            <div key={label} style={{ background: C.bg, borderRadius: 10, border: `1px solid ${isOpen ? C.accent : C.border}`, overflow: "hidden", transition: "border-color 0.15s" }}>
              {/* Card header */}
              <div style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>{label}</p>
                  <button
                    onClick={() => setActiveTooltip(isOpen ? null : label)}
                    style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: isOpen ? C.accent : C.border,
                      border: "none", cursor: "pointer", padding: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "background 0.15s",
                    }}
                    aria-label={`Info about ${label} score`}
                  >
                    <span style={{ fontSize: 9, fontWeight: 800, color: isOpen ? "white" : C.text3, lineHeight: 1 }}>i</span>
                  </button>
                </div>
                <p style={{ fontSize: 22, fontWeight: 800, color, margin: 0, letterSpacing: "-0.5px" }}>
                  {val}<span style={{ fontSize: 12, fontWeight: 400, color: C.text3 }}>/100</span>
                </p>
              </div>
              {/* Expandable info panel */}
              {isOpen && info && (
                <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${C.accent}22`, background: `${C.accent}08` }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, margin: "0 0 4px" }}>What it measures</p>
                  <p style={{ fontSize: 11, color: C.text2, margin: "0 0 8px", lineHeight: 1.5 }}>{info.what}</p>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, margin: "0 0 4px" }}>How it&apos;s calculated</p>
                  <p style={{ fontSize: 11, color: C.text2, margin: 0, lineHeight: 1.5 }}>{info.how}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthScoreModal({
  breakdown, roofYear, hvacYear, year, homeHealthReport, onClose, onFindVendors,
}: {
  breakdown:         ScoreBreakdown;
  roofYear:          string;
  hvacYear:          string;
  year:              number;
  homeHealthReport?: HomeHealthReport | null;
  onClose:           () => void;
  onFindVendors:     (trade: string, context?: string, issue?: string) => void;
}) {
  const { score, deductions, resolvedDeductions } = breakdown;
  const st         = healthStatusInfo(score);
  const scoreColor = score >= 90 ? "#22c55e" : score >= 80 ? "#84cc16" : score >= 65 ? C.amber : score >= 50 ? "#f97316" : C.red;

  const roofAge = roofYear ? year - Number(roofYear) : null;
  const hvacAge = hvacYear ? year - Number(hvacYear) : null;

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  function sourceBadge(d: ScoreDeduction) {
    if (d.source === "system_age")    return { label: "System Age",  color: C.amber, bg: C.amberBg };
    if (d.severity === "critical")    return { label: "Critical",    color: C.red,   bg: C.redBg   };
    if (d.severity === "warning")     return { label: "Warning",     color: C.amber, bg: C.amberBg };
    return                                   { label: "Note",        color: C.text3, bg: C.bg      };
  }

  function systemIcon(category: string) {
    const k = category.toLowerCase();
    if (k.includes("roof"))                           return <HomeIcon  size={15} color={C.text3}/>;
    if (k.includes("hvac") || k.includes("heat") ||
        k.includes("cool") || k.includes("air"))      return <Wind      size={15} color={C.text3}/>;
    if (k.includes("plumb") || k.includes("water"))   return <Droplets  size={15} color={C.text3}/>;
    if (k.includes("electric"))                       return <Zap       size={15} color={C.text3}/>;
    if (k.includes("pest") || k.includes("mold") ||
        k.includes("bug"))                            return <Bug       size={15} color={C.text3}/>;
    if (k.includes("window") || k.includes("door"))  return <Eye       size={15} color={C.text3}/>;
    return                                                   <Wrench    size={15} color={C.text3}/>;
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,31,61,0.6)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "40px 20px",
    }} onClick={onClose}>
      <div style={{
        background: C.surface, borderRadius: 20, width: "100%", maxWidth: 660,
        boxShadow: "0 20px 60px rgba(15,31,61,0.25)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{ background: C.navy, padding: "24px 28px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Home Health Score</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 58, fontWeight: 800, color: scoreColor, lineHeight: 1, letterSpacing: "-2px" }}>{score}</span>
              <span style={{ fontSize: 18, color: "rgba(255,255,255,0.35)", alignSelf: "flex-end", marginBottom: 4 }}>/100</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, padding: "4px 14px", borderRadius: 20, color: st.tagColor, background: `${st.tagColor}25` }}>
              {st.label}
            </span>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "10px 0 0", lineHeight: 1.5, maxWidth: 380 }}>{st.desc}</p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, padding: 8, cursor: "pointer", color: "white", flexShrink: 0 }}>
            <X size={18}/>
          </button>
        </div>

        {/* ── Score Dimensions + System Health (shown first) ─────────── */}
        {homeHealthReport && (
          <>
            <RichScoreDimensions report={homeHealthReport} />
            {homeHealthReport.category_scores.some(cs => !cs.limited_data) && (
              <div style={{ padding: "18px 28px", borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>System Health</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {homeHealthReport.category_scores
                    .filter(cs => !cs.limited_data)
                    .sort((a, b) => a.score - b.score)
                    .map(cs => {
                      const barColor = cs.score >= 80 ? C.green : cs.score >= 65 ? C.amber : C.red;
                      const label = cs.category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
                      return (
                        <div key={cs.category}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 12, color: C.text2, fontWeight: 500 }}>{label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{cs.score}</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${cs.score}%`, background: barColor, borderRadius: 3, transition: "width 0.8s ease" }}/>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Score Breakdown ──────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${C.border}` }}>
          {/* Clickable header */}
          <button
            onClick={() => setBreakdownOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 28px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>Score Breakdown</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{score} / 100</span>
              <ChevronRight size={15} color={C.text3} style={{ transform: breakdownOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}/>
            </div>
          </button>

          {/* Collapsible content */}
          {breakdownOpen && (
            <div style={{ padding: "0 28px 20px" }}>
              {/* Starting score row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: C.text2 }}>Starting score</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>100</span>
              </div>

              {/* Deduction rows — color-coded cards */}
              {deductions.length === 0 ? (
                <p style={{ fontSize: 13, color: C.green, display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
                  <CheckCircle2 size={14}/> No active deductions — great shape!
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  {deductions.map((d, i) => {
                    const badge = sourceBadge(d);
                    return (
                      <div key={i} style={{
                        background: d.severity === "critical" ? C.redBg : C.bg,
                        border: `1px solid ${d.severity === "critical" ? "#fecaca" : C.border}`,
                        borderRadius: 10, padding: "10px 14px",
                        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 7, background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                            {systemIcon(d.category)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{d.category}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: badge.color, background: badge.bg }}>
                                {badge.label}
                              </span>
                            </div>
                            <p style={{ fontSize: 12, color: C.text2, margin: 0, lineHeight: 1.5 }}>{d.reason}</p>
                            <button
                              onClick={() => { onClose(); onFindVendors(d.category, d.category, d.reason); }}
                              style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}>
                              <Users size={10}/> Find Vendors →
                            </button>
                          </div>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: C.red, flexShrink: 0 }}>{d.points}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Final score row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Final score</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor }}>{score} / 100</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Resolved / Restored ──────────────────────────────────────── */}
        {resolvedDeductions.length > 0 && (
          <div style={{ padding: "18px 28px", borderBottom: `1px solid ${C.border}`, background: C.greenBg }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 5 }}>
              <CheckCircle2 size={12}/> Resolved — Deductions Removed
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {resolvedDeductions.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < resolvedDeductions.length - 1 ? `1px solid #bbf7d0` : "none" }}>
                  <CheckCircle2 size={13} color={C.green} style={{ flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.category}</span>
                    <span style={{ fontSize: 12, color: C.text3, marginLeft: 8 }}>repair confirmed</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>+{Math.abs(d.points)} restored</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── System Snapshot ──────────────────────────────────────────── */}
        {(roofAge !== null || hvacAge !== null) && (
          <div style={{ padding: "18px 28px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>System Snapshot</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {roofAge !== null && (
                <div style={{ flex: 1, minWidth: 120, background: C.bg, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <HomeIcon size={13} color={C.text3}/><span style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Roof</span>
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: "0 0 2px", letterSpacing: "-0.5px" }}>{roofAge} yrs</p>
                  <p style={{ fontSize: 11, color: systemStatus(roofAge, 20, 25).color, margin: 0, fontWeight: 600 }}>{systemStatus(roofAge, 20, 25).label}</p>
                </div>
              )}
              {hvacAge !== null && (
                <div style={{ flex: 1, minWidth: 120, background: C.bg, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Wind size={13} color={C.text3}/><span style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>HVAC</span>
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: "0 0 2px", letterSpacing: "-0.5px" }}>{hvacAge} yrs</p>
                  <p style={{ fontSize: 11, color: systemStatus(hvacAge, 10, 15).color, margin: 0, fontWeight: 600 }}>{systemStatus(hvacAge, 10, 15).label}</p>
                </div>
              )}
            </div>
          </div>
        )}
        {(roofAge === null && hvacAge === null && deductions.length === 0 && resolvedDeductions.length === 0) && !homeHealthReport && (
          <div style={{ padding: "24px 28px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: C.text3, margin: 0 }}>
              Upload an inspection report or enter system years in Settings to see your full breakdown.
            </p>
          </div>
        )}

        {/* ── Priority Actions + Strengths + Data Gaps ────────────────── */}
        {homeHealthReport && (
          <>
            {/* Priority actions */}
            {homeHealthReport.priority_actions.length > 0 && (
              <div style={{ padding: "18px 28px", borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>Priority Actions</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {homeHealthReport.priority_actions.slice(0, 5).map((action, i) => {
                    const urgencyColor = action.urgency === "Act now" ? C.red : action.urgency.includes("3 months") ? "#f97316" : C.amber;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: urgencyColor + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: urgencyColor }}>{i + 1}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, color: C.text, margin: "0 0 2px", lineHeight: 1.4, fontWeight: 500 }}>{action.issue}</p>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: urgencyColor, background: urgencyColor + "15", padding: "1px 7px", borderRadius: 10 }}>{action.urgency}</span>
                            {action.diy_possible && (
                              <span style={{ fontSize: 10, color: C.text3 }}>DIY possible</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Strengths + Watchlist */}
            {(homeHealthReport.strengths.length > 0 || homeHealthReport.watchlist.length > 0) && (
              <div style={{ padding: "18px 28px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 14, flexWrap: "wrap" }}>
                {homeHealthReport.strengths.length > 0 && (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 4 }}>
                      <CheckCircle2 size={11}/> Strengths
                    </p>
                    {homeHealthReport.strengths.map((s, i) => (
                      <p key={i} style={{ fontSize: 12, color: C.text2, margin: "0 0 4px", lineHeight: 1.4 }}>• {s}</p>
                    ))}
                  </div>
                )}
                {homeHealthReport.watchlist.length > 0 && (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={11}/> Watchlist
                    </p>
                    {homeHealthReport.watchlist.map((w, i) => (
                      <p key={i} style={{ fontSize: 12, color: C.text2, margin: "0 0 4px", lineHeight: 1.4 }}>• {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Data gaps */}
            {homeHealthReport.data_gaps.length > 0 && (
              <div style={{ padding: "12px 28px 18px", borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>Data Gaps</p>
                <p style={{ fontSize: 11, color: C.text3, margin: 0, lineHeight: 1.5 }}>
                  {homeHealthReport.data_gaps.slice(0, 3).join(" · ")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Score Ring SVG ────────────────────────────────────────────────────────
function ScoreRing({ score, color, size = 130 }: { score: number; color: string; size?: number }) {
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const strokeW = size * 0.09;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(score / 100, 1)) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={strokeW}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={size * 0.26} fontWeight="800" fontFamily="-apple-system, sans-serif"
        style={{ letterSpacing: "-1px" }}>
        {score}
      </text>
      <text x={cx} y={cy + size * 0.17} textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.4)" fontSize={size * 0.1} fontFamily="-apple-system, sans-serif">
        /100
      </text>
    </svg>
  );
}

function healthStatusInfo(score: number) {
  if (score >= 90) return { label: "Excellent",       tagColor: "#22c55e", tagBg: "rgba(34,197,94,0.18)",  desc: "Your home is in great shape. Keep up with routine maintenance." };
  if (score >= 80) return { label: "Good",            tagColor: "#84cc16", tagBg: "rgba(132,204,22,0.18)", desc: "Your home is healthy. A few items to monitor over time." };
  if (score >= 65) return { label: "Fair",            tagColor: "#f59e0b", tagBg: "rgba(245,158,11,0.18)", desc: "Some systems need attention. Review the breakdown for next steps." };
  if (score >= 50) return { label: "Needs Attention", tagColor: "#f97316", tagBg: "rgba(249,115,22,0.18)", desc: "Multiple issues need attention. Prioritize repairs to protect your home." };
  return                  { label: "Critical",        tagColor: "#ef4444", tagBg: "rgba(239,68,68,0.18)",  desc: "Immediate action needed. See the full breakdown to prioritize repairs." };
}

// ── Warranty coverage check ───────────────────────────────────────────────
function isLikelyCovered(category: string, coverageItems: string[]): boolean {
  const cat = category.toLowerCase();
  return coverageItems.some(item => {
    const it = item.toLowerCase();
    return it.includes(cat) || cat.includes(it.split(" ")[0]) ||
      (cat.includes("hvac") && (it.includes("heat") || it.includes("air") || it.includes("hvac") || it.includes("cool"))) ||
      (cat.includes("plumb") && it.includes("plumb")) ||
      (cat.includes("electric") && it.includes("electric")) ||
      (cat.includes("roof") && it.includes("roof")) ||
      (cat.includes("appliance") && it.includes("appliance"));
  });
}

// ── Repair Complete Modal ─────────────────────────────────────────────────
// Opens when the user clicks "Mark Complete" on a repair card.
// Captures: completion date, notes, optional receipt/photo.
// On confirm, the parent saves to Postgres + Storage and updates score.
function RepairCompleteModal({
  finding,
  onConfirm,
  onCancel,
  saving,
}: {
  finding: Finding;
  onConfirm: (data: { notes: string; completedAt: string; receiptFile?: File }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [notes, setNotes]           = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const impact = getScoreImpact(finding.category, finding.severity, finding.description);
  const isScoreable = finding.is_scorable ?? impact.affects;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(15,31,61,0.75)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px",
    }}>
      <div style={{
        background: C.surface, borderRadius: 20, maxWidth: 480, width: "100%",
        boxShadow: "0 24px 64px rgba(15,31,61,0.35)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: C.greenBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <CheckCircle2 size={18} color={C.green}/>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>Mark Repair Complete</h2>
            <p style={{ fontSize: 13, color: C.text3, margin: "3px 0 0" }}>{categoryLabel(finding.category)}</p>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Score impact notice */}
          {isScoreable && (
            <div style={{ background: C.greenBg, border: `1px solid ${C.green}30`, borderRadius: 10, padding: "10px 14px" }}>
              <p style={{ fontSize: 12, color: C.green, margin: 0, fontWeight: 600 }}>
                ✓ This repair affects your Home Health Score — marking it complete will improve your score.
              </p>
            </div>
          )}

          {/* Completion date */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Completion Date</label>
            <input
              type="date" value={completedAt}
              onChange={e => setCompletedAt(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, boxSizing: "border-box" }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Notes <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Vendor name, work performed, warranty info…"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, resize: "vertical", minHeight: 68, boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>

          {/* Receipt upload */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Receipt / Invoice <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
            {receiptFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.green}40`, background: C.greenBg }}>
                <FileText size={13} color={C.green}/>
                <span style={{ fontSize: 13, color: C.green, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{receiptFile.name}</span>
                <button onClick={() => { setReceiptFile(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ) : (
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, border: `1px dashed ${C.border}`, cursor: "pointer", background: C.bg }}>
                <CloudUpload size={14} color={C.text3}/>
                <span style={{ fontSize: 13, color: C.text3 }}>Upload receipt or invoice</span>
                <input ref={fileRef} type="file" style={{ display: "none" }} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) setReceiptFile(f); }}/>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
          <button onClick={onCancel} disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.text3, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ notes, completedAt, receiptFile: receiptFile ?? undefined })}
            disabled={saving}
            style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: C.green, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            {saving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
            {saving ? "Saving…" : "Confirm Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cost Detail Modal ─────────────────────────────────────────────────────
function CostDetailModal({
  item, findings, onClose, onFindVendors, warranty, insurance,
}: {
  item: CostItem;
  findings: Finding[];
  onClose: () => void;
  onFindVendors: (trade: string, context?: string, issue?: string) => void;
  warranty?: { coverageItems?: string[]; claimUrl?: string; claimPhone?: string; provider?: string; serviceFee?: number } | null;
  insurance?: { coverageItems?: string[]; exclusions?: string[]; claimUrl?: string; claimPhone?: string; claimEmail?: string; provider?: string; deductibleStandard?: number } | null;
}) {
  const col = item.severity === "critical" ? C.red : item.severity === "warning" ? C.amber : C.text3;
  const bg  = item.severity === "critical" ? C.redBg : item.severity === "warning" ? C.amberBg : C.bg;

  // Find all related findings
  const related = findings.filter(f =>
    f.category.toLowerCase().includes(item.label.toLowerCase().split(" ")[0].toLowerCase()) ||
    item.label.toLowerCase().includes(f.category.toLowerCase())
  );

  const trade = tradeForCategory(item.tradeCategory ?? item.label);

  const NEXT_STEPS: Record<string, string[]> = {
    "Roof Replacement": ["Get 3 quotes from licensed roofing contractors", "Check for current roof warranty", "Inspect attic for existing water damage", "Consider impact-resistant materials for insurance discounts"],
    "HVAC Replacement": ["Have a licensed HVAC tech assess the unit first", "Check for R-22 refrigerant (legacy systems cost more)", "Ask about efficiency ratings (SEER 16+ recommended)", "Check utility company rebates"],
    "HVAC Service": ["Schedule annual tune-up before peak season", "Replace air filter (every 1–3 months)", "Clear debris from outdoor unit", "Check thermostat calibration"],
    default: ["Get at least 2 contractor quotes", "Ask for written scope of work and warranty", "Verify contractor is licensed and insured", "Check permits required for this work type"],
  };

  const steps = NEXT_STEPS[item.label] ?? NEXT_STEPS.default;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,31,61,0.6)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "40px 20px",
    }} onClick={onClose}>
      <div style={{
        background: C.surface, borderRadius: 20, width: "100%", maxWidth: 560,
        boxShadow: "0 20px 60px rgba(15,31,61,0.25)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background: bg, borderBottom: `1px solid ${col}30`, padding: "20px 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: "0.08em",
              display: "flex", alignItems: "center", gap: 4 }}>
              {item.severity === "critical"
                ? <><AlertTriangle size={11}/> Critical</>
                : item.severity === "warning"
                  ? <><AlertCircle size={11}/> Attention Needed</>
                  : <><Info size={11}/> Ongoing</>}
            </span>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "6px 0 0", letterSpacing: "-0.3px" }}>{item.label}</h2>
            <p style={{ fontSize: 13, color: C.text3, margin: "4px 0 0", display: "flex", alignItems: "center", gap: 5 }}>
              <Clock size={12}/> {item.horizon}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(0,0,0,0.08)", border: "none", borderRadius: 8, padding: 8, cursor: "pointer" }}>
            <X size={16} color={C.text2}/>
          </button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Cost estimate */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, background: C.bg, borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>Estimated Cost</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: col, letterSpacing: "-0.5px", margin: "4px 0 0" }}>
                ${item.amount.toLocaleString()}
              </p>
              <p style={{ fontSize: 11, color: C.text3, margin: "2px 0 0" }}>National average estimate</p>
            </div>
            {item.systemAge !== null && item.systemAge !== undefined && (
              <div style={{ flex: 1, background: C.bg, borderRadius: 12, padding: "14px 16px" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>System Age</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", margin: "4px 0 0" }}>{item.systemAge} yrs</p>
                <p style={{ fontSize: 11, color: C.text3, margin: "2px 0 0" }}>Based on install year</p>
              </div>
            )}
          </div>

          {/* Inspection findings */}
          {related.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>
                From Your Inspection Report
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {related.map((f, i) => (
                  <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3, flexShrink: 0 }}/>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{categoryLabel(f.category)}</span>
                      {f.estimated_cost && (
                        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: col }}>
                          ${f.estimated_cost.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: C.text2, margin: 0, lineHeight: 1.5 }}>{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {related.length === 0 && (
            <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", border: `1px dashed ${C.border}` }}>
              <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
                This estimate is based on your system age and national averages. Upload an inspection report for exact findings.
              </p>
            </div>
          )}

          {/* Recommended next steps */}
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>
              Recommended Next Steps
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.accent, color: "white",
                    fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </span>
                  <p style={{ fontSize: 13, color: C.text2, margin: 0, lineHeight: 1.5 }}>{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Warranty claim hint */}
          {warranty && (warranty.coverageItems?.length ?? 0) > 0 &&
            isLikelyCovered(item.tradeCategory ?? item.label, warranty.coverageItems!) && (
            <div style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 10, padding: "10px 14px", marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 5 }}>
                <Shield size={12}/> This may be covered by your {warranty.provider ?? "home warranty"}
                {warranty.serviceFee ? ` — $${warranty.serviceFee} service fee` : ""}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {warranty.claimUrl && (
                  <a href={`${warranty.claimUrl}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: "#7c3aed", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                    <ExternalLink size={11}/> File a Claim
                  </a>
                )}
                {warranty.claimPhone && (
                  <a href={`tel:${warranty.claimPhone.replace(/\D/g, "")}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>
                    📞 Call Claims
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Insurance claim hint */}
          {insurance && (insurance.coverageItems?.length ?? 0) > 0 &&
            isLikelyCovered(item.tradeCategory ?? item.label, insurance.coverageItems!) && (
            <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 10, padding: "10px 14px", marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#0891b2", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 5 }}>
                <Shield size={12}/> This may be covered by your {insurance.provider ?? "home insurance"}
                {insurance.deductibleStandard ? ` — $${insurance.deductibleStandard.toLocaleString()} deductible` : ""}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {insurance.claimUrl && (
                  <a href={insurance.claimUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: "#0891b2", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                    <ExternalLink size={11}/> File a Claim
                  </a>
                )}
                {insurance.claimPhone && (
                  <a href={`tel:${insurance.claimPhone.replace(/\D/g, "")}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>
                    📞 Call Claims
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Financing awareness — for repairs >= $3,000 */}
          {item.amount >= 3000 && (
            <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 10, padding: "12px 16px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 5 }}>
                💳 Financing Options
              </p>
              <p style={{ fontSize: 13, color: C.text2, margin: "0 0 10px", lineHeight: 1.5 }}>
                At ${item.amount.toLocaleString()}, this repair may qualify for home improvement financing.
                Estimated payments: <strong>~${Math.round(item.amount / 36)}/mo</strong> over 36 months or{" "}
                <strong>~${Math.round(item.amount / 60)}/mo</strong> over 60 months.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={`https://www.google.com/search?q=home+improvement+loan+${encodeURIComponent(item.label)}+financing`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, background: "#0369a1", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                  <ExternalLink size={11}/> Explore Financing
                </a>
                <span style={{ fontSize: 11, color: C.text3, alignSelf: "center" }}>BTLR does not originate loans</span>
              </div>
            </div>
          )}

          {/* CTA buttons */}
          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button onClick={() => { onClose(); onFindVendors(item.tradeCategory ?? item.label, item.label, item.finding?.description ?? item.label); }}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 10, background: C.accent,
                border: "none", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Users size={14}/> Find {trade} Vendors
            </button>
            <button onClick={onClose}
              style={{ padding: "12px 16px", borderRadius: 10, background: C.bg,
                border: `1px solid ${C.border}`, color: C.text2, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [user, setUser]         = useState<{ id?: string; email?: string } | null>(null);
  const [address, setAddress]   = useState("My Home");
  const [roofYear, setRoofYear] = useState("");
  const [hvacYear, setHvacYear] = useState("");
  const [year, setYear]         = useState<number | null>(null);
  const [nav, setNav]           = useState("Dashboard");
  const [toast, setToast]       = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const toastTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [docs, setDocs]         = useState<Doc[]>([]);
  const [inspectionDoc, setInspectionDoc] = useState<Doc | null>(null); // last uploaded inspection file reference
  const [q, setQ]               = useState("");
  type ButlerAction = {
    label: string;
    type: "find_vendor" | "open_url" | "tel" | "email" | "nav_documents";
    trade?: string;
    url?: string;
    phone?: string;
    emailAddr?: string;
  };
  type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    intent?: string;
    actions?: ButlerAction[];
    quickReplies?: string[];
  };
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // ── Butler settings (persisted to localStorage) ───────────────────────
  const [voiceOutput, setVoiceOutput]         = useState(false);
  const [humorMode, setHumorMode]             = useState(false);
  const [showButlerSettings, setShowButlerSettings] = useState(false);

  // ── Voice input ───────────────────────────────────────────────────────
  const [isListening, setIsListening]         = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const [answer, setAnswer]     = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectDone, setInspectDone]   = useState(false);
  const [inspectErr, setInspectErr]     = useState("");
  const [lastInspectionFilename, setLastInspectionFilename] = useState<string | null>(null);
  const [inspectionResult, setInspectionResult] = useState<{
    inspection_type?: string;
    summary?: string;
    findings?: Finding[];
    recommendations?: string[];
    total_estimated_cost?: number | null;
    inspection_date?: string;
    company_name?: string;
  } | null>(null);
  const [homeHealthReport, setHomeHealthReport] = useState<HomeHealthReport | null>(null);

  // Photo analysis (upload UI removed; state kept for backward-compat with saved data)
  const [photoFindings, setPhotoFindings]       = useState<Finding[]>([]);

  const [docLoading, setDocLoading]         = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved]   = useState(false);
  const [parseDebug, setParseDebug]         = useState<Record<string, string | number | boolean | null | undefined> | null>(null);
  const [showDebug, setShowDebug]           = useState(false);

  // Repair lifecycle
  const [findingStatuses, setFindingStatuses] = useState<Record<string, FindingStatus>>({});
  const [markCompleteTarget, setMarkCompleteTarget] = useState<CostItem | null>(null);
  const [markCompleteUploading, setMarkCompleteUploading] = useState(false);
  const [repairFundExpanded, setRepairFundExpanded] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewFindings, setReviewFindings]   = useState<Finding[]>([]);
  const [savingStatuses, setSavingStatuses]   = useState(false);
  const [repairDocs, setRepairDocs]           = useState<Array<{ vendor?: string; date?: string; summary?: string; category?: string; cost?: number; autoResolved?: string[] }>>([]);
  const [uploadingRepair, setUploadingRepair] = useState(false);
  const repairRef = useRef<HTMLInputElement>(null);

  // ── Repair Complete Modal ─────────────────────────────────────────────────
  const [showCompleteModal, setShowCompleteModal]       = useState(false);
  const [completeModalTarget, setCompleteModalTarget]   = useState<{ finding: Finding; globalIdx: number } | null>(null);
  const [savingComplete, setSavingComplete]             = useState(false);
  const [archivesExpanded, setArchivesExpanded]         = useState(false);

  // Keyed by findingKey — loaded from repair_completions table on mount
  type RepairCompletion = { completed_at: string; notes: string; receipt_url?: string; was_scorable: boolean; score_before?: number };
  const [repairCompletions, setRepairCompletions] = useState<Record<string, RepairCompletion>>({});

  // Feedback
  const [showFeedback, setShowFeedback]       = useState(false);
  const [feedbackWhat, setFeedbackWhat]       = useState("");
  const [feedbackTrying, setFeedbackTrying]   = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent]       = useState(false);

  // Modals
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [showCostModal, setShowCostModal]     = useState(false);
  const [selectedCost, setSelectedCost]       = useState<CostItem | null>(null);
  const [vendorPrefill, setVendorPrefill]     = useState<string | null>(null);
  const [vendorContext, setVendorContext]      = useState<string | null>(null);
  const [vendorIssue,   setVendorIssue]       = useState<string | null>(null);

  // Inspection findings accordion — set of expanded group keys
  const [expandedGroups, setExpandedGroups]   = useState<Set<string>>(new Set());

  // Mortgage
  const [mortgage, setMortgage] = useState<{ lender?: string; balance?: number; payment?: number; due_day?: number; rate?: number } | null>(null);
  const [showMortgageForm, setShowMortgageForm] = useState(false);
  const [mortgageForm, setMortgageForm]         = useState({ lender: "loanDepot", balance: "", payment: "", due_day: "1", rate: "" });
  const [savingMortgage, setSavingMortgage]     = useState(false);
  const [mortgageStatLoading, setMortgageStatLoading] = useState(false);
  const mortgageStatRef = useRef<HTMLInputElement>(null);

  // Plaid
  const [plaidConnected, setPlaidConnected]   = useState(false);
  const [connectingPlaid, setConnectingPlaid] = useState(false);

  // Repair Fund — connected savings balance (Plaid or manual)
  const [repairSavingsBalance, setRepairSavingsBalance]   = useState<number | null>(null);
  const [repairSavingsName, setRepairSavingsName]         = useState<string>("Savings Account");
  const [repairSavingsSource, setRepairSavingsSource]     = useState<"plaid" | "manual" | null>(null);
  const [editingManualSavings, setEditingManualSavings]   = useState(false);
  const [manualSavingsInput, setManualSavingsInput]       = useState("");

  // Property data
  const [homeValue, setHomeValue]     = useState<number | null>(null);
  const [propertyTax, setPropertyTax] = useState<number | null>(null);
  const [fetchingProperty, setFetchingProperty] = useState(false);

  // Insurance
  const [insurance, setInsurance] = useState<{
    provider?: string; policyNumber?: string; policyType?: string;
    agentName?: string; agentPhone?: string; agentEmail?: string;
    dwellingCoverage?: number; otherStructures?: number; personalProperty?: number;
    lossOfUse?: number; liabilityCoverage?: number; medicalPayments?: number;
    deductibleStandard?: number; deductibleWind?: number; deductibleHurricane?: number;
    annualPremium?: number; paymentAmount?: number; paymentFrequency?: string; paymentDueDate?: number; paymentMethod?: string;
    effectiveDate?: string; expirationDate?: string; autoRenews?: boolean;
    coverageItems?: string[]; exclusions?: string[]; endorsements?: string[];
    replacementCostDwelling?: boolean; replacementCostContents?: boolean;
    claimPhone?: string; claimUrl?: string; claimEmail?: string; claimHours?: string;
    // legacy fields from old parser / properties table
    premium?: number;
    // stacked additional policies (CA FAIR Plan + DIC, etc.)
    additionalPolicies?: Array<{ provider?: string; policyType?: string; policyNumber?: string; premium?: number; annualPremium?: number; renewalDate?: string; expirationDate?: string; claimPhone?: string; claimUrl?: string; claimEmail?: string }>;
  } | null>(null);
  const [parsingInsurance, setParsingInsurance] = useState(false);
  const [insuranceError, setInsuranceError] = useState<string | null>(null);
  const [showInsuranceDetail, setShowInsuranceDetail] = useState(false);
  const [insuranceDocCount, setInsuranceDocCount] = useState(0); // how many docs have been uploaded
  const [insuranceFileKey, setInsuranceFileKey] = useState(0); // bump to reset file inputs after upload
  const insuranceRef = useRef<HTMLInputElement>(null);

  // Home Warranty
  const [warranty, setWarranty] = useState<{
    provider?: string; planName?: string; policyNumber?: string;
    serviceFee?: number; coverageItems?: string[]; exclusions?: string[];
    coverageLimits?: Record<string, number>;
    effectiveDate?: string; expirationDate?: string; autoRenews?: boolean;
    paymentAmount?: number; paymentFrequency?: string; paymentDueDate?: number;
    claimPhone?: string; claimUrl?: string; claimEmail?: string;
    waitingPeriod?: string; responseTime?: string; maxAnnualBenefit?: number;
  } | null>(null);
  const [parsingWarranty, setParsingWarranty]     = useState(false);
  const [warrantyError, setWarrantyError]         = useState<string | null>(null);
  const [showWarrantyDetail, setShowWarrantyDetail] = useState(false);
  const [openDocSection, setOpenDocSection] = useState<string | null>(null);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(0);
  const [smartSaveMode, setSmartSaveMode] = useState(false);
  const [editingContribution, setEditingContribution] = useState(false);
  const [contributionInput, setContributionInput] = useState("");
  const warrantyRef = useRef<HTMLInputElement>(null);

  const inspRef = useRef<HTMLInputElement>(null);
  const docRef  = useRef<HTMLInputElement>(null);

  // ── Multi-property support ────────────────────────────────────────────
  const [activePropertyId, setActivePropertyId] = useState<number | null>(null);
  const [allProperties, setAllProperties] = useState<Array<{ id: number; address: string; nickname?: string | null; home_type?: string | null; year_built?: number | null }>>([]);
  const [showPropDropdown, setShowPropDropdown] = useState(false);
  const [showAddPropDrawer, setShowAddPropDrawer] = useState(false);
  const [addingProp, setAddingProp] = useState(false);
  const [newPropForm, setNewPropForm] = useState({ address: "", nickname: "", home_type: "single_family", year_built: "" });
  const [newPropError, setNewPropError] = useState<string | null>(null);
  const activePropertyIdRef = useRef<number | null>(null);

  // ── Butler settings persistence ───────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem("btlr_butler");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.voiceOutput !== undefined) setVoiceOutput(s.voiceOutput);
        if (s.humorMode   !== undefined) setHumorMode(s.humorMode);
      }
    } catch { /* ignore */ }
    // Check speech API support
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).SpeechRecognition && !(window as any).webkitSpeechRecognition) {
      setSpeechSupported(false);
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("btlr_butler", JSON.stringify({ voiceOutput, humorMode })); } catch { /* ignore */ }
  }, [voiceOutput, humorMode]);

  // Repair Fund persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem("btlr_repair_fund");
      if (saved) {
        const s = JSON.parse(saved);
        if (typeof s.monthlyContribution === "number") setMonthlyContribution(s.monthlyContribution);
        if (typeof s.smartSaveMode === "boolean") setSmartSaveMode(s.smartSaveMode);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("btlr_repair_fund", JSON.stringify({ monthlyContribution, smartSaveMode })); } catch { /* ignore */ }
  }, [monthlyContribution, smartSaveMode]);

  // Repair Fund savings balance persistence (manual entries survive refresh)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("btlr_repair_savings");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.source === "manual" && typeof s.balance === "number") {
          setRepairSavingsBalance(s.balance);
          setRepairSavingsName(s.name ?? "Savings Account");
          setRepairSavingsSource("manual");
        }
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (repairSavingsSource === "manual" && repairSavingsBalance !== null) {
      try { localStorage.setItem("btlr_repair_savings", JSON.stringify({ source: "manual", balance: repairSavingsBalance, name: repairSavingsName })); } catch { /* ignore */ }
    }
  }, [repairSavingsBalance, repairSavingsSource, repairSavingsName]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setYear(new Date().getFullYear());
    // checkAuth calls getSession() which refreshes an expired JWT.
    // loadProperty() uses RLS (auth.uid() = user_id) — if we run it before
    // the token is refreshed the query returns null and all data is lost.
    // Chain them so loadProperty only fires after the session is confirmed.
    checkAuth().then(async authed => {
      if (authed) {
        loadDocs(); // runs independently — not gated on propId so docs always show
        const propId = await loadAllProperties();
        if (propId) {
          loadProperty(propId);
          loadRepairDocs();
          loadRepairCompletions(propId);
        }
        loadPlaidData();
      }
    });
  }, []);

  // (vendorPrefill is now set directly in handleFindVendors — no useEffect needed)

  // Auto-expand groups that contain critical findings when inspection data first loads
  useEffect(() => {
    const findings = inspectionResult?.findings ?? [];
    if (!findings.length) return;
    const criticalKeys = new Set<string>();
    for (const f of findings) {
      if (f.severity === "critical") criticalKeys.add(toGroupKey(f.category));
    }
    if (criticalKeys.size > 0) setExpandedGroups(criticalKeys);
  }, [inspectionResult]);

  // Keep activePropertyIdRef in sync with activePropertyId state
  useEffect(() => {
    activePropertyIdRef.current = activePropertyId;
  }, [activePropertyId]);

  // Close property dropdown on outside click
  useEffect(() => {
    if (!showPropDropdown) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-prop-selector]")) setShowPropDropdown(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showPropDropdown]);

  function openCostModal(item: CostItem) {
    setSelectedCost(item);
    setShowCostModal(true);
  }

  // Navigate to Vendors page pre-filtered to the relevant trade category.
  // Pass issue to pre-populate the search input and auto-trigger AI classification.
  function handleFindVendors(trade: string, context?: string, issue?: string) {
    setShowHealthModal(false);
    setShowCostModal(false);
    setVendorPrefill(toVendorKey(trade));
    setVendorContext(context ?? null);
    setVendorIssue(issue ?? null);
    setNav("Vendors");
  }

  async function fetchPropertyData(addr: string) {
    if (!addr || addr === "My Home") return;
    setFetchingProperty(true);
    try {
      const res = await fetch("/api/property-data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const json = await res.json();
      if (json.data) {
        setHomeValue(json.data.homeValue ?? null);
        setPropertyTax(json.data.propertyTaxAnnual ?? null);
      }
    } catch { /* silent */ }
    setFetchingProperty(false);
  }

  function showToast(msg: string, type: "success" | "error" | "info" = "success") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  async function uploadInsurance(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setParsingInsurance(true);
    setInsuranceError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      const { data: prop } = await supabase.from("properties").select("id").eq("user_id", uid ?? "").maybeSingle();
      const propId = prop?.id;
      const params = new URLSearchParams();
      if (uid)    params.set("userId",     uid);
      if (propId) params.set("propertyId", String(propId));

      // Parse each file and collect results
      const results: NonNullable<typeof insurance>[] = [];
      for (const file of files) {
        // Upload to storage
        if (uid) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `${uid}/insurance-${Date.now()}-${safeName}`;
          await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
        }
        // Parse
        const res  = await fetch(`/api/parse-insurance?${params}`, {
          method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
        });
        const json = await res.json();
        if (res.ok && json.data) {
          results.push(json.data);
        } else {
          const raw = json.error ?? `Server error (${res.status})`;
          console.warn("[uploadInsurance] skipped file:", file.name, raw);
        }
      }

      if (results.length === 0) {
        setInsuranceError("Couldn't read any of the uploaded files — try text-based PDFs.");
        showToast("Couldn't read uploaded files.", "error");
      } else {
        // Merge all parsed results: scalar = first non-null, arrays = union deduplicated
        const merged = results.reduce((acc, cur) => {
          const scalar = <K extends keyof typeof acc>(key: K) => acc[key] ?? cur[key];
          const arr    = (key: "coverageItems" | "exclusions" | "endorsements") => {
            const combined = [...(acc[key] ?? []), ...(cur[key] ?? [])];
            return Array.from(new Set(combined));
          };
          return {
            provider:               scalar("provider"),
            policyNumber:           scalar("policyNumber"),
            policyType:             scalar("policyType"),
            agentName:              scalar("agentName"),
            agentPhone:             scalar("agentPhone"),
            agentEmail:             scalar("agentEmail"),
            dwellingCoverage:       scalar("dwellingCoverage"),
            otherStructures:        scalar("otherStructures"),
            personalProperty:       scalar("personalProperty"),
            lossOfUse:              scalar("lossOfUse"),
            liabilityCoverage:      scalar("liabilityCoverage"),
            medicalPayments:        scalar("medicalPayments"),
            deductibleStandard:     scalar("deductibleStandard"),
            deductibleWind:         scalar("deductibleWind"),
            deductibleHurricane:    scalar("deductibleHurricane"),
            annualPremium:          scalar("annualPremium"),
            paymentAmount:          scalar("paymentAmount"),
            paymentFrequency:       scalar("paymentFrequency"),
            paymentDueDate:         scalar("paymentDueDate"),
            paymentMethod:          scalar("paymentMethod"),
            effectiveDate:          scalar("effectiveDate"),
            expirationDate:         scalar("expirationDate"),
            autoRenews:             scalar("autoRenews"),
            replacementCostDwelling:scalar("replacementCostDwelling"),
            replacementCostContents:scalar("replacementCostContents"),
            claimPhone:             scalar("claimPhone"),
            claimUrl:               scalar("claimUrl"),
            claimEmail:             scalar("claimEmail"),
            claimHours:             scalar("claimHours"),
            coverageItems:          arr("coverageItems"),
            exclusions:             arr("exclusions"),
            endorsements:           arr("endorsements"),
          };
        });

        // If adding to existing, also merge with current insurance state
        setInsurance(prev => {
          if (!prev) return merged;
          const base = [prev, merged];
          return base.reduce((acc, cur) => {
            const scalar = <K extends keyof typeof acc>(key: K) => acc[key] ?? cur[key];
            const arr    = (key: "coverageItems" | "exclusions" | "endorsements") =>
              Array.from(new Set([...(acc[key] ?? []), ...(cur[key] ?? [])]));
            return { ...acc, ...cur,
              provider: scalar("provider"), policyNumber: scalar("policyNumber"),
              dwellingCoverage: scalar("dwellingCoverage"), personalProperty: scalar("personalProperty"),
              liabilityCoverage: scalar("liabilityCoverage"), deductibleStandard: scalar("deductibleStandard"),
              claimPhone: scalar("claimPhone"), claimUrl: scalar("claimUrl"), claimEmail: scalar("claimEmail"),
              coverageItems: arr("coverageItems"), exclusions: arr("exclusions"), endorsements: arr("endorsements"),
            };
          });
        });

        setInsuranceDocCount(prev => prev + files.length);
        setInsuranceError(null);
        const label = `Insurance updated: ${results.length} document${results.length > 1 ? "s" : ""} parsed`;
        addEvent(label);
        showToast(`✓ ${label}`, "success");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.error("[uploadInsurance] caught:", msg);
      setInsuranceError(`Upload failed: ${msg}`);
      showToast(`Upload failed: ${msg}`, "error");
    }

    setParsingInsurance(false);
    if (insuranceRef.current) insuranceRef.current.value = "";
    setInsuranceFileKey(k => k + 1); // reset all insurance file inputs so re-selecting same file works
  }

  // ── Add a second (or third) insurance policy ────────────────────────────
  // Parses the new PDF via the same /api/parse-insurance endpoint, then
  // appends a compact policy object to the additional_policies JSONB array
  // in the DB. The primary policy is never touched.
  async function addSecondaryPolicy(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setParsingInsurance(true);
    setInsuranceError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (!uid) throw new Error("Not signed in");
      const propId = activePropertyIdRef.current;

      // Upload file to storage so the API can read it
      const ts = Date.now();
      const storagePath = `${uid}/insurance-add-${ts}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
      if (!signed?.signedUrl) throw new Error("Could not get download URL");

      const params = new URLSearchParams();
      if (uid)    params.set("userId",     uid);
      if (propId) params.set("propertyId", String(propId));
      const authHeader = { "Authorization": `Bearer ${sessionData.session?.access_token ?? ""}` };
      const res = await fetch(`/api/parse-insurance?${params}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ signedUrl: signed.signedUrl, filename: file.name }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any = {};
      try { json = await res.json(); } catch { throw new Error("Server error parsing policy"); }

      const parsed = json.data ?? json;
      if (!parsed || json.error) throw new Error(json.error ?? "Could not parse policy");

      // Build a compact secondary policy object with just the display fields
      const newPolicy = {
        provider:       parsed.provider       ?? null,
        policyType:     parsed.policy_type    ?? null,
        policyNumber:   parsed.policy_number  ?? null,
        annualPremium:  parsed.annual_premium ?? null,
        expirationDate: parsed.expiration_date ?? null,
        claimPhone:     parsed.claim_phone    ?? null,
        claimUrl:       parsed.claim_url      ?? null,
      };

      // Append to additional_policies in DB
      if (propId) {
        const { data: existing } = await supabase.from("home_insurance")
          .select("additional_policies").eq("property_id", propId).maybeSingle();
        const currentList = Array.isArray(existing?.additional_policies) ? existing.additional_policies : [];
        await supabase.from("home_insurance")
          .update({ additional_policies: [...currentList, newPolicy] })
          .eq("property_id", propId);
      }

      // Update local state immediately
      setInsurance(prev => ({
        ...prev,
        additionalPolicies: [...(prev?.additionalPolicies ?? []), newPolicy],
      }));
      showToast(`✓ Added ${newPolicy.provider ?? "policy"} — both policies now active`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setInsuranceError(`Could not add policy: ${msg}`);
      showToast(`Could not add policy: ${msg}`, "error");
    }
    setParsingInsurance(false);
    setInsuranceFileKey(k => k + 1);
  }

  async function uploadWarranty(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setParsingWarranty(true);
    setWarrantyError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      const { data: prop } = await supabase.from("properties").select("id").eq("user_id", uid ?? "").maybeSingle();
      const propId = prop?.id;

      if (uid) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${uid}/warranty-${Date.now()}-${safeName}`;
        await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      }

      const params = new URLSearchParams();
      if (uid)    params.set("userId",     uid);
      if (propId) params.set("propertyId", String(propId));

      const res = await fetch(`/api/parse-warranty?${params}`, {
        method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        const raw = json.error ?? `Server error (${res.status})`;
        console.error("[uploadWarranty]", raw);
        const msg = raw.includes("extract text") || raw.includes("text from")
          ? "Couldn't read this PDF — try a text-based (not scanned) version."
          : `Upload failed: ${raw}`;
        setWarrantyError(msg);
        showToast(msg, "error");
      } else if (json.data) {
        setWarranty(json.data);
        setWarrantyError(null);
        const label = `Warranty saved: ${json.data.provider ?? file.name}${json.data.planName ? ` · ${json.data.planName}` : ""}`;
        addEvent(label);
        showToast(`✓ ${label}`, "success");
      } else {
        setWarrantyError("No data returned — please try again.");
        showToast("No data returned — please try again.", "error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.error("[uploadWarranty] caught:", msg);
      setWarrantyError(`Upload failed: ${msg}`);
      showToast(`Upload failed: ${msg}`, "error");
    }
    setParsingWarranty(false);
    if (warrantyRef.current) warrantyRef.current.value = "";
  }

  async function loadPlaidData() {
    try {
      const res  = await fetch("/api/plaid-data");
      const data = await res.json();
      if (!data.connected) return;
      setPlaidConnected(true);
      if (data.mortgage) {
        const m = data.mortgage;
        setMortgage({ lender: m.lender ?? "Mortgage", balance: m.balance, payment: m.payment, due_day: m.due_day, rate: m.rate });
        setMortgageForm({
          lender: m.lender ?? "Mortgage", balance: m.balance?.toString() ?? "",
          payment: m.payment?.toString() ?? "", due_day: m.due_day?.toString() ?? "1",
          rate: m.rate ? (m.rate * 100).toFixed(3) : "",
        });
      }
      // Use highest-balance savings / investment account for Repair Fund display
      if (data.savingsAccounts?.length > 0) {
        const top = data.savingsAccounts[0];
        setRepairSavingsBalance(top.balance ?? 0);
        setRepairSavingsName(top.name ?? "Connected Account");
        setRepairSavingsSource("plaid");
      }
    } catch { /* silent */ }
  }

  async function connectPlaid() {
    setConnectingPlaid(true);
    try {
      const res = await fetch("/api/plaid-link", { method: "POST" });
      const { link_token, error } = await res.json();
      if (error || !link_token) { alert("Could not start bank connection."); setConnectingPlaid(false); return; }
      // @ts-ignore
      if (!window.Plaid) { alert("Plaid script not loaded. Refresh and try again."); setConnectingPlaid(false); return; }
      // @ts-ignore
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token: string) => {
          setConnectingPlaid(true);
          try {
            await fetch("/api/plaid-exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ public_token }) });
            await new Promise(r => setTimeout(r, 1500));
            await loadPlaidData();
            addEvent("Bank account connected");
          } catch { /* silent */ }
          setConnectingPlaid(false);
        },
        onExit: () => setConnectingPlaid(false),
        onEvent: (eventName: string) => { if (eventName === "HANDOFF") setConnectingPlaid(true); },
      });
      handler.open();
    } catch { alert("Bank connection failed."); setConnectingPlaid(false); }
  }

  async function checkAuth(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return false; }
    setUser(session.user);
    return true;
  }

  async function logout() {
    // Clear all per-session localStorage keys so the next user starts clean
    ["btlr_active_property_id", "btlr_repair_fund", "btlr_repair_savings", "btlr_butler"].forEach(k => localStorage.removeItem(k));
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function submitFeedback() {
    if (!feedbackWhat.trim()) return;
    setFeedbackSending(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatHappened: feedbackWhat,
          whatTrying:   feedbackTrying,
          currentPage:  nav,
          userId:       user?.id ?? null,
          userEmail:    user?.email ?? null,
          userAgent:    navigator.userAgent,
        }),
      });
      setFeedbackSent(true);
      setFeedbackWhat("");
      setFeedbackTrying("");
      setTimeout(() => { setFeedbackSent(false); setShowFeedback(false); }, 2200);
    } catch { /* silent — never block the user */ }
    setFeedbackSending(false);
  }

  // ── Clear all property-specific state ──────────────────────────────────
  function clearPropertyState() {
    setAddress("My Home");
    setRoofYear(""); setHvacYear("");
    setInspectionResult(null); setInspectDone(false);
    setInsurance(null); setWarranty(null); setMortgage(null);
    setFindingStatuses({}); setRepairDocs([]); setPhotoFindings([]);
    setHomeHealthReport(null); setHomeValue(null); setPropertyTax(null);
    setTimeline([]); setInsuranceDocCount(0);
    setParseDebug(null); setMortgageForm({ lender: "loanDepot", balance: "", payment: "", due_day: "1", rate: "" });
  }

  // ── Load all properties for the user ───────────────────────────────────
  async function loadAllProperties(): Promise<number | null> {
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return null;
      // Select only the two columns guaranteed to exist in every schema version.
      // Selecting nickname/home_type/year_built here would silently fail the whole
      // query if those migrations haven't been run, causing loadProperty() to never
      // fire and inspection data to disappear after every refresh.
      // The full property detail (including optional columns) is loaded in loadProperty().
      const { data, error } = await supabase
        .from("properties")
        .select("id, address")
        .eq("user_id", u.id)          // explicit filter — belt-and-suspenders on top of RLS
        .order("created_at", { ascending: true });
      if (error) { console.error("[loadAllProperties] query failed:", error.message, error.code); return null; }
      if (!data?.length) return null;
      setAllProperties(data);
      // Restore last active from localStorage, or default to first
      const stored = localStorage.getItem("btlr_active_property_id");
      const storedId = stored ? parseInt(stored) : null;
      const match = storedId ? data.find(p => p.id === storedId) : null;
      const active = match ? match.id : data[0].id;
      setActivePropertyId(active);
      activePropertyIdRef.current = active;
      return active;
    } catch { return null; }
  }

  // ── Switch to a different property ────────────────────────────────────
  async function switchProperty(id: number) {
    clearPropertyState();
    setActivePropertyId(id);
    activePropertyIdRef.current = id;
    localStorage.setItem("btlr_active_property_id", String(id));
    setShowPropDropdown(false);
    await loadProperty(id);
    await loadDocs();
    await loadRepairDocs();
    await loadRepairCompletions(id);
  }

  // ── Create a blank property and jump straight to its empty dashboard ────
  // Address defaults to "New Property" — the inspection upload will auto-fill
  // it from the report. The user can also rename it any time in Settings.
  async function createBlankProperty() {
    setAddingProp(true);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Not signed in");
      const { data, error } = await supabase.from("properties").insert({
        user_id:  u.id,
        address:  "New Property",
      }).select("id, address").single();
      if (error) throw new Error(error.message);
      setAllProperties(prev => [...prev, data]);
      setShowPropDropdown(false);
      clearPropertyState();
      setAddress("New Property");
      setNav("Documents"); // open Documents tab so inspection upload is front-and-center
      setActivePropertyId(data.id);
      activePropertyIdRef.current = data.id;
      localStorage.setItem("btlr_active_property_id", String(data.id));
      showToast("New property created — upload an inspection report to get started", "success");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create property.", "error");
    }
    setAddingProp(false);
  }

  // ── Save a new property (legacy — kept for drawer if re-enabled) ─────────
  async function saveNewProperty() {
    if (!newPropForm.address.trim()) { setNewPropError("Address is required."); return; }
    setAddingProp(true); setNewPropError(null);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Not signed in");
      const { data, error } = await supabase.from("properties").insert({
        user_id:    u.id,
        address:    newPropForm.address.trim(),
        nickname:   newPropForm.nickname.trim() || null,
        home_type:  newPropForm.home_type || null,
        year_built: newPropForm.year_built ? parseInt(newPropForm.year_built) : null,
      }).select("id, address").single();
      if (error) throw new Error(error.message);
      setAllProperties(prev => [...prev, data]);
      setShowAddPropDrawer(false);
      setNewPropForm({ address: "", nickname: "", home_type: "single_family", year_built: "" });
      setNav("Documents");
      await switchProperty(data.id);
      showToast(`✓ Property added: ${data.address}`, "success");
    } catch (err: unknown) {
      setNewPropError(err instanceof Error ? err.message : "Failed to save property.");
    }
    setAddingProp(false);
  }

  async function deleteProperty(propId: number) {
    const prop = allProperties.find(p => p.id === propId);
    const label = prop?.nickname || prop?.address || "this property";
    if (!confirm(`Delete "${label}"? All data (inspection, insurance, warranty) will be removed. This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from("properties").delete().eq("id", propId);
      if (error) throw new Error(error.message);
      const remaining = allProperties.filter(p => p.id !== propId);
      setAllProperties(remaining);
      showToast(`Deleted ${label}`, "success");
      if (activePropertyId === propId) {
        clearPropertyState();
        if (remaining.length > 0) {
          setActivePropertyId(remaining[0].id);
          activePropertyIdRef.current = remaining[0].id;
          localStorage.setItem("btlr_active_property_id", String(remaining[0].id));
          await loadProperty(remaining[0].id);
        } else {
          setActivePropertyId(null as unknown as number);
          localStorage.removeItem("btlr_active_property_id");
        }
      }
    } catch (err: unknown) {
      showToast("Delete failed: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  }

  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function loadProperty(propId: number) {
    try {
      const { data, error } = await supabase.from("properties").select("*").eq("id", propId).maybeSingle();
      if (error) { console.error("[loadProperty] DB read error:", error.message, error.code); return; }
      if (!data) { console.log("[loadProperty] No property row found for this user"); return; }
      console.log(`[loadProperty] Loaded property — ${(data.inspection_findings ?? []).length} findings, statuses: ${JSON.stringify(data.finding_statuses ?? {})}`)
      setAddress(data.address ?? "My Home");
      setRoofYear(data.roof_year?.toString() ?? "");
      setHvacYear(data.hvac_year?.toString() ?? "");

      // Load photo findings
      if (data.photo_findings?.length > 0) {
        setPhotoFindings(data.photo_findings ?? []);
      }

      // ── Load findings — findings table first, JSONB fallback ─────────────
      // The findings table is the source of truth for any upload that ran through
      // the deterministic pipeline. Older uploads only have the JSONB blob.
      let loadedFindings: Finding[] = [];
      const { data: findingsRows, error: findingsErr } = await supabase
        .from("findings")
        .select("*")
        .eq("property_id", propId)
        .order("created_at", { ascending: true });  // stable insertion order; UI groups by category
      if (findingsErr) {
        console.warn("[loadProperty] findings table read failed:", findingsErr.message);
      }
      if (findingsRows && findingsRows.length > 0) {
        // Hydrate status from findings rows (source of truth) AND from the JSONB
        // map so that legacy statuses set before the pipeline migration still work.
        const statusesFromRows: Record<string, FindingStatus> = {};
        loadedFindings = findingsRows.map(row => {
          const f: Finding = {
            ...(row.raw_finding ?? {}),
            category:               row.category,
            description:            row.description ?? "",
            severity:               row.severity    ?? "info",
            estimated_cost:         row.raw_finding?.estimated_cost ?? null,
            normalized_finding_key: row.normalized_finding_key,
            title:                  row.title,
            system:                 row.system,
            component:              row.component,
            issue_type:             row.issue_type,
            location:               row.location,
            recommended_action:     row.recommended_action,
            estimated_cost_min:     row.estimated_cost_min,
            estimated_cost_max:     row.estimated_cost_max,
            is_scorable:            row.scorable,
            scorable:               row.scorable,
            score_impact:           row.score_impact,
            // Pass 3 fields — present on pipeline-processed rows, absent on legacy rows
            confidence_score:       row.confidence_score       ?? undefined,
            classification_reason:  row.classification_reason  ?? undefined,
            needs_review:           row.needs_review            ?? false,
          };
          if (row.normalized_finding_key) {
            statusesFromRows[row.normalized_finding_key] = row.status ?? "open";
          }
          return f;
        });
        console.log(`[loadProperty] Loaded ${loadedFindings.length} findings from findings table`);
        // Merge: findings-table statuses take precedence over legacy JSONB statuses
        const mergedStatuses: Record<string, FindingStatus> = {
          ...(data.finding_statuses ?? {}),
          ...statusesFromRows,
        };
        setFindingStatuses(mergedStatuses);
      } else if (data.finding_statuses && typeof data.finding_statuses === "object") {
        // No findings table rows yet — use legacy JSONB statuses
        setFindingStatuses(data.finding_statuses as Record<string, FindingStatus>);
      }

      // Enter block when inspection_type is set — it is always written to DB by
      // uploadInspection even when 0 findings are returned, so it reliably signals
      // "an upload happened." Without this guard, a 0-findings upload leaves
      // inspection_findings=[] and inspection_summary=null, causing the score
      // card to be hidden after every refresh.
      // Prefer findings-table rows; fall back to JSONB blob for legacy data.
      const finalFindings = loadedFindings.length > 0 ? loadedFindings : (data.inspection_findings ?? []);
      if (finalFindings.length > 0 || data.inspection_summary || data.inspection_type) {
        setInspectionResult({
          inspection_type:      data.inspection_type     ?? "Home Inspection",
          summary:              data.inspection_summary  ?? undefined,
          findings:             finalFindings,
          recommendations:      data.recommendations     ?? [],
          total_estimated_cost: data.total_estimated_cost ?? null,
          inspection_date:      data.inspection_date     ?? undefined,
          company_name:         data.inspector_company   ?? undefined,
        });
        setInspectDone(true);
      }

      // Recompute Home Health Report merging inspection + photo findings.
      // Photo findings get higher inspector_confidence (0.85 vs 0.75) since
      // they are based on visual evidence rather than text extraction.
      // IMPORTANT: also run when roof_year or hvac_year are set even with 0
      // findings — normalizeLegacyFindings synthesizes age-based items for
      // those systems so Roof/HVAC bars appear in the breakdown immediately.
      const hasAnyFindings = (data.inspection_findings?.length > 0) || (data.photo_findings?.length > 0);
      const hasSystemAge   = !!(data.roof_year || data.hvac_year);
      if (hasAnyFindings || data.inspection_summary || hasSystemAge) {
        try {
          const currentYear = new Date().getFullYear();
          const roofAge = data.roof_year ? currentYear - data.roof_year : null;
          const hvacAge = data.hvac_year ? currentYear - data.hvac_year : null;
          const inspNorm = normalizeLegacyFindings(data.inspection_findings ?? [], roofAge, hvacAge);
          const photoNorm = normalizeLegacyFindings(data.photo_findings ?? [], null, null)
            .map(item => ({ ...item, inspector_confidence: 0.85, source_type: "photo" }));
          setHomeHealthReport(computeHomeHealthReport([...inspNorm, ...photoNorm]));
        } catch { /* non-fatal — rich breakdown falls back gracefully */ }
      }
      if (data.home_value)          setHomeValue(data.home_value);
      if (data.property_tax_annual) setPropertyTax(data.property_tax_annual);
      // Load home warranty from home_warranties table
      const { data: war } = await supabase.from("home_warranties").select("*").eq("property_id", propId).maybeSingle();
      if (war) {
        setWarranty({
          provider:         war.provider,
          planName:         war.plan_name,
          policyNumber:     war.policy_number,
          serviceFee:       war.service_fee,
          coverageItems:    war.coverage_items ?? [],
          exclusions:       war.exclusions ?? [],
          coverageLimits:   war.coverage_limits,
          effectiveDate:    war.effective_date,
          expirationDate:   war.expiration_date,
          autoRenews:       war.auto_renews,
          paymentAmount:    war.payment_amount,
          paymentFrequency: war.payment_frequency,
          paymentDueDate:   war.payment_due_date,
          claimPhone:       war.claim_phone,
          claimUrl:         war.claim_url,
          claimEmail:       war.claim_email,
          waitingPeriod:    war.waiting_period,
          responseTime:     war.response_time,
          maxAnnualBenefit: war.max_annual_benefit,
        });
      }

      // Load full insurance from home_insurance table (falls back to legacy properties columns)
      const { data: ins } = await supabase.from("home_insurance").select("*").eq("property_id", propId).maybeSingle();
      if (ins) {
        setInsurance({
          provider: ins.provider, policyNumber: ins.policy_number, policyType: ins.policy_type,
          agentName: ins.agent_name, agentPhone: ins.agent_phone, agentEmail: ins.agent_email,
          dwellingCoverage: ins.dwelling_coverage, otherStructures: ins.other_structures,
          personalProperty: ins.personal_property, lossOfUse: ins.loss_of_use,
          liabilityCoverage: ins.liability_coverage, medicalPayments: ins.medical_payments,
          deductibleStandard: ins.deductible_standard, deductibleWind: ins.deductible_wind,
          deductibleHurricane: ins.deductible_hurricane,
          annualPremium: ins.annual_premium, paymentAmount: ins.payment_amount,
          paymentFrequency: ins.payment_frequency, paymentDueDate: ins.payment_due_date,
          paymentMethod: ins.payment_method,
          effectiveDate: ins.effective_date, expirationDate: ins.expiration_date, autoRenews: ins.auto_renews,
          coverageItems: ins.coverage_items ?? [], exclusions: ins.exclusions ?? [], endorsements: ins.endorsements ?? [],
          replacementCostDwelling: ins.replacement_cost_dwelling, replacementCostContents: ins.replacement_cost_contents,
          claimPhone: ins.claim_phone, claimUrl: ins.claim_url, claimEmail: ins.claim_email, claimHours: ins.claim_hours,
          additionalPolicies: Array.isArray(ins.additional_policies) ? ins.additional_policies : [],
        });
      } else if (data.insurance_premium) {
        setInsurance({ premium: data.insurance_premium, expirationDate: data.insurance_renewal ?? undefined });
      }
      if (data.mortgage_balance || data.mortgage_payment) {
        setMortgage({
          lender: data.mortgage_lender ?? "loanDepot", balance: data.mortgage_balance,
          payment: data.mortgage_payment, due_day: data.mortgage_due_day, rate: data.mortgage_rate,
        });
        setMortgageForm({
          lender: data.mortgage_lender ?? "loanDepot", balance: data.mortgage_balance?.toString() ?? "",
          payment: data.mortgage_payment?.toString() ?? "", due_day: data.mortgage_due_day?.toString() ?? "1",
          rate: data.mortgage_rate ? (data.mortgage_rate * 100).toFixed(3) : "",
        });
      }
    } catch (err) { console.error("loadProperty exception:", err); }
  }

  async function saveMortgage() {
    setSavingMortgage(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/parse-mortgage", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ manual: true, lender: mortgageForm.lender, balance: mortgageForm.balance, payment: mortgageForm.payment, due_day: mortgageForm.due_day, rate: mortgageForm.rate ? String(Number(mortgageForm.rate) / 100) : "" }),
      });
      const data = await res.json();
      if (data.success) {
        setMortgage({ lender: mortgageForm.lender, balance: mortgageForm.balance ? Number(mortgageForm.balance) : undefined, payment: mortgageForm.payment ? Number(mortgageForm.payment) : undefined, due_day: mortgageForm.due_day ? Number(mortgageForm.due_day) : undefined, rate: mortgageForm.rate ? Number(mortgageForm.rate) / 100 : undefined });
        setShowMortgageForm(false);
        addEvent(`Mortgage updated: ${mortgageForm.lender}`);
      }
    } catch (err) { console.error(err); }
    setSavingMortgage(false);
  }

  async function uploadMortgageStatement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setMortgageStatLoading(true);
    try {
      const { data: mortgageRefreshed } = await supabase.auth.refreshSession();
      const mortgageSession = mortgageRefreshed?.session ?? (await supabase.auth.getSession()).data.session;
      const mortgageUserId = mortgageSession?.user?.id;
      if (!mortgageUserId) throw new Error("Session expired — please log out and back in.");
      // Storage path must start with userId/ to satisfy RLS policy
      const storagePath = `${mortgageUserId}/mortgage-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageErr } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      if (storageErr) throw new Error(storageErr.message);
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 300);
      if (!signed?.signedUrl) throw new Error("Could not get URL");
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/parse-mortgage", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader }, body: JSON.stringify({ signedUrl: signed.signedUrl, storagePath }) });
      const data = await res.json();
      if (data.balance || data.payment) {
        setMortgage({ lender: data.lender, balance: data.balance, payment: data.payment, due_day: data.due_day, rate: data.rate });
        setMortgageForm({ lender: data.lender ?? "loanDepot", balance: data.balance?.toString() ?? "", payment: data.payment?.toString() ?? "", due_day: data.due_day?.toString() ?? "1", rate: data.rate ? (data.rate * 100).toFixed(3) : "" });
        addEvent(`Mortgage statement parsed: ${data.lender ?? "loanDepot"}`);
      }
    } catch (err: unknown) { console.error(err); }
    setMortgageStatLoading(false);
    if (mortgageStatRef.current) mortgageStatRef.current.value = "";
  }

  async function saveSettings() {
    setSavingSettings(true); setSettingsSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      const updateData = { address: address || "My Home", roof_year: roofYear ? Number(roofYear) : null, hvac_year: hvacYear ? Number(hvacYear) : null, updated_at: new Date().toISOString() };
      const { data: existing } = await supabase.from("properties").select("id").limit(1).maybeSingle();
      if (existing?.id) {
        await supabase.from("properties").update(updateData).eq("id", existing.id);
      } else {
        await supabase.from("properties").insert({ ...updateData, user_id: userId });
      }
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      if (address && address !== "My Home") fetchPropertyData(address);
    } catch (err) { console.error("Save error:", err); }
    setSavingSettings(false);
  }

  async function uploadInspection(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setInspecting(true); setInspectDone(false); setInspectErr(""); setInspectionResult(null);
    try {
      // Refresh session first — also gives us the userId for the storage path
      const { data: refreshed } = await supabase.auth.refreshSession();
      const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
      const uploadUserId = session?.user?.id;
      if (!uploadUserId) throw new Error("Session expired — please log out and back in.");
      // Storage path must start with userId/ to satisfy RLS policy
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${uploadUserId}/inspections-${Date.now()}-${safeName}`;
      const { error: storageErr } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      if (storageErr) throw new Error("Storage upload failed: " + storageErr.message);
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
      if (!signed?.signedUrl) throw new Error("Could not get download URL");
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/parse-inspection", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader }, body: JSON.stringify({ signedUrl: signed.signedUrl, filename: file.name, storagePath }) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any = {};
      try { result = await res.json(); } catch { setInspectErr("Server error — please try again."); setInspecting(false); if (inspRef.current) inspRef.current.value = ""; return; }
      if (result.error && !result.success) {
        setInspectErr(result.error || "Analysis failed — please try again.");
      } else {
        const newFindings: Finding[] = Array.isArray(result.findings) ? result.findings : [];

        // ── Duplicate report detection ──────────────────────────────────────
        // Only block if the same filename was uploaded in this session already.
        // We do NOT fingerprint content — after a refresh, findings are loaded
        // from DB into state, and a legitimate re-upload would falsely match.
        const sameFile = lastInspectionFilename !== null && lastInspectionFilename === file.name;
        if (sameFile) {
          setInspectErr("This report is already on file. To update your score, upload a new inspection report.");
          setInspecting(false);
          if (inspRef.current) inspRef.current.value = "";
          return;
        }

        // ── Reset finding statuses on new inspection ───────────────────────
        // Old "completed" statuses from a prior inspection would mask new findings
        // and keep the score artificially high. Clear them so every finding from
        // the new report starts as "open" and actually affects the score.
        const freshStatuses: Record<string, FindingStatus> = {};
        setFindingStatuses(freshStatuses);

        // ── Persist to DB — select then update or insert ──────────────────
        // This is the source of truth. loadProperty() reads from here on refresh.
        // uploadUserId is already available from the storage upload above.
        const inspectionPayload = {
          inspection_findings:   newFindings,
          inspection_type:       result.inspection_type      ?? "Home Inspection",
          inspection_summary:    result.summary              ?? null,
          recommendations:       result.recommendations      ?? [],
          total_estimated_cost:  result.total_estimated_cost ?? null,
          inspection_date:       result.inspection_date      ?? null,
          inspector_company:     result.company_name         ?? null,
          finding_statuses:      freshStatuses,
          ...(result.roof_year        ? { roof_year: result.roof_year }               : {}),
          ...(result.hvac_year        ? { hvac_year: result.hvac_year }               : {}),
          // Persist address from inspection report so vendor search stays correct on reload
          ...(result.property_address ? { address: result.property_address }          : {}),
          updated_at:            new Date().toISOString(),
        };
        let activePropId = activePropertyIdRef.current;
        if (activePropId) {
          const { error: updateErr } = await supabase
            .from("properties").update(inspectionPayload).eq("id", activePropId);
          if (updateErr) {
            console.error("[uploadInspection] update failed:", updateErr.message, updateErr.code);
            // Surface to user — without this save, data won't persist after refresh
            showToast(`Inspection analyzed but could not save findings (${updateErr.message}). Try refreshing.`, "error");
          } else {
            console.log(`[uploadInspection] ✓ Saved ${newFindings.length} findings to property ${activePropId}`);
          }
        } else {
          // No active property yet — create one; capture new row's ID for findings upsert
          const { data: inserted, error: insertErr } = await supabase
            .from("properties").insert({ ...inspectionPayload, address: address || "My Home", user_id: uploadUserId }).select("id").single();
          if (insertErr) {
            console.error("[uploadInspection] insert failed:", insertErr.message, insertErr.code);
            showToast(`Inspection analyzed but could not save to database (${insertErr.message}). Your results will disappear on refresh.`, "error");
          } else {
            activePropId = inserted.id;
            activePropertyIdRef.current = inserted.id;
            setActivePropertyId(inserted.id);
            localStorage.setItem("btlr_active_property_id", String(inserted.id));
            console.log(`[uploadInspection] ✓ Created property ${inserted.id} with ${newFindings.length} findings`);
          }
        }

        // ── Upsert findings rows via explicit RPC ─────────────────────────
        // Uses upsert_findings_preserve_status() — a Postgres function with a
        // hardcoded ON CONFLICT DO UPDATE SET list that intentionally excludes
        // `status` and `created_at`. This is the only safe guarantee: client-side
        // .upsert() generates "DO UPDATE SET *" and cannot be trusted to skip
        // status without constructing raw SQL ourselves.
        //
        // Result: completed/dismissed/monitored repairs survive any re-upload.
        const findingRows = newFindings
          .filter(f => {
            // Must have a normalized key (4-part slug, no free-form description text)
            if (!f.normalized_finding_key) return false;
            // Key must be 5-part slug: category__system__component__location__issue_type
            // Exactly 4 __ separators, all slug characters (no spaces, no description text)
            if (!/^[a-z0-9_]+(__[a-z0-9_]+){4}$/.test(f.normalized_finding_key)) return false;
            return true;
          })
          .map(f => {
            const sev = (f.severity || "").toLowerCase();
            const validSev = (["critical", "warning", "info"] as const).includes(sev as "critical" | "warning" | "info")
              ? (sev as "critical" | "warning" | "info")
              : "info";
            // pool_spa is always unscored regardless of what the parser returned
            const isPool = f.category === "pool_spa";
            return {
              property_id:            activePropId,
              user_id:                uploadUserId,
              normalized_finding_key: f.normalized_finding_key,
              title:                  f.title ?? `${categoryLabel(f.category)} — ${validSev}`,
              category:               f.category,
              system:                 f.system    ?? f.category,
              component:              f.component ?? f.category,
              issue_type:             f.issue_type ?? "general",
              description:            f.description ?? "",
              location:               f.location ?? "unknown",
              severity:               validSev,
              scorable:               isPool ? false : (f.is_scorable ?? f.scorable ?? false),
              score_impact:           isPool ? "none" : (f.score_impact ?? "none"),
              recommended_action:     f.recommended_action ?? null,
              estimated_cost_min:     f.estimated_cost_min ?? null,
              estimated_cost_max:     f.estimated_cost_max ?? null,
              confidence_score:       f.confidence_score       ?? "medium",
              classification_reason:  f.classification_reason  ?? null,
              needs_review:           f.needs_review           ?? false,
              raw_finding:            JSON.stringify(f),  // RPC reads this as jsonb string
            };
          });

        if (activePropId && findingRows.length > 0) {
          const { error: upsertErr } = await supabase.rpc(
            "upsert_findings_preserve_status",
            { p_findings: JSON.stringify(findingRows) },
          );
          if (upsertErr) console.error("[uploadInspection] findings RPC failed:", upsertErr.message);
          else console.log(`[uploadInspection] ✓ Upserted ${findingRows.length} findings (status preserved)`);
        }

        // ── Save inspection file reference to documents table ───────────────
        // This is the persistence record for the file itself. On reload, loadDocs()
        // reads document_type="inspection" rows and restores the file reference so
        // users can re-download their original PDF. Without this row, the file is
        // orphaned in Storage with no way to surface it after refresh/logout.
        if (activePropId) {
          // Upsert by storage_path so re-uploading the same file doesn't create duplicates
          const { error: docInsertErr } = await supabase
            .from("documents")
            .upsert(
              {
                user_id:       uploadUserId,
                property_id:   activePropId,
                file_name:     file.name,
                storage_path:  storagePath,
                document_type: "inspection",
              },
              { onConflict: "storage_path", ignoreDuplicates: false },
            );
          if (docInsertErr) {
            console.error("[uploadInspection] documents row failed:", docInsertErr.message, docInsertErr.code);
            showToast("Inspection analyzed but file reference not saved — try refreshing.", "error");
          } else {
            console.log("[uploadInspection] ✓ documents row saved for inspection file");
            // Immediately update local state so the file reference is available
            const { data: signed } = await supabase.storage
              .from("documents")
              .createSignedUrl(storagePath, 3600);
            setInspectionDoc({
              id:            "",
              name:          file.name,
              path:          storagePath,
              document_type: "inspection",
              url:           signed?.signedUrl ?? undefined,
            });
          }
        }

        if (result.roof_year) setRoofYear(String(result.roof_year));
        if (result.hvac_year) setHvacYear(String(result.hvac_year));
        if (result.property_address) setAddress(result.property_address);
        setInspectionResult(result);
        setLastInspectionFilename(file.name);
        // Recompute merged report — API's home_health_report only knows about
        // inspection findings; client-side we merge with any photo findings.
        try {
          const currentYear = new Date().getFullYear();
          const rA = result.roof_year ? currentYear - result.roof_year : null;
          const hA = result.hvac_year ? currentYear - result.hvac_year : null;
          const inspNorm = normalizeLegacyFindings(newFindings, rA, hA);
          const photoNorm = normalizeLegacyFindings(photoFindings, null, null)
            .map(item => ({ ...item, inspector_confidence: 0.85, source_type: "photo" }));
          setHomeHealthReport(computeHomeHealthReport([...inspNorm, ...photoNorm]));
        } catch {
          // Fall back to API-computed report if merge fails
          if (result.home_health_report) setHomeHealthReport(result.home_health_report);
        }
        if (result._debug) setParseDebug(result._debug);
        const findingCount = newFindings.length;
        addEvent(`${result.inspection_type ?? "Inspection"} analyzed: ${findingCount} finding${findingCount !== 1 ? "s" : ""} detected`);
        setInspectDone(true);
        // Show post-inspection review modal — only scored findings that are critical or warning.
        // Info-level items (noisy fan, sticky door, minor cosmetic issues) stay in the Repairs tab
        // but are too minor to surface in the initial popup.
        // All findings remain visible in the Repairs tab regardless.
        if (newFindings.length > 0) {
          const scoredOnly = newFindings.filter(f =>
            isScoredFinding(f.category, f.description) &&
            (f.severity === "critical" || f.severity === "warning")
          );
          // Fall back to all scored findings if nothing meets the severity threshold,
          // then fall back to all findings so the modal is never empty.
          const fallback = newFindings.filter(f => isScoredFinding(f.category, f.description));
          setReviewFindings(scoredOnly.length > 0 ? scoredOnly : fallback.length > 0 ? fallback : newFindings);
          setShowReviewModal(true);
        } else {
          // No findings — tell the user so they know something may be wrong
          setInspectErr("No findings extracted from this document. Try a different PDF or check that it's a readable inspection report.");
        }
      }
    } catch (err: unknown) { setInspectErr(err instanceof Error ? err.message : "Upload failed"); }
    setInspecting(false);
    if (inspRef.current) inspRef.current.value = "";
  }

  // ── Load documents from Postgres on mount ────────────────────────────────
  // Source of truth: Postgres documents table. Never relies on storage.list()
  // or React state — both vanish on refresh. Every upload MUST write a row here.
  //
  // Loads three document types in parallel:
  //   "other"      → general docs (warranties, permits, HOA)
  //   "insurance"  → insurance doc count badge
  //   "inspection" → last inspection file reference (for re-download)
  async function loadDocs() {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
      if (!session?.user?.id) return;
      const uid = session.user.id;

      // ── 1. General docs ("other") ──────────────────────────────────────────
      const { data: otherData, error: otherErr } = await supabase
        .from("documents")
        .select("id, file_name, storage_path, document_type, created_at")
        .eq("user_id", uid)
        .eq("document_type", "other")
        .order("created_at", { ascending: false })
        .limit(200);

      if (otherErr) {
        // Always silent — this runs on every mount including first-ever login
        // (table may be empty or not yet created). Never show error toast here.
        console.warn("[loadDocs] documents query error:", otherErr.code, otherErr.message);
      } else if (otherData) {
        const files: Doc[] = await Promise.all(
          otherData.map(async (row) => {
            const { data: signed } = await supabase.storage
              .from("documents")
              .createSignedUrl(row.storage_path, 3600);
            return {
              id:            row.id,
              name:          row.file_name,
              path:          row.storage_path,
              document_type: row.document_type,
              url:           signed?.signedUrl ?? undefined,
            };
          })
        );
        setDocs(files);
      }

      // ── 2. Insurance doc count badge ───────────────────────────────────────
      const { count: insCount } = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("document_type", "insurance");
      if (insCount && insCount > 0) setInsuranceDocCount(insCount);

      // ── 3. Inspection file reference ──────────────────────────────────────
      // Restores the "View original PDF" link after logout/login without relying
      // on any React state. The inspection FINDINGS are loaded separately via
      // loadProperty() → findings table + properties.inspection_findings JSONB.
      const { data: inspData, error: inspErr } = await supabase
        .from("documents")
        .select("id, file_name, storage_path, document_type, created_at")
        .eq("user_id", uid)
        .eq("document_type", "inspection")
        .order("created_at", { ascending: false })
        .limit(1);

      if (inspErr) {
        console.warn("[loadDocs] inspection doc query error:", inspErr.code, inspErr.message);
      } else if (inspData?.length) {
        const row = inspData[0];
        const { data: signed } = await supabase.storage
          .from("documents")
          .createSignedUrl(row.storage_path, 3600);
        setInspectionDoc({
          id:            row.id,
          name:          row.file_name,
          path:          row.storage_path,
          document_type: "inspection",
          url:           signed?.signedUrl ?? undefined,
        });
        console.log("[loadDocs] ✓ Restored inspection file reference:", row.file_name);
      }

    } catch (err) {
      console.error("[loadDocs] unexpected error:", err);
    }
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setDocLoading(true);
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
    if (refreshErr && !session) { alert("Session expired — please log out and back in."); setDocLoading(false); return; }
    const userId = session?.user?.id;
    if (!userId) { alert("Not logged in — please refresh and try again."); setDocLoading(false); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fullPath = `${userId}/docs-${Date.now()}-${safeName}`;

    // 1. Upload to Storage
    const { error: storageErr } = await supabase.storage.from("documents").upload(fullPath, file, { upsert: true });
    if (storageErr) { alert("Upload failed: " + storageErr.message); setDocLoading(false); return; }

    // 2. Write metadata row to Postgres (so it persists across logout/login).
    // property_id is bigint (matches properties.id integer type) — nullable.
    const { data: insertedDoc, error: dbErr } = await supabase.from("documents").insert({
      user_id:       userId,
      property_id:   activePropertyIdRef.current ?? null,
      file_name:     file.name,
      storage_path:  fullPath,
      document_type: "other",
    }).select("id").maybeSingle();

    if (dbErr) {
      console.error("[uploadDoc] db insert error:", dbErr.message, dbErr.code);
      showToast(`Upload saved to storage but failed to record in database: ${dbErr.message}`, "error");
      // Still show the file for this session, but warn the user it won't persist
    }

    addEvent(`Document uploaded: ${file.name}`);
    const { data: signed } = await supabase.storage.from("documents").createSignedUrl(fullPath, 3600);
    setDocs(prev => [{ id: insertedDoc?.id ?? "", name: file.name, path: fullPath, document_type: "other", url: signed?.signedUrl ?? undefined }, ...prev]);
    setDocLoading(false);
    if (docRef.current) docRef.current.value = "";
  }

  async function deleteDoc(doc: Doc) {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    // Remove from Storage
    const { error: storageErr } = await supabase.storage.from("documents").remove([doc.path]);
    if (storageErr) { showToast("Delete failed: " + storageErr.message, "error"); return; }
    // Remove from Postgres documents table — use primary key, not path
    const { error: dbErr } = await supabase.from("documents").delete().eq("id", doc.id);
    if (dbErr) console.error("[deleteDoc] db delete error:", dbErr.message);
    setDocs(prev => prev.filter(d => d.path !== doc.path));
    showToast(`Deleted ${doc.name}`, "success");
  }

  // ── Load repair history from DB on mount ────────────────────────────────
  async function loadRepairDocs() {
    try {
      const { data, error } = await supabase
        .from("repair_documents")
        .select("vendor_name, service_date, repair_summary, system_category, cost, resolved_finding_keys")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error || !data) return;
      setRepairDocs(data.map(r => ({
        vendor:       r.vendor_name       ?? undefined,
        date:         r.service_date      ?? undefined,
        summary:      r.repair_summary    ?? undefined,
        category:     r.system_category   ?? undefined,
        cost:         r.cost              ?? undefined,
        autoResolved: Array.isArray(r.resolved_finding_keys) ? r.resolved_finding_keys : [],
      })));
    } catch { /* silent */ }
  }

  // ── Repair document upload and parsing ──────────────────────────────────
  async function uploadRepairDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingRepair(true);
    try {
      const { data: repairRefreshed } = await supabase.auth.refreshSession();
      const repairSession = repairRefreshed?.session ?? (await supabase.auth.getSession()).data.session;
      const repairUserId = repairSession?.user?.id;
      if (!repairUserId) throw new Error("Session expired — please log out and back in.");
      const storagePath = `${repairUserId}/repairs-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageErr } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      if (storageErr) throw new Error("Upload failed: " + storageErr.message);
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 300);
      if (!signed?.signedUrl) throw new Error("Could not get download URL");
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/parse-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          signedUrl: signed.signedUrl,
          filename: file.name,
          storagePath,
          // Include photo findings so the repair matcher can resolve photo-detected issues too
          existingFindings: [...(inspectionResult?.findings ?? []), ...photoFindings],
        }),
      });
      const result = await res.json();
      if (!result.success) {
        alert(result.error || "Could not parse repair document — please try again.");
        return;
      }
      // Record the repair doc in local state
      setRepairDocs(prev => [{
        vendor: result.vendor_name,
        date: result.service_date,
        summary: result.repair_summary,
        category: result.system_category,
        cost: result.cost,
        autoResolved: result.auto_resolved,
      }, ...prev]);
      // Apply auto-resolved finding statuses
      if (result.auto_resolved?.length > 0) {
        const newStatuses = { ...findingStatuses };
        for (const key of result.auto_resolved) {
          newStatuses[key] = "completed";
        }
        setFindingStatuses(newStatuses);
        await persistFindingStatuses(newStatuses);
      }
      // Add to timeline
      const vendorStr = result.vendor_name ? ` by ${result.vendor_name}` : "";
      const costStr = result.cost ? ` — $${result.cost.toLocaleString()}` : "";
      addEvent(`Repair completed${vendorStr}: ${result.repair_summary ?? result.system_category ?? file.name}${costStr}`);
      // If there are suggested matches that weren't auto-resolved, show them
      if (result.suggested_matches?.length > result.auto_resolved?.length) {
        // Medium confidence matches — notify user
        const mediumMatches = result.suggested_matches.filter((m: {confidence: string}) => m.confidence === "medium");
        if (mediumMatches.length > 0) {
          const categories = mediumMatches.map((m: {category: string}) => m.category).join(", ");
          alert(`Repair document parsed! We detected possible matches to: ${categories}. Review your inspection findings to mark them as resolved.`);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingRepair(false);
      if (repairRef.current) repairRef.current.value = "";
    }
  }

  // ── Persist finding statuses to DB ──────────────────────────────────────
  // Two-layer write:
  //  1. Update individual findings rows by normalized_finding_key (source of truth)
  //  2. Write the full statuses map to properties.finding_statuses (legacy compat
  //     and fast read on loadProperty for pre-pipeline uploads)
  async function persistFindingStatuses(statuses: Record<string, FindingStatus>) {
    try {
      const propId = activePropertyIdRef.current;
      if (!propId) return;

      // Layer 1 — per-row updates for findings that have a normalized_finding_key
      const allFindings = [...(inspectionResult?.findings ?? []), ...photoFindings];
      const rowUpdates: PromiseLike<unknown>[] = [];
      allFindings.forEach((f, idx) => {
        const key = findingKey(f, idx);
        const newStatus = statuses[key];
        if (f.normalized_finding_key && newStatus) {
          const validStatus = ["open","completed","dismissed","monitored"].includes(newStatus) ? newStatus : "open";
          rowUpdates.push(
            supabase.from("findings")
              .update({ status: validStatus, updated_at: new Date().toISOString() })
              .eq("property_id", propId)
              .eq("normalized_finding_key", f.normalized_finding_key)
              .then()
          );
        }
      });
      await Promise.all(rowUpdates as Promise<unknown>[]);

      // Layer 2 — denormalized JSONB map for backward compat
      await supabase.from("properties")
        .update({ finding_statuses: statuses, updated_at: new Date().toISOString() })
        .eq("id", propId);
    } catch (err) { console.error("persistFindingStatuses error:", err); }
  }

  // ── Mark all findings in a cost item's category as completed ─────────────
  // Optionally uploads a receipt/invoice file first (stored in repair_docs bucket).
  async function markCategoryComplete(costItem: CostItem, receiptFile?: File) {
    setMarkCompleteUploading(true);
    try {
      const allFindings: Finding[] = [
        ...(inspectionResult?.findings ?? []),
        ...photoFindings,
      ];

      // Mark every finding that maps to this cost item's category as "completed"
      const categoryKey = toCategoryKey(costItem.label);
      const updated = { ...findingStatuses };
      allFindings.forEach((f, idx) => {
        if (toCategoryKey(f.category) === categoryKey) {
          updated[findingKey(f, idx)] = "completed";
        }
      });
      setFindingStatuses(updated);
      await persistFindingStatuses(updated);

      // Optionally upload the receipt to storage
      if (receiptFile) {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        const propId = activePropertyIdRef.current;
        if (uid) {
          const ts = Date.now();
          const storagePath = `${uid}/repair-receipt-${ts}-${receiptFile.name}`;
          await supabase.storage.from("documents").upload(storagePath, receiptFile, { upsert: true });

          // Parse the receipt via the repair-doc API if available, otherwise just store it
          if (propId) {
            try {
              const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
              if (signed?.signedUrl) {
                await fetch(`/api/parse-repair-doc?propertyId=${propId}&userId=${uid}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
                  body: JSON.stringify({ signedUrl: signed.signedUrl, filename: receiptFile.name }),
                });
              }
            } catch { /* receipt stored even if parse fails */ }
          }
        }
        showToast(`✓ ${costItem.label} marked complete — receipt saved`, "success");
      } else {
        showToast(`✓ ${costItem.label} marked complete`, "success");
      }

      addEvent(`Repair completed: ${costItem.label}${receiptFile ? ` (receipt uploaded)` : ""}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save — try again", "error");
    }
    setMarkCompleteUploading(false);
    setMarkCompleteTarget(null);
  }

  // ── Save finding status review (from InspectionReviewModal) ─────────────
  async function saveReviewStatuses(statuses: Record<string, FindingStatus>) {
    setSavingStatuses(true);
    setFindingStatuses(statuses);
    await persistFindingStatuses(statuses);
    setShowReviewModal(false);
    setSavingStatuses(false);
    addEvent("Inspection findings reviewed and status updated");
  }

  // ── Toggle a single finding status (inline select dropdown) ─────────────
  async function toggleFindingStatus(findingOrCategory: Finding | string, index: number, status: FindingStatus) {
    const key = findingKey(findingOrCategory, index);
    const newStatuses = { ...findingStatuses, [key]: status };
    setFindingStatuses(newStatuses);
    await persistFindingStatuses(newStatuses);
  }

  // ── Open the Mark Complete modal ─────────────────────────────────────────
  function openCompleteModal(finding: Finding, globalIdx: number) {
    setCompleteModalTarget({ finding, globalIdx });
    setShowCompleteModal(true);
  }

  // ── Handle repair completion confirmation ─────────────────────────────────
  async function confirmRepairComplete(data: { notes: string; completedAt: string; receiptFile?: File }) {
    if (!completeModalTarget) return;
    const { finding, globalIdx } = completeModalTarget;
    const propId = activePropertyIdRef.current;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;

    setSavingComplete(true);
    try {
      // 1. Mark finding status as completed
      const key = findingKey(finding, globalIdx);
      const newStatuses = { ...findingStatuses, [key]: "completed" as FindingStatus };
      setFindingStatuses(newStatuses);
      await persistFindingStatuses(newStatuses);

      // 2. Upload receipt to Storage if provided
      let receiptPath: string | null = null;
      let receiptSignedUrl: string | null = null;
      if (data.receiptFile && uid) {
        const ts = Date.now();
        const safeName = data.receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        receiptPath = `${uid}/repair-receipt-${ts}-${safeName}`;
        const { error: storageErr } = await supabase.storage.from("documents").upload(receiptPath, data.receiptFile, { upsert: true });
        if (storageErr) {
          showToast("Receipt upload failed: " + storageErr.message, "error");
        } else {
          const { data: signed } = await supabase.storage.from("documents").createSignedUrl(receiptPath, 3600 * 24 * 30);
          receiptSignedUrl = signed?.signedUrl ?? null;
        }
      }

      // 3. Scorability — prefer parser-stamped value, fall back to client check
      const impact = getScoreImpact(finding.category, finding.severity, finding.description);
      const wasScoreable = finding.is_scorable ?? impact.affects;
      const scoreBefore = breakdown.score;

      // 4. Persist to repair_completions table
      if (uid) {
        const { error: dbErr } = await supabase.from("repair_completions").insert({
          user_id:              uid,
          property_id:          propId ?? null,
          finding_key:          key,
          category:             finding.category,
          title:                finding.category,
          completed_at:         new Date(data.completedAt + "T12:00:00").toISOString(),
          notes:                data.notes || null,
          receipt_storage_path: receiptPath,
          receipt_url:          receiptSignedUrl,
          was_scorable:         wasScoreable,
          score_before:         scoreBefore,
        });
        if (dbErr) showToast("Saved locally — DB error: " + dbErr.message, "info");
      }

      // 5. Update local repairCompletions map (instant UI update)
      setRepairCompletions(prev => ({
        ...prev,
        [key]: {
          completed_at:  data.completedAt,
          notes:         data.notes,
          receipt_url:   receiptSignedUrl ?? undefined,
          was_scorable:  wasScoreable,
          score_before:  scoreBefore,
        }
      }));

      // 6. Timeline event + toast
      addEvent(`Repair completed: ${categoryLabel(finding.category)}${data.receiptFile ? " (receipt uploaded)" : ""}`);
      showToast(`✓ ${categoryLabel(finding.category)} marked complete${wasScoreable ? " — score updated" : ""}`, "success");

      setShowCompleteModal(false);
      setCompleteModalTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save — try again", "error");
    }
    setSavingComplete(false);
  }

  // ── Load repair completions from DB ──────────────────────────────────────
  async function loadRepairCompletions(propId?: string | number) {
    try {
      const query = supabase
        .from("repair_completions")
        .select("finding_key, category, completed_at, notes, receipt_url, was_scorable, score_before")
        .order("completed_at", { ascending: false })
        .limit(200);
      if (propId) query.eq("property_id", propId);
      const { data, error } = await query;
      if (error || !data) return;
      const map: Record<string, RepairCompletion> = {};
      data.forEach((r: { finding_key: string; completed_at: string; notes: string | null; receipt_url: string | null; was_scorable: boolean; score_before: number | null }) => {
        map[r.finding_key] = {
          completed_at: r.completed_at,
          notes:        r.notes ?? "",
          receipt_url:  r.receipt_url ?? undefined,
          was_scorable: r.was_scorable,
          score_before: r.score_before ?? undefined,
        };
      });
      setRepairCompletions(map);
    } catch (err) {
      console.error("loadRepairCompletions error:", err);
    }
  }

  // ── Text-to-speech — streaming OpenAI TTS (echo) with interruption ───
  const currentAudioRef  = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef    = useRef<AbortController | null>(null);

  /** Stop any speech immediately — call before starting new speech or on mic tap */
  function stopSpeaking() {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }

  async function speakText(text: string) {
    if (!voiceOutput || typeof window === "undefined") return;
    stopSpeaking();

    const clean = text
      .replace(/\*+/g, "").replace(/#+/g, "")
      .replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;

    // Split into natural sentences so the first chunk plays while the rest fetch
    const sentences = clean.match(/[^.!?]+[.!?]+["']?/g)?.map(s => s.trim()).filter(Boolean) ?? [clean];

    const abort = new AbortController();
    speakAbortRef.current = abort;

    // Pre-fetch all sentences in parallel; play in order as each resolves
    const blobUrls: (string | null)[] = new Array(sentences.length).fill(null);
    let playIdx = 0;
    let playing = false;

    function playNext() {
      if (playing || abort.signal.aborted) return;
      while (playIdx < sentences.length && blobUrls[playIdx] === null) return; // wait for blob
      if (playIdx >= sentences.length) return;

      const url = blobUrls[playIdx]!;
      playing = true;
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        blobUrls[playIdx] = null;
        playIdx++;
        playing = false;
        if (!abort.signal.aborted) playNext();
      };
      audio.onerror = () => { playing = false; playIdx++; playNext(); };
      audio.play().catch(() => { playing = false; playIdx++; playNext(); });
    }

    // Fetch each sentence, trigger playback as soon as the blob is ready
    const fetchSentence = async (sentence: string, idx: number) => {
      if (abort.signal.aborted) return;
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sentence }),
          signal: abort.signal,
        });
        if (!res.ok || abort.signal.aborted) return;
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        blobUrls[idx] = URL.createObjectURL(blob);
        // Only call playNext if this is the chunk we're waiting on
        if (idx === playIdx) playNext();
      } catch { /* aborted or network error — skip */ }
    };

    // Fetch first sentence immediately, rest in parallel
    await fetchSentence(sentences[0], 0);
    sentences.slice(1).forEach((s, i) => fetchSentence(s, i + 1));
  }

  // ── Speech-to-text ────────────────────────────────────────────────────
  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSpeechSupported(false); return; }
    if (isListening) { stopListening(); return; }
    // Interrupt any ongoing speech when user starts talking
    stopSpeaking();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.continuous      = false;
    recognition.interimResults  = true;
    recognition.lang            = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcript = Array.from(event.results as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join("");
      setQ(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      setIsListening(false);
      recognitionRef.current = null;
      if (event.error === "not-allowed") {
        setSpeechSupported(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }

  async function askAI(overrideQ?: string) {
    const userMsg = (overrideQ ?? q).trim();
    if (!userMsg || aiLoading) return;
    setQ("");
    setAiLoading(true);
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    try {
      // Stop any active TTS before a new exchange
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      const authHeader = await getAuthHeader();
      const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/home-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          question:    userMsg,
          chatHistory: history,
          roofYear, hvacYear, timeline, address,
          findings:    inspectionResult?.findings ?? [],
          repairs:     repairDocs,
          warranty:    warranty ?? null,
          insurance:   insurance ?? null,
          humorMode,
          repairFund: costs.length > 0 ? {
            totalNeededIn12Months: repairFundNeeded,
            totalAllCosts: repairFundAllTime,
            recommendedMonthly,
            monthlyContribution,
            fundProgressPct,
            upcomingItems: costsIn12Months.slice(0, 5).map(c => ({ label: c.label, amount: c.amount, horizon: c.horizon })),
          } : null,
        }),
      });
      const data = await res.json();
      const reply: ChatMessage = {
        role:         "assistant",
        content:      data.answer       ?? "I was unable to generate a response.",
        intent:       data.intent,
        actions:      data.actions      ?? [],
        quickReplies: data.quickReplies ?? [],
      };
      setChatMessages(prev => [...prev, reply]);
      setAnswer(data.answer ?? "");
      // Speak the response if voice output is on
      if (data.answer) speakText(data.answer);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "I appear to be having difficulty connecting. Please try again momentarily." }]);
    }
    setAiLoading(false);
  }

  // Execute a Butler action button
  function executeButlerAction(action: ButlerAction) {
    switch (action.type) {
      case "find_vendor":
        handleFindVendors(action.trade ?? "General Contractor");
        break;
      case "open_url":
        if (action.url) window.open(action.url, "_blank", "noopener,noreferrer");
        break;
      case "tel":
        if (action.phone) window.location.href = `tel:${action.phone}`;
        break;
      case "email":
        if (action.emailAddr) window.location.href = `mailto:${action.emailAddr}`;
        break;
      case "nav_documents":
        setNav("Documents");
        break;
    }
  }

  function addEvent(event: string) {
    setTimeline(prev => [{ date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), event }, ...prev]);
  }

  if (!year) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8", fontFamily: "-apple-system, sans-serif" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <HomeIcon size={20} color="white"/>
        </div>
        <Loader2 size={20} color="#2563eb" className="animate-spin"/>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Loading your home...</p>
      </div>
    </div>
  );

  const roofAge = roofYear ? year - Number(roofYear) : null;
  const hvacAge = hvacYear ? year - Number(hvacYear) : null;
  const roofSt  = systemStatus(roofAge, 20, 25);
  const hvacSt  = systemStatus(hvacAge, 10, 15);

  // Only count ACTIVE findings (open or not_sure) in costs list
  // Completed/dismissed/monitored findings reflect real-world repairs
  // Merge inspection + photo findings so photo evidence also drives cost estimates
  const allFindings       = [...(inspectionResult?.findings ?? []), ...photoFindings];
  const activeFindings    = allFindings.filter((f, i) =>  isActiveFinding(f, i, findingStatuses));
  const completedFindings = allFindings.filter((f, i) => !isActiveFinding(f, i, findingStatuses));

  // Merge inspection + photo findings for scoring.
  // Photo findings tagged with source:"photo" are visually-derived — same
  // weight as inspection findings in the deterministic score.
  const allFindingsForScore = [...(inspectionResult?.findings ?? []), ...photoFindings];

  // Deterministic score — pure function, same inputs = same score every time
  const breakdown    = computeHealthScore(allFindingsForScore, findingStatuses, roofYear, hvacYear, year);
  const health       = breakdown.score;
  const healthColor  = health >= 90 ? "#22c55e" : health >= 80 ? "#84cc16" : health >= 65 ? C.amber : health >= 50 ? "#f97316" : C.red;
  const healthSt     = healthStatusInfo(health);
  const criticalCount = breakdown.deductions.filter(d => d.severity === "critical").length;
  const warningCount  = breakdown.deductions.filter(d => d.severity === "warning").length;

  // ── BUCKET 1: KNOWN ISSUES (from active inspection findings) ───────────────
  // High confidence — real findings, not resolved, deduplicated by category
  const costs: CostItem[] = [];
  const usedCategories = new Set<string>();

  // Category-specific fallback costs (when inspection doesn't provide a dollar estimate)
  // Keyed by lowercase substring match — first match wins
  const CATEGORY_COST: Array<{ match: string; critical: number; warning: number; info: number }> = [
    { match: "roof",           critical: 14000, warning: 4500,  info: 800  },
    { match: "hvac",           critical: 9000,  warning: 3500,  info: 500  },
    { match: "heating",        critical: 8000,  warning: 3000,  info: 400  },
    { match: "cooling",        critical: 7500,  warning: 2800,  info: 400  },
    { match: "ventilation",    critical: 3000,  warning: 1200,  info: 300  },
    { match: "foundation",     critical: 15000, warning: 6000,  info: 1000 },
    { match: "structural",     critical: 12000, warning: 5000,  info: 800  },
    { match: "electrical",     critical: 4500,  warning: 1800,  info: 400  },
    { match: "plumbing",       critical: 4000,  warning: 1500,  info: 300  },
    { match: "water heater",   critical: 1800,  warning: 900,   info: 200  },
    { match: "water",          critical: 3000,  warning: 1000,  info: 250  },
    { match: "sewer",          critical: 6000,  warning: 2500,  info: 500  },
    { match: "exterior",       critical: 5000,  warning: 2000,  info: 400  },
    { match: "siding",         critical: 8000,  warning: 3000,  info: 600  },
    { match: "window",         critical: 4000,  warning: 1500,  info: 300  },
    { match: "door",           critical: 2000,  warning: 800,   info: 200  },
    { match: "garage",         critical: 3500,  warning: 1200,  info: 300  },
    { match: "driveway",       critical: 3000,  warning: 1200,  info: 300  },
    { match: "deck",           critical: 5000,  warning: 2000,  info: 400  },
    { match: "insulation",     critical: 3000,  warning: 1200,  info: 300  },
    { match: "mold",           critical: 5000,  warning: 2000,  info: 500  },
    { match: "pest",           critical: 2500,  warning: 800,   info: 200  },
    { match: "termite",        critical: 3500,  warning: 1500,  info: 400  },
    { match: "fireplace",      critical: 3000,  warning: 1000,  info: 250  },
    { match: "chimney",        critical: 3500,  warning: 1200,  info: 300  },
    { match: "attic",          critical: 4000,  warning: 1500,  info: 300  },
    { match: "crawl",          critical: 4500,  warning: 1800,  info: 400  },
    { match: "drainage",       critical: 3500,  warning: 1200,  info: 300  },
    { match: "grading",        critical: 3000,  warning: 1000,  info: 250  },
  ];

  function getFallbackCost(category: string, severity: string): number {
    const cat = category.toLowerCase();
    const row = CATEGORY_COST.find(c => cat.includes(c.match));
    if (row) return row[severity as "critical" | "warning" | "info"] ?? row.warning;
    // Generic severity fallback if no category match
    return severity === "critical" ? 3000 : severity === "warning" ? 1200 : 350;
  }

  activeFindings.forEach(f => {
    const catKey = f.category.toLowerCase().trim();
    if (usedCategories.has(catKey)) return; // deduplicate
    usedCategories.add(catKey);
    const amount = (f.estimated_cost && f.estimated_cost > 0)
      ? f.estimated_cost
      : getFallbackCost(f.category, f.severity);
    costs.push({
      label:         categoryLabel(f.category),
      horizon:       f.severity === "critical" ? "Immediate" : f.severity === "warning" ? "Within 1–2 yrs" : "Ongoing",
      amount,
      severity:      f.severity,
      finding:       f,
      tradeCategory: f.category,
      bucket:        "known",
    });
  });

  // ── BUCKET 2: SYSTEM RISK (probability-weighted by age vs. lifespan) ───────
  // Expected cost = P(failure in 12 months) × replacement cost
  // Only added when NOT already covered by an inspection finding above
  const roofKey = toCategoryKey("Roof");
  const hvacKey = toCategoryKey("HVAC");
  const roofResolved = findingStatuses[roofKey] === "completed" || findingStatuses[roofKey] === "dismissed";
  const hvacResolved = findingStatuses[hvacKey] === "completed" || findingStatuses[hvacKey] === "dismissed";
  const roofAlreadyKnown = usedCategories.has("roof");
  const hvacAlreadyKnown = usedCategories.has("hvac") || usedCategories.has("hvac/heating") || usedCategories.has("hvac/cooling");

  // Roof: expected lifespan 20–25 yrs, replacement ~$14k
  if (roofAge !== null && !roofResolved && !roofAlreadyKnown) {
    const roofReplaceCost = 14000;
    let prob = 0;
    if      (roofAge < 10) prob = 0.03;
    else if (roofAge < 15) prob = 0.10;
    else if (roofAge < 20) prob = 0.25;
    else if (roofAge < 25) prob = 0.50;
    else                   prob = 0.75;
    const expectedCost = Math.round(roofReplaceCost * prob);
    if (expectedCost > 0) {
      costs.push({
        label:        "Roof — Age Risk",
        horizon:      roofAge >= 20 ? "Urgent — within 1–2 yrs" : roofAge >= 15 ? "Within 3–5 yrs" : "Monitor",
        amount:       expectedCost,
        severity:     roofAge >= 20 ? "critical" : roofAge >= 15 ? "warning" : "info",
        systemAge:    roofAge,
        tradeCategory:"Roof",
        bucket:       "risk",
        probability:  prob,
        isEstimate:   true,
      });
    }
  }

  // HVAC: expected lifespan 10–15 yrs, replacement ~$9k, service ~$500
  if (hvacAge !== null && !hvacResolved && !hvacAlreadyKnown) {
    const hvacReplaceCost = 9000;
    const hvacServiceCost = 500;
    let prob = 0;
    if      (hvacAge < 5)  prob = 0.03;
    else if (hvacAge < 8)  prob = 0.08;
    else if (hvacAge < 12) prob = 0.20;
    else if (hvacAge < 15) prob = 0.45;
    else                   prob = 0.70;
    const baseCost = hvacAge >= 12 ? hvacReplaceCost : hvacServiceCost;
    const expectedCost = Math.round(baseCost * prob);
    if (expectedCost > 0) {
      costs.push({
        label:        hvacAge >= 12 ? "HVAC — Age Risk" : "HVAC Service — Age Risk",
        horizon:      hvacAge >= 13 ? "Within 2–3 yrs" : "Annual",
        amount:       expectedCost,
        severity:     hvacAge >= 13 ? "warning" : "info",
        systemAge:    hvacAge,
        tradeCategory:"HVAC",
        bucket:       "risk",
        probability:  prob,
        isEstimate:   true,
      });
    }
  }

  // ── BUCKET 3: MAINTENANCE BASELINE ─────────────────────────────────────────
  // 1% of home value annually (capped at $4k, floor $1k) OR flat $1,500 fallback
  const maintenanceBaseline = homeValue
    ? Math.min(4000, Math.max(1000, Math.round(homeValue * 0.01)))
    : 1500;
  costs.push({
    label:      "Annual Maintenance",
    horizon:    "Ongoing",
    amount:     maintenanceBaseline,
    severity:   "info",
    bucket:     "maintenance",
    isEstimate: true,
  });

  // ── REPAIR FUND CALCULATIONS ────────────────────────────────────────────────
  const knownCosts       = costs.filter(c => c.bucket === "known");
  const riskCosts        = costs.filter(c => c.bucket === "risk");
  const maintenanceCosts = costs.filter(c => c.bucket === "maintenance");

  const URGENT_H = ["immediate", "urgent", "annual", "within 1", "within 2", "within 3", "6 month", "3 month", "ongoing"];
  const costsIn12Months = costs.filter(c => URGENT_H.some(h => c.horizon.toLowerCase().includes(h)));

  const knownTotal       = knownCosts.reduce((s, c) => s + c.amount, 0);
  const riskTotal        = riskCosts.reduce((s, c) => s + c.amount, 0);
  const maintenanceTotal = maintenanceCosts.reduce((s, c) => s + c.amount, 0);

  const repairFundNeeded  = knownTotal + riskTotal + maintenanceTotal;
  const repairFundAllTime = repairFundNeeded; // all buckets are 12-month scoped now
  const recommendedMonthly = repairFundNeeded > 0 ? Math.max(50, Math.ceil(repairFundNeeded / 12)) : 0;
  const weeklySmartSave = recommendedMonthly > 0 ? Math.round(recommendedMonthly / 4.33) : 0;
  const fundProgressPct = recommendedMonthly > 0 && monthlyContribution > 0
    ? Math.min(100, Math.round((monthlyContribution / recommendedMonthly) * 100))
    : 0;
  const fundOnTrack = monthlyContribution >= recommendedMonthly && recommendedMonthly > 0;
  const navItems = [
    { label: "Dashboard",    icon: <HomeIcon size={15}/> },
    { label: "Repairs",      icon: <TrendingDown size={15}/>, badge: costs.filter(c => c.severity === "critical").length || undefined },
    { label: "Vendors",      icon: <Users size={15}/> },
    { label: "My Jobs",      icon: <Briefcase size={15}/> },
    { label: "Maintenance",  icon: <Wrench size={15}/> },
    { label: "Documents",    icon: <FileText size={15}/> },
    { label: "Settings",     icon: <Settings size={15}/> },
  ];

  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", background: C.bg, fontFamily: "'DM Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap');
      `}</style>

      {/* ── Toast notification ────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, maxWidth: 480, width: "calc(100% - 40px)",
          background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
          border: `1.5px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`,
          borderRadius: 12, padding: "12px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          animation: "fadeInDown 0.2s ease",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: toast.type === "error" ? "#dc2626" : "#16a34a", lineHeight: 1.4 }}>
            {toast.msg}
          </span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: toast.type === "error" ? "#dc2626" : "#16a34a", flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showReviewModal && reviewFindings.length > 0 && (
        <InspectionReviewModal
          findings={reviewFindings}
          initialStatuses={findingStatuses}
          saving={savingStatuses}
          onSave={saveReviewStatuses}
          onSkip={() => setShowReviewModal(false)}
        />
      )}
      {showHealthModal && (
        <HealthScoreModal
          breakdown={breakdown}
          roofYear={roofYear} hvacYear={hvacYear} year={year}
          homeHealthReport={homeHealthReport}
          onClose={() => setShowHealthModal(false)}
          onFindVendors={handleFindVendors}
        />
      )}
      {showCompleteModal && completeModalTarget && (
        <RepairCompleteModal
          finding={completeModalTarget.finding}
          saving={savingComplete}
          onConfirm={confirmRepairComplete}
          onCancel={() => { setShowCompleteModal(false); setCompleteModalTarget(null); }}
        />
      )}
      {showCostModal && selectedCost && (
        <CostDetailModal
          item={selectedCost}
          findings={inspectionResult?.findings ?? []}
          onClose={() => { setShowCostModal(false); setSelectedCost(null); }}
          onFindVendors={handleFindVendors}
          warranty={warranty}
          insurance={insurance}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside style={{ width: 216, flexShrink: 0, display: isMobile ? "none" : "flex", flexDirection: "column", background: C.navy, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.accentDk})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 8px ${C.accent}80` }}>
              <HomeIcon size={15} color="white"/>
            </div>
            <span style={{ fontWeight: 700, fontSize: 17, color: "white", letterSpacing: "-0.3px" }}>BTLR</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.25)", marginLeft: 2, alignSelf: "flex-end", marginBottom: 2 }}>v2</span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 3, marginLeft: 42 }}>Home OS</p>
        </div>

        {/* ── Property Selector ── */}
        <div style={{ padding: "0 10px 10px", position: "relative" }} data-prop-selector>
          <button
            onClick={() => setShowPropDropdown(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", textAlign: "left" }}>
            <MapPin size={13} color="rgba(255,255,255,0.5)"/>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(() => { const p = allProperties.find(p => p.id === activePropertyId); return p ? (p.nickname || toTitleCase(p.address).split(",")[0]) : "My Property"; })()}
            </span>
            <ChevronDown size={13} color="rgba(255,255,255,0.4)" style={{ flexShrink: 0, transform: showPropDropdown ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}/>
          </button>
          {showPropDropdown && (
            <div style={{ position: "absolute", left: 10, right: 10, top: "calc(100% + 4px)", zIndex: 200, background: "#1e3a5f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              {allProperties.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <button onClick={() => switchProperty(p.id)}
                    style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: p.id === activePropertyId ? "rgba(255,255,255,0.1)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", minWidth: 0 }}>
                    <HomeIcon size={12} color={p.id === activePropertyId ? "white" : "rgba(255,255,255,0.4)"}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: p.id === activePropertyId ? "white" : "rgba(255,255,255,0.7)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.nickname || toTitleCase(p.address).split(",")[0]}
                      </p>
                      {p.nickname && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toTitleCase(p.address)}</p>}
                    </div>
                    {p.id === activePropertyId && <Check size={12} color="white" style={{ flexShrink: 0 }}/>}
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteProperty(p.id); }}
                    title="Delete property"
                    style={{ flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", borderRadius: 6, marginRight: 6, opacity: 0.4 }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}>
                    <X size={12} color="white"/>
                  </button>
                </div>
              ))}
              <button onClick={createBlankProperty} disabled={addingProp}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "transparent", border: "none", cursor: addingProp ? "wait" : "pointer", textAlign: "left", opacity: addingProp ? 0.6 : 1 }}>
                <Plus size={12} color={C.accentLt}/>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.accentLt }}>{addingProp ? "Creating…" : "+ Add Property"}</span>
              </button>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {navItems.map(({ label, icon, badge }) => (
            <button key={label} onClick={() => {
              setNav(label);
              // Direct sidebar click to Vendors = generic browse (clears CTA prefill)
              if (label === "Vendors") { setVendorPrefill(null); setVendorContext(null); setVendorIssue(null); }
            }} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 12px", borderRadius: 10, fontSize: 13,
              border: "none", cursor: "pointer", textAlign: "left", width: "100%",
              background: nav === label ? `${C.accent}20` : "transparent",
              color: nav === label ? "white" : "rgba(255,255,255,0.5)",
              fontWeight: nav === label ? 600 : 400, transition: "all 0.15s",
              position: "relative",
            }}>
              {icon} {label}
              {badge ? (
                <span style={{ marginLeft: "auto", background: C.red, color: "white", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99 }}>
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <User size={13} color="rgba(255,255,255,0.6)"/>
              </div>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{user.email}</span>
            </div>
          )}
          <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
            <LogOut size={13}/> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", padding: isMobile ? "16px 16px 100px" : "36px 28px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>

          {/* Mobile Property Selector */}
          {isMobile && (
            <div style={{ position: "relative" }} data-prop-selector>
              <button onClick={() => setShowPropDropdown(o => !o)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 20, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", maxWidth: "100%" }}>
                <MapPin size={12} color={C.accent}/>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                  {(() => { const p = allProperties.find(p => p.id === activePropertyId); return p ? (p.nickname || toTitleCase(p.address).split(",")[0]) : "My Property"; })()}
                </span>
                <ChevronDown size={12} color={C.text3} style={{ transform: showPropDropdown ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}/>
              </button>
              {showPropDropdown && (
                <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 300, minWidth: 240, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
                  {allProperties.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
                      <button onClick={() => switchProperty(p.id)}
                        style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: p.id === activePropertyId ? C.accentLt + "15" : "transparent", border: "none", cursor: "pointer", textAlign: "left", minWidth: 0 }}>
                        <HomeIcon size={12} color={p.id === activePropertyId ? C.accent : C.text3}/>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.nickname || toTitleCase(p.address).split(",")[0]}
                        </span>
                        {p.id === activePropertyId && <Check size={12} color={C.accent}/>}
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteProperty(p.id); }}
                        title="Delete property"
                        style={{ flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", borderRadius: 6, marginRight: 6, color: C.text3 }}
                        onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                        onMouseLeave={e => (e.currentTarget.style.color = C.text3)}>
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                  <button onClick={createBlankProperty} disabled={addingProp}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "transparent", border: "none", cursor: addingProp ? "wait" : "pointer", textAlign: "left", opacity: addingProp ? 0.6 : 1 }}>
                    <Plus size={12} color={C.accent}/>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.accent }}>{addingProp ? "Creating…" : "+ Add Property"}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Header */}
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: "-0.5px", margin: 0 }}>
              {nav === "Vendors" ? "Repairs & Vendors"
               : nav === "My Jobs" ? "My Jobs"
               : nav === "Maintenance" ? "Maintenance Schedule"
               : nav === "Repairs" ? "Repairs & Upcoming Costs"
               : nav === "Documents" ? "Documents"
               : nav === "Settings" ? "Settings"
               : address && address !== "My Home" ? toTitleCase(address) : "Dashboard"}
            </h1>
            <p style={{ color: C.text3, fontSize: 14, marginTop: 3 }}>
              {nav === "Vendors" ? "AI-powered contractor routing for your home"
               : nav === "My Jobs" ? "Track all your contractor requests in real time"
               : nav === "Maintenance" ? "Upcoming and recommended maintenance tasks"
               : nav === "Repairs" ? "Upcoming repair costs and actionable next steps"
               : nav === "Documents" ? "Receipts, warranties, and inspection reports"
               : nav === "Settings" ? "Manage your account and property"
               : "Home Dashboard"}
            </p>
          </div>

          {/* ── Vendors ───────────────────────────────────────────────── */}
          {nav === "Vendors" && (
            <VendorsView
              address={address}
              inspectionFindings={inspectionResult?.findings ?? []}
              userEmail={user?.email}
              userId={user?.id}
              prefillTrade={vendorPrefill ?? undefined}
              prefillContext={vendorContext ?? undefined}
              prefillIssue={vendorIssue ?? undefined}
            />
          )}

          {/* ── My Jobs ───────────────────────────────────────────────── */}
          {nav === "My Jobs" && <MyJobsView />}

          {/* ── Repairs full page ─────────────────────────────────────── */}
          {nav === "Repairs" && (() => {
            if (allFindings.length === 0) {
              return (
                <div style={{ ...card(), textAlign: "center", padding: "48px 24px" }}>
                  <CheckCircle2 size={36} color={C.green} style={{ margin: "0 auto 14px" }}/>
                  <p style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>No inspection findings yet</p>
                  <p style={{ fontSize: 14, color: C.text3 }}>Upload an inspection report in the Home Health section to track and manage repairs.</p>
                </div>
              );
            }
            const repGroupMap = new Map<string, { label: string; items: { f: Finding; globalIdx: number }[] }>();
            for (let gi = 0; gi < allFindings.length; gi++) {
              const f = allFindings[gi];
              const gk = toGroupKey(f.category);
              const meta = GROUP_META[gk] ?? GROUP_META.general;
              if (!repGroupMap.has(gk)) repGroupMap.set(gk, { label: meta.label, items: [] });
              repGroupMap.get(gk)!.items.push({ f, globalIdx: gi });
            }
            const repGroups = [...repGroupMap.entries()].map(([gk, v]) => ({ gk, ...v }));
            const repStatusConfig: Record<FindingStatus, { label: string; color: string; bg: string }> = {
              open:      { label: "Open",       color: C.red,    bg: C.redBg   },
              completed: { label: "Completed",  color: C.green,  bg: C.greenBg },
              monitored: { label: "Monitoring", color: C.accent, bg: "#eff6ff" },
              not_sure:  { label: "Not Sure",   color: C.amber,  bg: C.amberBg },
              dismissed: { label: "Dismissed",  color: C.text3,  bg: C.bg      },
            };
            const repArchivedItems: Array<{ f: Finding; globalIdx: number; fk: string }> = [];
            allFindings.forEach((f, i) => {
              const fk = findingKey(f, i);
              const s = findingStatuses[fk] ?? "open";
              if (s === "completed") repArchivedItems.push({ f, globalIdx: i, fk });
            });
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                  {/* Color key strip */}
                  <div style={{ padding: "10px 16px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    {[
                      { color: C.red,    label: "High Impact" },
                      { color: C.amber,  label: "Medium Impact" },
                      { color: "#eab308", label: "Low Impact" },
                      { color: C.text3,  label: "Informational" },
                    ].map(({ color, label }) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 3, height: 14, borderRadius: 2, background: color, display: "inline-block", flexShrink: 0 }}/>
                        <span style={{ fontSize: 11, color: C.text3 }}>{label}</span>
                      </div>
                    ))}
                  </div>
                  {/* Summary bar */}
                  <div style={{ display: "flex", gap: 16, padding: "10px 16px", background: C.bg, borderBottom: `1px solid ${C.border}`, justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 14 }}>
                      <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{allFindings.filter(f => f.severity === "critical").length} critical</span>
                      <span style={{ fontSize: 12, color: C.amber, fontWeight: 600 }}>{allFindings.filter(f => f.severity === "warning").length} warnings</span>
                      <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>{completedFindings.length} resolved</span>
                    </div>
                    <button onClick={() => { const all = inspectionResult?.findings ?? []; const scored = all.filter(f => isScoredFinding(f.category, f.description) && (f.severity === "critical" || f.severity === "warning")); const fallback = all.filter(f => isScoredFinding(f.category, f.description)); setReviewFindings(scored.length > 0 ? scored : fallback.length > 0 ? fallback : all); setShowReviewModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: "none", border: "none", cursor: "pointer" }}>Review All →</button>
                  </div>
                  {/* Category groups */}
                  {repGroups.map(({ gk, label, items }, gi) => {
                    const isGrpOpen = expandedGroups.has(gk);
                    const meta = GROUP_META[gk] ?? GROUP_META.general;
                    const hasCritical = items.some(({ f }) => f.severity === "critical");
                    const hasWarning  = items.some(({ f }) => f.severity === "warning");
                    const allResolved = items.every(({ f, globalIdx }) => { const s = findingStatuses[findingKey(f, globalIdx)] ?? "open"; return s === "completed" || s === "dismissed"; });
                    const worstColor = hasCritical ? C.red : hasWarning ? C.amber : allResolved ? C.green : C.text3;
                    const worstLabel = hasCritical ? "Critical" : hasWarning ? "Warning" : allResolved ? "Resolved" : "Good";
                    const worstBg    = hasCritical ? C.redBg   : hasWarning ? C.amberBg : allResolved ? C.greenBg : C.bg;
                    return (
                      <div key={gk} style={{ borderBottom: gi < repGroups.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <button onClick={() => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(gk)) next.delete(gk); else next.add(gk); return next; })}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = C.bg; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: worstBg, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${worstColor}25`, flexShrink: 0 }}>{meta.iconFn(worstColor)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: worstBg, color: worstColor }}>{worstLabel}</span>
                            </div>
                            <span style={{ fontSize: 11, color: C.text3 }}>{items.length} finding{items.length !== 1 ? "s" : ""}{allResolved ? " — all resolved" : hasCritical ? " — needs attention" : ""}</span>
                          </div>
                          <div style={{ transition: "transform 0.2s", transform: isGrpOpen ? "rotate(180deg)" : "rotate(0deg)" }}><ChevronDown size={14} color={C.text3}/></div>
                        </button>
                        {isGrpOpen && (
                          <div style={{ padding: "0 16px 14px", background: "#fafbfc" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {items.map(({ f, globalIdx }, fi) => {
                                const fk = findingKey(f, globalIdx);
                                const status = findingStatuses[fk] ?? "open";
                                const cfg = repStatusConfig[status];
                                const isResolved = status === "completed" || status === "dismissed";
                                const impact = getScoreImpact(f.category, f.severity, f.description);
                                const cardBorder = isResolved ? C.border : `${impact.color}40`;
                                const cardBg = isResolved ? C.surface : impact.bg;
                                return (
                                  <div key={fi} style={{
                                    background: C.surface,
                                    borderRadius: 12,
                                    padding: "16px 18px",
                                    border: `1px solid ${C.border}`,
                                    borderLeft: `4px solid ${isResolved ? C.green : impact.color}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 7,
                                    opacity: isResolved ? 0.72 : 1,
                                  }}>
                                    {/* Category label (small, muted) */}
                                    <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                                      {categoryLabel(f.category)}
                                    </span>
                                    {/* Issue title (bold, human-readable) */}
                                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.4 }}>
                                      {f.title || f.issue_type || f.description?.slice(0, 90) || "Issue"}
                                    </p>
                                    {/* Description */}
                                    {f.description && (
                                      <p style={{ fontSize: 13, color: C.text3, margin: 0, lineHeight: 1.55 }}>{f.description}</p>
                                    )}
                                    {/* Bottom row: cost + single impact indicator + action buttons */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                                      {/* Cost */}
                                      {f.estimated_cost != null && (
                                        <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>
                                          Est. ${f.estimated_cost.toLocaleString()}
                                        </span>
                                      )}
                                      {/* Single impact indicator — active repairs only */}
                                      {!isResolved && impact.affects && (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: impact.color + "14", color: impact.color }}>
                                          {impact.label} · Affects Home Health Score
                                        </span>
                                      )}
                                      {/* Completed state badge */}
                                      {isResolved && status === "completed" && (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: C.greenBg, color: C.green }}>
                                          ✓ Completed{impact.affects ? " · Score Updated" : ""}
                                        </span>
                                      )}
                                      {isResolved && status === "dismissed" && (
                                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: C.bg, color: C.text3 }}>
                                          Dismissed
                                        </span>
                                      )}
                                      {/* Action buttons — open repairs only */}
                                      {!isResolved && (
                                        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                          <select value={status} onChange={e => toggleFindingStatus(f, globalIdx, e.target.value as FindingStatus)}
                                            style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text2, cursor: "pointer", outline: "none" }}>
                                            <option value="open">Open</option>
                                            <option value="monitored">Monitoring</option>
                                            <option value="not_sure">Not Sure</option>
                                            <option value="dismissed">Dismissed</option>
                                          </select>
                                          <button onClick={() => { setChatMessages([{ role: "user", content: f.description ?? f.category }]); askAI(f.description ?? f.category); setNav("Dashboard"); }}
                                            style={{ fontSize: 11, fontWeight: 600, color: C.accent, background: "#eff6ff", border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                                            <Shield size={10}/> Check Coverage
                                          </button>
                                          <button onClick={() => handleFindVendors(f.category, f.category, f.description)}
                                            style={{ fontSize: 11, fontWeight: 600, color: "white", background: C.accent, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                                            <Users size={10}/> Find Vendors
                                          </button>
                                          <button onClick={() => openCompleteModal(f, globalIdx)}
                                            style={{ fontSize: 11, fontWeight: 600, color: C.green, background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                                            <CheckCircle2 size={10}/> Mark Complete
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Repair Archives */}
                {repArchivedItems.length > 0 && (
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <button
                      onClick={() => setArchivesExpanded(p => !p)}
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: C.surface, border: "none", cursor: "pointer", gap: 8 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Repair Archives</span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 9px", borderRadius: 20, background: C.greenBg, color: C.green }}>{repArchivedItems.length}</span>
                      </div>
                      <span style={{ fontSize: 11, color: C.text3, transform: archivesExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>▼</span>
                    </button>
                    {archivesExpanded && (
                      <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
                        {repArchivedItems.map(({ f, globalIdx, fk }, idx) => {
                          const meta = repairCompletions[fk];
                          const impact = getScoreImpact(f.category, f.severity, f.description);
                          const completedDate = meta?.completed_at
                            ? new Date(meta.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : null;
                          return (
                            <div key={fk + idx} style={{ padding: "14px 18px", borderBottom: idx < repArchivedItems.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", flexDirection: "column", gap: 5, borderLeft: "4px solid transparent", borderLeftColor: C.green, opacity: 0.75 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                                {categoryLabel(f.category)}
                              </span>
                              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.4 }}>
                                {f.title || f.issue_type || f.description?.slice(0, 90) || "Issue"}
                              </p>
                              {f.description && (
                                <p style={{ fontSize: 13, color: C.text3, margin: 0, lineHeight: 1.5 }}>{f.description}</p>
                              )}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: C.greenBg, color: C.green }}>
                                  ✓ Completed{meta?.was_scorable ? " · Score Updated" : ""}
                                </span>
                                {completedDate && (
                                  <span style={{ fontSize: 11, color: C.text3 }}>📅 {completedDate}</span>
                                )}
                                {meta?.receipt_url && (
                                  <span style={{ fontSize: 11, color: C.green }}>📎 Receipt attached</span>
                                )}
                                {meta?.notes && (
                                  <span style={{ fontSize: 11, color: C.text3, fontStyle: "italic" }}>"{meta.notes.length > 60 ? meta.notes.slice(0, 60) + "…" : meta.notes}"</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Maintenance ───────────────────────────────────────────── */}
          {nav === "Maintenance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { icon: <HomeIcon size={16} color={C.text3}/>, title: "Roof Inspection",       due: "Annual",         note: roofYear ? `Installed ${roofYear} · Check for wear` : "Upload inspection to track", status: "upcoming" },
                { icon: <Wind size={16} color={C.text3}/>,     title: "HVAC Filter Change",    due: "Every 3 months", note: "Replace air filter — improves efficiency by up to 15%",                            status: "due" },
                { icon: <Wrench size={16} color={C.text3}/>,   title: "Furnace Tune-up",       due: "Annual (Fall)",  note: "Schedule before heating season",                                                    status: "upcoming" },
                { icon: <Droplets size={16} color={C.text3}/>, title: "Water Heater Flush",    due: "Annual",         note: "Removes sediment, extends life by 2–3 years",                                       status: "upcoming" },
                { icon: <Eye size={16} color={C.text3}/>,      title: "Window Seal Check",     due: "Annual",         note: "Look for fogging or drafts between panes",                                          status: "upcoming" },
                { icon: <Activity size={16} color={C.text3}/>, title: "Gutter Cleaning",       due: "Twice a year",   note: "Spring and Fall — prevents water damage",                                           status: "upcoming" },
                { icon: <Bug size={16} color={C.text3}/>,      title: "Pest Inspection",       due: "Annual",         note: "Termite and pest prevention check",                                                  status: "upcoming" },
                { icon: <Zap size={16} color={C.text3}/>,      title: "Smoke Detector Test",   due: "Every 6 months", note: "Test all detectors, replace batteries",                                              status: "due" },
              ].map((item, i) => (
                <div key={i} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 1px 4px rgba(15,31,61,0.05)" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{item.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: C.text, margin: 0 }}>{item.title}</p>
                    <p style={{ fontSize: 12, color: C.text3, margin: "3px 0 0" }}>{item.note}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: C.text3 }}>{item.due}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: item.status === "due" ? C.amberBg : C.greenBg, color: item.status === "due" ? C.amber : C.green }}>
                      {item.status === "due" ? "Due Soon" : "Upcoming"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Documents ─────────────────────────────────────────────── */}
          {nav === "Documents" && (() => {
            const docSections = [
              {
                id: "inspection",
                label: "Home Inspection",
                icon: <FileText size={15} color={C.accent}/>,
                iconBg: "#eff6ff",
                accentColor: C.accent,
                status: inspectionDoc
                  ? `${inspectionDoc.name} · Uploaded`
                  : inspectDone
                  ? "Report analyzed — original file not on record"
                  : "No inspection report uploaded",
                hasDoc: !!inspectionDoc || inspectDone,
              },
              {
                id: "warranty",
                label: "Home Warranty",
                icon: <Shield size={15} color="#7c3aed"/>,
                iconBg: "#faf5ff",
                accentColor: "#7c3aed",
                status: warranty
                  ? `${warranty.provider ?? "Uploaded"} · ${warranty.expirationDate ? `Expires ${warranty.expirationDate}` : "Active"}`
                  : "No document uploaded",
                hasDoc: !!warranty,
              },
              {
                id: "insurance",
                label: "Home Insurance",
                icon: <Shield size={15} color="#0891b2"/>,
                iconBg: "#f0f9ff",
                accentColor: "#0891b2",
                status: insurance
                  ? `${insurance.provider ?? "Uploaded"} · ${insurance.expirationDate ? `Renews ${insurance.expirationDate}` : "Active"}`
                  : "No document uploaded",
                hasDoc: !!insurance,
              },
              {
                id: "repairs",
                label: "Repair Documents",
                icon: <CheckCircle2 size={15} color={C.green}/>,
                iconBg: C.greenBg,
                accentColor: C.green,
                status: repairDocs.length > 0 ? `${repairDocs.length} repair${repairDocs.length > 1 ? "s" : ""} on record` : "No receipts uploaded",
                hasDoc: repairDocs.length > 0,
              },
              {
                id: "other",
                label: "Other Documents",
                icon: <FileText size={15} color={C.text3}/>,
                iconBg: C.bg,
                accentColor: C.accent,
                status: docs.length > 0 ? `${docs.length} file${docs.length > 1 ? "s" : ""} uploaded` : "No documents uploaded",
                hasDoc: docs.length > 0,
              },
            ];

            return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Accordion card */}
              <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                {docSections.map((sec, si) => {
                  const isOpen = openDocSection === sec.id;
                  return (
                    <div key={sec.id} style={{ borderBottom: si < docSections.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      {/* Row header */}
                      <button
                        onClick={() => setOpenDocSection(isOpen ? null : sec.id)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 12,
                          padding: "14px 18px", background: isOpen ? C.bg : "transparent",
                          border: "none", cursor: "pointer", textAlign: "left",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = C.bg; }}
                        onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: sec.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${sec.accentColor}20` }}>
                          {sec.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{sec.label}</div>
                          <div style={{ fontSize: 12, color: sec.hasDoc ? C.text3 : C.text3, marginTop: 1 }}>{sec.status}</div>
                        </div>
                        {sec.hasDoc && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: C.greenBg, color: C.green, marginRight: 6 }}>✓</span>
                        )}
                        <div style={{ transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}>
                          <ChevronDown size={15} color={C.text3}/>
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isOpen && (
                        <div style={{ padding: "16px 18px 20px", background: "#fafbfc", borderTop: `1px solid ${C.border}` }}>

                          {/* ── Inspection Report content ── */}
                          {sec.id === "inspection" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
                              Your home inspection report. Upload a new report to re-analyze and update your Home Health Score.
                            </p>
                            {inspectionDoc ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                                  <FileText size={18} color={C.accent} style={{ flexShrink: 0 }}/>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inspectionDoc.name}</p>
                                    <p style={{ fontSize: 12, color: C.text3, margin: "2px 0 0" }}>Inspection Report</p>
                                  </div>
                                  {inspectionDoc.url && (
                                    <a href={inspectionDoc.url} target="_blank" rel="noopener noreferrer"
                                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, background: C.accent, color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none", flexShrink: 0 }}>
                                      <ExternalLink size={11}/> View PDF
                                    </a>
                                  )}
                                </div>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", width: "fit-content" }}>
                                  {inspecting ? <><Loader2 size={11} className="animate-spin"/> Analyzing…</> : <><Upload size={11}/> Upload New Report</>}
                                  <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
                                </label>
                              </div>
                            ) : inspectDone ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ background: "#fefce8", border: "1.5px solid #fde68a", borderRadius: 10, padding: "12px 14px" }}>
                                  <p style={{ fontSize: 13, color: "#92400e", margin: 0 }}>Report was analyzed but the original file is not on record. Re-upload to save a permanent copy.</p>
                                </div>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", width: "fit-content" }}>
                                  {inspecting ? <><Loader2 size={11} className="animate-spin"/> Analyzing…</> : <><Upload size={11}/> Upload Report</>}
                                  <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
                                </label>
                              </div>
                            ) : (
                              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${inspecting ? C.accent : C.border}`, background: inspecting ? "#eff6ff" : "#fafbfc" }}>
                                {inspecting
                                  ? <><Loader2 size={20} color={C.accent} className="animate-spin"/><span style={{ fontSize: 14, color: C.accent }}>Analyzing report…</span></>
                                  : <><FileText size={20} color={C.text3}/><span style={{ fontSize: 14, color: C.text }}>Upload inspection report PDF</span><span style={{ fontSize: 12, color: C.text3 }}>BTLR will extract all findings and score your home</span></>
                                }
                                <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
                              </label>
                            )}
                          </>)}

                          {/* ── Warranty content ── */}
                          {sec.id === "warranty" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
                              Upload your home warranty or maintenance policy. BTLR will extract your coverage, exclusions, service fee, and claim contact info.
                            </p>
                            {!warranty ? (
                              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${parsingWarranty ? "#7c3aed" : "#e9d5ff"}`, background: parsingWarranty ? "#faf5ff" : "#faf5ff" }}>
                                {parsingWarranty
                                  ? <><Loader2 size={20} color="#7c3aed" className="animate-spin"/><span style={{ fontSize: 14, color: "#7c3aed" }}>Parsing warranty document…</span></>
                                  : <><Shield size={20} color="#7c3aed"/><span style={{ fontSize: 14, color: C.text }}>Upload home warranty or maintenance policy</span><span style={{ fontSize: 12, color: C.text3 }}>PDF or text document</span></>
                                }
                                <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                              </label>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid #7c3aed", color: "#7c3aed", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                    {parsingWarranty ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                    {parsingWarranty ? "Parsing…" : "Replace"}
                                    <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                                  </label>
                                </div>
                                <div style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 12, padding: "14px 16px" }}>
                                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>
                                    {warranty.provider ?? "Warranty"}{warranty.planName ? ` — ${warranty.planName}` : ""}
                                  </p>
                                  <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
                                    {[warranty.policyNumber ? `#${warranty.policyNumber}` : null, warranty.serviceFee ? `$${warranty.serviceFee} service fee` : null, warranty.expirationDate ? `Expires ${warranty.expirationDate}` : null].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                {(warranty.claimUrl || warranty.claimPhone || warranty.claimEmail) && (
                                  <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px" }}>
                                    <p style={{ fontSize: 12, fontWeight: 700, color: C.accent, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>📋 File a Claim</p>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      {warranty.claimUrl && <a href={warranty.claimUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, background: "#7c3aed", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}><ExternalLink size={12}/> File Online</a>}
                                      {warranty.claimPhone && <a href={`tel:${warranty.claimPhone.replace(/\D/g, "")}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>📞 {warranty.claimPhone}</a>}
                                      {warranty.claimEmail && <a href={`mailto:${warranty.claimEmail}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>✉️ Email Claims</a>}
                                    </div>
                                    {warranty.responseTime && <p style={{ fontSize: 11, color: C.text3, margin: "8px 0 0" }}>⏱ Typical response: {warranty.responseTime}</p>}
                                  </div>
                                )}
                                {(warranty.coverageItems?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>✅ What&apos;s Covered ({warranty.coverageItems!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {warranty.coverageItems!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(warranty.exclusions?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>❌ Not Covered ({warranty.exclusions!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {warranty.exclusions!.map((item, i) => <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {warranty.coverageLimits && Object.keys(warranty.coverageLimits).length > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>💰 Per-System Limits</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {Object.entries(warranty.coverageLimits).map(([sys, limit]) => <span key={sys} style={{ fontSize: 12, background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 6, padding: "3px 9px", color: C.amber }}>{sys}: ${(limit as number).toLocaleString()}</span>)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>)}

                          {/* ── Insurance content ── */}
                          {sec.id === "insurance" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
                              Upload your homeowners insurance declarations page. BTLR will extract coverage amounts, deductibles, exclusions, and claim contact info.
                            </p>
                            {!insurance ? (
                              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${parsingInsurance ? "#0891b2" : "#bae6fd"}`, background: "#f0f9ff" }}>
                                {parsingInsurance
                                  ? <><Loader2 size={20} color="#0891b2" className="animate-spin"/><span style={{ fontSize: 14, color: "#0891b2" }}>Parsing insurance documents…</span></>
                                  : <><Shield size={20} color="#0891b2"/><span style={{ fontSize: 14, color: C.text }}>Upload homeowners insurance policy or dec page</span><span style={{ fontSize: 12, color: C.text3 }}>PDF or text — select multiple files at once</span></>
                                }
                                <input key={insuranceFileKey} type="file" accept=".pdf,.txt" multiple style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                              </label>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  {insuranceDocCount > 0 && (
                                    <span style={{ fontSize: 11, color: C.text3 }}>
                                      {insuranceDocCount} document{insuranceDocCount !== 1 ? "s" : ""} uploaded
                                    </span>
                                  )}
                                  <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid #0891b2", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                      {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                      {parsingInsurance ? "Parsing…" : "Add / Replace"}
                                      <input key={insuranceFileKey} type="file" accept=".pdf,.txt" multiple style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                                    </label>
                                  </div>
                                </div>
                                <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 12, padding: "14px 16px" }}>
                                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>
                                    {insurance.provider ?? "Insurance"}{insurance.policyType ? ` — ${insurance.policyType}` : ""}
                                  </p>
                                  <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
                                    {[insurance.policyNumber ? `#${insurance.policyNumber}` : null, (insurance.annualPremium ?? insurance.premium) ? `$${(insurance.annualPremium ?? insurance.premium)?.toLocaleString()}/yr` : null, insurance.deductibleStandard ? `$${insurance.deductibleStandard.toLocaleString()} deductible` : null, insurance.expirationDate ? `Renews ${insurance.expirationDate}` : null].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                {(insurance.dwellingCoverage || insurance.personalProperty || insurance.liabilityCoverage) && (
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                    {insurance.dwellingCoverage   && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Dwelling</div><div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>${insurance.dwellingCoverage.toLocaleString()}</div></div>}
                                    {insurance.personalProperty   && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Personal Property</div><div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>${insurance.personalProperty.toLocaleString()}</div></div>}
                                    {insurance.liabilityCoverage  && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Liability</div><div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>${insurance.liabilityCoverage.toLocaleString()}</div></div>}
                                    {insurance.deductibleStandard && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Deductible</div><div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>${insurance.deductibleStandard.toLocaleString()}</div></div>}
                                  </div>
                                )}
                                {(insurance.claimUrl || insurance.claimPhone || insurance.claimEmail) && (
                                  <div style={{ background: "#e0f2fe", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px" }}>
                                    <p style={{ fontSize: 12, fontWeight: 700, color: "#0891b2", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>📋 File a Claim</p>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      {insurance.claimUrl   && <a href={insurance.claimUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, background: "#0891b2", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}><ExternalLink size={12}/> File Online</a>}
                                      {insurance.claimPhone && <a href={`tel:${insurance.claimPhone.replace(/\D/g, "")}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>📞 {insurance.claimPhone}</a>}
                                      {insurance.claimEmail && <a href={`mailto:${insurance.claimEmail}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>✉️ Email Claims</a>}
                                    </div>
                                    {insurance.claimHours && <p style={{ fontSize: 11, color: C.text3, margin: "8px 0 0" }}>⏱ {insurance.claimHours}</p>}
                                  </div>
                                )}
                                {(insurance.coverageItems?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>✅ What&apos;s Covered ({insurance.coverageItems!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.coverageItems!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(insurance.endorsements?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>➕ Endorsements ({insurance.endorsements!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.endorsements!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#e0f2fe", border: "1px solid #7dd3fc", borderRadius: 6, padding: "3px 9px", color: "#0369a1" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(insurance.exclusions?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>❌ Not Covered ({insurance.exclusions!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.exclusions!.map((item, i) => <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>)}

                          {/* ── Repair Documents content ── */}
                          {sec.id === "repairs" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
                              Upload invoices, receipts, or contractor reports for completed work. BTLR will parse what was repaired and update your Home Health Score automatically.
                            </p>
                            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${uploadingRepair ? C.green : "#bbf7d0"}`, background: uploadingRepair ? C.greenBg : "#f0fdf4" }}>
                              {uploadingRepair
                                ? <><Loader2 size={20} color={C.green} className="animate-spin"/><span style={{ fontSize: 14, color: C.green }}>Parsing repair document…</span></>
                                : <><CheckCircle2 size={20} color={C.green}/><span style={{ fontSize: 14, color: C.text }}>Upload invoice, receipt, or contractor report</span><span style={{ fontSize: 12, color: C.text3 }}>PDF, image, or document</span></>
                              }
                              <input ref={repairRef} type="file" style={{ display: "none" }} onChange={uploadRepairDoc} disabled={uploadingRepair} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"/>
                            </label>
                            {repairDocs.length > 0 && (
                              <div style={{ marginTop: 16 }}>
                                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Repair History</p>
                                {repairDocs.map((r, i) => (
                                  <div key={i} style={{ background: C.greenBg, border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <CheckCircle2 size={13} color={C.green}/>
                                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{formatLabel(r.category) || "Repair"}{r.vendor ? ` — ${r.vendor}` : ""}</span>
                                      {r.cost ? <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: C.green }}>${r.cost.toLocaleString()}</span> : null}
                                    </div>
                                    {r.summary && <p style={{ fontSize: 12, color: C.text2, margin: "0 0 4px 21px", lineHeight: 1.5 }}>{r.summary}</p>}
                                    {r.autoResolved && r.autoResolved.length > 0 && (
                                      <p style={{ fontSize: 11, color: C.green, margin: "0 0 0 21px", display: "flex", alignItems: "center", gap: 3 }}>
                                        <CheckCircle2 size={10}/> Auto-resolved {r.autoResolved.length} inspection finding{r.autoResolved.length > 1 ? "s" : ""}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>)}

                          {/* ── Other Documents content ── */}
                          {sec.id === "other" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>Warranties, permits, HOA docs, and other property files.</p>
                            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${docLoading ? C.accent : C.border}`, background: docLoading ? "#eff6ff" : "#fafbfc" }}>
                              {docLoading ? <><Loader2 size={20} color={C.accent} className="animate-spin"/><span style={{ fontSize: 14, color: C.accent }}>Uploading…</span></> : <><CloudUpload size={20} color={C.text3}/><span style={{ fontSize: 14, color: C.text }}>Click to upload file</span></>}
                              <input ref={docRef} type="file" style={{ display: "none" }} onChange={uploadDoc} disabled={docLoading}/>
                            </label>
                            {docs.length > 0 && (
                              <div style={{ marginTop: 14 }}>
                                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 10px" }}>Uploaded Files</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {docs.map((doc, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: 9, padding: "9px 13px" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                                        <FileText size={13} color={C.text3} style={{ flexShrink: 0 }}/>
                                        <span style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                        {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>View <ExternalLink size={10}/></a> : <span style={{ fontSize: 12, color: C.text3 }}>Unavailable</span>}
                                        <button onClick={() => deleteDoc(doc)} title="Delete file" style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", borderRadius: 5, color: C.text3 }}
                                          onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                                          onMouseLeave={e => (e.currentTarget.style.color = C.text3)}>
                                          <X size={12}/>
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>)}

                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* ── Settings ──────────────────────────────────────────────── */}
          {nav === "Settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: "20px 22px" }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16, marginTop: 0 }}>Your Property</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { label: "Address / Name", val: address,  set: setAddress,  ph: "123 Main St, City, ST" },
                    { label: "Roof Year",       val: roofYear, set: setRoofYear, ph: "e.g. 2005" },
                    { label: "HVAC Year",       val: hvacYear, set: setHvacYear, ph: "e.g. 2015" },
                  ].map(({ label, val, set, ph }) => (
                    <div key={label}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 5 }}>{label}</label>
                      <input value={val} onChange={e => set(e.target.value)} placeholder={ph} style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 16, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
                    </div>
                  ))}
                </div>
                <button onClick={saveSettings} disabled={savingSettings} style={{ marginTop: 16, padding: "10px 22px", borderRadius: 10, background: settingsSaved ? C.green : C.accent, border: "none", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, opacity: savingSettings ? 0.7 : 1 }}>
                  {savingSettings ? <><Loader2 size={13} className="animate-spin"/> Saving…</> : settingsSaved ? <><CheckCircle2 size={13}/> Saved!</> : "Save Property Info"}
                </button>
              </div>
              {[
                { label: "Account Email",       value: user?.email ?? "—",           connected: false },
                { label: "OpenAI",              value: "Connected",                   connected: true },
                { label: "Google Maps",         value: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ? "Connected" : "Not set — add NEXT_PUBLIC_GOOGLE_MAPS_KEY in Vercel", connected: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY },
                { label: "Email Notifications", value: "Coming soon", connected: false },
              ].map((item, i) => (
                <div key={i} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: "14px 18px" }}>
                  <p style={{ fontSize: 11, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{item.label}</p>
                  <p style={{ fontSize: 14, color: item.connected ? C.green : C.text, fontWeight: 500, margin: "3px 0 0",
                    display: "flex", alignItems: "center", gap: 5 }}>
                    {item.connected && <CheckCircle2 size={13} color={C.green}/>}
                    {item.value}
                  </p>
                </div>
              ))}
              <button onClick={logout} style={{ padding: "12px 20px", borderRadius: 12, border: `1.5px solid ${C.red}`, background: C.redBg, color: C.red, fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, width: "fit-content" }}>
                <LogOut size={14}/> Sign Out
              </button>

            </div>
          )}

          {/* ── Dashboard content ─────────────────────────────────────── */}
          {nav === "Dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* ── PRIMARY HERO: Health Score ────────────────────────── */}
            {(inspectDone || roofYear || hvacYear) ? (
              <div
                onClick={() => setShowHealthModal(true)}
                style={{
                  background: `linear-gradient(135deg, ${C.navy} 0%, ${C.accentDk} 65%, ${C.accent} 100%)`,
                  borderRadius: 20, padding: isMobile ? "20px 18px" : "28px 32px", cursor: "pointer",
                  transition: "all 0.15s", position: "relative", overflow: "hidden",
                  boxShadow: `0 4px 20px ${C.navy}1F`,
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 36px rgba(15,31,61,0.22)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 20px rgba(15,31,61,0.12)"; }}
              >
                {/* radial glow behind ring */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: `radial-gradient(circle at 12% 50%, ${healthColor}20 0%, transparent 55%)`, pointerEvents: "none" }}/>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 16 : 28, position: "relative" }}>
                  {/* Score Ring */}
                  <ScoreRing score={health} color={healthColor} size={isMobile ? 100 : 134} />
                  {/* Main content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Home Health Score</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 30, fontWeight: 800, color: "white", letterSpacing: "-0.5px" }}>{healthSt.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 20,
                        background: healthSt.tagBg, color: healthSt.tagColor, border: `1px solid ${healthSt.tagColor}50`, whiteSpace: "nowrap" }}>
                        {criticalCount > 0 ? `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""}` : breakdown.deductions.length > 0 ? `${breakdown.deductions.length} item${breakdown.deductions.length > 1 ? "s" : ""} to monitor` : "All systems OK"}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 14px", lineHeight: 1.5 }}>{healthSt.desc}</p>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {roofYear && roofAge !== null && (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
                          background: `${roofSt.dot}20`, color: roofSt.color, border: `1px solid ${roofSt.dot}40` }}>
                          Roof · {roofAge} yrs · {roofSt.label}
                        </span>
                      )}
                      {hvacYear && hvacAge !== null && (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
                          background: `${hvacSt.dot}20`, color: hvacSt.color, border: `1px solid ${hvacSt.dot}40` }}>
                          HVAC · {hvacAge} yrs · {hvacSt.label}
                        </span>
                      )}
                      {criticalCount > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
                          background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                          {criticalCount} Critical Finding{criticalCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* CTA button */}
                  {!isMobile && (
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ padding: "10px 18px", borderRadius: 12, background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", gap: 6 }}>
                      <BarChart3 size={14} color="rgba(255,255,255,0.7)"/>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Full Breakdown</span>
                      <ChevronRight size={13} color="rgba(255,255,255,0.4)"/>
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>Tap to see full breakdown</p>
                  </div>
                  )}
                </div>
              </div>
            ) : (
              /* Empty state hero */
              <div style={{
                background: `linear-gradient(135deg, ${C.navy} 0%, ${C.accentDk} 65%, ${C.accent} 100%)`,
                borderRadius: 20, padding: isMobile ? "20px 18px" : "28px 32px", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 16 : 28,
                boxShadow: `0 4px 20px ${C.navy}1F`, position: "relative", overflow: "hidden",
              }}>
                {/* Animated shimmer overlay while parsing */}
                {inspecting && (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 1,
                    background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)",
                    animation: "shimmer 1.6s ease-in-out infinite",
                  }}/>
                )}
                <style>{`
                  @keyframes shimmer {
                    0%   { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                  }
                  @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                  }
                `}</style>

                {/* Circle icon / spinner */}
                <div style={{ width: 134, height: 134, borderRadius: "50%",
                  border: inspecting ? "4px solid rgba(255,255,255,0.12)" : "4px dashed rgba(255,255,255,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  position: "relative",
                }}>
                  {inspecting ? (
                    <>
                      {/* Spinning arc */}
                      <div style={{
                        position: "absolute", inset: -4, borderRadius: "50%",
                        border: "4px solid transparent",
                        borderTopColor: "rgba(255,255,255,0.6)",
                        borderRightColor: "rgba(255,255,255,0.2)",
                        animation: "spin-slow 1s linear infinite",
                      }}/>
                      <Loader2 size={36} color="rgba(255,255,255,0.5)" style={{ animation: "spin-slow 1.4s linear infinite" }}/>
                    </>
                  ) : (
                    <Activity size={40} color="rgba(255,255,255,0.18)"/>
                  )}
                </div>

                <div style={{ flex: 1, position: "relative", zIndex: 2 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Home Health Score</p>
                  {inspecting ? (
                    <>
                      <p style={{ fontSize: 28, fontWeight: 800, color: "rgba(255,255,255,0.75)", margin: "0 0 6px" }}>Analyzing report…</p>
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "0 0 18px" }}>Reading your inspection findings, systems, and estimated costs. This takes about 30 seconds.</p>
                      {/* Progress dots */}
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {[0, 1, 2].map(i => (
                          <div key={i} style={{
                            width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.5)",
                            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                          }}/>
                        ))}
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginLeft: 6 }}>Processing with AI</span>
                      </div>
                      <style>{`@keyframes pulse { 0%,80%,100% { opacity:0.3; transform:scale(0.85); } 40% { opacity:1; transform:scale(1); } }`}</style>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 28, fontWeight: 800, color: "rgba(255,255,255,0.3)", margin: "0 0 8px" }}>Not yet calculated</p>
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: "0 0 16px" }}>Upload an inspection report or enter your roof & HVAC years to get your score.</p>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => inspRef.current?.click()}
                          style={{ padding: "9px 18px", borderRadius: 10, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          <Upload size={13}/> Upload Inspection
                        </button>
                        <button onClick={() => setNav("Settings")}
                          style={{ padding: "9px 14px", borderRadius: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          Enter Years
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Hidden file input for inspection upload — always in DOM so inspRef works */}
            <input ref={inspRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>

            {/* Street View — directly under home score */}
            <HousePhoto address={toTitleCase(address)} height={isMobile ? 140 : 200} />


            {/* ── AI BUTLER ─────────────────────────────────────────── */}
            <div style={{ ...card(), background: "linear-gradient(160deg, #f8faff 0%, #eef2ff 100%)", border: `1.5px solid ${C.accent}22`, padding: 0, overflow: "hidden" }}>

              {/* ── Header ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px 13px" }}>
                {/* BTLR avatar */}
                <div style={{ width: 38, height: 38, borderRadius: 11, background: `linear-gradient(135deg, ${C.accent} 0%, ${C.accentDk} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 3px 10px ${C.accent}45`, flexShrink: 0, position: "relative" }}>
                  <Sparkles size={17} color="white"/>
                  {/* Online dot */}
                  <div style={{ position: "absolute", bottom: 1, right: 1, width: 9, height: 9, borderRadius: "50%", background: "#22c55e", border: "2px solid white" }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.01em" }}>BTLR</p>
                    {humorMode && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", letterSpacing: "0.04em" }}>WIT ON</span>}
                  </div>
                  <p style={{ fontSize: 11, color: C.text3, margin: 0, lineHeight: 1.3 }}>
                    {warranty || insurance
                      ? `Policy-aware · ${[warranty ? "Warranty" : null, insurance ? "Insurance" : null].filter(Boolean).join(" + ")} on file`
                      : "Your private home chief-of-staff"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* Voice output toggle */}
                  <button
                    onClick={() => {
                      const next = !voiceOutput;
                      setVoiceOutput(next);
                      if (!next && window.speechSynthesis) window.speechSynthesis.cancel();
                    }}
                    title={voiceOutput ? "Voice responses ON — click to mute" : "Voice responses OFF — click to enable"}
                    style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${voiceOutput ? C.accent : C.border}`, background: voiceOutput ? `${C.accent}12` : "white", color: voiceOutput ? C.accent : C.text3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {voiceOutput ? <Volume2 size={13}/> : <VolumeX size={13}/>}
                  </button>
                  {/* Settings gear */}
                  <button
                    onClick={() => setShowButlerSettings(s => !s)}
                    style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${showButlerSettings ? C.accent : C.border}`, background: showButlerSettings ? `${C.accent}12` : "white", color: showButlerSettings ? C.accent : C.text3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Settings size={13}/>
                  </button>
                  {/* Clear */}
                  {chatMessages.length > 0 && (
                    <button onClick={() => { setChatMessages([]); setAnswer(""); if (window.speechSynthesis) window.speechSynthesis.cancel(); }}
                      style={{ fontSize: 11, color: C.text3, background: "white", border: `1px solid ${C.border}`, borderRadius: 7, cursor: "pointer", padding: "4px 9px" }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* ── Settings panel ── */}
              {showButlerSettings && (
                <div style={{ margin: "0 18px 12px", background: "white", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>Butler Settings</p>

                  {/* Voice output */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {voiceOutput ? <Volume2 size={14} color={C.accent}/> : <VolumeX size={14} color={C.text3}/>}
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>Voice Responses</p>
                        <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>Butler speaks responses aloud</p>
                      </div>
                    </div>
                    <button onClick={() => { setVoiceOutput(v => !v); if (voiceOutput && window.speechSynthesis) window.speechSynthesis.cancel(); }}
                      style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
                        background: voiceOutput ? C.accent : "#d1d5db", transition: "background 0.2s" }}>
                      <div style={{ position: "absolute", top: 3, left: voiceOutput ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }}/>
                    </button>
                  </div>

                  {/* Humor mode */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{humorMode ? "🎩" : "💼"}</span>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>Humor Mode</p>
                        <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>Subtle dry wit — never for emergencies</p>
                      </div>
                    </div>
                    <button onClick={() => setHumorMode(h => !h)}
                      style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
                        background: humorMode ? "#f59e0b" : "#d1d5db", transition: "background 0.2s" }}>
                      <div style={{ position: "absolute", top: 3, left: humorMode ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }}/>
                    </button>
                  </div>

                  {!speechSupported && (
                    <p style={{ fontSize: 11, color: C.red, margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
                      <MicOff size={11}/> Voice input not supported in this browser
                    </p>
                  )}
                </div>
              )}

              {/* ── Conversation thread ── */}
              {(chatMessages.length > 0 || (aiLoading && chatMessages.length === 0)) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 18px 14px",
                  maxHeight: isMobile ? 340 : 440, overflowY: "auto" }}>
                  {chatMessages.map((msg, i) => {
                    const isLast = i === chatMessages.length - 1;
                    return (
                      <div key={i} style={{ display: "flex", flexDirection: "column",
                        alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>

                        {/* Bubble */}
                        <div style={{
                          maxWidth: "88%",
                          borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
                          padding: "11px 15px", fontSize: 14, lineHeight: 1.68, whiteSpace: "pre-wrap",
                          background: msg.role === "user"
                            ? `linear-gradient(135deg, ${C.accent}, ${C.accentDk})`
                            : "white",
                          color: msg.role === "user" ? "white" : C.text,
                          border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                          boxShadow: msg.role === "user"
                            ? "0 2px 8px rgba(37,99,235,0.22)"
                            : "0 1px 4px rgba(0,0,0,0.06)",
                        }}>
                          {msg.content}
                        </div>

                        {/* Action buttons — assistant only */}
                        {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
                          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 8, maxWidth: "92%" }}>
                            {msg.actions.map((action, ai) => {
                              let bg = "white", fg = C.accent, bdr = `1.5px solid ${C.accent}`;
                              if (action.type === "find_vendor") {
                                bg = C.navy; fg = "white"; bdr = "none";
                              } else if (action.type === "open_url" || action.type === "tel" || action.type === "email") {
                                bg = C.accent; fg = "white"; bdr = "none";
                              } else if (action.type === "nav_documents") {
                                bg = "white"; fg = C.accent; bdr = `1.5px solid ${C.accent}`;
                              }
                              return (
                                <button key={ai} onClick={() => executeButlerAction(action)}
                                  style={{ display: "inline-flex", alignItems: "center", gap: 5,
                                    padding: "8px 14px", borderRadius: 9, border: bdr, background: bg,
                                    color: fg, fontSize: 12, fontWeight: 700, cursor: "pointer",
                                    boxShadow: "0 1px 5px rgba(0,0,0,0.10)", letterSpacing: "0.01em" }}>
                                  {action.type === "find_vendor"   && <Users size={12}/>}
                                  {action.type === "open_url"      && <ExternalLink size={12}/>}
                                  {action.type === "tel"           && <span style={{ fontSize: 11 }}>📞</span>}
                                  {action.type === "email"         && <span style={{ fontSize: 11 }}>✉️</span>}
                                  {action.type === "nav_documents" && <FileText size={12}/>}
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Quick replies — last assistant message only, when follow-up needed */}
                        {msg.role === "assistant" && isLast && !aiLoading &&
                          msg.quickReplies && msg.quickReplies.length > 0 && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9, maxWidth: "96%" }}>
                            {msg.quickReplies.map((reply, ri) => (
                              <button key={ri} onClick={() => askAI(reply)}
                                style={{ fontSize: 12, padding: "7px 13px", borderRadius: 20,
                                  border: `1.5px solid ${C.accent}35`, background: `${C.accent}0A`,
                                  color: C.accent, cursor: "pointer", fontWeight: 600,
                                  boxShadow: "0 1px 3px rgba(37,99,235,0.08)" }}>
                                {reply}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {aiLoading && (
                    <div style={{ display: "flex", justifyContent: "flex-start" }}>
                      <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: "4px 16px 16px 16px",
                        padding: "11px 15px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {[0, 1, 2].map(d => (
                            <div key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, opacity: 0.7,
                              animation: `btlrPulse 1.2s ${d * 0.2}s ease-in-out infinite` }}/>
                          ))}
                        </div>
                        <span style={{ fontSize: 12, color: C.text3 }}>BTLR is thinking…</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Input area ── */}
              <div style={{ padding: chatMessages.length > 0 ? "0 18px 16px" : "0 18px 16px",
                borderTop: chatMessages.length > 0 ? `1px solid ${C.border}` : "none",
                paddingTop: chatMessages.length > 0 ? 12 : 0 }}>

                {/* Listening indicator */}
                {isListening && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                    padding: "8px 12px", borderRadius: 9, background: "#fef2f2", border: "1px solid #fca5a5" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "btlrPulse 1s ease-in-out infinite" }}/>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>Listening…</span>
                    <button onClick={stopListening}
                      style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#dc2626", background: "none", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer", padding: "2px 8px" }}>
                      Cancel
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  {/* Mic button */}
                  {speechSupported && (
                    <button onClick={isListening ? stopListening : startListening}
                      title={isListening ? "Stop listening" : "Speak to BTLR"}
                      style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, border: isListening ? "1.5px solid #ef4444" : `1.5px solid ${C.border}`,
                        background: isListening ? "#fef2f2" : "white", color: isListening ? "#ef4444" : C.text3,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: isListening ? "0 0 0 3px rgba(239,68,68,0.15)" : "none", transition: "all 0.2s" }}>
                      {isListening ? <MicOff size={16}/> : <Mic size={16}/>}
                    </button>
                  )}

                  <input value={q} onChange={e => setQ(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAI(); } }}
                    placeholder={
                      isListening
                        ? "Listening — speak now…"
                        : chatMessages.length > 0
                          ? "Reply to BTLR…"
                          : "e.g. \"I have a leak\" or \"Can I file a claim?\""
                    }
                    style={{ flex: 1, borderRadius: 11, padding: "11px 14px", fontSize: 15,
                      border: `1.5px solid ${isListening ? "#fca5a5" : C.border}`,
                      background: isListening ? "#fef2f2" : "white", color: C.text,
                      outline: "none", transition: "border-color 0.2s" }}/>

                  <button onClick={() => askAI()} disabled={aiLoading || !q.trim()}
                    style={{ width: 42, height: 42, borderRadius: 11, border: "none", cursor: "pointer",
                      background: aiLoading || !q.trim() ? "#d1d5db" : `linear-gradient(135deg, ${C.accent}, ${C.accentDk})`,
                      color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: !q.trim() ? "none" : `0 2px 8px ${C.accent}45`, transition: "all 0.2s", flexShrink: 0 }}>
                    {aiLoading ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
                  </button>
                </div>

                {/* Quick start prompts — empty state only */}
                {chatMessages.length === 0 && !aiLoading && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    {[
                      "I have a leak",
                      "File a warranty claim",
                      "Most urgent repair?",
                      "Will insurance cover this?",
                    ].map(prompt => (
                      <button key={prompt} onClick={() => askAI(prompt)}
                        style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20,
                          border: `1px solid ${C.accent}28`, background: `${C.accent}07`,
                          color: C.accent, cursor: "pointer", fontWeight: 600,
                          transition: "background 0.15s" }}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Dot pulse + listening animation */}
              <style>{`
                @keyframes btlrPulse {
                  0%, 100% { opacity: 0.3; transform: scale(0.85); }
                  50%       { opacity: 1;   transform: scale(1); }
                }
              `}</style>
            </div>

            {/* Roof + HVAC status row — removed, shown in health score card and repairs */}

            {/* Financial row */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 14 }}>

              {/* Mortgage */}
              {(() => {
                const today = new Date();
                const dueDay = mortgage?.due_day ?? 1;
                const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);
                if (dueDate < today) dueDate.setMonth(dueDate.getMonth() + 1);
                const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
                const isUrgent = daysUntilDue <= 7 && !!mortgage?.payment;
                return (
                  <div style={{ ...card({ padding: 0, overflow: "hidden" }), background: isUrgent ? C.amberBg : C.surface, border: `1px solid ${isUrgent ? C.amber + "50" : C.border}` }}>
                    {/* Accent bar */}
                    <div style={{ height: 4, background: isUrgent ? C.amber : C.accent, borderRadius: "16px 16px 0 0" }}/>
                    <div style={{ padding: "20px 22px 22px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: isUrgent ? `${C.amber}22` : `${C.accent}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <DollarSign size={15} color={isUrgent ? C.amber : C.accent}/>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: isUrgent ? C.amber : C.accent, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>Mortgage</p>
                          {mortgage?.lender && <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>{mortgage.lender}</p>}
                        </div>
                      </div>
                      <button onClick={() => setShowMortgageForm(f => !f)} style={{ fontSize: 11, fontWeight: 600, color: C.accent, background: "transparent", border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                        {showMortgageForm ? "Cancel" : mortgage ? "Edit" : "Add"}
                      </button>
                    </div>
                    {mortgage && !showMortgageForm ? (
                      <>
                        <p style={{ fontSize: 30, fontWeight: 800, color: C.text, letterSpacing: "-0.8px", margin: "0 0 10px", lineHeight: 1 }}>${mortgage.balance?.toLocaleString() ?? "—"}</p>
                        <div style={{ display: "flex", gap: 18, marginBottom: 14 }}>
                          {mortgage.payment && (
                            <div>
                              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Monthly</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: C.text2 }}>${mortgage.payment.toLocaleString()}</div>
                            </div>
                          )}
                          {mortgage.rate && (
                            <div>
                              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Rate</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: C.text2 }}>{(mortgage.rate * 100).toFixed(3)}%</div>
                            </div>
                          )}
                          {mortgage.due_day && (
                            <div>
                              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Due</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: C.text2 }}>Day {dueDay}</div>
                            </div>
                          )}
                        </div>
                        {isUrgent ? (
                          <div style={{ padding: "8px 12px", borderRadius: 10, background: `${C.amber}22`, border: `1px solid ${C.amber}50`, display: "flex", alignItems: "center", gap: 7 }}>
                            <AlertTriangle size={13} color={C.amber}/>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>Due in {daysUntilDue} day{daysUntilDue !== 1 ? "s" : ""} — ${mortgage.payment?.toLocaleString()}</span>
                          </div>
                        ) : mortgage.due_day ? (
                          <div style={{ padding: "7px 12px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 7 }}>
                            <Clock size={12} color={C.text3}/>
                            <span style={{ fontSize: 12, color: C.text3 }}>Next due in {daysUntilDue} days</span>
                          </div>
                        ) : null}
                      </>
                    ) : showMortgageForm ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { label: "Lender", key: "lender", ph: "loanDepot" },
                          { label: "Balance ($)", key: "balance", ph: "e.g. 312400" },
                          { label: "Monthly Payment ($)", key: "payment", ph: "e.g. 1850" },
                          { label: "Due Day of Month", key: "due_day", ph: "e.g. 1" },
                          { label: "Interest Rate (%)", key: "rate", ph: "e.g. 6.5" },
                        ].map(({ label, key, ph }) => (
                          <div key={key}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 3 }}>{label}</label>
                            <input value={(mortgageForm as Record<string,string>)[key]} onChange={e => setMortgageForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button onClick={saveMortgage} disabled={savingMortgage} style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            {savingMortgage ? <><Loader2 size={12} className="animate-spin"/>Saving…</> : <><CheckCircle2 size={12}/>Save</>}
                          </button>
                          <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8, whiteSpace: "nowrap" }}>
                            {mortgageStatLoading ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>} PDF
                            <input ref={mortgageStatRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={uploadMortgageStatement} disabled={mortgageStatLoading}/>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setShowMortgageForm(true)} style={{ flex: 1, padding: "9px 12px", borderRadius: 9, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            <DollarSign size={13}/> Enter Details
                          </button>
                          <label style={{ padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, fontWeight: 600, color: C.text2, display: "flex", alignItems: "center", gap: 5 }}>
                            {mortgageStatLoading ? <><Loader2 size={11} className="animate-spin"/>Parsing…</> : <><Upload size={11}/>PDF</>}
                            <input ref={mortgageStatRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={uploadMortgageStatement} disabled={mortgageStatLoading}/>
                          </label>
                        </div>
                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                          <button onClick={connectPlaid} disabled={connectingPlaid} style={{ width: "100%", padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text2, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: connectingPlaid ? 0.6 : 1 }}>
                            {connectingPlaid ? <><Loader2 size={12} className="animate-spin"/>Connecting…</> : <><LinkIcon size={12}/>Connect Bank</>}
                          </button>
                        </div>
                      </div>
                    )}
                    </div>{/* /padding div */}
                  </div>
                );
              })()}

              {/* Insurance */}
              <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                <div style={{ height: 4, background: "#0891b2", borderRadius: "16px 16px 0 0" }}/>
                <div style={{ padding: "20px 22px 22px" }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "#0891b218", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Shield size={15} color="#0891b2"/>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", letterSpacing: "0.08em", textTransform: "uppercase" }}>Home Insurance</span>
                  </div>
                  {insurance && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid #0891b230", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Plus size={10}/>}
                        {parsingInsurance ? "…" : "Add Policy"}
                        <input key={`add-${insuranceFileKey}`} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={addSecondaryPolicy} disabled={parsingInsurance}/>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid #0891b230", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                        {parsingInsurance ? "…" : "Replace"}
                        <input key={`rep-${insuranceFileKey}`} type="file" accept=".pdf,.txt" multiple style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                      </label>
                    </div>
                  )}
                </div>
                {insurance ? (
                  <>
                    <p style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 2px", lineHeight: 1.3 }}>
                      {insurance.provider ?? "Active Policy"}
                      {insurance.policyType ? ` · ${insurance.policyType}` : ""}
                    </p>
                    {insurance.policyNumber && (
                      <p style={{ fontSize: 12, color: C.text3, margin: "0 0 14px", fontFamily: "monospace", letterSpacing: "0.02em" }}>
                        #{insurance.policyNumber}
                      </p>
                    )}
                    {((insurance.annualPremium ?? insurance.premium) || insurance.expirationDate) && (
                      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                        {(insurance.annualPremium ?? insurance.premium) && (
                          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "8px 14px" }}>
                            <div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Premium</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>${(insurance.annualPremium ?? insurance.premium)!.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 500, color: C.text3 }}>/yr</span></div>
                          </div>
                        )}
                        {insurance.expirationDate && (
                          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "8px 14px" }}>
                            <div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Renews</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{insurance.expirationDate}</div>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => {
                        const url = insurance.claimUrl?.startsWith("http") ? insurance.claimUrl : null;
                        const phone = insurance.claimPhone;
                        const email = insurance.claimEmail;
                        if (url) { window.open(url, "_blank"); return; }
                        if (phone) { window.location.href = `tel:${phone.replace(/\D/g, "")}`; return; }
                        if (email) { window.location.href = `mailto:${email}`; return; }
                        // No contact info — prompt user to upload policy
                        showToast("Upload your declarations page to extract the claims contact", "info");
                      }} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: C.navy, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        File Claim
                      </button>
                      <button onClick={() => setShowInsuranceDetail(d => !d)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "transparent", border: `1.5px solid ${C.accent}`, color: C.accent, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        {showInsuranceDetail ? "Hide Details" : "View Details"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "0 0 14px" }}>—</p>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #0891b2", background: "transparent", color: "#0891b2", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      {parsingInsurance ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                      {parsingInsurance ? "Parsing…" : "Upload Policy"}
                      <input ref={insuranceRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                    </label>
                    {insuranceError && <p style={{ fontSize: 11, color: C.red, margin: "8px 0 0", lineHeight: 1.4 }}>⚠ {insuranceError}</p>}
                  </>
                )}
                </div>{/* /padding div */}

                {/* Additional / stacked policies (e.g. CA FAIR Plan + DIC) */}
                {(insurance?.additionalPolicies ?? []).map((ap, i) => (
                  <div key={i} style={{ borderTop: `1px solid #bae6fd`, padding: "14px 22px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                          {ap.provider ?? "Additional Policy"}
                          {ap.policyType ? ` · ${ap.policyType}` : ""}
                        </span>
                        {ap.policyNumber && (
                          <span style={{ fontSize: 11, color: C.text3, marginLeft: 8, fontFamily: "monospace" }}>#{ap.policyNumber}</span>
                        )}
                      </div>
                      <button onClick={async () => {
                        if (!confirm("Remove this policy?")) return;
                        const propId = activePropertyIdRef.current;
                        if (!propId) return;
                        const updated = (insurance?.additionalPolicies ?? []).filter((_, j) => j !== i);
                        await supabase.from("home_insurance").update({ additional_policies: updated }).eq("property_id", propId);
                        setInsurance(prev => prev ? { ...prev, additionalPolicies: updated } : prev);
                        showToast("Policy removed", "success");
                      }} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 2 }}>
                        <X size={13}/>
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: ap.claimPhone || ap.claimUrl ? 10 : 0 }}>
                      {ap.annualPremium && (
                        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}>
                          <div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Premium</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>${ap.annualPremium.toLocaleString()}<span style={{ fontSize: 10, color: C.text3 }}>/yr</span></div>
                        </div>
                      )}
                      {ap.expirationDate && (
                        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}>
                          <div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Renews</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{ap.expirationDate}</div>
                        </div>
                      )}
                    </div>
                    {(ap.claimPhone || ap.claimUrl) && (
                      <button onClick={() => {
                        if (ap.claimUrl) window.open(ap.claimUrl);
                        else if (ap.claimPhone) window.location.href = `tel:${ap.claimPhone.replace(/\D/g, "")}`;
                      }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: C.navy, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        File Claim
                      </button>
                    )}
                  </div>
                ))}

                {/* Insurance detail panel */}
                {insurance && showInsuranceDetail && (() => {
                  const hasRichData = !!(
                    insurance.dwellingCoverage || insurance.liabilityCoverage || insurance.personalProperty ||
                    insurance.deductibleStandard || insurance.claimUrl || insurance.claimPhone ||
                    (insurance.coverageItems?.length ?? 0) > 0 || (insurance.exclusions?.length ?? 0) > 0 ||
                    insurance.agentName || insurance.replacementCostDwelling !== undefined
                  );
                  if (!hasRichData) return (
                    <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 14, padding: "18px 20px", marginTop: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
                      <Shield size={28} color="#0891b2" style={{ opacity: 0.5 }}/>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#0891b2", margin: 0 }}>Upload your policy for full coverage details</p>
                      <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>We&apos;ll extract your coverage amounts, deductibles, exclusions, and claims contact from your declarations page.</p>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#0891b2", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        <Upload size={12}/> Upload Policy PDF
                        <input key={insuranceFileKey} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                      </label>
                    </div>
                  );
                  return (
                  <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>

                    {/* File a Claim CTA */}
                    {(insurance.claimUrl || insurance.claimPhone) && (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {insurance.claimUrl && (
                          <a href={insurance.claimUrl} target="_blank" rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 9, background: "#0891b2", color: "white", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                            <ExternalLink size={13}/> File a Claim Online
                          </a>
                        )}
                        {insurance.claimPhone && (
                          <a href={`tel:${insurance.claimPhone.replace(/\D/g, "")}`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 9, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 13, fontWeight: 700, textDecoration: "none", background: "white" }}>
                            📞 {insurance.claimPhone}
                          </a>
                        )}
                        {insurance.claimHours && (
                          <span style={{ fontSize: 12, color: "#0891b2", alignSelf: "center" }}>⏱ {insurance.claimHours}</span>
                        )}
                      </div>
                    )}

                    {/* Coverage amounts grid */}
                    {(insurance.dwellingCoverage || insurance.liabilityCoverage || insurance.personalProperty || insurance.deductibleStandard) && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>💰 Coverage Amounts</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {insurance.dwellingCoverage   && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Dwelling (Cov A)</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.dwellingCoverage.toLocaleString()}</div></div>}
                          {insurance.personalProperty   && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Personal Property (C)</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.personalProperty.toLocaleString()}</div></div>}
                          {insurance.liabilityCoverage  && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Liability (Cov E)</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.liabilityCoverage.toLocaleString()}</div></div>}
                          {insurance.deductibleStandard && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Deductible</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.deductibleStandard.toLocaleString()}</div></div>}
                          {insurance.lossOfUse          && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Loss of Use (D)</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.lossOfUse.toLocaleString()}</div></div>}
                          {insurance.otherStructures    && <div style={{ background: "white", border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px" }}><div style={{ fontSize: 10, color: "#0891b2", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Other Structures (B)</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>${insurance.otherStructures.toLocaleString()}</div></div>}
                        </div>
                        {(insurance.deductibleWind || insurance.deductibleHurricane) && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {insurance.deductibleWind      && <span style={{ fontSize: 12, background: "white", border: "1px solid #bae6fd", borderRadius: 6, padding: "3px 9px", color: "#0891b2" }}>🌬️ Wind deductible: ${insurance.deductibleWind.toLocaleString()}</span>}
                            {insurance.deductibleHurricane && <span style={{ fontSize: 12, background: "white", border: "1px solid #bae6fd", borderRadius: 6, padding: "3px 9px", color: "#0891b2" }}>🌀 Hurricane deductible: ${insurance.deductibleHurricane.toLocaleString()}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Replacement cost flags */}
                    {(insurance.replacementCostDwelling !== undefined || insurance.replacementCostContents !== undefined) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {insurance.replacementCostDwelling !== undefined && (
                          <span style={{ fontSize: 12, background: insurance.replacementCostDwelling ? "#f0fdf4" : C.redBg, border: `1px solid ${insurance.replacementCostDwelling ? "#86efac" : "#fca5a5"}`, borderRadius: 6, padding: "3px 9px", color: insurance.replacementCostDwelling ? "#15803d" : C.red }}>
                            Dwelling: {insurance.replacementCostDwelling ? "✓ Replacement Cost" : "⚠ Actual Cash Value"}
                          </span>
                        )}
                        {insurance.replacementCostContents !== undefined && (
                          <span style={{ fontSize: 12, background: insurance.replacementCostContents ? "#f0fdf4" : C.redBg, border: `1px solid ${insurance.replacementCostContents ? "#86efac" : "#fca5a5"}`, borderRadius: 6, padding: "3px 9px", color: insurance.replacementCostContents ? "#15803d" : C.red }}>
                            Contents: {insurance.replacementCostContents ? "✓ Replacement Cost" : "⚠ Actual Cash Value"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* What's Covered */}
                    {(insurance.coverageItems?.length ?? 0) > 0 && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>✅ What&apos;s Covered ({insurance.coverageItems!.length})</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {insurance.coverageItems!.map((item, i) => (
                            <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Endorsements */}
                    {(insurance.endorsements?.length ?? 0) > 0 && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>➕ Endorsements / Riders ({insurance.endorsements!.length})</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {insurance.endorsements!.map((item, i) => (
                            <span key={i} style={{ fontSize: 12, background: "#e0f2fe", border: "1px solid #7dd3fc", borderRadius: 6, padding: "3px 9px", color: "#0369a1" }}>{item}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Exclusions */}
                    {(insurance.exclusions?.length ?? 0) > 0 && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>❌ Not Covered ({insurance.exclusions!.length})</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {insurance.exclusions!.map((item, i) => (
                            <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Agent */}
                    {(insurance.agentName || insurance.agentPhone || insurance.agentEmail) && (
                      <div style={{ borderTop: "1px solid #bae6fd", paddingTop: 12 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>🧑‍💼 Your Agent</p>
                        {insurance.agentName  && <p style={{ fontSize: 13, color: C.text, margin: "0 0 2px" }}>{insurance.agentName}</p>}
                        {insurance.agentPhone && <a href={`tel:${insurance.agentPhone.replace(/\D/g, "")}`} style={{ fontSize: 13, color: "#0891b2", display: "block", textDecoration: "none", margin: "0 0 2px" }}>📞 {insurance.agentPhone}</a>}
                        {insurance.agentEmail && <a href={`mailto:${insurance.agentEmail}`} style={{ fontSize: 13, color: "#0891b2", display: "block", textDecoration: "none" }}>✉️ {insurance.agentEmail}</a>}
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>

              {/* Home Warranty */}
              <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                <div style={{ height: 4, background: "#7c3aed", borderRadius: "16px 16px 0 0" }}/>
                <div style={{ padding: "20px 22px 22px" }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: "#7c3aed18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Shield size={15} color="#7c3aed"/>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", letterSpacing: "0.08em", textTransform: "uppercase", marginLeft: 8 }}>Home Warranty</span>
                </div>
                {warranty ? (
                  <>
                    <p style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 2px", lineHeight: 1.3 }}>
                      {warranty.provider ?? "Active Warranty"}
                    </p>
                    {warranty.planName && (
                      <p style={{ fontSize: 13, color: C.text3, margin: "0 0 14px" }}>{warranty.planName}</p>
                    )}
                    {(warranty.serviceFee || warranty.expirationDate) && (
                      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                        {warranty.serviceFee && (
                          <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "8px 14px" }}>
                            <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Service Fee</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>${warranty.serviceFee}<span style={{ fontSize: 11, fontWeight: 500, color: C.text3 }}>/claim</span></div>
                          </div>
                        )}
                        {warranty.expirationDate && (
                          <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "8px 14px" }}>
                            <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Expires</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{warranty.expirationDate}</div>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => {
                        // Only open URLs that look like real external links — not relative paths that 401
                        const url = warranty.claimUrl?.startsWith("http") ? warranty.claimUrl : null;
                        const phone = warranty.claimPhone;
                        if (url) { window.open(url, "_blank"); return; }
                        if (phone) { window.location.href = `tel:${phone.replace(/\D/g, "")}`; return; }
                        showToast("Upload your warranty document to extract the claims contact", "info");
                      }} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: C.navy, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        File Claim
                      </button>
                      <button onClick={() => setShowWarrantyDetail(d => !d)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "transparent", border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        {showWarrantyDetail ? "Hide Details" : "View Details"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "0 0 14px" }}>—</p>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      {parsingWarranty ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                      {parsingWarranty ? "Parsing…" : "Upload Warranty"}
                      <input ref={warrantyRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                    </label>
                    {warrantyError && <p style={{ fontSize: 11, color: C.red, margin: "8px 0 0", lineHeight: 1.4 }}>⚠ {warrantyError}</p>}
                  </>
                )}
                </div>{/* /padding div */}
              </div>

              {/* Warranty detail panel */}
              {warranty && showWarrantyDetail && (
                <div style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* File a Claim CTA */}
                  {(warranty.claimUrl || warranty.claimPhone) && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {warranty.claimUrl && (
                        <a href={warranty.claimUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 9, background: "#7c3aed", color: "white", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                          <ExternalLink size={13}/> File a Claim Online
                        </a>
                      )}
                      {warranty.claimPhone && (
                        <a href={`tel:${warranty.claimPhone.replace(/\D/g, "")}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 9, border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 13, fontWeight: 700, textDecoration: "none", background: "white" }}>
                          📞 {warranty.claimPhone}
                        </a>
                      )}
                    </div>
                  )}

                  {/* Key info row */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {warranty.serviceFee     && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}><strong>${warranty.serviceFee}</strong> service fee/claim</span>}
                    {warranty.responseTime   && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>⏱ {warranty.responseTime} response</span>}
                    {warranty.maxAnnualBenefit && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>Max ${warranty.maxAnnualBenefit?.toLocaleString()}/yr</span>}
                    {warranty.paymentAmount  && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>${warranty.paymentAmount}/{warranty.paymentFrequency ?? "mo"}</span>}
                  </div>

                  {/* Coverage */}
                  {(warranty.coverageItems?.length ?? 0) > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>✅ What&apos;s Covered</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {warranty.coverageItems!.map((item, i) => (
                          <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Exclusions */}
                  {(warranty.exclusions?.length ?? 0) > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>❌ Not Covered</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {warranty.exclusions!.map((item, i) => (
                          <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Coverage limits */}
                  {warranty.coverageLimits && Object.keys(warranty.coverageLimits).length > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>💰 Coverage Limits</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {Object.entries(warranty.coverageLimits).map(([sys, limit]) => (
                          <span key={sys} style={{ fontSize: 12, background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 6, padding: "3px 9px", color: C.amber }}>{sys}: ${(limit as number).toLocaleString()}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* ── REPAIR FUND CARD ─────────────────────────────────── */}
            <div style={{ ...card({ padding: 0, overflow: "hidden" }), border: `1px solid ${C.border}` }}>

              {/* Dark header strip */}
              <div style={{ background: `linear-gradient(135deg, #1a3a2a 0%, #2D6A4F 100%)`, padding: "20px 24px" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Projected 12-Month Costs</p>
                <p style={{ fontSize: 32, fontWeight: 800, color: "white", margin: "4px 0 2px", letterSpacing: "-0.02em" }}>
                  ~${repairFundNeeded.toLocaleString()}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>
                  estimated — not a guarantee · ${recommendedMonthly.toLocaleString()}/mo recommended
                </p>
              </div>

              {/* Three-bucket breakdown */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: `1px solid ${C.border}` }}>
                {[
                  { label: "Immediate Repairs", value: knownTotal, color: knownTotal > 0 ? C.red : C.text3, sub: `${knownCosts.length} issue${knownCosts.length !== 1 ? "s" : ""}` },
                  { label: "System Risk",        value: riskTotal, color: riskTotal > 0 ? C.amber : C.text3, sub: "probability-weighted" },
                  { label: "Maintenance",        value: maintenanceTotal, color: C.text2, sub: homeValue ? "1% of home value" : "estimated baseline" },
                ].map((b, i) => (
                  <div key={b.label} style={{ padding: "12px 14px", borderRight: i < 2 ? `1px solid ${C.border}` : "none", textAlign: "center" }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 4px", lineHeight: 1.3 }}>{b.label}</p>
                    <p style={{ fontSize: 17, fontWeight: 800, color: b.color, margin: "0 0 2px" }}>${b.value.toLocaleString()}</p>
                    <p style={{ fontSize: 10, color: C.text3, margin: 0 }}>{b.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Repair Fund — collapsible ────────────────────────── */}
              <button onClick={() => setRepairFundExpanded(p => !p)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "none", border: "none", borderTop: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PiggyBank size={15} color={C.text3}/>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Repair Fund</span>
                  <span style={{ fontSize: 12, color: C.text3 }}>— Track Your Repair Savings</span>
                </div>
                <div style={{ transform: repairFundExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}>
                  <ChevronDown size={15} color={C.text3}/>
                </div>
              </button>

              {repairFundExpanded && (
              <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── Connected Repair Fund Balance ─────────────────── */}
                {(() => {
                  const target    = repairFundNeeded;
                  const balance   = repairSavingsBalance ?? 0;
                  const gap       = Math.max(0, target - balance);
                  const suggested = target > 0 && gap > 0 ? Math.ceil(gap / 12) : 0;
                  const covered   = target > 0 ? Math.min(100, Math.round((balance / target) * 100)) : 0;

                  return repairSavingsSource ? (
                    <div style={{ background: C.surface, borderRadius: 12, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Connected Repair Fund Balance</span>
                        <span style={{ fontSize: 11, color: repairSavingsSource === "plaid" ? C.green : C.text3, fontWeight: 600 }}>
                          {repairSavingsSource === "plaid" ? "● Plaid" : "● Manual"}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: C.text3, margin: "0 0 10px" }}>{repairSavingsName}</p>

                      {/* 4-row breakdown */}
                      {[
                        { label: "Repair Fund Target",        value: `$${target.toLocaleString()}`,   color: C.text   },
                        { label: "Current Balance",           value: `$${balance.toLocaleString()}`,  color: C.green  },
                        { label: "Remaining Gap",             value: gap > 0 ? `$${gap.toLocaleString()}` : "Fully covered ✓", color: gap > 0 ? C.amber : C.green },
                        { label: "Suggested Monthly Savings", value: suggested > 0 ? `$${suggested.toLocaleString()}/mo` : "On track ✓", color: C.text2 },
                      ].map(row => (
                        <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>{row.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: row.color }}>{row.value}</span>
                        </div>
                      ))}

                      {/* Coverage bar */}
                      {target > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: C.text3 }}>Coverage</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: covered >= 100 ? C.green : C.amber }}>{covered}%</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: C.border }}>
                            <div style={{ height: "100%", borderRadius: 3, width: `${covered}%`, background: covered >= 100 ? C.green : C.amber, transition: "width 0.4s" }}/>
                          </div>
                        </div>
                      )}

                      {/* Edit / disconnect */}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        {repairSavingsSource === "manual" && (
                          <button onClick={() => { setEditingManualSavings(true); setManualSavingsInput(String(repairSavingsBalance ?? "")); }}
                            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.text2, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            Edit
                          </button>
                        )}
                        <button onClick={() => { setRepairSavingsBalance(null); setRepairSavingsSource(null); setRepairSavingsName("Savings Account"); localStorage.removeItem("btlr_repair_savings"); }}
                          style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.redBg}`, background: "transparent", color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Disconnect
                        </button>
                      </div>

                      {/* Manual edit inline form */}
                      {editingManualSavings && (
                        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                          <input
                            type="number" placeholder="Balance ($)" value={manualSavingsInput}
                            onChange={e => setManualSavingsInput(e.target.value)}
                            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg }}
                          />
                          <button onClick={() => {
                            const v = parseFloat(manualSavingsInput);
                            if (!isNaN(v) && v >= 0) { setRepairSavingsBalance(v); setRepairSavingsSource("manual"); }
                            setEditingManualSavings(false);
                          }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: C.accent, color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                          <button onClick={() => setEditingManualSavings(false)}
                            style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.text3, fontSize: 12, cursor: "pointer" }}>✕</button>
                        </div>
                      )}

                      <p style={{ fontSize: 10, color: C.text3, margin: "10px 0 0", lineHeight: 1.5 }}>
                        Balance shown is for informational purposes only. BTLR does not move or hold funds.
                      </p>
                    </div>
                  ) : (
                    <div style={{ background: C.surface, borderRadius: 12, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px" }}>Track Your Repair Savings</p>
                      <p style={{ fontSize: 12, color: C.text3, margin: "0 0 12px", lineHeight: 1.5 }}>
                        See how your Acorns, savings, or investment balance covers your repair fund.
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button disabled
                          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text3, fontSize: 13, fontWeight: 700, cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: 0.7 }}>
                          <LinkIcon size={13}/>Connect via Plaid — Coming Soon
                        </button>
                        {!editingManualSavings ? (
                          <button onClick={() => setEditingManualSavings(true)}
                            style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: "transparent", color: C.text2, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            Enter Manually
                          </button>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <input
                              type="number" placeholder="Current savings balance ($)"
                              value={manualSavingsInput}
                              onChange={e => setManualSavingsInput(e.target.value)}
                              style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg }}
                            />
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => {
                                const v = parseFloat(manualSavingsInput);
                                if (!isNaN(v) && v >= 0) {
                                  setRepairSavingsBalance(v);
                                  setRepairSavingsName("Manual Entry");
                                  setRepairSavingsSource("manual");
                                }
                                setEditingManualSavings(false); setManualSavingsInput("");
                              }} style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "none", background: C.accent, color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save Balance</button>
                              <button onClick={() => { setEditingManualSavings(false); setManualSavingsInput(""); }}
                                style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.text3, fontSize: 12, cursor: "pointer" }}>✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Smart Save toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: 0 }}>Smart Save Mode</p>
                    <p style={{ fontSize: 11, color: C.text3, margin: "2px 0 0" }}>
                      {smartSaveMode ? `Saving $${weeklySmartSave}/week toward repairs` : "Auto-round up purchases to build your fund"}
                    </p>
                  </div>
                  <button onClick={() => setSmartSaveMode(p => !p)} style={{
                    width: 42, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                    background: smartSaveMode ? C.green : C.border, transition: "background 0.2s", position: "relative", flexShrink: 0,
                  }}>
                    <div style={{ position: "absolute", top: 3, left: smartSaveMode ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}/>
                  </button>
                </div>

                {/* Monthly contribution tracker */}
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: C.text2, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Monthly Savings Goal</p>
                    {!editingContribution ? (
                      <button onClick={() => { setEditingContribution(true); setContributionInput(monthlyContribution > 0 ? String(monthlyContribution) : ""); }}
                        style={{ fontSize: 11, color: C.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Edit</button>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => {
                          const v = parseFloat(contributionInput);
                          if (!isNaN(v) && v >= 0) setMonthlyContribution(v);
                          setEditingContribution(false);
                        }} style={{ fontSize: 11, color: C.green, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Save</button>
                        <button onClick={() => setEditingContribution(false)} style={{ fontSize: 11, color: C.text3, background: "none", border: "none", cursor: "pointer" }}>✕</button>
                      </div>
                    )}
                  </div>

                  {editingContribution ? (
                    <input type="number" placeholder={`Suggested: $${recommendedMonthly}/mo`}
                      value={contributionInput} onChange={e => setContributionInput(e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, boxSizing: "border-box" }}
                    />
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: C.text3 }}>
                          {monthlyContribution > 0 ? `$${monthlyContribution}/mo` : `Suggested: $${recommendedMonthly}/mo`}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: fundOnTrack ? C.green : C.amber }}>
                          {fundOnTrack ? "On track ✓" : `${fundProgressPct}% of goal`}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: C.border }}>
                        <div style={{ height: "100%", borderRadius: 3, width: `${fundProgressPct}%`, background: fundOnTrack ? C.green : C.amber, transition: "width 0.4s" }}/>
                      </div>
                    </>
                  )}
                </div>

                {/* Cost breakdown rows by bucket */}
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  {knownCosts.length > 0 && (
                    <>
                      <p style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Immediate Repairs</p>
                      {knownCosts.map((c, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 12, color: C.text3, flex: 1, paddingRight: 8 }}>{c.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: c.severity === "critical" ? C.red : C.amber, flexShrink: 0 }}>${c.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {riskCosts.length > 0 && (
                    <div style={{ marginTop: knownCosts.length > 0 ? 10 : 0 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>System Risk (Probability-Weighted)</p>
                      {riskCosts.map((c, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ flex: 1, paddingRight: 8 }}>
                            <span style={{ fontSize: 12, color: C.text3, display: "block" }}>{c.label}</span>
                            {c.probability !== undefined && (
                              <span style={{ fontSize: 10, color: C.text3 }}>{Math.round(c.probability * 100)}% chance of failure</span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: C.amber, flexShrink: 0 }}>~${c.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {maintenanceCosts.length > 0 && (
                    <div style={{ marginTop: (knownCosts.length > 0 || riskCosts.length > 0) ? 10 : 0 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Maintenance Baseline</p>
                      {maintenanceCosts.map((c, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>{c.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: C.text2 }}>~${c.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: 10, color: C.text3, margin: "10px 0 0", lineHeight: 1.5 }}>
                    Estimates only. Actual costs vary. System risk figures reflect probability-weighted averages, not guaranteed expenses.
                  </p>
                </div>
              </div>
              )} {/* end repairFundExpanded */}
            </div>


            {/* Timeline */}
            {timeline.length > 0 && (
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16 }}>
                  <Activity size={14} color={C.text3}/>
                  <span style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Home Timeline</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {timeline.slice(0, 8).map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 14, paddingBottom: i < Math.min(timeline.length, 8) - 1 ? 14 : 0 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, marginTop: 4 }}/>
                        {i < Math.min(timeline.length, 8) - 1 && <div style={{ width: 1, flex: 1, background: C.border, marginTop: 4 }}/>}
                      </div>
                      <div style={{ paddingBottom: i < Math.min(timeline.length, 8) - 1 ? 4 : 0 }}>
                        <p style={{ fontSize: 12, color: C.text3, marginBottom: 2 }}>{t.date}</p>
                        <p style={{ fontSize: 13, color: C.text }}>{t.event}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Demo Mode — hidden in production */}

            {/* Onboarding prompt */}
            {!roofYear && !hvacYear && !inspectDone && (
              <div style={card({ background: C.amberBg, border: `1px solid ${C.amber}30` })}>
                <p style={{ fontSize: 14, fontWeight: 600, color: C.amber, margin: "0 0 6px" }}>Complete your home profile</p>
                <p style={{ fontSize: 13, color: C.text2, margin: "0 0 12px" }}>Add your address, roof year, and HVAC year to unlock all features — or upload an inspection PDF and BTLR will auto-fill everything.</p>
                <button onClick={() => setNav("Settings")} style={{ padding: "8px 16px", borderRadius: 8, background: C.amber, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Go to Settings →
                </button>
              </div>
            )}

          </div>
          )}

        </div>
      </main>

      {/* ── Feedback: floating button ─────────────────────────────── */}
      <button
        onClick={() => { setShowFeedback(true); setFeedbackSent(false); }}
        title="Report an issue"
        style={{
          position: "fixed",
          bottom: isMobile ? 72 : 24,
          right: 20,
          zIndex: 400,
          width: 44, height: 44, borderRadius: "50%",
          background: C.navy,
          border: "2px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 16px rgba(15,31,61,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 22px rgba(15,31,61,0.38)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 16px rgba(15,31,61,0.28)"; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2l1.88 1.88M15.12 3.88 17 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
          <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M20 13h-4M20.47 9C22.4 8.8 24 7.1 24 5"/>
        </svg>
      </button>

      {/* ── Feedback modal ────────────────────────────────────────── */}
      {showFeedback && (
        <div
          onClick={() => setShowFeedback(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,31,61,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: C.surface, borderRadius: 20, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(15,31,61,0.25)", overflow: "hidden" }}
          >
            {/* Header */}
            <div style={{ background: C.navy, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2l1.88 1.88M15.12 3.88 17 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
                    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
                    <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M20 13h-4M20.47 9C22.4 8.8 24 7.1 24 5"/>
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "white", margin: 0 }}>Report an Issue</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: 0 }}>Page: {nav} · {new Date().toLocaleTimeString()}</p>
                </div>
              </div>
              <button onClick={() => setShowFeedback(false)} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, padding: 7, cursor: "pointer", color: "white", lineHeight: 1 }}>
                <X size={16}/>
              </button>
            </div>

            {feedbackSent ? (
              <div style={{ padding: "40px 24px", textAlign: "center" }}>
                <CheckCircle2 size={40} color={C.green} style={{ margin: "0 auto 14px" }}/>
                <p style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>Thanks for the report!</p>
                <p style={{ fontSize: 14, color: C.text3, margin: 0 }}>We&apos;ll look into it right away.</p>
              </div>
            ) : (
              <div style={{ padding: "22px 24px" }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    What happened? <span style={{ color: C.red }}>*</span>
                  </label>
                  <textarea
                    value={feedbackWhat}
                    onChange={e => setFeedbackWhat(e.target.value)}
                    placeholder="Describe the bug or unexpected behavior…"
                    rows={4}
                    autoFocus
                    style={{
                      width: "100%", borderRadius: 10, padding: "10px 14px",
                      fontSize: 14, lineHeight: 1.6, color: C.text,
                      border: `1.5px solid ${feedbackWhat.trim() ? C.accent : C.border}`,
                      background: C.bg, outline: "none", resize: "vertical",
                      fontFamily: "inherit", boxSizing: "border-box",
                      transition: "border-color 0.15s",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    What were you trying to do?
                  </label>
                  <textarea
                    value={feedbackTrying}
                    onChange={e => setFeedbackTrying(e.target.value)}
                    placeholder="I was trying to…"
                    rows={3}
                    style={{
                      width: "100%", borderRadius: 10, padding: "10px 14px",
                      fontSize: 14, lineHeight: 1.6, color: C.text,
                      border: `1.5px solid ${C.border}`,
                      background: C.bg, outline: "none", resize: "vertical",
                      fontFamily: "inherit", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 9, padding: "8px 12px", marginBottom: 18, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <Info size={13} color="#0891b2" style={{ flexShrink: 0, marginTop: 1 }}/>
                  <p style={{ fontSize: 11, color: "#0369a1", margin: 0, lineHeight: 1.5 }}>
                    Automatically attached: current page ({nav}), your user ID, and timestamp.
                  </p>
                </div>
                <button
                  onClick={submitFeedback}
                  disabled={feedbackSending || !feedbackWhat.trim()}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 11, border: "none",
                    background: feedbackWhat.trim() ? C.navy : C.border,
                    color: feedbackWhat.trim() ? "white" : C.text3,
                    fontSize: 14, fontWeight: 700, cursor: feedbackWhat.trim() ? "pointer" : "default",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    transition: "background 0.15s",
                  }}
                >
                  {feedbackSending
                    ? <><Loader2 size={14} className="animate-spin"/> Sending…</>
                    : <><Send size={13}/> Submit Report</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mark Complete Modal ──────────────────────────────────────────── */}
      {markCompleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} onClick={() => !markCompleteUploading && setMarkCompleteTarget(null)}/>
          <div style={{ position: "relative", width: "100%", maxWidth: 420, background: C.surface, borderRadius: 20, padding: "28px 28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.greenBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CheckCircle2 size={22} color={C.green}/>
              </div>
              <div>
                <p style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: 0 }}>Mark as Complete</p>
                <p style={{ fontSize: 13, color: C.text3, margin: "3px 0 0" }}>{markCompleteTarget.label} · {markCompleteTarget.horizon}</p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: C.text2, margin: "0 0 20px", lineHeight: 1.5 }}>
              Would you like to upload a repair receipt or invoice? This will be saved to your records and helps verify the repair for your Home Health Score.
            </p>
            {/* Upload receipt button */}
            <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px", borderRadius: 12, border: `1.5px dashed ${C.border}`, background: C.bg, cursor: markCompleteUploading ? "wait" : "pointer", marginBottom: 10, opacity: markCompleteUploading ? 0.6 : 1 }}>
              {markCompleteUploading ? <Loader2 size={16} className="animate-spin" color={C.accent}/> : <Upload size={16} color={C.accent}/>}
              <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>
                {markCompleteUploading ? "Saving…" : "Upload Receipt or Invoice"}
              </span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.txt" style={{ display: "none" }}
                disabled={markCompleteUploading}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await markCategoryComplete(markCompleteTarget, f);
                }}/>
            </label>
            {/* Skip — just mark done */}
            <button
              disabled={markCompleteUploading}
              onClick={() => markCategoryComplete(markCompleteTarget)}
              style={{ width: "100%", padding: "12px", borderRadius: 12, background: C.green, border: "none", color: "white", fontSize: 14, fontWeight: 700, cursor: markCompleteUploading ? "wait" : "pointer", opacity: markCompleteUploading ? 0.6 : 1 }}>
              Skip — Mark Complete Without Receipt
            </button>
            <button onClick={() => setMarkCompleteTarget(null)} disabled={markCompleteUploading}
              style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 12, background: "transparent", border: `1px solid ${C.border}`, color: C.text3, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Add Property Drawer ────────────────────────────────────────── */}
      {showAddPropDrawer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex" }}>
          {/* Backdrop */}
          <div style={{ flex: 1, background: "rgba(0,0,0,0.4)" }} onClick={() => setShowAddPropDrawer(false)}/>
          {/* Drawer */}
          <div style={{ width: Math.min(440, window.innerWidth), background: C.surface, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.2)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Add Property</p>
                <p style={{ fontSize: 12, color: C.text3, margin: "2px 0 0" }}>Track another home, rental, or property</p>
              </div>
              <button onClick={() => setShowAddPropDrawer(false)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={15} color={C.text3}/>
              </button>
            </div>

            {/* Form */}
            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
              {/* Address */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Address *</label>
                <input
                  type="text" placeholder="123 Oak Street, Austin TX 78701"
                  value={newPropForm.address}
                  onChange={e => setNewPropForm(p => ({ ...p, address: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, boxSizing: "border-box" }}
                />
              </div>

              {/* Nickname */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Nickname <span style={{ fontWeight: 400, color: C.text3 }}>(optional)</span></label>
                <input
                  type="text" placeholder="Primary Home, Lake House, Rental..."
                  value={newPropForm.nickname}
                  onChange={e => setNewPropForm(p => ({ ...p, nickname: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, boxSizing: "border-box" }}
                />
              </div>

              {/* Home Type */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Home Type</label>
                <select
                  value={newPropForm.home_type}
                  onChange={e => setNewPropForm(p => ({ ...p, home_type: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, boxSizing: "border-box" }}>
                  <option value="single_family">Single Family</option>
                  <option value="condo">Condo / Co-op</option>
                  <option value="townhouse">Townhouse</option>
                  <option value="multi_family">Multi-Family</option>
                  <option value="mobile">Mobile / Manufactured</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Year Built */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Year Built <span style={{ fontWeight: 400, color: C.text3 }}>(optional)</span></label>
                <input
                  type="number" placeholder="e.g. 1998"
                  value={newPropForm.year_built}
                  onChange={e => setNewPropForm(p => ({ ...p, year_built: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, boxSizing: "border-box" }}
                />
              </div>

              {newPropError && (
                <p style={{ fontSize: 13, color: C.red, background: C.redBg, border: `1px solid #fca5a5`, borderRadius: 8, padding: "10px 14px", margin: 0 }}>{newPropError}</p>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
              <button onClick={() => setShowAddPropDrawer(false)}
                style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", fontSize: 14, fontWeight: 600, color: C.text2, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveNewProperty} disabled={addingProp}
                style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: C.accent, color: "white", fontSize: 14, fontWeight: 700, cursor: addingProp ? "not-allowed" : "pointer", opacity: addingProp ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {addingProp ? <><Loader2 size={15} className="animate-spin"/>Saving…</> : "Save Property"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Nav ────────────────────────────────────────── */}
      {isMobile && (
        <nav style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
          background: C.navy, borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex", paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          {navItems.map(({ label, icon, badge }) => (
            <button key={label} onClick={() => setNav(label)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 3, padding: "10px 4px 8px", border: "none", cursor: "pointer",
              background: "transparent", color: nav === label ? "white" : "rgba(255,255,255,0.4)",
              fontSize: 10, fontWeight: nav === label ? 700 : 400, position: "relative",
            }}>
              {icon}
              <span>{label}</span>
              {badge ? <span style={{ position: "absolute", top: 6, right: "calc(50% - 14px)", background: C.red, color: "white", fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 99 }}>{badge}</span> : null}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
