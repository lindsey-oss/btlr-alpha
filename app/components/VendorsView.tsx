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

// ── Google Maps singleton loader ──────────────────────────────────────────────
let _mapsPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") { reject(new Error("SSR")); return; }
    if ((window as unknown as Record<string, unknown>).google) { resolve(); return; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY;
    if (!key) { reject(new Error("No API key")); return; }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Maps"));
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

// ── NearbyVendorsMap component ────────────────────────────────────────────────
interface VendorResult {
  name: string;
  rating?: number;
  userRatingsTotal?: number;
  vicinity?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  placeId?: string;
}

function NearbyVendorsMap({ searchTerm, location }: { searchTerm: string; location: string }) {
  const mapRef   = useRef<HTMLDivElement>(null);
  const [vendors,  setVendors]  = useState<VendorResult[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    if (!searchTerm || !location) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVendors([]);

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as unknown as { google: any }).google;
        const geocoder = new g.maps.Geocoder();
        geocoder.geocode({ address: location }, (results, status) => {
          if (cancelled) return;
          if (status !== "OK" || !results || !results[0]) {
            setError("Couldn't locate your area."); setLoading(false); return;
          }
          const center = results[0].geometry.location;

          if (!mapRef.current) { setLoading(false); return; }
          const map = new g.maps.Map(mapRef.current, {
            center, zoom: 13,
            mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
            zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
            styles: [
              { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
              { featureType: "transit", stylers: [{ visibility: "off" }] },
            ],
          });

          const service = new g.maps.places.PlacesService(map);
          service.textSearch(
            { query: `${searchTerm} contractor`, location: center, radius: 24000 },
            (places, pStatus) => {
              if (cancelled) return;
              if (pStatus !== g.maps.places.PlacesServiceStatus.OK || !places) {
                setError("No results found nearby."); setLoading(false); return;
              }
              const top3 = places.slice(0, 3);
              const bounds = new g.maps.LatLngBounds();

              top3.forEach((place, i) => {
                if (!place.geometry?.location) return;
                bounds.extend(place.geometry.location);

                // Numbered marker
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
                  <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24C32 7.163 24.837 0 16 0z" fill="#0f1f3d"/>
                  <circle cx="16" cy="16" r="10" fill="#ffffff"/>
                  <text x="16" y="21" text-anchor="middle" font-family="Arial" font-size="13" font-weight="bold" fill="#0f1f3d">${i + 1}</text>
                </svg>`;
                new g.maps.Marker({
                  position: place.geometry.location,
                  map,
                  icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new g.maps.Size(32, 40) },
                  title: place.name,
                });
              });
              map.fitBounds(bounds);

              // Fetch details for each
              let done = 0;
              const results2: VendorResult[] = top3.map(p => ({
                name: p.name ?? "Unknown",
                rating: p.rating,
                userRatingsTotal: p.user_ratings_total,
                vicinity: p.formatted_address ?? p.vicinity,
                placeId: p.place_id,
              }));

              top3.forEach((place, i) => {
                if (!place.place_id) { done++; if (done === top3.length) { setVendors(results2); setLoading(false); } return; }
                service.getDetails(
                  { placeId: place.place_id, fields: ["formatted_phone_number", "website", "url"] },
                  (det, dStatus) => {
                    if (cancelled) return;
                    if (dStatus === g.maps.places.PlacesServiceStatus.OK && det) {
                      results2[i].phone   = det.formatted_phone_number ?? undefined;
                      results2[i].website = det.website ?? undefined;
                      results2[i].mapsUrl = det.url ?? undefined;
                    }
                    done++;
                    if (done === top3.length) { setVendors([...results2]); setLoading(false); }
                  }
                );
              });
            }
          );
        });
      })
      .catch((err) => {
        if (!cancelled) { setError(err.message || "Failed to load map."); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [searchTerm, location]);

  return (
    <div>
      {/* Map */}
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div ref={mapRef} style={{ width: "100%", height: 280 }}/>
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(240,244,248,0.85)",
          }}>
            <Loader2 size={24} color={C.accent} className="animate-spin"/>
            <span style={{ marginLeft: 10, fontSize: 13, color: C.text2 }}>Finding nearby contractors…</span>
          </div>
        )}
        {error && !loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(240,244,248,0.92)", flexDirection: "column", gap: 6,
          }}>
            <AlertTriangle size={20} color={C.amber}/>
            <span style={{ fontSize: 13, color: C.text2 }}>{error}</span>
          </div>
        )}
      </div>

      {/* Vendor cards */}
      {vendors.map((v, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px",
          borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.surface,
          marginBottom: 8,
        }}>
          {/* Number badge */}
          <div style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
            background: C.navy, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 14,
          }}>{i + 1}</div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>
              {v.mapsUrl
                ? <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: "none" }}>{v.name}</a>
                : v.name}
            </p>
            {(v.rating !== undefined) && (
              <p style={{ fontSize: 12, color: C.text2, margin: "0 0 3px" }}>
                ⭐ {v.rating.toFixed(1)}{v.userRatingsTotal ? ` (${v.userRatingsTotal.toLocaleString()} reviews)` : ""}
              </p>
            )}
            {v.vicinity && (
              <p style={{ fontSize: 12, color: C.text3, margin: "0 0 3px", display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={11}/> {v.vicinity}
              </p>
            )}
            {v.phone && (
              <a href={`tel:${v.phone}`} style={{ fontSize: 12, color: C.accent, textDecoration: "none", display: "block", marginBottom: 2 }}>
                📞 {v.phone}
              </a>
            )}
          </div>

          {/* View link */}
          {v.mapsUrl && (
            <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer"
              style={{
                padding: "6px 12px", borderRadius: 8,
                background: C.navy, color: "white",
                fontSize: 12, fontWeight: 600, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
              }}>
              View <ExternalLink size={11}/>
            </a>
          )}
        </div>
      ))}
    </div>
  );
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

  function yelpLink(term: string) {
    return `https://www.yelp.com/search?find_desc=${encodeURIComponent(term)}&find_loc=${encodeURIComponent(zip || city)}`;
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

          {/* Embedded Google Map — top 3 nearby */}
          <NearbyVendorsMap searchTerm={searchTerm} location={zip || city} />

          {/* Yelp link */}
          <a href={yelpLink(searchTerm)} target="_blank" rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 16, padding: "14px 18px",
              borderRadius: 12, border: "1.5px solid #ffc9c9",
              background: "#fff5f5", textDecoration: "none", marginBottom: 18,
            }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: "#d32323",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "white", fontWeight: 900,
              fontFamily: "Georgia, serif",
            }}>y</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>Search Yelp</p>
              <p style={{ fontSize: 13, color: C.text3, margin: "2px 0 0" }}>
                Ratings, quotes &amp; portfolios · &ldquo;{searchTerm}&rdquo; near {zip || city}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: "#d32323", flexShrink: 0 }}>
              Open <ExternalLink size={13}/>
            </div>
          </a>

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
