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
  Mic, MicOff, Volume2, VolumeX,
} from "lucide-react";
import VendorsView from "../components/VendorsView";
import MyJobsView from "../components/MyJobsView";
import type { HomeHealthReport } from "../../lib/scoring-engine";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../lib/scoring-engine";

// ── Types ─────────────────────────────────────────────────────────────────
interface TimelineEvent { date: string; event: string }
interface Doc { name: string; path: string; url?: string }
type FindingStatus = "open" | "completed" | "monitored" | "not_sure" | "dismissed";

interface Finding {
  category: string;
  description: string;
  severity: string;
  estimated_cost: number | null;
  source?: "photo" | "inspection" | string; // "photo" = from image analysis
  age_years?: number | null;           // how old this system is (from inspection report)
  remaining_life_years?: number | null; // inspector's stated remaining useful life
  lifespan_years?: number | null;       // typical total lifespan for this system
  status?: FindingStatus; // injected client-side from findingStatuses map
}

// Normalize a finding category to a stable key for status lookup
function toCategoryKey(category: string): string {
  return (category || "general").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Per-finding status key: category + global index in allFindings array
function findingKey(category: string, index: number): string {
  return `${toCategoryKey(category)}_${index}`;
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

// Findings are "active" if status is open, not_sure, or not yet set
// index = position in the global allFindings array
function isActiveFinding(finding: Finding, index: number, statuses: Record<string, FindingStatus>): boolean {
  const key = findingKey(finding.category, index);
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
    // A category is "resolved" only when ALL its individual findings are resolved
    const isResolved = items.every(it => {
      const s = statuses[findingKey(it.f.category, it.idx)] ?? "open";
      return s === "completed" || s === "dismissed";
    });
    const category = findings[0].category;

    const criticals = findings.filter(f => f.severity === "critical");
    const ncs       = findings.filter(f => f.severity !== "critical");

    // One deduction for the whole system if it has any critical findings
    if (criticals.length > 0) {
      const desc = criticals.length === 1
        ? (criticals[0].description.length > 72 ? criticals[0].description.slice(0, 72) + "…" : criticals[0].description)
        : `${criticals.length} critical issues — ${category}`;
      add({ id: `crit_${key}`, category, reason: desc, points: -8, source: "finding", severity: "critical" }, isResolved);
    }

    // One deduction for the whole system for non-critical findings
    if (ncs.length > 0) {
      const hasWarning = ncs.some(f => f.severity === "warning");
      const pts = hasWarning ? -3 : -1;
      const sev = hasWarning ? "warning" : "info";
      const desc = ncs.length === 1
        ? (ncs[0].description.length > 72 ? ncs[0].description.slice(0, 72) + "…" : ncs[0].description)
        : `${ncs.length} issue${ncs.length > 1 ? "s" : ""} in ${category}`;
      add({ id: `nc_${key}`, category, reason: desc, points: pts, source: "finding", severity: sev }, isResolved);
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

  // Street View Static API — requires "Street View Static API" enabled in Google Cloud
  const streetViewUrl = hasKey && encoded && imgMode === "streetview"
    ? `https://maps.googleapis.com/maps/api/streetview?size=940x220&location=${encoded}&key=${mapsKey}&fov=90&pitch=0&return_error_code=true`
    : null;

  // Maps Static API (satellite/hybrid) — fallback when Street View has no coverage
  // Requires "Maps Static API" enabled in Google Cloud (same key)
  const satelliteUrl = hasKey && encoded && imgMode === "satellite"
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=18&size=940x220&maptype=hybrid&key=${mapsKey}`
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
      const key = findingKey(f.category, i);
      init[key] = initialStatuses[key] ?? "open";
    }
    return init;
  });

  function setStatus(index: number, category: string, status: FindingStatus) {
    setLocalStatuses(prev => ({ ...prev, [findingKey(category, index)]: status }));
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
            Were any of these repairs already completed during escrow or afterwards?
            Your answers update your Home Health Score to reflect current reality.
          </p>
        </div>

        {/* Findings list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {findings.map((finding, i) => {
            const key = findingKey(finding.category, i);
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
                      {finding.category}
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
                      onClick={() => setStatus(i, finding.category, opt.value)}
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

        {/* Footer */}
        <div style={{
          padding: "16px 24px 20px", borderTop: `1px solid ${C.border}`,
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
        <div style={{ padding: "20px 28px", borderBottom: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 14px" }}>Score Breakdown</p>

          {/* Starting score row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: C.text2 }}>Starting score</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>100</span>
          </div>

          {/* Active deduction rows */}
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
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.category}</span>
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
  const [toast, setToast]       = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const toastTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [docs, setDocs]         = useState<Doc[]>([]);
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
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewFindings, setReviewFindings]   = useState<Finding[]>([]);
  const [savingStatuses, setSavingStatuses]   = useState(false);
  const [repairDocs, setRepairDocs]           = useState<Array<{ vendor?: string; date?: string; summary?: string; category?: string; cost?: number; autoResolved?: string[] }>>([]);
  const [uploadingRepair, setUploadingRepair] = useState(false);
  const repairRef = useRef<HTMLInputElement>(null);

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
  } | null>(null);
  const [parsingInsurance, setParsingInsurance] = useState(false);
  const [insuranceError, setInsuranceError] = useState<string | null>(null);
  const [showInsuranceDetail, setShowInsuranceDetail] = useState(false);
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
    checkAuth().then(authed => {
      if (authed) {
        loadProperty();
        loadPlaidData();
        loadDocs();
        loadRepairDocs();
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

  function showToast(msg: string, type: "success" | "error" = "success") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  async function uploadInsurance(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setParsingInsurance(true);
    setInsuranceError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      const { data: prop } = await supabase.from("properties").select("id").eq("user_id", uid ?? "").maybeSingle();
      const propId = prop?.id;

      if (uid) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${uid}/insurance-${Date.now()}-${safeName}`;
        await supabase.storage.from("documents").upload(storagePath, file, { upsert: true });
      }

      const params = new URLSearchParams();
      if (uid)    params.set("userId",     uid);
      if (propId) params.set("propertyId", String(propId));

      const res = await fetch(`/api/parse-insurance?${params}`, {
        method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        const raw = json.error ?? `Server error (${res.status})`;
        console.error("[uploadInsurance]", raw);
        const friendly = raw.includes("extract text") || raw.includes("text from")
          ? "Couldn't read this PDF — try a text-based (not scanned) version."
          : `Upload failed: ${raw}`;
        setInsuranceError(friendly);
        showToast(friendly, "error");
      } else if (json.data) {
        setInsurance(json.data);
        setInsuranceError(null);
        const label = `Insurance saved: ${json.data.provider ?? file.name}${json.data.policyType ? ` · ${json.data.policyType}` : ""}`;
        addEvent(label);
        showToast(`✓ ${label}`, "success");
      } else {
        setInsuranceError("No data returned — please try again.");
        showToast("No data returned — please try again.", "error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.error("[uploadInsurance] caught:", msg);
      setInsuranceError(`Upload failed: ${msg}`);
      showToast(`Upload failed: ${msg}`, "error");
    }
    setParsingInsurance(false);
    if (insuranceRef.current) insuranceRef.current.value = "";
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

  async function logout() { await supabase.auth.signOut(); router.push("/login"); }

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

  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function loadProperty() {
    try {
      const { data, error } = await supabase.from("properties").select("*").limit(1).maybeSingle();
      if (error) { console.error("[loadProperty] DB read error:", error.message, error.code); return; }
      if (!data) { console.log("[loadProperty] No property row found for this user"); return; }
      console.log(`[loadProperty] Loaded property — ${(data.inspection_findings ?? []).length} findings, statuses: ${JSON.stringify(data.finding_statuses ?? {})}`)
      setAddress(data.address ?? "My Home");
      setRoofYear(data.roof_year?.toString() ?? "");
      setHvacYear(data.hvac_year?.toString() ?? "");
      // Load finding statuses (persisted user-confirmed repair states)
      if (data.finding_statuses && typeof data.finding_statuses === "object") {
        setFindingStatuses(data.finding_statuses as Record<string, FindingStatus>);
      }

      // Load photo findings
      if (data.photo_findings?.length > 0) {
        setPhotoFindings(data.photo_findings ?? []);
      }

      // Enter block when inspection_type is set — it is always written to DB by
      // uploadInspection even when 0 findings are returned, so it reliably signals
      // "an upload happened." Without this guard, a 0-findings upload leaves
      // inspection_findings=[] and inspection_summary=null, causing the score
      // card to be hidden after every refresh.
      if (data.inspection_findings?.length > 0 || data.inspection_summary || data.inspection_type) {
        setInspectionResult({
          inspection_type:      data.inspection_type     ?? "Home Inspection",
          summary:              data.inspection_summary  ?? undefined,
          findings:             data.inspection_findings ?? [],
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
      const { data: war } = await supabase.from("home_warranties").select("*").limit(1).maybeSingle();
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
      const { data: ins } = await supabase.from("home_insurance").select("*").limit(1).maybeSingle();
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
          ...(result.roof_year ? { roof_year: result.roof_year } : {}),
          ...(result.hvac_year ? { hvac_year: result.hvac_year } : {}),
          updated_at:            new Date().toISOString(),
        };
        const { data: existingProp, error: propLookupErr } = await supabase
          .from("properties").select("id").limit(1).maybeSingle();
        if (propLookupErr) {
          console.error("[uploadInspection] property lookup failed:", propLookupErr.message);
        } else if (existingProp?.id) {
          const { error: updateErr } = await supabase
            .from("properties").update(inspectionPayload).eq("id", existingProp.id);
          if (updateErr) console.error("[uploadInspection] update failed:", updateErr.message);
          else console.log(`[uploadInspection] ✓ Saved ${newFindings.length} findings to DB`);
        } else {
          const { error: insertErr } = await supabase
            .from("properties").insert({ ...inspectionPayload, address: address || "My Home", user_id: uploadUserId });
          if (insertErr) console.error("[uploadInspection] insert failed:", insertErr.message);
          else console.log(`[uploadInspection] ✓ Created property with ${newFindings.length} findings`);
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
        // Show post-inspection review modal if there are findings to review
        if (newFindings.length > 0) {
          setReviewFindings(newFindings);
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

  // ── Load documents from storage on mount ────────────────────────────────
  // General docs are stored at the bucket root with a "docs-" prefix.
  // Inspections/repairs go into subfolders so filtering by "docs-" is safe.
  //
  // IMPORTANT: this requires a SELECT RLS policy on storage.objects scoped to
  // auth.uid() = owner (see SUPABASE_DOCS_HOTFIX.sql). Without it, list()
  // returns { data: [], error: null } — silently empty, not an error — so
  // documents vanish after every refresh even though files exist in storage.
  async function loadDocs() {
    try {
      // refreshSession() ensures a fresh JWT — avoids "exp claim" errors on storage ops.
      const { data: refreshed } = await supabase.auth.refreshSession();
      const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
      if (!session?.user?.id) return;
      const userId = session.user.id;

      // Store docs in a user-scoped subfolder: {userId}/docs-{ts}-{name}
      // list() on the subfolder only returns that user's files — no RLS owner issues.
      const { data, error } = await supabase.storage
        .from("documents")
        .list(userId, { limit: 200, sortBy: { column: "created_at", order: "desc" } });

      if (error) {
        console.error("[loadDocs] storage.list error:", error.message);
        return;
      }
      if (!data) return;

      const items = data.filter(item => item.id !== null && item.name.startsWith("docs-"));

      const files: Doc[] = await Promise.all(
        items.map(async (item) => {
          const fullPath = `${userId}/${item.name}`;
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(fullPath, 3600);
          return {
            name: item.name.replace(/^docs-\d+-/, ""),
            path: fullPath,
            url: signed?.signedUrl ?? undefined,
          };
        })
      );

      setDocs(files);
    } catch (err) {
      console.error("[loadDocs] unexpected error:", err);
    }
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setDocLoading(true);
    // Always refresh the session to get a fresh JWT — getSession() can return an
    // expired token if the background refresh timer missed, causing "exp claim" errors.
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    const session = refreshed?.session ?? (await supabase.auth.getSession()).data.session;
    if (refreshErr && !session) { alert("Session expired — please log out and back in."); setDocLoading(false); return; }
    const userId = session?.user?.id;
    if (!userId) { alert("Not logged in — please refresh and try again."); setDocLoading(false); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fullPath = `${userId}/docs-${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from("documents").upload(fullPath, file, { upsert: true });
    if (error) { alert("Upload failed: " + error.message); setDocLoading(false); return; }
    addEvent(`Document uploaded: ${file.name}`);
    const { data: signed } = await supabase.storage.from("documents").createSignedUrl(fullPath, 3600);
    setDocs(prev => [{ name: file.name, path: fullPath, url: signed?.signedUrl ?? undefined }, ...prev]);
    setDocLoading(false);
    if (docRef.current) docRef.current.value = "";
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
  async function persistFindingStatuses(statuses: Record<string, FindingStatus>) {
    try {
      const { data: existing } = await supabase.from("properties").select("id").limit(1).maybeSingle();
      if (existing?.id) {
        await supabase.from("properties")
          .update({ finding_statuses: statuses, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
    } catch (err) { console.error("persistFindingStatuses error:", err); }
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

  // ── Toggle a single finding status (inline in findings list) ────────────
  async function toggleFindingStatus(category: string, index: number, status: FindingStatus) {
    const key = findingKey(category, index);
    const newStatuses = { ...findingStatuses, [key]: status };
    setFindingStatuses(newStatuses);
    await persistFindingStatuses(newStatuses);
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

  // Build upcoming costs list (shared between Dashboard and Repairs views)
  // Only includes ACTIVE (open/not_sure) findings — completed repairs are excluded
  const costs: CostItem[] = [];
  const roofKey = toCategoryKey("Roof");
  const hvacKey = toCategoryKey("HVAC");
  const roofResolved = findingStatuses[roofKey] === "completed" || findingStatuses[roofKey] === "dismissed";
  const hvacResolved = findingStatuses[hvacKey] === "completed" || findingStatuses[hvacKey] === "dismissed";

  if (roofAge !== null && roofAge >= 15 && !roofResolved) {
    costs.push({ label: "Roof Replacement", horizon: roofAge >= 22 ? "Urgent — within 1–2 yrs" : "Within 3–5 yrs", amount: 12000 + roofAge * 100, severity: roofAge >= 22 ? "critical" : "warning", systemAge: roofAge, tradeCategory: "Roof" });
  }
  if (hvacAge !== null && hvacAge >= 8 && !hvacResolved) {
    costs.push({ label: hvacAge >= 13 ? "HVAC Replacement" : "HVAC Service", horizon: hvacAge >= 13 ? "Within 2–3 yrs" : "Annual", amount: hvacAge >= 13 ? 8500 : 400, severity: hvacAge >= 13 ? "warning" : "info", systemAge: hvacAge, tradeCategory: "HVAC" });
  }
  // Only add costs for ACTIVE findings (not completed/dismissed ones)
  // When the inspection didn't provide a cost estimate, use a severity-based fallback
  // so the Repair Fund reflects all real findings, not just the ones with exact numbers
  const FALLBACK_COST: Record<string, number> = { critical: 3000, warning: 1200, info: 400 };
  activeFindings.forEach(f => {
    if (!costs.find(c => c.label.toLowerCase().includes(f.category.toLowerCase()))) {
      const amount = (f.estimated_cost && f.estimated_cost > 0)
        ? f.estimated_cost
        : (FALLBACK_COST[f.severity] ?? 500);
      costs.push({ label: f.category, horizon: f.severity === "critical" ? "Immediate" : f.severity === "warning" ? "Within 1–2 yrs" : "Ongoing", amount, severity: f.severity, finding: f, tradeCategory: f.category });
    }
  });

  // ── Repair Fund calculations ──────────────────────────────────────────────
  // "In 12 months" = anything urgent, annual, or within 1-3 years
  const URGENT_H = ["immediate", "urgent", "annual", "within 1", "within 2", "within 3", "6 month", "3 month"];
  const costsIn12Months = costs.filter(c => URGENT_H.some(h => c.horizon.toLowerCase().includes(h)));
  const repairFundNeeded  = costsIn12Months.reduce((s, c) => s + c.amount, 0);
  const repairFundAllTime = costs.reduce((s, c) => s + c.amount, 0);
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
    <div style={{ minHeight: "100vh", display: "flex", background: C.bg, fontFamily: "'DM Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif" }}>
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
      <aside style={{ width: 216, flexShrink: 0, display: isMobile ? "none" : "flex", flexDirection: "column", background: C.navy, position: "sticky", top: 0, height: "100vh" }}>
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
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", padding: isMobile ? "16px 16px 100px" : "36px 28px", display: "flex", flexDirection: "column", gap: 18 }}>

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
          {nav === "Repairs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {costs.length === 0 ? (
                <div style={{ ...card(), textAlign: "center", padding: "48px 24px" }}>
                  <CheckCircle2 size={36} color={C.green} style={{ margin: "0 auto 14px" }}/>
                  <p style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>No upcoming repairs</p>
                  <p style={{ fontSize: 14, color: C.text3 }}>Upload an inspection report or enter your system ages to generate cost projections.</p>
                </div>
              ) : (
                costs.map((c, i) => {
                  const col = c.severity === "critical" ? C.red : c.severity === "warning" ? C.amber : C.text3;
                  const bg  = c.severity === "critical" ? C.redBg : c.severity === "warning" ? C.amberBg : C.bg;
                  return (
                    <div key={i} onClick={() => openCostModal(c)} style={{
                      ...card({ padding: "18px 20px" }),
                      background: bg, border: `1px solid ${col}30`,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
                      onMouseLeave={e => (e.currentTarget.style.transform = "")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }}/>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{c.label}</p>
                          <p style={{ fontSize: 13, color: C.text3, margin: "3px 0 0" }}>{c.horizon}</p>
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: col }}>${c.amount.toLocaleString()}</span>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button onClick={e => { e.stopPropagation(); setChatMessages([{ role: "user", content: c.finding?.description ?? c.label }]); askAI(c.finding?.description ?? c.label); setNav("Dashboard"); }}
                            style={{ padding: "6px 12px", borderRadius: 8, background: C.accentLt, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                            <Shield size={12}/> Check Coverage
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleFindVendors(c.tradeCategory ?? c.label, c.label, c.finding?.description ?? c.label); }}
                            style={{ padding: "6px 12px", borderRadius: 8, background: C.accent, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                            <Users size={12}/> Find Vendors
                          </button>
                          <ChevronRight size={16} color={C.text3}/>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {costs.length > 0 && (
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.red, background: C.redBg, padding: "6px 16px", borderRadius: 20 }}>
                    Total projected: ${costs.reduce((s, c) => s + c.amount, 0).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}

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
                id: "inspection",
                label: "Inspection Findings",
                icon: <Eye size={15} color={C.amber}/>,
                iconBg: C.amberBg,
                accentColor: C.amber,
                status: allFindings.length > 0
                  ? `${allFindings.length} findings · ${completedFindings.length} resolved`
                  : "No inspection uploaded",
                hasDoc: allFindings.length > 0,
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
                                  ? <><Loader2 size={20} color="#0891b2" className="animate-spin"/><span style={{ fontSize: 14, color: "#0891b2" }}>Parsing insurance policy…</span></>
                                  : <><Shield size={20} color="#0891b2"/><span style={{ fontSize: 14, color: C.text }}>Upload homeowners insurance policy or dec page</span><span style={{ fontSize: 12, color: C.text3 }}>PDF or text document</span></>
                                }
                                <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                              </label>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid #0891b2", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                    {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                    {parsingInsurance ? "Parsing…" : "Replace"}
                                    <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                                  </label>
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
                                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{r.category ?? "Repair"}{r.vendor ? ` — ${r.vendor}` : ""}</span>
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

                          {/* ── Inspection Findings content ── */}
                          {sec.id === "inspection" && (() => {
                            if (allFindings.length === 0) {
                              return <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>No inspection report uploaded yet. Upload one in the Home Health section to see findings here.</p>;
                            }
                            const groupMap = new Map<string, { label: string; items: { f: Finding; globalIdx: number }[] }>();
                            for (let gi = 0; gi < allFindings.length; gi++) {
                              const f = allFindings[gi];
                              const gk = toGroupKey(f.category);
                              const meta = GROUP_META[gk] ?? GROUP_META.general;
                              if (!groupMap.has(gk)) groupMap.set(gk, { label: meta.label, items: [] });
                              groupMap.get(gk)!.items.push({ f, globalIdx: gi });
                            }
                            const groups = [...groupMap.entries()].map(([gk, v]) => ({ gk, ...v }));
                            const statusConfig: Record<FindingStatus, { label: string; color: string; bg: string }> = {
                              open:      { label: "Open",       color: C.red,    bg: C.redBg   },
                              completed: { label: "Completed",  color: C.green,  bg: C.greenBg },
                              monitored: { label: "Monitoring", color: C.accent, bg: "#eff6ff" },
                              not_sure:  { label: "Not Sure",   color: C.amber,  bg: C.amberBg },
                              dismissed: { label: "Dismissed",  color: C.text3,  bg: C.bg      },
                            };
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 0, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
                                {/* Summary bar */}
                                <div style={{ display: "flex", gap: 16, padding: "10px 16px", background: C.bg, borderBottom: `1px solid ${C.border}`, justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", gap: 14 }}>
                                    <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{allFindings.filter(f => f.severity === "critical").length} critical</span>
                                    <span style={{ fontSize: 12, color: C.amber, fontWeight: 600 }}>{allFindings.filter(f => f.severity === "warning").length} warnings</span>
                                    <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>{completedFindings.length} resolved</span>
                                  </div>
                                  <button onClick={() => { setReviewFindings(inspectionResult?.findings ?? []); setShowReviewModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: "none", border: "none", cursor: "pointer" }}>Review All →</button>
                                </div>
                                {groups.map(({ gk, label, items }, gi) => {
                                  const isGrpOpen = expandedGroups.has(gk);
                                  const meta = GROUP_META[gk] ?? GROUP_META.general;
                                  const hasCritical = items.some(({ f }) => f.severity === "critical");
                                  const hasWarning  = items.some(({ f }) => f.severity === "warning");
                                  const allResolved = items.every(({ f, globalIdx }) => { const s = findingStatuses[findingKey(f.category, globalIdx)] ?? "open"; return s === "completed" || s === "dismissed"; });
                                  const worstColor = hasCritical ? C.red : hasWarning ? C.amber : allResolved ? C.green : C.text3;
                                  const worstLabel = hasCritical ? "Critical" : hasWarning ? "Warning" : allResolved ? "Resolved" : "Good";
                                  const worstBg    = hasCritical ? C.redBg   : hasWarning ? C.amberBg : allResolved ? C.greenBg : C.bg;
                                  return (
                                    <div key={gk} style={{ borderBottom: gi < groups.length - 1 ? `1px solid ${C.border}` : "none" }}>
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
                                              const fk = findingKey(f.category, globalIdx);
                                              const status = findingStatuses[fk] ?? "open";
                                              const cfg = statusConfig[status];
                                              const isResolved = status === "completed" || status === "dismissed";
                                              const sevColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
                                              return (
                                                <div key={fi} style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${isResolved ? C.border : sevColor + "30"}`, display: "flex", flexDirection: "column", gap: 9 }}>
                                                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                                                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: sevColor, flexShrink: 0, marginTop: 5 }}/>
                                                    <div style={{ flex: 1 }}>
                                                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 3 }}>
                                                        <span style={{ fontSize: 13, fontWeight: 700, color: isResolved ? C.text3 : C.text, textDecoration: status === "completed" ? "line-through" : "none" }}>{f.category}</span>
                                                        {f.severity && f.severity !== "info" && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: sevColor + "18", color: sevColor, textTransform: "capitalize" }}>{f.severity}</span>}
                                                      </div>
                                                      <p style={{ fontSize: 12, color: isResolved ? C.text3 : C.text2, margin: 0, lineHeight: 1.55 }}>{f.description}</p>
                                                      {f.estimated_cost != null && <p style={{ fontSize: 11, color: C.text3, margin: "4px 0 0", fontWeight: 600 }}>Est. ${f.estimated_cost.toLocaleString()}</p>}
                                                    </div>
                                                  </div>
                                                  <div style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 2, flexWrap: "wrap" }}>
                                                    <select value={status} onChange={e => toggleFindingStatus(f.category, globalIdx, e.target.value as FindingStatus)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, border: `1px solid ${cfg.color}40`, background: cfg.bg, color: cfg.color, cursor: "pointer", outline: "none" }}>
                                                      <option value="open">Open</option>
                                                      <option value="completed">Completed</option>
                                                      <option value="monitored">Monitoring</option>
                                                      <option value="not_sure">Not Sure</option>
                                                      <option value="dismissed">Dismissed</option>
                                                    </select>
                                                    {!isResolved && (<>
                                                      <button onClick={() => handleFindVendors(f.category, f.category, f.description)} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "white", background: C.navy, border: "none", borderRadius: 20, padding: "3px 11px", cursor: "pointer" }}>🔧 Fix This</button>
                                                      <button onClick={() => handleFindVendors(f.category, f.category, f.description)} style={{ fontSize: 11, fontWeight: 600, color: C.accent, background: "white", border: `1px solid ${C.accent}`, borderRadius: 20, padding: "3px 11px", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><Users size={9}/> Vendor</button>
                                                      <button onClick={() => toggleFindingStatus(f.category, globalIdx, "completed")} style={{ fontSize: 11, fontWeight: 600, color: C.green, background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 20, padding: "3px 11px", cursor: "pointer" }}>✓ Done</button>
                                                    </>)}
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
                            );
                          })()}

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
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <FileText size={13} color={C.text3}/><span style={{ fontSize: 13, color: C.text }}>{doc.name}</span>
                                      </div>
                                      {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>View <ExternalLink size={10}/></a> : <span style={{ fontSize: 12, color: C.text3 }}>Unavailable</span>}
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
                boxShadow: `0 4px 20px ${C.navy}1F`,
              }}>
                <div style={{ width: 134, height: 134, borderRadius: "50%", border: "4px dashed rgba(255,255,255,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Activity size={40} color="rgba(255,255,255,0.18)"/>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 6px" }}>Home Health Score</p>
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
                </div>
              </div>
            )}

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
                  <div style={card({ background: isUrgent ? C.amberBg : C.surface, border: isUrgent ? `1px solid ${C.amber}40` : `1px solid ${C.border}` })}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: `${C.accent}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <DollarSign size={16} color={C.accent}/>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: 0 }}>Mortgage</p>
                          {mortgage?.lender && <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>{mortgage.lender}</p>}
                        </div>
                      </div>
                      <button onClick={() => setShowMortgageForm(f => !f)} style={{ fontSize: 11, fontWeight: 600, color: C.accent, background: "transparent", border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                        {showMortgageForm ? "Cancel" : mortgage ? "Edit" : "Add"}
                      </button>
                    </div>
                    {mortgage && !showMortgageForm ? (
                      <>
                        <p style={{ fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", margin: "0 0 4px" }}>${mortgage.balance?.toLocaleString() ?? "—"}</p>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {mortgage.payment && <span style={{ fontSize: 12, color: C.text2 }}>${mortgage.payment.toLocaleString()}/mo</span>}
                          {mortgage.rate && <span style={{ fontSize: 12, color: C.text2 }}>{(mortgage.rate * 100).toFixed(3)}%</span>}
                        </div>
                        {isUrgent ? (
                          <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: C.amberBg, border: `1px solid ${C.amber}40`, display: "flex", alignItems: "center", gap: 6 }}>
                            <AlertTriangle size={12} color={C.amber}/>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>Due in {daysUntilDue} day{daysUntilDue !== 1 ? "s" : ""} — ${mortgage.payment?.toLocaleString()}</span>
                          </div>
                        ) : mortgage.due_day ? (
                          <p style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>Due the {dueDay}{[,"st","nd","rd"][dueDay] ?? "th"} · {daysUntilDue} days away</p>
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
                  </div>
                );
              })()}

              {/* Insurance */}
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: insurance ? 8 : 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "#0891b218", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Shield size={18} color="#0891b2"/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: 0 }}>Home Insurance</p>
                    {insurance ? (
                      <>
                        <p style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: "3px 0 1px" }}>
                          {insurance.provider ?? "Active"}
                          {insurance.policyType ? ` · ${insurance.policyType}` : ""}
                        </p>
                        <p style={{ fontSize: 12, color: C.text3, margin: "0 0 8px" }}>
                          {(insurance.annualPremium ?? insurance.premium) ? `$${(insurance.annualPremium ?? insurance.premium)?.toLocaleString()}/yr` : ""}
                          {insurance.expirationDate ? `${(insurance.annualPremium ?? insurance.premium) ? " · " : ""}Renews ${insurance.expirationDate}` : ""}
                        </p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <button onClick={() => {
                            if (insurance.claimUrl) window.open(insurance.claimUrl);
                            else if (insurance.claimPhone) window.location.href = `tel:${insurance.claimPhone.replace(/\D/g, "")}`;
                            else showToast("No claim contact on file — upload your policy");
                          }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: C.navy, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            File Claim
                          </button>
                          <button onClick={() => setShowInsuranceDetail(d => !d)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "transparent", border: `1.5px solid ${C.accent}`, color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            View Details
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "3px 0 6px" }}>—</p>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid #0891b2", background: "transparent", color: "#0891b2", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {parsingInsurance ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                          {parsingInsurance ? "Parsing…" : "Upload Policy"}
                          <input ref={insuranceRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                        </label>
                        {insuranceError && <p style={{ fontSize: 11, color: C.red, margin: "6px 0 0", lineHeight: 1.4 }}>⚠ {insuranceError}</p>}
                      </>
                    )}
                  </div>
                  {insurance && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: "1px solid #0891b220", background: "transparent", color: "#0891b2", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                      {parsingInsurance ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                      {parsingInsurance ? "Parsing…" : "Replace"}
                      <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                    </label>
                  )}
                </div>

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
                        <input type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
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
              <div style={card({ display: "flex", gap: 14, alignItems: "center" })}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "#7c3aed18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Shield size={18} color="#7c3aed"/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: 0 }}>Home Warranty</p>
                  {warranty ? (
                    <>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: "3px 0 1px" }}>
                        {warranty.provider ?? "Active"}
                        {warranty.planName ? ` · ${warranty.planName}` : ""}
                      </p>
                      <p style={{ fontSize: 12, color: C.text3, margin: "0 0 8px" }}>
                        {warranty.serviceFee ? `$${warranty.serviceFee} service fee` : ""}
                        {warranty.expirationDate ? `${warranty.serviceFee ? " · " : ""}Expires ${warranty.expirationDate}` : ""}
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => {
                          if (warranty.claimUrl) window.open(warranty.claimUrl);
                          else if (warranty.claimPhone) window.location.href = `tel:${warranty.claimPhone.replace(/\D/g, "")}`;
                          else showToast("No claim contact on file — upload your warranty");
                        }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: C.navy, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          File Claim
                        </button>
                        <button onClick={() => setShowWarrantyDetail(d => !d)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "transparent", border: `1.5px solid ${C.accent}`, color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          View Details
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "3px 0 6px" }}>—</p>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {parsingWarranty ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                        {parsingWarranty ? "Parsing…" : "Upload Warranty"}
                        <input ref={warrantyRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadWarranty} disabled={parsingWarranty}/>
                      </label>
                      {warrantyError && <p style={{ fontSize: 11, color: C.red, margin: "6px 0 0", lineHeight: 1.4 }}>⚠ {warrantyError}</p>}
                    </>
                  )}
                </div>
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
            {(costs.length > 0 || repairFundAllTime > 0) ? (
            <div style={{ ...card({ padding: 0, overflow: "hidden" }), border: `1px solid ${C.border}` }}>

              {/* Dark header strip */}
              <div style={{
                background: `linear-gradient(135deg, #1a3a2a 0%, #2D6A4F 100%)`,
                padding: "20px 24px",
              }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Your Home Repair Fund</p>
                <p style={{ fontSize: 32, fontWeight: 800, color: "white", margin: "4px 0 2px", letterSpacing: "-0.02em" }}>
                  ${(repairFundNeeded > 0 ? repairFundNeeded : repairFundAllTime).toLocaleString()}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>
                  {repairFundNeeded > 0 ? "estimated repairs in the next 12 months" : "total projected repair costs"}
                </p>
              </div>

              <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── Connected Repair Fund Balance ─────────────────── */}
                {(() => {
                  const target    = repairFundNeeded > 0 ? repairFundNeeded : repairFundAllTime;
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

                {/* Cost breakdown rows */}
                {repairFundAllTime > 0 && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Cost Breakdown</p>
                    {costs.slice(0, 4).map((c, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: i < Math.min(3, costs.length - 1) ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ fontSize: 12, color: C.text3 }}>{c.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.severity === "critical" ? C.red : c.severity === "warning" ? C.amber : C.text2 }}>${c.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    {costs.length > 4 && (
                      <p style={{ fontSize: 11, color: C.text3, margin: "6px 0 0", textAlign: "right" }}>+{costs.length - 4} more in Repairs tab</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            ) : (
            <div style={{ ...card(), textAlign: "center", padding: "32px 24px" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#16a34a18", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <DollarSign size={22} color="#16a34a"/>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>Your Home Repair Fund</p>
              <p style={{ fontSize: 13, color: C.text3, margin: 0, lineHeight: 1.5 }}>
                Upload an inspection report or enter your system ages to generate cost projections.
              </p>
            </div>
            )}
            {/* Inspection Upload — full width */}
            <div style={card()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: `${C.accent}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <FileText size={15} color={C.accent}/>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15, color: C.text, display: "block" }}>Inspection Report</span>
                    <span style={{ fontSize: 12, color: C.text3 }}>AI-powered analysis · any inspection type</span>
                  </div>
                </div>
                {inspectDone && (
                  <button onClick={() => inspRef.current?.click()} disabled={inspecting}
                    style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: "transparent", border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                    <Upload size={11}/> Upload New
                  </button>
                )}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, cursor: inspecting ? "default" : "pointer", transition: "all 0.2s",
                border: `2px dashed ${inspecting ? C.accent : inspectDone ? C.green : inspectErr ? C.red : C.border}`,
                background: inspecting ? "#eff6ff" : inspectDone ? C.greenBg : inspectErr ? C.redBg : "#fafbfc" }}>
                {inspecting ? <><Loader2 size={18} color={C.accent} className="animate-spin"/><span style={{ fontSize: 14, color: C.accent, fontWeight: 500 }}>Analyzing report… (up to 60s)</span></>
                : inspectDone ? <><CheckCircle2 size={18} color={C.green}/><span style={{ fontSize: 14, color: C.green, fontWeight: 600 }}>Analysis complete — click to upload another</span></>
                : inspectErr ? <><AlertTriangle size={18} color={C.red}/><div><span style={{ fontSize: 14, color: C.red, fontWeight: 600, display: "block" }}>Upload failed</span><span style={{ fontSize: 12, color: C.text3 }}>{inspectErr}</span></div></>
                : <><CloudUpload size={18} color={C.text3}/><div><span style={{ fontSize: 14, color: C.text, fontWeight: 500, display: "block" }}>Click to upload inspection PDF</span><span style={{ fontSize: 12, color: C.text3 }}>Pest, home, roof, HVAC — AI extracts all findings automatically</span></div></>}
                <input ref={inspRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInspection} disabled={inspecting}/>
              </label>
              {inspectionResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{inspectionResult.inspection_type ?? "Inspection Report"}</span>
                    {inspectionResult.total_estimated_cost != null && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.red, background: C.redBg, padding: "3px 10px", borderRadius: 20 }}>
                        Est. ${inspectionResult.total_estimated_cost.toLocaleString()} total
                      </span>
                    )}
                  </div>
                  {inspectionResult.summary && (
                    <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, margin: "0 0 10px", background: C.bg, borderRadius: 8, padding: "9px 11px" }}>
                      {inspectionResult.summary.replace(/^\[Extracted[\s\S]*?\]\s*/, "")}
                    </p>
                  )}
                  {inspectionResult.findings && inspectionResult.findings.length > 0 && (() => {
                    // Build groups for the compact accordion inside the upload card
                    const grpMap = new Map<string, { label: string; items: { f: Finding; globalIdx: number }[] }>();
                    for (let gi = 0; gi < inspectionResult.findings.length; gi++) {
                      const f   = inspectionResult.findings[gi];
                      const gk  = toGroupKey(f.category);
                      const meta = GROUP_META[gk] ?? GROUP_META.general;
                      if (!grpMap.has(gk)) grpMap.set(gk, { label: meta.label, items: [] });
                      grpMap.get(gk)!.items.push({ f, globalIdx: gi });
                    }
                    const grps = [...grpMap.entries()].map(([gk, v]) => ({ gk, ...v }));
                    return (
                      <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                        {grps.map(({ gk, label, items }, gi) => {
                          const isOpen      = expandedGroups.has("upload_" + gk);
                          const hasCritical = items.some(({ f }) => f.severity === "critical");
                          const hasWarning  = items.some(({ f }) => f.severity === "warning");
                          const meta        = GROUP_META[gk] ?? GROUP_META.general;
                          const worstColor  = hasCritical ? C.red : hasWarning ? C.amber : C.green;
                          const worstBg     = hasCritical ? C.redBg : hasWarning ? C.amberBg : C.greenBg;
                          const worstLabel  = hasCritical ? "Critical" : hasWarning ? "Warning" : "Good";
                          return (
                            <div key={gk} style={{ borderBottom: gi < grps.length - 1 ? `1px solid ${C.border}` : "none" }}>
                              {/* Group row */}
                              <button
                                onClick={() => setExpandedGroups(prev => {
                                  const next = new Set(prev);
                                  const key  = "upload_" + gk;
                                  if (next.has(key)) next.delete(key); else next.add(key);
                                  return next;
                                })}
                                style={{
                                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                                  padding: "11px 14px", background: isOpen ? C.bg : "white",
                                  border: "none", cursor: "pointer", textAlign: "left",
                                }}>
                                {/* Icon */}
                                <div style={{
                                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                  background: worstBg, display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                  {meta.iconFn(worstColor)}
                                </div>
                                {/* Label */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</span>
                                  <span style={{ fontSize: 11, color: C.text3, marginLeft: 6 }}>
                                    {items.length} {items.length === 1 ? "finding" : "findings"}
                                  </span>
                                </div>
                                {/* Severity badge */}
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                                  background: worstBg, color: worstColor, flexShrink: 0,
                                }}>
                                  {worstLabel}
                                </span>
                                {/* Chevron */}
                                <div style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}>
                                  <ChevronDown size={14} color={C.text3}/>
                                </div>
                              </button>

                              {/* Expanded findings */}
                              {isOpen && (
                                <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
                                  {items.map(({ f, globalIdx }, fi) => {
                                    const dotColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
                                    return (
                                      <div key={fi}
                                        onClick={() => openCostModal({ label: f.category, horizon: f.severity === "critical" ? "Immediate" : "Within 1–2 yrs", amount: f.estimated_cost ?? 0, severity: f.severity, finding: f, tradeCategory: f.category })}
                                        style={{
                                          display: "flex", gap: 10, padding: "9px 14px 9px 54px",
                                          borderBottom: fi < items.length - 1 ? `1px solid ${C.border}` : "none",
                                          alignItems: "flex-start", cursor: "pointer",
                                          transition: "background 0.1s",
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
                                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 5 }}/>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{f.category}</span>
                                          <span style={{ fontSize: 11, color: C.text2, display: "block", marginTop: 1, lineHeight: 1.4 }}>{f.description}</span>
                                        </div>
                                        {f.estimated_cost != null && (
                                          <span style={{ fontSize: 12, fontWeight: 700, color: dotColor, flexShrink: 0 }}>${f.estimated_cost.toLocaleString()}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Debug/QA Panel — hidden toggle */}
              {parseDebug && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <button onClick={() => setShowDebug(d => !d)}
                    style={{ fontSize: 11, color: C.text3, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                    <Eye size={11}/> {showDebug ? "Hide" : "Show"} Parser Debug
                  </button>
                  {showDebug && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        { label: "Extraction Method", value: String((parseDebug).extraction_method ?? "—") },
                        { label: "Raw Chars Extracted", value: String((parseDebug).raw_chars_extracted ?? "—") },
                        { label: "Chars Sent to AI", value: String((parseDebug).chars_sent_to_ai ?? "—") },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ display: "flex", gap: 12, fontSize: 12 }}>
                          <span style={{ color: C.text3, minWidth: 160, flexShrink: 0 }}>{label}:</span>
                          <span style={{ color: C.text2, fontWeight: 600 }}>{value}</span>
                        </div>
                      ))}
                      {parseDebug.text_preview && (
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "4px 0 4px" }}>PDF Text Preview (first 500 chars)</p>
                          <pre style={{ fontSize: 11, color: C.text2, background: C.bg, borderRadius: 8, padding: "10px 12px", overflow: "auto", maxHeight: 140, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, border: `1px solid ${C.border}` }}>
                            {String((parseDebug).text_preview)}
                          </pre>
                        </div>
                      )}
                      {(parseDebug).raw_ai_output && (
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "4px 0 4px" }}>Raw AI Output</p>
                          <pre style={{ fontSize: 11, color: C.text2, background: C.bg, borderRadius: 8, padding: "10px 12px", overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, border: `1px solid ${C.border}` }}>
                            {String((parseDebug).raw_ai_output)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
