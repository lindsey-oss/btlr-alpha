"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const C = {
  navy:    "#1B2D47", gold: "#2C5F8A", goldDk: "#1E4568",
  text:    "#1C1914", muted: "#6B6558", dim: "#A09C92",
  surface: "#F7F2EC", surface2: "#EDE5D4", border: "rgba(28,25,20,0.09)",
  white:   "#FFFFFF", success: "#15803D",
};
const INTER = "'Inter', sans-serif";
// OUTFIT replaced by Inter
// DM replaced by Inter

const STEPS = [
  { icon: "✉", title: "Confirmation email sent", desc: "Check your inbox for a copy of your submission." },
  { icon: "🔍", title: "We'll verify your credentials", desc: "License, insurance, and references will be reviewed by our team." },
  { icon: "📋", title: "Decision within 5–7 business days", desc: "You'll receive an email with our decision and next steps." },
];

export default function Confirmation() {
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    // Try to get the submitted business name from localStorage
    try {
      const id = localStorage.getItem("btlr_vendor_app_id");
      if (id) {
        fetch(`/api/vendor-apply/save?id=${id}`)
          .then(r => r.json())
          .then(({ data }) => {
            if (data?.business_name) setBusinessName(data.business_name);
          })
          .catch(() => {});
        // Clear the draft ID so a new application starts fresh
        localStorage.removeItem("btlr_vendor_app_id");
      }
    } catch {}
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.surface, fontFamily: INTER }}>
      {/* Nav */}
      <nav style={{ background: C.navy, padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ fontFamily: INTER, fontSize: 18, fontWeight: 800, color: C.gold, letterSpacing: "0.14em", textDecoration: "none" }}>
          BTLR
        </Link>
        <Link href="/" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, textDecoration: "none" }}>
          Return to home →
        </Link>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "80px 24px 100px", textAlign: "center" }}>

        {/* Success mark */}
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#DCFCE7", border: "3px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 32px", fontSize: 36 }}>
          ✓
        </div>

        <h1 style={{ fontFamily: INTER, fontSize: 38, fontWeight: 800, color: C.text, margin: "0 0 16px", lineHeight: 1.15 }}>
          Application Received
        </h1>
        {businessName && (
          <p style={{ fontSize: 18, color: C.gold, fontWeight: 700, margin: "0 0 12px" }}>{businessName}</p>
        )}
        <p style={{ fontSize: 17, color: C.muted, lineHeight: 1.7, margin: "0 0 56px", maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
          Thank you for applying to join the BTLR Trusted Network. Our team reviews every application personally — we&apos;ll be in touch soon.
        </p>

        {/* What happens next */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "36px 32px", textAlign: "left", marginBottom: 48 }}>
          <h2 style={{ fontFamily: INTER, fontSize: 13, fontWeight: 800, color: C.gold, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 28px" }}>
            What Happens Next
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 20, position: "relative" }}>
                {/* connector line */}
                {i < STEPS.length - 1 && (
                  <div style={{ position: "absolute", left: 20, top: 44, width: 2, height: "calc(100% - 12px)", background: C.border }} />
                )}
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#E8F0F8", color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, zIndex: 1 }}>
                  {s.icon}
                </div>
                <div style={{ paddingBottom: i < STEPS.length - 1 ? 28 : 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 15, color: C.text, margin: "6px 0 4px" }}>{s.title}</p>
                  <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline callout */}
        <div style={{ background: "#EDF5FF", border: `1px solid #BFDBFE`, borderRadius: 4, padding: "20px 28px", marginBottom: 48, display: "flex", alignItems: "center", gap: 20, textAlign: "left" }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>⏱</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#1E40AF", margin: "0 0 2px" }}>Expected timeline: 5–7 business days</p>
            <p style={{ fontSize: 13, color: "#3B82F6", margin: 0 }}>
              We&apos;ll reach out by email if we need anything else. If you haven&apos;t heard from us after 7 days, email <a href="mailto:support@btlrai.com" style={{ color: "#1E40AF", fontWeight: 600 }}>support@btlrai.com</a>.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
          <Link href="/" style={{
            padding: "14px 32px", background: C.navy, color: "#fff",
            fontFamily: INTER, fontWeight: 700, fontSize: 14, letterSpacing: "0.06em",
            textDecoration: "none", borderRadius: 2,
          }}>
            Return to BTLR
          </Link>
          <Link href="/apply" style={{
            padding: "14px 32px", background: "transparent", color: C.gold,
            fontFamily: INTER, fontWeight: 700, fontSize: 14, letterSpacing: "0.06em",
            textDecoration: "none", borderRadius: 2, border: `2px solid ${C.gold}`,
          }}>
            View Application Info
          </Link>
        </div>
      </div>
    </div>
  );
}
