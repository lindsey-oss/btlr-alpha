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
  navy: "#1A2C44", navy2: "#243A56",
  cream: "#F5EFE3", cream2: "#FBF6EB", paper: "#FFFFFF",
  ink: "#0E1B2C", ink2: "#3D4B5E", ink3: "#7E8A9A",
  line: "rgba(14,27,44,0.08)", line2: "rgba(14,27,44,0.04)",
  blue: "#2E6FB5", blueSoft: "#DBE8F4",
  orange: "#E89441", orangeSoft: "#FBEAD2",
  green: "#5A9A6E", greenSoft: "#DCE9D6",
  red: "#C25C4F", redSoft: "#F5DAD5",
  yellow: "#D4A845", yellowSoft: "#F4E8C8",
};

// Map DB status → display config
const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:     { label: "Awaiting Response", color: C.orange, bg: C.orangeSoft, icon: <Clock size={12}/> },
  accepted:    { label: "Scheduled",         color: C.blue,   bg: C.blueSoft,   icon: <CheckCircle2 size={12}/> },
  in_progress: { label: "In Progress",       color: C.yellow, bg: C.yellowSoft, icon: <Wrench size={12}/> },
  completed:   { label: "Completed",         color: C.green,  bg: C.greenSoft,  icon: <CheckCircle2 size={12}/> },
  declined:    { label: "Declined",          color: C.red,    bg: C.redSoft,    icon: <XCircle size={12}/> },
};

// Filter tabs — "scheduled" bucket covers accepted + in_progress
const FILTERS = [
  { id: "all",         label: "All Jobs" },
  { id: "pending",     label: "Awaiting" },
  { id: "scheduled",   label: "Scheduled · WIP" },
  { id: "completed",   label: "Completed" },
];

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
  scheduled_date: string;
  in_progress_at: string;
  homeowner_email: string;
}

function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: C.cream2, border: `1px solid ${C.line2}`,
      borderRadius: 9, padding: "4px 4px 4px 14px",
    }}>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 11.5, color: C.blue,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        fontFamily: "monospace",
      }}>{url}</span>
      <button onClick={copy} style={{
        appearance: "none", cursor: "pointer", border: `1px solid ${C.line}`,
        background: C.paper, padding: "6px 14px", borderRadius: 7,
        fontSize: 12, fontWeight: 600, color: copied ? C.green : C.ink2,
        flexShrink: 0, whiteSpace: "nowrap",
      }}>{copied ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}

function StatusContext({ job }: { job: Job }) {
  const st = STATUS_MAP[job.status];
  if (job.status === "accepted" && job.contractor_name) {
    const schedDate = job.scheduled_date
      ? new Date(job.scheduled_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.blueSoft + "66", borderRadius: 10, border: `1px solid ${C.blue}22` }}>
        <span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Scheduled</span>
        <span style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>{job.contractor_name}</span>
        {schedDate && <span style={{ fontSize: 12, color: C.ink2, marginLeft: "auto", whiteSpace: "nowrap" }}>{schedDate}</span>}
        {job.contractor_phone && (
          <a href={`tel:${job.contractor_phone}`} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.blue, textDecoration: "none", fontWeight: 600, flexShrink: 0 }}>
            <Phone size={12}/> Call
          </a>
        )}
      </div>
    );
  }
  if (job.status === "in_progress" && job.contractor_name) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.yellowSoft + "99", borderRadius: 10, border: `1px solid ${C.yellow}44` }}>
        <span style={{ fontSize: 11, color: "#A07B1F", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>In Progress</span>
        <span style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>{job.contractor_name}</span>
        {job.in_progress_at && <span style={{ fontSize: 12, color: C.ink2, marginLeft: "auto", whiteSpace: "nowrap" }}>started {new Date(job.in_progress_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
        {job.contractor_phone && (
          <a href={`tel:${job.contractor_phone}`} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.blue, textDecoration: "none", fontWeight: 600, flexShrink: 0 }}>
            <Phone size={12}/> Call
          </a>
        )}
      </div>
    );
  }
  if (job.status === "completed" && job.contractor_name) {
    const doneDate = job.accepted_at
      ? new Date(job.accepted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.greenSoft + "99", borderRadius: 10, border: `1px solid ${C.green}33` }}>
        <span style={{ fontSize: 11, color: C.green, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Completed</span>
        <span style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>{job.contractor_name}</span>
        {doneDate && <span style={{ fontSize: 12, color: C.ink2, marginLeft: "auto", whiteSpace: "nowrap" }}>{doneDate}</span>}
      </div>
    );
  }
  return null;
}

function JobCard({ job, onDelete }: { job: Job; onDelete: (id: string) => void }) {
  const st = STATUS_MAP[job.status] ?? STATUS_MAP.pending;
  const jobUrl = typeof window !== "undefined"
    ? `${window.location.origin}/job/${job.id}`
    : `https://btlrai.com/job/${job.id}`;
  const submittedDate = new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <article style={{
      background: C.paper, border: `1px solid ${C.line}`,
      borderRadius: 12, overflow: "hidden",
    }}>
      {/* Top row */}
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {/* Trade icon */}
        <div style={{ width: 40, height: 40, borderRadius: 10, background: C.navy, display: "grid", placeItems: "center", flexShrink: 0 }}>
          {getTradeIcon(job.trade, 18, "white")}
        </div>
        {/* Trade + date */}
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>{job.trade}</div>
          <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 2 }}>Submitted {submittedDate}</div>
        </div>
        {/* Status + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8,
            background: st.bg, color: st.color,
            fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
          }}>
            {st.icon} {st.label}
          </span>
          <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 12px", borderRadius: 8,
            background: C.paper, border: `1px solid ${C.line}`,
            color: C.ink2, fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
          }}>
            <ExternalLink size={11}/> Job Link
          </a>
          <button onClick={() => onDelete(job.id)} aria-label="Delete job" style={{
            appearance: "none", cursor: "pointer",
            width: 32, height: 32, borderRadius: 8,
            background: C.paper, border: `1px solid ${C.line}`,
            color: C.red, display: "grid", placeItems: "center", flexShrink: 0,
          }}>
            <Trash2 size={13}/>
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Issue */}
        <p style={{ margin: 0, fontSize: 13.5, color: C.ink2, lineHeight: 1.55 }}>{job.issue_summary}</p>

        {/* Cost estimate */}
        {job.estimated_cost_low ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <DollarSign size={13} color={C.ink3}/>
            <span style={{ fontSize: 12, color: C.ink3, fontWeight: 500 }}>
              Est. ${job.estimated_cost_low.toLocaleString()} – ${job.estimated_cost_high.toLocaleString()}
            </span>
          </div>
        ) : null}

        {/* Status context (contractor info, schedule, etc.) */}
        <StatusContext job={job}/>

        {/* Shareable link */}
        <CopyField url={jobUrl}/>
      </div>
    </article>
  );
}

export default function MyJobsView() {
  const [jobs, setJobs]             = useState<Job[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]         = useState("all");
  const userIdRef                   = useRef<string | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      loadJobs(uid);

      if (!uid) return;

      channel = supabase
        .channel("my-jobs")
        .on("postgres_changes", { event: "*", schema: "public", table: "job_requests" }, () => loadJobs(uid))
        .subscribe();
    });

    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  async function loadJobs(uid?: string | null) {
    const filterUid = uid ?? userIdRef.current;
    if (!filterUid) { setLoading(false); return; }

    const { data } = await supabase
      .from("job_requests")
      .select("*")
      .eq("user_id", filterUid)
      .order("created_at", { ascending: false });

    setJobs(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function deleteJob(jobId: string) {
    if (!confirm("Remove this job request? This cannot be undone.")) return;
    const { error } = await supabase.from("job_requests").delete().eq("id", jobId);
    if (error) { alert("Could not delete job: " + error.message); return; }
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadJobs(userIdRef.current);
  }

  const counts = {
    all:       jobs.length,
    pending:   jobs.filter(j => j.status === "pending").length,
    scheduled: jobs.filter(j => j.status === "accepted" || j.status === "in_progress").length,
    completed: jobs.filter(j => j.status === "completed").length,
  };

  const visible = jobs.filter(j => {
    if (filter === "all")       return true;
    if (filter === "scheduled") return j.status === "accepted" || j.status === "in_progress";
    return j.status === filter;
  });

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <Loader2 size={24} color={C.orange} className="animate-spin"/>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Filter tab strip */}
      <section style={{
        background: C.cream2, border: `1px solid ${C.line}`,
        borderRadius: 14, padding: 6,
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {FILTERS.map(f => {
            const active = filter === f.id;
            const count = counts[f.id as keyof typeof counts] ?? 0;
            const dot = f.id === "pending" ? C.orange : f.id === "scheduled" ? C.yellow : f.id === "completed" ? C.green : C.ink2;
            return (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                appearance: "none", cursor: "pointer",
                padding: "9px 14px", borderRadius: 10,
                background: active ? C.paper : "transparent",
                border: `1px solid ${active ? C.line : "transparent"}`,
                display: "inline-flex", alignItems: "center", gap: 8,
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0 }}/>
                <span style={{ fontSize: 13, fontWeight: 600, color: active ? C.ink : C.ink2 }}>{f.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: active ? C.ink2 : C.ink3 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={{
          appearance: "none", cursor: refreshing ? "default" : "pointer",
          background: C.paper, border: `1px solid ${C.line}`,
          padding: "8px 14px", borderRadius: 9,
          fontSize: 12.5, fontWeight: 600, color: C.ink,
          display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
          opacity: refreshing ? 0.6 : 1,
        }}>
          <RefreshCw size={12} style={refreshing ? { animation: "spin 0.8s linear infinite" } : {}}/> Refresh
        </button>
      </section>

      {/* Section heading */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
          {filter === "all" ? "All Jobs" : FILTERS.find(f => f.id === filter)?.label ?? "Jobs"}
        </span>
        <span style={{ fontSize: 11.5, color: C.ink3 }}>{visible.length} {visible.length === 1 ? "job" : "jobs"}</span>
      </div>

      {/* Empty state */}
      {visible.length === 0 ? (
        <div style={{ background: C.paper, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 48, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: C.cream2, border: `1px solid ${C.line}`, display: "grid", placeItems: "center" }}>
              <Briefcase size={22} color={C.ink3}/>
            </div>
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: "0 0 6px" }}>No jobs in this view</p>
          <p style={{ fontSize: 13, color: C.ink3, margin: 0 }}>
            {filter === "all" ? "Go to Vendors, describe an issue, and send your first job request." : "Try a different filter above."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {visible.map(j => <JobCard key={j.id} job={j} onDelete={deleteJob}/>)}
        </div>
      )}
    </div>
  );
}
