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
  Mic, MicOff, Volume2, VolumeX, Check, Plus, PiggyBank, Camera, Phone, Mail, Trash2, RefreshCw, Download,
} from "lucide-react";
import { phCapture, phIdentify, phReset } from "../../lib/monitoring";
import VendorsView from "../components/VendorsView";
import MyJobsView from "../components/MyJobsView";
import TutorialModal from "../components/TutorialModal";
import type { HomeHealthReport } from "../../lib/scoring-engine";
import { normalizeLegacyFindings } from "../../lib/scoring-engine";
import { runScoringPipeline } from "../../lib/scoring-pipeline";
import { configureSupabaseStore } from "../../lib/score-snapshot-store";
import { registerCostOverrides } from "../../lib/scoring-cost-ranges";
import { isScorable } from "../../lib/findings/scorableRules";
import { extractPdfTextInBrowser } from "../../lib/extractPdfBrowser";
import { computeExtendedCondition, type ExtendedConditionResult } from "../../lib/scoring-extended";
import { isEnabled } from "../../lib/feature-flags";
import { SELF_INSPECT_STEPS, generateSelfInspectionFindings, type SelfInspectAnswers, type SelfInspectQuestion, type SelfInspectOption, isStepComplete } from "../../lib/self-inspection-questionnaire";

// Wire Supabase client into the snapshot store so audit snapshots persist to DB.
// Module-level: runs once on import, safe for server/client boundary (store is
// no-op server-side since window is undefined).
configureSupabaseStore(supabase);

// ── Types ─────────────────────────────────────────────────────────────────
interface TimelineEvent { date: string; event: string }
interface Doc { id: string; name: string; path: string; url?: string; document_type: string }
type FindingStatus = "repair_needed" | "completed" | "monitored" | "not_needed";

interface TrustedContact {
  id: string;
  name: string;
  company: string | null;
  role: string;
  category: string;
  phone: string | null;
}

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

// Validate a parsed property address — rejects inspection section headers,
// photo captions, and other garbage strings that look nothing like a real address.
// Returns true only if the string looks like a legitimate street address.
function isValidPropertyAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const s = addr.trim();
  // Must be non-empty and not absurdly long (real addresses < 120 chars)
  if (s.length < 5 || s.length > 120) return false;
  const lower = s.toLowerCase();
  // Reject strings containing inspection-report jargon
  const junkPhrases = [
    "facing front", "facing rear", "exterior side", "item 1", "item 2",
    "inspected", "picture", "= inspected", "in ni", "ni np", "np rr",
    "io items", "deficiency", "repair needed", "recommend", "inspector",
    "report date", "client name", "page ", "section ", "component ",
    "photo ", "image ", "figure ", "table ", "appendix",
  ];
  if (junkPhrases.some(p => lower.includes(p))) return false;
  // Must contain at least one digit (real addresses have a street number)
  if (!/\d/.test(s)) return false;
  return true;
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

// ── 3-Pass Finding Deduplicator ───────────────────────────────────────────
// Pass 1: Drop identical normalized_finding_key (pipeline-stable ID).
// Pass 2: Drop findings with same normalized category + identical description text.
// Pass 3: Drop findings with same category where description shares >80% of
//         tokens with an already-kept finding (catches rephrased duplicates).
function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const kept: Finding[] = [];

  // Normalize a string for comparison: lowercase, collapse whitespace, strip punctuation
  const norm = (s: string) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // Token-overlap ratio between two strings (Jaccard over word sets)
  const overlap = (a: string, b: string): number => {
    const sa = new Set(norm(a).split(" ").filter(Boolean));
    const sb = new Set(norm(b).split(" ").filter(Boolean));
    if (sa.size === 0 && sb.size === 0) return 1;
    let inter = 0;
    sa.forEach(t => { if (sb.has(t)) inter++; });
    return inter / (sa.size + sb.size - inter);
  };

  for (const f of findings) {
    // Pass 1: stable pipeline key
    if (f.normalized_finding_key) {
      if (seen.has(f.normalized_finding_key)) continue;
      seen.add(f.normalized_finding_key);
    }

    // Pass 2: exact category + description match
    const exactKey = `${norm(f.category)}||${norm(f.description ?? "")}`;
    if (seen.has(exactKey)) continue;
    seen.add(exactKey);

    // Pass 3: fuzzy — same category, description >80% token overlap with a kept finding
    const catKey = norm(f.category);
    const similar = kept.find(k =>
      norm(k.category) === catKey &&
      overlap(k.description ?? "", f.description ?? "") > 0.80
    );
    if (similar) continue;

    kept.push(f);
  }

  return kept;
}

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
  const t = category.toLowerCase().trim();

  // ── Canonical BTLR category keys (exact match wins — avoids substring collision)
  // e.g. "interior_windows_doors" contains "window" but must map to "interior"
  if (t === "interior_windows_doors")    return "interior";
  if (t === "roof_drainage_exterior")    return "roof";
  if (t === "structure_foundation")      return "foundation";
  if (t === "appliances_water_heater")   return "appliances";
  if (t === "safety_environmental")      return "safety";
  if (t === "site_grading_drainage")     return "exterior";
  if (t === "maintenance_upkeep")        return "general";
  if (t === "pool_spa")                  return "general";

  // ── Substring checks for raw AI category strings ──────────────────────────
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
  // "interior" check before "window"/"door" so raw "Interior" → interior group
  if (t.includes("interior") || t.includes("ceiling") || t.includes("floor") ||
      t.includes("wall") || t.includes("stair") || t.includes("handrail") ||
      t.includes("paint") || t.includes("drywall") || t.includes("trim"))     return "interior";
  if (t.includes("window") || t.includes("door"))                             return "windows";
  if (t.includes("appliance") || t.includes("washer") || t.includes("dryer") ||
      t.includes("dishwasher") || t.includes("oven") || t.includes("stove") ||
      t.includes("refrigerator") || t.includes("range") || t.includes("hood"))return "appliances";
  if (t.includes("safety") || t.includes("smoke") || t.includes("carbon") ||
      t.includes("radon") || t.includes("pest") || t.includes("termite") ||
      t.includes("mold") || t.includes("bug"))                                 return "safety";
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
    case "warning":  return "Moderate Priority";
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
    repair_needed:             "Repair Needed",
    completed:                 "Completed",
    monitored:                 "Monitoring",
    not_needed:                "Not Needed",
  };
  const key = raw.toLowerCase().trim();
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  // Generic fallback: replace underscores/hyphens with spaces, title-case each word
  return raw
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// Findings are "active" if status is repair_needed or not yet set
// index = position in the global allFindings array
function isActiveFinding(finding: Finding, index: number, statuses: Record<string, FindingStatus>): boolean {
  const key = findingKey(finding, index);
  const status = statuses[key] ?? "repair_needed";
  return status === "repair_needed" || status === "monitored";
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
      const resolved = statuses[toCategoryKey("Roof")] === "completed" || statuses[toCategoryKey("Roof")] === "not_needed";
      add({ id: "age_roof", category: "Roof", reason: `Roof: ${note}`, points: pts, source: "system_age" }, resolved);
    }
  }

  if (hvacAge !== null) {
    let pts = 0, note = "";
    if      (hvacAge >= 15) { pts = -10; note = `${hvacAge} yrs old — past 15yr lifespan`;      }
    else if (hvacAge >= 12) { pts = -7;  note = `${hvacAge} yrs old — nearing end of life`;     }
    else if (hvacAge >= 8)  { pts = -3;  note = `${hvacAge} yrs old — aging`;                   }
    if (pts !== 0) {
      const resolved = statuses[toCategoryKey("HVAC")] === "completed" || statuses[toCategoryKey("HVAC")] === "not_needed";
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
      const s = statuses[findingKey(it.f, it.idx)] ?? "repair_needed";
      return s === "completed" || s === "not_needed";
    });
    const ncsResolved = ncItems.length > 0 && ncItems.every(it => {
      const s = statuses[findingKey(it.f, it.idx)] ?? "repair_needed";
      return s === "completed" || s === "not_needed";
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

  // Hard cap: total deductions cannot exceed -45 regardless of finding count.
  // This prevents a richer inspection report from producing a lower score than
  // a sparse one — the cap ensures the score reflects home condition, not data volume.
  // Cap is -45 (not -60) so that resolving individual systems shows visible improvement
  // sooner — a typical bad-but-not-catastrophic home with 5-6 criticals still gets
  // meaningful score movement as repairs are completed.
  const rawDeductions = deductions.reduce((sum, d) => sum + d.points, 0);
  const totalDeducted = Math.max(-45, rawDeductions);
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
  bg:       "#EDE8E0",   // warm cream
  surface:  "#FFFFFF",   // card white
  surface2: "#F5F1EB",   // soft warm secondary bg
  navy:     "#1C2B3A",   // dark navy (sidebar, headings)
  accent:   "#E8742A",   // brand orange
  accentDk: "#C07828",   // darker orange for hover/active
  accentLt: "#F59842",   // light orange for subtle tints
  accentBg: "rgba(232,116,42,0.08)", // tint bg
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
          <stop offset="0%" stopColor="#1C2B3A"/><stop offset="100%" stopColor="#2A3E54"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E8742A" stopOpacity="0"/>
          <stop offset="50%" stopColor="#E8742A" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#E8742A" stopOpacity="0"/>
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
// Shown after inspection upload — lets user mark findings as completed/repair_needed/monitored
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
      init[key] = initialStatuses[key] ?? "repair_needed";
    }
    return init;
  });

  function setStatus(index: number, finding: Finding, status: FindingStatus) {
    setLocalStatuses(prev => ({ ...prev, [findingKey(finding, index)]: status }));
  }

  const completedCount = Object.values(localStatuses).filter(s => s === "completed" || s === "not_needed").length;

  const statusOptions: { value: FindingStatus; label: string; bg: string; color: string }[] = [
    { value: "completed",     label: "Already Fixed", bg: C.greenBg, color: C.green  },
    { value: "repair_needed", label: "Still Needed",  bg: C.redBg,   color: C.red    },
    { value: "monitored",     label: "Monitoring",    bg: "#eff6ff",  color: C.accent },
    { value: "not_needed",    label: "Not Needed",    bg: C.bg,       color: C.text3  },
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
            const currentStatus = localStatuses[key] ?? "repair_needed";
            const sevColor = finding.severity === "critical" ? C.red : finding.severity === "warning" ? C.amber : C.text3;

            return (
              <div key={i} style={{
                background: currentStatus === "completed" || currentStatus === "not_needed"
                  ? C.greenBg : C.bg,
                border: `1px solid ${currentStatus === "completed" || currentStatus === "not_needed" ? "#bbf7d0" : C.border}`,
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

// ── Category → Self-Inspect step key mapping ──────────────────────────────────
const CATEGORY_TO_STEP_KEY: Record<string, string> = {
  structure_foundation:    "structure",
  roof_drainage_exterior:  "roof",
  electrical:              "electrical",
  plumbing:                "plumbing",
  hvac:                    "hvac",
  appliances_water_heater: "appliances",
  safety_environmental:    "safety",
};

// ── Per-System Assessment Modal ───────────────────────────────────────────────
// Focused single-step version of the full self-inspection modal.
// Shows just the questions for one system, with photo capture.
// Maps an AI photo result to the best-matching option value for a given question.
// Returns null if no confident mapping is possible.
function autoSelectFromPhoto(
  question: SelfInspectQuestion,
  result: { findings?: Array<{ severity: string }>; manufacture_year?: number | null },
): string | null {
  const { findings = [], manufacture_year } = result;

  // ── Age questions: map manufacture_year → option ────────────────────────────
  if (manufacture_year && question.options.some((o: SelfInspectOption) => o.age_years != null)) {
    const age = new Date().getFullYear() - manufacture_year;
    // Sort options by age_years ascending so [0]=young [1]=mid [2]=old
    const sorted = [...question.options].filter((o: SelfInspectOption) => o.age_years != null)
      .sort((a: SelfInspectOption, b: SelfInspectOption) => (a.age_years ?? 0) - (b.age_years ?? 0));
    const midAge  = sorted[1]?.age_years ?? 8;
    const oldAge  = sorted[2]?.age_years ?? 11;
    if (age < midAge)  return sorted[0]?.value ?? null;
    if (age < oldAge)  return sorted[1]?.value ?? null;
    return sorted[2]?.value ?? null;
  }

  // ── Condition questions: map top finding severity → option ───────────────────
  const topSeverity = findings[0]?.severity;
  if (!topSeverity) return null;
  // Prefer an exact severity match; fall back to the nearest option
  const exact = question.options.find(o => o.severity === topSeverity);
  if (exact) return exact.value;
  // If AI says "critical" but no critical option, pick the most severe available
  if (topSeverity === "critical") {
    return question.options.find(o => o.severity === "warning")?.value
      ?? question.options[question.options.length - 1]?.value ?? null;
  }
  return null;
}

function SystemAssessModal({
  stepKey, answers, onAnswer, onClose, onSave, saving,
}: {
  stepKey:  string;
  answers:  SelfInspectAnswers;
  onAnswer: (questionId: string, value: string) => void;
  onClose:  () => void;
  onSave:   () => void;
  saving:   boolean;
}) {
  const step = SELF_INSPECT_STEPS.find(s => s.key === stepKey);
  if (!step) return null;
  const allAnswered = step.questions.every(q => !!answers[q.id]);

  const [photoData, setPhotoData] = useState<Record<string, {
    previewUrl: string;
    analyzing:  boolean;
    suggestion?: string;
  }>>({});

  // Tracks which options were auto-selected by AI (vs manually chosen by user)
  const [aiSuggested, setAiSuggested] = useState<Record<string, string>>({});

  async function handlePhoto(questionId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: true } }));
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { data: { session } } = await supabase.auth.getSession();
      const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) reqHeaders["Authorization"] = `Bearer ${session.access_token}`;
      const resp = await fetch("/api/analyze-photos", {
        method: "POST", headers: reqHeaders,
        body: JSON.stringify({ photoUrls: [base64], focusArea: questionId }),
      });
      let suggestion = "Photo captured — use it as a reference when answering.";
      if (resp.ok) {
        const result = await resp.json();
        const summary = result.photo_summary as string | undefined;
        const topFinding = (result.findings ?? [])[0];
        const mfgYear = result.manufacture_year as number | null | undefined;

        // ── Build suggestion text ──────────────────────────────────────────────
        if (mfgYear) {
          const age = new Date().getFullYear() - mfgYear;
          suggestion = `Manufacture year: ${mfgYear} (${age} yr old). ${summary ?? ""}`.slice(0, 140);
        } else if (summary) {
          suggestion = summary.length > 130 ? summary.slice(0, 127) + "…" : summary;
        } else if (topFinding?.description) {
          const raw = topFinding.description as string;
          suggestion = raw.length > 130 ? raw.slice(0, 127) + "…" : raw;
        }

        // ── Auto-select the best matching answer ───────────────────────────────
        const question = step?.questions.find(q => q.id === questionId);
        if (question) {
          const suggested = autoSelectFromPhoto(question, {
            findings:        result.findings,
            manufacture_year: mfgYear ?? null,
          });
          if (suggested) {
            onAnswer(questionId, suggested);
            setAiSuggested(prev => ({ ...prev, [questionId]: suggested }));
          }
        }
      }
      setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: false, suggestion } }));
    } catch {
      setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: false, suggestion: "Photo captured." } }));
    }
    e.target.value = "";
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(15,31,61,0.55)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 600, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -8px 48px rgba(15,31,61,0.18)" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>Rate This System</p>
              <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>{step.emoji} {step.systemName}</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4 }}>
              <X size={20}/>
            </button>
          </div>
          <p style={{ fontSize: 12, color: C.text3, margin: "10px 0 0", lineHeight: 1.5 }}>{step.description}</p>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
          {step.questions.map(q => {
            const pd     = photoData[q.id];
            const chosen = answers[q.id];
            return (
              <div key={q.id} style={{ marginBottom: 22 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 4px", lineHeight: 1.4 }}>{q.label}</p>
                {q.hint && <p style={{ fontSize: 12, color: C.text3, margin: "0 0 10px", lineHeight: 1.4 }}>{q.hint}</p>}

                {/* Photo prompt */}
                {q.photoPrompt && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <Camera size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#92400e", margin: "0 0 2px" }}>{q.photoPrompt.label}</p>
                        <p style={{ fontSize: 11, color: "#b45309", margin: "0 0 8px", lineHeight: 1.4 }}>{q.photoPrompt.tip}</p>
                        {pd ? (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <img src={pd.previewUrl} alt="photo" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1.5px solid #fcd34d" }}/>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {pd.analyzing
                                ? <p style={{ fontSize: 12, color: "#b45309", margin: 0, fontStyle: "italic" }}>Analyzing photo…</p>
                                : <p style={{ fontSize: 12, color: "#92400e", margin: 0, lineHeight: 1.4 }}>{pd.suggestion}</p>
                              }
                            </div>
                          </div>
                        ) : (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            <Camera size={13}/> Take Photo
                            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handlePhoto(q.id, e)}/>
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Answer options */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map(opt => {
                    const sel        = chosen === opt.value;
                    const isAiPick   = aiSuggested[q.id] === opt.value;
                    const borderCol  = sel ? C.accent : C.border;
                    const bgCol      = sel ? C.accentLt : C.surface;
                    return (
                      <button key={opt.value}
                        onClick={() => {
                          onAnswer(q.id, opt.value);
                          // If user manually picks a different option, clear the AI suggestion
                          if (isAiPick === false) setAiSuggested(prev => { const n = { ...prev }; delete n[q.id]; return n; });
                        }}
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${borderCol}`, background: bgCol, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${sel ? C.accent : C.border}`, background: sel ? C.accent : "transparent", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {sel && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "white" }}/>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: sel ? C.accent : C.text, margin: 0 }}>{opt.label}</p>
                            {sel && isAiPick && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", background: "#e0f2fe", border: "1px solid #bae6fd", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.04em" }}>
                                AI suggested
                              </span>
                            )}
                          </div>
                          {opt.subLabel && <p style={{ fontSize: 11, color: C.text3, margin: "1px 0 0" }}>{opt.subLabel}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px 28px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button onClick={onSave} disabled={!allAnswered || saving}
            style={{ width: "100%", padding: "14px", borderRadius: 12, background: allAnswered ? C.accent : C.border, border: "none", color: "white", fontSize: 15, fontWeight: 700, cursor: allAnswered ? "pointer" : "default", opacity: saving ? 0.7 : 1, transition: "background 0.2s" }}>
            {saving ? "Saving…" : allAnswered ? "Get My Score" : `Answer all ${step.questions.length} questions to continue`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Self-Inspection Modal ─────────────────────────────────────────────────────
function SelfInspectionModal({
  answers, step, onAnswer, onNext, onBack, onClose, onSave, saving,
}: {
  answers:  SelfInspectAnswers;
  step:     number;
  onAnswer: (questionId: string, value: string) => void;
  onNext:   () => void;
  onBack:   () => void;
  onClose:  () => void;
  onSave:   () => void;
  saving:   boolean;
}) {
  const totalSteps = SELF_INSPECT_STEPS.length;
  const currentStep = SELF_INSPECT_STEPS[step];
  if (!currentStep) return null;
  const stepComplete = isStepComplete(currentStep.key, answers);
  const isLast = step === totalSteps - 1;
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = SELF_INSPECT_STEPS.reduce((s, st) => s + st.questions.length, 0);

  // ── Per-question photo state ──────────────────────────────────────────────
  const [photoData, setPhotoData] = useState<Record<string, {
    previewUrl: string;
    analyzing:  boolean;
    suggestion?: string;
  }>>({});

  async function handleStepPhoto(questionId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: true } }));
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { data: { session } } = await supabase.auth.getSession();
      const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) reqHeaders["Authorization"] = `Bearer ${session.access_token}`;
      const resp = await fetch("/api/analyze-photos", {
        method:  "POST",
        headers: reqHeaders,
        // Pass focusArea so the API uses the system-specific inspection prompt
        body:    JSON.stringify({ photoUrls: [base64], focusArea: questionId }),
      });
      let suggestion = "Photo captured — use it as a reference when answering.";
      if (resp.ok) {
        const result = await resp.json();
        // Prefer the photo_summary (holistic) over individual findings for in-modal display
        const summary = result.photo_summary as string | undefined;
        const topFinding = (result.findings ?? [])[0];
        // For label-reading questions, manufacture_year gives a direct answer
        const mfgYear = result.manufacture_year as number | null | undefined;
        if (mfgYear) {
          const age = new Date().getFullYear() - mfgYear;
          const baseSummary = summary ?? topFinding?.description ?? "";
          suggestion = `Manufacture year: ${mfgYear} (${age} yr old). ${baseSummary}`.slice(0, 140);
        } else if (summary) {
          suggestion = summary.length > 130 ? summary.slice(0, 127) + "…" : summary;
        } else if (topFinding?.description) {
          const raw = topFinding.description as string;
          suggestion = raw.length > 130 ? raw.slice(0, 127) + "…" : raw;
        }
      }
      setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: false, suggestion } }));
    } catch {
      setPhotoData(prev => ({ ...prev, [questionId]: { previewUrl, analyzing: false, suggestion: "Photo captured." } }));
    }
    e.target.value = "";
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(15,31,61,0.55)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 600, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -8px 48px rgba(15,31,61,0.18)" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>Home Self-Inspection</p>
              <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>
                {currentStep.emoji} {currentStep.systemName}
              </p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4 }}>
              <X size={20}/>
            </button>
          </div>
          {/* Progress bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {SELF_INSPECT_STEPS.map((s, i) => (
              <div key={s.key} style={{ flex: 1, height: 4, borderRadius: 4, background: i < step ? C.accent : i === step ? C.accentLt : C.border, transition: "background 0.3s" }}/>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>Step {step + 1} of {totalSteps}</p>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>{answeredCount} / {totalQuestions} answered</p>
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
          <p style={{ fontSize: 13, color: C.text3, margin: "0 0 18px", lineHeight: 1.5 }}>{currentStep.description}</p>

          {currentStep.questions.map(q => {
            const pd = photoData[q.id];
            return (
              <div key={q.id} style={{ marginBottom: 22 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 4px", lineHeight: 1.4 }}>{q.label}</p>
                {q.hint && <p style={{ fontSize: 12, color: C.text3, margin: "0 0 10px", lineHeight: 1.4 }}>{q.hint}</p>}

                {/* ── Photo prompt card ── */}
                {q.photoPrompt && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <Camera size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#92400e", margin: "0 0 2px" }}>{q.photoPrompt.label}</p>
                        <p style={{ fontSize: 11, color: "#b45309", margin: "0 0 8px", lineHeight: 1.4 }}>{q.photoPrompt.tip}</p>

                        {pd ? (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            {/* Thumbnail */}
                            <img src={pd.previewUrl} alt="inspection photo" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1.5px solid #fcd34d" }}/>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {pd.analyzing ? (
                                <p style={{ fontSize: 12, color: "#d97706", margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                                  <Loader2 size={11} className="animate-spin"/> Analyzing photo…
                                </p>
                              ) : pd.suggestion ? (
                                <p style={{ fontSize: 12, color: "#78350f", margin: "0 0 6px", lineHeight: 1.4 }}>
                                  <span style={{ fontWeight: 700 }}>🤖 AI sees: </span>{pd.suggestion}
                                </p>
                              ) : null}
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#d97706", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                                Retake
                                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleStepPhoto(q.id, e)}/>
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "#d97706", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                              <Camera size={12}/> Take Photo
                              <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleStepPhoto(q.id, e)}/>
                            </label>
                            <span style={{ fontSize: 11, color: "#b45309" }}>Optional — helps verify your answer</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Answer options ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map(opt => {
                    const selected = answers[q.id] === opt.value;
                    const sevColor = opt.severity === "critical" ? C.red : opt.severity === "warning" ? "#f97316" : C.green;
                    const sevBg    = opt.severity === "critical" ? C.redBg : opt.severity === "warning" ? "rgba(249,115,22,0.08)" : C.greenBg;
                    return (
                      <button key={opt.value} onClick={() => onAnswer(q.id, opt.value)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                        padding: "11px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                        border: selected ? `2px solid ${sevColor}` : `2px solid ${C.border}`,
                        background: selected ? sevBg : C.surface,
                        transition: "all 0.15s",
                      }}>
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 700, color: selected ? sevColor : C.text, margin: "0 0 2px" }}>{opt.label}</p>
                          {opt.subLabel && <p style={{ fontSize: 12, color: selected ? sevColor : C.text3, margin: 0, opacity: 0.85 }}>{opt.subLabel}</p>}
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${selected ? sevColor : C.border}`, background: selected ? sevColor : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {selected && <Check size={11} color="white"/>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px 20px", borderTop: `1px solid ${C.border}`, flexShrink: 0, display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={onBack} style={{ padding: "12px 20px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text2, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              ← Back
            </button>
          )}
          {isLast ? (
            <button onClick={onSave} disabled={saving} style={{
              flex: 1, padding: "13px 20px", borderRadius: 12, border: "none",
              background: saving ? C.accentLt : C.accent, color: "white", fontSize: 15, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {saving ? <><Loader2 size={15} className="animate-spin"/> Saving…</> : <><CheckCircle2 size={15}/> Save Results</>}
            </button>
          ) : (
            <button onClick={onNext} style={{
              flex: 1, padding: "13px 20px", borderRadius: 12, border: "none",
              background: stepComplete ? C.accent : C.border, color: stepComplete ? "white" : C.text3,
              fontSize: 15, fontWeight: 700, cursor: stepComplete ? "pointer" : "default", transition: "all 0.15s",
            }}>
              {stepComplete ? "Next →" : "Answer all questions to continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthScoreModal({
  breakdown, roofYear, hvacYear, year, homeHealthReport, extCondition, onClose, onFindVendors, onStartSystemAssess,
}: {
  breakdown:           ScoreBreakdown;
  roofYear:            string;
  hvacYear:            string;
  year:                number;
  homeHealthReport?:   HomeHealthReport | null;
  extCondition?:       ExtendedConditionResult | null;
  onClose:             () => void;
  onFindVendors:       (trade: string, context?: string, issue?: string) => void;
  onStartSystemAssess: (stepKey: string) => void;
}) {
  const { score, deductions, resolvedDeductions } = breakdown;
  // Adjusted score = Core Score + Extended Condition modifier (±8, 0 when no data)
  const adjustedScore = Math.max(0, Math.min(100, score + (extCondition?.modifier ?? 0)));
  const st            = healthStatusInfo(adjustedScore);
  const scoreColor    = adjustedScore >= 90 ? "#22c55e" : adjustedScore >= 80 ? "#84cc16" : adjustedScore >= 65 ? C.amber : adjustedScore >= 50 ? "#f97316" : C.red;

  const roofAge = roofYear ? year - Number(roofYear) : null;
  const hvacAge = hvacYear ? year - Number(hvacYear) : null;

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  function sourceBadge(d: ScoreDeduction) {
    if (d.source === "system_age")    return { label: "System Age",  color: C.amber, bg: C.amberBg };
    if (d.severity === "critical")    return { label: "High Priority",     color: C.red,   bg: C.redBg   };
    if (d.severity === "warning")     return { label: "Moderate Priority", color: C.amber, bg: C.amberBg };
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
              <span style={{ fontSize: 58, fontWeight: 800, color: scoreColor, lineHeight: 1, letterSpacing: "-2px" }}>{adjustedScore}</span>
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
            {homeHealthReport.category_scores.length > 0 && (
              <div style={{ padding: "18px 28px", borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>System Health</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {homeHealthReport.category_scores
                    .sort((a, b) => {
                      // Not-assessed systems always go last
                      if (a.not_assessed !== b.not_assessed) return a.not_assessed ? 1 : -1;
                      return a.score - b.score;
                    })
                    .map(cs => {
                      const noData = cs.not_assessed;
                      const barColor = noData ? C.text3 : cs.score >= 80 ? C.green : cs.score >= 65 ? C.amber : C.red;
                      const label = formatLabel(cs.category);
                      const stepKey = CATEGORY_TO_STEP_KEY[cs.category];
                      return (
                        <div key={cs.category}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 12, color: noData ? C.text3 : C.text2, fontWeight: 500 }}>{label}</span>
                            {noData
                              ? (stepKey
                                  ? <button
                                      onClick={() => { onClose(); onStartSystemAssess(stepKey); }}
                                      style={{ fontSize: 11, color: C.accent, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: "2px 0", textDecoration: "underline", textUnderlineOffset: 2 }}>
                                      Rate this system
                                    </button>
                                  : <span style={{ fontSize: 11, color: C.text3, fontStyle: "italic" }}>Not assessed</span>
                                )
                              : <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{cs.score}</span>
                            }
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: noData ? "100%" : `${cs.score}%`, background: noData ? C.border : barColor, borderRadius: 3, transition: "width 0.8s ease" }}/>
                          </div>
                          {noData && stepKey && (
                            <p style={{ fontSize: 10, color: C.text3, margin: "3px 0 0", lineHeight: 1.3 }}>
                              No inspection data — answer a few questions to get a score
                            </p>
                          )}
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
              <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{adjustedScore} / 100</span>
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

              {/* Extended Condition modifier row — shown only when Tier 2 data exists */}
              {extCondition?.label && (() => {
                const mod = extCondition.modifier;
                const modColor = mod >= 4 ? C.green : mod > 0 ? "#84cc16" : mod < 0 ? C.red : C.text3;
                const modBg    = mod >= 4 ? C.greenBg : mod > 0 ? "rgba(132,204,22,0.10)" : mod < 0 ? C.redBg : C.bg;
                return (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: modBg, border: `1px solid ${modColor}30`, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: C.text2, fontWeight: 500 }}>Extended Condition</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: modColor, background: `${modColor}18`, border: `1px solid ${modColor}35` }}>
                        {extCondition.label}
                      </span>
                      <span style={{ fontSize: 11, color: C.text3 }}>· {extCondition.itemCount} item{extCondition.itemCount !== 1 ? "s" : ""}</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 800, color: modColor, flexShrink: 0 }}>
                      {mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : "±0"}
                    </span>
                  </div>
                );
              })()}

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
                              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{formatLabel(d.category)}</span>
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
                <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor }}>{adjustedScore} / 100</span>
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{formatLabel(d.category)}</span>
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
function ScoreRing({ score, color, size = 130, textColor, trackColor, disableGlow }: {
  score: number; color: string; size?: number;
  textColor?: string; trackColor?: string; disableGlow?: boolean;
}) {
  const r      = size * 0.38;
  const cx     = size / 2;
  const cy     = size / 2;
  const strokeW= size * 0.085;
  const circum = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(score / 100, 1)) * circum;
  const uid    = `glow-${size}`;
  const numColor  = textColor ?? "white";
  const subColor  = textColor ? (textColor === "white" ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)") : "rgba(255,255,255,0.35)";
  const trackFill = trackColor ?? "rgba(255,255,255,0.10)";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, filter: disableGlow ? "none" : `drop-shadow(0 0 ${size * 0.07}px ${color}80)` }}>
      <defs>
        <filter id={uid} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={size * 0.025} result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackFill} strokeWidth={strokeW}/>
      {/* Filled arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={`${filled} ${circum - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        filter={disableGlow ? undefined : `url(#${uid})`}
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)" }}
      />
      {/* Score number */}
      <text x={cx} y={cy - size * 0.04} textAnchor="middle" dominantBaseline="middle"
        fill={numColor} fontSize={size * 0.28} fontWeight="800" fontFamily="'Inter', -apple-system, sans-serif"
        style={{ letterSpacing: "-2px" }}>
        {score}
      </text>
      {/* /100 label */}
      <text x={cx} y={cy + size * 0.18} textAnchor="middle" dominantBaseline="middle"
        fill={subColor} fontSize={size * 0.09} fontFamily="'Inter', -apple-system, sans-serif">
        / 100
      </text>
    </svg>
  );
}

function healthStatusInfo(score: number) {
  if (score >= 90) return { label: "Excellent",       tagColor: "#22c55e", tagBg: "rgba(34,197,94,0.18)",  desc: "Your home is in great shape. Keep up with routine maintenance." };
  if (score >= 80) return { label: "Good",            tagColor: "#84cc16", tagBg: "rgba(132,204,22,0.18)", desc: "Your home is healthy. A few items to monitor over time." };
  if (score >= 65) return { label: "Fair",            tagColor: "#f59e0b", tagBg: "rgba(245,158,11,0.18)", desc: "Some systems need attention. Review the breakdown for next steps." };
  if (score >= 50) return { label: "Needs Attention", tagColor: "#f97316", tagBg: "rgba(249,115,22,0.18)", desc: "A few things to address — your plan is ready when you are." };
  return                  { label: "Needs Work",      tagColor: "#ef4444", tagBg: "rgba(239,68,68,0.18)",  desc: "Recommended to address soon. See the breakdown for a clear plan." };
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
                ? <><AlertTriangle size={11}/> High Priority</>
                : item.severity === "warning"
                  ? <><AlertCircle size={11}/> Moderate Priority</>
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
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: "1.5px solid ${C.accent}", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}>
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
  const [showTutorial, setShowTutorial] = useState(false);
  const [toast, setToast]       = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const toastTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [docs, setDocs]         = useState<Doc[]>([]);
  const [inspectionDoc, setInspectionDoc] = useState<Doc | null>(null); // last uploaded inspection file reference
  const [confirmDeleteInspection, setConfirmDeleteInspection] = useState(false); // score-reset warning modal

  // ── Seasonal checklist "done" state (legacy — kept for seasonal checkboxes) ──
  // Keyed by season+year so it auto-resets each new season.
  const maintenanceDoneKey = (() => {
    const mo = new Date().getMonth();
    const yr = new Date().getFullYear();
    const s = mo <= 1 || mo === 11 ? "winter" : mo <= 4 ? "spring" : mo <= 7 ? "summer" : "fall";
    return `btlr-maintenance-done-${s}-${yr}`;
  })();
  const [doneTasks, setDoneTasks] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(maintenanceDoneKey) : null;
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  function toggleDoneTask(key: string) {
    setDoneTasks(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(maintenanceDoneKey, JSON.stringify([...next])); } catch { /* silent */ }
      return next;
    });
  }

  // ── Recurring maintenance task completions ────────────────────────────────
  // Keyed by task ID → ISO datetime of most recent completion.
  // Separate from inspection findings / repairs — maintenance = behavior, not condition.
  const [maintCompletions, setMaintCompletions] = useState<Record<string, string>>({});
  function toggleMaintTask(taskId: string) {
    const propId = activePropertyIdRef.current;
    setMaintCompletions(prev => {
      const next = { ...prev };
      if (next[taskId]) { delete next[taskId]; } else { next[taskId] = new Date().toISOString(); }
      try { localStorage.setItem(`btlr_maint_v1_${propId ?? "0"}`, JSON.stringify(next)); } catch { /* silent */ }
      return next;
    });
  }

  // ── Maintenance scheduled state (date + vendor + status) ─────────────
  const [maintScheduled, setMaintScheduled] = useState<Record<string, { date: string; status: "scheduled" | "booked"; vendor?: string }>>({});
  const [maintFilter, setMaintFilter]       = useState<"all"|"due"|"done">("all");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [scheduleModal, setScheduleModal] = useState<{ taskId: string; taskName: string } | null>(null);
  const [schedDate, setSchedDate]     = useState("");
  const [schedVendor, setSchedVendor] = useState("");
  const [trustedContacts, setTrustedContacts] = useState<TrustedContact[]>([]);

  // ── Theme customization ────────────────────────────────────────────────
  interface CustomTheme { accent?: string; navy?: string; bgImage?: string; }
  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => {
    try { const s = typeof window !== "undefined" ? localStorage.getItem("btlr_custom_theme") : null; return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [showCustomize, setShowCustomize] = useState(false);
  // Draft state for the customize panel (only applied on Save)
  const [draftAccent, setDraftAccent]  = useState(customTheme.accent ?? C.accent);
  const [draftNavy,   setDraftNavy]    = useState(customTheme.navy   ?? C.navy);
  const [draftBgImg,  setDraftBgImg]   = useState(customTheme.bgImage ?? "");

  function applyTheme(t: CustomTheme) {
    setCustomTheme(t);
    try { localStorage.setItem("btlr_custom_theme", JSON.stringify(t)); } catch {}
  }
  function saveCustomize() {
    applyTheme({ accent: draftAccent, navy: draftNavy, bgImage: draftBgImg || undefined });
    setShowCustomize(false);
  }
  function resetTheme() {
    setDraftAccent(C.accent); setDraftNavy(C.navy); setDraftBgImg("");
    applyTheme({});
    setShowCustomize(false);
  }
  // Effective theme values — used in key places throughout the render
  const themeAccent = customTheme.accent ?? C.accent;
  const themeNavy   = customTheme.navy   ?? C.navy;

  function saveSchedule(taskId: string, s: "scheduled" | "booked") {
    const next = { ...maintScheduled, [taskId]: { date: schedDate, status: s, vendor: schedVendor.trim() || undefined } };
    setMaintScheduled(next);
    const propId = activePropertyIdRef.current;
    try { localStorage.setItem(`btlr_maint_sched_v1_${propId ?? "0"}`, JSON.stringify(next)); } catch {}
    setScheduleModal(null); setSchedDate(""); setSchedVendor("");
  }
  function clearSchedule(taskId: string) {
    const next = { ...maintScheduled }; delete next[taskId];
    setMaintScheduled(next);
    const propId = activePropertyIdRef.current;
    try { localStorage.setItem(`btlr_maint_sched_v1_${propId ?? "0"}`, JSON.stringify(next)); } catch {}
  }

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
  const [inspectStage, setInspectStage] = useState<"uploading" | "analyzing" | "saving" | "">("");
  const [inspectIsLargeFile, setInspectIsLargeFile] = useState(false);
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
  const [regionalRanges,  setRegionalRanges]    = useState<Record<string, Record<string, { estimated_cost_min: number; estimated_cost_max: number }>> | null>(null);
  const [regionalLocation, setRegionalLocation] = useState<{ city?: string; state?: string } | null>(null);

  // Photo analysis (upload UI removed; state kept for backward-compat with saved data)
  const [photoFindings, setPhotoFindings]       = useState<Finding[]>([]);

  const [docLoading, setDocLoading]         = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved]   = useState(false);
  const [profileName, setProfileName]       = useState("");
  const [savingName, setSavingName]         = useState(false);
  const [nameSaved, setNameSaved]           = useState(false);
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
  const [repairDocs, setRepairDocs]           = useState<Array<{ id?: string; vendor?: string; date?: string; summary?: string; category?: string; cost?: number; autoResolved?: string[]; storagePath?: string; fileUrl?: string; filename?: string }>>([]);
  const [uploadingRepair, setUploadingRepair] = useState(false);
  const repairRef = useRef<HTMLInputElement>(null);

  // ── Repair Complete Modal ─────────────────────────────────────────────────
  const [showCompleteModal, setShowCompleteModal]       = useState(false);
  const [completeModalTarget, setCompleteModalTarget]   = useState<{ finding: Finding; globalIdx: number } | null>(null);
  const [savingComplete, setSavingComplete]             = useState(false);
  const [archivesExpanded, setArchivesExpanded]         = useState(false);
  const [showFullCostPlan, setShowFullCostPlan]         = useState(false);

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

  // Plaid MFA gate
  const [showMfaModal, setShowMfaModal]       = useState(false);
  const [mfaOtpValue,  setMfaOtpValue]        = useState("");
  const [mfaSending,   setMfaSending]          = useState(false);
  const [mfaVerifying, setMfaVerifying]        = useState(false);
  const [mfaError,     setMfaError]            = useState("");
  const [plaidToken,   setPlaidToken]          = useState<string | null>(null);

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
    additionalPolicies?: Array<{ provider?: string; policyType?: string; policyNumber?: string; premium?: number; annualPremium?: number; renewalDate?: string; expirationDate?: string; deductible?: number; claimPhone?: string; claimUrl?: string; claimEmail?: string }>;
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
  const [openDocSection, setOpenDocSection]     = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(0);
  const [smartSaveMode, setSmartSaveMode] = useState(false);
  const [editingContribution, setEditingContribution] = useState(false);
  const [contributionInput, setContributionInput] = useState("");
  const warrantyRef = useRef<HTMLInputElement>(null);
  const [warrantyDocUrl, setWarrantyDocUrl]   = useState<string | null>(null);
  const [insuranceDocUrls, setInsuranceDocUrls] = useState<string[]>([]);

  const inspRef    = useRef<HTMLInputElement>(null);
  const docRef     = useRef<HTMLInputElement>(null);
  const photoRef   = useRef<HTMLInputElement>(null);
  const scanDocRef = useRef<HTMLInputElement>(null);
  const scanningDocRef = useRef<string>(""); // tracks current scan type without triggering re-render
  const [scanningDoc, setScanningDoc] = useState<"" | "inspection" | "insurance" | "warranty" | "mortgage">("");

  // ── User tier + inspection source ─────────────────────────────────────────
  const [userTier, setUserTier]               = useState<"free" | "pro">("free");
  const [inspectionSource, setInspectionSource] = useState<"professional" | "self" | null>(null);

  // ── Self-inspection modal ──────────────────────────────────────────────────
  const [showSelfInspectModal, setShowSelfInspectModal] = useState(false);
  const [selfInspectStep, setSelfInspectStep]           = useState(0);
  const [selfInspectAnswers, setSelfInspectAnswers]     = useState<SelfInspectAnswers>({});
  const [savingSelfInspect, setSavingSelfInspect]       = useState(false);

  // ── Per-system assessment modal ────────────────────────────────────────────
  const [systemAssessStepKey, setSystemAssessStepKey]   = useState<string | null>(null);
  const [systemAssessAnswers, setSystemAssessAnswers]   = useState<SelfInspectAnswers>({});
  const [savingSystemAssess, setSavingSystemAssess]     = useState(false);

  // ── Photo capture ──────────────────────────────────────────────────────────
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoErr, setPhotoErr]             = useState("");

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
    // Show tutorial on first visit
    try {
      if (!localStorage.getItem("btlr_tutorial_seen")) {
        setShowTutorial(true);
      }
    } catch { /* ignore */ }
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
        loadTrustedContacts(); // load Home Team contacts for maintenance vendor auto-suggest
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
    // Format context: if it looks like a raw DB key (underscores, no spaces), convert to human-readable
    const formattedCtx = context
      ? (context.includes("_") && !context.includes(" ") ? categoryLabel(context) : context)
      : null;
    setVendorContext(formattedCtx);
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

  function handleTutorialClose() {
    setShowTutorial(false);
    try { localStorage.setItem("btlr_tutorial_seen", "1"); } catch { /* ignore */ }
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
        // Upload to storage and save document row
        if (uid) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `${uid}/insurance-${Date.now()}-${safeName}`;
          await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
          // Always save documents row — user_id alone is enough; propId added when available
          await supabase.from("documents").insert({
            user_id: uid, ...(propId ? { property_id: propId } : {}),
            file_name: file.name, file_path: storagePath, document_type: "insurance",
          });
          const { data: signedIns } = await supabase.storage.from("documents").createSignedUrl(storagePath, 3600);
          if (signedIns?.signedUrl) setInsuranceDocUrls(prev => [...prev, signedIns.signedUrl]);
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

      // Upload raw file to storage
      const ts       = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${uid}/insurance-add-${ts}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);

      // Save documents row so PDF is viewable on reload (no propId gate — user_id alone is enough)
      await supabase.from("documents").insert({
        user_id: uid, ...(propId ? { property_id: propId } : {}),
        file_name: file.name, file_path: storagePath, document_type: "insurance",
      });

      // Populate PDF link immediately
      const { data: signedAdd } = await supabase.storage.from("documents").createSignedUrl(storagePath, 3600);
      if (signedAdd?.signedUrl) setInsuranceDocUrls(prev => [...prev, signedAdd.signedUrl]);

      // Send raw file bytes to the API — same path as uploadInsurance
      const params = new URLSearchParams();
      if (uid)    params.set("userId",     uid);
      if (propId) params.set("propertyId", String(propId));
      const res = await fetch(`/api/parse-insurance?${params}`, {
        method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any = {};
      try { json = await res.json(); } catch { throw new Error("Server error parsing policy"); }

      const parsed = json.data ?? json;
      if (!parsed || json.error) throw new Error(json.error ?? "Could not parse policy");

      // Build compact secondary policy — API returns camelCase keys
      const newPolicy = {
        provider:       parsed.provider       ?? null,
        policyType:     parsed.policyType     ?? null,
        policyNumber:   parsed.policyNumber   ?? null,
        annualPremium:  parsed.annualPremium  ?? null,
        expirationDate: parsed.expirationDate ?? null,
        claimPhone:     parsed.claimPhone     ?? null,
        claimUrl:       parsed.claimUrl       ?? null,
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
      setInsuranceDocCount(prev => prev + 1);
      showToast(`✓ Added ${newPolicy.provider ?? "policy"} — both policies now active`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setInsuranceError(`Could not add policy: ${msg}`);
      showToast(`Could not add policy: ${msg}`, "error");
    }
    setParsingInsurance(false);
    setInsuranceFileKey(k => k + 1);
  }

  async function deleteInsurance() {
    if (!confirm("Remove this insurance record? This will clear all parsed policy data.")) return;
    const propId = activePropertyIdRef.current;
    if (propId) {
      const { error: delErr } = await supabase.from("home_insurance").delete().eq("property_id", propId);
      if (delErr) {
        console.error("[deleteInsurance] DB delete failed:", delErr.message);
        showToast("Delete failed — please try again.", "error");
        return;
      }
      // Also clear legacy insurance columns on the properties row so the
      // properties-table fallback doesn't repopulate on refresh.
      await supabase.from("properties").update({
        insurance_premium: null,
        insurance_renewal: null,
      }).eq("id", propId);
    }
    setInsurance(null);
    setInsuranceDocUrls([]);
    showToast("Insurance record removed", "success");
  }

  async function deleteWarranty() {
    if (!confirm("Remove this warranty record? This will clear all parsed warranty data.")) return;
    const propId = activePropertyIdRef.current;
    if (propId) {
      const { error: delErr } = await supabase.from("home_warranties").delete().eq("property_id", propId);
      if (delErr) {
        console.error("[deleteWarranty] DB delete failed:", delErr.message);
        showToast("Delete failed — please try again.", "error");
        return;
      }
    }
    setWarranty(null);
    setWarrantyDocUrl(null);
    showToast("Warranty record removed", "success");
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
        // Always save documents row — user_id alone is enough; propId added when available
        await supabase.from("documents").insert({
          user_id: uid, ...(propId ? { property_id: propId } : {}),
          file_name: file.name, file_path: storagePath, document_type: "warranty",
        });
        const { data: signedWarr } = await supabase.storage.from("documents").createSignedUrl(storagePath, 3600);
        if (signedWarr?.signedUrl) setWarrantyDocUrl(signedWarr.signedUrl);
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

  function launchPlaidHandler(link_token: string) {
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
  }

  async function connectPlaid() {
    setConnectingPlaid(true);
    setMfaError("");
    setMfaOtpValue("");
    try {
      // Fetch link_token and send OTP in parallel
      const [tokenRes] = await Promise.all([
        fetch("/api/plaid-link", { method: "POST" }),
        supabase.auth.signInWithOtp({ email: user!.email!, options: { shouldCreateUser: false } }),
      ]);
      const { link_token, error } = await tokenRes.json();
      if (error || !link_token) { alert("Could not start bank connection."); setConnectingPlaid(false); return; }
      setPlaidToken(link_token);
      setConnectingPlaid(false);
      setShowMfaModal(true);
    } catch { alert("Bank connection failed."); setConnectingPlaid(false); }
  }

  async function verifyMfaAndLaunch() {
    if (!mfaOtpValue.trim() || !user?.email || !plaidToken) return;
    setMfaVerifying(true);
    setMfaError("");
    const { error } = await supabase.auth.verifyOtp({ email: user.email, token: mfaOtpValue.trim(), type: "email" });
    if (error) {
      setMfaError("Incorrect code — please check your email and try again.");
      setMfaVerifying(false);
      return;
    }
    setShowMfaModal(false);
    setMfaOtpValue("");
    setConnectingPlaid(true);
    launchPlaidHandler(plaidToken);
  }

  async function checkAuth(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return false; }
    setUser(session.user);
    const existingName = (session.user as any)?.user_metadata?.first_name ?? "";
    if (existingName) setProfileName(existingName);
    // Load user tier from user_profiles (non-blocking — defaults to 'free')
    supabase.from("user_profiles").select("tier").eq("id", session.user.id).maybeSingle()
      .then(({ data: profile }) => { if (profile?.tier) setUserTier(profile.tier as "free" | "pro"); });
    return true;
  }

  // Fetch saved contacts (Home Team) so we can auto-suggest them in the maintenance modal
  async function loadTrustedContacts() {
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      const { data } = await supabase
        .from("saved_contacts")
        .select("id, name, company, role, category, phone")
        .eq("user_id", u.id);
      if (data) setTrustedContacts(data as TrustedContact[]);
    } catch { /* non-critical — schedule modal still works without it */ }
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
    // Timeline for the new property will be restored by switchProperty → loadTimelineFromStorage
    setWarrantyDocUrl(null); setInsuranceDocUrls([]);
    setParseDebug(null); setMortgageForm({ lender: "loanDepot", balance: "", payment: "", due_day: "1", rate: "" });
    setInspectionSource(null);
    // Clear maintenance state — these are property-specific and must not bleed across properties
    setMaintScheduled({});
    setMaintCompletions({});
    setDoneTasks(new Set());
    // Clear documents — loadDocs() will reload for the new property
    setDocs([]);
    setInspectionDoc(null);
    // Clear repair completions — reloaded per-property by loadRepairCompletions()
    setRepairCompletions({});
  }

  // ── Save self-inspection results ───────────────────────────────────────
  async function saveSelfInspection(answers: SelfInspectAnswers) {
    const propId = activePropertyIdRef.current;
    if (!propId) return;
    setSavingSelfInspect(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSavingSelfInspect(false); return; }

      const generated = generateSelfInspectionFindings(answers);

      // 1. Delete previous self-inspection findings for this property
      await supabase.from("findings")
        .delete()
        .eq("property_id", propId)
        .eq("finding_source", "self_inspection");

      // 2. Insert new findings
      if (generated.length > 0) {
        const rows = generated.map(f => ({
          property_id:            propId,
          user_id:                session.user.id,
          category:               f.category,
          description:            f.description,
          severity:               f.severity,
          normalized_finding_key: f.normalized_finding_key,
          finding_source:         "self_inspection",
          raw_finding:            f,
          status:                 "repair_needed",
        }));
        await supabase.from("findings").upsert(rows, { onConflict: "normalized_finding_key,property_id" });
      }

      // 3. Mark property as self-inspected today
      await supabase.from("properties").update({
        inspection_source: "self",
        inspection_date:   new Date().toISOString().slice(0, 10),
        inspection_type:   "Self-Inspection",
      }).eq("id", propId);

      setInspectionSource("self");
      setShowSelfInspectModal(false);
      setSelfInspectAnswers({});
      setSelfInspectStep(0);

      // Reload scoring with new findings
      loadProperty(propId);
    } catch (err) {
      console.error("[saveSelfInspection] error:", err);
    }
    setSavingSelfInspect(false);
  }

  // ── Save a single-system self-assessment ──────────────────────────────────
  async function saveSystemAssessment(stepKey: string, answers: SelfInspectAnswers) {
    const propId = activePropertyIdRef.current;
    if (!propId) return;
    setSavingSystemAssess(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSavingSystemAssess(false); return; }

      // Generate findings for only this step's questions
      const allGenerated = generateSelfInspectionFindings(answers);
      const step = SELF_INSPECT_STEPS.find(s => s.key === stepKey);
      const generated = allGenerated.filter(f =>
        f.normalized_finding_key.startsWith(`self__${stepKey}__`)
      );

      // Delete only the previous self-inspection findings for this specific step's categories
      const stepCategories = [...new Set(step?.questions.map(q => q.category) ?? [])];
      for (const cat of stepCategories) {
        await supabase.from("findings")
          .delete()
          .eq("property_id", propId)
          .eq("finding_source", "self_inspection")
          .eq("category", cat);
      }

      // Upsert new findings
      if (generated.length > 0) {
        const rows = generated.map(f => ({
          property_id:            propId,
          user_id:                session.user.id,
          category:               f.category,
          description:            f.description,
          severity:               f.severity,
          normalized_finding_key: f.normalized_finding_key,
          finding_source:         "self_inspection",
          raw_finding:            f,
          status:                 "repair_needed",
        }));
        await supabase.from("findings").upsert(rows, { onConflict: "normalized_finding_key,property_id" });
      }

      // If no inspection source yet, mark as self-inspected
      if (!inspectionSource) {
        await supabase.from("properties").update({
          inspection_source: "self",
          inspection_date:   new Date().toISOString().slice(0, 10),
          inspection_type:   "Self-Inspection",
        }).eq("id", propId);
        setInspectionSource("self");
      }

      setSystemAssessStepKey(null);
      setSystemAssessAnswers({});
      loadProperty(propId);
    } catch (err) {
      console.error("[saveSystemAssessment] error:", err);
    }
    setSavingSystemAssess(false);
  }

  // ── Analyze photos from camera / gallery ───────────────────────────────
  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setPhotoErr("");
    setPhotoAnalyzing(true);
    try {
      // Convert each file to base64 data URL (OpenAI vision accepts these directly)
      const toBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });
      const photoUrls = await Promise.all(files.slice(0, 5).map(toBase64));
      const headers   = await getAuthHeader();
      const resp = await fetch("/api/analyze-photos", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body:    JSON.stringify({ photoUrls }),
      });
      if (!resp.ok) { setPhotoErr("Photo analysis failed — please try again."); return; }
      const result = await resp.json();
      if (!result.success) { setPhotoErr(result.error ?? "Analysis failed — please try again."); return; }

      const newFindings: Finding[] = (result.findings ?? []).map((f: Finding) => ({ ...f, source: "photo" }));
      const allPhotoFindings = [...photoFindings, ...newFindings];
      setPhotoFindings(allPhotoFindings);
      setInspectDone(true);

      // Persist to DB
      const propId = activePropertyIdRef.current;
      if (propId) {
        supabase.from("properties")
          .update({ photo_findings: allPhotoFindings })
          .eq("id", propId)
          .then(({ error }) => { if (error) console.warn("[handlePhotoCapture] DB update failed:", error.message); });
      }
    } catch (err) {
      console.error("[handlePhotoCapture]", err);
      setPhotoErr("Photo upload failed — please try again.");
    }
    setPhotoAnalyzing(false);
    if (photoRef.current) photoRef.current.value = "";
  }

  // ── Scan document photos (inspection report, insurance, warranty, mortgage) ──
  async function handleDocumentScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const docType = scanningDocRef.current;
    if (!files.length || !docType) return;

    // Convert images to base64
    const toBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(f);
    });

    try {
      const photoUrls = await Promise.all(files.slice(0, 6).map(toBase64));
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      const propId = activePropertyIdRef.current;

      // Show appropriate loading state
      if (docType === "inspection") { setInspecting(true); setInspectErr(""); }
      if (docType === "insurance")  setParsingInsurance(true);
      if (docType === "warranty")   setParsingWarranty(true);
      if (docType === "mortgage")   setMortgageStatLoading(true);

      showToast(`Scanning ${docType} document…`, "info");

      const headers = await getAuthHeader();
      const res = await fetch("/api/scan-document", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body:    JSON.stringify({ photoUrls, documentType: docType, userId, propertyId: propId?.toString() }),
      });

      if (!res.ok) { showToast("Scan failed — please try again", "error"); return; }
      const result = await res.json();
      if (!result.success) { showToast(result.error ?? "Scan failed", "error"); return; }

      const d = result.data;

      if (docType === "inspection") {
        const newFindings: Finding[] = (d.findings ?? []).map((f: Finding) => ({ ...f, source: "photo" as const }));
        if (!newFindings.length) { showToast("No findings detected — try clearer photos", "info"); return; }
        const freshStatuses: Record<string, FindingStatus> = {};
        setFindingStatuses(freshStatuses);
        const inspPayload = {
          inspection_findings:  newFindings,
          inspection_type:      "Home Inspection",
          inspection_summary:   d.summary     ?? null,
          inspection_date:      d.inspection_date ?? null,
          inspector_company:    d.inspector_name  ?? null,
          finding_statuses:     freshStatuses,
          ...(isValidPropertyAddress(d.property_address) ? { address: d.property_address } : {}),
          updated_at: new Date().toISOString(),
        };
        if (propId) {
          const { error } = await supabase.from("properties").update(inspPayload).eq("id", propId);
          if (error) showToast("Scan saved but couldn't persist to DB — refresh if issues persist", "error");
        }
        // Run scoring engine (same pipeline as uploadInspection)
        const roofAge = roofYear ? (new Date().getFullYear() - parseInt(roofYear)) : null;
        const hvacAge = hvacYear ? (new Date().getFullYear() - parseInt(hvacYear)) : null;
        const norm = normalizeLegacyFindings(newFindings, roofAge, hvacAge);
        const { report } = runScoringPipeline({ items: norm, propertyId: propId ?? 0 });
        setInspectionResult({ findings: newFindings, summary: d.summary ?? undefined });
        setHomeHealthReport(report);
        setInspectDone(true);
        addEvent(`Inspection scanned: ${newFindings.length} finding${newFindings.length !== 1 ? "s" : ""} extracted`);
        showToast(`✓ Found ${newFindings.length} items — inspection loaded`, "success");

      } else if (docType === "insurance") {
        // Map parsed fields → client-side insurance object (same mapping as uploadInsurance)
        const ins = {
          provider:                d.provider           ?? null,
          policyNumber:            d.policyNumber        ?? null,
          policyType:              d.policyType          ?? null,
          agentName:               d.agentName           ?? null,
          agentPhone:              d.agentPhone          ?? null,
          annualPremium:           d.annualPremium        ?? null,
          premium:                 d.annualPremium        ?? null,
          dwellingCoverage:        d.dwellingCoverage     ?? null,
          otherStructures:         d.otherStructures      ?? null,
          personalProperty:        d.personalProperty     ?? null,
          lossOfUse:               d.lossOfUse            ?? null,
          liabilityCoverage:       d.liabilityCoverage    ?? null,
          deductibleStandard:      d.deductibleStandard   ?? null,
          deductibleWind:          d.deductibleWind       ?? null,
          deductibleHurricane:     d.deductibleHurricane  ?? null,
          effectiveDate:           d.effectiveDate        ?? null,
          expirationDate:          d.expirationDate       ?? null,
          autoRenews:              d.autoRenews           ?? null,
          coverageItems:           d.coverageItems        ?? [],
          exclusions:              d.exclusions           ?? [],
          endorsements:            d.endorsements         ?? [],
          replacementCostDwelling: d.replacementCostDwelling ?? null,
          replacementCostContents: d.replacementCostContents ?? null,
          claimPhone:              d.claimPhone           ?? null,
          claimUrl:                d.claimUrl             ?? null,
          claimEmail:              d.claimEmail           ?? null,
          additionalPolicies:      [],
        };
        setInsurance(ins);
        showToast("✓ Insurance policy scanned and loaded", "success");

      } else if (docType === "warranty") {
        setWarranty({
          provider:          d.provider         ?? null,
          planName:          d.planName          ?? null,
          policyNumber:      d.policyNumber      ?? null,
          serviceFee:        d.serviceFee        ?? null,
          coverageItems:     d.coverageItems     ?? [],
          exclusions:        d.exclusions        ?? [],
          effectiveDate:     d.effectiveDate     ?? null,
          expirationDate:    d.expirationDate    ?? null,
          autoRenews:        d.autoRenews        ?? null,
          paymentAmount:     d.paymentAmount     ?? null,
          paymentFrequency:  d.paymentFrequency  ?? null,
          claimPhone:        d.claimPhone        ?? null,
          claimUrl:          d.claimUrl          ?? null,
          waitingPeriod:     d.waitingPeriod     ?? null,
          responseTime:      d.responseTime      ?? null,
          maxAnnualBenefit:  d.maxAnnualBenefit  ?? null,
        });
        showToast("✓ Warranty scanned and loaded", "success");

      } else if (docType === "mortgage") {
        const m = {
          lender:    d.lender    ?? "Mortgage",
          balance:   d.balance   ?? undefined,
          payment:   d.payment   ?? undefined,
          due_day:   d.due_day   ?? undefined,
          rate:      d.rate      ?? undefined,
        };
        setMortgage(m);
        setMortgageForm({
          lender:    m.lender,
          balance:   m.balance?.toString()  ?? "",
          payment:   m.payment?.toString()  ?? "",
          due_day:   m.due_day?.toString()  ?? "1",
          rate:      m.rate ? (m.rate * 100).toFixed(3) : "",
        });
        // Save to DB
        if (propId) {
          supabase.from("properties").update({
            mortgage_lender:  m.lender,
            mortgage_balance: m.balance  ?? null,
            mortgage_payment: m.payment  ?? null,
            mortgage_due_day: m.due_day  ?? null,
            mortgage_rate:    m.rate     ?? null,
          }).eq("id", propId).then(({ error }) => {
            if (error) console.warn("[scanMortgage] DB save failed:", error.message);
          });
        }
        showToast("✓ Mortgage statement scanned and loaded", "success");
      }

    } catch (err) {
      console.error("[handleDocumentScan]", err);
      showToast("Scan failed — please try again", "error");
    } finally {
      scanningDocRef.current = "";
      setScanningDoc("");
      if (docType === "inspection") setInspecting(false);
      if (docType === "insurance")  setParsingInsurance(false);
      if (docType === "warranty")   setParsingWarranty(false);
      if (docType === "mortgage")   setMortgageStatLoading(false);
      if (scanDocRef.current) scanDocRef.current.value = "";
    }
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
        .order("id", { ascending: true });  // created_at may not exist on older schemas
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
      loadTimelineFromStorage(active);
      return active;
    } catch { return null; }
  }

  // ── Switch to a different property ────────────────────────────────────
  async function switchProperty(id: number) {
    clearPropertyState();
    setActivePropertyId(id);
    setNav("Dashboard"); // always land on Dashboard so each property starts fresh
    loadTimelineFromStorage(id);
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
      // Generate a unique address so the unique(user_id, address) constraint
      // doesn't fire when the user already has a "New Property".
      const existingAddresses = new Set(allProperties.map(p => p.address));
      let newAddress = "New Property";
      let n = 2;
      while (existingAddresses.has(newAddress)) { newAddress = `New Property ${n++}`; }
      const { data, error } = await supabase.from("properties").insert({
        user_id:  u.id,
        address:  newAddress,
      }).select("id, address").single();
      if (error) throw new Error(error.message);
      setAllProperties(prev => [...prev, data]);
      setShowPropDropdown(false);
      clearPropertyState();
      activePropertyIdRef.current = data.id; // set ref before any async that reads it
      setAddress(newAddress); // match what's actually in DB
      setNav("Documents"); // open Documents tab so inspection upload is front-and-center
      setActivePropertyId(data.id);
      localStorage.setItem("btlr_active_property_id", String(data.id));
      phCapture("property_created", { property_id: data.id, method: "blank" });
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
      phCapture("property_created", { property_id: data.id, address: data.address, method: "form", home_type: newPropForm.home_type || null, year_built: newPropForm.year_built || null });
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

      // ── Load property-scoped maintenance state from localStorage ─────────
      try {
        const savedComp  = localStorage.getItem(`btlr_maint_v1_${propId}`);
        const savedSched = localStorage.getItem(`btlr_maint_sched_v1_${propId}`);
        setMaintCompletions(savedComp  ? JSON.parse(savedComp)  : {});
        setMaintScheduled(savedSched ? JSON.parse(savedSched) : {});
      } catch { setMaintCompletions({}); setMaintScheduled({}); }

      // Validate address loaded from DB — reject inspection jargon that may have
      // been persisted before the validator was in place.
      const loadedAddress = isValidPropertyAddress(data.address) ? data.address : null;
      setAddress(loadedAddress ?? "My Home");
      // Scrub the bad value from DB so it doesn't persist
      if (data.address && !loadedAddress) {
        supabase.from("properties").update({ address: null }).eq("id", propId).then(() => {
          console.log("[loadProperty] Cleared invalid address from DB:", data.address?.slice(0, 60));
        });
      }
      setRoofYear(data.roof_year?.toString() ?? "");
      setHvacYear(data.hvac_year?.toString() ?? "");
      setInspectionSource((data.inspection_source ?? null) as "professional" | "self" | null);

      // ── Regional cost ranges ──────────────────────────────────────────────
      // Load cached regional ranges into the scoring engine override table.
      // If cache is missing or older than 90 days, fetch fresh data in background.
      const COST_STALE_DAYS = 90;
      const cachedRanges    = data.regional_cost_ranges;
      const cachedAt        = data.regional_cost_ranges_at ? new Date(data.regional_cost_ranges_at) : null;
      const isStale         = !cachedAt || (Date.now() - cachedAt.getTime()) > COST_STALE_DAYS * 24 * 60 * 60 * 1000;

      if (cachedRanges?.ranges) {
        // Apply cached ranges immediately — scoring engine uses them on next run
        registerCostOverrides(cachedRanges.ranges);
        setRegionalRanges(cachedRanges.ranges);
        setRegionalLocation(cachedRanges.location ?? null);
        console.log(`[loadProperty] Regional cost ranges loaded (${cachedRanges.location?.city ?? "unknown"}, source: cached)`);
      }

      if (isStale && data.address) {
        // Fetch fresh ranges in background — don't block property load
        const address = data.address;
        ;(async () => {
          try {
            const headers = await getAuthHeader();
            const res = await fetch("/api/cost-estimates", {
              method:  "POST",
              headers: { "Content-Type": "application/json", ...headers },
              body:    JSON.stringify({ address, propertyId: propId }),
            });
            if (res.ok) {
              const fresh = await res.json();
              if (fresh?.ranges) {
                registerCostOverrides(fresh.ranges);
                setRegionalRanges(fresh.ranges);
                setRegionalLocation(fresh.location ?? null);
                console.log(`[loadProperty] Regional cost ranges refreshed (${fresh.location?.city ?? "unknown"}, ${fresh.location?.state ?? ""})`);
              }
            } else {
              console.warn("[loadProperty] Cost estimate refresh failed:", res.status);
            }
          } catch (fetchErr) {
            // Non-fatal — static ranges remain as fallback
            console.warn("[loadProperty] Cost estimate fetch error (non-fatal):", fetchErr);
          }
        })();
      }

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
            statusesFromRows[row.normalized_finding_key] = row.status ?? "repair_needed";
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
      //
      // KEY: prefer `loadedFindings` (findings table — persistent pipeline source)
      // over `data.inspection_findings` (JSONB — may be empty for newer uploads).
      // hasAnyFindings must check both sources so the score always computes on refresh.
      const scoringFindings   = loadedFindings.length > 0 ? loadedFindings : (data.inspection_findings ?? []);
      const hasAnyFindings    = scoringFindings.length > 0 || (data.photo_findings?.length > 0);
      const hasSystemAge      = !!(data.roof_year || data.hvac_year);
      if (hasAnyFindings || data.inspection_summary || hasSystemAge) {
        try {
          const currentYear = new Date().getFullYear();
          const roofAge = data.roof_year ? currentYear - data.roof_year : null;
          const hvacAge = data.hvac_year ? currentYear - data.hvac_year : null;
          // Only critical/warning findings impact the score — info items
          // (maintenance notes, minor cosmetic observations) are shown in
          // the Repairs tab but must not penalize the Home Health Score.
          const seriousFindings = scoringFindings.filter((f: Finding) =>
            f.severity === "critical" || f.severity === "warning"
          );
          const seriousPhotoFindings = (data.photo_findings ?? []).filter((f: Finding) =>
            f.severity === "critical" || f.severity === "warning"
          );
          const inspNorm = normalizeLegacyFindings(seriousFindings, roofAge, hvacAge);
          const photoNorm = normalizeLegacyFindings(seriousPhotoFindings, null, null)
            .map(item => ({ ...item, inspector_confidence: 0.85, source_type: "photo" }));
          const { report } = runScoringPipeline({
            items:          [...inspNorm, ...photoNorm],
            propertyId:     propId,
            propertyType:   data.home_type ?? null,
            inspectionDate: data.inspection_date ?? null,
          });
          setHomeHealthReport(report);
          console.log(`[loadProperty] Score computed: ${report.home_health_score} (${seriousFindings.length} scored / ${scoringFindings.length} total findings from ${loadedFindings.length > 0 ? "findings table" : "JSONB fallback"})`);
          // Persist score metadata so confidence bar and renewal funnel survive refresh
          if (propId) {
            supabase.from("properties").update({
              score_date:       new Date().toISOString(),
              score_confidence: report.confidence_score,
            }).eq("id", propId).then(({ error }) => {
              if (error) console.warn("[loadProperty] score_metadata update failed:", error.message);
            });
          }
        } catch (scoreErr) {
          console.error("[loadProperty] scoring pipeline failed:", scoreErr);
          // non-fatal — rich breakdown falls back gracefully
        }
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

  function generateHomeReport() {
    setGeneratingReport(true);
    try {
      const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const score = homeHealthReport?.home_health_score ?? null;
      const criticals = allFindings.filter(f => f.severity === "critical" && !completedFindings.includes(f));
      const warnings  = allFindings.filter(f => f.severity === "warning"  && !completedFindings.includes(f));
      const resolved  = completedFindings;
      const fmt$ = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${Math.round(n).toLocaleString()}`;

      const severityBadge = (sev: string) => {
        if (sev === "critical") return `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">High Priority</span>`;
        if (sev === "warning")  return `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Plan Ahead</span>`;
        return `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Monitor</span>`;
      };

      const findingRows = (findings: typeof allFindings) => findings.map(f => {
        const sysKey = ({structural:"structure_foundation",foundation:"structure_foundation",structure_foundation:"structure_foundation",roof:"roof_drainage_exterior",roof_drainage_exterior:"roof_drainage_exterior",electrical:"electrical",plumbing:"plumbing",hvac:"hvac",appliances:"appliances_water_heater",appliances_water_heater:"appliances_water_heater",interior:"interior_windows_doors",safety:"safety_environmental",safety_environmental:"safety_environmental",exterior:"site_grading_drainage",site_grading_drainage:"site_grading_drainage"} as Record<string,string>)[f.category?.toLowerCase() ?? ""] ?? null;
        const repType = f.severity === "critical" ? "major_repair" : "minor_repair";
        const range = sysKey ? regionalRanges?.[sysKey]?.[repType] : null;
        const costStr = range
          ? `${fmt$(range.estimated_cost_min)}–${fmt$(range.estimated_cost_max)}${regionalLocation?.city ? ` (${regionalLocation.city} regional est.)` : ""}`
          : f.estimated_cost ? `~$${f.estimated_cost.toLocaleString()}` : "—";
        return `
          <div style="margin-bottom:18px;padding:14px 16px;border:1px solid #e2e8f0;border-left:4px solid ${f.severity==="critical"?"#dc2626":"#d97706"};border-radius:6px;background:#fff">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12;margin-bottom:6px">
              <div>
                <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8">${categoryLabel(f.category ?? "General")}</span>
                <p style="font-size:15px;font-weight:700;color:#0f172a;margin:3px 0 0">${f.title || f.issue_type || "Issue"}</p>
              </div>
              ${severityBadge(f.severity ?? "warning")}
            </div>
            ${f.description ? `<p style="font-size:13px;color:#475569;margin:6px 0;line-height:1.55">${f.description}</p>` : ""}
            <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">Estimated repair cost: <strong style="color:#0f172a">${costStr}</strong></p>
          </div>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>BTLR Home Report — ${address}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #fff; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; margin: 0 0 4px; }
  h2 { font-size: 16px; font-weight: 800; color: #0f172a; margin: 32px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.06em; }
  @media print { body { padding: 20px; } }
</style>
</head><body>

  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
    <div>
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#E8742A;margin:0 0 6px">BTLR Home Report</p>
      <h1>${address || "Home Report"}</h1>
      <p style="font-size:13px;color:#94a3b8;margin:4px 0 0">Generated ${generatedOn}</p>
    </div>
    ${score !== null ? `<div style="text-align:center;padding:16px 20px;background:#0f1f3d;border-radius:12px;color:white"><p style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin:0 0 4px">Home Health</p><p style="font-size:36px;font-weight:900;margin:0;letter-spacing:-2px">${score}</p><p style="font-size:11px;color:rgba(255,255,255,0.4);margin:2px 0 0">out of 100</p></div>` : ""}
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px">
    <div style="background:#fee2e2;border-radius:8px;padding:14px 16px"><p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#dc2626;margin:0 0 4px">High Priority</p><p style="font-size:24px;font-weight:900;color:#dc2626;margin:0">${criticals.length}</p></div>
    <div style="background:#fef3c7;border-radius:8px;padding:14px 16px"><p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#d97706;margin:0 0 4px">Plan Ahead</p><p style="font-size:24px;font-weight:900;color:#d97706;margin:0">${warnings.length}</p></div>
    <div style="background:#f0fdf4;border-radius:8px;padding:14px 16px"><p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;margin:0 0 4px">Resolved</p><p style="font-size:24px;font-weight:900;color:#16a34a;margin:0">${resolved.length}</p></div>
  </div>

  ${criticals.length > 0 ? `<h2 style="color:#dc2626">High Priority Items (${criticals.length})</h2>${findingRows(criticals)}` : ""}
  ${warnings.length  > 0 ? `<h2 style="color:#d97706">Plan Ahead — Recommended Repairs (${warnings.length})</h2>${findingRows(warnings)}` : ""}
  ${resolved.length  > 0 ? `
    <h2 style="color:#16a34a">Resolved / Completed (${resolved.length})</h2>
    ${resolved.map(f => `<div style="margin-bottom:10px;padding:10px 14px;border:1px solid #bbf7d0;border-radius:6px;background:#f0fdf4;display:flex;gap:10px;align-items:flex-start">
      <span style="color:#16a34a;font-weight:900;flex-shrink:0">✓</span>
      <div><p style="font-size:13px;font-weight:700;color:#15803d;margin:0">${f.title || f.issue_type || "Issue"}</p><p style="font-size:12px;color:#166534;margin:2px 0 0">${categoryLabel(f.category ?? "General")}</p></div>
    </div>`).join("")}
  ` : ""}

  <h2>Disclosure Notes</h2>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;font-size:13px;color:#475569;line-height:1.65">
    <p style="margin:0 0 8px">This report was generated by BTLR based on available home inspection data${inspectionResult?.inspection_date ? ` dated ${inspectionResult.inspection_date}` : ""}. Cost estimates are regional approximations${regionalLocation?.city ? ` for the ${regionalLocation.city} market` : ""} and may vary based on specific conditions, contractor availability, and scope of work.</p>
    <p style="margin:0">Items listed as "High Priority" represent findings that may affect habitability, safety, or structural integrity. Items listed as "Plan Ahead" represent deferred maintenance or recommended improvements. All estimates should be verified by licensed contractors prior to purchase or sale decisions.</p>
  </div>

  <p style="margin-top:32px;font-size:11px;color:#cbd5e1;text-align:center">Generated by BTLR — Your Home, Managed · btlr.io</p>
</body></html>`;

      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 400);
      }
    } finally {
      setGeneratingReport(false);
    }
  }

  async function saveProfileName() {
    if (!profileName.trim()) return;
    setSavingName(true); setNameSaved(false);
    try {
      await supabase.auth.updateUser({ data: { first_name: profileName.trim() } });
      // Refresh local user state so greeting updates immediately
      const { data: { user: refreshed } } = await supabase.auth.getUser();
      if (refreshed) setUser(refreshed as any);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 3000);
    } catch (err) { console.error("Name save error:", err); }
    setSavingName(false);
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
    setInspecting(true); setInspectStage("uploading"); setInspectDone(false); setInspectErr(""); setInspectionResult(null);
    setInspectIsLargeFile(file.size > 10 * 1024 * 1024); // files >10MB route to Files API — takes ~2 min
    try {
      // Refresh session first
      const { data: refreshed } = await supabase.auth.refreshSession();
      const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
      const uploadUserId = session?.user?.id;
      if (!uploadUserId) throw new Error("Session expired — please log out and back in.");

      const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${uploadUserId}/inspections-${Date.now()}-${safeName}`;
      const isPdf       = file.name.toLowerCase().endsWith(".pdf");

      // ── Extract text in browser for PDFs (eliminates server-side download) ──
      // Run storage upload in parallel so we save time on both.
      let rawText: string | null = null;
      const storageUploadPromise = supabase.storage.from("documents").upload(storagePath, file, { upsert: true });

      // Skip browser pdfjs extraction for large files — they route to the Files
      // API anyway (server-side), and pdfjs can hang for minutes on large
      // image-heavy PDFs before returning near-zero text.
      const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10MB — matches server threshold
      if (isPdf && file.size <= LARGE_FILE_BYTES) {
        try {
          setInspectStage("uploading");
          // 15-second timeout — pdfjs can hang on certain PDFs
          rawText = await Promise.race([
            extractPdfTextInBrowser(file),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("pdfjs timeout")), 15_000)
            ),
          ]);
          console.log(`[uploadInspection] Browser extracted ${rawText.length} chars from PDF`);
        } catch (extractErr) {
          const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
          console.warn(`[uploadInspection] Browser PDF extraction skipped (${msg}) — using server fallback`);
          rawText = null;
        }
      } else if (isPdf) {
        console.log(`[uploadInspection] Large PDF (${(file.size / 1024 / 1024).toFixed(1)}MB) — skipping browser extraction, routing to Files API`);
      }

      // Wait for storage upload to finish
      const { error: storageErr } = await storageUploadPromise;
      if (storageErr) throw new Error("Storage upload failed: " + storageErr.message);

      const authHeader = await getAuthHeader();
      setInspectStage("analyzing");

      // Build request body — send rawText if available, signed URL as fallback
      // forceReparse=true bypasses the DB fast-path and parse cache so a fresh
      // upload always re-runs the AI rather than returning previously saved findings.
      let fetchBody: Record<string, unknown> = { filename: file.name, storagePath, propertyId: activePropertyIdRef.current, forceReparse: true };
      if (rawText && rawText.trim().length > 80) {
        console.log(`[uploadInspection] Sending rawText (${rawText.length} chars) to API — skipping server PDF download`);
        fetchBody.rawText = rawText;
      } else {
        console.log("[uploadInspection] rawText unavailable — falling back to signedUrl path");
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
        if (!signed?.signedUrl) throw new Error("Could not get download URL");
        fetchBody.signedUrl = signed.signedUrl;
      }

      // AbortController: 320s so the browser never cancels a response that's
      // still coming in (Vercel hard limit is 300s, server has 90s download timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 320_000);
      let res: Response;
      try {
        res = await fetch("/api/parse-inspection", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader }, body: JSON.stringify(fetchBody), signal: controller.signal });
      } catch (fetchErr: unknown) {
        if ((fetchErr as Error)?.name === "AbortError") throw new Error("Analysis timed out — your PDF may be too large. Try a shorter section of the report.");
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }
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
        // the new report starts as "repair_needed" and actually affects the score.
        const freshStatuses: Record<string, FindingStatus> = {};
        setFindingStatuses(freshStatuses);

        setInspectStage("saving");
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
          // Auto-set home_type from inspection if not already set by user
          // (user's manual selection wins — only fill if null/unknown)
          ...(result.property_type && !allProperties.find(p => p.id === activePropId)?.home_type
            ? { home_type: result.property_type }
            : {}),
          // Persist address from inspection report so vendor search stays correct on reload
          // Only use if it looks like a real address — inspection jargon/section headers are rejected
          ...(isValidPropertyAddress(result.property_address) ? { address: result.property_address } : {}),
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
          // activePropId is null in React state — but a property row may already exist in DB
          // (happens when state is cleared after refresh/logout while DB row persists).
          // Always check DB first to avoid hitting the user_id unique constraint.
          const { data: existing } = await supabase
            .from("properties").select("id").eq("user_id", uploadUserId).maybeSingle();

          if (existing?.id) {
            // Row already exists — update it instead of inserting
            activePropId = existing.id;
            activePropertyIdRef.current = existing.id;
            setActivePropertyId(existing.id);
            localStorage.setItem("btlr_active_property_id", String(existing.id));
            const { error: updateErr } = await supabase
              .from("properties").update(inspectionPayload).eq("id", existing.id);
            if (updateErr) {
              console.error("[uploadInspection] update (recovered) failed:", updateErr.message, updateErr.code);
              showToast(`Inspection analyzed but could not save findings (${updateErr.message}). Try refreshing.`, "error");
            } else {
              console.log(`[uploadInspection] ✓ Recovered existing property ${existing.id}, saved ${newFindings.length} findings`);
            }
          } else {
            // Truly no property yet — insert a new row
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
        // storagePath includes Date.now() so it is always unique — use INSERT, not
        // upsert (the documents table has no UPDATE RLS policy so upsert would fail
        // silently on any conflict path).
        if (activePropId) {
          const { error: docInsertErr } = await supabase
            .from("documents")
            .insert({
              user_id:       uploadUserId,
              property_id:   activePropId,
              file_name:     file.name,
              file_path:  storagePath,
              document_type: "inspection",
            });
          if (docInsertErr) {
            console.error("[uploadInspection] documents row failed:", docInsertErr.message, docInsertErr.code);
            // Non-fatal: don't block the upload flow — user still sees results in session
          } else {
            console.log("[uploadInspection] ✓ documents row saved for inspection file");
          }
        }

        // ── Always update in-session state regardless of DB write success ───
        // This ensures the file reference appears in the Documents tab immediately
        // even if the DB write failed. On next reload, loadDocs() will re-hydrate
        // from Postgres (if the row was saved).
        {
          const { data: signedDoc } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 3600);
          setInspectionDoc({
            id:            "",
            name:          file.name,
            path:          storagePath,
            document_type: "inspection",
            url:           signedDoc?.signedUrl ?? undefined,
          });
        }

        if (result.roof_year) setRoofYear(String(result.roof_year));
        if (result.hvac_year) setHvacYear(String(result.hvac_year));
        if (isValidPropertyAddress(result.property_address)) setAddress(result.property_address);
        // Sync detected property type into allProperties so scoring uses it immediately
        if (result.property_type) {
          setAllProperties(prev => prev.map(p =>
            p.id === activePropertyIdRef.current && !p.home_type
              ? { ...p, home_type: result.property_type }
              : p
          ));
        }
        setInspectionResult(result);
        setLastInspectionFilename(file.name);
        // Recompute merged report — API's home_health_report only knows about
        // inspection findings; client-side we merge with any photo findings.
        try {
          const currentYear = new Date().getFullYear();
          const rA = result.roof_year ? currentYear - result.roof_year : null;
          const hA = result.hvac_year ? currentYear - result.hvac_year : null;
          // Score only serious findings — info items (maintenance notes, minor
          // cosmetic observations) are visible in Repairs but don't affect the score.
          const seriousNew   = newFindings.filter((f: Finding) => f.severity === "critical" || f.severity === "warning");
          const seriousPhoto = photoFindings.filter((f: Finding) => f.severity === "critical" || f.severity === "warning");
          const inspNorm = normalizeLegacyFindings(seriousNew, rA, hA);
          const photoNorm = normalizeLegacyFindings(seriousPhoto, null, null)
            .map(item => ({ ...item, inspector_confidence: 0.85, source_type: "photo" }));
          const currentHomeType = allProperties.find(p => p.id === activePropertyId)?.home_type ?? null;
          const savePropId = activePropertyIdRef.current;
          const { report: mergedReport } = runScoringPipeline({
            items:          [...inspNorm, ...photoNorm],
            propertyId:     savePropId ?? "unknown",
            propertyType:   currentHomeType,
            inspectionDate: result.inspection_date ?? null,
          });
          setHomeHealthReport(mergedReport);
          phCapture("home_health_score_calculated", {
            overall_score:    mergedReport.home_health_score,
            grade:            mergedReport.score_band,
            confidence_score: mergedReport.confidence_score,
            property_id:      savePropId,
          });
          // Persist score metadata so confidence bar and renewal funnel survive refresh
          if (savePropId) {
            supabase.from("properties").update({
              score_date:       new Date().toISOString(),
              score_confidence: mergedReport.confidence_score,
            }).eq("id", savePropId).then(({ error }) => {
              if (error) console.warn("[uploadInspection] score_metadata update failed:", error.message);
            });
          }
        } catch {
          // Fall back to API-computed report if merge fails
          if (result.home_health_report) setHomeHealthReport(result.home_health_report);
        }
        if (result._debug) setParseDebug(result._debug);
        const findingCount = newFindings.length;
        phCapture("inspection_report_uploaded", {
          finding_count:     findingCount,
          inspection_type:   result.inspection_type ?? "Home Inspection",
          total_cost_estimate: result.total_estimated_cost ?? null,
          property_id:       activePropertyIdRef.current,
        });
        addEvent(`${result.inspection_type ?? "Inspection"} analyzed: ${findingCount} finding${findingCount !== 1 ? "s" : ""} detected`);
        setInspectDone(true);
        // Show post-inspection review modal — only scored findings that are critical or warning.
        // Info-level items (noisy fan, sticky door, minor cosmetic issues) stay in the Repairs tab
        // but are too minor to surface in the initial popup.
        // All findings remain visible in the Repairs tab regardless.
        if (newFindings.length > 0) {
          // Deduplicate before showing the review modal — triple-pass removes
          // exact matches, same-category duplicates, and near-identical rephrases.
          const dedupedFindings = deduplicateFindings(newFindings);
          const scoredOnly = dedupedFindings.filter(f =>
            isScoredFinding(f.category, f.description) &&
            (f.severity === "critical" || f.severity === "warning")
          );
          // Fall back to all scored findings if nothing meets the severity threshold,
          // then fall back to all findings so the modal is never empty.
          const fallback = dedupedFindings.filter(f => isScoredFinding(f.category, f.description));
          setReviewFindings(scoredOnly.length > 0 ? scoredOnly : fallback.length > 0 ? fallback : dedupedFindings);
          setShowReviewModal(true);
        } else {
          // No findings — tell the user so they know something may be wrong
          setInspectErr("No findings extracted from this document. Try a different PDF or check that it's a readable inspection report.");
        }
      }
    } catch (err: unknown) { setInspectErr(err instanceof Error ? err.message : "Upload failed"); }
    setInspecting(false);
    setInspectStage("");
    if (inspRef.current) inspRef.current.value = "";
    // Re-sync Documents tab from DB so the new inspection row is visible immediately
    loadDocs();
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
      const propId = activePropertyIdRef.current;

      // ── 1. General docs ("other") ──────────────────────────────────────────
      let otherQuery = supabase
        .from("documents")
        .select("id, file_name, file_path, document_type, created_at")
        .eq("user_id", uid)
        .eq("document_type", "other")
        .order("created_at", { ascending: false })
        .limit(200);
      if (propId) otherQuery = otherQuery.eq("property_id", propId);
      const { data: otherData, error: otherErr } = await otherQuery;

      if (otherErr) {
        // Always silent — this runs on every mount including first-ever login
        // (table may be empty or not yet created). Never show error toast here.
        console.warn("[loadDocs] documents query error:", otherErr.code, otherErr.message);
      } else if (otherData) {
        const files: Doc[] = await Promise.all(
          otherData.map(async (row) => {
            const { data: signed } = await supabase.storage
              .from("documents")
              .createSignedUrl(row.file_path, 3600);
            return {
              id:            row.id,
              name:          row.file_name,
              path:          row.file_path,
              document_type: row.document_type,
              url:           signed?.signedUrl ?? undefined,
            };
          })
        );
        setDocs(files);
      }

      // ── 2. Insurance doc count badge ───────────────────────────────────────
      let insCountQuery = supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("document_type", "insurance");
      if (propId) insCountQuery = insCountQuery.eq("property_id", propId);
      const { count: insCount } = await insCountQuery;
      if (insCount && insCount > 0) setInsuranceDocCount(insCount);

      // ── 3. Inspection file reference ──────────────────────────────────────
      // Restores the "View original PDF" link after logout/login without relying
      // on any React state. The inspection FINDINGS are loaded separately via
      // loadProperty() → findings table + properties.inspection_findings JSONB.
      let inspQuery = supabase
        .from("documents")
        .select("id, file_name, file_path, document_type, created_at")
        .eq("user_id", uid)
        .eq("document_type", "inspection")
        .order("created_at", { ascending: false })
        .limit(1);
      if (propId) inspQuery = inspQuery.eq("property_id", propId);
      const { data: inspData, error: inspErr } = await inspQuery;

      if (inspErr) {
        console.warn("[loadDocs] inspection doc query error:", inspErr.code, inspErr.message);
      } else if (inspData?.length) {
        const row = inspData[0];
        const { data: signed } = await supabase.storage
          .from("documents")
          .createSignedUrl(row.file_path, 3600);
        setInspectionDoc({
          id:            row.id,
          name:          row.file_name,
          path:          row.file_path,
          document_type: "inspection",
          url:           signed?.signedUrl ?? undefined,
        });
        console.log("[loadDocs] ✓ Restored inspection file reference:", row.file_name);
      }

      // ── 4. Warranty PDF URL ────────────────────────────────────────────────
      // Primary path: documents table row (created by all uploads going forward).
      // Fallback: scan storage bucket for files uploaded before the documents row
      // was required — so users never have to re-upload an existing file.
      let warrQuery = supabase
        .from("documents")
        .select("file_path")
        .eq("user_id", uid)
        .eq("document_type", "warranty")
        .order("created_at", { ascending: false })
        .limit(1);
      if (propId) warrQuery = warrQuery.eq("property_id", propId);
      const { data: warrData } = await warrQuery;

      if (warrData?.length) {
        const { data: signedWarr } = await supabase.storage.from("documents").createSignedUrl(warrData[0].file_path, 3600);
        if (signedWarr?.signedUrl) setWarrantyDocUrl(signedWarr.signedUrl);
      } else {
        // Fallback: list storage files for this user and find warranty uploads
        const { data: storageFiles } = await supabase.storage.from("documents").list(uid, {
          limit: 100, sortBy: { column: "name", order: "desc" },
        });
        const warrFile = storageFiles?.find(f => f.name.startsWith("warranty-"));
        if (warrFile) {
          const path = `${uid}/${warrFile.name}`;
          const { data: sw } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
          if (sw?.signedUrl) setWarrantyDocUrl(sw.signedUrl);
        }
      }

      // ── 5. Insurance PDF URLs ──────────────────────────────────────────────
      let insDocQuery = supabase
        .from("documents")
        .select("file_path, file_name")
        .eq("user_id", uid)
        .eq("document_type", "insurance")
        .order("created_at", { ascending: false })
        .limit(5);
      if (propId) insDocQuery = insDocQuery.eq("property_id", propId);
      const { data: insData } = await insDocQuery;

      if (insData?.length) {
        const urls: string[] = [];
        for (const row of insData) {
          const { data: s } = await supabase.storage.from("documents").createSignedUrl(row.file_path, 3600);
          if (s?.signedUrl) urls.push(s.signedUrl);
        }
        if (urls.length) setInsuranceDocUrls(urls);
      } else {
        // Fallback: list storage files and find insurance uploads
        const { data: storageFiles } = await supabase.storage.from("documents").list(uid, {
          limit: 100, sortBy: { column: "name", order: "desc" },
        });
        const insFiles = storageFiles?.filter(f =>
          f.name.startsWith("insurance-") || f.name.startsWith("insurance-add-")
        ) ?? [];
        if (insFiles.length) {
          const urls: string[] = [];
          for (const f of insFiles.slice(0, 5)) {
            const { data: s } = await supabase.storage.from("documents").createSignedUrl(`${uid}/${f.name}`, 3600);
            if (s?.signedUrl) urls.push(s.signedUrl);
          }
          if (urls.length) setInsuranceDocUrls(urls);
        }
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
      file_path:  fullPath,
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
    // Remove from Postgres documents table — use primary key + user_id for RLS
    const { data: { user: cu } } = await supabase.auth.getUser();
    const { error: dbErr } = await supabase.from("documents").delete()
      .eq("id", doc.id)
      .eq("user_id", cu?.id ?? "");
    if (dbErr) {
      console.error("[deleteDoc] db delete error:", dbErr.message);
      showToast("Delete failed — please try again", "error");
      return;
    }
    setDocs(prev => prev.filter(d => d.path !== doc.path));
    showToast(`Deleted ${doc.name}`, "success");
  }

  async function deleteInspectionDoc() {
    if (!inspectionDoc) return;
    // Show the custom confirmation modal — don't use browser confirm()
    setConfirmDeleteInspection(true);
  }

  async function confirmAndDeleteInspectionDoc() {
    if (!inspectionDoc) return;
    setConfirmDeleteInspection(false);
    // Remove from Storage
    const { error: storageErr } = await supabase.storage.from("documents").remove([inspectionDoc.path]);
    if (storageErr) console.warn("[deleteInspectionDoc] storage delete error:", storageErr.message);
    // Remove from Postgres — by id if available, otherwise by file_path
    if (inspectionDoc.id) {
      await supabase.from("documents").delete().eq("id", inspectionDoc.id);
    } else {
      await supabase.from("documents").delete().eq("file_path", inspectionDoc.path);
    }
    setInspectionDoc(null);
    // Also clear last-seen filename so the duplicate guard doesn't block re-upload
    setLastInspectionFilename(null);
    showToast("Inspection report removed — upload a new one to re-analyze", "success");
  }

  // Clear inspection analysis data without a file record (inspectDone=true but no file saved)
  async function clearInspectionAnalysis() {
    if (!confirm("Clear this inspection analysis? Your Home Health Score will be reset. You can re-upload at any time.")) return;
    const propId = activePropertyIdRef.current;
    if (propId) {
      await supabase.from("properties").update({
        inspection_findings: [],
        inspection_summary: null,
        inspection_type: null,
        inspection_date: null,
        total_estimated_cost: null,
      }).eq("id", propId);
      await supabase.from("findings").delete().eq("property_id", propId);
    }
    setInspectDone(false);
    setInspectionResult(null);
    setHomeHealthReport(null);
    setLastInspectionFilename(null);
    showToast("Inspection cleared — upload a new report to re-analyze", "success");
  }

  // ── Load repair history from DB on mount ────────────────────────────────
  async function loadRepairDocs() {
    try {
      const propId = activePropertyIdRef.current;
      let repairQuery = supabase
        .from("repair_documents")
        .select("id, vendor_name, service_date, repair_summary, system_category, cost, resolved_finding_keys, storage_path, filename")
        .order("created_at", { ascending: false })
        .limit(50);
      if (propId) repairQuery = repairQuery.eq("property_id", propId);
      const { data, error } = await repairQuery;
      if (error || !data) return;
      const mapped = await Promise.all(data.map(async r => {
        let fileUrl: string | undefined;
        if (r.storage_path) {
          const { data: su } = await supabase.storage.from("documents").createSignedUrl(r.storage_path, 3600);
          fileUrl = su?.signedUrl ?? undefined;
        }
        return {
          id:           r.id              ?? undefined,
          vendor:       r.vendor_name     ?? undefined,
          date:         r.service_date    ?? undefined,
          summary:      r.repair_summary  ?? undefined,
          category:     r.system_category ?? undefined,
          cost:         r.cost            ?? undefined,
          autoResolved: Array.isArray(r.resolved_finding_keys) ? r.resolved_finding_keys : [],
          storagePath:  r.storage_path    ?? undefined,
          fileUrl,
          filename:     r.filename        ?? undefined,
        };
      }));
      setRepairDocs(mapped);
    } catch { /* silent */ }
  }

  // ── Delete a repair document record and its storage file ────────────────
  async function deleteRepairDoc(doc: { id?: string; storagePath?: string; filename?: string }) {
    if (!confirm(`Remove "${doc.filename ?? "this repair document"}"?`)) return;
    if (doc.id) {
      await supabase.from("repair_documents").delete().eq("id", doc.id);
    }
    if (doc.storagePath) {
      await supabase.storage.from("documents").remove([doc.storagePath]);
    }
    setRepairDocs(prev => prev.filter(r => r.id !== doc.id));
    showToast("Repair document removed", "success");
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
          propertyId: activePropertyIdRef.current,
          // Include photo findings so the repair matcher can resolve photo-detected issues too
          existingFindings: [...(inspectionResult?.findings ?? []), ...photoFindings],
        }),
      });
      const result = await res.json();
      if (!result.success) {
        alert(result.error || "Could not parse repair document — please try again.");
        return;
      }
      // Patch DB row with storage_path so PDF is viewable on reload
      if (result.repair_doc_id) {
        await supabase.from("repair_documents")
          .update({ storage_path: storagePath })
          .eq("id", result.repair_doc_id);
      }
      // Record the repair doc in local state (include fileUrl so PDF link works immediately)
      setRepairDocs(prev => [{
        id:          result.repair_doc_id ?? undefined,
        vendor:      result.vendor_name,
        date:        result.service_date,
        summary:     result.repair_summary,
        category:    result.system_category,
        cost:        result.cost,
        autoResolved: result.auto_resolved,
        storagePath: storagePath,
        fileUrl:     signed.signedUrl,
        filename:    file.name,
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
      // Use same deduplicated array as the score engine so index-based keys match.
      const allFindings = deduplicateFindings([...(inspectionResult?.findings ?? []), ...photoFindings]);
      const rowUpdates: PromiseLike<unknown>[] = [];
      allFindings.forEach((f, idx) => {
        const key = findingKey(f, idx);
        const newStatus = statuses[key];
        if (f.normalized_finding_key && newStatus) {
          const validStatus = ["repair_needed","completed","not_needed","monitored"].includes(newStatus) ? newStatus : "repair_needed";
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
  // ── Recompute Home Health score after any finding-status change ─────────────
  // Called whenever the user marks a repair completed / not-needed or saves a
  // review. Filters out resolved findings so the score reflects the new state
  // immediately — no page reload required.
  function recomputeScore(newStatuses: Record<string, FindingStatus>) {
    try {
      const inspFindings: Finding[] = inspectionResult?.findings ?? [];
      const currentYear = new Date().getFullYear();
      const roofAge = roofYear ? currentYear - parseInt(roofYear) : null;
      const hvacAge = hvacYear ? currentYear - parseInt(hvacYear) : null;

      // Keep only findings that are still active (repair_needed / monitor)
      // AND only critical/warning severity — info-level items (sticky door,
      // missing vent cap, minor vegetation, cosmetic notes) are visible in
      // the Repairs tab but never penalize the Home Health Score.
      const inspActive = inspFindings.filter((f, i) => {
        const s = newStatuses[findingKey(f, i)] ?? "repair_needed";
        return s !== "completed" && s !== "not_needed" &&
               (f.severity === "critical" || f.severity === "warning");
      });
      const photoActive = photoFindings.filter((f, i) => {
        // Photo findings are indexed after inspection findings
        const baseIdx = inspFindings.length + i;
        const s = newStatuses[findingKey(f, baseIdx)] ?? "repair_needed";
        return s !== "completed" && s !== "not_needed" &&
               (f.severity === "critical" || f.severity === "warning");
      });

      const inspNorm  = normalizeLegacyFindings(inspActive, roofAge, hvacAge);
      const photoNorm = normalizeLegacyFindings(photoActive, null, null)
        .map(item => ({ ...item, inspector_confidence: 0.85, source_type: "photo" }));

      const propType = allProperties.find(p => p.id === activePropertyId)?.home_type ?? null;
      const { report } = runScoringPipeline({
        items:          [...inspNorm, ...photoNorm],
        propertyId:     String(activePropertyIdRef.current ?? "unknown"),
        propertyType:   propType,
        inspectionDate: inspectionResult?.inspection_date ?? null,
      });
      setHomeHealthReport(report);
      console.log(
        `[recomputeScore] ${report.home_health_score} — active: ${inspActive.length + photoActive.length}/${inspFindings.length + photoFindings.length} findings`
      );
    } catch (err) {
      console.error("[recomputeScore] failed (non-fatal):", err);
    }
  }

  async function markCategoryComplete(costItem: CostItem, receiptFile?: File) {
    setMarkCompleteUploading(true);
    try {
      // IMPORTANT: must use the same deduplicated array as the score engine (line 5308)
      // so findingKey(f, idx) generates identical keys in both places.
      const allFindings: Finding[] = deduplicateFindings([
        ...(inspectionResult?.findings ?? []),
        ...photoFindings,
      ]);

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
      recomputeScore(updated);

      // Optionally upload the receipt to storage
      if (receiptFile) {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        const propId = activePropertyIdRef.current;
        if (uid) {
          const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const ts = Date.now();
          const storagePath = `${uid}/repair-receipt-${ts}-${safeName}`;
          await supabase.storage.from("documents").upload(storagePath, receiptFile, { upsert: true });

          // Save to documents table so it appears in the Documents tab
          await supabase.from("documents").insert({
            user_id:       uid,
            ...(propId ? { property_id: propId } : {}),
            file_name:     receiptFile.name,
            file_path:     storagePath,
            document_type: "other",
          });

          // Parse the receipt via the repair API
          try {
            const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
            if (signed?.signedUrl) {
              const authHeader: Record<string, string> = session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {};
              const parseRes = await fetch("/api/parse-repair", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({ signedUrl: signed.signedUrl, filename: receiptFile.name, storagePath }),
              });
              const parseData = await parseRes.json();
              // Patch storage_path onto the repair_documents row so View PDF works
              if (parseData.repair_doc_id) {
                await supabase.from("repair_documents")
                  .update({ storage_path: storagePath })
                  .eq("id", parseData.repair_doc_id);
              }
            }
          } catch { /* receipt stored even if parse fails */ }

          // Refresh docs so the receipt appears immediately
          loadDocs();
          loadRepairDocs();
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
    recomputeScore(statuses);
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
    recomputeScore(newStatuses);
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
      recomputeScore(newStatuses);

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
      // Only claim "score updated" when the deductions weren't already capped.
      // The cap means very troubled homes need several repairs before the number
      // moves — honest feedback prevents user confusion.
      const rawDed  = breakdown.deductions.reduce((s, d) => s + d.points, 0);
      const atCap   = rawDed <= -45;
      const scoreMsg = wasScoreable
        ? (atCap ? " — logged. Keep going to see score rise!" : " — score updated")
        : "";
      addEvent(`Repair completed: ${categoryLabel(finding.category)}${data.receiptFile ? " (receipt uploaded)" : ""}`);
      showToast(`✓ ${categoryLabel(finding.category)} marked complete${scoreMsg}`, "success");

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
    const entry: TimelineEvent = {
      date:  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      event,
    };
    setTimeline(prev => {
      const next = [entry, ...prev].slice(0, 50); // cap at 50 events
      // Persist to localStorage keyed by userId + propertyId
      try {
        const uid  = activePropertyIdRef.current ?? "unknown";
        localStorage.setItem(`btlr_timeline_${uid}`, JSON.stringify(next));
      } catch { /* non-fatal */ }
      return next;
    });
  }

  function loadTimelineFromStorage(propertyId: number | null) {
    try {
      const raw = localStorage.getItem(`btlr_timeline_${propertyId ?? "unknown"}`);
      if (raw) {
        const parsed = JSON.parse(raw) as TimelineEvent[];
        if (Array.isArray(parsed)) setTimeline(parsed);
      }
    } catch { /* non-fatal */ }
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

  // Only count ACTIVE findings (repair_needed or monitored) in costs list
  // Completed/not_needed findings reflect resolved items
  // Merge inspection + photo findings, then deduplicate so the Repairs tab
  // never shows the same issue twice (parser sometimes extracts duplicates).
  const allFindings       = deduplicateFindings([...(inspectionResult?.findings ?? []), ...photoFindings]);
  const activeFindings    = allFindings.filter((f, i) =>  isActiveFinding(f, i, findingStatuses));
  const completedFindings = allFindings.filter((f, i) => !isActiveFinding(f, i, findingStatuses));

  // Merge inspection + photo findings for scoring.
  // Photo findings tagged with source:"photo" are visually-derived — same
  // weight as inspection findings in the deterministic score.
  // allFindings already deduped above — reuse it so scoring uses the same clean set
  const allFindingsForScore = allFindings;

  // Deterministic score — pure function, same inputs = same score every time
  const breakdown    = computeHealthScore(allFindingsForScore, findingStatuses, roofYear, hvacYear, year);

  // Extended Condition (Tier 2) — ±8 modifier from supplemental items.
  // No Tier 2 data → modifier = 0, no label shown. Absence is never penalized.
  // Uses ACTIVE findings only so that resolving deck/garage/fireplace issues
  // actually improves the modifier — previously used allFindingsForScore which
  // included completed items and froze the modifier regardless of repairs.
  const extCondition: ExtendedConditionResult = isEnabled("enableExtendedCondition")
    ? computeExtendedCondition(activeFindings)
    : { label: null, modifier: 0, itemCount: 0, items: [] };

  const health       = Math.max(0, Math.min(100, breakdown.score + extCondition.modifier));
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
      horizon:       f.severity === "critical" ? "Start Soon" : f.severity === "warning" ? "Within 1–2 yrs" : "Ongoing",
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
  const roofResolved = findingStatuses[roofKey] === "completed" || findingStatuses[roofKey] === "not_needed";
  const hvacResolved = findingStatuses[hvacKey] === "completed" || findingStatuses[hvacKey] === "not_needed";
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
    { label: "Vendors",      icon: <Users size={15}/> },
    { label: "Maintenance",  icon: <Wrench size={15}/> },
    { label: "Repairs",      icon: <TrendingDown size={15}/>, badge: costs.filter(c => c.severity === "critical").length || undefined },
    { label: "My Jobs",      icon: <Briefcase size={15}/> },
    { label: "Documents",    icon: <FileText size={15}/> },
    { label: "Settings",     icon: <Settings size={15}/> },
  ];

  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", background: C.bg, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <style>{`

        /* ── Scrollbar ─────────────────────────────────────── */
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(28,25,20,0.14); border-radius: 99px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(28,25,20,0.24); }

        /* ── Input / select focus ──────────────────────────── */
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: #E8742A !important;
          box-shadow: 0 0 0 3px rgba(232,116,42,0.12) !important;
        }

        /* ── Button transitions ────────────────────────────── */
        button { transition: opacity 0.13s, background 0.13s, box-shadow 0.13s, transform 0.1s; }
        button:active:not(:disabled) { transform: scale(0.97); }
        button:disabled { opacity: 0.52; cursor: not-allowed; }

        /* ── Input / textarea placeholder ──────────────────── */
        ::placeholder { color: rgba(99,99,88,0.42); }

        /* ── Select appearance ─────────────────────────────── */
        select { -webkit-appearance: none; appearance: none; }

        /* ── Toast entrance ────────────────────────────────── */
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        /* ── Dropdown / modal entrance ─────────────────────── */
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Link-style reset for anchor buttons ───────────── */
        a { text-decoration: none; }
        a:hover { opacity: 0.85; }
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
      {showSelfInspectModal && (
        <SelfInspectionModal
          answers={selfInspectAnswers}
          step={selfInspectStep}
          saving={savingSelfInspect}
          onAnswer={(questionId, value) => setSelfInspectAnswers(prev => ({ ...prev, [questionId]: value }))}
          onNext={() => setSelfInspectStep(s => Math.min(s + 1, SELF_INSPECT_STEPS.length - 1))}
          onBack={() => setSelfInspectStep(s => Math.max(s - 1, 0))}
          onClose={() => setShowSelfInspectModal(false)}
          onSave={() => saveSelfInspection(selfInspectAnswers)}
        />
      )}
      {systemAssessStepKey && (
        <SystemAssessModal
          stepKey={systemAssessStepKey}
          answers={systemAssessAnswers}
          saving={savingSystemAssess}
          onAnswer={(questionId, value) => setSystemAssessAnswers(prev => ({ ...prev, [questionId]: value }))}
          onClose={() => { setSystemAssessStepKey(null); setSystemAssessAnswers({}); }}
          onSave={() => saveSystemAssessment(systemAssessStepKey, systemAssessAnswers)}
        />
      )}
      {showHealthModal && (
        <HealthScoreModal
          breakdown={breakdown}
          roofYear={roofYear} hvacYear={hvacYear} year={year}
          homeHealthReport={homeHealthReport}
          extCondition={extCondition}
          onClose={() => setShowHealthModal(false)}
          onFindVendors={handleFindVendors}
          onStartSystemAssess={(stepKey) => { setShowHealthModal(false); setSystemAssessStepKey(stepKey); setSystemAssessAnswers({}); }}
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

      {/* ── Customize Modal ─────────────────────────────────────────── */}
      {showCustomize && (() => {
        const THEMES = [
          { name: "Ember",    navy: "#1C2B3A", accent: "#E8742A", bg: "#FFF7F0", isDefault: true },
          { name: "Ocean",    navy: "#0F3460", accent: "#2563EB", bg: "#EFF6FF" },
          { name: "Forest",   navy: "#1A3C34", accent: "#16A34A", bg: "#F0FDF4" },
          { name: "Midnight", navy: "#0A0A18", accent: "#06B6D4", bg: "#0A0A18" },
          { name: "Rose",     navy: "#3D1A3D", accent: "#E11D48", bg: "#FFF1F2" },
          { name: "Walnut",   navy: "#3D2B1F", accent: "#D97706", bg: "#FFFBEB" },
          { name: "Violet",   navy: "#2D1B69", accent: "#7C3AED", bg: "#F5F3FF" },
          { name: "Slate",    navy: "#1E293B", accent: "#38BDF8", bg: "#F0F9FF" },
        ];
        const BG_PRESETS = [
          { name: "None",         url: "" },
          { name: "Warm Kitchen", url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80" },
          { name: "Living Room",  url: "https://images.unsplash.com/photo-1600210492493-0946911123ea?w=1200&q=80" },
          { name: "Modern Home",  url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80" },
          { name: "Backyard",     url: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80" },
          { name: "Front Porch",  url: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1200&q=80" },
          { name: "Cozy Den",     url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80" },
          { name: "Open Kitchen", url: "https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=1200&q=80" },
          { name: "Master Suite", url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80" },
          { name: "Night Exterior",url:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80" },
          { name: "Garden Path",  url: "https://images.unsplash.com/photo-1585320806297-9794b3e4aaae?w=1200&q=80" },
          { name: "Sunset View",  url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80" },
        ];
        const selTheme = THEMES.find(t => t.navy === draftNavy && t.accent === draftAccent);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) setShowCustomize(false); }}>
            <div style={{ background: "white", borderRadius: 24, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 18px", borderBottom: "1px solid #f1f5f9", position: "sticky", top: 0, background: "white", zIndex: 1, borderRadius: "24px 24px 0 0" }}>
                <p style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.3px" }}>Customize Dashboard</p>
                <button onClick={() => setShowCustomize(false)}
                  style={{ width: 32, height: 32, borderRadius: "50%", background: "#f1f5f9", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}>
                  <X size={15}/>
                </button>
              </div>

              <div style={{ padding: "20px 24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Color Themes */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px" }}>Color Theme</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {THEMES.map(t => {
                      const isSel = selTheme?.name === t.name;
                      return (
                        <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <button onClick={() => { setDraftNavy(t.navy); setDraftAccent(t.accent); }}
                            style={{ display: "flex", alignItems: "stretch", borderRadius: 14, border: `2px solid ${isSel ? t.accent : "#e2e8f0"}`, background: "white", cursor: "pointer", overflow: "hidden", padding: 0, transition: "border-color 0.15s", textAlign: "left", width: "100%" }}>
                            <div style={{ width: 56, background: t.navy, flexShrink: 0, minHeight: 64 }}/>
                            <div style={{ flex: 1, padding: "12px 14px", background: t.bg }}>
                              <div style={{ height: 4, borderRadius: 2, background: t.accent, width: "60%", marginBottom: 7 }}/>
                              <div style={{ height: 3, borderRadius: 2, background: "#94a3b8", width: "85%", marginBottom: 5 }}/>
                              <div style={{ height: 3, borderRadius: 2, background: "#cbd5e1", width: "70%" }}/>
                            </div>
                          </button>
                          <p style={{ fontSize: 12, fontWeight: 600, color: C.text, margin: "0 2px", display: "flex", alignItems: "center", gap: 5 }}>
                            {t.name}
                            {t.isDefault && <span style={{ fontSize: 10, background: "#f1f5f9", color: C.text3, borderRadius: 4, padding: "1px 6px" }}>Default</span>}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Background Image */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px" }}>Greeting Background</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                    {BG_PRESETS.map(p => {
                      const isSel = draftBgImg === p.url;
                      return (
                        <button key={p.name} onClick={() => setDraftBgImg(p.url)}
                          style={{ position: "relative", height: 80, borderRadius: 10, border: `2.5px solid ${isSel ? draftAccent : "#e2e8f0"}`, cursor: "pointer", overflow: "hidden", background: p.url ? `url(${p.url}) center/cover` : "#f8fafc", padding: 0, transition: "border-color 0.15s" }}>
                          {p.url && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}/>}
                          <span style={{ position: "absolute", bottom: 5, left: 0, right: 0, textAlign: "center", fontSize: 11, fontWeight: 700, color: p.url ? "white" : C.text3, textShadow: p.url ? "0 1px 3px rgba(0,0,0,0.6)" : "none" }}>{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: C.text3, margin: "0 0 8px" }}>Or paste your own image URL</p>
                  <input type="url" value={draftBgImg} onChange={e => setDraftBgImg(e.target.value)}
                    placeholder="https://..."
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, color: C.text, outline: "none", boxSizing: "border-box" }}/>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={resetTheme}
                    style={{ flex: 0, padding: "11px 18px", borderRadius: 12, border: "1.5px solid #e2e8f0", background: "white", color: C.text3, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    Reset
                  </button>
                  <button onClick={saveCustomize}
                    style={{ flex: 1, padding: "11px", borderRadius: 12, border: "none", background: draftNavy, color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                    Apply Theme
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside style={{ width: 216, flexShrink: 0, display: isMobile ? "none" : "flex", flexDirection: "column", background: themeNavy, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${themeAccent}, ${C.accentDk})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 8px ${themeAccent}80` }}>
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

        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
          {navItems.map(({ label, icon, badge }) => (
            <button key={label} onClick={() => {
              setNav(label);
              // Direct sidebar click to Vendors = generic browse (clears CTA prefill)
              if (label === "Vendors") { setVendorPrefill(null); setVendorContext(null); setVendorIssue(null); }
            }} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 12px", borderRadius: 9, fontSize: 13,
              border: "none", cursor: "pointer", textAlign: "left", width: "100%",
              background: nav === label ? "rgba(255,255,255,0.12)" : "transparent",
              color: nav === label ? "white" : "rgba(255,255,255,0.48)",
              fontWeight: nav === label ? 600 : 400,
              boxShadow: nav === label ? "inset 3px 0 0 rgba(255,255,255,0.55)" : "inset 3px 0 0 transparent",
              transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={e => { if (nav !== label) { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.75)"; } }}
            onMouseLeave={e => { if (nav !== label) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.48)"; } }}
            >
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
          <button onClick={() => setShowTutorial(true)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 6 }}>
            <span style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.4)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, lineHeight: 1 }}>?</span> How it works
          </button>
          <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
            <LogOut size={13}/> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? "16px 14px 110px" : "24px 24px 40px", display: "flex", flexDirection: "column", gap: isMobile ? 14 : 18, minWidth: 0 }}>

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
          <div style={{ paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
            <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, color: C.text, letterSpacing: "-0.4px", margin: 0, lineHeight: 1.2 }}>
              {nav === "Vendors" ? "Vendors"
               : nav === "My Jobs" ? "My Jobs"
               : nav === "Maintenance" ? "Maintenance"
               : nav === "Repairs" ? "Repairs"
               : nav === "Documents" ? "Documents"
               : nav === "Settings" ? "Settings"
               : address && address !== "My Home" ? toTitleCase(address).split(",")[0] : "Dashboard"}
            </h1>
            <p style={{ color: C.text3, fontSize: 13, marginTop: 4, marginBottom: 0, lineHeight: 1.4 }}>
              {nav === "Vendors" ? "Connect with vetted contractors for your property"
               : nav === "My Jobs" ? "Track all your contractor requests in real time"
               : nav === "Maintenance" ? "Proactive maintenance forecast and seasonal checklists"
               : nav === "Repairs" ? "Active findings, repair status, and cost estimates"
               : nav === "Documents" ? "Inspection reports, warranties, and insurance"
               : nav === "Settings" ? "Account and property configuration"
               : "Home Health Score and AI-powered insights"}
            </p>
          </div>

          {/* ── Vendors ───────────────────────────────────────────────── */}
          {nav === "Vendors" && (
            <VendorsView
              key={activePropertyId ?? "no-prop"}
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
              const fk = findingKey(f, gi);
              const status = findingStatuses[fk] ?? "repair_needed";
              // Completed / not-needed items belong in the archives, not the active list
              if (status === "completed" || status === "not_needed") continue;
              const gk = toGroupKey(f.category);
              const meta = GROUP_META[gk] ?? GROUP_META.general;
              if (!repGroupMap.has(gk)) repGroupMap.set(gk, { label: meta.label, items: [] });
              repGroupMap.get(gk)!.items.push({ f, globalIdx: gi });
            }
            const repGroups = [...repGroupMap.entries()].map(([gk, v]) => ({ gk, ...v }));
            const repStatusConfig: Record<FindingStatus, { label: string; color: string; bg: string }> = {
              repair_needed: { label: "Repair Needed", color: C.red,    bg: C.redBg   },
              completed:     { label: "Completed",     color: C.green,  bg: C.greenBg },
              monitored:     { label: "Monitoring",    color: C.accent, bg: "#eff6ff" },
              not_needed:    { label: "Not Needed",    color: C.text3,  bg: C.bg      },
            };
            const repArchivedItems: Array<{ f: Finding; globalIdx: number; fk: string }> = [];
            allFindings.forEach((f, i) => {
              const fk = findingKey(f, i);
              const s = findingStatuses[fk] ?? "repair_needed";
              if (s === "completed" || s === "not_needed") repArchivedItems.push({ f, globalIdx: i, fk });
            });
            // ── 5-year cost outlook for hero card ──────────────────────────────
            const repPredictions = homeHealthReport?.predictions ?? [];
            const repUrgentPreds = repPredictions.filter(p => ["critical","high"].includes(p.urgency) && !p.not_assessed);
            const repMedPreds    = repPredictions.filter(p => p.urgency === "medium" && !p.not_assessed);
            const repLongPreds   = repPredictions.filter(p => ["low","monitor"].includes(p.urgency) && !p.not_assessed);
            const repAvg   = (p: (typeof repPredictions)[0]) => (p.cost_range.estimated_cost_min + p.cost_range.estimated_cost_max) / 2;
            const repUrgentTotal = repUrgentPreds.reduce((s, p) => s + repAvg(p), 0);
            const repMedTotal    = repMedPreds.reduce((s, p) => s + repAvg(p), 0);
            const repLongTotal   = repLongPreds.reduce((s, p) => s + repAvg(p), 0);
            const repFiveYrTotal = repUrgentTotal + repMedTotal + repLongTotal + (maintenanceBaseline * 5);
            const repFmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${Math.round(n).toLocaleString()}`;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── 5-YEAR COST OUTLOOK HERO ────────────────────────── */}
                <div style={{
                  background: "linear-gradient(135deg, #134e4a 0%, #0f766e 60%, #0d9488 100%)",
                  borderRadius: 18, padding: isMobile ? "18px 18px" : "22px 28px",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: 0, right: 0, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.04)", transform: "translate(40px,-40px)", pointerEvents: "none" }}/>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Home Savings Plan</p>
                  {repPredictions.length > 0 ? (
                    <>
                      {/* ── Headline: monthly set-aside ── */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 34, fontWeight: 800, color: "white", letterSpacing: "-1px" }}>{repFmt(Math.ceil(repFiveYrTotal / 60))}<span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0 }}>/mo</span></span>
                        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>recommended set-aside</span>
                      </div>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 14px", lineHeight: 1.5 }}>
                        Save a little each month and you&apos;ll be ready when it&apos;s time — no surprises, no scrambling.
                      </p>

                      {/* ── Near-term priority ── */}
                      {repUrgentTotal > 0 && (
                        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
                          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Priority repairs if addressed</p>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
                            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "white", letterSpacing: "-0.5px" }}>
                              {repFmt(repUrgentPreds.reduce((s,p) => s + p.cost_range.estimated_cost_min, 0))}–{repFmt(repUrgentPreds.reduce((s,p) => s + p.cost_range.estimated_cost_max, 0))}
                            </p>
                            {regionalLocation?.city && (
                              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>est. for {regionalLocation.city}</span>
                            )}
                          </div>
                          <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>
                            Spread over time — not all due immediately.
                          </p>
                        </div>
                      )}

                      {/* ── "See full plan" toggle ── */}
                      <button
                        onClick={() => setShowFullCostPlan(p => !p)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: showFullCostPlan ? 10 : 0 }}
                      >
                        {showFullCostPlan ? "Hide" : "See full plan"} <ChevronRight size={13} style={{ transform: showFullCostPlan ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}/>
                      </button>

                      {/* ── Full breakdown (collapsed by default) ── */}
                      {showFullCostPlan && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {repUrgentTotal > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
                              {repFmt(repUrgentTotal)} urgent / this year
                            </span>
                          )}
                          {repMedTotal > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: "rgba(245,158,11,0.2)", color: "#fcd34d", border: "1px solid rgba(245,158,11,0.3)" }}>
                              {repFmt(repMedTotal)} in 1–3 years
                            </span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.15)" }}>
                            {repFmt(maintenanceBaseline * 5)} routine maintenance
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.1)" }}>
                            {repFmt(repFiveYrTotal)} total over 5 years
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 20, fontWeight: 800, color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>No forecast yet</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "0 0 14px", lineHeight: 1.5 }}>
                        Upload an inspection report or complete a self-inspection to unlock your personalized 5-year cost outlook.
                      </p>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => inspRef.current?.click()} style={{ padding: "8px 16px", borderRadius: 10, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          <Upload size={13}/> Upload Inspection
                        </button>
                        <button onClick={() => { setSelfInspectStep(0); setSelfInspectAnswers({}); setShowSelfInspectModal(true); }} style={{ padding: "8px 14px", borderRadius: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          Self-Inspection
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                  {/* Combined header: counts + legend + action */}
                  <div style={{ padding: "12px 16px", background: C.bg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
                    {/* Left: severity counts */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {allFindings.filter(f => f.severity === "critical").length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${C.red}12`, color: C.red, border: `1px solid ${C.red}25` }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, display: "inline-block" }}/>{allFindings.filter(f => f.severity === "critical").length} high priority
                        </span>
                      )}
                      {allFindings.filter(f => f.severity === "warning").length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${C.amber}12`, color: C.amber, border: `1px solid ${C.amber}25` }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, display: "inline-block" }}/>{allFindings.filter(f => f.severity === "warning").length} warnings
                        </span>
                      )}
                      {completedFindings.length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${C.green}12`, color: C.green, border: `1px solid ${C.green}25` }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, display: "inline-block" }}/>{completedFindings.length} resolved
                        </span>
                      )}
                    </div>
                    {/* Right: action */}
                    <button onClick={() => { const all = deduplicateFindings(inspectionResult?.findings ?? []); const scored = all.filter(f => isScoredFinding(f.category, f.description) && (f.severity === "critical" || f.severity === "warning")); const fallback = all.filter(f => isScoredFinding(f.category, f.description)); setReviewFindings(scored.length > 0 ? scored : fallback.length > 0 ? fallback : all); setShowReviewModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: `${C.accent}0d`, border: `1px solid ${C.accent}28`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
                      Review All <ChevronRight size={13}/>
                    </button>
                  </div>
                  {/* Empty state — all repairs resolved */}
                  {repGroups.length === 0 && (
                    <div style={{ padding: "24px 18px", textAlign: "center" }}>
                      <CheckCircle2 size={28} color={C.green} style={{ margin: "0 auto 10px" }}/>
                      <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>All repairs resolved</p>
                      <p style={{ fontSize: 13, color: C.text3 }}>Completed items are in the Repair Archives below.</p>
                    </div>
                  )}
                  {/* Category groups — active (non-completed) repairs only */}
                  {repGroups.map(({ gk, label, items }, gi) => {
                    const isGrpOpen = expandedGroups.has(gk);
                    const meta = GROUP_META[gk] ?? GROUP_META.general;
                    const hasCritical = items.some(({ f }) => f.severity === "critical");
                    const hasWarning  = items.some(({ f }) => f.severity === "warning");
                    const allResolved = items.every(({ f, globalIdx }) => { const s = findingStatuses[findingKey(f, globalIdx)] ?? "repair_needed"; return s === "completed" || s === "not_needed"; });
                    const worstColor = hasCritical ? C.red : hasWarning ? C.amber : allResolved ? C.green : C.text3;
                    const worstLabel = hasCritical ? "High Priority" : hasWarning ? "Moderate Priority" : allResolved ? "Resolved" : "Good";
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
                          <div style={{ padding: "0 16px 14px", background: C.bg }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {items.map(({ f, globalIdx }, fi) => {
                                const fk = findingKey(f, globalIdx);
                                const status = findingStatuses[fk] ?? "repair_needed";
                                const cfg = repStatusConfig[status];
                                const isResolved = status === "completed" || status === "not_needed";
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
                                      {/* Regional cost estimate */}
                                      {(() => {
                                        // Map finding category → regional ranges system key
                                        const CAT_TO_SYS: Record<string, string> = {
                                          structural: "structure_foundation", foundation: "structure_foundation",
                                          structure_foundation: "structure_foundation",
                                          roof: "roof_drainage_exterior", roof_drainage_exterior: "roof_drainage_exterior",
                                          electrical: "electrical",
                                          plumbing: "plumbing",
                                          hvac: "hvac",
                                          appliances: "appliances_water_heater", appliances_water_heater: "appliances_water_heater",
                                          interior: "interior_windows_doors", windows: "interior_windows_doors", interior_windows_doors: "interior_windows_doors",
                                          safety: "safety_environmental", safety_environmental: "safety_environmental", environmental: "safety_environmental",
                                          exterior: "site_grading_drainage", site_grading_drainage: "site_grading_drainage", drainage: "site_grading_drainage",
                                        };
                                        const SEV_TO_TYPE: Record<string, string> = {
                                          critical: "major_repair", warning: "minor_repair", info: "maintenance",
                                        };
                                        const sysKey = CAT_TO_SYS[f.category?.toLowerCase() ?? ""] ?? null;
                                        const repType = SEV_TO_TYPE[f.severity ?? "warning"] ?? "minor_repair";
                                        const range = sysKey ? regionalRanges?.[sysKey]?.[repType] : null;
                                        if (!range && f.estimated_cost == null) return null;
                                        const fmt = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n.toLocaleString()}`;
                                        if (range) {
                                          return (
                                            <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, display: "inline-flex", alignItems: "center", gap: 3 }}>
                                              📍 {fmt(range.estimated_cost_min)}–{fmt(range.estimated_cost_max)}
                                              {regionalLocation?.city && <span style={{ color: C.text3, fontWeight: 400 }}> in {regionalLocation.city}</span>}
                                            </span>
                                          );
                                        }
                                        return (
                                          <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>
                                            Est. ${f.estimated_cost!.toLocaleString()}
                                          </span>
                                        );
                                      })()}
                                      {/* Single impact indicator — active repairs only */}
                                      {!isResolved && impact.affects && (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: impact.color + "14", color: impact.color }}>
                                          {impact.label} · {impact.reason}
                                        </span>
                                      )}
                                      {/* Completed state badge */}
                                      {isResolved && status === "completed" && (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: C.greenBg, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                          <CheckCircle2 size={10}/> Completed{impact.affects ? " · Score Updated" : ""}
                                        </span>
                                      )}
                                      {isResolved && status === "not_needed" && (
                                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: C.bg, color: C.text3 }}>
                                          Not Needed
                                        </span>
                                      )}
                                      {/* Action buttons — open repairs only */}
                                      {!isResolved && (
                                        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                          <select value={status} onChange={e => toggleFindingStatus(f, globalIdx, e.target.value as FindingStatus)}
                                            style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text2, cursor: "pointer", outline: "none" }}>
                                            <option value="repair_needed">Repair Needed</option>
                                            <option value="monitored">Monitoring</option>
                                            <option value="not_needed">Not Needed</option>
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
                      <span style={{ display: "inline-flex", transform: archivesExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><ChevronDown size={14} color={C.text3}/></span>
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
                                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: C.greenBg, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <CheckCircle2 size={10}/> Completed{meta?.was_scorable ? " · Score Updated" : ""}
                                </span>
                                {completedDate && (
                                  <span style={{ fontSize: 11, color: C.text3, display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={10}/> {completedDate}</span>
                                )}
                                {meta?.receipt_url && (
                                  <span style={{ fontSize: 11, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={10}/> Receipt attached</span>
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
          {/* Maintenance = recurring home care habits. NO inspection findings here. */}
          {/* Inspection findings (repairs) live exclusively in the Repairs tab.     */}
          {nav === "Maintenance" && (() => {
            const today   = new Date();
            const todayMs = today.getTime();

            type MaintTask = {
              id: string; task: string; system: string;
              freq: "monthly" | "quarterly" | "semi_annual" | "annual";
              freqLabel: string; weight: 1 | 2 | 3; tip: string;
              icon: React.ReactNode;
            };
            const PERIOD_DAYS: Record<string, number> = {
              monthly: 30, quarterly: 91, semi_annual: 182, annual: 365,
            };
            const MAINT_TASKS: MaintTask[] = [
              { id: "hvac_filter",        task: "HVAC Filter Replacement",         system: "HVAC",        freq: "monthly",     freqLabel: "Every 30 days",  weight: 2, tip: "1–2\" filters monthly; 4–5\" every 3–6 months",    icon: <Wind     size={13} color={C.accent}/> },
              { id: "dishwasher_filter",  task: "Clean Dishwasher Filter",         system: "Appliances",  freq: "monthly",     freqLabel: "Monthly",        weight: 1, tip: "Twist out bottom filter, rinse under warm water",    icon: <Wrench   size={13} color={C.accent}/> },
              { id: "garbage_disposal",   task: "Clean Garbage Disposal",          system: "Plumbing",    freq: "monthly",     freqLabel: "Monthly",        weight: 1, tip: "Ice cubes + salt, then citrus peel for odor",        icon: <Droplets size={13} color={C.accent}/> },
              { id: "range_hood",         task: "Degrease Range Hood Filter",      system: "Appliances",  freq: "monthly",     freqLabel: "Monthly",        weight: 1, tip: "Soak in hot soapy water or run through dishwasher",   icon: <Wrench   size={13} color={C.accent}/> },
              { id: "smoke_detector",     task: "Smoke Detector Test",             system: "Safety",      freq: "quarterly",   freqLabel: "Quarterly",      weight: 3, tip: "Press test button — replace batteries once a year",   icon: <Shield   size={13} color="#f59e0b"/> },
              { id: "exterior_walk",      task: "Exterior Walkthrough",            system: "Exterior",    freq: "quarterly",   freqLabel: "Quarterly",      weight: 2, tip: "Check siding, caulk, and foundation for new cracks",  icon: <Eye      size={13} color="#f59e0b"/> },
              { id: "gfci_test",          task: "Test GFCI Outlets",               system: "Electrical",  freq: "quarterly",   freqLabel: "Quarterly",      weight: 2, tip: "Press TEST then RESET on every GFCI outlet",          icon: <Zap      size={13} color="#f59e0b"/> },
              { id: "water_heater_chk",   task: "Water Heater Check",              system: "Plumbing",    freq: "quarterly",   freqLabel: "Quarterly",      weight: 2, tip: "Set to 120°F; test pressure-relief valve handle",      icon: <Droplets size={13} color="#f59e0b"/> },
              { id: "landscaping",        task: "Trim Vegetation Near Structure",  system: "Exterior",    freq: "quarterly",   freqLabel: "Quarterly",      weight: 1, tip: "Keep plants 12\"+ from siding and roof edge",          icon: <Activity size={13} color="#f59e0b"/> },
              { id: "gutter_clean",       task: "Clean Gutters & Downspouts",      system: "Roof",        freq: "semi_annual", freqLabel: "Twice / Year",   weight: 2, tip: "Spring after pollen, fall after leaves",               icon: <HomeIcon size={13} color="#8b5cf6"/> },
              { id: "hvac_tune",          task: "HVAC Tune-Up",                    system: "HVAC",        freq: "semi_annual", freqLabel: "Twice / Year",   weight: 3, tip: "Once before heat season, once before cool season",     icon: <Wind     size={13} color="#8b5cf6"/> },
              { id: "dryer_vent",         task: "Clean Dryer Vent & Lint Duct",   system: "Appliances",  freq: "semi_annual", freqLabel: "Twice / Year",   weight: 3, tip: "Leading cause of house fires — don't skip this one",   icon: <Wrench   size={13} color="#8b5cf6"/> },
              { id: "fire_ext",           task: "Inspect Fire Extinguisher",       system: "Safety",      freq: "semi_annual", freqLabel: "Twice / Year",   weight: 2, tip: "Check pressure gauge and expiration date",              icon: <Shield   size={13} color="#8b5cf6"/> },
              { id: "roof_inspect",       task: "Roof Inspection",                 system: "Roof",        freq: "annual",      freqLabel: "Annual",         weight: 2, tip: "Look for missing shingles and damaged flashing",        icon: <HomeIcon size={13} color={C.green}/> },
              { id: "water_heater_flush", task: "Flush Water Heater",              system: "Plumbing",    freq: "annual",      freqLabel: "Annual",         weight: 2, tip: "Extends life 2–3 years; improves efficiency",           icon: <Droplets size={13} color={C.green}/> },
              { id: "caulking",           task: "Inspect & Reapply Caulking",     system: "Exterior",    freq: "annual",      freqLabel: "Annual",         weight: 1, tip: "Windows, doors, tub/shower, exterior penetrations",    icon: <Eye      size={13} color={C.green}/> },
              { id: "pest_inspect",       task: "Pest & Termite Inspection",      system: "Safety",      freq: "annual",      freqLabel: "Annual",         weight: 3, tip: "Early detection prevents structural damage",             icon: <Bug      size={13} color={C.green}/> },
              { id: "chimney",            task: "Chimney & Fireplace Inspection", system: "Fireplace",   freq: "annual",      freqLabel: "Annual",         weight: 2, tip: "NFPA recommends annual inspection before first use",    icon: <Activity size={13} color={C.green}/> },
            ];

            type FullState = "done" | "booked" | "scheduled" | "overdue" | "due" | "upcoming";
            const hasAnyHistory = Object.keys(maintCompletions).length > 0 || Object.keys(maintScheduled).length > 0;

            function getFullState(t: MaintTask): FullState {
              const lastDone = maintCompletions[t.id];
              if (lastDone) {
                const daysSince = (todayMs - new Date(lastDone).getTime()) / 86400000;
                if (daysSince < PERIOD_DAYS[t.freq]) return "done";
              }
              const sched = maintScheduled[t.id];
              if (sched) return sched.status as FullState;
              if (!hasAnyHistory) {
                // On a fresh account, show tasks due within the current month as "due"
                const nextDue = getNextDue(t);
                const now = new Date(todayMs);
                const dueThisMonth = nextDue.getFullYear() === now.getFullYear() && nextDue.getMonth() === now.getMonth();
                return dueThisMonth ? "due" : "upcoming";
              }
              return lastDone ? "overdue" : "due";
            }

            const STATE_CFG: Record<FullState, { dot: string; label: string; bg: string; color: string; border: string }> = {
              done:      { dot: C.green,   label: "Done",      bg: C.greenBg, color: C.green,  border: `${C.green}40` },
              booked:    { dot: "#16a34a", label: "Booked",    bg: "#f0fdf4", color: "#16a34a",border: "#86efac" },
              scheduled: { dot: "#2563eb", label: "Scheduled", bg: "#eff6ff", color: "#2563eb",border: "#bfdbfe" },
              overdue:   { dot: C.red,     label: "Overdue",   bg: C.redBg,   color: C.red,    border: `${C.red}40` },
              due:       { dot: C.amber,   label: "Due Soon",  bg: C.amberBg, color: C.amber,  border: `${C.amber}40` },
              upcoming:  { dot: "#94a3b8", label: "Planned",   bg: C.surface2,color: C.text3,  border: C.border },
            };

            const MAINT_TRADE: Record<string, string> = {
              HVAC: "HVAC", Roof: "Roofing", Safety: "General Contractor",
              Plumbing: "Plumbing", Electrical: "Electrical",
              Appliances: "General Contractor", Exterior: "General Contractor", Fireplace: "Chimney Service",
            };

            // Maps maintenance task system → saved_contacts role keys (priority order)
            const MAINT_SYSTEM_ROLES: Record<string, string[]> = {
              HVAC:        ["hvac_tech"],
              Roof:        ["roofer", "gutter_cleaner"],
              Plumbing:    ["plumber"],
              Electrical:  ["electrician"],
              Safety:      ["pest_control", "general_contractor", "handyman"],
              Appliances:  ["general_contractor", "handyman"],
              Exterior:    ["landscaper", "general_contractor", "handyman"],
              Fireplace:   ["general_contractor", "handyman"],
            };

            // Find the first saved contact that matches a maintenance task's system
            function findTrustedVendor(system: string): TrustedContact | null {
              const roles = MAINT_SYSTEM_ROLES[system] ?? [];
              for (const role of roles) {
                const match = trustedContacts.find(c => c.role === role);
                if (match) return match;
              }
              return null;
            }

            const taskStates = Object.fromEntries(MAINT_TASKS.map(t => [t.id, getFullState(t)])) as Record<string, FullState>;

            function getNextDue(t: MaintTask): Date {
              const sched = maintScheduled[t.id];
              if (sched?.date) return new Date(sched.date + "T12:00:00");
              const lastDone = maintCompletions[t.id];
              if (lastDone) return new Date(new Date(lastDone).getTime() + PERIOD_DAYS[t.freq] * 86400000);
              return new Date(todayMs + PERIOD_DAYS[t.freq] * 86400000);
            }

            function fmtDate(d: Date): string {
              return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            }

            // Left: tasks needing action (overdue/due) + scheduled/booked
            const dueSoonTasks = MAINT_TASKS.filter(t => ["overdue","due","scheduled","booked"].includes(taskStates[t.id]));
            // Right: all tasks sorted by next due date (annual schedule view)
            const annualTasks = [...MAINT_TASKS].sort((a, b) => getNextDue(a).getTime() - getNextDue(b).getTime());

            // Maintenance score
            // Score = only tasks that are currently due or done-within-period
            // "Upcoming" tasks (period hasn't elapsed yet) don't affect score at all
            // Complete all currently-due tasks → 100%
            // New user with no history → null ("—")
            const relevantTasks = MAINT_TASKS.filter(t => ["done","overdue","due"].includes(taskStates[t.id]));
            const wRelevant = relevantTasks.reduce((s,t) => s + t.weight, 0);
            const wDoneRelevant = relevantTasks.filter(t => taskStates[t.id] === "done").reduce((s,t) => s + t.weight, 0);
            const maintScore = (hasAnyHistory && wRelevant > 0) ? Math.round((wDoneRelevant / wRelevant) * 100) : hasAnyHistory ? 100 : null;
            const urgentCount = MAINT_TASKS.filter(t => ["overdue","due"].includes(taskStates[t.id])).length;

            function openSchedule(t: MaintTask) {
              const sched = maintScheduled[t.id];
              // Pre-fill vendor: use saved schedule vendor first, then fall back to trusted contact
              const trusted = findTrustedVendor(t.system ?? "");
              const vendorDefault = sched?.vendor ?? (trusted ? (trusted.company ?? trusted.name) : "");
              setSchedDate(sched?.date ?? "");
              setSchedVendor(vendorDefault);
              setScheduleModal({ taskId: t.id, taskName: t.task });
            }

            function TaskRow({ t, showDate }: { t: MaintTask; showDate: boolean }) {
              const state = taskStates[t.id];
              const cfg   = STATE_CFG[state];
              const sched = maintScheduled[t.id];
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: state === "done" ? C.text3 : C.text, margin: 0, textDecoration: state === "done" ? "line-through" : "none" }}>{t.task}</p>
                    <p style={{ fontSize: 11, color: C.text3, margin: "2px 0 0 0" }}>{t.freqLabel}{sched?.vendor ? ` · ${sched.vendor}` : ` · ${t.system}`}</p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {showDate && (
                      <p style={{ fontSize: 11, color: C.text3, margin: "0 0 4px" }}>{fmtDate(getNextDue(t))}</p>
                    )}
                    {state === "done" ? (
                      <button onClick={() => toggleMaintTask(t.id)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: C.greenBg, color: C.green, border: `1px solid ${C.green}40`, cursor: "pointer" }}>✓ Done</button>
                    ) : state === "booked" ? (
                      <button onClick={() => openSchedule(t)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", cursor: "pointer" }}>Booked</button>
                    ) : state === "scheduled" ? (
                      <button onClick={() => openSchedule(t)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", cursor: "pointer" }}>Scheduled</button>
                    ) : state === "overdue" ? (
                      <button onClick={() => openSchedule(t)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: C.redBg, color: C.red, border: `1px solid ${C.red}40`, cursor: "pointer" }}>Overdue</button>
                    ) : state === "due" ? (
                      <button onClick={() => openSchedule(t)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: C.amberBg, color: C.amber, border: `1px solid ${C.amber}40`, cursor: "pointer" }}>Due Soon</button>
                    ) : (
                      <button onClick={() => openSchedule(t)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 10, background: C.surface2, color: C.text3, border: `1px solid ${C.border}`, cursor: "pointer" }}>Planned</button>
                    )}
                  </div>
                </div>
              );
            }

            // Points per task weight
            const PTS: Record<number, number> = { 1: 8, 2: 12, 3: 18 };

            // Grade from score
            function getMaintGrade(s: number | null): string {
              if (s === null) return "—";
              if (s >= 90) return "A";
              if (s >= 75) return "B";
              if (s >= 60) return "C";
              if (s >= 40) return "D";
              return "F";
            }

            // Motivational copy
            function getMaintTitle(s: number | null): string {
              if (s === null) return "Getting Started";
              if (s >= 90) return "Home Champion";
              if (s >= 75) return "Doing Great";
              if (s >= 55) return "On Track";
              if (s >= 35) return "Building Momentum";
              return "Getting Started";
            }

            // "Up This Month" = overdue, due, scheduled, booked (need action)
            const upThisMonth = MAINT_TASKS.filter(t => ["overdue","due","scheduled","booked"].includes(taskStates[t.id]));
            // "Scheduled & Annual" = done + upcoming, sorted by next due date
            const scheduledAnnual = annualTasks.filter(t => ["done","upcoming"].includes(taskStates[t.id]));

            // Seasonal checklist — resets each season via maintenanceDoneKey
            const mo = new Date().getMonth();
            const currentSeason = mo <= 1 || mo === 11 ? "Winter" : mo <= 4 ? "Spring" : mo <= 7 ? "Summer" : "Fall";
            const SEASONAL_TASKS: Record<string, { id: string; task: string }[]> = {
              Spring: [
                { id: "sp_ac_service",      task: "Schedule AC tune-up before cooling season" },
                { id: "sp_gutters",          task: "Clean gutters after winter / pollen season" },
                { id: "sp_roof_check",       task: "Walk the roof — look for winter damage" },
                { id: "sp_exterior",         task: "Inspect exterior caulk, siding & foundation cracks" },
                { id: "sp_deck",             task: "Check deck/patio for rot, loose boards, or rust" },
                { id: "sp_irrigation",       task: "Turn on irrigation system & check for leaks" },
                { id: "sp_smoke",            task: "Test smoke & CO detectors, replace batteries" },
                { id: "sp_dryer_vent",       task: "Clean dryer vent & lint duct" },
              ],
              Summer: [
                { id: "su_ac_filter",        task: "Replace HVAC filter — peak cooling season" },
                { id: "su_windows",          task: "Check window & door seals for AC efficiency" },
                { id: "su_attic",            task: "Inspect attic for heat buildup & proper ventilation" },
                { id: "su_pest",             task: "Inspect for pests & ants around foundation" },
                { id: "su_outdoor",          task: "Check outdoor faucets & hose bibs for leaks" },
                { id: "su_landscape",        task: "Trim vegetation 12\"+ from siding & roof edge" },
              ],
              Fall: [
                { id: "fa_gutters",          task: "Clean gutters after leaves fall" },
                { id: "fa_heating",          task: "Schedule furnace/heating tune-up before cold season" },
                { id: "fa_weatherstrip",     task: "Check weatherstripping on all doors & windows" },
                { id: "fa_chimney",          task: "Inspect chimney & fireplace before first use" },
                { id: "fa_irrigation",       task: "Shut off & drain irrigation system" },
                { id: "fa_smoke",            task: "Test smoke & CO detectors, replace batteries" },
                { id: "fa_dryer_vent",       task: "Clean dryer vent & lint duct" },
                { id: "fa_roof",             task: "Inspect roof before rainy / snow season" },
              ],
              Winter: [
                { id: "wi_pipes",            task: "Insulate exposed pipes — protect from freezing" },
                { id: "wi_hvac",             task: "Replace HVAC filter for heating season" },
                { id: "wi_fire_ext",         task: "Check fire extinguisher pressure gauge" },
                { id: "wi_reverse_fans",     task: "Reverse ceiling fans to clockwise (push warm air down)" },
                { id: "wi_weatherstrip",     task: "Check door weatherstripping for drafts" },
                { id: "wi_detectors",        task: "Test smoke & CO detectors" },
              ],
            };
            const seasonTasks = SEASONAL_TASKS[currentSeason] ?? [];

            // Score ring geometry
            const ringR = 52; const ringC = 64;
            const ringCircumference = 2 * Math.PI * ringR;
            const ringProgress = maintScore ?? 0;
            const ringOffset = ringCircumference - (ringProgress / 100) * ringCircumference;
            const ringColor = ringProgress >= 75 ? "#4ade80" : ringProgress >= 45 ? themeAccent : C.red;
            const maintGrade = getMaintGrade(maintScore);
            const maintTitle = getMaintTitle(maintScore);
            const doneTotalCount = MAINT_TASKS.filter(t => taskStates[t.id] === "done").length;

            // New task row for the redesigned layout
            function NewTaskRow({ t }: { t: MaintTask }) {
              const state  = taskStates[t.id];
              const sched  = maintScheduled[t.id];
              const isDone = state === "done";
              const pts    = PTS[t.weight] ?? 10;
              const dueDateStr = fmtDate(getNextDue(t));

              const pillStyle = (bg: string, color: string, border: string) => ({
                fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 8,
                background: bg, color, border: `1px solid ${border}`, display: "inline-block",
              });

              return (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0" }}>
                  {/* Checkbox */}
                  <button onClick={() => toggleMaintTask(t.id)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isDone ? C.green : C.border}`, background: isDone ? C.green : "white", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                    {isDone && <span style={{ color: "white", fontSize: 11, fontWeight: 900 }}>✓</span>}
                  </button>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: isDone ? C.text3 : C.text, margin: "0 0 2px", textDecoration: isDone ? "line-through" : "none", letterSpacing: "-0.1px" }}>{t.task}</p>
                    <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>
                      {t.freqLabel}{sched?.vendor ? ` · ${sched.vendor}` : ` · ${t.system}`}
                    </p>
                  </div>

                  {/* Right: date + pill + pts */}
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontSize: 11, color: C.text3, fontWeight: 500 }}>{dueDateStr}</span>
                    {isDone ? (
                      <span style={pillStyle(C.greenBg, C.green, `${C.green}40`)}>Done</span>
                    ) : state === "booked" ? (
                      <button onClick={() => openSchedule(t)} style={{ ...pillStyle("#f0fdf4","#16a34a","#86efac"), cursor: "pointer" }}>Booked</button>
                    ) : state === "scheduled" ? (
                      <button onClick={() => openSchedule(t)} style={{ ...pillStyle("#eff6ff","#2563eb","#bfdbfe"), cursor: "pointer" }}>Scheduled</button>
                    ) : state === "overdue" ? (
                      <button onClick={() => openSchedule(t)} style={{ ...pillStyle(C.redBg, C.red, `${C.red}40`), cursor: "pointer" }}>Overdue</button>
                    ) : state === "due" ? (
                      <button onClick={() => openSchedule(t)} style={{ ...pillStyle(C.amberBg, C.amber, `${C.amber}40`), cursor: "pointer" }}>Due Soon</button>
                    ) : (
                      <button onClick={() => openSchedule(t)} style={{ ...pillStyle(C.surface2, C.text3, C.border), cursor: "pointer" }}>Planned</button>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: themeAccent }}>+{pts} pts</span>
                  </div>
                </div>
              );
            }

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* ── Score Hero ── */}
                <div style={{ borderRadius: 18, padding: isMobile ? "22px 20px" : "28px 32px", background: themeNavy }}>
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 16 : 28, flexWrap: "wrap" }}>

                    {/* Ring */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <svg width={ringC * 2} height={ringC * 2} style={{ transform: "rotate(-90deg)" }}>
                        <circle cx={ringC} cy={ringC} r={ringR} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={9}/>
                        <circle cx={ringC} cy={ringC} r={ringR} fill="none" stroke={ringColor} strokeWidth={9}
                          strokeDasharray={ringCircumference} strokeDashoffset={ringOffset}
                          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.7s ease" }}/>
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 28, fontWeight: 900, color: "white", letterSpacing: "-2px", lineHeight: 1, fontFamily: "Inter, sans-serif" }}>{maintScore ?? "—"}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.05em" }}>out of 100</span>
                      </div>
                    </div>

                    {/* Title + progress bar */}
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 4px" }}>Maintenance Score</p>
                      <p style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: "white", margin: "0 0 6px", letterSpacing: "-0.5px", lineHeight: 1.1, fontFamily: "Inter, sans-serif" }}>{maintTitle}</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 16px" }}>
                        Check off completed tasks to raise your score and keep your home in top shape.
                      </p>
                      {/* Progress bar */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Tasks Completed</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{doneTotalCount} / {MAINT_TASKS.length}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 10, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 10, background: themeAccent, width: `${(doneTotalCount / MAINT_TASKS.length) * 100}%`, transition: "width 0.6s ease" }}/>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ── Two-column: Up This Month | Scheduled & Annual ── */}
                <div style={{ display: isMobile ? "flex" : "grid", flexDirection: "column", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>

                  {/* LEFT: Up This Month */}
                  <div style={{ ...card() }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.2px" }}>Up This Month</p>
                      {urgentCount > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 8, background: C.redBg, color: C.red, border: `1px solid ${C.red}30` }}>{urgentCount} Overdue</span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: C.text3, margin: "0 0 4px" }}>Tap any status pill to schedule</p>
                    {upThisMonth.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "28px 0" }}>
                        <CheckCircle2 size={28} color={C.green} style={{ margin: "0 auto 10px" }}/>
                        <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>All caught up!</p>
                        <p style={{ fontSize: 12, color: C.text3 }}>No tasks need immediate attention.</p>
                      </div>
                    ) : (
                      <div>
                        {upThisMonth.map((t, i) => (
                          <div key={t.id} style={{ borderBottom: i < upThisMonth.length - 1 ? `1px solid ${C.border}` : "none" }}>
                            <NewTaskRow t={t}/>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Scheduled & Annual */}
                  <div style={{ ...card() }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.2px" }}>Scheduled & Annual</p>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 8, background: C.surface2, color: C.text3, border: `1px solid ${C.border}` }}>{scheduledAnnual.length} Tasks</span>
                    </div>
                    <p style={{ fontSize: 12, color: C.text3, margin: "0 0 4px" }}>Upcoming & completed tasks</p>
                    <div>
                      {scheduledAnnual.map((t, i) => (
                        <div key={t.id} style={{ borderBottom: i < scheduledAnnual.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <NewTaskRow t={t}/>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Full Schedule (collapsible) ── */}
                <div style={{ borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", background: C.surface }}>
                  {/* Toggle header */}
                  <button
                    onClick={() => setShowFullSchedule(v => !v)}
                    style={{ width: "100%", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>
                        {currentSeason === "Spring" ? "🌸" : currentSeason === "Summer" ? "☀️" : currentSeason === "Fall" ? "🍂" : "❄️"}
                      </span>
                      <div>
                        <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.2px" }}>
                          Full Schedule & {currentSeason} Checklist
                        </p>
                        <p style={{ fontSize: 11, color: C.text3, margin: "1px 0 0" }}>Monthly · Quarterly · Semi-Annual · Annual + seasonal tasks</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 8, background: C.surface2, color: C.text3, border: `1px solid ${C.border}` }}>
                        {MAINT_TASKS.length + seasonTasks.length} tasks
                      </span>
                      <ChevronDown size={16} color={C.text3} style={{ transform: showFullSchedule ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}/>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {showFullSchedule && (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: "0 20px 20px" }}>

                      {/* Frequency groups */}
                      {(["monthly","quarterly","semi_annual","annual"] as MaintTask["freq"][]).map(freq => {
                        const labels: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", semi_annual: "Twice a Year", annual: "Annual" };
                        const colors: Record<string, string> = { monthly: themeAccent, quarterly: "#f59e0b", semi_annual: "#8b5cf6", annual: C.green };
                        const bgs:    Record<string, string> = { monthly: C.accentBg,  quarterly: "#fffbeb",  semi_annual: "#f5f3ff",  annual: C.greenBg };
                        const groupTasks = MAINT_TASKS.filter(t => t.freq === freq);
                        const groupDone  = groupTasks.filter(t => taskStates[t.id] === "done").length;
                        return (
                          <div key={freq} style={{ marginTop: 20 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors[freq] }}/>
                                <p style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{labels[freq]}</p>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: bgs[freq], color: colors[freq], border: `1px solid ${colors[freq]}30` }}>
                                {groupDone}/{groupTasks.length}
                              </span>
                            </div>
                            {groupTasks.map((t, i) => (
                              <div key={t.id} style={{ borderBottom: i < groupTasks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                                <NewTaskRow t={t}/>
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      {/* Seasonal checklist */}
                      <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16 }}>
                              {currentSeason === "Spring" ? "🌸" : currentSeason === "Summer" ? "☀️" : currentSeason === "Fall" ? "🍂" : "❄️"}
                            </span>
                            <p style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{currentSeason} Checklist</p>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: C.greenBg, color: C.green, border: `1px solid ${C.green}30` }}>
                            {seasonTasks.filter(t => doneTasks.has(t.id)).length}/{seasonTasks.length}
                          </span>
                        </div>
                        {seasonTasks.map((t, i) => {
                          const isDone = doneTasks.has(t.id);
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < seasonTasks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                              <button onClick={() => toggleDoneTask(t.id)}
                                style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isDone ? C.green : C.border}`, background: isDone ? C.green : "white", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {isDone && <span style={{ color: "white", fontSize: 11, fontWeight: 900 }}>✓</span>}
                              </button>
                              <p style={{ fontSize: 13, fontWeight: 600, color: isDone ? C.text3 : C.text, margin: 0, textDecoration: isDone ? "line-through" : "none", flex: 1 }}>{t.task}</p>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  )}
                </div>

                {/* ── Schedule / Status Modal ── */}
                {scheduleModal && scheduleModal.taskId !== "__custom__" && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
                    onClick={e => { if (e.target === e.currentTarget) setScheduleModal(null); }}>
                    <div style={{ background: "white", borderRadius: 20, padding: "28px 28px 24px", width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Schedule Task</p>
                      <p style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: "0 0 20px", letterSpacing: "-0.3px" }}>{scheduleModal.taskName}</p>

                      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Date</label>
                          <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
                        </div>
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 700, color: C.text2, display: "block", marginBottom: 6 }}>Vendor <span style={{ fontWeight: 400, color: C.text3 }}>(optional)</span></label>
                          <input type="text" value={schedVendor} onChange={e => setSchedVendor(e.target.value)}
                            placeholder="e.g. ABC HVAC Services"
                            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
                          {/* Home Team suggestion — show when vendor field was auto-filled from saved contacts */}
                          {(() => {
                            const taskSystem = MAINT_TASKS.find(t => t.id === scheduleModal.taskId)?.system ?? "";
                            const trusted = findTrustedVendor(taskSystem);
                            if (!trusted) return null;
                            const trustedDisplay = trusted.company ?? trusted.name;
                            return (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#f0f9ff", border: "1px solid #bae6fd" }}>
                                <Users size={12} color="#0369a1"/>
                                <span style={{ fontSize: 12, color: "#0369a1", flex: 1 }}>
                                  <strong>Your Home Team:</strong> {trustedDisplay}
                                  {trusted.phone && <span style={{ color: "#0284c7" }}> · {trusted.phone}</span>}
                                </span>
                                {schedVendor !== trustedDisplay && (
                                  <button onClick={() => setSchedVendor(trustedDisplay)}
                                    style={{ fontSize: 11, fontWeight: 700, color: "#0284c7", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                                    Use →
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { if (schedDate) saveSchedule(scheduleModal.taskId, "scheduled"); }}
                            disabled={!schedDate}
                            style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${C.border}`, background: schedDate ? "#eff6ff" : C.surface2, color: schedDate ? "#2563eb" : C.text3, fontSize: 13, fontWeight: 700, cursor: schedDate ? "pointer" : "not-allowed" }}>
                            📅 Scheduled
                          </button>
                          <button onClick={() => { if (schedDate) saveSchedule(scheduleModal.taskId, "booked"); }}
                            disabled={!schedDate}
                            style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${schedDate ? "#86efac" : C.border}`, background: schedDate ? "#f0fdf4" : C.surface2, color: schedDate ? "#16a34a" : C.text3, fontSize: 13, fontWeight: 700, cursor: schedDate ? "pointer" : "not-allowed" }}>
                            ✓ Booked
                          </button>
                        </div>
                        <button onClick={() => { toggleMaintTask(scheduleModal.taskId); clearSchedule(scheduleModal.taskId); setScheduleModal(null); }}
                          style={{ padding: "11px", borderRadius: 10, border: `1px solid ${C.green}40`, background: C.greenBg, color: C.green, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                          ✓ Mark as Done
                        </button>
                        {maintScheduled[scheduleModal.taskId] && (
                          <button onClick={() => { clearSchedule(scheduleModal.taskId); setScheduleModal(null); }}
                            style={{ padding: "9px", borderRadius: 10, border: `1px solid ${C.border}`, background: "white", color: C.text3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            Clear schedule
                          </button>
                        )}
                        <button onClick={() => { handleFindVendors(MAINT_TRADE[MAINT_TASKS.find(t => t.id === scheduleModal.taskId)?.system ?? ""] ?? "General Contractor", scheduleModal.taskName, scheduleModal.taskName); setScheduleModal(null); }}
                          style={{ padding: "9px", borderRadius: 10, border: `1px solid ${C.accent}30`, background: C.accentBg, color: C.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                          <Users size={12}/> Find a Vendor First
                        </button>
                        <button onClick={() => setScheduleModal(null)}
                          style={{ padding: "9px", borderRadius: 10, border: "none", background: "none", color: C.text3, fontSize: 12, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            );
          })()}

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

            // Summary counts for the report card
            const reportFindings     = inspectionResult?.findings ?? [];
            const reportCritical     = reportFindings.filter(f => f.severity === "critical").length;
            const reportWarnings     = reportFindings.filter(f => f.severity === "warning").length;
            const reportResolved     = Object.values(findingStatuses).filter(s => s === "completed").length;
            const reportMaintDone    = doneTasks.size;
            const hasReportData      = reportFindings.length > 0 || reportResolved > 0;

            return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ── Generate Full Home Report ─────────────────────────── */}
              <div style={{ ...card({ padding: "20px 22px" }), background: themeNavy, color: "white" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <FileText size={18} color="rgba(255,255,255,0.85)"/>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "white" }}>Full Home Report</p>
                    </div>
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                      Compile all repairs, maintenance, and system data into a printable report — useful for selling disclosures, buyer negotiations, or briefing contractors.
                    </p>
                    {hasReportData && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {reportCritical > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(220,38,38,0.25)", color: "#fca5a5", borderRadius: 20, padding: "3px 10px" }}>
                            {reportCritical} critical
                          </span>
                        )}
                        {reportWarnings > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(217,119,6,0.25)", color: "#fcd34d", borderRadius: 20, padding: "3px 10px" }}>
                            {reportWarnings} warnings
                          </span>
                        )}
                        {reportResolved > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(22,163,74,0.25)", color: "#86efac", borderRadius: 20, padding: "3px 10px" }}>
                            {reportResolved} resolved
                          </span>
                        )}
                        {reportMaintDone > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)", borderRadius: 20, padding: "3px 10px" }}>
                            {reportMaintDone} maintenance tasks done
                          </span>
                        )}
                      </div>
                    )}
                    {!hasReportData && (
                      <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                        Upload an inspection report to include findings.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={generateHomeReport}
                    disabled={generatingReport}
                    style={{
                      flexShrink: 0, padding: "11px 20px", borderRadius: 12,
                      background: generatingReport ? "rgba(255,255,255,0.1)" : "white",
                      color: generatingReport ? "rgba(255,255,255,0.4)" : themeNavy,
                      border: "none", fontWeight: 700, fontSize: 13,
                      cursor: generatingReport ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
                    }}
                  >
                    {generatingReport
                      ? <><span className="animate-spin" style={{ display: "inline-block" }}>⟳</span> Generating…</>
                      : <><Download size={14}/> Generate Report</>
                    }
                  </button>
                </div>
              </div>

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
                        <div style={{ padding: "16px 18px 20px", background: C.bg, borderTop: `1px solid ${C.border}` }}>

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
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                    {inspectionDoc.url && (
                                      <a href={inspectionDoc.url} target="_blank" rel="noopener noreferrer"
                                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, background: C.accent, color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                                        <ExternalLink size={11}/> View PDF
                                      </a>
                                    )}
                                    <button
                                      onClick={deleteInspectionDoc}
                                      title="Remove report"
                                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.red, cursor: "pointer", flexShrink: 0 }}
                                    >
                                      <Trash2 size={13}/>
                                    </button>
                                  </div>
                                </div>

                                {/* ── Score-reset confirmation banner ── */}
                                {confirmDeleteInspection && (
                                  <div style={{ background: "#fef2f2", border: `1.5px solid ${C.red}40`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <AlertTriangle size={16} color={C.red} style={{ flexShrink: 0, marginTop: 1 }}/>
                                      <div>
                                        <p style={{ fontSize: 13, fontWeight: 700, color: C.red, margin: "0 0 3px" }}>Are you sure?</p>
                                        <p style={{ fontSize: 13, color: "#7f1d1d", margin: 0, lineHeight: 1.5 }}>
                                          This will delete your inspection report and <strong>reset your Home Health Score</strong>. You can re-upload a report at any time.
                                        </p>
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button onClick={() => setConfirmDeleteInspection(false)} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", fontSize: 13, fontWeight: 600, color: C.text2, cursor: "pointer" }}>
                                        Cancel
                                      </button>
                                      <button onClick={confirmAndDeleteInspectionDoc} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: C.red, color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                        Yes, Delete Report
                                      </button>
                                    </div>
                                  </div>
                                )}

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
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                    {inspecting ? <><Loader2 size={11} className="animate-spin"/> Analyzing…</> : <><Upload size={11}/> Upload Report</>}
                                    <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
                                  </label>
                                  <button onClick={clearInspectionAnalysis} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                    <Trash2 size={11}/> Clear Analysis
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {inspecting ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, border: `2px dashed ${C.accent}`, background: "#eff6ff" }}>
                                    <Loader2 size={20} color={C.accent} className="animate-spin"/>
                                    <span style={{ fontSize: 14, color: C.accent }}>
                                      {inspectStage === "uploading" ? "Uploading PDF…" : inspectStage === "saving" ? "Saving findings…" : "Analyzing report…"}
                                    </span>
                                  </div>
                                ) : photoAnalyzing ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, border: `2px dashed ${C.accent}`, background: "#eff6ff" }}>
                                    <Loader2 size={20} color={C.accent} className="animate-spin"/>
                                    <span style={{ fontSize: 14, color: C.accent }}>Analyzing photos…</span>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${C.border}`, background: C.bg }}>
                                      <FileText size={20} color={C.text3}/>
                                      <span style={{ fontSize: 14, color: C.text }}>Upload inspection report PDF</span>
                                      <span style={{ fontSize: 12, color: C.text3 }}>BTLR extracts all findings and scores your home</span>
                                      <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button onClick={() => { scanningDocRef.current = "inspection"; setScanningDoc("inspection"); scanDocRef.current?.click(); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: "transparent", color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                                        <Camera size={14}/> Scan Report Pages
                                      </button>
                                      <button onClick={() => photoRef.current?.click()} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${C.border}`, background: "transparent", color: C.text2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                                        <Camera size={14}/> Photo Home Issues
                                      </button>
                                    </div>
                                    {photoErr && <p style={{ fontSize: 12, color: C.red, margin: 0 }}>{photoErr}</p>}
                                  </div>
                                )}
                              </div>
                            )}
                          </>)}

                          {/* ── Warranty content ── */}
                          {sec.id === "warranty" && (<>
                            <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
                              Upload your home warranty or maintenance policy. BTLR will extract your coverage, exclusions, service fee, and claim contact info.
                            </p>
                            {!warranty ? (
                              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${parsingWarranty ? "#7c3aed" : C.border}`, background: parsingWarranty ? "#faf5ff" : C.bg }}>
                                {parsingWarranty
                                  ? <><Loader2 size={20} color="#7c3aed" className="animate-spin"/><span style={{ fontSize: 14, color: "#7c3aed" }}>Parsing warranty document…</span></>
                                  : <><Shield size={20} color="#7c3aed"/><span style={{ fontSize: 14, color: C.text }}>Upload home warranty or maintenance policy</span><span style={{ fontSize: 12, color: C.text3 }}>PDF or text document</span></>
                                }
                                <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                              </label>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid ${C.accent}", color: "#7c3aed", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                    {parsingWarranty ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                    {parsingWarranty ? "Parsing…" : "Replace"}
                                    <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                                  </label>
                                </div>
                                <div style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 12, padding: "14px 16px" }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                                    <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>
                                      {warranty.provider ?? "Warranty"}{warranty.planName ? ` — ${warranty.planName}` : ""}
                                    </p>
                                    {/* Expiry badge */}
                                    {warranty.expirationDate && (() => {
                                      const exp  = new Date(warranty.expirationDate);
                                      const days = Math.round((exp.getTime() - Date.now()) / 86400000);
                                      if (days <= 0) return <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", fontWeight: 700 }}>Expired</span>;
                                      const color  = days < 30 ? "#dc2626" : days < 90 ? "#d97706" : "#16a34a";
                                      const bg     = days < 30 ? "#fef2f2" : days < 90 ? "#fffbeb" : "#f0fdf4";
                                      const border = days < 30 ? "#fca5a5" : days < 90 ? "#fcd34d" : "#86efac";
                                      return <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 12, background: bg, border: `1px solid ${border}`, color, fontWeight: 700 }}>{days} days left</span>;
                                    })()}
                                  </div>
                                  <p style={{ fontSize: 13, color: C.text3, margin: "0 0 8px" }}>
                                    {[warranty.policyNumber ? `#${warranty.policyNumber}` : null, warranty.serviceFee ? `$${warranty.serviceFee} service fee` : null, warranty.expirationDate ? `Expires ${warranty.expirationDate}` : null, warranty.autoRenews ? "Auto-renews" : null].filter(Boolean).join(" · ")}
                                  </p>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    {warranty.claimUrl && (
                                      <a href={warranty.claimUrl.startsWith("http") ? warranty.claimUrl : `https://${warranty.claimUrl}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 7, background: "#7c3aed", color: "white", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
                                        <RefreshCw size={10}/> Renew
                                      </a>
                                    )}
                                    {warrantyDocUrl ? (
                                      <a href={warrantyDocUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 7, border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 11, fontWeight: 700, textDecoration: "none", background: "white" }}>
                                        <FileText size={10}/> View PDF
                                      </a>
                                    ) : (
                                      <span style={{ fontSize: 11, color: C.text3 }}>Re-upload to enable PDF view</span>
                                    )}
                                  </div>
                                </div>
                                {(warranty.claimUrl || warranty.claimPhone || warranty.claimEmail) && (
                                  <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px" }}>
                                    <p style={{ fontSize: 12, fontWeight: 700, color: C.accent, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}><Send size={11}/> File a Claim</p>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      {warranty.claimUrl && <a href={warranty.claimUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, background: "#7c3aed", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}><ExternalLink size={12}/> File Online</a>}
                                      {warranty.claimPhone && <a href={`tel:${warranty.claimPhone.replace(/\D/g, "")}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid ${C.accent}", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}><Phone size={12}/> {warranty.claimPhone}</a>}
                                      {warranty.claimEmail && <a href={`mailto:${warranty.claimEmail}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid ${C.accent}", color: "#7c3aed", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}><Mail size={12}/> Email Claims</a>}
                                    </div>
                                    {warranty.responseTime && <p style={{ fontSize: 11, color: C.text3, margin: "8px 0 0" }}>Typical response: {warranty.responseTime}</p>}
                                  </div>
                                )}
                                {(warranty.coverageItems?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Covered ({warranty.coverageItems!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {warranty.coverageItems!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(warranty.exclusions?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Excluded ({warranty.exclusions!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {warranty.exclusions!.map((item, i) => <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {warranty.coverageLimits && Object.keys(warranty.coverageLimits).length > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Coverage Limits</p>
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
                              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${parsingInsurance ? "#0891b2" : C.border}`, background: parsingInsurance ? "#f0f9ff" : C.bg }}>
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
                                      {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Plus size={10}/>}
                                      {parsingInsurance ? "…" : "Add Policy"}
                                      <input key={`doc-add-${insuranceFileKey}`} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={addSecondaryPolicy} disabled={parsingInsurance}/>
                                    </label>
                                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid #0891b2", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                      {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                      {parsingInsurance ? "Parsing…" : "Replace"}
                                      <input key={`doc-rep-${insuranceFileKey}`} type="file" accept=".pdf,.txt" multiple style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                                    </label>
                                  </div>
                                </div>
                                <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 12, padding: "14px 16px" }}>
                                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>
                                    {insurance.provider ?? "Insurance"}{insurance.policyType ? ` — ${insurance.policyType}` : ""}
                                  </p>
                                  <p style={{ fontSize: 13, color: C.text3, margin: "0 0 8px" }}>
                                    {[insurance.policyNumber ? `#${insurance.policyNumber}` : null, (insurance.annualPremium ?? insurance.premium) ? `$${(insurance.annualPremium ?? insurance.premium)?.toLocaleString()}/yr` : null, insurance.deductibleStandard ? `$${insurance.deductibleStandard.toLocaleString()} deductible` : null, insurance.expirationDate ? `Renews ${insurance.expirationDate}` : null].filter(Boolean).join(" · ")}
                                  </p>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    {insuranceDocUrls.length > 0 ? (
                                      insuranceDocUrls.map((url, i) => (
                                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 7, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 11, fontWeight: 700, textDecoration: "none", background: "white" }}>
                                          <FileText size={10}/> {insuranceDocUrls.length > 1 ? `View PDF ${i + 1}` : "View PDF"}
                                        </a>
                                      ))
                                    ) : (
                                      <span style={{ fontSize: 11, color: C.text3 }}>Re-upload to enable PDF view</span>
                                    )}
                                  </div>
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
                                    <p style={{ fontSize: 12, fontWeight: 700, color: "#0891b2", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}><Send size={11}/> File a Claim</p>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      {insurance.claimUrl   && <a href={insurance.claimUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, background: "#0891b2", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none" }}><ExternalLink size={12}/> File Online</a>}
                                      {insurance.claimPhone && <a href={`tel:${insurance.claimPhone.replace(/\D/g, "")}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}><Phone size={12}/> {insurance.claimPhone}</a>}
                                      {insurance.claimEmail && <a href={`mailto:${insurance.claimEmail}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #0891b2", color: "#0891b2", fontSize: 12, fontWeight: 700, textDecoration: "none", background: "white" }}><Mail size={12}/> Email Claims</a>}
                                    </div>
                                    {insurance.claimHours && <p style={{ fontSize: 11, color: C.text3, margin: "8px 0 0" }}>{insurance.claimHours}</p>}
                                  </div>
                                )}
                                {(insurance.coverageItems?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Covered ({insurance.coverageItems!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.coverageItems!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 9px", color: "#15803d" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(insurance.endorsements?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Endorsements ({insurance.endorsements!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.endorsements!.map((item, i) => <span key={i} style={{ fontSize: 12, background: "#e0f2fe", border: "1px solid #7dd3fc", borderRadius: 6, padding: "3px 9px", color: "#0369a1" }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {(insurance.exclusions?.length ?? 0) > 0 && (
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Excluded ({insurance.exclusions!.length})</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {insurance.exclusions!.map((item, i) => <span key={i} style={{ fontSize: 12, background: C.redBg, border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 9px", color: C.red }}>{item}</span>)}
                                    </div>
                                  </div>
                                )}
                                {/* Additional / stacked policies */}
                                {(insurance.additionalPolicies ?? []).map((ap, i) => (
                                  <div key={i} style={{ borderTop: "1.5px solid #bae6fd", paddingTop: 12, marginTop: 4 }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                      <div>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                                          {ap.provider ?? "Additional Policy"}{ap.policyType ? ` · ${ap.policyType}` : ""}
                                        </span>
                                        {ap.policyNumber && <span style={{ fontSize: 11, color: C.text3, marginLeft: 8, fontFamily: "monospace" }}>#{ap.policyNumber}</span>}
                                      </div>
                                      <button onClick={async () => {
                                        if (!confirm("Remove this policy?")) return;
                                        const propId = activePropertyIdRef.current;
                                        if (!propId) return;
                                        const updated = (insurance?.additionalPolicies ?? []).filter((_, j) => j !== i);
                                        await supabase.from("home_insurance").update({ additional_policies: updated }).eq("property_id", propId);
                                        setInsurance(prev => prev ? { ...prev, additionalPolicies: updated } : prev);
                                        showToast("Policy removed", "success");
                                      }} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 2 }}><X size={13}/></button>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      {ap.annualPremium && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}><div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Premium</div><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>${ap.annualPremium.toLocaleString()}<span style={{ fontSize: 10, color: C.text3 }}>/yr</span></div></div>}
                                      {ap.expirationDate && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}><div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Renews</div><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{ap.expirationDate}</div></div>}
                                    </div>
                                    {(ap.claimPhone || ap.claimUrl) && (
                                      <button onClick={() => {
                                        if (ap.claimUrl) window.open(ap.claimUrl);
                                        else if (ap.claimPhone) window.location.href = `tel:${ap.claimPhone.replace(/\D/g, "")}`;
                                      }} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 7, background: C.navy, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        File Claim
                                      </button>
                                    )}
                                  </div>
                                ))}
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
                                  <div key={r.id ?? i} style={{ background: C.greenBg, border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <CheckCircle2 size={13} color={C.green}/>
                                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text, flex: 1 }}>{formatLabel(r.category) || "Repair"}{r.vendor ? ` — ${r.vendor}` : ""}</span>
                                      {r.cost ? <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>${r.cost.toLocaleString()}</span> : null}
                                      {/* View PDF */}
                                      {r.fileUrl && (
                                        <a href={r.fileUrl} target="_blank" rel="noopener noreferrer"
                                          style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: C.accent, textDecoration: "none", padding: "2px 8px", borderRadius: 6, background: "#eff6ff", border: `1px solid ${C.accent}30` }}>
                                          <FileText size={10}/> PDF
                                        </a>
                                      )}
                                      {/* Delete */}
                                      <button onClick={() => deleteRepairDoc(r)} title="Remove this repair record"
                                        style={{ display: "inline-flex", alignItems: "center", padding: "2px 4px", borderRadius: 5, background: "transparent", border: "none", cursor: "pointer", color: C.text3 }}
                                        onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                                        onMouseLeave={e => (e.currentTarget.style.color = C.text3)}>
                                        <X size={12}/>
                                      </button>
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
                            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${docLoading ? C.accent : C.border}`, background: docLoading ? C.accentBg : C.bg }}>
                              {docLoading ? <><Loader2 size={20} color={C.accent} className="animate-spin"/><span style={{ fontSize: 14, color: C.accent }}>Uploading…</span></> : <><CloudUpload size={20} color={C.text3}/><span style={{ fontSize: 14, color: C.text }}>Click to upload file</span></>}
                              <input ref={docRef} type="file" style={{ display: "none" }} onChange={uploadDoc} disabled={docLoading} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"/>
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

              {/* ── Profile Name ── */}
              <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: "20px 22px" }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16, marginTop: 0 }}>Your Profile</p>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 5 }}>First Name</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    placeholder="Your first name"
                    style={{ flex: 1, padding: "9px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 16, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" as const }}
                  />
                  <button
                    onClick={saveProfileName}
                    disabled={savingName || !profileName.trim()}
                    style={{ padding: "9px 18px", borderRadius: 10, background: nameSaved ? C.green : C.accent, border: "none", color: "white", fontSize: 14, fontWeight: 700, cursor: profileName.trim() ? "pointer" : "not-allowed", opacity: savingName ? 0.7 : 1, whiteSpace: "nowrap" as const, display: "flex", alignItems: "center", gap: 6 }}>
                    {savingName ? <><Loader2 size={13}/> Saving…</> : nameSaved ? <><CheckCircle2 size={13}/> Saved!</> : "Save Name"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: C.text3, margin: "6px 0 0" }}>This is how we greet you on the dashboard.</p>
              </div>

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

            {/* ── GREETING HEADER ──────────────────────────────────── */}
            {(() => {
              const hour = new Date().getHours();
              const tod  = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
              // Prefer name from auth metadata (set at signup), fall back to email prefix
              const metaName: string = (user as any)?.user_metadata?.first_name
                || (user as any)?.user_metadata?.full_name?.split(" ")[0]
                || "";
              const emailName = user?.email
                ? user.email.split("@")[0].replace(/[._+-].*/, "").replace(/^(.)/, c => c.toUpperCase())
                : "";
              const firstName = metaName || emailName;
              const shortAddr = address && address !== "My Home"
                ? toTitleCase(address).split(",")[0]
                : null;
              // Guard against null / invalid inspection_date values
              const rawInspDate = inspectionResult?.inspection_date;
              const parsedInspDate = rawInspDate ? new Date(rawInspDate + "T12:00:00") : null;
              const validInspDate = parsedInspDate && !isNaN(parsedInspDate.getTime()) ? parsedInspDate : null;
              const lastUpd = validInspDate
                ? `Last updated ${validInspDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : inspectDone ? "Last updated recently" : "Add your home data to get started";
              return (
                <div style={{ background: customTheme.bgImage ? `url(${customTheme.bgImage}) center/cover no-repeat` : themeNavy, borderRadius: 16, padding: isMobile ? "18px 20px" : "22px 28px", position: "relative", overflow: "hidden" }}>
                  {customTheme.bgImage && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.50)", borderRadius: 16, pointerEvents: "none" }}/>}
                  <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div>
                      <p style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: "white", margin: "0 0 4px", letterSpacing: "-0.3px" }}>
                        Good {tod}{firstName ? <>, <strong>{firstName}.</strong></> : "."}
                      </p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                        {shortAddr ?? "Your Home"}{" · "}{lastUpd}
                      </p>
                    </div>
                    {/* Customize button */}
                    <button onClick={e => { e.stopPropagation(); setDraftAccent(customTheme.accent ?? C.accent); setDraftNavy(customTheme.navy ?? C.navy); setDraftBgImg(customTheme.bgImage ?? ""); setShowCustomize(true); }}
                      style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(4px)" }}>
                      <Settings size={12}/> Customize
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ── PRIORITY ACTION STRIP ─────────────────────────────── */}
            {(() => {
              const criticals = activeFindings.filter(f => f.severity === "critical");
              const warnings  = activeFindings.filter(f => f.severity === "warning");

              let strip: {
                icon: React.ReactNode;
                label: string;
                detail: string;
                ctaLabel: string;
                color: string;
                bg: string;
                border: string;
                action: () => void;
                secondary?: { label: string; action: () => void };
              } | null = null;

              if (criticals.length > 0) {
                const top = criticals[0];
                const trade = tradeForCategory(top.system ?? top.category ?? "");
                strip = {
                  icon: <AlertTriangle size={15} color={C.red}/>,
                  label: `${criticals.length} critical issue${criticals.length > 1 ? "s" : ""} need${criticals.length === 1 ? "s" : ""} attention`,
                  detail: top.title || top.description?.slice(0, 80) || categoryLabel(top.category),
                  ctaLabel: `Find a ${trade}`,
                  color: C.red, bg: C.redBg, border: `${C.red}30`,
                  action: () => handleFindVendors(top.category, top.category, top.description),
                  secondary: { label: "View Repairs", action: () => setNav("Repairs") },
                };
              } else if (warnings.length > 0) {
                const top = warnings[0];
                const trade = tradeForCategory(top.system ?? top.category ?? "");
                strip = {
                  icon: <AlertTriangle size={15} color={C.amber}/>,
                  label: `${warnings.length} item${warnings.length > 1 ? "s" : ""} to monitor`,
                  detail: top.title || top.description?.slice(0, 80) || categoryLabel(top.category),
                  ctaLabel: `Find a ${trade}`,
                  color: C.amber, bg: C.amberBg, border: `${C.amber}30`,
                  action: () => handleFindVendors(top.category, top.category, top.description),
                  secondary: { label: "View Repairs", action: () => setNav("Repairs") },
                };
              } else if (!inspectDone) {
                strip = {
                  icon: <CloudUpload size={15} color={C.accent}/>,
                  label: "Upload your inspection report to get started",
                  detail: "Get your Home Health Score and a personalized repair plan",
                  ctaLabel: "Upload Report",
                  color: C.accent, bg: C.accentBg, border: `${C.accent}30`,
                  action: () => inspRef.current?.click(),
                };
              }

              if (!strip) return null;
              return (
                <div style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: 14, background: strip.bg, border: `1px solid ${strip.border}`,
                  flexWrap: isMobile ? "wrap" : "nowrap",
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${strip.color}15`,
                    border: `1px solid ${strip.color}25`, display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0 }}>
                    {strip.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: strip.color, margin: "0 0 2px" }}>{strip.label}</p>
                    <p style={{ fontSize: 12, color: C.text3, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{strip.detail}</p>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexShrink: 0, flexWrap: "wrap" }}>
                    {strip.secondary && (
                      <button onClick={strip.secondary.action}
                        style={{ fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 9,
                          background: "white", border: `1px solid ${C.border}`, color: C.text2, cursor: "pointer" }}>
                        {strip.secondary.label}
                      </button>
                    )}
                    <button onClick={strip.action}
                      style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 9,
                        background: strip.color, border: "none", color: "white", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5 }}>
                      {strip.ctaLabel} <ChevronRight size={12}/>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ── TOP TWO-COLUMN LAYOUT ─────────────────────────────── */}
            <div style={{ display: isMobile ? "flex" : "grid", flexDirection: "column",
              gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>

            {/* LEFT: Health Score Card */}
            {(inspectDone || roofYear || hvacYear) ? (
              <div
                onClick={() => setShowHealthModal(true)}
                style={{ ...card(), cursor: "pointer", transition: "box-shadow 0.18s" }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 24px rgba(28,43,58,0.13)"; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = ""; }}
              >
                {/* Top section: ring + info + breakdown button */}
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 18 : 24 }}>
                  {/* Score Ring */}
                  <ScoreRing score={health} color={healthColor} size={isMobile ? 110 : 130} textColor={C.text} trackColor={C.border} disableGlow />
                  {/* Main content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 4px" }}>Home Health Score</p>
                    <p style={{ fontSize: 28, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", margin: "0 0 6px", lineHeight: 1.1 }}>{healthSt.label}</p>
                    <p style={{ fontSize: 13, color: C.text3, margin: "0 0 14px", lineHeight: 1.5 }}>{healthSt.desc}</p>
                    {/* Condition badges */}
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {criticalCount > 0 ? (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
                          background: "rgba(232,116,42,0.10)", color: C.accent, border: `1px solid rgba(232,116,42,0.25)` }}>
                          {criticalCount} Item{criticalCount !== 1 ? "s" : ""} Need{criticalCount === 1 ? "s" : ""} Attention
                        </span>
                      ) : breakdown.deductions.length > 0 ? (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
                          background: `${C.amber}14`, color: C.amber, border: `1px solid ${C.amber}40` }}>
                          {breakdown.deductions.length} item{breakdown.deductions.length > 1 ? "s" : ""} to monitor
                        </span>
                      ) : null}
                      {extCondition.label && (() => {
                        const mod = extCondition.modifier;
                        const clr = mod >= 4 ? C.green : mod > 0 ? "#4d7c0f" : mod < 0 ? C.red : C.text3;
                        const bg  = mod >= 4 ? C.greenBg : mod > 0 ? "#f7fee7" : mod < 0 ? C.redBg : C.surface2;
                        const br  = mod >= 4 ? `${C.green}40` : mod > 0 ? "#4d7c0f40" : mod < 0 ? `${C.red}40` : C.border;
                        return (
                          <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: bg, color: clr, border: `1px solid ${br}`, whiteSpace: "nowrap" }}>
                            Condition: {extCondition.label}
                          </span>
                        );
                      })()}
                      {userTier === "pro" && inspectionSource === "professional" &&
                       (homeHealthReport?.decay?.label === "Fresh" || homeHealthReport?.decay?.label === "Current") && (
                        <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 5,
                          background: C.greenBg, color: C.green, border: `1px solid ${C.green}40`, whiteSpace: "nowrap" }}>
                          <Shield size={11}/> Professionally Verified
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Full Breakdown button — right side, desktop only */}
                  {!isMobile && (
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 12,
                        background: C.surface, border: `1px solid ${C.border}`,
                        color: C.text, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                        boxShadow: "0 1px 4px rgba(28,25,20,0.06)" }}>
                        <ChevronRight size={14} color={C.text2}/>
                        Full Breakdown
                      </div>
                      <span style={{ fontSize: 11, color: C.text3 }}>
                        {(() => {
                          const d = inspectionResult?.inspection_date ? new Date(inspectionResult.inspection_date + "T12:00:00") : null;
                          return d && !isNaN(d.getTime())
                            ? `Last updated ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : "Last updated recently";
                        })()}
                      </span>
                    </div>
                  )}
                </div>
                {/* Mobile: Full Breakdown inline */}
                {isMobile && (
                  <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10,
                    background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontWeight: 600 }}>
                    <ChevronRight size={13} color={C.text2}/>
                    Full Breakdown
                  </div>
                )}

                {/* SYSTEM OVERVIEW */}
                {homeHealthReport?.category_scores && homeHealthReport.category_scores.some(cs => !cs.not_assessed) && (() => {
                  const CAT_LABELS: Record<string,string> = {
                    structure_foundation: "Foundation", roof_drainage_exterior: "Roof",
                    electrical: "Electrical", plumbing: "Plumbing", hvac: "HVAC",
                    appliances_water_heater: "Appliances", safety_environmental: "Safety",
                  };
                  // Per-category bar colors matching the screenshot
                  const CAT_COLORS: Record<string,string> = {
                    structure_foundation: "#3b82f6",
                    roof_drainage_exterior: C.accent,
                    electrical: C.green,
                    plumbing: "#b45309",
                    hvac: "#0d9488",
                    appliances_water_heater: "#7c3aed",
                    safety_environmental: C.red,
                  };
                  const scored = homeHealthReport.category_scores.filter(cs => !cs.not_assessed);
                  return (
                    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 22, paddingTop: 18 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 16px" }}>System Overview</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {scored.map(cs => {
                          const barColor = CAT_COLORS[cs.category] ?? C.accent;
                          return (
                            <div key={cs.category} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontSize: 13, color: C.text2, width: 88, flexShrink: 0 }}>{CAT_LABELS[cs.category] ?? cs.category}</span>
                              <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.surface2, overflow: "hidden" }}>
                                <div style={{ height: "100%", borderRadius: 4, background: barColor, width: `${cs.score}%`, transition: "width 0.8s ease" }}/>
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 800, color: C.text, width: 28, textAlign: "right", flexShrink: 0 }}>{cs.score}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
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

                {/* Circle icon / spinner — matches filled ring size */}
                <div style={{ width: isMobile ? 130 : 160, height: isMobile ? 130 : 160, borderRadius: "50%",
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
                      <p style={{ fontSize: 28, fontWeight: 800, color: "rgba(255,255,255,0.75)", margin: "0 0 6px" }}>
                        {inspectStage === "uploading" ? "Uploading PDF…" : inspectStage === "saving" ? "Saving findings…" : "Analyzing report…"}
                      </p>
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "0 0 18px" }}>
                        {inspectStage === "uploading" ? "Sending your PDF — this may take a moment for large files." : inspectStage === "saving" ? "Writing findings to your home record." : inspectIsLargeFile ? "Large report detected — reading every page thoroughly. This can take up to 2 minutes." : "Reading your inspection findings, systems, and estimated costs. This takes about 30 seconds."}
                      </p>
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
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: "0 0 16px" }}>Upload an inspection report, take photos, or enter your roof & HVAC years to get your score.</p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button onClick={() => inspRef.current?.click()}
                          style={{ padding: "9px 18px", borderRadius: 10, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          <Upload size={13}/> Upload Inspection
                        </button>
                        <button onClick={() => photoRef.current?.click()} disabled={photoAnalyzing}
                          style={{ padding: "9px 16px", borderRadius: 10, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600, cursor: photoAnalyzing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          {photoAnalyzing ? <><Loader2 size={13} className="animate-spin"/> Analyzing…</> : <><Camera size={13}/> Take / Upload Photos</>}
                        </button>
                        <button onClick={() => { setSelfInspectStep(0); setSelfInspectAnswers({}); setShowSelfInspectModal(true); }}
                          style={{ padding: "9px 14px", borderRadius: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          Self-Inspection
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

            {/* RIGHT: Upcoming Maintenance ─────────────────────────── */}
            {(() => {
              const todayMs2 = Date.now();
              const DASH_TASKS = [
                { id: "hvac_filter",    label: "HVAC Filter",      sub: "Replace filter",        freqDays: 30,  dot: "#ef4444" },
                { id: "smoke_detector", label: "Smoke Detectors",  sub: "Test all units",        freqDays: 91,  dot: "#f59e0b" },
                { id: "gutter_clean",   label: "Clean Gutters",    sub: "Downspouts & debris",   freqDays: 182, dot: "#3b82f6" },
                { id: "hvac_tune",      label: "HVAC Tune-Up",     sub: "Schedule service",      freqDays: 182, dot: "#8b5cf6" },
                { id: "roof_inspect",   label: "Roof Inspection",  sub: "Check for damage",      freqDays: 365, dot: C.green   },
              ];
              const hasHistory = Object.keys(maintCompletions).length > 0;
              const items = DASH_TASKS.map(t => {
                const lastDone = maintCompletions[t.id];
                let daysUntilNext = 0;
                let nextDueDate: Date | null = null;
                if (lastDone) {
                  const lastMs = new Date(lastDone).getTime();
                  const daysSince = (todayMs2 - lastMs) / 86400000;
                  daysUntilNext = t.freqDays - daysSince;
                  nextDueDate = new Date(lastMs + t.freqDays * 86400000);
                }
                let status: "overdue" | "due-soon" | "scheduled" | "done" | "upcoming" = "upcoming";
                if (lastDone) {
                  if (daysUntilNext < 0) status = "overdue";
                  else if (daysUntilNext <= 14) status = "due-soon";
                  else status = "done";
                } else if (hasHistory) {
                  status = "overdue";
                }
                return { ...t, status, nextDueDate, daysUntilNext };
              }).sort((a, b) => {
                const o: Record<string,number> = { overdue: 0, "due-soon": 1, scheduled: 2, done: 3 };
                return o[a.status] - o[b.status];
              }).slice(0, 4);
              const urgentCount = items.filter(i => i.status === "overdue" || i.status === "due-soon").length;
              return (
                <div style={{ ...card() }}>
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>Upcoming Maintenance</p>
                    {urgentCount > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                        background: `${C.accent}15`, color: C.accent, border: `1px solid ${C.accent}35` }}>
                        {urgentCount} Due Soon
                      </span>
                    )}
                  </div>
                  {/* Task list */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {items.map((t, idx) => {
                      const stBadge =
                        t.status === "overdue"   ? { label: "Overdue",   bg: C.redBg,   color: C.red,     border: `${C.red}40` } :
                        t.status === "due-soon"  ? { label: "Due Soon",  bg: C.amberBg, color: C.amber,   border: `${C.amber}40` } :
                        t.status === "done"      ? { label: "Booked",    bg: C.greenBg, color: C.green,   border: `${C.green}40` } :
                        t.status === "upcoming"  ? { label: "Planned",   bg: C.surface2, color: C.text3,  border: C.border } :
                                                   { label: "Scheduled", bg: "#eff6ff",  color: "#2563eb", border: "#bfdbfe" };
                      return (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0",
                          borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.dot, flexShrink: 0 }}/>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>{t.label}</p>
                            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>{t.sub}</p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            {t.nextDueDate && (
                              <p style={{ fontSize: 11, color: C.text3, margin: "0 0 4px" }}>
                                {t.nextDueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </p>
                            )}
                            {(t.status === "overdue" || t.status === "due-soon") ? (
                              <button
                                onClick={e => { e.stopPropagation(); const WTRADE: Record<string,string> = { hvac_filter:"HVAC", hvac_tune:"HVAC", smoke_detector:"General Contractor", gutter_clean:"Roofing", roof_inspect:"Roofing" }; handleFindVendors(WTRADE[t.id] ?? "General Contractor", t.label, t.sub); }}
                                style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 9,
                                  background: C.accent, border: "none", color: "white", cursor: "pointer",
                                  display: "flex", alignItems: "center", gap: 3 }}>
                                <Users size={10}/> Schedule
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10,
                                background: stBadge.bg, color: stBadge.color, border: `1px solid ${stBadge.border}` }}>
                                {stBadge.label}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Footer CTA */}
                  <button onClick={() => setNav("Maintenance")}
                    style={{ width: "100%", marginTop: 16, padding: "10px", borderRadius: 10,
                      background: "white", border: `1px solid ${C.border}`, color: C.text2,
                      fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    View All Maintenance
                  </button>
                </div>
              );
            })()}

            </div>{/* /two-column grid */}

            {/* Hidden inspection upload input (Dashboard) */}
            <input ref={inspRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>

            {/* ── Renewal prompt banner — shown when inspection data is aging/stale/expired ── */}
            {inspectDone && homeHealthReport?.decay?.label && ["Aging", "Stale", "Expired"].includes(homeHealthReport.decay.label) && (
              <div style={{ borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                background: userTier === "pro" ? "rgba(44,95,138,0.08)" : "rgba(234,179,8,0.10)",
                border: `1px solid ${userTier === "pro" ? "rgba(44,95,138,0.2)" : "rgba(234,179,8,0.3)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Clock size={16} color={userTier === "pro" ? C.accent : C.amber}/>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: userTier === "pro" ? C.accent : C.amber, margin: "0 0 1px" }}>
                      {userTier === "pro" ? "Time for your annual professional inspection" : "Update your home's health score"}
                    </p>
                    <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>
                      {userTier === "pro"
                        ? `Last inspection is ${homeHealthReport.decay.label.toLowerCase()} — schedule with a certified BTLR inspector to stay verified`
                        : (() => {
                            const d = inspectionResult?.inspection_date ? new Date(inspectionResult.inspection_date + "T12:00:00") : null;
                            const validD = d && !isNaN(d.getTime()) ? d : null;
                            return validD
                              ? `Last inspected ${validD.toLocaleDateString("en-US", { month: "long", year: "numeric" })} — answer a quick 7-step check-in to refresh your score`
                              : "Answer a quick 7-step check-in to refresh your score";
                          })()}
                    </p>
                  </div>
                </div>
                {userTier === "pro" ? (
                  <button onClick={() => setNav("Vendors")} style={{ padding: "8px 16px", borderRadius: 10, background: C.accent, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                    Find an Inspector
                  </button>
                ) : (
                  <button onClick={() => { setSelfInspectStep(0); setSelfInspectAnswers({}); setShowSelfInspectModal(true); }} style={{ padding: "8px 16px", borderRadius: 10, background: C.amber, border: "none", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                    Start Check-In
                  </button>
                )}
              </div>
            )}

            {/* ── AI BUTLER ─────────────────────────────────────────── */}
            <div style={{ ...card(), background: C.surface, border: `1px solid ${C.border}`, padding: 0, overflow: "hidden" }}>

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
                                  {action.type === "tel"           && <Phone size={11}/>}
                                  {action.type === "email"         && <Mail size={11}/>}
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

            {/* ── Property Card ─────────────────────────────────────── */}
            <div style={{ ...card(), padding: 0, overflow: "hidden" }}>
              {/* Label row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 0" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text3 }}>Your Property</span>
                {address && address !== "My Home" && (
                  <span style={{ fontSize: 11, color: C.text3, display: "flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={10}/>{toTitleCase(address).split(",")[0]}
                  </span>
                )}
              </div>
              <div style={{ padding: "10px 14px 14px" }}>
                <HousePhoto address={toTitleCase(address)} height={isMobile ? 110 : 140} />
              </div>
            </div>

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
                const dueDateLabel = dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div style={{ borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #1C2B3A 0%, #2A3E54 100%)", boxShadow: "0 1px 4px rgba(15,31,61,0.10)" }}>
                    {/* Dark header */}
                    <div style={{ padding: "20px 22px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <HomeIcon size={15} color="rgba(255,255,255,0.8)"/>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>Mortgage</p>
                          {mortgage?.lender && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>{mortgage.lender}</p>}
                        </div>
                      </div>
                      <button onClick={() => setShowMortgageForm(f => !f)} style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                        {showMortgageForm ? "Cancel" : mortgage ? "Edit" : "Add"}
                      </button>
                    </div>
                    {mortgage && !showMortgageForm ? (
                      <>
                        <p style={{ fontSize: 32, fontWeight: 800, color: "white", letterSpacing: "-0.8px", margin: "0 0 4px", lineHeight: 1 }}>
                          ${mortgage.payment?.toLocaleString() ?? mortgage.balance?.toLocaleString() ?? "—"}
                          {mortgage.payment && <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>/mo</span>}
                        </p>
                        {mortgage.due_day ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20,
                            background: isUrgent ? "rgba(251,191,36,0.22)" : "rgba(255,255,255,0.1)",
                            border: `1px solid ${isUrgent ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.18)"}` }}>
                            <Clock size={11} color={isUrgent ? "#fbbf24" : "rgba(255,255,255,0.55)"}/>
                            <span style={{ fontSize: 12, fontWeight: 700, color: isUrgent ? "#fbbf24" : "rgba(255,255,255,0.7)" }}>
                              Due {dueDateLabel}{isUrgent ? ` — ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}` : ""}
                            </span>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    </div>{/* /dark header */}
                    {/* White detail section */}
                    <div style={{ background: "white", padding: "16px 22px 20px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    {mortgage && !showMortgageForm ? (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
                          {mortgage.rate && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12, color: C.text3 }}>Rate</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{(mortgage.rate * 100).toFixed(3)}% fixed</span>
                            </div>
                          )}
                          {mortgage.balance && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12, color: C.text3 }}>Remaining</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>${mortgage.balance.toLocaleString()}</span>
                            </div>
                          )}
                          {mortgage.payment && mortgage.due_day && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12, color: C.text3 }}>Next payment</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>${mortgage.payment.toLocaleString()} · {dueDateLabel}</span>
                            </div>
                          )}
                        </div>
                        <button style={{ width: "100%", padding: "11px", borderRadius: 10, background: "linear-gradient(135deg, #1C2B3A 0%, #2A3E54 100%)", border: "1px solid rgba(255,255,255,0.08)", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" }}>
                          Make Payment
                        </button>
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
                          <button onClick={() => { scanningDocRef.current = "mortgage"; setScanningDoc("mortgage"); scanDocRef.current?.click(); }} disabled={!!scanningDoc} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, fontWeight: 600, color: C.text2, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                            <Camera size={11}/>{scanningDoc === "mortgage" ? "…" : "Scan"}
                          </button>
                        </div>
                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                          <button onClick={connectPlaid} disabled={connectingPlaid} style={{ width: "100%", padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text2, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: connectingPlaid ? 0.6 : 1 }}>
                            {connectingPlaid ? <><Loader2 size={12} className="animate-spin"/>Connecting…</> : <><LinkIcon size={12}/>Connect Bank</>}
                          </button>
                        </div>
                      </div>
                    )}
                    </div>{/* /white detail */}
                  </div>
                );
              })()}

              {/* Insurance */}
              <div style={{ borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #0c5460 0%, #0f766e 60%, #0d9488 100%)", boxShadow: "0 1px 4px rgba(15,31,61,0.10)" }}>
                {/* Dark header */}
                <div style={{ padding: "20px 22px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Shield size={15} color="rgba(255,255,255,0.9)"/>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Home Insurance</span>
                      {insurance?.provider && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: 0 }}>{insurance.provider}{insurance.policyType ? ` · ${insurance.policyType}` : ""}</p>}
                    </div>
                  </div>
                  {insurance && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Plus size={10}/>}
                        {parsingInsurance ? "…" : "Add"}
                        <input key={`add-${insuranceFileKey}`} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={addSecondaryPolicy} disabled={parsingInsurance}/>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                        {parsingInsurance ? "…" : "Replace"}
                        <input key={`rep-${insuranceFileKey}`} type="file" accept=".pdf,.txt" multiple style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                      </label>
                      <button onClick={deleteInsurance} title="Remove insurance record" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,100,100,0.8)", fontSize: 11, fontWeight: 600, cursor: "pointer", background: "transparent" }}>
                        <Trash2 size={10}/>
                      </button>
                    </div>
                  )}
                </div>
                {insurance ? (
                  <>
                    <p style={{ fontSize: 32, fontWeight: 800, color: "white", letterSpacing: "-0.8px", margin: "0 0 4px", lineHeight: 1 }}>
                      ${((insurance.annualPremium ?? insurance.premium) ?? 0).toLocaleString()}
                      <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>/yr</span>
                    </p>
                    {insurance.expirationDate && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)" }}>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>✓ Active · Renews {insurance.expirationDate}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.4)", margin: 0 }}>No policy on file</p>
                )}
                </div>{/* /dark header */}
                {/* White detail section */}
                <div style={{ background: "white", padding: "16px 22px 20px" }}>
                {insurance ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
                      {insurance.policyNumber && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>Policy #</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "monospace" }}>{insurance.policyNumber}</span>
                        </div>
                      )}
                      {insurance.dwellingCoverage && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>Coverage</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{insurance.policyType ?? "Fire, Wind, Hail"}</span>
                        </div>
                      )}
                      {insurance.deductibleStandard && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>Deductible</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>${insurance.deductibleStandard.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => {
                        const rawIns = insurance.claimUrl;
                        const url = rawIns ? (rawIns.startsWith("http") ? rawIns : `https://${rawIns}`) : null;
                        const phone = insurance.claimPhone;
                        const email = insurance.claimEmail;
                        if (url) { window.open(url, "_blank"); return; }
                        if (phone) { window.location.href = `tel:${phone.replace(/\D/g, "")}`; return; }
                        if (email) { window.location.href = `mailto:${email}`; return; }
                        showToast("Upload your declarations page to extract the claims contact", "info");
                      }} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "#0f766e", border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        File Claim
                      </button>
                      <button onClick={() => setShowInsuranceDetail(d => !d)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "transparent", border: "1.5px solid #0f766e", color: "#0f766e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        {showInsuranceDetail ? "Hide Details" : "Details"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #0f766e", background: "transparent", color: "#0f766e", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                        {parsingInsurance ? "Parsing…" : "Upload Policy PDF"}
                        <input ref={insuranceRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                      </label>
                      <button onClick={() => { scanningDocRef.current = "insurance"; setScanningDoc("insurance"); scanDocRef.current?.click(); }} disabled={!!scanningDoc} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #0f766e", background: "transparent", color: "#0f766e", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        <Camera size={11}/> {scanningDoc === "insurance" ? "Scanning…" : "Scan Pages"}
                      </button>
                    </div>
                    {insuranceError && <p style={{ fontSize: 11, color: C.red, margin: "8px 0 0", lineHeight: 1.4 }}>⚠ {insuranceError}</p>}
                  </>
                )}
                </div>{/* /white detail */}

                {/* Additional / stacked policies (e.g. CA FAIR Plan + DIC) */}
                {(insurance?.additionalPolicies ?? []).map((ap, i) => (
                  <div key={i} style={{ borderTop: `1px solid #e2e8f0`, padding: "14px 22px", background: "white" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                          {ap.provider ?? "Additional Policy"}
                          {ap.policyType ? ` · ${ap.policyType}` : ""}
                        </span>
                        {ap.policyNumber && (
                          <span style={{ fontSize: 11, color: C.text2, marginLeft: 8, fontFamily: "monospace" }}>#{ap.policyNumber}</span>
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
                    {(() => {
                      const apPremium = ap.annualPremium ?? ap.premium;
                      const apRenewal = ap.expirationDate ?? ap.renewalDate;
                      const hasInfo = apPremium != null || !!apRenewal;
                      return (
                        <>
                          {hasInfo ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: ap.claimPhone || ap.claimUrl ? 10 : 0 }}>
                              {apPremium != null && (
                                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}>
                                  <div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Premium</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>${typeof apPremium === "number" ? apPremium.toLocaleString() : apPremium}<span style={{ fontSize: 10, color: C.text3 }}>/yr</span></div>
                                </div>
                              )}
                              {apRenewal && (
                                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "5px 10px" }}>
                                  <div style={{ fontSize: 9, color: "#0891b2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Renews</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{apRenewal}</div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p style={{ fontSize: 12, color: C.text2, margin: "0 0 8px" }}>No details parsed — upload a declarations page for coverage info.</p>
                          )}
                          {(ap.claimPhone || ap.claimUrl) && (
                            <button onClick={() => {
                              if (ap.claimUrl) window.open(ap.claimUrl);
                              else if (ap.claimPhone) window.location.href = `tel:${ap.claimPhone.replace(/\D/g, "")}`;
                            }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: C.navy, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                              File Claim
                            </button>
                          )}
                        </>
                      );
                    })()}
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
                          <span style={{ fontSize: 12, color: "#0891b2", alignSelf: "center" }}>{insurance.claimHours}</span>
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
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Covered ({insurance.coverageItems!.length})</p>
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
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Endorsements / Riders ({insurance.endorsements!.length})</p>
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
                        <p style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Excluded ({insurance.exclusions!.length})</p>
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
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Your Agent</p>
                        {insurance.agentName  && <p style={{ fontSize: 13, color: C.text, margin: "0 0 2px" }}>{insurance.agentName}</p>}
                        {insurance.agentPhone && <a href={`tel:${insurance.agentPhone.replace(/\D/g, "")}`} style={{ fontSize: 13, color: "#0891b2", display: "flex", alignItems: "center", gap: 5, textDecoration: "none", margin: "0 0 2px" }}><Phone size={12}/> {insurance.agentPhone}</a>}
                        {insurance.agentEmail && <a href={`mailto:${insurance.agentEmail}`} style={{ fontSize: 13, color: "#0891b2", display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}><Mail size={12}/> {insurance.agentEmail}</a>}
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>

              {/* Home Warranty */}
              <div style={{ borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #4c1d95 0%, #6d28d9 50%, #7c3aed 100%)", boxShadow: "0 1px 4px rgba(15,31,61,0.10)" }}>
                {/* Dark header */}
                <div style={{ padding: "20px 22px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Shield size={15} color="rgba(255,255,255,0.9)"/>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Home Warranty</span>
                      {warranty?.provider && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: 0 }}>{warranty.provider}{warranty.planName ? ` · ${warranty.planName}` : ""}</p>}
                    </div>
                  </div>
                  {warranty && (
                    <button onClick={deleteWarranty} title="Remove warranty record" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,100,100,0.8)", fontSize: 11, fontWeight: 600, cursor: "pointer", background: "transparent" }}>
                      <Trash2 size={10}/>
                    </button>
                  )}
                </div>
                {warranty ? (
                  <>
                    {warranty.expirationDate && (() => {
                      const days = Math.round((new Date(warranty.expirationDate).getTime() - Date.now()) / 86400000);
                      const isExpiringSoon = days <= 60;
                      const expLabel = new Date(warranty.expirationDate).toLocaleDateString("en-US", { month: "short", year: "numeric" });
                      return (
                        <>
                          <p style={{ fontSize: 36, fontWeight: 800, color: "white", letterSpacing: "-1px", margin: "0 0 8px", lineHeight: 1 }}>
                            Expires {expLabel}
                          </p>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20,
                            background: isExpiringSoon ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.1)",
                            border: `1px solid ${isExpiringSoon ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.15)"}` }}>
                            <span style={{ fontSize: 12, color: isExpiringSoon ? "#fbbf24" : "rgba(255,255,255,0.6)" }}>
                              {isExpiringSoon ? "⚠ Renewal needed soon" : `${Math.round(days / 30)} months remaining`}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                    {!warranty.expirationDate && (
                      <p style={{ fontSize: 20, fontWeight: 700, color: "white", margin: 0 }}>{warranty.planName ?? "Active"}</p>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.4)", margin: 0 }}>No warranty on file</p>
                )}
                </div>{/* /dark header */}
                {/* White detail section */}
                <div style={{ background: "white", padding: "16px 22px 20px" }}>
                {warranty ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
                      {warranty.planName && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>Plan</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{warranty.planName}</span>
                        </div>
                      )}
                      {(warranty.coverageItems?.length ?? 0) > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 12, color: C.text3, flexShrink: 0 }}>Covers</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, textAlign: "right" }}>{warranty.coverageItems!.slice(0, 3).join(", ")}{warranty.coverageItems!.length > 3 ? ` +${warranty.coverageItems!.length - 3} more` : ""}</span>
                        </div>
                      )}
                      {warranty.serviceFee && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: C.text3 }}>Service fee</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>${warranty.serviceFee}/claim</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {warranty.claimUrl && (
                        <a href={warranty.claimUrl.startsWith("http") ? warranty.claimUrl : `https://${warranty.claimUrl}`} target="_blank" rel="noopener noreferrer"
                          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "#7c3aed", border: "none", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none", cursor: "pointer" }}>
                          <RefreshCw size={12}/> Renew
                        </a>
                      )}
                      <button onClick={() => {
                        const raw = warranty.claimUrl;
                        const url = raw ? (raw.startsWith("http") ? raw : `https://${raw}`) : null;
                        const phone = warranty.claimPhone;
                        if (url) { window.open(url, "_blank"); return; }
                        if (phone) { window.location.href = `tel:${phone.replace(/\D/g, "")}`; return; }
                        showToast("Upload your warranty document to extract the claims contact", "info");
                      }} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", borderRadius: 9, background: "transparent", border: "1.5px solid #7c3aed", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        File Claim
                      </button>
                    </div>
                    <button onClick={() => setShowWarrantyDetail(d => !d)} style={{ width: "100%", marginTop: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 12px", borderRadius: 9, background: "transparent", border: `1px solid ${C.border}`, color: C.text3, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      {showWarrantyDetail ? "Less" : "More Details"}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {parsingWarranty ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                        {parsingWarranty ? "Parsing…" : "Upload Warranty PDF"}
                        <input ref={warrantyRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                      </label>
                      <button onClick={() => { scanningDocRef.current = "warranty"; setScanningDoc("warranty"); scanDocRef.current?.click(); }} disabled={!!scanningDoc} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, border: "1.5px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        <Camera size={11}/> {scanningDoc === "warranty" ? "Scanning…" : "Scan Pages"}
                      </button>
                    </div>
                    {warrantyError && <p style={{ fontSize: 11, color: C.red, margin: "8px 0 0", lineHeight: 1.4 }}>⚠ {warrantyError}</p>}
                  </>
                )}
                </div>{/* /white detail */}
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
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 9, border: "1.5px solid #e9d5ff", color: "#7c3aed", fontSize: 13, fontWeight: 700, textDecoration: "none", background: "white" }}>
                          <Phone size={13}/> {warranty.claimPhone}
                        </a>
                      )}
                    </div>
                  )}

                  {/* Key info row */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {warranty.serviceFee     && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}><strong>${warranty.serviceFee}</strong> service fee/claim</span>}
                    {warranty.responseTime   && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>{warranty.responseTime} response</span>}
                    {warranty.maxAnnualBenefit != null && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>Max ${typeof warranty.maxAnnualBenefit === "number" ? warranty.maxAnnualBenefit.toLocaleString() : String(warranty.maxAnnualBenefit)}/yr</span>}
                    {warranty.paymentAmount  && <span style={{ fontSize: 12, background: "white", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 9px", color: "#6d28d9" }}>${warranty.paymentAmount}/{warranty.paymentFrequency ?? "mo"}</span>}
                  </div>

                  {/* Coverage */}
                  {(warranty.coverageItems?.length ?? 0) > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Covered</p>
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
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Excluded</p>
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
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Coverage Limits</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {Object.entries(warranty.coverageLimits).map(([sys, limit]) => {
                          const val = limit == null ? "" : typeof limit === "number" ? `$${limit.toLocaleString()}` : String(limit);
                          return (
                            <span key={sys} style={{ fontSize: 12, background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 6, padding: "3px 9px", color: C.amber }}>{sys}{val ? `: ${val}` : ""}</span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* ── REPAIR FUND CARD ─────────────────────────────────── */}
            <div style={{ ...card({ padding: 0, overflow: "hidden" }), border: `1px solid ${C.border}` }}>

              {/* Dark header strip */}
              <div style={{ background: "linear-gradient(135deg, #134e4a 0%, #0f766e 60%, #0d9488 100%)", padding: "20px 24px" }}>
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
                        <button onClick={connectPlaid} disabled={connectingPlaid}
                          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${C.accent}`, background: C.accent, color: "white", fontSize: 13, fontWeight: 700, cursor: connectingPlaid ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: connectingPlaid ? 0.7 : 1 }}>
                          {connectingPlaid ? <><Loader2 size={13} className="animate-spin"/>Connecting…</> : <><LinkIcon size={13}/>Connect via Plaid</>}
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
                      <p style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Start Here</p>
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
          boxShadow: "0 -4px 20px rgba(15,31,61,0.3)",
        }}>
          {navItems.map(({ label, icon, badge }) => (
            <button key={label} onClick={() => setNav(label)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 3, padding: "10px 4px 8px", border: "none", cursor: "pointer",
              background: "transparent",
              color: nav === label ? "white" : "rgba(255,255,255,0.38)",
              fontSize: 10, fontWeight: nav === label ? 700 : 400, position: "relative",
              borderTop: nav === label ? `2px solid ${C.accentLt}` : "2px solid transparent",
            }}>
              {icon}
              <span>{label}</span>
              {badge ? <span style={{ position: "absolute", top: 6, right: "calc(50% - 14px)", background: C.red, color: "white", fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 99 }}>{badge}</span> : null}
            </button>
          ))}
        </nav>
      )}

      {/* Always-rendered hidden photo input — needed by both Dashboard and Documents tabs */}
      <input ref={photoRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handlePhotoCapture} disabled={photoAnalyzing}/>
      {/* Hidden input for document photo scanning */}
      <input ref={scanDocRef} type="file" accept="image/*,image/heic,image/heif" capture="environment" multiple style={{ display: "none" }} onChange={handleDocumentScan}/>

      {/* ── Tutorial walkthrough ─────────────────────────────────────── */}
      <TutorialModal open={showTutorial} onClose={handleTutorialClose}/>

      {/* ── Plaid MFA Verification Modal ─────────────────────────────── */}
      {showMfaModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: C.surface, borderRadius: 18, padding: "32px 28px", width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            {/* Icon */}
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <Shield size={22} color={C.accent}/>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 8px" }}>Verify your identity</h2>
            <p style={{ fontSize: 14, color: C.text3, margin: "0 0 24px", lineHeight: 1.5 }}>
              We sent a 6-digit code to <strong style={{ color: C.text }}>{user?.email}</strong>. Enter it below to securely connect your bank.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={mfaOtpValue}
              onChange={e => { setMfaOtpValue(e.target.value.replace(/\D/g, "")); setMfaError(""); }}
              onKeyDown={e => { if (e.key === "Enter") verifyMfaAndLaunch(); }}
              autoFocus
              style={{
                width: "100%", padding: "13px 16px", borderRadius: 10, fontSize: 22,
                fontWeight: 700, letterSpacing: "0.25em", textAlign: "center",
                border: `1.5px solid ${mfaError ? C.red : mfaOtpValue.length === 6 ? C.accent : C.border}`,
                background: C.bg, color: C.text, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
            />
            {mfaError && (
              <p style={{ fontSize: 13, color: C.red, margin: "8px 0 0", textAlign: "center" }}>{mfaError}</p>
            )}
            <button
              onClick={verifyMfaAndLaunch}
              disabled={mfaOtpValue.length !== 6 || mfaVerifying}
              style={{
                width: "100%", marginTop: 16, padding: "13px", borderRadius: 11,
                background: mfaOtpValue.length === 6 ? C.accent : C.border,
                border: "none", color: "white", fontSize: 15, fontWeight: 700,
                cursor: mfaOtpValue.length === 6 && !mfaVerifying ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "background 0.15s",
              }}
            >
              {mfaVerifying ? <><Loader2 size={15} className="animate-spin"/>Verifying…</> : "Verify & Connect Bank"}
            </button>
            <button
              onClick={() => { setShowMfaModal(false); setMfaOtpValue(""); setMfaError(""); setPlaidToken(null); }}
              style={{ width: "100%", marginTop: 10, padding: "11px", borderRadius: 11, background: "transparent", border: `1px solid ${C.border}`, color: C.text3, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Cancel
            </button>
            <p style={{ fontSize: 12, color: C.text3, textAlign: "center", margin: "14px 0 0" }}>
              Didn&apos;t get the code?{" "}
              <button
                onClick={async () => {
                  setMfaSending(true);
                  await supabase.auth.signInWithOtp({ email: user!.email!, options: { shouldCreateUser: false } });
                  setMfaSending(false);
                  setMfaError("");
                }}
                disabled={mfaSending}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
              >
                {mfaSending ? "Sending…" : "Resend code"}
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
