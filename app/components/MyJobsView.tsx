"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Loader2, ExternalLink, Clock, CheckCircle2, XCircle, Wrench, Phone, RefreshCw,
  DollarSign, Home, Droplets, Zap, Thermometer, Bug, Layers, Wind, Paintbrush, AlignLeft,
  Briefcase, Trash2 } from "lucide-react";

function getTradeIcon(trade: string, size = 18, color = "#94a3b8"): React.ReactNode {
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

const STATUS: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:     { label: "Awaiting Response", color: C.amber,  bg: C.amberBg, icon: <Clock size={13}/> },
  accepted:    { label: "Accepted",           color: C.green,  bg: C.greenBg, icon: <CheckCircle2 size={13}/> },
  in_progress: { label: "In Progress",        color: C.accent, bg: "#eff6ff",  icon: <Wrench size={13}/> },
  completed:   { label: "Completed",          color: C.green,  bg: C.greenBg, icon: <CheckCircle2 size={13}/> },
  declined:    { label: "Declined",           color: C.red,    bg: C.redBg,   icon: <XCircle size={13}/> },
};

interface Job {
  id: string;
  created_at: string;
  trade: string;
  trade_emoji: string;
  issue_summary: string;
  urgency: string;
  status: string;
  property_address: string;
  estimated_cost_low: number;
  estimated_cost_high: number;
  contractor_name: string;
  contractor_phone: string;
  contractor_notes: string;
  accepted_at: string;
}

export default function MyJobsView() {
  const [jobs, setJobs]         = useState<Job[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId]     = useState<string | null>(null);
  const userIdRef               = useRef<string | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      userIdRef.current = uid;
      loadJobs(uid);

      if (!uid) return;

      // Real-time subscription — no server-side column filter.
      // Supabase postgres_changes UPDATE events only include columns in the
      // table's REPLICA IDENTITY (default = primary key only). user_id is not
      // in the primary key, so a filter of `user_id=eq.${uid}` would never
      // match UPDATE payloads and the callback would never fire for status
      // changes (e.g. vendor accepting a job). loadJobs() handles user-scoping
      // via .eq("user_id", uid) in the actual query.
      channel = supabase
        .channel("my-jobs")
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "job_requests",
        }, () => loadJobs(uid))
        .subscribe();
    });

    // Proper cleanup — runs when component unmounts
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function deleteJob(jobId: string) {
    if (!confirm("Remove this job request? This cannot be undone.")) return;
    const { error } = await supabase.from("job_requests").delete().eq("id", jobId);
    if (error) { alert("Could not delete job: " + error.message); return; }
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }

  async function loadJobs(uid?: string | null) {
    const filterUid = uid ?? userIdRef.current;
    // Do not query at all if there is no authenticated user.
    if (!filterUid) { setLoading(false); return; }

    const { data } = await supabase
      .from("job_requests")
      .select("*")
      .eq("user_id", filterUid)               // filter by UUID — RLS is backstop
      .order("created_at", { ascending: false });

    setJobs(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadJobs(userIdRef.current);
  }

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <Loader2 size={24} color={C.accent} className="animate-spin"/>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>My Jobs</h2>
          <p style={{ fontSize: 14, color: C.text3, margin: "4px 0 0" }}>
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} submitted
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
          borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
          color: C.text2, fontSize: 13, fontWeight: 600, cursor: refreshing ? "default" : "pointer",
          opacity: refreshing ? 0.6 : 1,
        }}>
          <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : {}}/>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {jobs.length === 0 ? (
        <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
          padding: "48px 24px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: C.bg, border: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Briefcase size={24} color={C.text3}/>
            </div>
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 }}>No jobs yet</p>
          <p style={{ fontSize: 14, color: C.text3 }}>Go to Vendors, describe an issue, and send your first job request.</p>
        </div>
      ) : (
        jobs.map(job => {
          const st = STATUS[job.status] ?? STATUS.pending;
          const jobUrl = `${window.location.origin}/job/${job.id}`;
          return (
            <div key={job.id} style={{
              background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
              boxShadow: "0 1px 4px rgba(15,31,61,0.06)", overflow: "hidden",
            }}>
              {/* Top bar */}
              <div style={{ padding: "14px 20px", display: "flex", alignItems: "center",
                justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    background: "linear-gradient(135deg, #0f1f3d, #1e3a8a)",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {getTradeIcon(job.trade, 18, "white")}
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 15, color: C.text, margin: 0 }}>{job.trade}</p>
                    <p style={{ fontSize: 13, color: C.text3, margin: "2px 0 0" }}>
                      {new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: st.bg, color: st.color }}>
                    {st.icon} {st.label}
                  </span>
                  <a href={jobUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                      borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12,
                      color: C.text2, textDecoration: "none", fontWeight: 600 }}>
                    <ExternalLink size={11}/> Job Link
                  </a>
                  <button onClick={() => deleteJob(job.id)}
                    title="Delete job"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`,
                      background: C.surface, cursor: "pointer", color: C.red }}>
                    <Trash2 size={13}/>
                  </button>
                </div>
              </div>

              <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Issue */}
                <p style={{ fontSize: 14, color: C.text, margin: 0 }}>{job.issue_summary}</p>

                {/* Cost estimate */}
                {job.estimated_cost_low && (
                  <p style={{ fontSize: 13, color: C.text3, margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
                    <DollarSign size={13} color={C.text3}/> Est. ${job.estimated_cost_low.toLocaleString()} – ${job.estimated_cost_high.toLocaleString()}
                  </p>
                )}

                {/* Contractor info if accepted */}
                {(job.status === "accepted" || job.status === "in_progress" || job.status === "completed") && job.contractor_name && (
                  <div style={{ background: C.greenBg, border: `1px solid ${C.green}30`,
                    borderRadius: 10, padding: "10px 14px" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.green, margin: "0 0 4px",
                      display: "flex", alignItems: "center", gap: 5 }}>
                      <CheckCircle2 size={13}/> {job.contractor_name} accepted
                    </p>
                    {job.contractor_phone && (
                      <a href={`tel:${job.contractor_phone}`}
                        style={{ fontSize: 13, color: C.text2, display: "flex", alignItems: "center",
                          gap: 5, textDecoration: "none", fontWeight: 600 }}>
                        <Phone size={12}/> {job.contractor_phone}
                      </a>
                    )}
                    {job.contractor_notes && (
                      <p style={{ fontSize: 13, color: C.text2, margin: "6px 0 0",
                        fontStyle: "italic" }}>"{job.contractor_notes}"</p>
                    )}
                  </div>
                )}

                {/* Share link */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input readOnly value={jobUrl}
                    style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
                      fontSize: 12, color: C.text3, background: C.bg, outline: "none" }}/>
                  <button onClick={() => navigator.clipboard.writeText(jobUrl)}
                    style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
                      background: C.surface, fontSize: 12, fontWeight: 600, color: C.text2,
                      cursor: "pointer" }}>
                    Copy
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
