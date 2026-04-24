"use client";
import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Send, Loader2, Search, ChevronRight,
  AlertTriangle, CheckCircle2, ExternalLink, X, MapPin,
  Home, Droplets, Zap, Wind, Bug, Layers, Wrench,
  DollarSign, HelpCircle, MessageSquare, AlertOctagon,
  Thermometer, Paintbrush, AlignLeft, Clock,
} from "lucide-react";

const C = {
  bg:      "#f0f4f8",
  surface: "#ffffff",
  navy:    "#0f1f3d",
  navyMid: "#1e3a8a",
  accent:  "#2563eb",
  slate:   "#334155",
  text:    "#0f172a",
  text2:   "#475569",
  text3:   "#94a3b8",
  border:  "#e2e8f0",
  green:   "#16a34a",
  greenBg: "#f0fdf4",
  amber:   "#d97706",
  amberBg: "#fffbeb",
  red:     "#dc2626",
  redBg:   "#fef2f2",
};

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.surface, borderRadius: 16,
    border: `1px solid ${C.border}`,
    boxShadow: "0 1px 4px rgba(15,31,61,0.06), 0 4px 16px rgba(15,31,61,0.04)",
    padding: 22, ...extra,
  };
}

// ── Trade icon lookup ─────────────────────────────────────────────────────────
function getTradeIcon(key: string, size = 18, color = C.text3): React.ReactNode {
  const k = key.toLowerCase();
  if (k.includes("roof"))        return <Home size={size} color={color}/>;
  if (k.includes("plumb"))       return <Droplets size={size} color={color}/>;
  if (k.includes("electric"))    return <Zap size={size} color={color}/>;
  if (k.includes("hvac") || k.includes("heat") || k.includes("cool") || k.includes("air"))
                                 return <Thermometer size={size} color={color}/>;
  if (k.includes("pest") || k.includes("termite"))
                                 return <Bug size={size} color={color}/>;
  if (k.includes("found") || k.includes("struct") || k.includes("insul"))
                                 return <Layers size={size} color={color}/>;
  if (k.includes("mold") || k.includes("water") || k.includes("waterproof"))
                                 return <Droplets size={size} color={color}/>;
  if (k.includes("window") || k.includes("door"))
                                 return <Wind size={size} color={color}/>;
  if (k.includes("paint"))       return <Paintbrush size={size} color={color}/>;
  if (k.includes("floor"))       return <AlignLeft size={size} color={color}/>;
  return                                <Wrench size={size} color={color}/>;
}

const CATEGORIES = [
  { key: "roofing",    label: "Roofing"        },
  { key: "plumbing",   label: "Plumbing"       },
  { key: "electrical", label: "Electrical"     },
  { key: "hvac",       label: "HVAC"           },
  { key: "pest",       label: "Pest Control"   },
  { key: "foundation", label: "Foundation"     },
  { key: "mold",       label: "Mold / Water"   },
  { key: "windows",    label: "Windows & Doors"},
  { key: "insulation", label: "Insulation"     },
  { key: "painting",   label: "Painting"       },
  { key: "flooring",   label: "Flooring"       },
  { key: "general",    label: "Handyman"       },
];

const URGENCY_STYLE: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  emergency: { color: C.red,    bg: C.redBg,   label: "Emergency",   icon: <AlertOctagon  size={13}/> },
  urgent:    { color: C.amber,  bg: C.amberBg, label: "Urgent",      icon: <AlertTriangle size={13}/> },
  normal:    { color: C.accent, bg: "#eff6ff", label: "Normal",      icon: <Clock         size={13}/> },
  low:       { color: C.green,  bg: C.greenBg, label: "Low Priority",icon: <CheckCircle2  size={13}/> },
};

// Platform search configs for real vendor discovery
const PLATFORMS = [
  {
    key: "google",
    name: "Google Maps",
    description: "Verified reviews + photos",
    color: "#4285F4",
    bg: "#f0f5ff",
    border: "#c7d9ff",
    logo: "G",
  },
  {
    key: "yelp",
    name: "Yelp",
    description: "Ratings, quotes & portfolios",
    color: "#d32323",
    bg: "#fff5f5",
    border: "#ffc9c9",
    logo: "y",
  },
  {
    key: "angi",
    name: "Angi",
    description: "Background-checked pros",
    color: "#f27a1a",
    bg: "#fff8f0",
    border: "#ffd9aa",
    logo: "A",
  },
];

interface Finding {
  category: string;
  description: string;
  severity: string;
  estimated_cost: number | null;
}

interface ClassifyResult {
  category_label: string;
  category_emoji: string;
  urgency: string;
  urgency_reason: string;
  issue_summary: string;
  what_to_tell_contractor: string;
  diy_tips: string[];
  avg_cost_low: number;
  avg_cost_high: number;
  questions_to_ask: string[];
  search_terms: string[];
}

interface Props {
  address: string;
  inspectionFindings: Finding[];
  userEmail?: string;
  userId?: string;
  prefillTrade?: string;    // CATEGORIES key, e.g. "roofing" — auto-selects category on open
  prefillContext?: string;  // human label for the context banner, e.g. "Roof Replacement"
  prefillIssue?: string;    // pre-typed issue text — auto-fills search and triggers classification
}

export default function VendorsView({ address, inspectionFindings, userEmail, userId, prefillTrade, prefillContext, prefillIssue }: Props) {
  const [input, setInput]             = useState("");
  const [listening, setListening]     = useState(false);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<ClassifyResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<Finding | null>(null);
  const [briefSent, setBriefSent]     = useState(false);
  const [sendingBrief, setSendingBrief] = useState(false);
  const [briefUrl, setBriefUrl]       = useState<string | null>(null);
  const [isMobile, setIsMobile]       = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const recognitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to classifyIssue so the useEffect below can call it
  // without needing it in the dependency array (which would cause a loop).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classifyRef = useRef<(text?: string) => Promise<void>>(null as any);

  // Auto-prefill: if an issue string is provided, populate the search box and
  // trigger classification right away so the user lands on the results.
  // Otherwise, if only a trade key is provided, just pre-select the category.
  useEffect(() => {
    if (prefillIssue) {
      setInput(prefillIssue);
      setResult(null);
      setActiveIssue(null);
      setSelectedCategory(null);
      // Defer until classifyRef is wired up (next tick)
      setTimeout(() => classifyRef.current?.(prefillIssue), 0);
    } else if (prefillTrade) {
      const match = CATEGORIES.find(c => c.key === prefillTrade);
      if (match) {
        setSelectedCategory(match.label);
        setResult(null);
        setActiveIssue(null);
        setInput("");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillTrade, prefillIssue]);

  async function emailContractorBrief() {
    if (!result) return;
    setSendingBrief(true);
    try {
      const res = await fetch("/api/request-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeowner_email:         userEmail ?? null,
          user_id:                 userId ?? null,
          property_address:        address,
          trade:                   result.category_label,
          trade_emoji:             result.category_emoji,
          issue_summary:           result.issue_summary,
          full_description:        input,
          urgency:                 result.urgency,
          urgency_reason:          result.urgency_reason,
          what_to_tell_contractor: result.what_to_tell_contractor,
          diy_tips:                result.diy_tips ?? [],
          questions_to_ask:        result.questions_to_ask ?? [],
          estimated_cost_low:      result.avg_cost_low ?? null,
          estimated_cost_high:     result.avg_cost_high ?? null,
          related_findings:        inspectionFindings.filter(f =>
            f.category.toLowerCase().includes(result.category_label.toLowerCase().split(" ")[0]) ||
            result.category_label.toLowerCase().includes(f.category.toLowerCase().split(" ")[0])
          ),
        }),
      });
      const data = await res.json();
      if (data.job_id) {
        setBriefUrl(`${window.location.origin}/job/${data.job_id}`);
        setBriefSent(true);
      }
    } catch { /* silent */ }
    setSendingBrief(false);
  }

  function toggleListen() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Speech recognition not supported in this browser. Try Chrome."); return; }
    if (listening) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recognitionRef.current as any)?.stop();
      setListening(false);
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
      // Populate input but don't auto-submit — let user review first
    };
    rec.onerror = () => setListening(false);
    rec.onend   = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function classifyIssue(text?: string) {
    const query = (text ?? input).trim();
    if (!query) return;
    // Keep ref current so the prefill useEffect can call this before render
    classifyRef.current = classifyIssue;
    setLoading(true); setResult(null); setSelectedCategory(null); setActiveIssue(null);
    setBriefSent(false); setBriefUrl(null);
    try {
      const res = await fetch("/api/classify-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue: query }),
      });
      const data = await res.json();
      setResult(data);
      setSelectedCategory(data.category_label);
    } catch { /* silent */ }
    setLoading(false);
  }

  function handleFindingClick(f: Finding) {
    setActiveIssue(f);
    setInput(f.description);
    classifyIssue(f.description);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCategoryClick(cat: typeof CATEGORIES[0]) {
    setSelectedCategory(cat.label);
    setResult(null);
    setActiveIssue(null);
    setInput("");
  }

  const urgencyInfo = result ? (URGENCY_STYLE[result.urgency] ?? URGENCY_STYLE.normal) : null;
  const city    = address?.split(",").slice(1).join(",").trim() || "your area";
  const zip     = address?.match(/\d{5}/)?.[0] || "";
  // Use AI-generated search terms when available, otherwise fall back to category label
  const searchTerm = result?.search_terms?.[0] ?? selectedCategory ?? "";

  function googleLink(term: string) {
    return `https://www.google.com/maps/search/${encodeURIComponent(term + " near " + (zip || city))}`;
  }
  function yelpLink(term: string) {
    return `https://www.yelp.com/search?find_desc=${encodeURIComponent(term)}&find_loc=${encodeURIComponent(zip || city)}`;
  }
  function angiLink(term: string) {
    return `https://www.angi.com/companylist/us/${encodeURIComponent(zip || city)}/${encodeURIComponent(term.replace(/ /g, "-"))}.htm`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── CTA Context Banner (shown when opened via a repair/issue CTA) ── */}
      {prefillContext && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 12,
          background: "#eff6ff", border: "1px solid #bfdbfe",
        }}>
          <Search size={14} color="#2563eb"/>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1d4ed8" }}>
            Showing vendors for: {prefillContext}
          </span>
          <button
            onClick={() => { setSelectedCategory(null); setResult(null); }}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#93c5fd", fontSize: 12 }}>
            Browse all →
          </button>
        </div>
      )}

      {/* ── AI Search Bar ───────────────────────────────────────────── */}
      <div style={card({ padding: 20 })}>
        <p style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          What's going on with your home?
        </p>
        <p style={{ fontSize: 15, color: C.text3, marginBottom: 14 }}>
          Describe any issue — AI will route you to the right contractor instantly.
        </p>

        {/* Input row: mic + text field */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={toggleListen} style={{
            width: 46, height: 46, borderRadius: 12, border: "none", cursor: "pointer", flexShrink: 0,
            background: listening ? C.red : C.navy,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: listening ? `0 0 0 4px ${C.redBg}` : "none",
            transition: "all 0.2s",
          }}>
            {listening ? <MicOff size={18} color="white"/> : <Mic size={18} color="white"/>}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && classifyIssue()}
            placeholder={listening ? "Listening…" : '"Leak under sink" or "missing shingles"'}
            style={{
              flex: 1, height: 46, borderRadius: 12, padding: "0 14px", fontSize: isMobile ? 16 : 15,
              border: `1.5px solid ${listening ? C.red : C.border}`,
              background: listening ? C.redBg : C.bg, color: C.text, outline: "none",
              transition: "all 0.2s",
            }}
          />
        </div>
        {/* Find vendors button — full width on mobile */}
        <button onClick={() => classifyIssue()} disabled={loading || !input.trim()} style={{
          width: "100%", height: 48, borderRadius: 12, border: "none", cursor: "pointer",
          background: C.navyMid, color: "white", fontSize: 15, fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          opacity: loading || !input.trim() ? 0.5 : 1, transition: "opacity 0.2s",
        }}>
          {loading ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>}
          {loading ? "Finding…" : "Find Vendors"}
        </button>

        {listening && (
          <p style={{ fontSize: 14, color: C.red, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, display: "inline-block" }}/>
            Recording — speak your issue, then press Find Vendors to search
          </p>
        )}
      </div>

      {/* ── AI Result ─────────────────────────────────────────────── */}
      {result && (
        <div style={card({ padding: 0, overflow: "hidden" })}>
          {/* Header */}
          <div style={{
            padding: "16px 22px", background: urgencyInfo!.bg, borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Trade icon */}
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: `linear-gradient(135deg, ${C.navyMid}, ${C.accent})`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {getTradeIcon(result.category_label, 20, "white")}
              </div>
              <div>
                <p style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>{result.category_label}</p>
                <p style={{ fontSize: 14, color: C.text2, margin: "2px 0 0" }}>{result.issue_summary}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Urgency badge */}
              <span style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: urgencyInfo!.bg, color: urgencyInfo!.color,
                border: `1px solid ${urgencyInfo!.color}40`,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                {urgencyInfo!.icon} {urgencyInfo!.label}
              </span>
              <button onClick={() => setResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3 }}>
                <X size={16}/>
              </button>
            </div>
          </div>

          <div style={{ padding: isMobile ? 16 : 22, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>

            {/* What to tell the contractor */}
            <div style={{ gridColumn: "1 / -1", background: "#eff6ff", borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.accent}30` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                <MessageSquare size={12}/> What to tell the contractor
              </p>
              <p style={{ fontSize: 15, color: C.text, lineHeight: 1.6, margin: 0 }}>{result.what_to_tell_contractor}</p>
            </div>

            {/* Cost estimate */}
            <div style={{ background: C.bg, borderRadius: 10, padding: "12px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                <DollarSign size={12}/> Cost Estimate
              </p>
              <p style={{ fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", margin: 0 }}>
                ${result.avg_cost_low?.toLocaleString()} – ${result.avg_cost_high?.toLocaleString()}
              </p>
              <p style={{ fontSize: 13, color: C.text3, marginTop: 3 }}>Typical range for this repair</p>
            </div>

            {/* Urgency */}
            <div style={{ background: C.bg, borderRadius: 10, padding: "12px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                <Clock size={12}/> Timeline
              </p>
              <p style={{ fontSize: 15, color: urgencyInfo!.color, fontWeight: 600, margin: 0 }}>{urgencyInfo!.label}</p>
              <p style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>{result.urgency_reason}</p>
            </div>

            {/* DIY tips */}
            {result.diy_tips?.length > 0 && (
              <div style={{ background: C.greenBg, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.green}30` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                  <Wrench size={12}/> While You Wait
                </p>
                {result.diy_tips.map((tip, i) => (
                  <p key={i} style={{ fontSize: 14, color: C.text, marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${C.green}` }}>
                    {tip}
                  </p>
                ))}
              </div>
            )}

            {/* Questions to ask */}
            {result.questions_to_ask?.length > 0 && (
              <div style={{ background: C.amberBg, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.amber}30` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                  <HelpCircle size={12}/> Ask Contractors
                </p>
                {result.questions_to_ask.map((q, i) => (
                  <p key={i} style={{ fontSize: 14, color: C.text, marginBottom: 4 }}>
                    {i + 1}. {q}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Issues from Inspection ──────────────────────────────────── */}
      {inspectionFindings.length > 0 && (
        <div style={card()}>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 7 }}>
            <Search size={15} color={C.accent}/> Issues from Your Inspection
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inspectionFindings.map((f, i) => {
              const dotColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
              const isActive = activeIssue === f;
              return (
                <button key={i} onClick={() => handleFindingClick(f)} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  borderRadius: 10, border: `1.5px solid ${isActive ? C.accent : C.border}`,
                  background: isActive ? "#eff6ff" : C.bg, cursor: "pointer", textAlign: "left",
                  transition: "all 0.15s",
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{f.category}</span>
                    <span style={{ fontSize: 13, color: C.text2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.description}
                    </span>
                  </div>
                  {f.estimated_cost != null && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: dotColor, flexShrink: 0 }}>
                      ${f.estimated_cost.toLocaleString()}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: C.accent, fontWeight: 600, flexShrink: 0 }}>
                    Find Vendors <ChevronRight size={12} style={{ verticalAlign: "middle" }}/>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Category Grid ──────────────────────────────────────────── */}
      <div style={card()}>
        <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>
          Browse by Trade
        </p>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(6, 1fr)", gap: 10 }}>
          {CATEGORIES.map(cat => {
            const isSelected = selectedCategory === cat.label;
            return (
              <button key={cat.key} onClick={() => handleCategoryClick(cat)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                padding: "14px 8px", borderRadius: 12, border: "1.5px solid",
                borderColor: isSelected ? C.accent : C.border,
                background: isSelected ? "#eff6ff" : C.bg,
                cursor: "pointer", transition: "all 0.15s",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: isSelected
                    ? `linear-gradient(135deg, ${C.navyMid}, ${C.accent})`
                    : "rgba(15,31,61,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {getTradeIcon(cat.key, 16, isSelected ? "white" : C.slate)}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, lineHeight: 1.3, textAlign: "center",
                  color: isSelected ? C.accent : C.text2,
                }}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Find Real Vendors ──────────────────────────────────────── */}
      {selectedCategory && (
        <div style={card()}>
          {/* Header */}
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>
              {selectedCategory} Contractors Near You
            </p>
            <p style={{ fontSize: 14, color: C.text3, display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
              <MapPin size={12}/> Searching near {zip || city}
            </p>
          </div>

          {/* Platform cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {PLATFORMS.map(p => {
              const href = p.key === "google"
                ? googleLink(searchTerm)
                : p.key === "yelp"
                ? yelpLink(searchTerm)
                : angiLink(searchTerm);
              return (
                <a key={p.key} href={href} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: "flex", alignItems: "center", gap: 16, padding: "16px 18px",
                    borderRadius: 12, border: `1.5px solid ${p.border}`,
                    background: p.bg, textDecoration: "none",
                    transition: "box-shadow 0.15s",
                  }}>
                  {/* Logo circle */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: p.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, color: "white", fontWeight: 900,
                    fontFamily: "Georgia, serif",
                  }}>
                    {p.logo}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>
                      Search {p.name}
                    </p>
                    <p style={{ fontSize: 13, color: C.text3, margin: "2px 0 0" }}>
                      {p.description} · &ldquo;{searchTerm}&rdquo; near {zip || city}
                    </p>
                  </div>

                  {/* Arrow */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 13, fontWeight: 700, color: p.color, flexShrink: 0,
                  }}>
                    Open <ExternalLink size={13}/>
                  </div>
                </a>
              );
            })}
          </div>

          {/* Contractor brief email CTA */}
          {result && (
            <div style={{
              padding: "16px 18px", borderRadius: 12,
              background: briefSent ? C.greenBg : "#eff6ff",
              border: `1px solid ${briefSent ? C.green + "40" : C.accent + "30"}`,
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: briefSent ? C.green : C.accent, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
                {briefSent ? <><CheckCircle2 size={14}/> Contractor brief sent!</> : <><Send size={13}/> Email yourself the contractor brief</>}
              </p>
              {briefSent ? (
                <div>
                  <p style={{ fontSize: 13, color: C.text2, margin: "0 0 6px" }}>
                    Check <strong>{userEmail}</strong> — it has everything: what to say, cost range, and questions to ask.
                  </p>
                  {briefUrl && (
                    <a href={briefUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: C.accent, textDecoration: "underline", display: "flex", alignItems: "center", gap: 4 }}>
                      View shareable job brief <ChevronRight size={11}/>
                    </a>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: 10 }}>
                  <p style={{ fontSize: 13, color: C.text2, margin: 0 }}>
                    Get a ready-to-share brief with cost estimates, what to tell the contractor, and questions to ask — sent to {userEmail || "your email"}.
                  </p>
                  <button
                    onClick={emailContractorBrief}
                    disabled={sendingBrief}
                    style={{
                      padding: "10px 16px", borderRadius: 8, border: "none",
                      cursor: "pointer", background: C.navyMid, color: "white",
                      fontSize: 13, fontWeight: 600, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      opacity: sendingBrief ? 0.7 : 1,
                    }}>
                    {sendingBrief
                      ? <><Loader2 size={12} className="animate-spin"/> Sending…</>
                      : <><Send size={12}/> Email Brief</>}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
