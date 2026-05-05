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
      fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600,
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
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 54, fontWeight: 800, color: C.text, lineHeight: 1 }}>{animated ? score : 0}</div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted, marginTop: 4 }}>Health Score</div>
      </div>
    </div>
  );
}

// ── Vendor types ─────────────────────────────────────────────────────────────
const VENDOR_TYPES = [
  "HVAC / Heating & Cooling", "Roofing", "Plumbing", "Electrical",
  "General Contractor", "Landscaping", "Pest Control", "Foundation & Waterproofing",
  "Painting", "Windows & Doors", "Appliance Repair", "Flooring",
  "Solar & Energy", "Pool & Spa", "Other",
];

// ── Vendor Modal ──────────────────────────────────────────────────────────────
function VendorModal({ onClose }: { onClose: () => void }) {
  const [step, setStep]       = useState<"type" | "info" | "done">("type");
  const [selected, setSelected] = useState<string>("");
  const [form, setForm]       = useState({ name: "", company: "", email: "", phone: "", zip: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendor-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade: selected, ...form }),
      });
      if (!res.ok) throw new Error("Submit failed");
      setStep("done");
    } catch {
      alert("Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "rgba(15,20,35,0.55)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={onClose}>
      <div className="vendor-modal-inner" style={{
        background: "#fff", width: "100%", maxWidth: 520, borderRadius: 16,
        padding: 40, position: "relative", boxShadow: "0 24px 80px rgba(0,0,0,.18)",
        maxHeight: "90vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: C.dim, fontSize: 20, lineHeight: 1 }}>✕</button>

        {step === "done" ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.goldDim, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10 }}>You&apos;re on the list!</h2>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: C.muted, lineHeight: 1.7 }}>
              We&apos;ll be in touch at <strong>{form.email}</strong> when your vendor profile is ready. We&apos;re onboarding contractors in your area soon.
            </p>
            <button onClick={onClose} style={{ marginTop: 28, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "14px 32px", background: C.gold, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
              Close
            </button>
          </div>
        ) : step === "type" ? (
          <>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: C.gold, marginBottom: 10 }}>Join the Trusted Network</div>
              <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8 }}>What kind of contractor are you?</h2>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: C.muted, lineHeight: 1.6 }}>We match homeowners with pre-vetted local pros. Select your trade to get started.</p>
            </div>
            <div className="vendor-type-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 24 }}>
              {VENDOR_TYPES.map(v => (
                <button key={v} onClick={() => setSelected(v)} style={{
                  padding: "10px 14px", border: `1.5px solid ${selected === v ? C.gold : C.border}`,
                  borderRadius: 8, background: selected === v ? C.goldDim : "#fff",
                  fontFamily: "'Inter', sans-serif", fontSize: 13, color: selected === v ? C.gold : C.text,
                  fontWeight: selected === v ? 600 : 400,
                  cursor: "pointer", textAlign: "left", transition: "all .15s",
                }}>
                  {v}
                </button>
              ))}
            </div>
            <button onClick={() => selected && setStep("info")} style={{
              width: "100%", padding: "14px", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", border: "none", borderRadius: 8,
              background: selected ? C.gold : C.surface2, color: selected ? "#fff" : C.dim,
              cursor: selected ? "pointer" : "default", transition: "background .2s",
            }}>
              Continue →
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: C.gold, marginBottom: 10 }}>{selected}</div>
              <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8 }}>Tell us about your business</h2>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: C.muted }}>We&apos;ll reach out to verify and activate your profile.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {[
                { key: "name", label: "Your Name", placeholder: "Jane Smith", type: "text" },
                { key: "company", label: "Company Name", placeholder: "Smith Roofing Co.", type: "text" },
                { key: "email", label: "Email", placeholder: "jane@smithroofing.com", type: "email" },
                { key: "phone", label: "Phone", placeholder: "(619) 555-0100", type: "tel" },
                { key: "zip", label: "Service Area (ZIP)", placeholder: "92101", type: "text" },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 6 }}>{label}</label>
                  <input
                    required type={type} placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", padding: "11px 14px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontFamily: "'Inter', sans-serif", fontSize: 16, color: C.text, outline: "none", background: "#fff" }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setStep("type")} style={{ flex: "0 0 auto", padding: "14px 18px", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", background: C.surface, color: C.muted, border: "none", borderRadius: 8, cursor: "pointer" }}>
                ← Back
              </button>
              <button type="submit" disabled={submitting} style={{ flex: 1, padding: "14px", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", border: "none", borderRadius: 8, background: C.gold, color: "#fff", cursor: "pointer" }}>
                {submitting ? "Submitting…" : "Request to Join"}
              </button>
            </div>
          </form>
        )}
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
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Scroll-scrub video effect ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Force load on iOS — Safari won't preload without explicit call
    video.muted = true;
    video.load();
    video.pause();

    let raf: number;
    let targetTime = 0;
    let currentTime = 0;
    let ready = false;

    function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

    const v = video; // stable non-null reference for closures

    function tick() {
      if (!ready || !v.duration) { raf = requestAnimationFrame(tick); return; }
      currentTime = lerp(currentTime, targetTime, 0.12);
      if (Math.abs(currentTime - v.currentTime) > 0.016) {
        try { v.currentTime = Math.max(0, Math.min(v.duration, currentTime)); } catch {}
      }
      raf = requestAnimationFrame(tick);
    }

    function onReady() { ready = true; }
    v.addEventListener("loadedmetadata", onReady);
    if (v.readyState >= 1) ready = true; // already loaded

    function showLabel(id: string, show: boolean) {
      const el = document.getElementById(id);
      if (el) {
        el.style.opacity = show ? "1" : "0";
        el.style.transform = show ? "translateY(0)" : "translateY(6px)";
      }
    }

    function onScroll() {
      const section = document.getElementById("dollhouse");
      if (!section) return;
      const rect  = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const raw = Math.max(0, Math.min(1, -rect.top / total));

      // ── Labels always appear based on scroll — independent of video load state ──
      showLabel("lbl-roof",        raw > 0.15);
      showLabel("lbl-hvac",        raw > 0.25);
      showLabel("lbl-landscaping", raw > 0.35);
      showLabel("lbl-plumbing",    raw > 0.50);
      showLabel("lbl-electrical",  raw > 0.60);
      showLabel("lbl-all",         raw > 0.75);

      // ── Video scrub — only when metadata has loaded ───────────────────────
      if (ready && v.duration) {
        const progress = raw < 0.10 ? 0 : raw > 0.90 ? 1 : (raw - 0.10) / 0.80;
        targetTime = progress * v.duration;
      }
    }

    raf = requestAnimationFrame(tick);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      v.removeEventListener("loadedmetadata", onReady);
    };
  }, []);

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
      {/* VendorModal removed — nav button now links to /apply */}
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth}
        body{background:#fff;color:${C.text};font-family:'DM Sans',sans-serif;overflow-x:clip}
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
        #sv-labels-mobile{display:none}
        .feat-card:hover{border-color:${C.borderGold} !important;background:#F5F8FC !important}
        .feat-card::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:${C.gold};transition:width .4s}
        .feat-card:hover::after{width:100%}
        .nav-link-hover:hover{color:${C.text} !important}
        .vendor-join-btn:hover{background:${C.goldDim} !important;border-color:${C.gold} !important}
        .nav-signup-btn{display:inline-block}
        .btn-primary-hover:hover{background:${C.goldDk} !important;transform:translateY(-2px);box-shadow:0 10px 36px rgba(44,95,138,.25)}
        .pain-item{display:flex;align-items:flex-start;gap:16px;padding:22px 0;border-bottom:1px solid rgba(255,255,255,.07)}
        .pain-item:first-child{border-top:1px solid rgba(255,255,255,.07)}
        .step-hover:hover{border-color:${C.gold} !important}
        .vendor-row-hover:hover{border-color:${C.borderGold} !important;background:${C.surface} !important}
        /* Footer grid — desktop base */
        .footer-cols{display:grid;grid-template-columns:1.6fr 1fr 1fr 1.4fr;gap:48px}
        @media(max-width:900px){
          /* Nav */
          .nav-links-hide{display:none !important}
          .vendor-join-btn{display:none !important}
          .nav-signup-btn{display:none !important}
          nav{padding:16px 20px !important}
          /* Hero */
          .hero-h1{font-size:clamp(32px,7vw,56px) !important}
          .hero-accent{font-size:clamp(36px,8vw,66px) !important}
          .hero-pad{padding:110px 24px 72px !important}
          .hero-ctas{flex-direction:column !important;align-items:center !important;gap:16px !important}
          /* Sections */
          .section-pad{padding:72px 24px !important}
          /* Grids */
          .two-col{grid-template-columns:1fr !important;gap:40px !important}
          .three-col{grid-template-columns:1fr !important}
          .feat-grid-col{grid-template-columns:1fr 1fr !important}
          .steps-grid{grid-template-columns:1fr !important;gap:28px !important}
          .steps-grid::before{display:none !important}
          .stats-flex{flex-wrap:wrap !important;gap:28px 40px !important;padding:56px 28px !important;justify-content:center !important}
          /* Footer */
          .footer-cols{grid-template-columns:1fr 1fr;gap:36px}
          @media(max-width:560px){.footer-cols{grid-template-columns:1fr;gap:28px}}
          /* Dollhouse */
          #sv-labels{display:none !important}
          #sv-labels-mobile{display:flex !important}
          .dh-scroll-hint{display:none !important}
          #dollhouse{height:260vh !important}
          .dh-headline{margin-bottom:16px !important}
          .dh-headline h2{font-size:clamp(20px,5vw,32px) !important}
          .dh-video-wrap{width:96vw !important}
          /* Health score — visual below text on mobile */
          #hs-visual{order:2}
          /* Concierge chat */
          .chat-bubble{max-width:90% !important}
          /* Reality section */
          #reality{padding:72px 24px !important}
        }
        @media(max-width:600px){
          /* Features go single column on phones */
          .feat-grid-col{grid-template-columns:1fr !important}
          /* Stats strip — 2 per row */
          .stat-item{flex:0 0 calc(50% - 20px) !important;text-align:center}
          /* Dollhouse: shorter scroll on phones */
          #dollhouse{height:220vh !important}
          .dh-video-wrap video{max-height:52vh !important;width:auto !important;max-width:96vw !important}
          /* Section padding tighter */
          .section-pad{padding:56px 20px !important}
          .hero-pad{padding:100px 20px 80px !important}
          /* Reality section */
          #reality{padding:60px 20px !important}
          /* Features section */
          #features{padding:60px 20px !important}
          /* Hide scroll hint — overlaps hero content on small screens */
          .hero-scroll-hint{display:none !important}
          /* Prevent any element from creating horizontal overflow */
          section,div{max-width:100%;word-break:break-word}
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
        <Link href="/" style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: "0.14em", color: C.gold, textDecoration: "none" }}>
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
          <Link href="/apply" className="vendor-join-btn" style={{
            fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase", padding: "11px 18px",
            background: "transparent", color: C.gold,
            border: `1.5px solid ${C.borderGold}`, borderRadius: 8,
            textDecoration: "none", transition: "background .2s, border-color .2s",
          }}>
            Join Trusted Network
          </Link>
          <Link href="/dashboard" style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 14px", color: C.muted, textDecoration: "none", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            Log In
          </Link>
          <a href="#cta" style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 30px", background: C.gold, color: "#fff", textDecoration: "none", transition: "background .2s" }}
            className="btn-primary-hover nav-signup-btn">
            Sign Up Free
          </a>
        </div>
      </nav>

      {/* ── HERO ── */}
      {/*
        ── HERO ──
        Layout: flex column, min-height 88vh
        • bg gradient: absolute/inert (decorative only, never blocks content)
        • content div: flex:1 so it fills remaining height, centers itself
        • scroll hint: in normal flow as last child — NO position:absolute
          This prevents the old bug where bottom:36px absolute
          overlapped the "contractor" link when content grew tall.
      */}
      <section className="hero-pad" style={{ minHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "140px 64px 0", position: "relative", overflow: "hidden" }}>
        {/* Decorative bg — pointer-events:none, purely visual */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 75% 55% at 70% 55%,rgba(44,95,138,.05),transparent 68%)", pointerEvents: "none" }}/>

        {/* Main content — takes all available space, centers vertically */}
        <div style={{ position: "relative", zIndex: 1, maxWidth: 760, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <p style={{ display: "inline-flex", alignItems: "center", gap: 10, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold, marginBottom: 28, opacity: 0, animation: "fadeUp .7s .15s forwards" }}>
            <span style={{ width: 28, height: 1, background: C.gold, display: "inline-block" }}/>
            Now in Early Access
          </p>
          <h1 className="hero-h1" style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(38px,4.5vw,70px)", fontWeight: 300, lineHeight: 1.06, marginBottom: 8, letterSpacing: "-0.02em", opacity: 0, animation: "fadeUp .7s .3s forwards" }}>
            Your Home,
          </h1>
          <div className="hero-accent" style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(44px,5.5vw,82px)", fontWeight: 700, color: C.gold, lineHeight: 1.03, marginBottom: 32, letterSpacing: "-0.03em", opacity: 0, animation: "fadeUp .7s .48s forwards" }}>
            Fully Managed.
          </div>
          <p style={{ fontSize: 17, fontWeight: 300, color: C.muted, lineHeight: 1.78, maxWidth: 580, margin: "0 auto 44px", opacity: 0, animation: "fadeUp .7s .64s forwards" }}>
            BTLR is your AI home operating system — health scores, repair budgeting, mortgage tracking, and a concierge that handles the rest.
          </p>
          <div className="hero-ctas" style={{ display: "flex", gap: 20, alignItems: "center", justifyContent: "center", opacity: 0, animation: "fadeUp .7s .8s forwards", flexWrap: "wrap" }}>
            <a href="#cta" className="btn-primary-hover" style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 38px", background: C.gold, color: "#fff", textDecoration: "none", display: "inline-block", transition: "all .2s" }}>
              Sign Up Free
            </a>
            <a href="#features" style={{ color: C.muted, fontSize: 14, textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
              See your home <span style={{ transition: "transform .2s" }}>→</span>
            </a>
          </div>
          {/* Contractor link — below CTAs, stacked vertically */}
          <p style={{ opacity: 0, animation: "fadeUp .7s .96s forwards", marginTop: 20, marginBottom: 0 }}>
            <Link href="/apply" style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: C.dim, textDecoration: "none", borderBottom: `1px solid ${C.borderGold}`, paddingBottom: 2 }}>
              Are you a contractor? Join our network →
            </Link>
          </p>
        </div>

        {/* Scroll hint — in normal document flow, BELOW all content, hidden on mobile via CSS */}
        <div className="hero-scroll-hint" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "28px 0 36px", opacity: 0, animation: "fadeIn 1s 1.4s forwards" }}>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.dim, opacity: 0.6 }}>Scroll</span>
          <div style={{ width: 1, height: 44, background: `linear-gradient(${C.gold},transparent)`, animation: "pulse 2s infinite" }}/>
        </div>
      </section>

      {/* ── SCROLL VIDEO (DOLLHOUSE) ── */}
      <section id="dollhouse" style={{ height: "340vh", position: "relative", background: "#fff" }}>
        <div style={{
          position: "sticky", top: 0, height: "100vh",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          overflow: "hidden", background: "#ffffff",
        }}>
          {/* Warm glow */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 55% at 50% 56%,rgba(255,246,224,0.55),transparent 68%)", pointerEvents: "none", zIndex: 0 }}/>

          {/* Headline */}
          <div className="dh-headline" style={{ position: "relative", zIndex: 2, textAlign: "center", marginBottom: 28, padding: "0 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold, marginBottom: 14 }}>
              Your Home, Intelligently Managed
            </div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(22px,3.2vw,44px)", fontWeight: 300, color: C.text, lineHeight: 1.2, letterSpacing: "-0.02em" }}>
              Every corner of your home,<br/><strong style={{ fontWeight: 700 }}>covered and connected.</strong>
            </h2>
          </div>

          {/* Scroll-scrubbed video */}
          <div className="dh-video-wrap" style={{ position: "relative", zIndex: 2, width: "min(900px,92vw)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <video
              ref={videoRef}
              src="/house-scroll.mp4"
              preload="auto"
              muted
              playsInline
              disablePictureInPicture
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>

          {/* Mobile system chips — CSS controls display (none on desktop, flex on mobile) */}
          <div id="sv-labels-mobile" style={{
            flexWrap: "wrap", gap: 8, justifyContent: "center",
            padding: "14px 16px 0", position: "relative", zIndex: 3, maxWidth: "96vw",
          }}>
            {[
              { label: "Roof & Structure", sub: "Lifespan tracked" },
              { label: "HVAC", sub: "Filter reminder" },
              { label: "Landscaping", sub: "Scheduled maintenance" },
              { label: "Plumbing", sub: "Water heater: 7 yrs" },
              { label: "Electrical", sub: "Panel up to code" },
              { label: "All Systems", sub: "25+ tracked" },
            ].map(({ label, sub }) => (
              <div key={label} style={{
                background: "white", border: `1.5px solid ${C.borderGold}`,
                padding: "8px 14px", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700,
                letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold,
                whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(28,25,20,.07)",
              }}>
                <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.gold, marginRight: 6, verticalAlign: "middle" }}/>
                {label}
                <span style={{ display: "block", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 400, color: C.muted, letterSpacing: "0.01em", marginTop: 2, textTransform: "none" }}>{sub}</span>
              </div>
            ))}
          </div>

          {/* System labels — shown via JS scroll */}
          <div id="sv-labels" style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }}>
            {[
              { id: "lbl-roof",        style: { top: "29%", left: "50%", transform: "translateX(-50%)" }, label: "Roof & Structure",    sub: "Lifespan tracked" },
              { id: "lbl-hvac",        style: { top: "32%", right: "8%" },                                label: "HVAC",               sub: "Filter due in 3 weeks" },
              { id: "lbl-landscaping", style: { top: "38%", left: "4%" },                                 label: "Landscaping",        sub: "Scheduled maintenance" },
              { id: "lbl-plumbing",    style: { bottom: "24%", left: "6%" },                              label: "Plumbing",           sub: "Water heater: 7 yrs" },
              { id: "lbl-electrical",  style: { bottom: "24%", right: "6%" },                             label: "Electrical",         sub: "Panel up to code" },
              { id: "lbl-all",         style: { bottom: "6%", left: 0, right: 0, margin: "0 auto", width: "fit-content" }, label: "All Systems", sub: "25+ home systems tracked" },
            ].map(({ id, style, label, sub }) => (
              <div key={id} id={id} style={{
                position: "absolute", ...style,
                background: "white", border: `1.5px solid ${C.borderGold}`,
                padding: "11px 20px", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700,
                letterSpacing: "0.12em", textTransform: "uppercase", color: C.gold,
                whiteSpace: "nowrap", boxShadow: "0 4px 18px rgba(28,25,20,.08)",
                opacity: 0, transform: "translateY(6px)", transition: "opacity .45s, transform .45s",
              }}>
                <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.gold, marginRight: 7, verticalAlign: "middle" }}/>
                {label}
                <span style={{ display: "block", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 400, color: C.muted, letterSpacing: "0.02em", marginTop: 3, textTransform: "none" }}>{sub}</span>
              </div>
            ))}
          </div>

          {/* Bottom fade */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "10%", background: "linear-gradient(to top,#ffffff 0%,transparent 100%)", pointerEvents: "none", zIndex: 3 }}/>

          {/* Scroll hint */}
          <div className="dh-scroll-hint" style={{ position: "absolute", bottom: 36, left: 32, fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.dim, display: "flex", alignItems: "center", gap: 8, zIndex: 4 }}>
            <div style={{ width: 1, height: 40, background: `linear-gradient(${C.gold},transparent)`, animation: "pulse 2s infinite" }}/>
            Scroll to reveal
          </div>
        </div>

        {/* Scroll scrubbing handled by useEffect above */}
      </section>

      {/* ── REALITY ── */}
      <section id="reality" className="section-pad" style={{ background: "#3A6491", padding: "120px 64px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "start" }} className="two-col">
          <div className="reveal">
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.goldLt, marginBottom: 18 }}>
              <span style={{ width: 24, height: 1, background: C.goldLt, display: "inline-block" }}/>
              The Reality
            </div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em", color: "#EDE9DC" }}>
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
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, color: C.goldLt, opacity: 0.7, letterSpacing: "0.1em", paddingTop: 2, flexShrink: 0 }}>{n}</div>
                <div style={{ fontSize: 15, fontWeight: 300, color: "rgba(237,233,220,.72)", lineHeight: 1.65 }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="section-pad" style={{ padding: "120px 64px", maxWidth: 1200, margin: "0 auto" }}>
        <div className="reveal" style={{ textAlign: "center", marginBottom: 72 }}>
          <Eyebrow center>What BTLR Does</Eyebrow>
          <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(26px,3.6vw,50px)", fontWeight: 300, color: C.text, letterSpacing: "-0.02em" }}>
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
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12, letterSpacing: "0.02em" }}>{f.title}</div>
              <div style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.72 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HEALTH SCORE ── */}
      <section id="health-score" className="section-pad two-col" style={{ padding: "140px 64px", maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }}>
        <div className="reveal">
          <Eyebrow>Home Health</Eyebrow>
          <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Know exactly what&apos;s happening<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>inside your home.</strong>
          </h2>
          <p style={{ fontSize: 16, fontWeight: 300, color: C.muted, lineHeight: 1.82, marginBottom: 28 }}>
            Upload your inspection report and BTLR builds a complete picture of every system — roof, HVAC, plumbing, electrical — with real replacement timelines and a live health score.
          </p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.borderGold}`, padding: "7px 16px", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="6" y1="3" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="6" cy="8.5" r=".75" fill="currentColor"/></svg>
            Patent-Pending Technology
          </div>
        </div>
        <div id="hs-visual" className="reveal d2" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
          <ScoreRing score={84}/>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { name: "Roof",        val: 82, color: C.gold },
              { name: "HVAC",        val: 91, color: "#3A78AA" },
              { name: "Plumbing",    val: 78, color: C.gold },
              { name: "Electrical",  val: 95, color: C.goldDk },
              { name: "Foundation",  val: 88, color: C.gold },
              { name: "Appliances",  val: 74, color: C.muted },
            ].map(b => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 13, color: C.muted, width: 100, flexShrink: 0 }}>{b.name}</div>
                <div style={{ flex: 1, height: 5, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: b.color, borderRadius: 3, width: `${b.val}%`, transition: "width 1.2s cubic-bezier(.4,0,.2,1)" }}/>
                </div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: C.muted, width: 28, textAlign: "right" }}>{b.val}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONCIERGE ── */}
      <section id="concierge" className="section-pad two-col" style={{ padding: "140px 64px", maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }}>
        <div className="reveal">
          <Eyebrow>AI Concierge</Eyebrow>
          <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Ask BTLR anything.<br/><strong style={{ fontWeight: 700, color: C.goldDk }}>Get real answers.</strong>
          </h2>
          <p style={{ fontSize: 16, fontWeight: 300, color: C.muted, lineHeight: 1.82 }}>
            &ldquo;Is my water heater about to fail?&rdquo; &ldquo;Find me a roofer.&rdquo; &ldquo;When&apos;s my next mortgage payment?&rdquo; BTLR knows your home — and acts on your behalf.
          </p>
        </div>
        <div className="reveal d2" style={{ background: "white", border: `1px solid ${C.border}`, boxShadow: "0 8px 48px rgba(28,25,20,.09)", overflow: "hidden" }}>
          <div style={{ background: C.navy, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>B</div>
            <div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>BTLR</div>
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
              <div key={i} className="chat-bubble" style={{ maxWidth: "80%", padding: "10px 14px", fontSize: 13, lineHeight: 1.6, alignSelf: m.user ? "flex-end" : "flex-start", background: m.user ? C.gold : C.surface, color: m.user ? "#fff" : C.text, border: m.user ? "none" : `1px solid ${C.border}` }}>
                {m.text}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
            <input readOnly placeholder="Ask BTLR about your home…" style={{ flex: 1, border: "none", padding: "14px 16px", fontFamily: "'Inter', sans-serif", fontSize: 13, color: C.text, outline: "none", background: "white" }}/>
            <Link href="/dashboard" style={{ background: C.gold, border: "none", padding: "0 20px", color: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", textDecoration: "none" }}>
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
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(28px,3.6vw,52px)", fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
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
                <div style={{ width: 50, height: 50, border: `1.5px solid ${C.gold}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 800, color: C.gold, margin: "0 auto 24px", background: C.surface, position: "relative", zIndex: 1 }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>{s.t}</div>
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
          <div key={s.big} className="stat-item" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 54, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{s.big}</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,.75)", marginTop: 6 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <section id="cta" className="section-pad" style={{ padding: "160px 64px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 700, height: 700, background: "radial-gradient(circle,rgba(44,95,138,.06),transparent 65%)", pointerEvents: "none" }}/>
        <h2 className="reveal" style={{ fontFamily: "'Inter', sans-serif", fontSize: "clamp(38px,5.5vw,80px)", fontWeight: 300, lineHeight: 1.08, marginBottom: 16, letterSpacing: "-0.03em" }}>
          Your home deserves<br/>a <em style={{ color: C.gold, fontStyle: "normal", fontWeight: 700 }}>butler.</em>
        </h2>
        <p className="reveal d1" style={{ fontSize: 18, fontWeight: 300, color: C.muted, marginBottom: 48 }}>
          Join the waitlist and be among the first to experience homeownership the way it was supposed to feel.
        </p>
        {submitted ? (
          <div className="reveal" style={{ maxWidth: 440, margin: "0 auto", padding: "20px", background: "#EBF7F1", border: `1px solid rgba(74,158,107,0.3)`, color: "#2E7D52", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: "0.05em" }}>
            ✓ You&apos;re on the list. We&apos;ll be in touch.
          </div>
        ) : (
          <form className="reveal d2" onSubmit={handleSignup} style={{ display: "flex", maxWidth: 440, margin: "0 auto 14px", flexWrap: "wrap", gap: 0 }}>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Enter your email address"
              style={{ flex: 1, minWidth: 200, background: "white", border: `1.5px solid ${C.border}`, borderRight: "none", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 14, padding: "16px 20px", outline: "none" }}
            />
            <button type="submit" style={{ background: C.gold, color: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 28px", border: "none", cursor: "pointer", whiteSpace: "nowrap", transition: "background .2s" }}>
              Sign Up Free
            </button>
          </form>
        )}
        <p className="reveal d3" style={{ fontSize: 12, color: C.dim }}>No credit card required · Free to join</p>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: "#1E3048", padding: "64px 64px 40px" }}>
        <div className="footer-cols">

          {/* ── Col 1: Brand ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: "0.12em", color: "#FFFFFF" }}>BTLR</div>
            <p style={{ fontFamily: OUTFIT, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, margin: 0, maxWidth: 240 }}>
              The home management platform built around your actual inspection report.
            </p>
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: OUTFIT }}>
              © 2026 BTLR. All rights reserved.
            </div>
          </div>

          {/* ── Col 2: For Professionals ── */}
          <div>
            <p style={{ fontFamily: OUTFIT, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", margin: "0 0 20px" }}>
              For Professionals
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 13 }}>
              {[
                { label: "Real Estate Agents",  href: "/agents" },
                { label: "Mortgage Lenders",    href: "/lenders" },
                { label: "Escrow & Title",      href: "/escrow" },
                { label: "Insurance Brokers",   href: "/insurance" },
              ].map(l => (
                <li key={l.label}>
                  <a href={l.href} style={{ fontFamily: OUTFIT, fontSize: 14, color: "rgba(255,255,255,0.65)", textDecoration: "none", transition: "color .2s" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#FFFFFF")}
                    onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.65)")}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 3: Company ── */}
          <div>
            <p style={{ fontFamily: OUTFIT, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", margin: "0 0 20px" }}>
              Company
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 13 }}>
              {[
                { label: "About",          href: "/about" },
                { label: "Blog",           href: "/blog" },
                { label: "Contact",        href: "/contact" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Service", href: "/terms" },
              ].map(l => (
                <li key={l.label}>
                  <a href={l.href} style={{ fontFamily: OUTFIT, fontSize: 14, color: "rgba(255,255,255,0.65)", textDecoration: "none", transition: "color .2s" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#FFFFFF")}
                    onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.65)")}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 4: Stay Connected ── */}
          <div>
            <p style={{ fontFamily: OUTFIT, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", margin: "0 0 20px" }}>
              Stay Connected
            </p>
            <p style={{ fontFamily: OUTFIT, fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 14px", lineHeight: 1.6 }}>
              Get tips, updates, and home care guides.
            </p>
            <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
              <input
                type="email"
                placeholder="your@email.com"
                style={{ flex: 1, padding: "10px 14px", borderRadius: "8px 0 0 8px", border: "none", fontSize: 13, fontFamily: OUTFIT, background: "rgba(255,255,255,0.1)", color: "white", outline: "none" }}
              />
              <button style={{ padding: "10px 18px", borderRadius: "0 8px 8px 0", border: "none", background: C.gold, color: "white", fontSize: 13, fontWeight: 700, fontFamily: OUTFIT, cursor: "pointer", whiteSpace: "nowrap" }}>
                Submit
              </button>
            </div>
            {/* Social icons */}
            <div style={{ display: "flex", gap: 12 }}>
              {/* X / Twitter */}
              <a href="https://x.com/btlrai" target="_blank" rel="noopener noreferrer"
                style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .2s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.7)"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              {/* Instagram */}
              <a href="https://instagram.com/btlrai" target="_blank" rel="noopener noreferrer"
                style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .2s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              {/* LinkedIn */}
              <a href="https://linkedin.com/company/btlrai" target="_blank" rel="noopener noreferrer"
                style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .2s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.7)"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
              </a>
            </div>
          </div>

        </div>

        {/* ── Divider + bottom bar ── */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 48, paddingTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ fontFamily: OUTFIT, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Built for homeowners. Trusted by professionals.</span>
          <span style={{ fontFamily: OUTFIT, fontSize: 12, color: "rgba(255,255,255,0.2)" }}>Patent Pending</span>
        </div>
      </footer>
    </>
  );
}
