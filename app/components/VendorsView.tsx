"use client";
import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Send, Loader2, Search, ChevronRight,
  AlertTriangle, CheckCircle2, ExternalLink, X, MapPin,
  Home, Droplets, Zap, Wind, Bug, Layers, Wrench,
  DollarSign, HelpCircle, MessageSquare, AlertOctagon,
  Thermometer, Paintbrush, AlignLeft, Clock,
  Phone, Mail, Copy, ChevronDown, Pencil,
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

// ── Category label formatter ─────────────────────────────────────────────────
// Maps canonical BTLR category keys and raw AI strings to human-readable labels.
function formatCategory(raw: string): string {
  const t = (raw || "").toLowerCase().trim();
  // Exact canonical BTLR keys
  const EXACT: Record<string, string> = {
    electrical:               "Electrical",
    plumbing:                 "Plumbing",
    hvac:                     "HVAC",
    roof_drainage_exterior:   "Roof",
    structure_foundation:     "Structure",
    interior_windows_doors:   "Interior",
    appliances_water_heater:  "Appliances",
    safety_environmental:     "Safety",
    site_grading_drainage:    "Site & Drainage",
    exterior:                 "Exterior",
    maintenance_upkeep:       "Maintenance",
    pool_spa:                 "Pool & Spa",
    general:                  "General",
  };
  if (EXACT[t]) return EXACT[t];
  // Substring fallbacks for raw AI strings
  if (t.includes("roof") || t.includes("gutter"))    return "Roof";
  if (t.includes("electric") || t.includes("panel")) return "Electrical";
  if (t.includes("plumb") || t.includes("pipe"))     return "Plumbing";
  if (t.includes("hvac") || t.includes("heat") || t.includes("furnace") || t.includes("cool")) return "HVAC";
  if (t.includes("found") || t.includes("struct") || t.includes("crawl")) return "Structure";
  if (t.includes("window") || t.includes("door"))    return "Windows & Doors";
  if (t.includes("interior") || t.includes("ceil") || t.includes("floor") || t.includes("wall")) return "Interior";
  if (t.includes("applian") || t.includes("washer") || t.includes("dryer")) return "Appliances";
  if (t.includes("safety") || t.includes("smoke") || t.includes("mold"))   return "Safety";
  if (t.includes("pool") || t.includes("spa"))       return "Pool & Spa";
  // Generic fallback: title-case the raw string
  return raw.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim() || "General";
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

// ── Vendor contact message generator ─────────────────────────────────────────
function generateContactMessage(
  vendorName: string,
  result: ClassifyResult | null,
  address: string,
): string {
  const issueDesc = result?.what_to_tell_contractor ?? result?.issue_summary ?? "a home repair issue";
  const location  = address && address !== "My Home" ? `\nProperty address: ${address}` : "";
  const urgency   = result?.urgency === "emergency"
    ? "\n\n⚠ This is an emergency — I need help as soon as possible."
    : result?.urgency === "urgent"
      ? "\n\nThis is time-sensitive — I'd appreciate a prompt response."
      : "";
  const costRange = result?.avg_cost_low && result?.avg_cost_high
    ? `\n\nBased on my research, the typical range for this work is $${result.avg_cost_low.toLocaleString()}–$${result.avg_cost_high.toLocaleString()}.`
    : "";
  const questions = result?.questions_to_ask?.length
    ? `\n\nA few questions:\n${result.questions_to_ask.slice(0, 3).map(q => `• ${q}`).join("\n")}`
    : "";

  return `Hi ${vendorName},

I found your business and I'm looking for help with a home repair.

Issue: ${issueDesc}${location}${urgency}${costRange}${questions}

Could you let me know your availability and provide a quote?

Thank you`;
}

// ── VendorContactPanel ────────────────────────────────────────────────────────
// Inline panel shown below a vendor card when user taps "Contact"
function VendorContactPanel({
  vendor,
  message,
  onMessageChange,
  onClose,
}: {
  vendor: VendorResult;
  message: string;
  onMessageChange: (msg: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const [contacted, setContacted] = useState<"email" | "call" | null>(null);

  function handleCopy() {
    navigator.clipboard?.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      const el = document.createElement("textarea");
      el.value = message;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  const mailtoHref = `mailto:?subject=${encodeURIComponent(`Repair Quote Request — ${vendor.name}`)}&body=${encodeURIComponent(message)}`;
  const telHref    = vendor.phone ? `tel:${vendor.phone.replace(/\D/g, "")}` : null;

  return (
    <div style={{
      background: "#f8faff",
      border: `1.5px solid ${C.accent}25`,
      borderRadius: 12,
      padding: "16px 18px",
      marginTop: 8,
      marginBottom: 4,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <MessageSquare size={14} color={C.accent}/>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            Contact {vendor.name}
          </span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 2 }}>
          <X size={14}/>
        </button>
      </div>

      {/* Contacted confirmation */}
      {contacted && (
        <div style={{ background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 9, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
          <CheckCircle2 size={14} color={C.green}/>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>
            {contacted === "call" ? "Opening your phone dialer…" : "Opening your email app — message is pre-filled."}
          </span>
        </div>
      )}

      {/* Message preview / edit */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Message Preview
          </span>
          <button
            onClick={() => setEditing(e => !e)}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <Pencil size={10}/>{editing ? "Done" : "Edit"}
          </button>
        </div>

        {editing ? (
          <textarea
            value={message}
            onChange={e => onMessageChange(e.target.value)}
            rows={10}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 9, fontSize: 13, lineHeight: 1.65,
              border: `1.5px solid ${C.accent}`,
              background: "white", color: C.text, outline: "none", resize: "vertical",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        ) : (
          <div style={{
            background: "white", border: `1px solid ${C.border}`, borderRadius: 9,
            padding: "12px 14px", fontSize: 13, lineHeight: 1.65, color: C.text,
            whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto",
          }}>
            {message}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {telHref && (
          <a href={telHref} onClick={() => setContacted("call")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: 9,
              background: C.navy, color: "white",
              fontSize: 13, fontWeight: 700, textDecoration: "none",
              boxShadow: "0 2px 8px rgba(15,31,61,0.18)",
            }}>
            <Phone size={13}/> Call Vendor
          </a>
        )}

        <a href={mailtoHref} onClick={() => setContacted("email")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 9,
            background: C.accent, color: "white",
            fontSize: 13, fontWeight: 700, textDecoration: "none",
          }}>
          <Mail size={13}/> Send Request
        </a>

        <button onClick={handleCopy}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "9px 14px", borderRadius: 9,
            background: copied ? C.greenBg : "white",
            border: `1.5px solid ${copied ? C.green : C.border}`,
            color: copied ? C.green : C.text3,
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
          <Copy size={12}/> {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <p style={{ fontSize: 11, color: C.text3, margin: "10px 0 0", fontStyle: "italic" }}>
        BTLR never sends messages without your approval. Review the message above before sending.
      </p>
    </div>
  );
}

// ── Google Maps singleton loader ──────────────────────────────────────────────
let _mapsPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") { reject(new Error("SSR")); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.maps?.places) { resolve(); return; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY;
    if (!key) { reject(new Error("No Maps API key configured")); return; }
    const s = document.createElement("script");
    // loading=async required for newer Maps JS API behaviour
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&loading=async&v=weekly`;
    s.async = true;
    s.defer = true;
    s.onload  = () => resolve();
    s.onerror = () => { _mapsPromise = null; reject(new Error("Maps script failed to load — check API key restrictions")); };
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

function NearbyVendorsMap({
  searchTerm,
  location,
  result: classifyResult,
  address: vendorAddress,
  onContact,
}: {
  searchTerm: string;
  location: string;
  result?: ClassifyResult | null;
  address?: string;
  onContact?: (vendor: VendorResult) => void;
}) {
  const mapRef   = useRef<HTMLDivElement>(null);
  const [vendors,  setVendors]  = useState<VendorResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    // Don't search if we don't have a real search term or a usable location
    if (!searchTerm || !location || location === "your area") {
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVendors([]);

    // Safety timeout — never spin forever
    const timeout = setTimeout(() => {
      if (!cancelled) { cancelled = true; setError("Search timed out — please try again."); setLoading(false); }
    }, 12000);

    function finish() { clearTimeout(timeout); }

    loadGoogleMaps()
      .then(() => {
        if (cancelled) { finish(); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        if (!g?.maps?.places) { setError("Maps library not available — reload the page."); setLoading(false); finish(); return; }
        if (!mapRef.current) { setLoading(false); finish(); return; }

        // Default center based on location string until geocode resolves
        const defaultCenter = { lat: 33.17, lng: -117.25 };
        const map = new g.maps.Map(mapRef.current, {
          center: defaultCenter, zoom: 12,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
          zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
          styles: [
            { featureType: "poi",     elementType: "labels", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });

        const service = new g.maps.places.PlacesService(map);

        // Geocode using the full property address first (most precise),
        // falling back to city+state. This centers the map on the actual home.
        const geocodeQuery = vendorAddress && vendorAddress !== "My Home"
          ? vendorAddress
          : `${location}, USA`;
        try {
          new g.maps.Geocoder().geocode({ address: geocodeQuery }, (geoRes: any, geoSt: any) => {
            if (!cancelled && geoSt === "OK" && geoRes?.[0])
              map.setCenter(geoRes[0].geometry.location);
          });
        } catch { /* non-blocking */ }

        // Use full address for the nearby search when available — more precise results
        const locSuffix = (vendorAddress && vendorAddress !== "My Home")
          ? vendorAddress
          : location.trim();
        const searchQuery = `${searchTerm} contractor near ${locSuffix}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.textSearch({ query: searchQuery }, (places: any, pStatus: any) => {
          if (cancelled) { finish(); return; }

          // Map all non-OK statuses to a readable message
          const statusMap: Record<string, string> = {
            ZERO_RESULTS:    "No contractors found nearby — try a different trade or location.",
            REQUEST_DENIED:  "Maps access denied — check the API key configuration.",
            INVALID_REQUEST: "Search request was invalid — please try again.",
            OVER_QUERY_LIMIT:"Search quota reached — try again in a moment.",
            UNKNOWN_ERROR:   "Maps returned an error — please try again.",
          };
          const OK = g.maps.places.PlacesServiceStatus?.OK ?? "OK";
          if (pStatus !== OK || !places?.length) {
            setError(statusMap[pStatus] ?? `No results (${pStatus}).`);
            setLoading(false); finish(); return;
          }

          const top3: any[] = places.slice(0, 3);
          const bounds = new g.maps.LatLngBounds();

          if (top3[0]?.geometry?.location) {
            map.setCenter(top3[0].geometry.location);
            map.setZoom(12);
          }

          top3.forEach((place: any, i: number) => {
            if (!place.geometry?.location) return;
            bounds.extend(place.geometry.location);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
              <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24C32 7.163 24.837 0 16 0z" fill="#0f1f3d"/>
              <circle cx="16" cy="16" r="10" fill="#ffffff"/>
              <text x="16" y="21" text-anchor="middle" font-family="Arial" font-size="13" font-weight="bold" fill="#0f1f3d">${i + 1}</text>
            </svg>`;
            new g.maps.Marker({
              position: place.geometry.location, map,
              icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new g.maps.Size(32, 40) },
              title: place.name,
            });
          });
          if (top3.length > 1) map.fitBounds(bounds);

          // Build base results immediately so cards show even if getDetails hangs
          const results2: VendorResult[] = top3.map((p: any) => ({
            name: p.name ?? "Unknown", rating: p.rating,
            userRatingsTotal: p.user_ratings_total,
            vicinity: p.formatted_address ?? p.vicinity,
            placeId: p.place_id,
            mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name ?? "")}&query_place_id=${p.place_id ?? ""}`,
          }));
          // Show cards right away — don't wait for getDetails
          setVendors([...results2]);
          setLoading(false);
          finish();

          // Enrich with phone/website in background
          top3.forEach((place: any, i: number) => {
            if (!place.place_id) return;
            service.getDetails(
              { placeId: place.place_id, fields: ["formatted_phone_number", "website", "url"] },
              (det: any, dStatus: any) => {
                if (cancelled) return;
                const DETOK = g.maps.places.PlacesServiceStatus?.OK ?? "OK";
                if (dStatus === DETOK && det) {
                  results2[i].phone   = det.formatted_phone_number ?? undefined;
                  results2[i].website = det.website ?? undefined;
                  results2[i].mapsUrl = det.url ?? results2[i].mapsUrl;
                  setVendors([...results2]);
                }
              }
            );
          });
        });
      })
      .catch((err: Error) => {
        if (!cancelled) { setError(err.message || "Failed to load map."); setLoading(false); finish(); }
      });

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [searchTerm, location]);

  return (
    <div style={{ minWidth: 0, overflow: "hidden" }}>
      {/* Map */}
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div ref={mapRef} style={{ width: "100%", height: 240 }}/>
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

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            {v.mapsUrl && (
              <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  padding: "6px 12px", borderRadius: 8,
                  background: C.navy, color: "white",
                  fontSize: 12, fontWeight: 600, textDecoration: "none",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                View <ExternalLink size={11}/>
              </a>
            )}
            {onContact && (
              <button
                onClick={() => onContact(v)}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: C.accent, color: "white",
                  fontSize: 12, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                <MessageSquare size={11}/> Contact
              </button>
            )}
          </div>
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

interface ContractorResult {
  name:        string;
  phone:       string | null;
  address:     string | null;
  rating:      number | null;
  reviewCount: number | null;
  website:     string | null;
  mapsUrl:     string;
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
  const [openInspectionCategories, setOpenInspectionCategories] = useState<Set<string>>(new Set());
  const [briefSent, setBriefSent]         = useState(false);
  const [sendingBrief, setSendingBrief]   = useState(false);
  const [briefUrl, setBriefUrl]           = useState<string | null>(null);
  const [isMobile, setIsMobile]           = useState(false);
  const [contactingVendor, setContactingVendor] = useState<VendorResult | null>(null);
  const [contactMessage, setContactMessage]     = useState("");
  // Contractor contact flow
  const [contactMode, setContactMode]     = useState<"choose" | "all" | null>(null);
  const [contractors, setContractors]     = useState<ContractorResult[]>([]);
  const [loadingContractors, setLoadingContractors] = useState(false);
  const [copiedIndex, setCopiedIndex]     = useState<number | null>(null);

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

  async function fetchContractors(mode: "choose" | "all") {
    if (!result) return;
    setContactMode(mode);
    setLoadingContractors(true);
    setContractors([]);
    try {
      const res = await fetch("/api/find-contractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade: result.category_label, address }),
      });
      const data = await res.json();
      setContractors(data.contractors ?? []);
    } catch { /* silent */ }
    setLoadingContractors(false);
  }

  function buildMessage(contractor: ContractorResult): string {
    const city = address?.split(",").slice(1, 2).join(",").trim() || "my area";
    return `Hi ${contractor.name}, I'm a homeowner in ${city} looking for a ${result?.category_label ?? "contractor"} — I've put together a full job brief with all the details here: ${briefUrl}. Are you available to take a look?`;
  }

  function copyMessage(contractor: ContractorResult, index: number) {
    navigator.clipboard.writeText(buildMessage(contractor));
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  async function classifyIssue(text?: string) {
    const query = (text ?? input).trim();
    if (!query) return;
    // Keep ref current so the prefill useEffect can call this before render
    classifyRef.current = classifyIssue;
    setLoading(true); setResult(null); setSelectedCategory(null); setActiveIssue(null);
    setBriefSent(false); setBriefUrl(null); setContactMode(null); setContractors([]);
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
    return `https://www.yelp.com/search?find_desc=${encodeURIComponent(term)}&find_loc=${encodeURIComponent(city || zip)}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0, overflow: "hidden" }}>

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
      {inspectionFindings.length > 0 && (() => {
        // Group findings by formatted category label
        const grouped: Record<string, Finding[]> = {};
        inspectionFindings.forEach(f => {
          const label = formatCategory(f.category);
          if (!grouped[label]) grouped[label] = [];
          grouped[label].push(f);
        });
        const categoryKeys = Object.keys(grouped).sort();

        return (
          <div style={card()}>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 7 }}>
              <Search size={15} color={C.accent}/> Issues from Your Inspection
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {categoryKeys.map(catLabel => {
                const findings = grouped[catLabel];
                const isOpen = openInspectionCategories.has(catLabel);
                const hasCritical = findings.some(f => f.severity === "critical");
                const hasWarning  = findings.some(f => f.severity === "warning");
                const headerColor = hasCritical ? C.red : hasWarning ? C.amber : C.text3;
                return (
                  <div key={catLabel} style={{ borderRadius: 10, border: `1.5px solid ${isOpen ? C.accent : C.border}`, overflow: "hidden" }}>
                    {/* Category header — click to expand */}
                    <button
                      onClick={() => {
                        setOpenInspectionCategories(prev => {
                          const next = new Set(prev);
                          next.has(catLabel) ? next.delete(catLabel) : next.add(catLabel);
                          return next;
                        });
                      }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "11px 14px", background: isOpen ? "#eff6ff" : C.bg,
                        border: "none", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: headerColor, flexShrink: 0 }}/>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{catLabel}</span>
                        <span style={{ fontSize: 12, color: C.text3 }}>{findings.length} issue{findings.length !== 1 ? "s" : ""}</span>
                      </div>
                      <ChevronDown size={14} color={C.text3} style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}/>
                    </button>

                    {/* Expanded findings list */}
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 0 }}>
                        {findings.map((f, i) => {
                          const dotColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
                          const isActive = activeIssue === f;
                          return (
                            <button key={i} onClick={() => handleFindingClick(f)} style={{
                              display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                              border: "none", borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                              background: isActive ? "#eff6ff" : "white", cursor: "pointer", textAlign: "left",
                              transition: "background 0.15s",
                            }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }}/>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13, color: C.text2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {f.description}
                                </span>
                              </div>
                              {f.estimated_cost != null && (
                                <span style={{ fontSize: 13, fontWeight: 700, color: dotColor, flexShrink: 0 }}>
                                  ${f.estimated_cost.toLocaleString()}
                                </span>
                              )}
                              <span style={{ fontSize: 12, color: C.accent, fontWeight: 600, flexShrink: 0 }}>
                                Find <ChevronRight size={11} style={{ verticalAlign: "middle" }}/>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
              <MapPin size={12}/> Searching near {city !== "your area" ? (city || zip) : "your property"}
            </p>
          </div>

          {/* Embedded Google Map — top 3 nearby.
              Only render when we have a real location so the map doesn't
              error out on load with a fallback "your area" string. */}
          {(city !== "your area" || zip) ? (
            <NearbyVendorsMap
              searchTerm={searchTerm}
              location={city || zip}
              result={result}
              address={address}
              onContact={(v) => {
                setContactingVendor(v);
                setContactMessage(generateContactMessage(v.name, result, address));
              }}
            />
          ) : (
            <div style={{ background: C.bg, borderRadius: 12, padding: "20px 16px", textAlign: "center", marginBottom: 12 }}>
              <MapPin size={20} color={C.text3} style={{ marginBottom: 8 }}/>
              <p style={{ fontSize: 14, color: C.text2, margin: 0 }}>Add your property address in Settings to see contractors on the map.</p>
            </div>
          )}

          {/* Vendor contact panel — shown when user taps "Contact" on a vendor card */}
          {contactingVendor && (
            <VendorContactPanel
              vendor={contactingVendor}
              message={contactMessage}
              onMessageChange={setContactMessage}
              onClose={() => setContactingVendor(null)}
            />
          )}

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

          {/* ── Contractor contact flow ── */}
          {result && !briefSent && (
            <div style={{ padding: "16px 18px", borderRadius: 12, background: "#eff6ff", border: `1px solid ${C.accent}30` }}>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: 10 }}>
                <p style={{ fontSize: 13, color: C.text2, margin: 0 }}>
                  Get a ready-to-share brief with cost estimates, what to tell the contractor, and questions to ask.
                </p>
                <button onClick={emailContractorBrief} disabled={sendingBrief} style={{
                  padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: C.navyMid, color: "white", fontSize: 13, fontWeight: 600,
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: sendingBrief ? 0.7 : 1,
                }}>
                  {sendingBrief ? <><Loader2 size={12} className="animate-spin"/> Sending…</> : <><Send size={12}/> Create Job Brief</>}
                </button>
              </div>
            </div>
          )}

          {result && briefSent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* ── Step 1: Brief confirmed + choice ── */}
              <div style={{ padding: "16px 18px", borderRadius: 12, background: C.greenBg, border: `1px solid ${C.green}40` }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.green, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={14}/> Job brief created
                </p>
                {briefUrl && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input readOnly value={briefUrl} style={{ flex: 1, fontSize: 12, color: C.text3, background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 10px", outline: "none" }}/>
                    <button onClick={() => navigator.clipboard.writeText(briefUrl!)} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "white", fontSize: 12, fontWeight: 600, color: C.text2, cursor: "pointer", flexShrink: 0 }}>
                      Copy
                    </button>
                  </div>
                )}
              </div>

              {/* ── Step 2: How to reach out ── */}
              {!contactMode && (
                <div style={{ padding: "16px 18px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}` }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>How would you like to reach out?</p>
                  <p style={{ fontSize: 13, color: C.text3, margin: "0 0 14px" }}>BTLR will find the top 3 nearby {result.category_label} contractors.</p>
                  <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
                    <button onClick={() => fetchContractors("all")} style={{
                      flex: 1, padding: "12px 16px", borderRadius: 10, border: "none",
                      background: C.navy, color: "white", fontSize: 13, fontWeight: 700,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    }}>
                      🚀 Contact all 3 for me
                    </button>
                    <button onClick={() => fetchContractors("choose")} style={{
                      flex: 1, padding: "12px 16px", borderRadius: 10,
                      border: `1.5px solid ${C.border}`, background: C.surface,
                      color: C.text, fontSize: 13, fontWeight: 700,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    }}>
                      👤 Let me choose
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step 3: Contractor list ── */}
              {contactMode && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>
                      {contactMode === "all" ? "Ready to contact — copy each message and send" : "Pick who to contact"}
                    </p>
                    <button onClick={() => { setContactMode(null); setContractors([]); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.text3 }}>← Back</button>
                  </div>

                  {loadingContractors && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px", color: C.text3, fontSize: 13 }}>
                      <Loader2 size={14} className="animate-spin"/> Finding nearby contractors…
                    </div>
                  )}

                  {!loadingContractors && contractors.length === 0 && (
                    <p style={{ fontSize: 13, color: C.text3, padding: "12px 0" }}>No contractors found nearby. Try adjusting your search or browse by trade above.</p>
                  )}

                  {contractors.map((c, i) => (
                    <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={c.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 700, color: C.text, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
                            {c.name} <ExternalLink size={11} color={C.text3}/>
                          </a>
                          {c.rating && (
                            <p style={{ fontSize: 12, color: C.text3, margin: "2px 0 0" }}>
                              ⭐ {c.rating.toFixed(1)}{c.reviewCount ? ` · ${c.reviewCount} reviews` : ""}
                            </p>
                          )}
                          {c.address && <p style={{ fontSize: 12, color: C.text3, margin: "2px 0 0" }}>{c.address}</p>}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {c.phone && (
                          <a href={`tel:${c.phone}`} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "7px 14px", borderRadius: 8,
                            border: `1.5px solid ${C.border}`, background: C.surface,
                            fontSize: 13, fontWeight: 600, color: C.text2, textDecoration: "none",
                          }}>
                            <Phone size={13}/> {c.phone}
                          </a>
                        )}
                        <button onClick={() => copyMessage(c, i)} style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "7px 14px", borderRadius: 8,
                          border: `1.5px solid ${copiedIndex === i ? C.green : C.accent}`,
                          background: copiedIndex === i ? C.greenBg : "#eff6ff",
                          fontSize: 13, fontWeight: 600,
                          color: copiedIndex === i ? C.green : C.accent, cursor: "pointer",
                        }}>
                          {copiedIndex === i ? <><CheckCircle2 size={13}/> Copied!</> : <><Copy size={13}/> Copy Intro</>}
                        </button>
                        {!c.phone && (
                          <a href={c.mapsUrl} target="_blank" rel="noopener noreferrer" style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "7px 14px", borderRadius: 8,
                            border: `1.5px solid ${C.border}`, background: C.surface,
                            fontSize: 13, fontWeight: 600, color: C.text2, textDecoration: "none",
                          }}>
                            <MapPin size={13}/> View on Maps
                          </a>
                        )}
                      </div>

                      {/* Pre-written message preview */}
                      <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: C.text2, lineHeight: 1.5, fontStyle: "italic" }}>
                        "{buildMessage(c)}"
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
