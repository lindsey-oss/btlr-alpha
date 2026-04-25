"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const C = {
  navy:    "#1B2D47", gold: "#2C5F8A", goldDk: "#1E4568",
  text:    "#1C1914", muted: "#6B6558", dim: "#A09C92",
  surface: "#F7F2EC", border: "rgba(28,25,20,0.09)", borderGold: "rgba(44,95,138,0.22)",
  white:   "#FFFFFF", error: "#DC2626", success: "#15803D",
};
const DM   = "'DM Sans', sans-serif";
const SYNE = "'Syne', sans-serif";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:           { label: "Draft",           color: "#6B6558", bg: "#F7F2EC" },
  pending_review:  { label: "Pending Review",  color: "#92400E", bg: "#FEF3C7" },
  needs_more_info: { label: "Needs More Info", color: "#1E40AF", bg: "#DBEAFE" },
  approved:        { label: "Approved",        color: "#15803D", bg: "#DCFCE7" },
  rejected:        { label: "Rejected",        color: "#DC2626", bg: "#FEE2E2" },
  probationary:    { label: "Probationary",    color: "#7C3AED", bg: "#EDE9FE" },
};

const SCORE_FIELDS = [
  { key: "licensing",      label: "Licensing & Insurance", max: 30, hint: "Valid license, insurance coverage, no violations" },
  { key: "reviews",        label: "Reviews & Reputation",  max: 20, hint: "Ratings quality, volume, recency of reviews" },
  { key: "work_quality",   label: "Work Quality",          max: 20, hint: "Portfolio samples, project examples, photo quality" },
  { key: "communication",  label: "Communication",         max: 15, hint: "Response time, written estimates, scenario answers" },
  { key: "experience",     label: "Experience",            max: 10, hint: "Years in business, team size, specialties" },
  { key: "professionalism",label: "Professionalism",       max: 5,  hint: "References, industry affiliations, overall impression" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontFamily: SYNE, fontSize: 13, fontWeight: 800, color: C.gold, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 16px", borderBottom: `1px solid ${C.borderGold}`, paddingBottom: 10 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value == null || value === "" || value === false) return null;
  const display = value === true ? "Yes" : String(value);
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 10, alignItems: "flex-start" }}>
      <span style={{ minWidth: 200, fontSize: 13, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{display}</span>
    </div>
  );
}

function TagList({ label, value }: { label: string; value?: string[] | null }) {
  if (!value?.length) return null;
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 10, alignItems: "flex-start" }}>
      <span style={{ minWidth: 200, fontSize: 13, color: C.muted, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {value.map(v => (
          <span key={v} style={{ background: "#E8F0F8", color: C.gold, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppData = Record<string, any>;
type DocData = { id: string; document_type: string; file_name: string; signed_url: string | null; file_size: number };

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [app, setApp]      = useState<AppData | null>(null);
  const [docs, setDocs]    = useState<DocData[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Scoring state
  const [scores, setScores] = useState<Record<string, string>>({
    licensing: "", reviews: "", work_quality: "", communication: "", experience: "", professionalism: "",
  });
  const [notes, setNotes]           = useState("");
  const [moreInfo, setMoreInfo]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionDone, setActionDone] = useState("");
  const [actionErr, setActionErr]   = useState("");

  const totalScore = SCORE_FIELDS.reduce((acc, f) => acc + (Number(scores[f.key]) || 0), 0);

  const load = async () => {
    try {
      const r = await fetch(`/api/admin/vendors/${id}`);
      if (r.status === 401) { router.push("/admin/vendors"); return; }
      if (!r.ok) { setNotFound(true); return; }
      const { data, documents } = await r.json();
      setApp(data);
      setDocs(documents || []);
      // Pre-populate existing scores
      if (data.admin_score_licensing    != null) setScores(s => ({ ...s, licensing:       String(data.admin_score_licensing) }));
      if (data.admin_score_reviews      != null) setScores(s => ({ ...s, reviews:         String(data.admin_score_reviews) }));
      if (data.admin_score_work_quality != null) setScores(s => ({ ...s, work_quality:    String(data.admin_score_work_quality) }));
      if (data.admin_score_communication!= null) setScores(s => ({ ...s, communication:   String(data.admin_score_communication) }));
      if (data.admin_score_experience   != null) setScores(s => ({ ...s, experience:      String(data.admin_score_experience) }));
      if (data.admin_score_professionalism!=null)setScores(s => ({ ...s, professionalism: String(data.admin_score_professionalism) }));
      if (data.admin_notes)            setNotes(data.admin_notes);
      if (data.admin_more_info_request) setMoreInfo(data.admin_more_info_request);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleAction = async (action: string) => {
    setSubmitting(true); setActionErr(""); setActionDone("");
    try {
      const body: Record<string, unknown> = { id, action, admin_notes: notes || null };
      const allFilled = SCORE_FIELDS.every(f => scores[f.key] !== "");
      if (allFilled) {
        body.admin_score_breakdown = SCORE_FIELDS.reduce<Record<string, number>>((acc, f) => {
          acc[f.key] = Number(scores[f.key]); return acc;
        }, {});
      }
      if (action === "more_info") body.more_info_request = moreInfo;

      const r = await fetch("/api/admin/vendor-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "Action failed");
      setActionDone(`Application ${action === "more_info" ? "flagged for more info" : action + "d"} successfully. Email sent to vendor.`);
      await load();
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DM, color: C.muted }}>
      Loading application…
    </div>
  );

  if (notFound || !app) return (
    <div style={{ minHeight: "100vh", background: C.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: DM, gap: 16 }}>
      <p style={{ color: C.muted }}>Application not found.</p>
      <Link href="/admin/vendors" style={{ color: C.gold }}>← Back to list</Link>
    </div>
  );

  const statusMeta = STATUS_META[app.status] ?? { label: app.status, color: C.muted, bg: C.surface };

  return (
    <div style={{ minHeight: "100vh", background: C.surface, fontFamily: DM }}>
      {/* Header */}
      <div style={{ background: C.navy, padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Link href="/" style={{ fontFamily: SYNE, fontSize: 18, fontWeight: 800, color: C.gold, letterSpacing: "0.14em", textDecoration: "none" }}>BTLR</Link>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
          <Link href="/admin/vendors" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, textDecoration: "none" }}>Applications</Link>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>›</span>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{app.business_name || "Unnamed Application"}</span>
        </div>
        <span style={{ background: statusMeta.bg, color: statusMeta.color, padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
          {statusMeta.label}
        </span>
      </div>

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 340px", gap: 32 }}>

        {/* ── Left: Application data ── */}
        <div>

          {/* Step 1: Business Profile */}
          <Section title="Business Profile">
            <Row label="Business Name"    value={app.business_name} />
            <Row label="Owner Name"       value={app.owner_name} />
            <Row label="Email"            value={app.business_email} />
            <Row label="Phone"            value={app.business_phone} />
            <Row label="Website"          value={app.website} />
            <Row label="Years in Business" value={app.years_in_business} />
            <Row label="Team Size"        value={app.team_size} />
            <Row label="Service Address"  value={[app.address_city, app.address_state, app.address_zip].filter(Boolean).join(", ")} />
            <Row label="Facebook"         value={app.social_facebook} />
            <Row label="Instagram"        value={app.social_instagram} />
            <Row label="LinkedIn"         value={app.social_linkedin} />
            <TagList label="Service Categories" value={app.service_categories} />
            <TagList label="Service ZIP Codes"  value={app.service_zip_codes} />
            <Row label="Emergency Service" value={app.emergency_service} />
          </Section>

          {/* Step 2: Licensing */}
          <Section title="Licensing & Insurance">
            <Row label="License Number"    value={app.license_number} />
            <Row label="License State"     value={app.license_state} />
            <Row label="License Expiry"    value={app.license_expiration} />
            <Row label="Insurance Provider" value={app.insurance_provider} />
            <Row label="Workers' Comp"     value={app.workers_comp_status} />
            <Row label="Bonded"            value={app.is_bonded} />
            <Row label="Prior Violations"  value={app.prior_violations} />
            {app.prior_violations && <Row label="Violation Details" value={app.prior_violations_explanation} />}
          </Section>

          {/* Step 3: Services */}
          <Section title="Services & Specialties">
            <Row label="Primary Specialty"   value={app.primary_specialty} />
            <TagList label="Secondary Services" value={app.secondary_services} />
            <Row label="Avg Job Size"        value={app.average_job_size} />
            <TagList label="Property Types"  value={app.property_types} />
            <Row label="Brands / Systems"    value={app.brands_systems} />
            <Row label="Services NOT Offered" value={app.services_not_offered} />
          </Section>

          {/* Step 4: Portfolio */}
          <Section title="Work Quality Proof">
            {docs.filter(d => d.document_type === "work_photo" || d.document_type === "work_photo_before_after").length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Uploaded photos:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {docs.filter(d => d.document_type.startsWith("work_photo")).map(d => (
                    d.signed_url
                      ? <a key={d.id} href={d.signed_url} target="_blank" rel="noopener noreferrer">
                          <img src={d.signed_url} alt={d.file_name} style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 4, border: `1px solid ${C.border}` }} />
                        </a>
                      : <span key={d.id} style={{ fontSize: 12, color: C.dim }}>{d.file_name}</span>
                  ))}
                </div>
              </div>
            )}
            <Row label="Video Link" value={app.video_walkthrough_url} />
            {[1, 2].map(n => (
              <div key={n} style={{ background: "#FDFAF7", border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px", marginBottom: 12 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: C.gold, margin: "0 0 10px" }}>Project Example {n}</p>
                <Row label="Problem"  value={app[`project_${n}_problem`]} />
                <Row label="Solution" value={app[`project_${n}_solution`]} />
                <Row label="Outcome"  value={app[`project_${n}_outcome`]} />
              </div>
            ))}
          </Section>

          {/* Step 5: Reputation */}
          <Section title="Reputation & References">
            <Row label="Google Profile URL" value={app.google_profile_url} />
            <Row label="Yelp URL"           value={app.yelp_url} />
            <Row label="Other Review URLs"  value={app.other_review_urls} />
            {[1, 2, 3].map(n => (
              <div key={n} style={{ background: "#FDFAF7", border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px", marginBottom: 10 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: C.gold, margin: "0 0 8px" }}>Client Reference {n}</p>
                <Row label="Name"         value={app[`ref${n}_name`]} />
                <Row label="Phone"        value={app[`ref${n}_phone`]} />
                <Row label="Email"        value={app[`ref${n}_email`]} />
                <Row label="Project Type" value={app[`ref${n}_project_type`]} />
              </div>
            ))}
            <Row label="Industry Ref Name"         value={app.industry_ref_name} />
            <Row label="Industry Ref Phone"        value={app.industry_ref_phone} />
            <Row label="Industry Ref Email"        value={app.industry_ref_email} />
            <Row label="Industry Ref Relationship" value={app.industry_ref_relationship} />
          </Section>

          {/* Step 6: Communication */}
          <Section title="Communication & Experience">
            <Row label="Response Time"         value={app.response_time} />
            <Row label="Written Estimates"     value={app.provides_written_estimates} />
            <Row label="Upfront Pricing"       value={app.upfront_pricing} />
            <Row label="Proactive Delay Comms" value={app.proactive_delays} />
            <TagList label="Comm Preferences"  value={app.preferred_communication} />
            <div style={{ marginTop: 12 }}>
              <Row label="Scenario answer"    value={app.scenario_response} />
              <Row label="5-star definition"  value={app.five_star_meaning} />
              <Row label="Industry critique"  value={app.industry_wrongs} />
              <Row label="Why BTLR"           value={app.why_btlr} />
            </div>
          </Section>

          {/* Step 7: Pricing */}
          <Section title="Pricing & Availability">
            <Row label="Pricing Model"     value={app.pricing_model} />
            <Row label="Service Call Fee"  value={app.service_call_fee} />
            <Row label="Estimates Free?"   value={app.estimates_free} />
            <Row label="Lead Time"         value={app.typical_lead_time} />
            <Row label="Weekly Capacity"   value={app.weekly_job_capacity} />
            <Row label="Service Hours"     value={app.service_hours} />
            <Row label="After Hours"       value={app.after_hours} />
            <Row label="Emergency Avail."  value={app.emergency_availability} />
          </Section>

          {/* Step 8: Agreements */}
          <Section title="BTLR Standards Agreements">
            {[
              ["agree_license_insurance",    "Maintains valid license & insurance"],
              ["agree_response_window",      "24-hour response window"],
              ["agree_transparent_pricing",  "Transparent pricing"],
              ["agree_written_estimates",    "Written estimates"],
              ["agree_no_upsells",           "No predatory upsells"],
              ["agree_professional",         "Professional conduct"],
              ["agree_job_updates",          "Proactive job updates"],
              ["agree_rating_system",        "Rating & review system"],
              ["agree_performance_standards","Performance standards"],
              ["agree_probationary_removal", "Probationary removal policy"],
            ].map(([key, label]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{app[key] ? "✅" : "❌"}</span>
                <span style={{ fontSize: 14, color: app[key] ? C.text : C.dim }}>{label}</span>
              </div>
            ))}
          </Section>

          {/* Documents */}
          {docs.length > 0 && (
            <Section title="Uploaded Documents">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {docs.filter(d => !d.document_type.startsWith("work_photo")).map(d => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 14px" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{d.file_name}</span>
                      <span style={{ fontSize: 12, color: C.dim, marginLeft: 8 }}>({d.document_type})</span>
                      <span style={{ fontSize: 12, color: C.dim, marginLeft: 8 }}>{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : ""}</span>
                    </div>
                    {d.signed_url && (
                      <a href={d.signed_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: C.gold, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                        View ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Meta */}
          <div style={{ color: C.dim, fontSize: 12 }}>
            Created: {new Date(app.created_at).toLocaleString()} ·{" "}
            {app.submitted_at ? <>Submitted: {new Date(app.submitted_at).toLocaleString()}</> : "Not yet submitted"}
            {app.admin_reviewed_at ? <> · Reviewed: {new Date(app.admin_reviewed_at).toLocaleString()}</> : null}
          </div>
        </div>

        {/* ── Right: Scoring + Actions ── */}
        <div>
          <div style={{ position: "sticky", top: 24 }}>

            {/* Scoring */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "24px 20px", marginBottom: 20 }}>
              <h3 style={{ fontFamily: SYNE, fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold, margin: "0 0 18px" }}>
                Internal Scoring
              </h3>

              {SCORE_FIELDS.map(f => (
                <div key={f.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.label}</label>
                    <span style={{ fontSize: 11, color: C.dim }}>/{f.max}</span>
                  </div>
                  <p style={{ fontSize: 11, color: C.dim, margin: "0 0 6px" }}>{f.hint}</p>
                  <input
                    type="number"
                    min={0} max={f.max}
                    value={scores[f.key]}
                    onChange={e => {
                      const v = Math.min(f.max, Math.max(0, Number(e.target.value)));
                      setScores(s => ({ ...s, [f.key]: e.target.value === "" ? "" : String(v) }));
                    }}
                    placeholder={`0–${f.max}`}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 14, fontFamily: DM, boxSizing: "border-box" }}
                  />
                </div>
              ))}

              {/* Total */}
              <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 14, marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Total Score</span>
                <span style={{
                  fontFamily: SYNE, fontSize: 22, fontWeight: 800,
                  color: totalScore >= 70 ? C.success : totalScore >= 50 ? "#92400E" : totalScore > 0 ? C.error : C.dim,
                }}>
                  {totalScore}/100
                </span>
              </div>

              {totalScore > 0 && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 3, background: totalScore >= 70 ? "#DCFCE7" : totalScore >= 50 ? "#FEF3C7" : "#FEE2E2" }}>
                  <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: totalScore >= 70 ? C.success : totalScore >= 50 ? "#92400E" : C.error }}>
                    {totalScore >= 80 ? "Strong candidate — recommend approve" :
                     totalScore >= 70 ? "Good candidate — approve" :
                     totalScore >= 60 ? "Borderline — consider probationary" :
                     totalScore >= 50 ? "Marginal — request more info or reject" :
                     "Weak candidate — recommend reject"}
                  </p>
                </div>
              )}
            </div>

            {/* Admin Notes */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "20px", marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold, display: "block", marginBottom: 10 }}>
                Admin Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Internal notes about this applicant…"
                rows={4}
                style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 13, fontFamily: DM, resize: "vertical", boxSizing: "border-box" }}
              />
            </div>

            {/* More Info Request (shown when relevant) */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "20px", marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1E40AF", display: "block", marginBottom: 10 }}>
                More Info Request
              </label>
              <textarea
                value={moreInfo}
                onChange={e => setMoreInfo(e.target.value)}
                placeholder="Specify what additional info is needed from the vendor…"
                rows={3}
                style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 13, fontFamily: DM, resize: "vertical", boxSizing: "border-box" }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "20px" }}>
              <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold, margin: "0 0 16px" }}>
                Decision
              </h3>

              {actionDone && (
                <div style={{ background: "#DCFCE7", border: "1px solid #86efac", borderRadius: 3, padding: "10px 14px", marginBottom: 14 }}>
                  <p style={{ color: C.success, fontSize: 13, margin: 0, fontWeight: 600 }}>✓ {actionDone}</p>
                </div>
              )}
              {actionErr && (
                <div style={{ background: "#FEE2E2", borderRadius: 3, padding: "10px 14px", marginBottom: 14 }}>
                  <p style={{ color: C.error, fontSize: 13, margin: 0 }}>{actionErr}</p>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={() => handleAction("approve")}
                  disabled={submitting}
                  style={{ padding: "13px", background: C.success, color: "#fff", border: "none", borderRadius: 3, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => handleAction("probationary")}
                  disabled={submitting}
                  style={{ padding: "13px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 3, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}
                >
                  ◈ Approve (Probationary)
                </button>
                <button
                  onClick={() => handleAction("more_info")}
                  disabled={submitting || !moreInfo.trim()}
                  title={!moreInfo.trim() ? "Fill in the More Info Request field above first" : ""}
                  style={{ padding: "13px", background: "#1E40AF", color: "#fff", border: "none", borderRadius: 3, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: submitting || !moreInfo.trim() ? 0.5 : 1 }}
                >
                  ? Request More Info
                </button>
                <button
                  onClick={() => {
                    if (!confirm("Are you sure you want to reject this application?")) return;
                    handleAction("reject");
                  }}
                  disabled={submitting}
                  style={{ padding: "13px", background: C.error, color: "#fff", border: "none", borderRadius: 3, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}
                >
                  ✕ Reject
                </button>
              </div>

              <p style={{ fontSize: 11, color: C.dim, marginTop: 12, lineHeight: 1.5 }}>
                Scores and notes are saved with each decision. An email is sent to the applicant automatically.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
