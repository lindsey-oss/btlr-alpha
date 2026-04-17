"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { MapPin, Phone, Clock, CheckCircle2, XCircle, Wrench, AlertTriangle, ChevronRight, Loader2,
  Home as HomeIcon, DollarSign, FileText, HelpCircle, AlertOctagon,
  Home, Droplets, Zap, Thermometer, Bug, Layers, Wind, Paintbrush, AlignLeft } from "lucide-react";

function getTradeIcon(trade: string, size = 20, color = "white"): React.ReactNode {
  const k = (trade || "").toLowerCase();
  if (k.includes("roof"))                                               return <Home size={size} color={color}/>;
  if (k.includes("plumb"))                                             return <Droplets size={size} color={color}/>;
  if (k.includes("electric"))                                          return <Zap size={size} color={color}/>;
  if (k.includes("hvac") || k.includes("heat") || k.includes("cool") || k.includes("air"))
                                                                       return <Thermometer size={size} color={color}/>;
  if (k.includes("pest") || k.includes("termite"))                    return <Bug size={size} color={color}/>;
  if (k.includes("found") || k.includes("struct") || k.includes("insul")) return <Layers size={size} color={color}/>;
  if (k.includes("mold") || k.includes("water"))                      return <Droplets size={size} color={color}/>;
  if (k.includes("window") || k.includes("door"))                     return <Wind size={size} color={color}/>;
  if (k.includes("paint"))                                             return <Paintbrush size={size} color={color}/>;
  if (k.includes("floor"))                                             return <AlignLeft size={size} color={color}/>;
  return                                                                      <Wrench size={size} color={color}/>;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const C = {
  bg: "#f0f4f8", surface: "#ffffff", navy: "#0f1f3d", navyMid: "#1e3a8a",
  accent: "#2563eb", text: "#0f172a", text2: "#475569", text3: "#94a3b8",
  border: "#e2e8f0", green: "#16a34a", greenBg: "#f0fdf4",
  amber: "#d97706", amberBg: "#fffbeb", red: "#dc2626", redBg: "#fef2f2",
};

const URGENCY_STYLE: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  emergency: { color: C.red,    bg: C.redBg,   label: "Emergency — Respond ASAP",    icon: <AlertOctagon size={14}/> },
  urgent:    { color: C.amber,  bg: C.amberBg, label: "Urgent — Within 24 hrs",      icon: <AlertTriangle size={14}/> },
  normal:    { color: C.accent, bg: "#eff6ff",  label: "Normal — Within a few days", icon: <Clock size={14}/> },
  low:       { color: C.green,  bg: C.greenBg, label: "Low Priority",                icon: <CheckCircle2 size={14}/> },
};

interface Job {
  id: string;
  created_at: string;
  homeowner_email: string;
  property_address: string;
  trade: string;
  trade_emoji: string;
  issue_summary: string;
  full_description: string;
  urgency: string;
  urgency_reason: string;
  what_to_tell_contractor: string;
  diy_tips: string[];
  questions_to_ask: string[];
  estimated_cost_low: number;
  estimated_cost_high: number;
  related_findings: any[];
  status: string;
  contractor_name: string;
  contractor_phone: string;
  contractor_notes: string;
  accepted_at: string;
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob]             = useState<Job | null>(null);
  const [loading, setLoading]     = useState(true);
  const [name, setName]           = useState("");
  const [phone, setPhone]         = useState("");
  const [notes, setNotes]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);
  const [declined, setDeclined]   = useState(false);

  useEffect(() => {
    if (!id) return;
    loadJob();

    // Real-time status updates via Supabase Realtime
    const channel = supabase
      .channel(`job-${id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "job_requests",
        filter: `id=eq.${id}`,
      }, payload => setJob(payload.new as Job))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function loadJob() {
    const { data } = await supabase
      .from("job_requests")
      .select("*")
      .eq("id", id)
      .single();
    setJob(data);
    setLoading(false);
  }

  async function accept() {
    if (!name.trim()) { alert("Please enter your name so the homeowner knows who's coming."); return; }
    setSubmitting(true);
    await fetch("/api/update-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: id, status: "accepted",
        contractor_name: name, contractor_phone: phone, contractor_notes: notes,
      }),
    });
    setDone(true);
    setSubmitting(false);
    loadJob();
  }

  async function decline() {
    setSubmitting(true);
    await fetch("/api/update-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: id, status: "declined" }),
    });
    setDeclined(true);
    setSubmitting(false);
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <Loader2 size={28} color={C.accent} className="animate-spin"/>
    </div>
  );

  if (!job) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <p style={{ color: C.text2, fontSize: 18 }}>Job not found.</p>
    </div>
  );

  const urgInfo = URGENCY_STYLE[job.urgency] ?? URGENCY_STYLE.normal;
  const alreadyHandled = job.status === "accepted" || job.status === "declined" || done || declined;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: C.navy, padding: "18px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <HomeIcon size={18} color="white"/>
        </div>
        <div>
          <p style={{ color: "white", fontWeight: 700, fontSize: 18, margin: 0 }}>BTLR — Job Request</p>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: 0 }}>Homeowner needs a {job.trade} professional</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 14px", borderRadius: 20,
            fontSize: 13, fontWeight: 700, background: urgInfo.bg, color: urgInfo.color }}>
            {urgInfo.icon} {urgInfo.label}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Already accepted / declined */}
        {(done || job.status === "accepted") && (
          <div style={{ background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 14, padding: 20,
            display: "flex", alignItems: "center", gap: 12 }}>
            <CheckCircle2 size={24} color={C.green}/>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16, color: C.green, margin: 0 }}>Job Accepted!</p>
              <p style={{ color: C.text2, fontSize: 14, margin: "4px 0 0" }}>
                The homeowner has been notified. They'll be expecting your call at {phone || "the number you provided"}.
              </p>
            </div>
          </div>
        )}

        {(declined || job.status === "declined") && (
          <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 14, padding: 20,
            display: "flex", alignItems: "center", gap: 12 }}>
            <XCircle size={24} color={C.red}/>
            <p style={{ fontWeight: 700, fontSize: 16, color: C.red, margin: 0 }}>Job Declined</p>
          </div>
        )}

        {/* Job Summary Card */}
        <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
          boxShadow: "0 2px 12px rgba(15,31,61,0.07)", overflow: "hidden" }}>

          {/* Trade banner */}
          <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`, padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0 }}>
                {getTradeIcon(job.trade, 24, "white")}
              </div>
              <div>
                <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
                  textTransform: "uppercase", margin: 0 }}>{job.trade} Request</p>
                <p style={{ color: "white", fontSize: 20, fontWeight: 700, margin: "4px 0 0", letterSpacing: "-0.3px" }}>
                  {job.issue_summary}
                </p>
              </div>
            </div>
          </div>

          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Property address */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#eff6ff",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MapPin size={15} color={C.accent}/>
              </div>
              <div>
                <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.07em", margin: 0 }}>Property Address</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: "3px 0 0" }}>{job.property_address}</p>
              </div>
            </div>

            {/* Submitted */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.amberBg,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Clock size={15} color={C.amber}/>
              </div>
              <div>
                <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.07em", margin: 0 }}>Submitted</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: "3px 0 0" }}>
                  {new Date(job.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>

            {/* Full description */}
            <div style={{ background: C.bg, borderRadius: 10, padding: "14px 16px" }}>
              <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.07em", marginBottom: 8 }}>Issue Description</p>
              <p style={{ fontSize: 15, color: C.text, lineHeight: 1.65, margin: 0 }}>
                {job.full_description}
              </p>
            </div>

            {/* Urgency */}
            <div style={{ background: urgInfo.bg, borderRadius: 10, padding: "12px 16px",
              border: `1px solid ${urgInfo.color}30` }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: urgInfo.color, margin: "0 0 4px",
                display: "flex", alignItems: "center", gap: 5 }}>
                {urgInfo.icon} {urgInfo.label}
              </p>
              <p style={{ fontSize: 14, color: C.text2, margin: 0 }}>{job.urgency_reason}</p>
            </div>

            {/* Budget */}
            {job.estimated_cost_low && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 16px",
                background: C.bg, borderRadius: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: C.greenBg, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DollarSign size={16} color={C.green}/>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.07em", margin: 0 }}>Homeowner's Budget Expectation</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: "3px 0 0", letterSpacing: "-0.3px" }}>
                    ${job.estimated_cost_low.toLocaleString()} – ${job.estimated_cost_high.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {/* Related inspection findings */}
            {job.related_findings?.length > 0 && (
              <div>
                <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.07em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <FileText size={12} color={C.text3}/> From Inspection Report
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {job.related_findings.map((f: any, i: number) => {
                    const dotColor = f.severity === "critical" ? C.red : f.severity === "warning" ? C.amber : C.text3;
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 12px", borderRadius: 8,
                        background: C.bg, alignItems: "flex-start" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor,
                          flexShrink: 0, marginTop: 5 }}/>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.category}</span>
                          <span style={{ fontSize: 13, color: C.text2, display: "block", marginTop: 2 }}>{f.description}</span>
                        </div>
                        {f.estimated_cost && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: dotColor, flexShrink: 0 }}>
                            ${f.estimated_cost.toLocaleString()}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Homeowner contact */}
            {job.homeowner_email && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                background: C.bg, borderRadius: 10 }}>
                <Phone size={14} color={C.text3}/>
                <div>
                  <p style={{ fontSize: 12, color: C.text3, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.07em", margin: 0 }}>Homeowner Contact</p>
                  <a href={`mailto:${job.homeowner_email}`}
                    style={{ fontSize: 14, color: C.accent, fontWeight: 600, textDecoration: "none" }}>
                    {job.homeowner_email}
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Accept / Decline — only if pending */}
        {!alreadyHandled && (
          <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
            boxShadow: "0 2px 12px rgba(15,31,61,0.07)", padding: 22 }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>
              Are you available for this job?
            </p>
            <p style={{ fontSize: 14, color: C.text3, marginBottom: 18 }}>
              Enter your info below and accept — the homeowner will be notified immediately.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 5 }}>
                  Your Name *
                </label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Mike Johnson"
                  style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1.5px solid ${C.border}`,
                    fontSize: 15, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 5 }}>
                  Your Phone Number
                </label>
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="(760) 555-0100"
                  type="tel"
                  style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1.5px solid ${C.border}`,
                    fontSize: 15, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box" }}/>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 5 }}>
                  Message to Homeowner (optional)
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. I can be there Tuesday afternoon. I'll call 30 minutes before."
                  rows={3}
                  style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1.5px solid ${C.border}`,
                    fontSize: 15, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box",
                    resize: "vertical" }}/>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={accept} disabled={submitting} style={{
                  flex: 1, padding: "13px 0", borderRadius: 12, border: "none", cursor: "pointer",
                  background: `linear-gradient(135deg, ${C.navyMid}, ${C.accent})`,
                  color: "white", fontSize: 16, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: submitting ? 0.7 : 1,
                }}>
                  {submitting ? <Loader2 size={16} className="animate-spin"/> : <CheckCircle2 size={16}/>}
                  Accept Job
                </button>
                <button onClick={decline} disabled={submitting} style={{
                  padding: "13px 20px", borderRadius: 12, border: `1.5px solid ${C.border}`,
                  cursor: "pointer", background: "white", color: C.text2, fontSize: 15, fontWeight: 600,
                  opacity: submitting ? 0.5 : 1,
                }}>
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Questions to ask footer */}
        {job.questions_to_ask?.length > 0 && (
          <div style={{ background: C.amberBg, borderRadius: 14, padding: "14px 18px",
            border: `1px solid ${C.amber}30` }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: "uppercase",
              letterSpacing: "0.07em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <HelpCircle size={12} color={C.amber}/> The homeowner may ask you
            </p>
            {job.questions_to_ask.map((q: string, i: number) => (
              <p key={i} style={{ fontSize: 14, color: C.text, marginBottom: 4 }}>{i + 1}. {q}</p>
            ))}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 12, color: C.text3 }}>
          Powered by BTLR Home OS · btlr.app
        </p>
      </div>
    </div>
  );
}
