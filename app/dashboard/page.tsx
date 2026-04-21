"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  Home as HomeIcon, Upload, FileText, Activity,
  Wrench, Users, Settings, Send, Loader2, CheckCircle2,
  AlertTriangle, AlertCircle, Info, ChevronRight, Sparkles, X, CloudUpload,
  LogOut, User, MapPin, Link as LinkIcon, TrendingDown, Briefcase,
  DollarSign, Shield, Zap, Droplets, Wind, Eye, Bug,
  ExternalLink, ArrowRight, BarChart3, Clock,
} from "lucide-react";
import VendorsView from "../components/VendorsView";
import MyJobsView from "../components/MyJobsView";

// ── Types ─────────────────────────────────────────────────────────────────
interface TimelineEvent { date: string; event: string }
interface Doc { name: string; path: string; url?: string }
type FindingStatus = "open" | "completed" | "monitored" | "not_sure" | "dismissed";

interface Finding {
  category: string;
  description: string;
  severity: string;
  estimated_cost: number | null;
  status?: FindingStatus; // injected client-side from findingStatuses map
}

// Normalize a finding category to a stable key for status lookup
function toCategoryKey(category: string): string {
  return (category || "general").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Findings are "active" if status is open, not_sure, or not yet set
function isActiveFinding(finding: Finding, statuses: Record<string, FindingStatus>): boolean {
  const key = toCategoryKey(finding.category);
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

  // B. Finding deductions — grouped by category key for per-system cap ─
  const byKey = new Map<string, Finding[]>();
  for (const f of allFindings) {
    const k = toCategoryKey(f.category);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(f);
  }

  for (const [key, findings] of byKey.entries()) {
    const isResolved = statuses[key] === "completed" || statuses[key] === "dismissed";
    const category   = findings[0].category;

    // Critical: -15 each, uncapped
    for (const f of findings.filter(f => f.severity === "critical")) {
      const desc = f.description.length > 72 ? f.description.slice(0, 72) + "…" : f.description;
      add({ id: `crit_${key}`, category, reason: desc, points: -15, source: "finding", severity: "critical" }, isResolved);
    }

    // Non-critical: -5 warning / -2 info — capped at -10 per system
    const ncs = findings.filter(f => f.severity !== "critical");
    if (ncs.length > 0) {
      const raw  = ncs.reduce((s, f) => s + (f.severity === "warning" ? -5 : -2), 0);
      const pts  = Math.max(raw, -10);
      const sev  = ncs.some(f => f.severity === "warning") ? "warning" : "info";
      const desc = ncs.length === 1
        ? (ncs[0].description.length > 72 ? ncs[0].description.slice(0, 72) + "…" : ncs[0].description)
        : `${ncs.length} issue${ncs.length > 1 ? "s" : ""} in ${category}${raw < pts ? " (capped)" : ""}`;
      add({ id: `nc_${key}`, category, reason: desc, points: pts, source: "finding", severity: sev }, isResolved);
    }
  }

  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
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
  bg:       "#f0f4f8",
  surface:  "#ffffff",
  navy:     "#0f1f3d",
  navyMid:  "#1e3a8a",
  accent:   "#2563eb",
  slate:    "#334155",
  text:     "#0f172a",
  text2:    "#475569",
  text3:    "#94a3b8",
  border:   "#e2e8f0",
  green:    "#16a34a",
  greenBg:  "#f0fdf4",
  amber:    "#d97706",
  amberBg:  "#fffbeb",
  red:      "#dc2626",
  redBg:    "#fef2f2",
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
          <stop offset="0%" stopColor="#0f1f3d"/><stop offset="100%" stopColor="#1e3a8a"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0"/>
          <stop offset="50%" stopColor="#2563eb" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect width="900" height="200" fill="url(#sky)"/>
      <rect width="900" height="200" fill="url(#glow)"/>
      <rect x="0" y="170" width="900" height="30" fill="rgba(255,255,255,0.05)"/>
      <rect x="280" y="90" width="340" height="80" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <polygon points="270,92 450,30 630,92" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <rect x="428" y="130" width="44" height="40" rx="3" fill="rgba(37,99,235,0.35)" stroke="rgba(37,99,235,0.5)" strokeWidth="1"/>
      <rect x="305" y="108" width="60" height="42" rx="3" fill="rgba(37,99,235,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
      <line x1="335" y1="108" x2="335" y2="150" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <line x1="305" y1="129" x2="365" y2="129" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <rect x="535" y="108" width="60" height="42" rx="3" fill="rgba(37,99,235,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
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
      background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 60%, #1e3a5f 100%)` }}>
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
    for (const f of findings) {
      const key = toCategoryKey(f.category);
      init[key] = initialStatuses[key] ?? "open";
    }
    return init;
  });

  function setStatus(category: string, status: FindingStatus) {
    setLocalStatuses(prev => ({ ...prev, [toCategoryKey(category)]: status }));
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
            const key = toCategoryKey(finding.category);
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
                      onClick={() => setStatus(finding.category, opt.value)}
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
function HealthScoreModal({
  breakdown, roofYear, hvacYear, year, onClose, onFindVendors,
}: {
  breakdown:     ScoreBreakdown;
  roofYear:      string;
  hvacYear:      string;
  year:          number;
  onClose:       () => void;
  onFindVendors: (trade: string, context?: string) => void;
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
                          onClick={() => { onClose(); onFindVendors(d.category, d.category); }}
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
        {(roofAge === null && hvacAge === null && deductions.length === 0 && resolvedDeductions.length === 0) && (
          <div style={{ padding: "24px 28px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: C.text3, margin: 0 }}>
              Upload an inspection report or enter system years in Settings to see your full breakdown.
            </p>
          </div>
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

// ── Cost Detail Modal ─────────────────────────────────────────────────────
function CostDetailModal({
  item, findings, onClose, onFindVendors,
}: {
  item: CostItem;
  findings: Finding[];
  onClose: () => void;
  onFindVendors: (trade: string, context?: string) => void;
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

          {/* CTA buttons */}
          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button onClick={() => { onClose(); onFindVendors(item.tradeCategory ?? item.label, item.label); }}
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

  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [docs, setDocs]         = useState<Doc[]>([]);
  const [q, setQ]               = useState("");
  const [chatMessages, setChatMessages] = useState<{role:"user"|"assistant"; content:string}[]>([]);
  const [answer, setAnswer]     = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectDone, setInspectDone]   = useState(false);
  const [inspectErr, setInspectErr]     = useState("");
  const [inspectionResult, setInspectionResult] = useState<{
    inspection_type?: string;
    summary?: string;
    findings?: Finding[];
    recommendations?: string[];
    total_estimated_cost?: number | null;
    inspection_date?: string;
    company_name?: string;
  } | null>(null);
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

  // Modals
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [showCostModal, setShowCostModal]     = useState(false);
  const [selectedCost, setSelectedCost]       = useState<CostItem | null>(null);
  const [vendorPrefill, setVendorPrefill]     = useState<string | null>(null);
  const [vendorContext, setVendorContext]      = useState<string | null>(null);

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

  // Property data
  const [homeValue, setHomeValue]     = useState<number | null>(null);
  const [propertyTax, setPropertyTax] = useState<number | null>(null);
  const [fetchingProperty, setFetchingProperty] = useState(false);

  // Insurance
  const [insurance, setInsurance]           = useState<{ provider?: string; premium?: number; expirationDate?: string } | null>(null);
  const [parsingInsurance, setParsingInsurance] = useState(false);
  const [insuranceDone, setInsuranceDone]   = useState(false);
  const insuranceRef = useRef<HTMLInputElement>(null);

  const inspRef = useRef<HTMLInputElement>(null);
  const docRef  = useRef<HTMLInputElement>(null);

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

  function openCostModal(item: CostItem) {
    setSelectedCost(item);
    setShowCostModal(true);
  }

  // Navigate to Vendors page pre-filtered to the relevant trade category
  function handleFindVendors(trade: string, context?: string) {
    setShowHealthModal(false);
    setShowCostModal(false);
    setVendorPrefill(toVendorKey(trade));
    setVendorContext(context ?? null);
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

  async function uploadInsurance(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setParsingInsurance(true); setInsuranceDone(false);
    try {
      const res = await fetch("/api/parse-insurance", {
        method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      const json = await res.json();
      if (json.data) { setInsurance(json.data); setInsuranceDone(true); addEvent(`Insurance parsed: ${json.data.provider ?? file.name}`); }
    } catch { /* silent */ }
    setParsingInsurance(false);
    if (insuranceRef.current) insuranceRef.current.value = "";
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

  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function loadProperty() {
    try {
      const { data, error } = await supabase.from("properties").select("*").limit(1).maybeSingle();
      if (error) { console.error("loadProperty error:", error.message); return; }
      if (!data) return;
      setAddress(data.address ?? "My Home");
      setRoofYear(data.roof_year?.toString() ?? "");
      setHvacYear(data.hvac_year?.toString() ?? "");
      // Load finding statuses (persisted user-confirmed repair states)
      if (data.finding_statuses && typeof data.finding_statuses === "object") {
        setFindingStatuses(data.finding_statuses as Record<string, FindingStatus>);
      }

      if (data.inspection_findings?.length > 0 || data.inspection_summary) {
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
      if (data.home_value)          setHomeValue(data.home_value);
      if (data.property_tax_annual) setPropertyTax(data.property_tax_annual);
      if (data.insurance_premium)   setInsurance({ premium: data.insurance_premium, expirationDate: data.insurance_renewal ?? undefined });
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
      await supabase.auth.getSession(); // refresh JWT before storage op
      const storagePath = `mortgage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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
      await supabase.auth.getSession(); // refresh JWT before storage op
      const storagePath = `inspections/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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
        if (result.roof_year) setRoofYear(String(result.roof_year));
        if (result.hvac_year) setHvacYear(String(result.hvac_year));
        if (result.property_address) setAddress(result.property_address);
        setInspectionResult(result);
        if (result._debug) setParseDebug(result._debug);
        if (result.timeline_events?.length) result.timeline_events.forEach((ev: string) => addEvent(ev));
        else addEvent(`${result.inspection_type ?? "Inspection"} analyzed: ${file.name}`);
        setInspectDone(true);
        // Show post-inspection review modal if there are findings to review
        if (result.findings?.length > 0) {
          setReviewFindings(result.findings);
          setShowReviewModal(true);
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
      const { data: { session } } = await supabase.auth.getSession();
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
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { alert("Not logged in — please refresh and try again."); setDocLoading(false); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    // Store under {userId}/docs-{timestamp}-{name} for reliable per-user isolation
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
      await supabase.auth.getSession(); // refresh JWT before storage op
      const storagePath = `repairs/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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
          existingFindings: inspectionResult?.findings ?? [],
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
  async function toggleFindingStatus(category: string, status: FindingStatus) {
    const key = toCategoryKey(category);
    const newStatuses = { ...findingStatuses, [key]: status };
    setFindingStatuses(newStatuses);
    await persistFindingStatuses(newStatuses);
  }

  async function askAI() {
    if (!q.trim() || aiLoading) return;
    const userMsg = q.trim();
    setQ("");
    setAiLoading(true);
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    try {
      const authHeader = await getAuthHeader();
      const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/home-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ question: userMsg, chatHistory: history, roofYear, hvacYear, timeline, findings: inspectionResult?.findings ?? [], address }),
      });
      const data = await res.json();
      const aiReply = data.answer ?? "Sorry, couldn't generate a response.";
      setChatMessages(prev => [...prev, { role: "assistant", content: aiReply }]);
      setAnswer(aiReply); // keep for legacy compatibility
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Something went wrong — please try again." }]);
    }
    setAiLoading(false);
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
  const activeFindings    = (inspectionResult?.findings ?? []).filter(f =>  isActiveFinding(f, findingStatuses));
  const completedFindings = (inspectionResult?.findings ?? []).filter(f => !isActiveFinding(f, findingStatuses));

  // Deterministic score — pure function, same inputs = same score every time
  const breakdown    = computeHealthScore(inspectionResult?.findings ?? [], findingStatuses, roofYear, hvacYear, year);
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
  activeFindings.forEach(f => {
    if (f.estimated_cost && f.estimated_cost > 0 && !costs.find(c => c.label.toLowerCase().includes(f.category.toLowerCase()))) {
      costs.push({ label: f.category, horizon: f.severity === "critical" ? "Immediate" : f.severity === "warning" ? "Within 1–2 yrs" : "Ongoing", amount: f.estimated_cost, severity: f.severity, finding: f, tradeCategory: f.category });
    }
  });

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
    <div style={{ minHeight: "100vh", display: "flex", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

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
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside style={{ width: 216, flexShrink: 0, display: isMobile ? "none" : "flex", flexDirection: "column", background: C.navy, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(37,99,235,0.5)" }}>
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
              if (label === "Vendors") { setVendorPrefill(null); setVendorContext(null); }
            }} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 12px", borderRadius: 10, fontSize: 13,
              border: "none", cursor: "pointer", textAlign: "left", width: "100%",
              background: nav === label ? "rgba(255,255,255,0.12)" : "transparent",
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
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={e => { e.stopPropagation(); handleFindVendors(c.tradeCategory ?? c.label, c.label); }}
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
          {nav === "Documents" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Repair Document Upload */}
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <CheckCircle2 size={14} color={C.green}/>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Upload Repair Document</span>
                </div>
                <p style={{ fontSize: 13, color: C.text3, marginBottom: 14, lineHeight: 1.5 }}>
                  Upload invoices, receipts, or contractor reports for completed work. BTLR will parse what was repaired and update your Home Health Score automatically.
                </p>
                <label style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  padding: "22px 16px", borderRadius: 12, cursor: "pointer",
                  border: `2px dashed ${uploadingRepair ? C.green : "#bbf7d0"}`,
                  background: uploadingRepair ? C.greenBg : "#f0fdf4",
                }}>
                  {uploadingRepair
                    ? <><Loader2 size={20} color={C.green} className="animate-spin"/><span style={{ fontSize: 14, color: C.green }}>Parsing repair document…</span></>
                    : <><CheckCircle2 size={20} color={C.green}/><span style={{ fontSize: 14, color: C.text }}>Upload invoice, receipt, or contractor report</span><span style={{ fontSize: 12, color: C.text3 }}>PDF, image, or document</span></>
                  }
                  <input ref={repairRef} type="file" style={{ display: "none" }} onChange={uploadRepairDoc} disabled={uploadingRepair} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"/>
                </label>

                {/* Completed repairs from this session */}
                {repairDocs.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Repair History</p>
                    {repairDocs.map((r, i) => (
                      <div key={i} style={{ background: C.greenBg, border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <CheckCircle2 size={13} color={C.green}/>
                          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                            {r.category ?? "Repair"}{r.vendor ? ` — ${r.vendor}` : ""}
                          </span>
                          {r.cost ? <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: C.green }}>${r.cost.toLocaleString()}</span> : null}
                        </div>
                        {r.summary && <p style={{ fontSize: 12, color: C.text2, margin: "0 0 4px 21px", lineHeight: 1.5 }}>{r.summary}</p>}
                        {r.autoResolved && r.autoResolved.length > 0 && (
                          <p style={{ fontSize: 11, color: C.green, margin: "0 0 0 21px",
                            display: "flex", alignItems: "center", gap: 3 }}>
                            <CheckCircle2 size={10}/> Auto-resolved {r.autoResolved.length} inspection finding{r.autoResolved.length > 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Inspection findings status overview */}
              {inspectionResult?.findings && inspectionResult.findings.length > 0 && (
                <div style={card()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>Inspection Findings Status</p>
                    <button
                      onClick={() => { setReviewFindings(inspectionResult.findings ?? []); setShowReviewModal(true); }}
                      style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: "none", border: "none", cursor: "pointer" }}
                    >
                      Review All →
                    </button>
                  </div>
                  {inspectionResult.findings.map((f, i) => {
                    const key = toCategoryKey(f.category);
                    const status = findingStatuses[key] ?? "open";
                    const statusConfig: Record<FindingStatus, { label: string; color: string; bg: string }> = {
                      open:       { label: "Open",         color: C.red,    bg: C.redBg    },
                      completed:  { label: "Completed",    color: C.green,  bg: C.greenBg  },
                      monitored:  { label: "Monitoring",   color: C.accent, bg: "#eff6ff"  },
                      not_sure:   { label: "Not Sure",     color: C.amber,  bg: C.amberBg  },
                      dismissed:  { label: "Dismissed",    color: C.text3,  bg: C.bg       },
                    };
                    const cfg = statusConfig[status];
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 0",
                        borderBottom: i < (inspectionResult.findings?.length ?? 0) - 1 ? `1px solid ${C.border}` : "none",
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3, flexShrink: 0 }}/>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: status === "completed" || status === "dismissed" ? C.text3 : C.text, textDecoration: status === "completed" ? "line-through" : "none" }}>{f.category}</span>
                        <select
                          value={status}
                          onChange={e => toggleFindingStatus(f.category, e.target.value as FindingStatus)}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20,
                            border: `1px solid ${cfg.color}40`,
                            background: cfg.bg, color: cfg.color,
                            cursor: "pointer", outline: "none",
                          }}
                        >
                          <option value="open">Open</option>
                          <option value="completed">Completed</option>
                          <option value="monitored">Monitoring</option>
                          <option value="not_sure">Not Sure</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 14, padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
                    <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>
                      {completedFindings.length} resolved
                    </span>
                    <span style={{ fontSize: 13, color: C.text3, marginLeft: 8 }}>
                      · {activeFindings.length} still open
                    </span>
                    <span style={{ fontSize: 13, color: C.text3, marginLeft: 8 }}>
                      · {activeFindings.filter(f => f.severity === "critical").length} critical
                    </span>
                  </div>
                </div>
              )}

              {/* Generic document upload */}
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <Upload size={14} color={C.accent}/><span style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Upload Other Document</span>
                </div>
                <p style={{ fontSize: 13, color: C.text3, marginBottom: 14 }}>Warranties, permits, HOA docs, and other property files.</p>
                <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 16px", borderRadius: 12, cursor: "pointer", border: `2px dashed ${docLoading ? C.accent : C.border}`, background: docLoading ? "#eff6ff" : "#fafbfc" }}>
                  {docLoading ? <><Loader2 size={20} color={C.accent} className="animate-spin"/><span style={{ fontSize: 14, color: C.accent }}>Uploading…</span></> : <><CloudUpload size={20} color={C.text3}/><span style={{ fontSize: 14, color: C.text }}>Click to upload file</span></>}
                  <input ref={docRef} type="file" style={{ display: "none" }} onChange={uploadDoc} disabled={docLoading}/>
                </label>
              </div>
              {docs.length > 0 && (
                <div style={card()}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 12px" }}>Uploaded Files</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {docs.map((doc, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: 10, padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <FileText size={14} color={C.text3}/>
                          <span style={{ fontSize: 14, color: C.text }}>{doc.name}</span>
                        </div>
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: C.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>
                            View <ExternalLink size={11}/>
                          </a>
                        ) : (
                          <span style={{ fontSize: 13, color: C.text3 }}>Unavailable</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
                      <input value={val} onChange={e => set(e.target.value)} placeholder={ph} style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
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
                { label: "Email Notifications", value: "Add RESEND_API_KEY in Vercel to enable", connected: false },
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
                  background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 65%, #1e3a5f 100%)`,
                  borderRadius: 20, padding: isMobile ? "20px 18px" : "28px 32px", cursor: "pointer",
                  transition: "all 0.15s", position: "relative", overflow: "hidden",
                  boxShadow: "0 4px 20px rgba(15,31,61,0.12)",
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
                        {criticalCount > 0 ? `${criticalCount} critical` : warningCount > 0 ? `${warningCount} warnings` : "All systems OK"}
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
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>Click to explore</p>
                  </div>
                  )}
                </div>
              </div>
            ) : (
              /* Empty state hero */
              <div style={{
                background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 65%, #1e3a5f 100%)`,
                borderRadius: 20, padding: isMobile ? "20px 18px" : "28px 32px", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 16 : 28,
                boxShadow: "0 4px 20px rgba(15,31,61,0.12)",
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

            {/* ── SECONDARY HERO: AI Butler ─────────────────────────── */}
            <div style={{ ...card(), background: "linear-gradient(135deg, #f8faff 0%, #eff6ff 100%)", border: `1px solid ${C.accent}20` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(37,99,235,0.3)" }}>
                  <Sparkles size={16} color="white"/>
                </div>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>Ask Butler</p>
                  <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>Your AI home advisor</p>
                </div>
              </div>
              {/* Conversation thread */}
              {chatMessages.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12,
                  maxHeight: 320, overflowY: "auto", paddingRight: 2 }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    }}>
                      <div style={{
                        maxWidth: "85%", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        padding: "9px 13px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                        background: msg.role === "user" ? C.accent : C.surface,
                        color: msg.role === "user" ? "white" : C.text,
                        border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div style={{ display: "flex", justifyContent: "flex-start" }}>
                      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px",
                        padding: "9px 13px", display: "flex", alignItems: "center", gap: 6, color: C.text3, fontSize: 13 }}>
                        <Loader2 size={13} className="animate-spin"/> Thinking…
                      </div>
                    </div>
                  )}
                </div>
              )}
              {aiLoading && chatMessages.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.text3, fontSize: 13, marginBottom: 10 }}>
                  <Loader2 size={13} className="animate-spin"/> Thinking…
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && askAI()}
                  placeholder={chatMessages.length > 0 ? "Ask a follow-up…" : inspectDone ? `"What's my most urgent repair?"` : `"What home maintenance should I do this season?"`}
                  style={{ flex: 1, borderRadius: 10, padding: "11px 14px", fontSize: 14, border: `1.5px solid ${C.border}`, background: C.surface, color: C.text, outline: "none" }}/>
                <button onClick={askAI} disabled={aiLoading || !q.trim()}
                  style={{ borderRadius: 10, padding: "11px 18px", border: "none", cursor: "pointer", background: C.accent, color: "white", opacity: aiLoading || !q.trim() ? 0.4 : 1, display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}>
                  {aiLoading ? <Loader2 size={14} className="animate-spin"/> : <><Send size={13}/> Ask</>}
                </button>
              </div>
              {chatMessages.length === 0 && !aiLoading && !isMobile && (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {["What maintenance is due this season?", "How much should I budget for repairs?", "When should I replace my roof?"].map(prompt => (
                    <button key={prompt} onClick={() => { setQ(prompt); }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: `1px solid ${C.border}`, background: C.surface, color: C.text3, cursor: "pointer", fontWeight: 500 }}>
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
              {chatMessages.length > 0 && (
                <button onClick={() => { setChatMessages([]); setAnswer(""); }}
                  style={{ marginTop: 8, fontSize: 11, color: C.text3, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                  Clear conversation
                </button>
              )}
            </div>

            {/* House Photo */}
            <HousePhoto address={toTitleCase(address)} height={isMobile ? 140 : 200} />

            {/* Roof + HVAC status row */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
              {/* Roof */}
              <div style={card({ background: roofYear ? roofSt.bg : C.surface })}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>Roof</p>
                {roofYear ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: roofSt.dot, flexShrink: 0 }}/>
                      <span style={{ fontWeight: 700, fontSize: 18, color: roofSt.color }}>{roofSt.label}</span>
                    </div>
                    <p style={{ fontSize: 13, color: C.text2, margin: 0 }}>Installed {roofYear} · {roofAge} yrs old</p>
                    {roofAge !== null && roofAge >= 15 && (
                      <p style={{ fontSize: 12, color: C.text3, margin: "6px 0 0" }}>~{Math.max(0, 25 - roofAge)} yrs remaining typical life</p>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: C.text3, margin: "0 0 8px" }}>Year not found — enter manually:</p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={roofYear} onChange={e => setRoofYear(e.target.value)} placeholder="e.g. 2005" style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, outline: "none" }}/>
                      <button onClick={saveSettings} style={{ padding: "7px 12px", borderRadius: 8, background: C.accent, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                    </div>
                  </>
                )}
              </div>
              {/* HVAC */}
              <div style={card({ background: hvacYear ? hvacSt.bg : C.surface })}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>HVAC</p>
                {hvacYear ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: hvacSt.dot, flexShrink: 0 }}/>
                      <span style={{ fontWeight: 700, fontSize: 18, color: hvacSt.color }}>{hvacSt.label}</span>
                    </div>
                    <p style={{ fontSize: 13, color: C.text2, margin: 0 }}>Installed {hvacYear} · {hvacAge} yrs old</p>
                    {hvacAge !== null && hvacAge >= 8 && (
                      <p style={{ fontSize: 12, color: C.text3, margin: "6px 0 0" }}>~{Math.max(0, 15 - hvacAge)} yrs remaining typical life</p>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: C.text3, margin: "0 0 8px" }}>Year not found — enter manually:</p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={hvacYear} onChange={e => setHvacYear(e.target.value)} placeholder="e.g. 2015" style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, outline: "none" }}/>
                      <button onClick={saveSettings} style={{ padding: "7px 12px", borderRadius: 8, background: C.accent, border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                    </div>
                  </>
                )}
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
              <div style={card({ display: "flex", gap: 14, alignItems: "center" })}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "#0891b218", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Shield size={18} color="#0891b2"/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: 0 }}>Insurance</p>
                  {insurance ? (
                    <>
                      <p style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "3px 0 2px" }}>${insurance.premium?.toLocaleString()}/yr</p>
                      <p style={{ fontSize: 12, color: C.text3 }}>{insurance.provider ?? "Active"}{insurance.expirationDate ? ` · Renews ${insurance.expirationDate}` : ""}</p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "3px 0 6px" }}>—</p>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid #0891b2", background: "transparent", color: "#0891b2", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {parsingInsurance ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                        {parsingInsurance ? "Parsing…" : "Upload Policy"}
                        <input ref={insuranceRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={uploadInsurance} disabled={parsingInsurance}/>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Property Tax */}
              <div style={card({ display: "flex", gap: 14, alignItems: "center" })}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "#7c3aed18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <BarChart3 size={18} color="#7c3aed"/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: 0 }}>Property Tax</p>
                  {propertyTax ? (
                    <>
                      <p style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "3px 0 2px" }}>${propertyTax.toLocaleString()}/yr</p>
                      <p style={{ fontSize: 12, color: C.text3 }}>~${Math.round(propertyTax / 12).toLocaleString()}/mo{homeValue ? ` · Est. $${Math.round(homeValue / 1000)}K` : ""}</p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.text3, margin: "3px 0 6px" }}>—</p>
                      <button onClick={() => fetchPropertyData(address)} disabled={fetchingProperty} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: fetchingProperty ? 0.6 : 1 }}>
                        {fetchingProperty ? <Loader2 size={11} className="animate-spin"/> : <Sparkles size={11}/>}
                        {fetchingProperty ? "Fetching…" : "Auto-Fetch"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

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
                  {inspectionResult.findings && inspectionResult.findings.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 6 }}>
                      {inspectionResult.findings.map((f, i) => {
                        const dotColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
                        return (
                          <div key={i} onClick={() => openCostModal({ label: f.category, horizon: f.severity === "critical" ? "Immediate" : "Within 1–2 yrs", amount: f.estimated_cost ?? 0, severity: f.severity, finding: f, tradeCategory: f.category })}
                            style={{ display: "flex", gap: 10, padding: "9px 12px", borderRadius: 9, background: C.bg, border: `1px solid ${C.border}`, alignItems: "flex-start", cursor: "pointer" }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
                            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 4 }}/>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.category}</span>
                              <span style={{ fontSize: 11, color: C.text3, display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.description}</span>
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

            {/* Upcoming Costs — CLICKABLE */}
            {costs.length > 0 && (
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <TrendingDown size={14} color={C.red}/>
                    <span style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Upcoming Costs</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.red, background: C.redBg, padding: "3px 10px", borderRadius: 20 }}>
                      ${costs.reduce((s, c) => s + c.amount, 0).toLocaleString()} projected
                    </span>
                    <button onClick={() => setNav("Repairs")} style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: "transparent", border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                      View all <ArrowRight size={11}/>
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {costs.map((c, i) => {
                    const col = c.severity === "critical" ? C.red : c.severity === "warning" ? C.amber : C.text3;
                    const bg  = c.severity === "critical" ? C.redBg : c.severity === "warning" ? C.amberBg : C.bg;
                    return (
                      <div key={i} onClick={() => openCostModal(c)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: bg, border: `1px solid ${col}22`, cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.transform = "translateX(2px)"; e.currentTarget.style.borderColor = col + "55"; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = col + "22"; }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{c.label}</span>
                          <span style={{ fontSize: 12, color: C.text3, marginLeft: 8 }}>{c.horizon}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: col, flexShrink: 0 }}>${c.amount.toLocaleString()}</span>
                        <button onClick={e => { e.stopPropagation(); handleFindVendors(c.tradeCategory ?? c.label, c.label); }}
                          style={{ padding: "4px 10px", borderRadius: 7, background: C.accent, border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <Users size={11}/> Find Vendors
                        </button>
                        <ChevronRight size={14} color={C.text3} style={{ flexShrink: 0 }}/>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: 12, color: C.text3, marginTop: 10 }}>
                  * Estimates based on national averages and system ages. Click any item for details.
                </p>
              </div>
            )}

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
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.navyMid, marginTop: 4 }}/>
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

            {/* Demo Mode */}
            <div style={{ ...card(), background: "#f0fdf4", border: `1px solid ${C.green}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15, color: C.green, marginBottom: 3 }}>Load Demo Property</p>
                  <p style={{ fontSize: 13, color: C.text2 }}>Instantly populate with a sample home for demos or testing.</p>
                </div>
                <button onClick={() => {
                  setAddress("4589 Warwick Circle, Oceanside CA 92056");
                  setRoofYear("2004"); setHvacYear("2012");
                  addEvent("Roof inspection completed — replacement recommended ($12,500)");
                  addEvent("HVAC system aging — service due ($350)");
                  addEvent("Electrical panel upgrade needed ($3,200)");
                  setInspectDone(true); setInspectErr("");
                  setInspectionResult({
                    inspection_type: "General Home Inspection",
                    summary: "97-page inspection completed. Roof is 20+ years old and needs replacement. HVAC is aging. Minor electrical and plumbing items noted.",
                    findings: [
                      { category: "Roof",       description: "Roof is original (2004), showing significant wear. Replacement recommended within 1–2 years.", severity: "critical", estimated_cost: 12500 },
                      { category: "HVAC",       description: "HVAC unit from 2012, nearing end of service life. Annual service recommended.",                 severity: "warning",  estimated_cost: 350   },
                      { category: "Electrical", description: "Panel upgrade recommended for modern load requirements. Current panel is 100A.",                  severity: "warning",  estimated_cost: 3200  },
                      { category: "Plumbing",   description: "Minor drip at master bathroom faucet. Easy fix — replace cartridge.",                             severity: "info",     estimated_cost: 150   },
                    ],
                    recommendations: ["Replace roof within 1–2 years", "Service HVAC annually", "Budget for electrical panel upgrade"],
                    total_estimated_cost: 16200,
                  });
                }} style={{ padding: "10px 22px", borderRadius: 10, background: C.green, color: "#fff", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}>
                  Load Demo
                </button>
              </div>
            </div>

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
