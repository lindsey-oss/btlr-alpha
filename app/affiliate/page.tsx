"use client";

import { useRef, useState } from "react";
import { Home as HomeIcon, Loader2, Copy, CheckCircle2, Link as LinkIcon, Camera, X } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "realtor",          label: "Real Estate Agent / Realtor" },
  { value: "lender",           label: "Mortgage Lender / Loan Officer" },
  { value: "escrow",           label: "Escrow Officer" },
  { value: "title",            label: "Title Officer / Company" },
  { value: "attorney",         label: "Real Estate Attorney" },
  { value: "insurance_broker", label: "Insurance Broker" },
  { value: "home_warranty",    label: "Home Warranty Provider" },
];

const C = {
  navy:   "#1A2C44",
  accent: "#E89441",
  text:   "#0E1B2C",
  text2:  "#3D4B5E",
  text3:  "#7E8A9A",
  border: "rgba(26,44,68,0.12)",
  bg:     "#F5EFE3",
  bg2:    "#FBF6EB",
  green:  "#5A9A6E",
  red:    "#C25C4F",
};

export default function AffiliatePage() {
  const [name, setName]       = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole]       = useState("");
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [bio, setBio]         = useState("");
  const [website, setWebsite] = useState("");

  // Photo state
  const photoInputRef           = useState<React.RefObject<HTMLInputElement>>(() => ({ current: null } as any))[0];
  const fileInputRef            = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile]       = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUrl, setPhotoUrl]         = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ code: string; link: string } | null>(null);
  const [copied, setCopied]   = useState(false);

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoUrl(null);
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/affiliate/upload-photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      return json.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
      return null;
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Upload photo first if one was selected
      let finalPhotoUrl: string | null = photoUrl;
      if (photoFile && !photoUrl) {
        finalPhotoUrl = await uploadPhoto(photoFile);
        if (!finalPhotoUrl) { setLoading(false); return; }
        setPhotoUrl(finalPhotoUrl);
      }

      const res  = await fetch("/api/affiliate/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, role, phone, email, bio, website, photo_url: finalPhotoUrl }),
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

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 13px", borderRadius: 9, fontSize: 14,
    border: `1.5px solid ${C.border}`, background: C.bg2, color: C.text,
    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12.5, fontWeight: 600, color: C.text2, marginBottom: 5,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(140deg, ${C.navy} 0%, #243A56 55%, #1A3A5C 100%)`,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "40px 20px 60px",
    }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
        input:focus, select:focus, textarea:focus { border-color: ${C.accent} !important; box-shadow: 0 0 0 3px ${C.accent}18; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 480, fontFamily: "'Outfit', sans-serif" }}>

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.18)" }}>
            <HomeIcon size={20} color="white"/>
          </div>
          <span style={{ fontWeight: 800, fontSize: 22, color: "white", letterSpacing: "0.04em" }}>BTLR</span>
        </div>

        <div style={{ background: "white", borderRadius: 20, padding: "28px 28px 24px",
          boxShadow: "0 12px 48px rgba(0,0,0,0.28)" }}>

          {!result ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 4px", letterSpacing: "-0.4px" }}>
                Get your referral link
              </h2>
              <p style={{ fontSize: 14, color: C.text3, margin: "0 0 24px", lineHeight: 1.55 }}>
                Fill out your profile once. Share your unique link with clients — they&apos;ll have you pre-saved in their home team the moment they sign up.
              </p>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── Photo upload ── */}
                <div>
                  <label style={labelStyle}>Headshot / Profile photo</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {/* Preview circle */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      {photoPreview ? (
                        <>
                          <img src={photoPreview} alt="Preview" style={{ width: 68, height: 68, borderRadius: "50%", objectFit: "cover", border: `2px solid ${C.border}` }}/>
                          <button type="button" onClick={clearPhoto} style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: C.red, border: "2px solid white", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
                            <X size={10} color="white"/>
                          </button>
                        </>
                      ) : (
                        <div style={{ width: 68, height: 68, borderRadius: "50%", background: C.bg, border: `2px dashed ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Camera size={22} color={C.text3}/>
                        </div>
                      )}
                    </div>
                    {/* Upload button */}
                    <div style={{ flex: 1 }}>
                      <label style={{
                        display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
                        borderRadius: 9, border: `1.5px solid ${C.border}`, background: C.bg2,
                        fontSize: 13, fontWeight: 600, color: C.text2, cursor: "pointer",
                      }}>
                        {uploadingPhoto
                          ? <><Loader2 size={13} className="animate-spin"/> Uploading…</>
                          : <><Camera size={13}/> {photoPreview ? "Change photo" : "Upload headshot"}</>
                        }
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          style={{ display: "none" }}
                          onChange={handlePhotoSelect}
                          disabled={uploadingPhoto}
                        />
                      </label>
                      <p style={{ fontSize: 11, color: C.text3, margin: "5px 0 0" }}>
                        JPG, PNG, or WebP · max 5 MB
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Text fields ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Full name *</label>
                    <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" style={inputStyle}/>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Company / Brokerage</label>
                    <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Smith Real Estate Group" style={inputStyle}/>
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" style={inputStyle}/>
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@smithrealty.com" style={inputStyle}/>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Website</label>
                    <input type="text" value={website} onChange={e => setWebsite(e.target.value)} placeholder="smithrealty.com" style={inputStyle}/>
                  </div>
                </div>

                {/* ── Role ── */}
                <div>
                  <label style={labelStyle}>Role *</label>
                  <select required value={role} onChange={e => setRole(e.target.value)} style={{ ...inputStyle, color: role ? C.text : C.text3 }}>
                    <option value="">Select your role…</option>
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {/* ── Bio ── */}
                <div>
                  <label style={labelStyle}>Short bio <span style={{ fontWeight: 400, color: C.text3 }}>(optional — shown on your referral page)</span></label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="I specialize in helping first-time buyers navigate the process and get the best deal on their dream home…"
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>

                {error && (
                  <div style={{ background: "#fef2f2", border: `1px solid ${C.red}40`, borderRadius: 9,
                    padding: "10px 13px", fontSize: 13, color: C.red, lineHeight: 1.5 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || uploadingPhoto}
                  style={{
                    padding: "13px", borderRadius: 11, border: "none", cursor: loading || uploadingPhoto ? "not-allowed" : "pointer",
                    background: loading || uploadingPhoto ? C.text3 : C.navy,
                    color: "white", fontSize: 15, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
                    transition: "background 0.15s",
                  }}
                >
                  {loading
                    ? <><Loader2 size={15} className="animate-spin"/> Creating your link…</>
                    : "Generate My Referral Link →"
                  }
                </button>
              </form>
            </>
          ) : (
            /* ── Success state ── */
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f0fdf4", border: `2px solid ${C.green}40`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={32} color={C.green}/>
              </div>
              <h2 style={{ fontSize: 21, fontWeight: 800, color: C.text, margin: "0 0 8px", letterSpacing: "-0.4px" }}>
                Your link is ready!
              </h2>
              <p style={{ fontSize: 14, color: C.text3, margin: "0 0 24px", lineHeight: 1.55 }}>
                Share this link with your clients. When they sign up via your link, you&apos;ll be automatically saved in their BTLR home team.
              </p>

              {/* Link box */}
              <div style={{ background: C.bg2, border: `1.5px solid ${C.border}`, borderRadius: 12,
                padding: "14px 16px", marginBottom: 14, wordBreak: "break-all", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <LinkIcon size={13} color={C.accent}/>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Your referral link
                  </span>
                </div>
                <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.6, fontWeight: 500 }}>{result.link}</p>
              </div>

              <button onClick={copyLink} style={{
                width: "100%", padding: "13px", borderRadius: 11, border: "none", cursor: "pointer",
                background: copied ? C.green : C.accent,
                color: "white", fontSize: 15, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "background 0.2s",
              }}>
                {copied ? <><CheckCircle2 size={15}/> Copied!</> : <><Copy size={15}/> Copy Link</>}
              </button>

              {/* Tips */}
              <div style={{ background: C.bg2, borderRadius: 11, padding: "14px 16px", marginTop: 16, textAlign: "left" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                  Where to share it
                </p>
                {[
                  "Email signature",
                  "Closing disclosure email to buyers",
                  "Instagram / social bio",
                  "Your website's contact page",
                  "Referral texts to new clients",
                ].map((tip, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0 }}/>
                    <span style={{ fontSize: 13, color: C.text2 }}>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", marginTop: 20 }}>
          Powered by BTLR Home OS · btlrai.com
        </p>
      </div>
    </div>
  );
}
