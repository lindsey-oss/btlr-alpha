"use client";
import { useState } from "react";
import {
  Home, Activity, DollarSign, Wrench, Sparkles, FolderOpen,
  Bot, TrendingUp, FileText, AlertTriangle, HelpCircle,
  CheckCircle2, ArrowRight, Shield, BarChart3, Clock,
  ChevronRight,
} from "lucide-react";

const accent  = "#2563eb";
const accentL = "#3b82f6";
const text    = "#0f172a";
const text2   = "#475569";
const text3   = "#94a3b8";
const border  = "#e2e8f0";
const surface = "#ffffff";
const bg      = "#f8fafc";

export default function Landing() {
  const [email, setEmail]         = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setSubmitted(true);
  }

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
      background: surface, color: text, overflowX: "hidden",
    }}>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "18px 48px",
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: `linear-gradient(135deg, ${accent}, #1d4ed8)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 2px 8px ${accent}40`,
          }}>
            <Home size={16} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-0.4px", color: text }}>BTLR</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a href="/login" style={{ fontSize: 15, color: text2, textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </a>
          <a href="/dashboard" style={{
            background: text, color: "white",
            padding: "9px 22px", borderRadius: 99,
            fontSize: 14, fontWeight: 700, textDecoration: "none",
            letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 5,
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}>
            Open Dashboard <ChevronRight size={14} />
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "140px 24px 80px",
        background: surface,
      }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#eff6ff", border: `1px solid ${accent}30`,
            borderRadius: 99, padding: "6px 18px", marginBottom: 40,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: "0.04em" }}>NOW IN EARLY ACCESS</span>
          </div>

          <h1 style={{
            fontSize: 72,
            fontWeight: 800, lineHeight: 1.05,
            letterSpacing: "-3px", margin: "0 0 28px",
            color: text,
          }}>
            Your home,<br />
            <span style={{ color: accent }}>fully managed.</span>
          </h1>

          <p style={{
            fontSize: 20,
            color: text2, lineHeight: 1.65,
            maxWidth: 560, margin: "0 auto 52px",
            fontWeight: 400,
          }}>
            BTLR is your AI home operating system — health scores, repair budgeting, mortgage tracking, and a concierge that handles the rest.
          </p>

          {/* CTA */}
          {!submitted ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, maxWidth: 460, margin: "0 auto", flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{
                  flex: 1, minWidth: 230, padding: "15px 20px",
                  borderRadius: 12, border: `1.5px solid ${border}`,
                  background: surface, color: text,
                  fontSize: 16, outline: "none",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              />
              <button type="submit" style={{
                padding: "15px 28px", borderRadius: 12, border: "none",
                cursor: "pointer", background: text,
                color: "white", fontSize: 16, fontWeight: 700,
                letterSpacing: "-0.2px", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 7,
                boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              }}>
                Join Waitlist <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 9,
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 12, padding: "15px 28px", fontSize: 16, color: "#16a34a",
            }}>
              <CheckCircle2 size={17} color="#16a34a" />
              You&apos;re on the list — we&apos;ll be in touch soon.
            </div>
          )}
          <p style={{ marginTop: 16, fontSize: 14, color: text3 }}>No credit card required · Free to join</p>
        </div>

        {/* Dashboard preview */}
        <div style={{ marginTop: 80, position: "relative", maxWidth: 900, width: "100%" }}>
          <div style={{ position: "absolute", inset: -1, borderRadius: 20, background: `linear-gradient(135deg, ${accent}30, rgba(99,102,241,0.18))`, zIndex: 0 }} />
          <div style={{
            position: "relative", zIndex: 1,
            background: surface, borderRadius: 18, overflow: "hidden",
            border: `1px solid ${border}`,
            boxShadow: "0 24px 80px rgba(0,0,0,0.09), 0 4px 16px rgba(0,0,0,0.04)",
          }}>
            {/* Browser bar */}
            <div style={{ background: bg, padding: "13px 20px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
              <div style={{ marginLeft: 14, background: surface, borderRadius: 7, padding: "4px 14px", fontSize: 12, color: text3, fontWeight: 500 }}>
                btlr.app/dashboard
              </div>
            </div>
            {/* Cards grid */}
            <div style={{ padding: 22, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Health Score",  value: "87",        sub: "3 items need attention",  color: "#16a34a", bg: "#f0fdf4",  icon: <Activity   size={14} color="#16a34a" /> },
                { label: "Mortgage",      value: "$312,400",  sub: "Next payment May 1",       color: accentL,   bg: "#eff6ff",  icon: <DollarSign size={14} color={accentL} /> },
                { label: "Repair Fund",   value: "$2,840",    sub: "+$124 this month",         color: "#7c3aed", bg: "#faf5ff",  icon: <TrendingUp size={14} color="#7c3aed" /> },
                { label: "Insurance",     value: "Active",    sub: "Renews Oct 2026",          color: "#16a34a", bg: "#f0fdf4",  icon: <Shield     size={14} color="#16a34a" /> },
                { label: "Property Tax",  value: "$4,200/yr", sub: "Due Dec 2026",             color: "#d97706", bg: "#fffbeb",  icon: <BarChart3  size={14} color="#d97706" /> },
                { label: "BTLR AI",       value: "Online",    sub: "Ask me anything",          color: accentL,   bg: "#eff6ff",  icon: <Bot        size={14} color={accentL} /> },
              ].map(item => (
                <div key={item.label} style={{ background: bg, borderRadius: 12, padding: "16px 18px", border: `1px solid ${border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {item.icon}
                    </div>
                    <p style={{ fontSize: 11, color: text3, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0, fontWeight: 700 }}>{item.label}</p>
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: item.color, letterSpacing: "-0.5px", margin: "0 0 3px" }}>{item.value}</p>
                  <p style={{ fontSize: 11, color: text3, margin: 0 }}>{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: "#0f172a" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>The Reality</p>
          <h2 style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 24, color: "white" }}>
            Owning a home is a full-time job.<br />
            <span style={{ color: "#475569" }}>Nobody told you that.</span>
          </h2>
          <p style={{ fontSize: 18, color: "#64748b", lineHeight: 1.7 }}>
            Mortgage statements in one app. Insurance in an email you can&apos;t find. Repair receipts in a junk drawer. Property taxes due when you least expect it. And no idea if your roof has 2 years left or 12.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, maxWidth: 900, margin: "56px auto 0", textAlign: "left" }}>
          {[
            { icon: <FileText    size={18} color="#475569" />, text: "Scattered documents across emails, apps, and junk drawers" },
            { icon: <Wrench      size={18} color="#475569" />, text: "No warning before expensive repairs catch you off guard" },
            { icon: <AlertTriangle size={18} color="#475569" />, text: "Surprise bills from tax and insurance renewals" },
            { icon: <HelpCircle  size={18} color="#475569" />, text: "No idea what your home is actually costing to maintain" },
          ].map((item, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "20px 22px", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ marginTop: 2, flexShrink: 0 }}>{item.icon}</div>
              <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.65, margin: 0 }}>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: surface }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>What BTLR Does</p>
            <h2 style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, color: text }}>
              Tony Stark had Jarvis.<br />
              <span style={{ color: accent }}>You have BTLR.</span>
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 14 }}>
            {[
              { icon: <Activity   size={20} color="#16a34a" />, bg: "#f0fdf4", title: "Home Health Score",    desc: "BTLR tracks every system — roof, HVAC, water heater — and gives you a real-time score with replacement timelines before anything fails." },
              { icon: <DollarSign size={20} color={accentL} />, bg: "#eff6ff", title: "Financial Dashboard",  desc: "Mortgage balance, payment dates, insurance renewals, property tax due dates. One place, always current." },
              { icon: <Clock      size={20} color="#d97706" />, bg: "#fffbeb", title: "Predictive Maintenance",desc: "BTLR knows when systems are aging. It tells you months in advance — so repairs are budgeted, never a shock." },
              { icon: <TrendingUp size={20} color="#7c3aed" />, bg: "#faf5ff", title: "Repair Savings Fund",   desc: "Set aside money for your home automatically. Like Acorns for homeownership — invested while you wait." },
              { icon: <Bot        size={20} color={accentL} />, bg: "#eff6ff", title: "AI Concierge",          desc: "Ask BTLR to find a contractor, explain a repair cost, or flag anything urgent. It doesn't just inform you — it acts." },
              { icon: <FolderOpen size={20} color="#e11d48" />, bg: "#fff1f2", title: "Document Vault",        desc: "Every warranty, receipt, inspection report, and permit — stored, organized, searchable. No more hunting through email." },
            ].map((f, i) => (
              <div key={i} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 18, padding: "28px 26px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: f.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", margin: "0 0 10px", color: text }}>{f.title}</h3>
                <p style={{ fontSize: 15, color: text2, lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: bg, borderTop: `1px solid ${border}` }}>
        <div style={{ maxWidth: 660, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>How It Works</p>
          <h2 style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 60, color: text }}>
            Set up in minutes.<br />Runs forever.
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "left" }}>
            {[
              { icon: <Sparkles size={17} color={accentL} />, step: "01", title: "Connect your accounts", desc: "Link your mortgage, bank, and insurance in seconds. BTLR pulls everything automatically — no manual entry." },
              { icon: <FileText  size={17} color={accentL} />, step: "02", title: "Upload your inspection report", desc: "Drop in your home inspection PDF. BTLR's AI extracts every system age, flags concerns, and calculates your health score." },
              { icon: <Bot       size={17} color={accentL} />, step: "03", title: "Let BTLR run your home", desc: "BTLR watches everything, alerts you when action is needed, and handles what you ask. You just live in your home." },
            ].map((item, i, arr) => (
              <div key={i} style={{ display: "flex", gap: 20, alignItems: "flex-start", position: "relative", paddingBottom: i < arr.length - 1 ? 40 : 0 }}>
                {i < arr.length - 1 && (
                  <div style={{ position: "absolute", left: 21, top: 46, bottom: 0, width: 1, background: `linear-gradient(${border}, transparent)` }} />
                )}
                <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: "#eff6ff", border: `1px solid ${accent}25`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.icon}
                </div>
                <div style={{ paddingTop: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: text3, letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 5px" }}>{item.step}</p>
                  <h3 style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.4px", margin: "0 0 7px", color: text }}>{item.title}</h3>
                  <p style={{ fontSize: 15, color: text2, lineHeight: 1.65, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section style={{ padding: "110px 24px", textAlign: "center", background: surface, borderTop: `1px solid ${border}` }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-2.5px", lineHeight: 1.05, marginBottom: 20, color: text }}>
            Your home deserves<br />a butler.
          </h2>
          <p style={{ fontSize: 19, color: text2, marginBottom: 48, lineHeight: 1.65 }}>
            Join the waitlist and be among the first to experience homeownership the way it was supposed to feel.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, maxWidth: 460, margin: "0 auto", flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{ flex: 1, minWidth: 220, padding: "15px 20px", borderRadius: 12, border: `1.5px solid ${border}`, background: surface, color: text, fontSize: 16, outline: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
              />
              <button type="submit" style={{
                padding: "15px 28px", borderRadius: 12, border: "none",
                cursor: "pointer", background: text,
                color: "white", fontSize: 16, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 7,
                boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              }}>
                Get Early Access <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "15px 28px", fontSize: 16, color: "#16a34a" }}>
              <CheckCircle2 size={17} color="#16a34a" /> You&apos;re on the list!
            </div>
          )}
          <p style={{ marginTop: 16, fontSize: 14, color: text3 }}>No credit card required · Free to join</p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer style={{ padding: "28px 48px", borderTop: `1px solid ${border}`, background: bg, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Home size={13} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.3px", color: text }}>BTLR</span>
        </div>
        <p style={{ fontSize: 13, color: text3, margin: 0 }}>© 2026 BTLR. All rights reserved.</p>
      </footer>

    </div>
  );
}
