"use client";
import { useState } from "react";
import {
  Home, Activity, DollarSign, Wrench, Sparkles, FolderOpen,
  Bot, TrendingUp, FileText, AlertTriangle, HelpCircle,
  CheckCircle2, ArrowRight, Shield, BarChart3, Clock,
  ChevronRight,
} from "lucide-react";

// ── Design tokens (match dashboard) ──────────────────────────────────────
const accent  = "#2563eb";
const accentL = "#3b82f6";
const navy    = "#0f1f3d";

function IconBox({
  icon, color = accent, bg, size = 20,
}: { icon: React.ReactNode; color?: string; bg?: string; size?: number }) {
  return (
    <div style={{
      width: size + 18, height: size + 18, borderRadius: 12,
      background: bg ?? `${color}18`,
      border: `1px solid ${color}30`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {icon}
    </div>
  );
}

export default function Landing() {
  const [email, setEmail]       = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setSubmitted(true);
  }

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
      background: "#04090f", color: "#fff", overflowX: "hidden",
    }}>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 48px",
        background: "rgba(4,9,15,0.8)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: `linear-gradient(135deg, ${accent}, #1d4ed8)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 2px 8px ${accent}50`,
          }}>
            <Home size={15} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.4px" }}>BTLR</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/login" style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </a>
          <a href="/dashboard" style={{
            background: `linear-gradient(135deg, ${accent}, #1d4ed8)`,
            color: "white", padding: "8px 20px", borderRadius: 99,
            fontSize: 13, fontWeight: 600, textDecoration: "none",
            letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 5,
            boxShadow: `0 2px 10px ${accent}40`,
          }}>
            Open Dashboard <ChevronRight size={13} />
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "140px 24px 80px",
        position: "relative", overflow: "hidden",
      }}>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 900, height: 600, background: `radial-gradient(ellipse, ${accent}22 0%, transparent 65%)`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "10%", left: "10%", width: 400, height: 400, background: "radial-gradient(ellipse, rgba(14,165,233,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", maxWidth: 780, margin: "0 auto" }}>
          {/* Badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: `${accent}15`, border: `1px solid ${accent}35`,
            borderRadius: 99, padding: "6px 16px", marginBottom: 36,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: accentL }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: accentL, letterSpacing: "0.04em" }}>NOW IN EARLY ACCESS</span>
          </div>

          <h1 style={{
            fontSize: "clamp(48px, 7vw, 84px)",
            fontWeight: 700, lineHeight: 1.05,
            letterSpacing: "-3px", margin: "0 0 28px",
          }}>
            Your home,<br />
            <span style={{
              background: `linear-gradient(135deg, ${accentL}, #93c5fd)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              fully managed.
            </span>
          </h1>

          <p style={{
            fontSize: "clamp(17px, 2.2vw, 21px)",
            color: "rgba(255,255,255,0.5)", lineHeight: 1.6,
            maxWidth: 560, margin: "0 auto 52px",
            fontWeight: 400, letterSpacing: "-0.2px",
          }}>
            BTLR is your AI home operating system — health scores, repair budgeting, mortgage tracking, and a concierge that handles the rest.
          </p>

          {/* CTA */}
          {!submitted ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, maxWidth: 440, margin: "0 auto", flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{
                  flex: 1, minWidth: 220, padding: "13px 18px",
                  borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)", color: "white",
                  fontSize: 14, outline: "none",
                }}
              />
              <button type="submit" style={{
                padding: "13px 24px", borderRadius: 10, border: "none",
                cursor: "pointer", background: `linear-gradient(135deg, ${accent}, #1d4ed8)`,
                color: "white", fontSize: 14, fontWeight: 600,
                letterSpacing: "-0.2px", whiteSpace: "nowrap",
                boxShadow: `0 4px 14px ${accent}40`,
              }}>
                Join Waitlist
              </button>
            </form>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)",
              borderRadius: 10, padding: "13px 24px", fontSize: 14, color: "#4ade80",
            }}>
              <CheckCircle2 size={15} color="#4ade80" />
              You&apos;re on the list — we&apos;ll be in touch soon.
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,0.2)" }}>No credit card required · Free to join</p>
        </div>

        {/* Dashboard preview */}
        <div style={{ marginTop: 72, position: "relative", maxWidth: 860, width: "100%" }}>
          <div style={{ position: "absolute", inset: -1, borderRadius: 18, background: `linear-gradient(135deg, ${accent}50, rgba(14,165,233,0.3))`, zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1, background: "rgba(8,15,26,0.97)", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Title bar */}
            <div style={{ background: "rgba(255,255,255,0.03)", padding: "11px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
              <span style={{ marginLeft: 10, fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>btlr.app/dashboard</span>
            </div>
            {/* Mock cards */}
            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                { label: "Health Score",   value: "87",         sub: "3 items need attention",  color: "#f59e0b", icon: <Activity size={13} color="#f59e0b" /> },
                { label: "Mortgage",       value: "$312,400",   sub: "Next payment Apr 15",      color: accentL,   icon: <DollarSign size={13} color={accentL} /> },
                { label: "Repair Fund",    value: "$2,840",     sub: "+$124 this month",         color: "#a78bfa", icon: <TrendingUp size={13} color="#a78bfa" /> },
                { label: "Insurance",      value: "Active",     sub: "Renews Oct 2026",          color: "#4ade80", icon: <Shield size={13} color="#4ade80" /> },
                { label: "Property Tax",   value: "$4,200/yr",  sub: "Due Dec 2026",             color: "#fb923c", icon: <BarChart3 size={13} color="#fb923c" /> },
                { label: "BTLR AI",        value: "Online",     sub: "Ask me anything",          color: accentL,   icon: <Bot size={13} color={accentL} /> },
              ].map(item => (
                <div key={item.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    {item.icon}
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{item.label}</p>
                  </div>
                  <p style={{ fontSize: 19, fontWeight: 700, color: item.color, letterSpacing: "-0.5px", margin: "0 0 3px" }}>{item.value}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", margin: 0 }}>{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: "linear-gradient(180deg, #04090f 0%, #060d18 100%)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18 }}>The Problem</p>
          <h2 style={{ fontSize: "clamp(30px, 4.5vw, 50px)", fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 24 }}>
            Owning a home is a full-time job.<br />
            <span style={{ color: "rgba(255,255,255,0.3)" }}>Nobody told you that.</span>
          </h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
            Mortgage statements in one app. Insurance in an email you can&apos;t find. Repair receipts in a junk drawer. Property taxes due when you least expect it. And no idea if your roof has 2 years left or 12.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, maxWidth: 860, margin: "56px auto 0", textAlign: "left" }}>
          {[
            { icon: <FileText size={16} color="rgba(255,255,255,0.4)" />,     text: "Scattered documents across emails, apps, and junk drawers" },
            { icon: <Wrench size={16} color="rgba(255,255,255,0.4)" />,       text: "No warning before expensive repairs catch you off guard" },
            { icon: <AlertTriangle size={16} color="rgba(255,255,255,0.4)" />,text: "Surprise bills from tax and insurance renewals" },
            { icon: <HelpCircle size={16} color="rgba(255,255,255,0.4)" />,   text: "No idea what your home is actually costing to maintain" },
          ].map((item, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "18px 20px", display: "flex", gap: 13, alignItems: "flex-start" }}>
              <div style={{ marginTop: 2, flexShrink: 0 }}>{item.icon}</div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, margin: 0 }}>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: "#060d18" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18 }}>What BTLR Does</p>
            <h2 style={{ fontSize: "clamp(30px, 4.5vw, 50px)", fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1.1 }}>
              Tony Stark had Jarvis.<br />
              <span style={{ color: accentL }}>You have BTLR.</span>
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(255px, 1fr))", gap: 14 }}>
            {[
              {
                icon: <Activity size={18} color="#4ade80" />, iconColor: "#4ade80",
                title: "Home Health Score",
                desc: "BTLR tracks every system — roof, HVAC, water heater — and gives you a real-time score with replacement timelines before anything fails.",
              },
              {
                icon: <DollarSign size={18} color={accentL} />, iconColor: accentL,
                title: "Financial Dashboard",
                desc: "Mortgage balance, payment dates, insurance renewals, property tax due dates. One place, always current.",
              },
              {
                icon: <Clock size={18} color="#fb923c" />, iconColor: "#fb923c",
                title: "Predictive Maintenance",
                desc: "BTLR knows when systems are aging. It tells you months in advance — so repairs are budgeted, never a shock.",
              },
              {
                icon: <TrendingUp size={18} color="#a78bfa" />, iconColor: "#a78bfa",
                title: "Repair Savings Fund",
                desc: "Set aside money for your home automatically. Like Acorns for homeownership — invested while you wait.",
              },
              {
                icon: <Bot size={18} color={accentL} />, iconColor: accentL,
                title: "AI Concierge",
                desc: "Ask BTLR to find a contractor, explain a repair cost, or flag anything urgent. It doesn't just inform you — it acts.",
              },
              {
                icon: <FolderOpen size={18} color="#f87171" />, iconColor: "#f87171",
                title: "Document Vault",
                desc: "Every warranty, receipt, inspection report, and permit — stored, organized, searchable. No more hunting through email.",
              },
            ].map((f, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 16, padding: 24,
              }}>
                <IconBox icon={f.icon} color={f.iconColor} size={18} />
                <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.3px", margin: "16px 0 8px", color: "rgba(255,255,255,0.9)" }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", background: "linear-gradient(180deg, #060d18, #04090f)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18 }}>How It Works</p>
          <h2 style={{ fontSize: "clamp(30px, 4.5vw, 46px)", fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 56 }}>
            Set up in minutes.<br />Runs forever.
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "left" }}>
            {[
              {
                icon: <Sparkles size={16} color={accentL} />,
                step: "01", title: "Connect your accounts",
                desc: "Link your mortgage, bank, and insurance in seconds. BTLR pulls everything automatically — no manual entry.",
              },
              {
                icon: <FileText size={16} color={accentL} />,
                step: "02", title: "Upload your inspection report",
                desc: "Drop in your home inspection PDF. BTLR's AI extracts every system age, flags concerns, and calculates your health score.",
              },
              {
                icon: <Bot size={16} color={accentL} />,
                step: "03", title: "Let BTLR run your home",
                desc: "BTLR watches everything, alerts you when action is needed, and handles what you ask. You just live in your home.",
              },
            ].map((item, i, arr) => (
              <div key={i} style={{ display: "flex", gap: 20, alignItems: "flex-start", position: "relative", paddingBottom: i < arr.length - 1 ? 36 : 0 }}>
                {/* Vertical line */}
                {i < arr.length - 1 && (
                  <div style={{ position: "absolute", left: 19, top: 42, bottom: 0, width: 1, background: `linear-gradient(${accent}40, transparent)` }} />
                )}
                <div style={{
                  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                  background: `${accent}18`, border: `1px solid ${accent}35`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {item.icon}
                </div>
                <div style={{ paddingTop: 8 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 4px" }}>{item.step}</p>
                  <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.3px", margin: "0 0 6px", color: "rgba(255,255,255,0.9)" }}>{item.title}</h3>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 700, height: 400, background: `radial-gradient(ellipse, ${accent}18 0%, transparent 65%)`, pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: 580, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(34px, 5vw, 52px)", fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 18 }}>
            Your home deserves<br />a butler.
          </h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)", marginBottom: 44, lineHeight: 1.6 }}>
            Join the waitlist and be among the first to experience homeownership the way it was supposed to feel.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, maxWidth: 420, margin: "0 auto", flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{ flex: 1, minWidth: 210, padding: "13px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, outline: "none" }}
              />
              <button type="submit" style={{
                padding: "13px 24px", borderRadius: 10, border: "none", cursor: "pointer",
                background: `linear-gradient(135deg, ${accent}, #1d4ed8)`,
                color: "white", fontSize: 14, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: `0 4px 16px ${accent}40`,
              }}>
                Get Early Access <ArrowRight size={14} />
              </button>
            </form>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 10, padding: "13px 24px", fontSize: 14, color: "#4ade80" }}>
              <CheckCircle2 size={15} color="#4ade80" /> You&apos;re on the list!
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{ padding: "28px 48px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: `linear-gradient(135deg, ${accent}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Home size={12} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.3px" }}>BTLR</span>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.18)", margin: 0 }}>© 2026 BTLR. All rights reserved.</p>
      </footer>

    </div>
  );
}
