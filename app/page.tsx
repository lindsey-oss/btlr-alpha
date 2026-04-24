"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// ── Design tokens (match the HTML design) ────────────────────────────────────
const C = {
  bg:          "#FFFFFF",
  surface:     "#F7F2EC",
  surface2:    "#EDE5D4",
  gold:        "#2C5F8A",
  goldDk:      "#1E4568",
  goldLt:      "#5C8FB8",
  goldDim:     "rgba(44,95,138,.10)",
  navy:        "#1B2D47",
  text:        "#1C1914",
  muted:       "#6B6558",
  dim:         "#A09C92",
  border:      "rgba(28,25,20,0.08)",
  borderGold:  "rgba(44,95,138,0.22)",
};

const OUTFIT = "'Outfit', sans-serif";
const SYNE   = "'Syne', sans-serif";
const DM     = "'DM Sans', sans-serif";

// ── Scroll-reveal hook ────────────────────────────────────────────────────────
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("in"); }),
      { threshold: 0.12 }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

// ── Eyebrow ───────────────────────────────────────────────────────────────────
function Eyebrow({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      justifyContent: center ? "center" : "flex-start",
      fontFamily: SYNE, fontSize: 11, fontWeight: 600,
      letterSpacing: "0.22em", textTransform: "uppercase",
      color: C.gold, marginBottom: 18,
    }}>
      {!center && <span style={{ width: 24, height: 1, background: C.gold, display: "inline-block", flexShrink: 0 }}/>}
      {children}
    </div>
  );
}

// ── Feature icon ─────────────────────────────────────────────────────────────
function FeatIcon({ d }: { d: string }) {
  return (
    <div style={{ width: 44, height: 44, background: C.goldDim, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22, color: C.gold }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={d}/>
      </svg>
    </div>
  );
}

// ── Systems grid (replaces scroll-video) ─────────────────────────────────────
const SYSTEMS = [
  { label: "Roof", sub: "Condition + age tracked", icon: "M3 9.5L12 3l9 6.5V21H3V9.5z", status: "good" },
  { label: "HVAC", sub: "Filter + service alerts", icon: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18", status: "warn" },
  { label: "Plumbing", sub: "Leak risk monitoring", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z", status: "good" },
  { label: "Electrical", sub: "Panel health score", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", status: "good" },
  { label: "Foundation", sub: "Settling & cracks", icon: "M3 21h18M4 21V7l8-4 8 4v14", status: "good" },
  { label: "Water Heater", sub: "Lifespan: 2 yrs left", icon: "M12 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z", status: "warn" },
  { label: "Windows", sub: "Seal + efficiency", icon: "M3 3h18v18H3z M12 3v18 M3 12h18", status: "good" },
  { label: "Appliances", sub: "Warranty tracking", icon: "M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H5z", status: "good" },
  { label: "Exterior", sub: "Paint, siding, deck", icon: "M3 9.5L12 3l9 6.5M12 22v-7 M5 22v-5 M19 22v-5", status: "good" },
];

function SystemsGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, width: "100%", maxWidth: 680 }}>
      {SYSTEMS.map((s, i) => (
        <div key={i} style={{
          background: C.surface, border: `1px solid ${C.border}`,
          padding: "18px 16px", display: "flex", flexDirection: "column", gap: 6,
          transition: "border-color 0.2s",
          borderTop: s.status === "warn" ? `2px solid ${C.gold}` : `1px solid ${C.border}`,
        }}>
          <div style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 700, color: C.text }}>{s.label}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: DM }}>{s.sub}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.status === "warn" ? "#E8A04A" : "#4A9E6B", display: "inline-block" }}/>
            <span style={{ fontFamily: SYNE, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: s.status === "warn" ? "#E8A04A" : "#4A9E6B" }}>
              {s.status === "warn" ? "Monitor" : "Good"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score = 84 }: { score?: number }) {
  const r = 88;
  const circ = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setAnimated(true); }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const offset = animated ? circ * (1 - score / 100) : circ;

  return (
    <div ref={ref} style={{ position: "relative", width: 200, height: 200 }}>
      <svg width="200" height="200" viewBox="0 0 200 200" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="100" cy="100" r={r} stroke={C.surface2} strokeWidth="10" fill="none"/>
        <circle cx="100" cy="100" r={r} stroke={C.gold} strokeWidth="10" fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: SYNE, fontSize: 54, fontWeight: 800, color: C.text, lineHeight: 1 }}>{animated ? score : 0}</div>
        <div style={{ fontFamily: SYNE, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted, marginTop: 4 }}>Health Score</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [email, setEmail]       = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth}
        body{background:#fff;color:${C.text};font-family:'DM Sans',sans-serif;overflow-x:hidden}
        .reveal{opacity:0;transform:translateY(28px);transition:opacity .75s,transform .75s}
        .reveal.in{opacity:1;transform:translateY(0)}
        .reveal.d1{transition-delay:.1s}
        .reveal.d2{transition-delay:.22s}
        .reveal.d3{transition-delay:.36s}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
        @keyframes dashPulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        .feat-card:hover{border-color:${C.borderGold} !important;background:#F5F8FC !important}
        .feat-card::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:${C.gold};transition:width .4s}
        .feat-card:hover::after{width:100%}
        .nav-link-hover:hover{color:${C.text} !important}
        .btn-primary-hover:hover{background:${C.goldDk} !important;transform:translateY(-2px);box-shadow:0 10px 36px rgba(44,95,138,.25)}
        .pain-item{display:flex;align-items:flex-start;gap:16px;padding:22px 0;border-bottom:1px solid rgba(255,255,255,.07)}
        .pain-item:first-child{border-top:1px solid rgba(255,255,255,.07)}
        .step-hover:hover{border-color:${C.gold} !important}
        .vendor-row-hover:hover{border-color:${C.borderGold} !important;background:${C.surface} !important}
        @media(max-width:900px){
          .hero-h1{font-size:clamp(36px,8vw,60px) !important}
          .hero-accent{font-size:clamp(40px,9vw,72px) !important}
          .two-col{grid-template-columns:1fr !important;gap:48px !important}
          .three-col{grid-template-columns:1fr !important}
          .feat-grid-col{grid-template-columns:1fr 1fr !important}
          .steps-grid{grid-template-columns:1fr !important;gap:32px !important}
          .steps-grid::before{display:none !important}
          .stats-flex{flex-direction:column !important;gap:32px !important;padding:60px 32px !important}
          .nav-links-hide{display:none !important}
          .section-pad{padding:80px 28px !important}
          .hero-pad{padding:120px 28px 80px !important}
          .footer-flex{flex-direction:column !important;gap:20px !important;text-align:center !important;padding:36px 24px !important}
          .systems-grid{grid-template-columns:repeat(2,1fr) !important}
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "22px 64px",
        background: scrolled ? "rgba(250,250,247,.94)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        boxShadow: scrolled ? `0 1px 0 ${C.border}` : "none",
        transition: "background .4s, box-shadow .4s",
      }}>
        <Link href="/" style={{ fontFamily: SYNE, fontSize: 20, fontWeight: 800, letterSpacing: "0.14em", color: C.gold, textDecoration: "none" }}>
          BTLR
        </Link>
        <ul className="nav-links-hide" style={{ display: "flex", gap: 44, listStyle: "none" }}>
          {["Features", "Health Score", "AI Concierge", "How It Works"].map((l, i) => (
            <li key={i}>
              <a href={["#features", "#health-score", "#concierge", "#hiw"][i]}
                className="nav-link-hover"
                style={{ fontSize: 14, color: C.muted, textDecoration: "none", transition: "color .2s" }}>
                {l}
              </a>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/dashboard" style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 20px", color: C.muted, textDecoration: "none" }}>
            Log In
          </Link>
          <a href="#cta" style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 30px", background: C.gold, color: "#fff", textDecoration: "none", transition: "background .2s" }}
            className="btn-primary-hover">
            Sign Up Free
          </a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero-pad" style={{ minHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "140px 64px 80px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 75% 55% at 70% 55%,rgba(44,95,138,.05),transparent 68%)", pointerEvents: "none" }}/>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 760 }}>
          <p style={{ display: "inline-flex", alignItems: "center", gap: 10, fontFamily: SYNE, fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold, marginBottom: 28, opacity: 0, animation: "fadeUp .7s .15s forwards" }}>
            <span style={{ width: 28, height: 1, background: C.gold, display: "inline-block" }}/>
            Now in Early Access
          </p>
          <h1 className="hero-h1" style={{ fontFamily: OUTFIT, fontSize: "clamp(38px,4.5vw,70px)", fontWeight: 300, lineHeight: 1.06, marginBottom: 8, letterSpacing: "-0.02em", opacity: 0, animation: "fadeUp .7s .3s forwards" }}>
            Your Home,
          </h1>
          <div className="hero-accent" style={{ fontFamily: OUTFIT, fontSize: "clamp(44px,5.5vw,82px)", fontWeight: 700, color: C.gold, lineHeight: 1.03, marginBottom: 32, letterSpacing: "-0.03em", opacity: 0, animation: "fadeUp .7s .48s forwards" }}>
            Fully Managed.
          </div>
          <p style={{ fontSize: 17, fontWeight: 300, color: C.muted, lineHeight: 1.78, maxWidth: 580, margin: "0 auto 44px", opacity: 0, animation: "fadeUp .7s .64s forwards" }}>
            BTLR is your AI home operating system — health scores, repair budgeting, mortgage tracking, and a concierge that handles the rest.
          </p>
          <div style={{ display: "flex", gap: 20, alignItems: "center", justifyContent: "center", opacity: 0, animation: "fadeUp .7s .8s forwards", flexWrap: "wrap" }}>
            <a href="#cta" className="btn-primary-hover" style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 38px", background: C.gold, color: "#fff", textDecoration: "none", display: "inline-block", transition: "all .2s" }}>
              Sign Up Free
            </a>
            <a href="#features" style={{ color: C.muted, fontSize: 14, textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
              See your home <span style={{ transition: "transform .2s" }}>→</span>
            </a>
          </div>
        </div>
        {/* Scroll hint */}
        <div style={{ position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: 0, animation: "fadeIn 1s 1.4s forwards", zIndex: 1 }}>
          <span style={{ fontFamily: SYNE, fontSize: 10, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: C.dim }}>Scroll</span>
          <div style={{ width: 1, height: 52, background: `linear-gradient(${C.gold},transparent)`, animation: "pulse 2s infinite" }}/>
        </div>
      </section>

      {/* ── SYSTEMS ── */}
      <section id="features" className="section-pad" style={{ padding: "120px 64px", background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }} className="two-col">
          <div className="reveal">
            <Eyebrow>Your Home, Intelligently Managed</Eyebrow>
            <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(28px,3.2vw,46px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em", color: C.text }}>
              Every corner of your home,<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>covered and connected.</strong>
            </h2>
            <p style={{ fontSize: 16, fontWeight: 300, color: C.muted, lineHeight: 1.82, marginBottom: 28 }}>
              BTLR tracks 25+ home systems — roof, HVAC, plumbing, electrical — and alerts you before anything becomes a problem.
            </p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.borderGold}`, padding: "7px 16px", fontFamily: SYNE, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold }}>
              25+ Home Systems Tracked
            </div>
          </div>
          <div className="reveal d2" style={{ display: "flex", justifyContent: "center" }}>
            <div className="systems-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, width: "100%", maxWidth: 520, animation: "float 6s ease-in-out infinite" }}>
              {SYSTEMS.map((s, i) => (
                <div key={i} style={{
                  background: "#fff", border: `1px solid ${C.border}`,
                  borderTop: s.status === "warn" ? `2px solid #E8A04A` : `1px solid ${C.border}`,
                  padding: "14px 13px",
                }}>
                  <div style={{ fontFamily: SYNE, fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{s.sub}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.status === "warn" ? "#E8A04A" : "#4A9E6B", display: "inline-block" }}/>
                    <span style={{ fontFamily: SYNE, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: s.status === "warn" ? "#E8A04A" : "#4A9E6B" }}>
                      {s.status === "warn" ? "Monitor" : "Good"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── REALITY ── */}
      <section id="reality" className="section-pad" style={{ background: "#3A6491", padding: "140px 64px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "start" }} className="two-col">
          <div className="reveal">
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: SYNE, fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.goldLt, marginBottom: 18 }}>
              <span style={{ width: 24, height: 1, background: C.goldLt, display: "inline-block" }}/>
              The Reality
            </div>
            <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em", color: "#EDE9DC" }}>
              Owning a home is a full-time job.<br/><strong style={{ fontWeight: 700, color: "#EDE9DC" }}>Nobody told you that.</strong>
            </h2>
            <p style={{ fontSize: 16, fontWeight: 300, color: "rgba(237,233,220,.88)", lineHeight: 1.82 }}>
              Mortgage statements in one app. Insurance in an email you can&apos;t find. Repair receipts in a junk drawer. No idea if your roof has 2 years left or 12.
            </p>
          </div>
          <div className="reveal d2" style={{ marginTop: 40 }}>
            {[
              ["01", "Documents scattered across emails, apps, and junk drawers"],
              ["02", "No warning before expensive repairs catch you off guard"],
              ["03", "Surprise bills from insurance and property tax renewals"],
              ["04", "No idea what your home is actually costing to maintain"],
            ].map(([n, t]) => (
              <div className="pain-item" key={n} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "22px 0", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <div style={{ fontFamily: SYNE, fontSize: 10, fontWeight: 700, color: C.goldLt, opacity: 0.7, letterSpacing: "0.1em", paddingTop: 2, flexShrink: 0 }}>{n}</div>
                <div style={{ fontSize: 15, fontWeight: 300, color: "rgba(237,233,220,.72)", lineHeight: 1.65 }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="section-pad" style={{ padding: "140px 64px", maxWidth: 1200, margin: "0 auto" }}>
        <div className="reveal" style={{ textAlign: "center", marginBottom: 72 }}>
          <Eyebrow center>What BTLR Does</Eyebrow>
          <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(26px,3.6vw,50px)", fontWeight: 300, color: C.text, letterSpacing: "-0.02em" }}>
            Tony Stark had Jarvis.<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>You have BTLR.</strong>
          </h2>
        </div>
        <div className="feat-grid-col" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2 }}>
          {[
            { icon: "M3 9.5L12 3l9 6.5V21H3V9.5z M9 13h6v8H9z", title: "Home Health Score", body: "BTLR tracks every system — roof, HVAC, water heater — and gives you a live score with replacement timelines before anything fails.", delay: "" },
            { icon: "M12 1v22 M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", title: "Financial Dashboard", body: "Mortgage balance, payment dates, insurance renewals, property tax due dates. One place, always current.", delay: "d1" },
            { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", title: "Predictive Maintenance", body: "BTLR knows when systems are aging. It tells you months in advance — so repairs are budgeted, never a shock.", delay: "d2" },
            { icon: "M3 21h18 M4 21V7l8-4 8 4v14", title: "Repair Savings Fund", body: "Set aside money for your home automatically. Like Acorns for homeownership — invested while you wait.", delay: "d1" },
            { icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", title: "AI Concierge", body: "Ask BTLR to find a contractor, explain a repair cost, or flag anything urgent. It doesn't just inform you — it acts.", delay: "d2" },
            { icon: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z", title: "Document Vault", body: "Every warranty, receipt, inspection report, and permit — stored, organized, searchable. No more hunting through email.", delay: "d3" },
          ].map((f, i) => (
            <div key={i} className={`feat-card reveal ${f.delay}`} style={{ background: C.surface, padding: "40px 32px", border: `1px solid ${C.border}`, position: "relative", overflow: "hidden", transition: "border-color .3s, background .3s" }}>
              <div style={{ width: 44, height: 44, background: C.goldDim, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22, color: C.gold }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon}/>
                </svg>
              </div>
              <div style={{ fontFamily: SYNE, fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12, letterSpacing: "0.02em" }}>{f.title}</div>
              <div style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.72 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HEALTH SCORE ── */}
      <section id="health-score" className="section-pad" style={{ padding: "140px 64px", maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }} >
        <div className="reveal">
          <Eyebrow>Home Health</Eyebrow>
          <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Know exactly what&apos;s happening<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>inside your home.</strong>
          </h2>
          <p style={{ fontSize: 16, fontWeight: 300, color: C.muted, lineHeight: 1.82, marginBottom: 28 }}>
            Upload your inspection report and BTLR builds a complete picture of every system — roof, HVAC, plumbing, electrical — with real replacement timelines and a live health score.
          </p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.borderGold}`, padding: "7px 16px", fontFamily: SYNE, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="6" y1="3" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="6" cy="8.5" r=".75" fill="currentColor"/></svg>
            Patent-Pending Technology
          </div>
        </div>
        <div id="hs-visual" className="reveal d2" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
          <ScoreRing score={84}/>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { name: "Roof",       val: 82, color: C.gold },
              { name: "HVAC",       val: 91, color: "#3A78AA" },
              { name: "Plumbing",   val: 78, color: C.gold },
              { name: "Electrical", val: 95, color: C.goldDk },
              { name: "Foundation", val: 88, color: C.gold },
            ].map(b => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 13, color: C.muted, width: 100, flexShrink: 0 }}>{b.name}</div>
                <div style={{ flex: 1, height: 5, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: b.color, borderRadius: 3, width: `${b.val}%`, transition: "width 1.2s cubic-bezier(.4,0,.2,1)" }}/>
                </div>
                <div style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 700, color: C.muted, width: 28, textAlign: "right" }}>{b.val}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONCIERGE ── */}
      <section id="concierge" className="section-pad" style={{ padding: "140px 64px", maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }}>
        <div className="reveal">
          <Eyebrow>AI Concierge</Eyebrow>
          <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Ask BTLR anything.<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>Get real answers.</strong>
          </h2>
          <p style={{ fontSize: 16, fontWeight: 300, color: C.muted, lineHeight: 1.82 }}>
            &ldquo;Is my water heater about to fail?&rdquo; &ldquo;Find me a roofer.&rdquo; &ldquo;When&apos;s my next mortgage payment?&rdquo; BTLR knows your home — and acts on your behalf.
          </p>
        </div>
        <div className="reveal d2" style={{ background: "white", border: `1px solid ${C.border}`, boxShadow: "0 8px 48px rgba(28,25,20,.09)", overflow: "hidden" }}>
          <div style={{ background: C.navy, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SYNE, fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>B</div>
            <div>
              <div style={{ fontFamily: SYNE, fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>BTLR</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4A9E6B", display: "inline-block", animation: "dashPulse 2s infinite" }}/>
                Online · Always watching
              </div>
            </div>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, minHeight: 240 }}>
            {[
              { user: true,  text: "Is my water heater about to fail?" },
              { user: false, text: "Your water heater is 7 years old — average lifespan is 8–12 years. Based on your inspection report, I'm flagging it for monitoring. I'd recommend budgeting $900–1,400 for replacement within the next 2 years. Want me to find licensed plumbers nearby?" },
              { user: true,  text: "Yes, find me the best-rated one available this week." },
              { user: false, text: "Found 3 licensed plumbers with same-week availability. FlowRight Plumbing is rated 4.9★ with 203 reviews. Want me to send them your home details and request a quote?" },
            ].map((m, i) => (
              <div key={i} style={{ maxWidth: "80%", padding: "10px 14px", fontSize: 13, lineHeight: 1.6, alignSelf: m.user ? "flex-end" : "flex-start", background: m.user ? C.gold : C.surface, color: m.user ? "#fff" : C.text, border: m.user ? "none" : `1px solid ${C.border}` }}>
                {m.text}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
            <input readOnly placeholder="Ask BTLR about your home…" style={{ flex: 1, border: "none", padding: "14px 16px", fontFamily: DM, fontSize: 13, color: C.text, outline: "none", background: "white" }}/>
            <Link href="/dashboard" style={{ background: C.gold, border: "none", padding: "0 20px", color: "#fff", fontFamily: SYNE, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", textDecoration: "none" }}>
              Try It
            </Link>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="hiw" className="section-pad" style={{ background: C.surface, padding: "140px 64px", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div className="reveal" style={{ textAlign: "center", marginBottom: 80 }}>
            <Eyebrow center>How It Works</Eyebrow>
            <h2 style={{ fontFamily: OUTFIT, fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
              Set up in minutes.<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>Runs forever.</strong>
            </h2>
          </div>
          <div className="steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 60, position: "relative" }}>
            <div style={{ content: "", position: "absolute", top: 25, left: "calc(16.67% + 18px)", right: "calc(16.67% + 18px)", height: 1, background: C.borderGold }}/>
            {[
              { n: "01", t: "Connect your accounts", b: "Link your mortgage, bank, and insurance in seconds. BTLR pulls everything automatically — no manual entry required.", delay: "" },
              { n: "02", t: "Upload your inspection report", b: "Drop in your home inspection PDF. BTLR's AI extracts every system age, flags concerns, and calculates your health score.", delay: "d2" },
              { n: "03", t: "Let BTLR run your home", b: "BTLR watches everything, alerts you when action is needed, and handles what you ask. You just live in your home.", delay: "d3" },
            ].map(s => (
              <div key={s.n} className={`step reveal ${s.delay}`} style={{ textAlign: "center" }}>
                <div style={{ width: 50, height: 50, border: `1.5px solid ${C.gold}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SYNE, fontSize: 18, fontWeight: 800, color: C.gold, margin: "0 auto 24px", background: C.surface, position: "relative", zIndex: 1 }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: SYNE, fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>{s.t}</div>
                <div style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.72 }}>{s.b}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <div className="stats-flex" style={{ background: C.gold, padding: "52px 64px", display: "flex", alignItems: "center", justifyContent: "space-around", flexWrap: "wrap", gap: 40 }}>
        {[
          { big: "25+", desc: "Home systems tracked" },
          { big: "1",   desc: "PDF to your first health score" },
          { big: "∞",   desc: "Documents organized" },
          { big: "AI",  desc: "Powered inspection parsing" },
        ].map(s => (
          <div key={s.big} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: OUTFIT, fontSize: 54, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{s.big}</div>
            <div style={{ fontFamily: SYNE, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,.75)", marginTop: 6 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <section id="cta" className="section-pad" style={{ padding: "160px 64px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 700, height: 700, background: "radial-gradient(circle,rgba(44,95,138,.06),transparent 65%)", pointerEvents: "none" }}/>
        <h2 className="reveal" style={{ fontFamily: OUTFIT, fontSize: "clamp(38px,5.5vw,80px)", fontWeight: 300, lineHeight: 1.08, marginBottom: 16, letterSpacing: "-0.03em" }}>
          Your home deserves<br/>a <em style={{ color: C.gold, fontStyle: "normal", fontWeight: 700 }}>butler.</em>
        </h2>
        <p className="reveal d1" style={{ fontSize: 18, fontWeight: 300, color: C.muted, marginBottom: 48 }}>
          Join the waitlist and be among the first to experience homeownership the way it was supposed to feel.
        </p>
        {submitted ? (
          <div className="reveal" style={{ maxWidth: 440, margin: "0 auto", padding: "20px", background: "#EBF7F1", border: `1px solid rgba(74,158,107,0.3)`, color: "#2E7D52", fontFamily: SYNE, fontSize: 14, fontWeight: 700, letterSpacing: "0.05em" }}>
            ✓ You&apos;re on the list. We&apos;ll be in touch.
          </div>
        ) : (
          <form className="reveal d2" onSubmit={handleSignup} style={{ display: "flex", maxWidth: 440, margin: "0 auto 14px", flexWrap: "wrap", gap: 0 }}>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Enter your email address"
              style={{ flex: 1, minWidth: 200, background: "white", border: `1.5px solid ${C.border}`, borderRight: "none", color: C.text, fontFamily: DM, fontSize: 14, padding: "16px 20px", outline: "none" }}
            />
            <button type="submit" style={{ background: C.gold, color: "#fff", fontFamily: SYNE, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 28px", border: "none", cursor: "pointer", whiteSpace: "nowrap", transition: "background .2s" }}>
              Sign Up Free
            </button>
          </form>
        )}
        <p className="reveal d3" style={{ fontSize: 12, color: C.dim }}>No credit card required · Free to join</p>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer-flex" style={{ borderTop: `1px solid ${C.border}`, padding: "44px 64px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: SYNE, fontSize: 18, fontWeight: 800, letterSpacing: "0.14em", color: C.gold }}>BTLR</div>
        <ul style={{ display: "flex", gap: 36, listStyle: "none", flexWrap: "wrap" }}>
          {[
            { label: "Features",     href: "#features" },
            { label: "Health Score", href: "#health-score" },
            { label: "Privacy",      href: "/privacy" },
            { label: "Terms",        href: "/terms" },
          ].map(l => (
            <li key={l.label}>
              <a href={l.href} className="nav-link-hover" style={{ fontSize: 13, color: C.muted, textDecoration: "none", transition: "color .2s" }}>{l.label}</a>
            </li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: C.dim }}>© 2026 BTLR. All rights reserved.</div>
      </footer>
    </>
  );
}
