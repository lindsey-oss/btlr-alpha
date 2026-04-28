"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Home as HomeIcon, Loader2, Phone, Mail, Globe, CheckCircle2, UserCircle2 } from "lucide-react";
import { phCapture } from "../../../lib/monitoring";

const ROLE_LABELS: Record<string, string> = {
  realtor:  "Real Estate Agent",
  lender:   "Mortgage Lender",
  escrow:   "Escrow Officer",
  title:    "Title Officer",
  attorney: "Real Estate Attorney",
  insurance_broker: "Insurance Broker",
  home_warranty:    "Home Warranty",
};

const C = {
  navy:    "#0f1f3d",
  accent:  "#2563eb",
  text:    "#0f172a",
  text2:   "#475569",
  text3:   "#94a3b8",
  border:  "#e2e8f0",
  bg:      "#f0f4f8",
  green:   "#16a34a",
};

interface Affiliate {
  id: string;
  code: string;
  name: string;
  company?: string;
  role: string;
  phone?: string;
  email?: string;
  photo_url?: string;
  bio?: string;
  website?: string;
}

export default function AffiliateLandingPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res  = await fetch(`/api/affiliate/lookup?code=${encodeURIComponent(code)}`);
        const json = await res.json();
        if (!res.ok || !json.affiliate) { setNotFound(true); return; }
        setAffiliate(json.affiliate);
        phCapture("affiliate_referral_viewed", { affiliate_code: code, affiliate_role: json.affiliate.role });
        // Store the code so the login page can pick it up after signup
        sessionStorage.setItem("btlr_affiliate_ref", code);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    if (code) load();
  }, [code]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <Loader2 size={28} color={C.accent} className="animate-spin"/>
      </div>
    );
  }

  if (notFound || !affiliate) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: C.bg, padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Link not found</p>
        <p style={{ fontSize: 14, color: C.text3, marginTop: 8 }}>This referral link may be invalid or expired.</p>
        <button onClick={() => router.push("/login")} style={{ marginTop: 24, padding: "10px 24px", borderRadius: 10,
          background: C.navy, color: "white", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Create Account
        </button>
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[affiliate.role] ?? affiliate.role;

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 60%, #1e3a5f 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* BTLR brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.2)" }}>
            <HomeIcon size={19} color="white"/>
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>BTLR</span>
        </div>

        {/* Affiliate card */}
        <div style={{ background: "white", borderRadius: 20, padding: "28px 28px 24px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}>

          {/* Avatar */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            {affiliate.photo_url ? (
              <img src={affiliate.photo_url} alt={affiliate.name} style={{ width: 80, height: 80,
                borderRadius: "50%", objectFit: "cover", border: "3px solid #e2e8f0" }}/>
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: C.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "3px solid #e2e8f0" }}>
                <UserCircle2 size={44} color={C.text3}/>
              </div>
            )}
          </div>

          {/* Name + role */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>{affiliate.name}</p>
            {affiliate.company && (
              <p style={{ fontSize: 14, color: C.text2, margin: "0 0 4px" }}>{affiliate.company}</p>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, background: "#eff6ff",
              padding: "3px 10px", borderRadius: 20, border: "1px solid #bfdbfe" }}>
              {roleLabel}
            </span>
          </div>

          {/* Bio */}
          {affiliate.bio && (
            <p style={{ fontSize: 14, color: C.text2, textAlign: "center", lineHeight: 1.6,
              margin: "0 0 16px", padding: "0 4px" }}>
              {affiliate.bio}
            </p>
          )}

          {/* Contact chips */}
          {(affiliate.phone || affiliate.email || affiliate.website) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 20 }}>
              {affiliate.phone && (
                <a href={`tel:${affiliate.phone.replace(/\D/g, "")}`} style={{ display: "inline-flex",
                  alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8,
                  background: C.bg, border: `1px solid ${C.border}`, color: C.text2,
                  fontSize: 13, textDecoration: "none" }}>
                  <Phone size={12} color={C.accent}/>{affiliate.phone}
                </a>
              )}
              {affiliate.email && (
                <a href={`mailto:${affiliate.email}`} style={{ display: "inline-flex",
                  alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8,
                  background: C.bg, border: `1px solid ${C.border}`, color: C.text2,
                  fontSize: 13, textDecoration: "none" }}>
                  <Mail size={12} color={C.accent}/>{affiliate.email}
                </a>
              )}
              {affiliate.website && (
                <a href={affiliate.website.startsWith("http") ? affiliate.website : `https://${affiliate.website}`}
                  target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex",
                  alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8,
                  background: C.bg, border: `1px solid ${C.border}`, color: C.text2,
                  fontSize: 13, textDecoration: "none" }}>
                  <Globe size={12} color={C.accent}/>Website
                </a>
              )}
            </div>
          )}

          {/* Value props */}
          <div style={{ background: "#f8faff", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.text3, textTransform: "uppercase",
              letterSpacing: "0.06em", margin: "0 0 10px" }}>What you get with BTLR</p>
            {[
              "Home health score from your inspection report",
              "Predictive maintenance timeline & cost estimates",
              "AI-powered contractor matching & pre-written job briefs",
              `${affiliate.name} pre-saved in your vendor directory`,
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                <CheckCircle2 size={14} color={C.green} style={{ flexShrink: 0, marginTop: 1 }}/>
                <span style={{ fontSize: 13, color: C.text2, lineHeight: 1.4 }}>{item}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button onClick={() => router.push("/login?signup=1")} style={{
            width: "100%", padding: "13px", borderRadius: 12, border: "none",
            background: C.navy, color: "white", fontSize: 16, fontWeight: 700,
            cursor: "pointer", letterSpacing: "-0.2px",
          }}>
            Create Your Free Account →
          </button>
          <p style={{ fontSize: 12, color: C.text3, textAlign: "center", margin: "10px 0 0" }}>
            {affiliate.name} will be pre-saved in your home team. No credit card required.
          </p>
        </div>

        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center" }}>
          Powered by BTLR Home OS — btlrai.com
        </p>
      </div>
    </div>
  );
}
