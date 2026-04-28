"use client";

import { useState } from "react";
import { Home as HomeIcon, Loader2, Copy, CheckCircle2, Link as LinkIcon } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "realtor",  label: "Real Estate Agent / Realtor" },
  { value: "lender",   label: "Mortgage Lender / Loan Officer" },
  { value: "escrow",   label: "Escrow Officer" },
  { value: "title",    label: "Title Officer / Company" },
  { value: "attorney", label: "Real Estate Attorney" },
];

const C = {
  navy:   "#0f1f3d",
  accent: "#2563eb",
  text:   "#0f172a",
  text2:  "#475569",
  text3:  "#94a3b8",
  border: "#e2e8f0",
  bg:     "#f0f4f8",
  green:  "#16a34a",
  red:    "#dc2626",
};

export default function AffiliatePage() {
  const [name, setName]       = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole]       = useState("");
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [bio, setBio]         = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ code: string; link: string } | null>(null);
  const [copied, setCopied]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/affiliate/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, role, phone, email, bio, website }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Registration failed");
      setResult(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!result) return;
    navigator.clipboard.writeText(result.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 60%, #1e3a5f 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 24 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.2)" }}>
            <HomeIcon size={19} color="white"/>
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>BTLR</span>
        </div>

        <div style={{ background: "white", borderRadius: 20, padding: "28px 28px 24px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}>

          {!result ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "0 0 6px", letterSpacing: "-0.5px" }}>
                Get your referral link
              </h2>
              <p style={{ fontSize: 14, color: C.text3, margin: "0 0 24px", lineHeight: 1.5 }}>
                Share your unique link with clients. When they sign up, you&apos;re automatically saved in their home team.
              </p>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { label: "Full name *", value: name, onChange: setName, placeholder: "Jane Smith", required: true },
                  { label: "Company",     value: company, onChange: setCompany, placeholder: "Smith Real Estate Group" },
                  { label: "Phone",       value: phone,   onChange: setPhone,   placeholder: "(555) 123-4567" },
                  { label: "Email",       value: email,   onChange: setEmail,   placeholder: "jane@smithrealty.com",  type: "email" },
                  { label: "Website",     value: website, onChange: setWebsite, placeholder: "smithrealty.com" },
                ].map(({ label, value, onChange, placeholder, required, type }) => (
                  <div key={label}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text2, marginBottom: 5 }}>
                      {label}
                    </label>
                    <input
                      type={type ?? "text"} required={required} value={value}
                      onChange={e => onChange(e.target.value)} placeholder={placeholder}
                      style={{ width: "100%", padding: "10px 13px", borderRadius: 9, fontSize: 14,
                        border: `1px solid ${C.border}`, background: C.bg, color: C.text,
                        outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                ))}

                {/* Role */}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text2, marginBottom: 5 }}>
                    Role *
                  </label>
                  <select required value={role} onChange={e => setRole(e.target.value)} style={{
                    width: "100%", padding: "10px 13px", borderRadius: 9, fontSize: 14,
                    border: `1px solid ${C.border}`, background: C.bg, color: role ? C.text : C.text3,
                    outline: "none", boxSizing: "border-box",
                  }}>
                    <option value="">Select your role…</option>
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {/* Bio */}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text2, marginBottom: 5 }}>
                    Short bio (optional)
                  </label>
                  <textarea value={bio} onChange={e => setBio(e.target.value)}
                    placeholder="I specialize in helping first-time buyers navigate the process…"
                    rows={3} style={{ width: "100%", padding: "10px 13px", borderRadius: 9, fontSize: 14,
                      border: `1px solid ${C.border}`, background: C.bg, color: C.text,
                      outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}/>
                </div>

                {error && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
                    padding: "10px 13px", fontSize: 13, color: C.red }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} style={{
                  padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: C.navy, color: "white", fontSize: 15, fontWeight: 700,
                  opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 8, marginTop: 4,
                }}>
                  {loading && <Loader2 size={15} className="animate-spin"/>}
                  {loading ? "Creating your link…" : "Generate My Referral Link →"}
                </button>
              </form>
            </>
          ) : (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={48} color={C.green} style={{ margin: "0 auto 16px" }}/>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>
                Your link is ready!
              </h2>
              <p style={{ fontSize: 14, color: C.text3, margin: "0 0 24px", lineHeight: 1.5 }}>
                Share this with clients. When they sign up, you&apos;ll be automatically saved in their BTLR home team.
              </p>

              <div style={{ background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 12,
                padding: "14px 16px", marginBottom: 14, wordBreak: "break-all" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <LinkIcon size={14} color={C.accent}/>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: "uppercase",
                    letterSpacing: "0.06em" }}>Your referral link</span>
                </div>
                <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.6 }}>{result.link}</p>
              </div>

              <button onClick={copyLink} style={{
                width: "100%", padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                background: copied ? C.green : C.accent, color: "white", fontSize: 15, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s",
              }}>
                {copied ? <><CheckCircle2 size={15}/> Copied!</> : <><Copy size={15}/> Copy Link</>}
              </button>

              <p style={{ fontSize: 12, color: C.text3, marginTop: 16, lineHeight: 1.5 }}>
                Tip: paste this link in your email signature, Instagram bio, or closing emails.
              </p>
            </div>
          )}
        </div>

        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center", marginTop: 20 }}>
          Powered by BTLR Home OS — btlrai.com
        </p>
      </div>
    </div>
  );
}
