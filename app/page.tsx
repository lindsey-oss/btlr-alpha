"use client";
import { useState, useEffect, useRef } from "react";
import {
  Home, Activity, DollarSign, Wrench,
  Bot, TrendingUp, FileText, FolderOpen,
  CheckCircle2, ArrowRight, Shield, Clock,
  ChevronDown, ChevronRight,
} from "lucide-react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:       "#f5f4f0",
  surface:  "#ffffff",
  border:   "#e8e4de",
  text:     "#0f172a",
  mid:      "#64748b",
  muted:    "#94a3b8",
  accent:   "#2563eb",
  accentBg: "#eff6ff",
  green:    "#16a34a",
  gold:     "#d97706",
  purple:   "#7c3aed",
  rose:     "#e11d48",
};

// ── House illustration with scroll-driven reveal ───────────────────────────────
function HouseIllustration({ progress }: { progress: number }) {
  const p1 = Math.min(1, progress / 0.3);
  const p2 = Math.min(1, Math.max(0, (progress - 0.28) / 0.37));
  const p3 = Math.min(1, Math.max(0, (progress - 0.62) / 0.38));

  const wallFill   = `rgb(${255}, ${255}, ${255})`;
  const roofFill   = `hsl(220, 14%, ${Math.round(32 + p1 * 10)}%)`;
  const windowGlow = p2 > 0 ? `rgba(254, 243, 199, ${p2 * 0.9})` : "#f8fafc";
  const winRight   = p2 > 0.4 ? `rgba(219, 234, 254, ${(p2 - 0.4) / 0.6})` : "#f8fafc";

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
      <svg viewBox="0 0 420 380" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Shadow under house */}
        <ellipse cx="210" cy="338" rx="130" ry="10" fill="rgba(0,0,0,0.06)" opacity={p1} />

        {/* Ground */}
        <rect x="60" y="332" width="300" height="6" rx="3" fill="#e8e4de" opacity={p1} />

        {/* Left tree */}
        <g opacity={p1 * 0.85} style={{ transition: "opacity 0.8s" }}>
          <rect x="72" y="303" width="8" height="30" fill="#a8a29e" />
          <circle cx="76" cy="290" r="24" fill="#bbf7d0" />
          <circle cx="63" cy="298" r="16" fill="#86efac" />
          <circle cx="89" cy="296" r="14" fill="#86efac" />
        </g>

        {/* Right tree */}
        <g opacity={p1 * 0.7} style={{ transition: "opacity 1s" }}>
          <rect x="338" y="308" width="7" height="25" fill="#a8a29e" />
          <circle cx="341" cy="297" r="19" fill="#bbf7d0" />
          <circle cx="354" cy="304" r="13" fill="#86efac" />
        </g>

        {/* House walls */}
        <rect
          x="110" y="198" width="200" height="134" rx="3"
          fill={wallFill} stroke="#d1cec8" strokeWidth="1.5"
          opacity={p1}
          style={{ transition: "opacity 0.5s" }}
        />

        {/* Roof */}
        <polygon
          points="96,200 210,100 324,200"
          fill={roofFill}
          opacity={p1}
          style={{ transition: "all 0.7s" }}
        />
        {/* Roof ridge highlight */}
        <line x1="210" y1="100" x2="210" y2="200" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" opacity={p1} />

        {/* Chimney */}
        <rect x="265" y="118" width="22" height="48" rx="2" fill="#9ca3af" opacity={p1} />
        <rect x="263" y="114" width="26" height="8" rx="2" fill="#6b7280" opacity={p1} />

        {/* Left window */}
        <rect x="124" y="222" width="58" height="48" rx="4"
          fill={windowGlow} stroke="#d1cec8" strokeWidth="1.5"
          opacity={p1}
          style={{ transition: "fill 0.9s" }}
        />
        <line x1="153" y1="222" x2="153" y2="270" stroke="#d1cec8" strokeWidth="1" opacity={p1} />
        <line x1="124" y1="246" x2="182" y2="246" stroke="#d1cec8" strokeWidth="1" opacity={p1} />
        {/* Left window warm glow */}
        {p2 > 0 && (
          <rect x="125" y="223" width="56" height="46" rx="3"
            fill={`rgba(251, 191, 36, ${p2 * 0.25})`}
            style={{ transition: "fill 0.8s" }}
          />
        )}

        {/* Right window */}
        <rect x="238" y="222" width="58" height="48" rx="4"
          fill={winRight} stroke="#d1cec8" strokeWidth="1.5"
          opacity={p1}
          style={{ transition: "fill 0.9s" }}
        />
        <line x1="267" y1="222" x2="267" y2="270" stroke="#d1cec8" strokeWidth="1" opacity={p1} />
        <line x1="238" y1="246" x2="296" y2="246" stroke="#d1cec8" strokeWidth="1" opacity={p1} />

        {/* Score display in right window */}
        {p3 > 0.1 && (
          <g opacity={Math.min(1, (p3 - 0.1) / 0.5)} style={{ transition: "opacity 0.6s" }}>
            <rect x="241" y="225" width="52" height="42" rx="3" fill="white" />
            <text x="267" y="242" textAnchor="middle" fontSize="14" fontWeight="800" fill="#2563eb" fontFamily="-apple-system, sans-serif">87</text>
            <text x="267" y="254" textAnchor="middle" fontSize="6.5" fontWeight="600" fill="#94a3b8" fontFamily="-apple-system, sans-serif" letterSpacing="0.04em">HEALTH</text>
            <text x="267" y="262" textAnchor="middle" fontSize="6.5" fontWeight="600" fill="#94a3b8" fontFamily="-apple-system, sans-serif" letterSpacing="0.04em">SCORE</text>
          </g>
        )}

        {/* Door */}
        <rect x="181" y="256" width="46" height="76" rx="4"
          fill="#d97706" opacity={p1}
          style={{ transition: "opacity 0.7s" }}
        />
        {/* Door arch */}
        <path d="M181 268 Q204 248 227 268" fill="#b45309" opacity={p1} />
        <circle cx="221" cy="294" r="3" fill="rgba(255,255,255,0.6)" opacity={p1} />
        {/* Door panel lines */}
        <line x1="204" y1="268" x2="204" y2="330" stroke="rgba(0,0,0,0.12)" strokeWidth="0.8" opacity={p1} />
        <line x1="181" y1="294" x2="227" y2="294" stroke="rgba(0,0,0,0.12)" strokeWidth="0.8" opacity={p1} />

        {/* Front step */}
        <rect x="173" y="330" width="62" height="6" rx="2" fill="#d1cec8" opacity={p1} />
      </svg>

      {/* ── Floating data cards ── */}

      {/* Health Score card */}
      <div style={{
        position: "absolute", top: "2%", right: "-4%",
        background: C.surface, borderRadius: 16, padding: "14px 18px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.05)",
        border: `1px solid ${C.border}`,
        opacity: p1,
        transform: `translateX(${(1 - p1) * 24}px)`,
        transition: "opacity 0.7s, transform 0.7s",
        minWidth: 148,
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity size={11} color={C.green} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Health Score</span>
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: C.text, letterSpacing: "-1.5px", lineHeight: 1 }}>87</div>
        <div style={{ fontSize: 11, color: C.green, fontWeight: 600, marginTop: 4 }}>↑ Good standing</div>
      </div>

      {/* Mortgage card */}
      <div style={{
        position: "absolute", bottom: "22%", left: "-6%",
        background: C.surface, borderRadius: 16, padding: "14px 18px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.05)",
        border: `1px solid ${C.border}`,
        opacity: p2,
        transform: `translateX(${(1 - p2) * -24}px)`,
        transition: "opacity 0.7s, transform 0.7s",
        minWidth: 152,
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: C.accentBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <DollarSign size={11} color={C.accent} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Mortgage</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-1px", lineHeight: 1 }}>$2,418</div>
        <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>Due May 1</div>
      </div>

      {/* BTLR alert card */}
      <div style={{
        position: "absolute", top: "28%", right: "-8%",
        background: "#fffbeb", borderRadius: 16, padding: "12px 16px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
        border: "1px solid #fde68a",
        opacity: p3,
        transform: `translateX(${(1 - p3) * 24}px)`,
        transition: "opacity 0.7s, transform 0.7s",
        maxWidth: 165,
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bot size={10} color={C.gold} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em" }}>BTLR</span>
        </div>
        <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.45, margin: 0, fontWeight: 500 }}>HVAC filter due in 3 weeks</p>
      </div>
    </div>
  );
}

// ── Feature card ───────────────────────────────────────────────────────────────
interface Feature {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  desc: string;
}

function FeatureCard({ icon, iconBg, title, desc }: Feature) {
  return (
    <div style={{
      background: C.surface, borderRadius: 20, padding: "28px 26px",
      border: `1px solid ${C.border}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      transition: "box-shadow 0.2s",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 18,
      }}>
        {icon}
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.3px", margin: "0 0 8px", color: C.text }}>{title}</h3>
      <p style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.7, margin: 0 }}>{desc}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Landing() {
  const [email, setEmail]     = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [houseProgress, setHouseProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onScroll() {
      setScrollY(window.scrollY);
      if (!scrollRef.current) return;
      const rect   = scrollRef.current.getBoundingClientRect();
      const totalH = scrollRef.current.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      setHouseProgress(Math.max(0, Math.min(1, scrolled / totalH)));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setSubmitted(true);
  }

  const navScrolled = scrollY > 30;

  const features: Feature[] = [
    {
      icon: <Activity size={20} color={C.green} />,
      iconBg: "#f0fdf4",
      title: "Home Health Score",
      desc: "BTLR tracks every system — roof, HVAC, water heater — and gives you a live score with replacement timelines before anything fails.",
    },
    {
      icon: <DollarSign size={20} color={C.accent} />,
      iconBg: C.accentBg,
      title: "Financial Dashboard",
      desc: "Mortgage balance, payment dates, insurance renewals, property tax due dates. One place, always current.",
    },
    {
      icon: <Clock size={20} color={C.gold} />,
      iconBg: "#fffbeb",
      title: "Predictive Maintenance",
      desc: "BTLR knows when systems are aging. It tells you months in advance — so repairs are budgeted, never a shock.",
    },
    {
      icon: <TrendingUp size={20} color={C.purple} />,
      iconBg: "#faf5ff",
      title: "Repair Savings Fund",
      desc: "Set aside money for your home automatically. Like Acorns for homeownership — invested while you wait.",
    },
    {
      icon: <Bot size={20} color={C.accent} />,
      iconBg: C.accentBg,
      title: "AI Concierge",
      desc: "Ask BTLR to find a contractor, explain a repair cost, or flag anything urgent. It doesn't just inform you — it acts.",
    },
    {
      icon: <FolderOpen size={20} color={C.rose} />,
      iconBg: "#fff1f2",
      title: "Document Vault",
      desc: "Every warranty, receipt, inspection report, and permit — stored, organized, searchable. No more hunting through email.",
    },
  ];

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Helvetica Neue', sans-serif",
      background: C.bg, color: C.text, overflowX: "hidden",
    }}>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 48px",
        background: navScrolled ? "rgba(245,244,240,0.88)" : "transparent",
        backdropFilter: navScrolled ? "blur(20px)" : "none",
        WebkitBackdropFilter: navScrolled ? "blur(20px)" : "none",
        borderBottom: navScrolled ? `1px solid ${C.border}` : "1px solid transparent",
        transition: "background 0.35s, border-color 0.35s, backdrop-filter 0.35s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 2px 8px ${C.accent}40`,
          }}>
            <Home size={15} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px", color: C.text }}>BTLR</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/login" style={{ fontSize: 14, color: C.mid, textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </a>
          <a href="/dashboard" style={{
            background: C.text, color: "white",
            padding: "9px 20px", borderRadius: 99,
            fontSize: 13, fontWeight: 600, textDecoration: "none",
            letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 5,
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}>
            Open Dashboard <ChevronRight size={13} />
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "130px 24px 80px", textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        {/* Soft background glow */}
        <div style={{
          position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)",
          width: 800, height: 500,
          background: `radial-gradient(ellipse, ${C.accent}0d 0%, transparent 65%)`,
          pointerEvents: "none",
        }} />

        <div style={{ position: "relative", maxWidth: 800, margin: "0 auto" }}>
          {/* Badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: C.accentBg, border: `1px solid ${C.accent}30`,
            borderRadius: 99, padding: "5px 14px", marginBottom: 36,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: "0.06em" }}>NOW IN EARLY ACCESS</span>
          </div>

          <h1 style={{
            fontSize: "clamp(52px, 7.5vw, 92px)",
            fontWeight: 800, lineHeight: 1.0,
            letterSpacing: "clamp(-2.5px, -0.04em, -4px)",
            margin: "0 0 28px", color: C.text,
          }}>
            Your home,<br />
            <span style={{ color: C.accent }}>fully managed.</span>
          </h1>

          <p style={{
            fontSize: "clamp(17px, 2vw, 20px)",
            color: C.mid, lineHeight: 1.65,
            maxWidth: 520, margin: "0 auto 48px",
            fontWeight: 400,
          }}>
            BTLR is your AI home operating system — health scores, repair budgeting, mortgage tracking, and a concierge that handles the rest.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} style={{
              display: "flex", gap: 8, maxWidth: 440,
              margin: "0 auto 16px", flexWrap: "wrap", justifyContent: "center",
            }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{
                  flex: 1, minWidth: 220, padding: "14px 18px",
                  borderRadius: 12, border: `1.5px solid ${C.border}`,
                  background: C.surface, color: C.text,
                  fontSize: 14, outline: "none",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  transition: "border-color 0.2s",
                }}
              />
              <button type="submit" style={{
                padding: "14px 26px", borderRadius: 12, border: "none",
                cursor: "pointer", background: C.text,
                color: "white", fontSize: 14, fontWeight: 600,
                letterSpacing: "-0.2px", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                transition: "transform 0.15s",
              }}>
                Join Waitlist <ArrowRight size={14} />
              </button>
            </form>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 12, padding: "14px 24px", fontSize: 14, color: C.green,
              marginBottom: 16,
            }}>
              <CheckCircle2 size={15} color={C.green} />
              You&apos;re on the list — we&apos;ll be in touch soon.
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: 12, color: C.muted }}>No credit card required · Free to join</p>
        </div>

        {/* Dashboard preview — light theme */}
        <div style={{ marginTop: 72, position: "relative", maxWidth: 860, width: "100%" }}>
          {/* Outer glow ring */}
          <div style={{
            position: "absolute", inset: -1, borderRadius: 22,
            background: `linear-gradient(135deg, ${C.accent}30, rgba(99,102,241,0.2))`,
            zIndex: 0,
          }} />
          <div style={{
            position: "relative", zIndex: 1,
            background: C.surface, borderRadius: 20, overflow: "hidden",
            border: `1px solid ${C.border}`,
            boxShadow: "0 24px 80px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.04)",
          }}>
            {/* Browser chrome */}
            <div style={{
              background: "#f9f8f6", padding: "12px 18px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
              <div style={{
                marginLeft: 12, flex: 1, maxWidth: 200,
                background: C.bg, borderRadius: 6, padding: "4px 12px",
                fontSize: 11, color: C.muted, fontWeight: 500,
              }}>
                btlr.app/dashboard
              </div>
            </div>
            {/* Mock dashboard grid */}
            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                { label: "Health Score",  value: "87",        sub: "3 items flagged",    color: C.green,  bg: "#f0fdf4", icon: <Activity size={13} color={C.green} /> },
                { label: "Mortgage",      value: "$312,400",  sub: "Next payment May 1", color: C.accent, bg: C.accentBg, icon: <DollarSign size={13} color={C.accent} /> },
                { label: "Repair Fund",   value: "$2,840",    sub: "+$124 this month",   color: C.purple, bg: "#faf5ff", icon: <TrendingUp size={13} color={C.purple} /> },
                { label: "Insurance",     value: "Active",    sub: "Renews Oct 2026",    color: C.green,  bg: "#f0fdf4", icon: <Shield size={13} color={C.green} /> },
                { label: "Property Tax",  value: "$4,200/yr", sub: "Due Dec 2026",       color: C.gold,   bg: "#fffbeb", icon: <Wrench size={13} color={C.gold} /> },
                { label: "BTLR AI",       value: "Online",    sub: "Ask me anything",    color: C.accent, bg: C.accentBg, icon: <Bot size={13} color={C.accent} /> },
              ].map(item => (
                <div key={item.label} style={{
                  background: C.bg, borderRadius: 12, padding: "16px 18px",
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {item.icon}
                    </div>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0, fontWeight: 600 }}>{item.label}</p>
                  </div>
                  <p style={{ fontSize: 19, fontWeight: 800, color: item.color, letterSpacing: "-0.5px", margin: "0 0 3px" }}>{item.value}</p>
                  <p style={{ fontSize: 10, color: C.muted, margin: 0 }}>{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll cue */}
        <div style={{ marginTop: 56, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: 0.45 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.mid }}>Scroll to explore</span>
          <ChevronDown size={16} color={C.mid} />
        </div>
      </section>

      {/* ── House Scroll Reveal ───────────────────────────────────────────────── */}
      <div ref={scrollRef} style={{ height: "280vh", position: "relative" }}>
        <div style={{
          position: "sticky", top: 0, height: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
          background: C.bg,
        }}>
          <div style={{
            maxWidth: 1080, width: "100%", padding: "0 48px",
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 80, alignItems: "center",
          }}>
            {/* Left: text panels */}
            <div style={{ position: "relative", height: 280 }}>
              {/* Panel 1 */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: houseProgress < 0.32 ? 1 : 0,
                transform: `translateY(${houseProgress < 0.32 ? 0 : -16}px)`,
                transition: "opacity 0.45s, transform 0.45s",
              }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "#f0fdf4", borderRadius: 99, padding: "4px 12px",
                  marginBottom: 20,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.green }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: "0.07em", textTransform: "uppercase" }}>Home Health</span>
                </div>
                <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, margin: "0 0 20px" }}>
                  Know exactly what&apos;s<br />happening inside your home.
                </h2>
                <p style={{ fontSize: 16, color: C.mid, lineHeight: 1.7, margin: 0 }}>
                  Upload your inspection report and BTLR builds a complete picture of every system — roof, HVAC, plumbing, electrical — with real replacement timelines and a live health score.
                </p>
              </div>

              {/* Panel 2 */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: houseProgress >= 0.32 && houseProgress < 0.66 ? 1 : 0,
                transform: `translateY(${houseProgress >= 0.32 && houseProgress < 0.66 ? 0 : houseProgress < 0.32 ? 16 : -16}px)`,
                transition: "opacity 0.45s, transform 0.45s",
              }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "#fffbeb", borderRadius: 99, padding: "4px 12px",
                  marginBottom: 20,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.gold }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: "0.07em", textTransform: "uppercase" }}>Never Surprised</span>
                </div>
                <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, margin: "0 0 20px" }}>
                  Repairs budgeted<br />months before they happen.
                </h2>
                <p style={{ fontSize: 16, color: C.mid, lineHeight: 1.7, margin: 0 }}>
                  BTLR calculates what every repair will cost before it happens. Your savings fund grows automatically, so you&apos;re always ready — never scrambling for cash.
                </p>
              </div>

              {/* Panel 3 */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: houseProgress >= 0.66 ? 1 : 0,
                transform: `translateY(${houseProgress >= 0.66 ? 0 : 16}px)`,
                transition: "opacity 0.45s, transform 0.45s",
              }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "#faf5ff", borderRadius: 99, padding: "4px 12px",
                  marginBottom: 20,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.purple }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.purple, letterSpacing: "0.07em", textTransform: "uppercase" }}>AI Concierge</span>
                </div>
                <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, margin: "0 0 20px" }}>
                  Ask BTLR anything.<br />Get real answers.
                </h2>
                <p style={{ fontSize: 16, color: C.mid, lineHeight: 1.7, margin: 0 }}>
                  &ldquo;Is my water heater about to fail?&rdquo; &ldquo;Find me a roofer.&rdquo; &ldquo;When&apos;s my next mortgage payment?&rdquo; BTLR knows your home — and acts on your behalf.
                </p>
              </div>
            </div>

            {/* Right: animated house illustration */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <HouseIllustration progress={houseProgress} />
            </div>
          </div>

          {/* Scroll progress dots */}
          <div style={{
            position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 8, alignItems: "center",
          }}>
            {[0, 0.33, 0.66].map((threshold, i) => (
              <div key={i} style={{
                width: houseProgress >= threshold && houseProgress < threshold + 0.34 ? 20 : 6,
                height: 6, borderRadius: 3,
                background: houseProgress >= threshold && houseProgress < threshold + 0.34 ? C.accent : C.border,
                transition: "all 0.3s",
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* ── The Problem ───────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: "#0f172a" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>The Reality</p>
            <h2 style={{ fontSize: "clamp(30px, 4.5vw, 52px)", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, color: "white", margin: "0 0 24px" }}>
              Owning a home is a full-time job.<br />
              <span style={{ color: "#475569" }}>Nobody told you that.</span>
            </h2>
            <p style={{ fontSize: 17, color: "#64748b", lineHeight: 1.65, maxWidth: 520, margin: "0 auto" }}>
              Mortgage statements in one app. Insurance in an email you can&apos;t find. Repair receipts in a junk drawer. No idea if your roof has 2 years left or 12.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            {[
              { icon: <FileText size={16} color="#64748b" />, text: "Documents scattered across emails, apps, and junk drawers" },
              { icon: <Wrench size={16} color="#64748b" />,   text: "No warning before expensive repairs catch you off guard" },
              { icon: <Shield size={16} color="#64748b" />,   text: "Surprise bills from insurance and property tax renewals" },
              { icon: <Clock size={16} color="#64748b" />,    text: "No idea what your home is actually costing to maintain" },
            ].map((item, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16, padding: "20px 22px",
                display: "flex", gap: 14, alignItems: "flex-start",
              }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>{item.icon}</div>
                <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.65, margin: 0 }}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: C.bg }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>What BTLR Does</p>
            <h2 style={{ fontSize: "clamp(30px, 4.5vw, 52px)", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, margin: 0 }}>
              Tony Stark had Jarvis.<br />
              <span style={{ color: C.accent }}>You have BTLR.</span>
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {features.map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: C.surface, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 620, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>How It Works</p>
          <h2 style={{ fontSize: "clamp(30px, 4.5vw, 48px)", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 64 }}>
            Set up in minutes.<br />Runs forever.
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "left" }}>
            {[
              {
                step: "01", color: C.accent, bg: C.accentBg,
                icon: <Shield size={16} color={C.accent} />,
                title: "Connect your accounts",
                desc: "Link your mortgage, bank, and insurance in seconds. BTLR pulls everything automatically — no manual entry required.",
              },
              {
                step: "02", color: C.gold, bg: "#fffbeb",
                icon: <FileText size={16} color={C.gold} />,
                title: "Upload your inspection report",
                desc: "Drop in your home inspection PDF. BTLR's AI extracts every system age, flags concerns, and calculates your health score.",
              },
              {
                step: "03", color: C.purple, bg: "#faf5ff",
                icon: <Bot size={16} color={C.purple} />,
                title: "Let BTLR run your home",
                desc: "BTLR watches everything, alerts you when action is needed, and handles what you ask. You just live in your home.",
              },
            ].map((item, i, arr) => (
              <div key={i} style={{
                display: "flex", gap: 20, alignItems: "flex-start",
                position: "relative",
                paddingBottom: i < arr.length - 1 ? 40 : 0,
              }}>
                {i < arr.length - 1 && (
                  <div style={{
                    position: "absolute", left: 20, top: 44, bottom: 0, width: 1,
                    background: `linear-gradient(${C.border}, transparent)`,
                  }} />
                )}
                <div style={{
                  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                  background: item.bg, border: `1px solid ${item.color}25`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {item.icon}
                </div>
                <div style={{ paddingTop: 7 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 4px" }}>{item.step}</p>
                  <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.4px", margin: "0 0 6px" }}>{item.title}</h3>
                  <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.65, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust / Stats ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: C.bg, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 2 }}>
            {[
              { value: "25+",  label: "Home systems tracked",     color: C.accent },
              { value: "AI",   label: "Powered inspection parsing", color: C.green },
              { value: "1 PDF",label: "To your first health score", color: C.gold },
              { value: "∞",    label: "Documents organized",       color: C.purple },
            ].map((stat, i) => (
              <div key={i} style={{
                textAlign: "center", padding: "36px 24px",
                borderRight: i < 3 ? `1px solid ${C.border}` : "none",
              }}>
                <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-2px", color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 13, color: C.mid, marginTop: 8, lineHeight: 1.4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section style={{
        padding: "120px 24px", textAlign: "center",
        background: "#0f172a", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 700, height: 400,
          background: `radial-gradient(ellipse, ${C.accent}20 0%, transparent 65%)`,
          pointerEvents: "none",
        }} />
        <div style={{ position: "relative", maxWidth: 580, margin: "0 auto" }}>
          <h2 style={{
            fontSize: "clamp(36px, 5.5vw, 60px)", fontWeight: 800,
            letterSpacing: "-2.5px", lineHeight: 1.05,
            color: "white", marginBottom: 20,
          }}>
            Your home deserves<br />a butler.
          </h2>
          <p style={{ fontSize: 18, color: "#64748b", marginBottom: 48, lineHeight: 1.65 }}>
            Join the waitlist and be among the first to experience homeownership the way it was supposed to feel.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} style={{
              display: "flex", gap: 8, maxWidth: 430,
              margin: "0 auto", flexWrap: "wrap", justifyContent: "center",
            }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{
                  flex: 1, minWidth: 210, padding: "14px 18px",
                  borderRadius: 12, border: "1.5px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)", color: "white",
                  fontSize: 14, outline: "none",
                }}
              />
              <button type="submit" style={{
                padding: "14px 26px", borderRadius: 12, border: "none",
                cursor: "pointer",
                background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`,
                color: "white", fontSize: 14, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: `0 4px 20px ${C.accent}50`,
                letterSpacing: "-0.2px",
              }}>
                Get Early Access <ArrowRight size={14} />
              </button>
            </form>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)",
              borderRadius: 12, padding: "14px 24px", fontSize: 14, color: "#4ade80",
            }}>
              <CheckCircle2 size={15} color="#4ade80" /> You&apos;re on the list!
            </div>
          )}
          <p style={{ marginTop: 16, fontSize: 12, color: "#475569" }}>No credit card required · Free to join</p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer style={{
        padding: "28px 48px",
        borderTop: `1px solid ${C.border}`,
        background: C.bg,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Home size={12} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.4px" }}>BTLR</span>
        </div>
        <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>© 2026 BTLR. All rights reserved.</p>
      </footer>

    </div>
  );
}
