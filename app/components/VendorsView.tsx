"use client";
import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Send, Loader2, Search, ChevronRight,
  AlertTriangle, CheckCircle2, ExternalLink, X, MapPin, Phone, Star,
  Home, Droplets, Zap, Wind, Bug, Layers, Wrench, Hammer,
  DollarSign, HelpCircle, MessageSquare, Info, AlertOctagon,
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

// Placeholder vendor cards shown before Google Places API is connected
function getMockVendors(categoryLabel: string, address: string) {
  const city = address?.split(",")[1]?.trim() || "your area";
  return [
    { name: `${city} ${categoryLabel} Pros`,      rating: 4.8, reviews: 312, phone: "(760) 555-0142", badge: "Top Rated",     badgeColor: C.green,  years: "12 yrs in business", license: "Licensed & Insured" },
    { name: `Pacific ${categoryLabel} Solutions`, rating: 4.6, reviews: 187, phone: "(760) 555-0287", badge: "Fast Response", badgeColor: C.accent, years: "8 yrs in business",  license: "Licensed & Insured" },
    { name: `Quality ${categoryLabel} Services`,  rating: 4.5, reviews: 94,  phone: "(760) 555-0391", badge: "Free Estimates",badgeColor: C.amber,  years: "5 yrs in business",  license: "Licensed & Insured" },
  ];
}

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
}

export default function VendorsView({ address, inspectionFindings, userEmail, userId, prefillTrade, prefillContext }: Props) {
  const [input, setInput]             = useState("");
  const [listening, setListening]     = useState(false);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<ClassifyResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<Finding | null>(null);
  const [sentJobs, setSentJobs]       = useState<Record<string, string>>({});
  const [sendingJob, setSendingJob]   = useState<string | null>(null);
  const recognitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-select trade when opened via a CTA with a prefill key
  useEffect(() => {
    if (!prefillTrade) return;
    const match = CATEGORIES.find(c => c.key === prefillTrade);
    if (match) {
      setSelectedCategory(match.label);
      setResult(null);
      setActiveIssue(null);
      setInput("");
    }
  }, [prefillTrade]);

  async function requestQuote(vendorName: string) {
    if (!result) return;
    setSendingJob(vendorName);
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
        const jobUrl = `${window.location.origin}/job/${data.job_id}`;
        setSentJobs(prev => ({ ...prev, [vendorName]: jobUrl }));
      }
    } catch { /* silent */ }
    setSendingJob(null);
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
    setLoading(true); setResult(null); setSelectedCategory(null); setActiveIssue(null);
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
  const vendors = selectedCategory ? getMockVendors(selectedCategory, address) : [];
  const city    = address?.split(",").slice(1).join(",").trim() || "your area";
  const zip     = address?.match(/\d{5}/)?.[0] || "";

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

        <div style={{ display: "flex", gap: 8 }}>
          {/* Mic button */}
          <button onClick={toggleListen} style={{
            width: 46, height: 46, borderRadius: 12, border: "none", cursor: "pointer", flexShrink: 0,
            background: listening ? C.red : C.navy,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: listening ? `0 0 0 4px ${C.redBg}` : "none",
            transition: "all 0.2s",
          }}>
            {listening ? <MicOff size={18} color="white"/> : <Mic size={18} color="white"/>}
          </button>

          {/* Text input */}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && classifyIssue()}
            placeholder={listening ? "Listening — speak your issue, then press Find Vendors" : '"I have a leak under my sink" or "roof is missing shingles"'}
            style={{
              flex: 1, height: 46, borderRadius: 12, padding: "0 14px", fontSize: 15,
              border: `1.5px solid ${listening ? C.red : C.border}`,
              background: listening ? C.redBg : C.bg, color: C.text, outline: "none",
              transition: "all 0.2s",
            }}
          />

          {/* Find vendors button */}
          <button onClick={() => classifyIssue()} disabled={loading || !input.trim()} style={{
            height: 46, padding: "0 18px", borderRadius: 12, border: "none", cursor: "pointer",
            background: C.navyMid, color: "white", fontSize: 15, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 7,
            opacity: loading || !input.trim() ? 0.5 : 1, transition: "opacity 0.2s",
          }}>
            {loading ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>}
            {loading ? "Finding…" : "Find Vendors"}
          </button>
        </div>

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

          <div style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
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

      {/* ── Vendor Cards ───────────────────────────────────────────── */}
      {selectedCategory && (
        <div style={card()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>
                {selectedCategory} Contractors Near You
              </p>
              <p style={{ fontSize: 14, color: C.text3, display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <MapPin size={12}/> {city}
              </p>
            </div>
            {/* External search links */}
            <div style={{ display: "flex", gap: 6 }}>
              {(result?.search_terms ?? [selectedCategory.toLowerCase()]).slice(0, 1).map(term => (
                <div key={term} style={{ display: "flex", gap: 6 }}>
                  <a href={googleLink(term)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text2, fontSize: 12, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={11}/> Google Maps
                  </a>
                  <a href={yelpLink(term)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: "#d32323", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={11}/> Yelp
                  </a>
                  <a href={angiLink(term)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: "#f27a1a", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={11}/> Angi
                  </a>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {vendors.map((v, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 16, padding: "14px 16px",
                borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg,
              }}>
                {/* Avatar — initial letter, no emoji */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: `linear-gradient(135deg, ${C.navyMid}, ${C.accent})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: "white", fontWeight: 800,
                }}>
                  {v.name[0]}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{v.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${v.badgeColor}18`, color: v.badgeColor }}>
                      {v.badge}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 13, color: C.amber }}>
                      <Star size={11} fill={C.amber}/> {v.rating} ({v.reviews} reviews)
                    </span>
                    <span style={{ fontSize: 13, color: C.text3 }}>·</span>
                    <span style={{ fontSize: 13, color: C.text3 }}>{v.years}</span>
                    <span style={{ fontSize: 13, color: C.text3 }}>·</span>
                    <span style={{ fontSize: 13, color: C.green }}>{v.license}</span>
                  </div>
                </div>

                {/* Phone + Quote */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                  <a href={`tel:${v.phone}`} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: C.text2, textDecoration: "none", fontWeight: 600 }}>
                    <Phone size={12}/> {v.phone}
                  </a>
                  {sentJobs[v.name] ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <span style={{ fontSize: 12, color: C.green, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle2 size={12}/> Job Sent
                      </span>
                      <a href={sentJobs[v.name]} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: C.accent, textDecoration: "underline" }}>
                        View job link <ChevronRight size={10} style={{ verticalAlign: "middle" }}/>
                      </a>
                    </div>
                  ) : (
                    <button
                      onClick={() => requestQuote(v.name)}
                      disabled={sendingJob === v.name || !result}
                      style={{
                        padding: "7px 14px", borderRadius: 8, border: "none",
                        cursor: result ? "pointer" : "not-allowed",
                        background: result ? C.navyMid : C.text3, color: "white",
                        fontSize: 13, fontWeight: 600,
                        display: "flex", alignItems: "center", gap: 5,
                        opacity: sendingJob === v.name ? 0.7 : 1,
                      }}>
                      {sendingJob === v.name
                        ? <><Loader2 size={11} className="animate-spin"/> Sending…</>
                        : result
                          ? <><Send size={11}/> Send Job</>
                          : "Describe issue first"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: C.text3, marginTop: 14, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <Info size={11}/> Vendor listings are illustrative. Connect Google Places API for live local results.
          </p>
        </div>
      )}
    </div>
  );
}
