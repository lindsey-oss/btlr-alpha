"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { phCapture } from "../../../lib/monitoring";

// ── Design tokens ──────────────────────────────────────────────
const C = {
  text:       "#1C1914", muted: "#6B6558", dim: "#A09C92",
  gold:       "#2C5F8A", goldDk: "#1E4568", goldDim: "rgba(44,95,138,.08)",
  border:     "rgba(28,25,20,0.09)", borderGold: "rgba(44,95,138,0.22)",
  surface:    "#F7F2EC", surface2: "#EDE5D4", white: "#FFFFFF",
  error:      "#DC2626", errorBg: "#FEF2F2",
  success:    "#15803D", successBg: "#F0FDF4",
};
const INTER = "'Inter', sans-serif";
// OUTFIT replaced by Inter
// DM replaced by Inter

// ── Step metadata ──────────────────────────────────────────────
const STEPS = [
  { n: 1, title: "Business Profile",            short: "Business" },
  { n: 2, title: "Licensing & Insurance",       short: "Licensing" },
  { n: 3, title: "Services & Specialties",      short: "Services" },
  { n: 4, title: "Work Quality Proof",          short: "Portfolio" },
  { n: 5, title: "Reputation & References",     short: "References" },
  { n: 6, title: "Communication & Experience",  short: "Communication" },
  { n: 7, title: "Pricing & Availability",      short: "Pricing" },
  { n: 8, title: "BTLR Standards Agreement",    short: "Agreement" },
  { n: 9, title: "Review & Submit",             short: "Submit" },
];

const SERVICE_CATEGORIES = [
  "HVAC / Heating & Cooling","Roofing","Plumbing","Electrical",
  "General Contractor","Landscaping / Lawn Care","Pest Control",
  "Foundation & Waterproofing","Interior Painting","Exterior Painting",
  "Windows & Doors","Appliance Repair","Flooring","Solar & Energy",
  "Pool & Spa","Concrete & Masonry","Insulation","Gutters & Drainage",
  "Handyman","Other",
];

const PROPERTY_TYPES = ["Single-family homes","Condos / Townhomes","Luxury homes","Investment properties","HOAs","Commercial (light)"];
const COMM_PREFS     = ["Text","Phone","Email","BTLR app messaging"];
const PRICING_MODELS = ["Flat rate","Hourly","Project-based","Hybrid"];
const JOB_SIZES      = ["Under $500","$500–$2,000","$2,000–$10,000","$10,000–$50,000","$50,000+","Varies widely"];
const RESPONSE_TIMES = ["Within 1 hour","Within 4 hours","Same day","Next business day","Within 48 hours"];
const LEAD_TIMES     = ["Same / next day","2–3 days","1 week","2–3 weeks","1 month+"];
const CAPACITY       = ["1–2 jobs/week","3–5 jobs/week","6–10 jobs/week","10+ jobs/week"];
const TEAM_SIZES     = ["Solo (just me)","2–5 employees","6–15 employees","16–30 employees","31+ employees"];
const YEARS          = ["Less than 1","1–2","3–5","6–10","11–20","20+"];

// ── Helpers ────────────────────────────────────────────────────
function inp(style?: React.CSSProperties): React.CSSProperties {
  return { width: "100%", padding: "11px 14px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontFamily: INTER, fontSize: 16, color: C.text, outline: "none", background: C.white, ...style };
}
function sel(style?: React.CSSProperties): React.CSSProperties {
  return { ...inp(), appearance: "none" as const, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6558' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 36, ...style };
}
function ta(style?: React.CSSProperties): React.CSSProperties {
  return { ...inp(), resize: "vertical" as const, minHeight: 100, ...style };
}

// ── Sub-components ─────────────────────────────────────────────
function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: C.muted, display: "block", marginBottom: 6 }}>
      {children}{required && <span style={{ color: C.error, marginLeft: 3 }}>*</span>}
    </label>
  );
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Label required={required}>{label}</Label>
      {children}
      {hint && <p style={{ fontSize: 12, color: C.dim, marginTop: 5, fontFamily: INTER }}>{hint}</p>}
    </div>
  );
}

function CheckGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter(x => x !== opt) : [...value, opt]);
  return (
    <Field label={label}>
      <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
        {options.map(o => (
          <button key={o} type="button" onClick={() => toggle(o)} style={{ padding: "8px 14px", border: `1.5px solid ${value.includes(o) ? C.gold : C.border}`, borderRadius: 20, background: value.includes(o) ? C.goldDim : C.white, fontFamily: INTER, fontSize: 13, color: value.includes(o) ? C.gold : C.text, cursor: "pointer", fontWeight: value.includes(o) ? 600 : 400 }}>
            {o}
          </button>
        ))}
      </div>
    </Field>
  );
}

function YesNo({ label, value, onChange, required }: { label: string; value: boolean | null; onChange: (v: boolean) => void; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      <div style={{ display: "flex", gap: 10 }}>
        {[true, false].map(b => (
          <button key={String(b)} type="button" onClick={() => onChange(b)} style={{ flex: 1, padding: "11px 0", border: `1.5px solid ${value === b ? C.gold : C.border}`, borderRadius: 8, background: value === b ? C.goldDim : C.white, fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: value === b ? C.gold : C.muted, cursor: "pointer" }}>
            {b ? "YES" : "NO"}
          </button>
        ))}
      </div>
    </Field>
  );
}

function UploadField({ label, hint, docType, appId, onUploaded }: {
  label: string; hint?: string; docType: string; appId: string; onUploaded: (name: string) => void;
}) {
  const [state, setState] = useState<"idle"|"uploading"|"done"|"error">("idle");
  const [fileName, setFileName] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !appId) return;
    setState("uploading");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("applicationId", appId);
    fd.append("documentType", docType);
    try {
      const res = await fetch("/api/vendor-apply/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFileName(file.name);
      setState("done");
      onUploaded(file.name);
    } catch {
      setState("error");
    }
  }

  return (
    <Field label={label} hint={hint}>
      <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: `1.5px dashed ${state === "done" ? C.gold : C.border}`, borderRadius: 8, cursor: appId ? "pointer" : "not-allowed", background: state === "done" ? C.goldDim : C.surface }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={handleFile} disabled={!appId || state === "uploading"} />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={state === "done" ? C.gold : C.dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {state === "done" ? <polyline points="20 6 9 17 4 12"/> : <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>}
        </svg>
        <span style={{ fontFamily: INTER, fontSize: 13, color: state === "done" ? C.gold : C.muted }}>
          {state === "uploading" ? "Uploading…" : state === "done" ? fileName : state === "error" ? "Upload failed — try again" : !appId ? "Save your progress first to enable uploads" : "Click to upload (PDF, JPG, PNG — max 20MB)"}
        </span>
      </label>
    </Field>
  );
}

function ReviewRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return (
    <div style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, width: 180, flexShrink: 0, paddingTop: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, flex: 1 }}>{display}</div>
    </div>
  );
}

// ── Main form component ────────────────────────────────────────
const BLANK: Record<string, unknown> = {
  // Step 1
  business_name: "", owner_name: "", business_phone: "", business_email: "", website: "",
  social_instagram: "", social_facebook: "", social_linkedin: "", social_other: "",
  address_street: "", address_city: "", address_state: "", address_zip: "",
  years_in_business: "", team_size: "", service_categories: [], service_zip_codes: "", emergency_service: null,
  // Step 2
  license_number: "", license_state: "", license_expiration: "",
  insurance_provider: "", workers_comp_status: "", is_bonded: null,
  prior_violations: null, prior_violations_explanation: "",
  // Step 3
  primary_specialty: "", secondary_services: [], average_job_size: "", property_types: [], brands_systems: "", services_not_offered: "",
  // Step 4
  video_walkthrough_url: "",
  project_1_problem: "", project_1_solution: "", project_1_outcome: "",
  project_2_problem: "", project_2_solution: "", project_2_outcome: "",
  // Step 5
  google_profile_url: "", yelp_url: "", other_review_urls: "",
  ref1_name: "", ref1_phone: "", ref1_email: "", ref1_project_type: "",
  ref2_name: "", ref2_phone: "", ref2_email: "", ref2_project_type: "",
  ref3_name: "", ref3_phone: "", ref3_email: "", ref3_project_type: "",
  industry_ref_name: "", industry_ref_phone: "", industry_ref_email: "", industry_ref_relationship: "",
  // Step 6
  response_time: "", provides_written_estimates: null, upfront_pricing: null,
  proactive_delays: null, preferred_communication: [],
  scenario_response: "", five_star_meaning: "", industry_wrongs: "", why_btlr: "",
  // Step 7
  pricing_model: "", service_call_fee: "", estimates_free: null,
  typical_lead_time: "", weekly_job_capacity: "", emergency_availability: null, service_hours: "", after_hours: null,
  // Step 8
  agree_license_insurance: false, agree_response_window: false, agree_transparent_pricing: false,
  agree_written_estimates: false, agree_no_upsells: false, agree_professional: false,
  agree_job_updates: false, agree_rating_system: false, agree_performance_standards: false,
  agree_probationary_removal: false,
  // Step 9
  final_confirmation: false,
};

export default function VendorApplicationForm() {
  const router = useRouter();
  const [step, setStep]     = useState(1);
  const [data, setData]     = useState<Record<string, unknown>>({ ...BLANK });
  const [appId, setAppId]   = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState("");

  // Load draft from localStorage
  useEffect(() => {
    const savedId = localStorage.getItem("btlr_vendor_app_id");
    if (savedId) {
      setAppId(savedId);
      fetch(`/api/vendor-apply/save?id=${savedId}`)
        .then(r => r.json())
        .then(({ data: d }) => { if (d) { setData({ ...BLANK, ...d }); setStep(d.current_step ?? 1); } })
        .catch(() => {});
    }
  }, []);

  // Auto-save when reaching step 4 without an appId so uploads unlock automatically
  useEffect(() => {
    if (step === 4 && !appId) {
      saveDraft();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const set = (key: string, val: unknown) => setData(d => ({ ...d, [key]: val }));

  const saveDraft = useCallback(async (nextStep?: number) => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = { ...data, current_step: nextStep ?? step, id: appId || undefined };
      const res = await fetch("/api/vendor-apply/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.id && !appId) {
        setAppId(json.id);
        localStorage.setItem("btlr_vendor_app_id", json.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [data, step, appId]);

  async function advance() {
    setError("");
    // Step 2 validation: license + insurance required
    if (step === 2 && (!data.license_number || !data.insurance_provider)) {
      setError("License number and insurance provider are required to continue.");
      return;
    }
    const next = step + 1;
    await saveDraft(next);
    phCapture("vendor_application_step_completed", { from_step: step, to_step: next, step_title: STEPS[step - 1]?.title ?? "" });
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setStep(s => { const prev = s - 1; window.scrollTo({ top: 0, behavior: "smooth" }); return prev; });
  }

  async function handleSubmit() {
    if (!data.final_confirmation) { setError("Please confirm you understand that applying does not guarantee acceptance."); return; }
    if (!appId) { setError("Application not saved. Please go back and save your progress."); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/vendor-apply/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: appId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      localStorage.removeItem("btlr_vendor_app_id");
      router.push("/apply/confirmation");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const pct = Math.round(((step - 1) / 9) * 100);

  return (
    <div style={{ minHeight: "100vh", background: C.surface, fontFamily: INTER, color: C.text }}>

      {/* Nav */}
      <nav style={{ background: "#1B2D47", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <Link href="/apply" style={{ fontFamily: INTER, fontSize: 16, fontWeight: 800, letterSpacing: "0.14em", color: "#2C5F8A", textDecoration: "none" }}>BTLR</Link>
        <div style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>
          Trusted Network Application
        </div>
        <button onClick={() => saveDraft()} disabled={saving} style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 16px", background: saved ? "#15803D" : "rgba(255,255,255,.1)", color: "#fff", border: "none", cursor: "pointer", transition: "background .3s" }}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Progress"}
        </button>
      </nav>

      {/* Progress bar */}
      <div style={{ background: "#1B2D47", padding: "0 32px 20px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>
              Step {Math.min(step, 9)} of 9 — {STEPS[Math.min(step, 9) - 1]?.title}
            </span>
            <span style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.35)" }}>{pct}%</span>
          </div>
          <div style={{ height: 3, background: "rgba(255,255,255,.12)", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#2C5F8A", borderRadius: 2, transition: "width .4s" }}/>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 10, overflowX: "auto" as const }}>
            {STEPS.map(s => (
              <div key={s.n} style={{ fontFamily: INTER, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: step === s.n ? "#fff" : step > s.n ? "#2C5F8A" : "rgba(255,255,255,.2)", paddingRight: 12, whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                {step > s.n ? "✓ " : ""}{s.short}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form card */}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 80px" }}>
        {error && (
          <div style={{ background: C.errorBg, border: `1px solid #FECACA`, borderRadius: 8, padding: "12px 16px", marginBottom: 24, fontFamily: INTER, fontSize: 14, color: C.error }}>
            {error}
          </div>
        )}

        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>

          {/* Step header */}
          <div style={{ padding: "28px 36px", borderBottom: `1px solid ${C.border}`, background: C.white }}>
            <div style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.gold, marginBottom: 6 }}>Step {Math.min(step, 9)} of 9</div>
            <h2 style={{ fontFamily: INTER, fontSize: 26, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>{STEPS[Math.min(step, 9) - 1]?.title}</h2>
          </div>

          <div style={{ padding: "36px" }}>

            {/* ── STEP 1: Business Profile ── */}
            {step === 1 && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Business Name" required><input style={inp()} value={data.business_name as string} onChange={e => set("business_name", e.target.value)} placeholder="Smith Roofing Co." /></Field>
                  <Field label="Owner / Primary Contact" required><input style={inp()} value={data.owner_name as string} onChange={e => set("owner_name", e.target.value)} placeholder="Jane Smith" /></Field>
                  <Field label="Business Phone" required><input style={inp()} type="tel" value={data.business_phone as string} onChange={e => set("business_phone", e.target.value)} placeholder="(619) 555-0100" /></Field>
                  <Field label="Business Email" required><input style={inp()} type="email" value={data.business_email as string} onChange={e => set("business_email", e.target.value)} placeholder="jane@smithroofing.com" /></Field>
                  <Field label="Website"><input style={inp()} type="url" value={data.website as string} onChange={e => set("website", e.target.value)} placeholder="https://smithroofing.com" /></Field>
                  <Field label="Years in Business" required>
                    <select style={sel()} value={data.years_in_business as string} onChange={e => set("years_in_business", e.target.value)}>
                      <option value="">Select…</option>
                      {YEARS.map(y => <option key={y} value={y}>{y} years</option>)}
                    </select>
                  </Field>
                  <Field label="Team Size" required>
                    <select style={sel()} value={data.team_size as string} onChange={e => set("team_size", e.target.value)}>
                      <option value="">Select…</option>
                      {TEAM_SIZES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ marginTop: 4 }}>
                  <p style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Business Address</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    <input style={inp()} value={data.address_street as string} onChange={e => set("address_street", e.target.value)} placeholder="Street address" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px", gap: 12 }}>
                      <input style={inp()} value={data.address_city as string} onChange={e => set("address_city", e.target.value)} placeholder="City" />
                      <input style={inp()} value={data.address_state as string} onChange={e => set("address_state", e.target.value)} placeholder="State" maxLength={2} />
                      <input style={inp()} value={data.address_zip as string} onChange={e => set("address_zip", e.target.value)} placeholder="ZIP" maxLength={5} />
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 20 }}>
                  <p style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Social Media (optional)</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <input style={inp()} value={data.social_instagram as string} onChange={e => set("social_instagram", e.target.value)} placeholder="Instagram URL" />
                    <input style={inp()} value={data.social_facebook as string} onChange={e => set("social_facebook", e.target.value)} placeholder="Facebook URL" />
                    <input style={inp()} value={data.social_linkedin as string} onChange={e => set("social_linkedin", e.target.value)} placeholder="LinkedIn URL" />
                    <input style={inp()} value={data.social_other as string} onChange={e => set("social_other", e.target.value)} placeholder="Other profile URL" />
                  </div>
                </div>
                <div style={{ marginTop: 20 }}>
                  <CheckGroup label="Service Categories (select all that apply)" options={SERVICE_CATEGORIES} value={data.service_categories as string[]} onChange={v => set("service_categories", v)} />
                </div>
                <Field label="Service Area (ZIP codes)" hint="Enter the ZIP codes you serve, separated by commas.">
                  <textarea style={ta({ minHeight: 72 })} value={data.service_zip_codes as string} onChange={e => set("service_zip_codes", e.target.value)} placeholder="92101, 92103, 92108, 92115…" />
                </Field>
                <YesNo label="Do you offer emergency / after-hours service?" value={data.emergency_service as boolean | null} onChange={v => set("emergency_service", v)} />
              </div>
            )}

            {/* ── STEP 2: Licensing & Insurance ── */}
            {step === 2 && (
              <div>
                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
                  <p style={{ fontSize: 13, color: "#92400E", margin: 0, fontFamily: INTER }}>
                    <strong>Required to submit:</strong> License number and insurance provider. Applications without valid licensing and insurance cannot be approved.
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Contractor License Number" required><input style={inp()} value={data.license_number as string} onChange={e => set("license_number", e.target.value)} placeholder="CA-123456" /></Field>
                  <Field label="License State" required><input style={inp()} value={data.license_state as string} onChange={e => set("license_state", e.target.value)} placeholder="CA" maxLength={2} /></Field>
                  <Field label="License Expiration Date" required><input style={inp()} type="date" value={data.license_expiration as string} onChange={e => set("license_expiration", e.target.value)} /></Field>
                  <Field label="General Liability Insurance Provider" required><input style={inp()} value={data.insurance_provider as string} onChange={e => set("insurance_provider", e.target.value)} placeholder="State Farm, Hiscox, etc." /></Field>
                </div>
                {appId && <>
                  <UploadField label="Upload Contractor License" hint="PDF or image of current license" docType="license" appId={appId} onUploaded={() => {}} />
                  <UploadField label="Upload Certificate of Insurance" hint="Current COI showing general liability coverage" docType="insurance" appId={appId} onUploaded={() => {}} />
                </>}
                <Field label="Workers' Compensation Status" required>
                  <select style={sel()} value={data.workers_comp_status as string} onChange={e => set("workers_comp_status", e.target.value)}>
                    <option value="">Select…</option>
                    <option value="has_coverage">I carry workers' comp insurance</option>
                    <option value="exempt">I am exempt (sole proprietor / no employees)</option>
                    <option value="no_coverage">I do not have workers' comp</option>
                  </select>
                </Field>
                {data.workers_comp_status === "has_coverage" && appId &&
                  <UploadField label="Upload Workers' Comp Certificate" docType="workers_comp" appId={appId} onUploaded={() => {}} />
                }
                <YesNo label="Are you bonded?" value={data.is_bonded as boolean | null} onChange={v => set("is_bonded", v)} />
                {!!data.is_bonded && appId &&
                  <UploadField label="Upload Surety Bond Proof" docType="bond" appId={appId} onUploaded={() => {}} />
                }
                <YesNo label="Have you had any prior license suspensions, complaints, or violations?" value={data.prior_violations as boolean | null} onChange={v => set("prior_violations", v)} required />
                {!!data.prior_violations && (
                  <Field label="Please explain" required>
                    <textarea style={ta()} value={data.prior_violations_explanation as string} onChange={e => set("prior_violations_explanation", e.target.value)} placeholder="Describe the situation and outcome…" />
                  </Field>
                )}
              </div>
            )}

            {/* ── STEP 3: Services & Specialties ── */}
            {step === 3 && (
              <div>
                <Field label="Primary Specialty" required>
                  <select style={sel()} value={data.primary_specialty as string} onChange={e => set("primary_specialty", e.target.value)}>
                    <option value="">Select your primary trade…</option>
                    {SERVICE_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <CheckGroup label="Secondary Services" options={SERVICE_CATEGORIES.filter(s => s !== data.primary_specialty)} value={data.secondary_services as string[]} onChange={v => set("secondary_services", v)} />
                <Field label="Average Job Size" required>
                  <select style={sel()} value={data.average_job_size as string} onChange={e => set("average_job_size", e.target.value)}>
                    <option value="">Select…</option>
                    {JOB_SIZES.map(j => <option key={j} value={j}>{j}</option>)}
                  </select>
                </Field>
                <CheckGroup label="Types of Properties Served" options={PROPERTY_TYPES} value={data.property_types as string[]} onChange={v => set("property_types", v)} />
                <Field label="Brands, Systems, or Materials You Commonly Work With" hint="e.g. Carrier HVAC, GAF roofing, Moen, Lennox, LP SmartSide">
                  <textarea style={ta({ minHeight: 80 })} value={data.brands_systems as string} onChange={e => set("brands_systems", e.target.value)} placeholder="List brands, systems, or materials you specialize in…" />
                </Field>
                <Field label="Services You Do Not Offer">
                  <textarea style={ta({ minHeight: 80 })} value={data.services_not_offered as string} onChange={e => set("services_not_offered", e.target.value)} placeholder="e.g. We do not handle permits, asbestos removal, or mold remediation." />
                </Field>
              </div>
            )}

            {/* ── STEP 4: Work Quality ── */}
            {step === 4 && (
              <div>
                <div style={{ marginBottom: 28 }}>
                  <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75, fontFamily: INTER, margin: 0 }}>
                    Upload 5–10 photos of completed work. Clear, professional photos significantly strengthen your application. We review work quality carefully.
                  </p>
                </div>
                {appId ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                    {[1,2,3,4,5,6,7,8,9,10].map(n => (
                      <UploadField key={n} label={`Photo ${n}${n <= 5 ? " (required)" : " (optional)"}`} docType={`work_photo_${n}`} appId={appId} onUploaded={() => {}} />
                    ))}
                  </div>
                ) : (
                  <div style={{ background: "#EFF6FF", border: `1.5px solid #BFDBFE`, borderRadius: 10, padding: "24px 20px", marginBottom: 24, textAlign: "center" as const }}>
                    <p style={{ fontSize: 14, color: "#1E40AF", marginBottom: 14, fontWeight: 500 }}>
                      Your progress needs to be saved before uploads are enabled.
                    </p>
                    <button
                      onClick={() => saveDraft()}
                      disabled={saving}
                      style={{ padding: "11px 28px", background: C.gold, color: "#fff", border: "none", borderRadius: 8, fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, cursor: "pointer" }}
                    >
                      {saving ? "Saving…" : "Save & Enable Uploads"}
                    </button>
                  </div>
                )}
                <Field label="Optional: Video Walkthrough Link" hint="YouTube, Vimeo, or Google Drive link showing a completed project.">
                  <input style={inp()} type="url" value={data.video_walkthrough_url as string} onChange={e => set("video_walkthrough_url", e.target.value)} placeholder="https://youtube.com/watch?v=…" />
                </Field>
                <div style={{ marginTop: 28 }}>
                  <p style={{ fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text, marginBottom: 20 }}>Project Examples</p>
                  {[1,2].map(n => (
                    <div key={n} style={{ background: C.surface, borderRadius: 8, padding: 20, marginBottom: 16, border: `1px solid ${C.border}` }}>
                      <p style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold, marginBottom: 16 }}>Project Example {n}</p>
                      <Field label="Problem / Challenge">
                        <textarea style={ta({ minHeight: 80 })} value={data[`project_${n}_problem`] as string} onChange={e => set(`project_${n}_problem`, e.target.value)} placeholder="What was the homeowner's issue?" />
                      </Field>
                      <Field label="Solution">
                        <textarea style={ta({ minHeight: 80 })} value={data[`project_${n}_solution`] as string} onChange={e => set(`project_${n}_solution`, e.target.value)} placeholder="What did you do to solve it?" />
                      </Field>
                      <Field label="Outcome">
                        <textarea style={ta({ minHeight: 80 })} value={data[`project_${n}_outcome`] as string} onChange={e => set(`project_${n}_outcome`, e.target.value)} placeholder="What was the result for the homeowner?" />
                      </Field>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 5: References ── */}
            {step === 5 && (
              <div>
                <Field label="Google Business Profile URL" hint="We check your Google reviews directly.">
                  <input style={inp()} type="url" value={data.google_profile_url as string} onChange={e => set("google_profile_url", e.target.value)} placeholder="https://g.page/your-business" />
                </Field>
                <Field label="Yelp Profile URL">
                  <input style={inp()} type="url" value={data.yelp_url as string} onChange={e => set("yelp_url", e.target.value)} placeholder="https://yelp.com/biz/your-business" />
                </Field>
                <Field label="Other Review Links" hint="BBB, Angi, Houzz, etc. One URL per line.">
                  <textarea style={ta({ minHeight: 72 })} value={data.other_review_urls as string} onChange={e => set("other_review_urls", e.target.value)} placeholder="https://bbb.org/…&#10;https://houzz.com/…" />
                </Field>
                <div style={{ margin: "24px 0 4px" }}>
                  <p style={{ fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text, marginBottom: 6 }}>Client References</p>
                  <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, fontFamily: INTER }}>We will contact these references directly. Provide clients who can speak to your professionalism, quality, and communication.</p>
                  {[1,2,3].map(n => (
                    <div key={n} style={{ background: C.surface, borderRadius: 8, padding: 20, marginBottom: 12, border: `1px solid ${C.border}` }}>
                      <p style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold, marginBottom: 16 }}>Client Reference {n} {n <= 2 ? "*" : "(optional)"}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <Field label="Name"><input style={inp()} value={data[`ref${n}_name`] as string} onChange={e => set(`ref${n}_name`, e.target.value)} placeholder="Client name" /></Field>
                        <Field label="Phone"><input style={inp()} type="tel" value={data[`ref${n}_phone`] as string} onChange={e => set(`ref${n}_phone`, e.target.value)} placeholder="(619) 555-0100" /></Field>
                        <Field label="Email"><input style={inp()} type="email" value={data[`ref${n}_email`] as string} onChange={e => set(`ref${n}_email`, e.target.value)} placeholder="client@email.com" /></Field>
                        <Field label="Project Type"><input style={inp()} value={data[`ref${n}_project_type`] as string} onChange={e => set(`ref${n}_project_type`, e.target.value)} placeholder="e.g. Full roof replacement" /></Field>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 24, background: C.surface, borderRadius: 8, padding: 20, border: `1px solid ${C.border}` }}>
                  <p style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold, marginBottom: 16 }}>Industry Reference (optional)</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Name"><input style={inp()} value={data.industry_ref_name as string} onChange={e => set("industry_ref_name", e.target.value)} placeholder="e.g. supplier, inspector, realtor" /></Field>
                    <Field label="Phone"><input style={inp()} type="tel" value={data.industry_ref_phone as string} onChange={e => set("industry_ref_phone", e.target.value)} /></Field>
                    <Field label="Email"><input style={inp()} type="email" value={data.industry_ref_email as string} onChange={e => set("industry_ref_email", e.target.value)} /></Field>
                    <Field label="Relationship"><input style={inp()} value={data.industry_ref_relationship as string} onChange={e => set("industry_ref_relationship", e.target.value)} placeholder="e.g. Materials supplier, 8 years" /></Field>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 6: Communication ── */}
            {step === 6 && (
              <div>
                <Field label="Average Response Time to New Requests" required>
                  <select style={sel()} value={data.response_time as string} onChange={e => set("response_time", e.target.value)}>
                    <option value="">Select…</option>
                    {RESPONSE_TIMES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <YesNo label="Do you provide written estimates?" value={data.provides_written_estimates as boolean | null} onChange={v => set("provides_written_estimates", v)} required />
                <YesNo label="Do you provide upfront pricing or pricing ranges?" value={data.upfront_pricing as boolean | null} onChange={v => set("upfront_pricing", v)} required />
                <YesNo label="Do you proactively communicate delays or schedule changes?" value={data.proactive_delays as boolean | null} onChange={v => set("proactive_delays", v)} required />
                <CheckGroup label="Preferred Communication Method" options={COMM_PREFS} value={data.preferred_communication as string[]} onChange={v => set("preferred_communication", v)} />
                <Field label="Scenario: A homeowner requests a quote and hasn't heard from you in 24 hours. What do you do?" required>
                  <textarea style={ta()} value={data.scenario_response as string} onChange={e => set("scenario_response", e.target.value)} placeholder="Describe exactly what you'd do in this situation…" />
                </Field>
                <Field label="What does a 5-star homeowner experience mean to you?" required>
                  <textarea style={ta()} value={data.five_star_meaning as string} onChange={e => set("five_star_meaning", e.target.value)} placeholder="Describe your vision of an excellent client experience…" />
                </Field>
                <Field label="What do most vendors in your industry do wrong?" required>
                  <textarea style={ta()} value={data.industry_wrongs as string} onChange={e => set("industry_wrongs", e.target.value)} placeholder="Be honest and specific…" />
                </Field>
                <Field label="Why do you want to be part of BTLR?" required>
                  <textarea style={ta()} value={data.why_btlr as string} onChange={e => set("why_btlr", e.target.value)} placeholder="Tell us why BTLR is the right fit for your business…" />
                </Field>
              </div>
            )}

            {/* ── STEP 7: Pricing & Availability ── */}
            {step === 7 && (
              <div>
                <Field label="Pricing Model" required>
                  <select style={sel()} value={data.pricing_model as string} onChange={e => set("pricing_model", e.target.value)}>
                    <option value="">Select…</option>
                    {PRICING_MODELS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Typical Service Call Fee" hint="e.g. $75, or 'No fee — included in estimate'">
                    <input style={inp()} value={data.service_call_fee as string} onChange={e => set("service_call_fee", e.target.value)} placeholder="e.g. $85 diagnostic fee" />
                  </Field>
                  <Field label="Typical Lead Time for New Jobs" required>
                    <select style={sel()} value={data.typical_lead_time as string} onChange={e => set("typical_lead_time", e.target.value)}>
                      <option value="">Select…</option>
                      {LEAD_TIMES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Weekly Job Capacity" required>
                    <select style={sel()} value={data.weekly_job_capacity as string} onChange={e => set("weekly_job_capacity", e.target.value)}>
                      <option value="">Select…</option>
                      {CAPACITY.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Normal Service Hours" hint="e.g. Mon–Fri 8am–5pm">
                    <input style={inp()} value={data.service_hours as string} onChange={e => set("service_hours", e.target.value)} placeholder="Mon–Fri 8am–5pm" />
                  </Field>
                </div>
                <Field label="Are estimates free or paid?">
                  <div style={{ display: "flex", gap: 10 }}>
                    {[{ label: "Free", val: true }, { label: "Paid", val: false }].map(opt => (
                      <button key={String(opt.val)} type="button" onClick={() => set("estimates_free", opt.val)}
                        style={{ flex: 1, padding: "11px 0", border: `1.5px solid ${data.estimates_free === opt.val ? C.gold : C.border}`, borderRadius: 8, background: data.estimates_free === opt.val ? C.goldDim : C.white, fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: data.estimates_free === opt.val ? C.gold : C.muted, cursor: "pointer" }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <YesNo label="Do you offer emergency / after-hours availability?" value={data.emergency_availability as boolean | null} onChange={v => set("emergency_availability", v)} required />
                <YesNo label="Are you available on weekends?" value={data.after_hours as boolean | null} onChange={v => set("after_hours", v)} />
              </div>
            )}

            {/* ── STEP 8: Agreements ── */}
            {step === 8 && (
              <div>
                <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.8, marginBottom: 28, fontFamily: INTER }}>
                  To be considered for the BTLR Trusted Network, you must agree to the following standards. These are the expectations every vendor on our platform upholds.
                </p>
                {[
                  ["agree_license_insurance",     "I will maintain valid state licensing and general liability insurance at all times."],
                  ["agree_response_window",        "I will respond to homeowner requests within BTLR's required response window (typically 4 hours during business hours)."],
                  ["agree_transparent_pricing",    "I will provide transparent pricing and will not add hidden fees after work begins."],
                  ["agree_written_estimates",      "I will provide written estimates for all jobs over $500."],
                  ["agree_no_upsells",             "I will not recommend or perform unnecessary work to increase a job's value."],
                  ["agree_professional",           "I will treat all BTLR homeowners with professionalism, punctuality, and respect."],
                  ["agree_job_updates",            "I will upload job progress photos and updates when requested by BTLR or the homeowner."],
                  ["agree_rating_system",          "I will participate in BTLR's post-service rating system and accept feedback."],
                  ["agree_performance_standards",  "I understand that my performance on BTLR is tracked and I must maintain minimum quality standards."],
                  ["agree_probationary_removal",   "I accept that I may be placed on probation or removed from the network if my ratings or conduct fall below BTLR's standards."],
                ].map(([key, text]) => (
                  <label key={key} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 16px", border: `1.5px solid ${data[key] ? C.gold : C.border}`, borderRadius: 8, marginBottom: 10, background: data[key] ? C.goldDim : C.white, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!data[key]} onChange={e => set(key, e.target.checked)} style={{ marginTop: 2, accentColor: C.gold, width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: C.text, lineHeight: 1.65, fontFamily: INTER }}>{text}</span>
                  </label>
                ))}
              </div>
            )}

            {/* ── STEP 9: Review & Submit ── */}
            {step === 9 && (
              <div>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75, marginBottom: 28, fontFamily: INTER }}>Review your application before submitting. Click any section to go back and edit.</p>
                {[
                  { title: "Business Profile", stepN: 1, rows: [
                    ["Business Name", data.business_name], ["Owner", data.owner_name],
                    ["Phone", data.business_phone], ["Email", data.business_email],
                    ["Website", data.website], ["Years in Business", data.years_in_business],
                    ["Team Size", data.team_size], ["Service Categories", data.service_categories],
                    ["Service ZIP Codes", data.service_zip_codes], ["Emergency Service", data.emergency_service],
                  ]},
                  { title: "Licensing & Insurance", stepN: 2, rows: [
                    ["License #", data.license_number], ["License State", data.license_state],
                    ["Expiration", data.license_expiration], ["Insurance Provider", data.insurance_provider],
                    ["Workers Comp", data.workers_comp_status], ["Bonded", data.is_bonded],
                    ["Prior Violations", data.prior_violations],
                  ]},
                  { title: "Services & Specialties", stepN: 3, rows: [
                    ["Primary Specialty", data.primary_specialty], ["Secondary Services", data.secondary_services],
                    ["Average Job Size", data.average_job_size], ["Property Types", data.property_types],
                  ]},
                  { title: "Communication", stepN: 6, rows: [
                    ["Response Time", data.response_time], ["Written Estimates", data.provides_written_estimates],
                    ["Upfront Pricing", data.upfront_pricing], ["Preferred Communication", data.preferred_communication],
                    ["Why BTLR", data.why_btlr],
                  ]},
                  { title: "Pricing & Availability", stepN: 7, rows: [
                    ["Pricing Model", data.pricing_model], ["Service Call Fee", data.service_call_fee],
                    ["Lead Time", data.typical_lead_time], ["Weekly Capacity", data.weekly_job_capacity],
                    ["Service Hours", data.service_hours],
                  ]},
                ].map(({ title, stepN, rows }) => (
                  <div key={title} style={{ marginBottom: 20, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>{title}</span>
                      <button type="button" onClick={() => { setStep(stepN); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold, background: "none", border: "none", cursor: "pointer" }}>Edit</button>
                    </div>
                    <div style={{ padding: "4px 16px 8px" }}>
                      {rows.map(([label, val]) => <ReviewRow key={String(label)} label={String(label)} value={val} />)}
                    </div>
                  </div>
                ))}
                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "20px 24px", marginTop: 28 }}>
                  <label style={{ display: "flex", gap: 14, alignItems: "flex-start", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!data.final_confirmation} onChange={e => set("final_confirmation", e.target.checked)} style={{ marginTop: 3, accentColor: C.gold, width: 18, height: 18, flexShrink: 0 }} />
                    <span style={{ fontSize: 15, color: "#92400E", lineHeight: 1.65, fontFamily: INTER, fontWeight: 500 }}>
                      I understand that submitting this application does not guarantee acceptance into the BTLR Trusted Network. I certify that all information provided is accurate and truthful.
                    </span>
                  </label>
                </div>
              </div>
            )}

          </div>

          {/* Footer nav */}
          <div style={{ padding: "20px 36px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.surface }}>
            <div>
              {step > 1 && (
                <button type="button" onClick={back} style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 20px", background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", borderRadius: 8 }}>
                  ← Back
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="button" onClick={() => saveDraft()} disabled={saving} style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 20px", background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", borderRadius: 8 }}>
                {saving ? "Saving…" : "Save Draft"}
              </button>
              {step < 9 ? (
                <button type="button" onClick={advance} style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "13px 28px", background: C.gold, color: "#fff", border: "none", cursor: "pointer", borderRadius: 8 }}>
                  Save & Continue →
                </button>
              ) : (
                <button type="button" onClick={handleSubmit} disabled={submitting || !data.final_confirmation} style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "13px 28px", background: data.final_confirmation ? C.gold : C.border, color: data.final_confirmation ? "#fff" : C.muted, border: "none", cursor: data.final_confirmation ? "pointer" : "default", borderRadius: 8 }}>
                  {submitting ? "Submitting…" : "Submit Application"}
                </button>
              )}
            </div>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: C.dim, marginTop: 20, fontFamily: INTER, letterSpacing: "0.06em" }}>
          Your progress is saved automatically. You can return to this form at any time using the same browser.
        </p>
      </div>
    </div>
  );
}
