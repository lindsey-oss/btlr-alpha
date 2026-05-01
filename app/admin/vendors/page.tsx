"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

const C = {
  navy:    "#1B2D47", gold:  "#2C5F8A", goldDk: "#1E4568",
  text:    "#1C1914", muted: "#6B6558", dim: "#A09C92",
  surface: "#F7F2EC", border: "rgba(28,25,20,0.09)",
  white:   "#FFFFFF",
};
const DM = "'DM Sans', sans-serif";

type App = {
  id: string;
  business_name: string | null;
  owner_name: string | null;
  business_email: string | null;
  primary_specialty: string | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
  admin_score: number | null;
  years_in_business: number | null;
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: "Draft",            color: "#6B6558", bg: "#F7F2EC" },
  pending_review:   { label: "Pending Review",   color: "#92400E", bg: "#FEF3C7" },
  needs_more_info:  { label: "Needs More Info",  color: "#1E40AF", bg: "#DBEAFE" },
  approved:         { label: "Approved",         color: "#15803D", bg: "#DCFCE7" },
  rejected:         { label: "Rejected",         color: "#DC2626", bg: "#FEE2E2" },
  probationary:     { label: "Probationary",     color: "#7C3AED", bg: "#EDE9FE" },
};

const ALL_STATUSES = ["all", "pending_review", "needs_more_info", "approved", "probationary", "rejected", "draft"];

export default function AdminVendors() {
  const [authed, setAuthed]   = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [logging, setLogging] = useState(false);

  const [apps, setApps]           = useState<App[]>([]);
  const [loading, setLoading]     = useState(false);
  const [filter, setFilter]       = useState("pending_review");
  const [search, setSearch]       = useState("");

  // Check auth cookie on mount
  useEffect(() => {
    fetch("/api/admin/vendor-review", { method: "GET" })
      .then(r => {
        if (r.status === 405) { setAuthed(true); } // method not allowed = route exists = probably authed, fallback
        else setAuthed(false);
      })
      .catch(() => setAuthed(false));
    // Instead use a simple ping via the list API
    fetch("/api/admin/vendors/list")
      .then(r => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);

  const fetchApps = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/vendors/list");
      if (!r.ok) { setAuthed(false); return; }
      const { data } = await r.json();
      setApps(data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (authed) fetchApps(); }, [authed]);

  const handleLogin = async () => {
    setLogging(true); setLoginErr("");
    try {
      const r = await fetch("/api/admin/vendor-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) { setAuthed(true); }
      else { setLoginErr("Incorrect password"); }
    } finally { setLogging(false); }
  };

  const filtered = apps.filter(a => {
    const matchStatus = filter === "all" || a.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q
      || a.business_name?.toLowerCase().includes(q)
      || a.owner_name?.toLowerCase().includes(q)
      || a.business_email?.toLowerCase().includes(q)
      || a.primary_specialty?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  // ── Login gate ──
  if (authed === null) return (
    <div style={{ minHeight: "100vh", background: C.surface, display: "flex", alignItems: "center", justifyContent: "center" }} />
  );

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, padding: "48px 40px", width: 380, borderRadius: 4 }}>
        <div style={{ marginBottom: 32 }}>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 800, color: C.gold, letterSpacing: "0.14em" }}>BTLR</span>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "12px 0 4px" }}>Admin Login</h1>
          <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>Vendor Application Dashboard</p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="Enter admin password"
            style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 14, fontFamily: "'Inter', sans-serif", boxSizing: "border-box" }}
          />
          {loginErr && <p style={{ color: "#DC2626", fontSize: 13, marginTop: 6 }}>{loginErr}</p>}
        </div>
        <button
          onClick={handleLogin}
          disabled={logging || !password}
          style={{ width: "100%", padding: "12px", background: C.gold, color: "#fff", border: "none", borderRadius: 3, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: logging ? 0.7 : 1 }}
        >
          {logging ? "Signing in…" : "Sign In"}
        </button>
      </div>
    </div>
  );

  // ── Counts for filter tabs ──
  const counts = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = s === "all" ? apps.length : apps.filter(a => a.status === s).length;
    return acc;
  }, {});

  return (
    <div style={{ minHeight: "100vh", background: C.surface, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: C.navy, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Link href="/" style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 800, color: C.gold, letterSpacing: "0.14em", textDecoration: "none" }}>BTLR</Link>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 18 }}>|</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>Vendor Applications</span>
        </div>
        <button onClick={fetchApps} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", padding: "7px 16px", borderRadius: 3, cursor: "pointer", fontSize: 13 }}>
          Refresh
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        {/* Search */}
        <div style={{ marginBottom: 24 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by business name, owner, email, or specialty…"
            style={{ width: "100%", padding: "11px 16px", border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 14, fontFamily: "'Inter', sans-serif", background: C.white, boxSizing: "border-box" }}
          />
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          {ALL_STATUSES.map(s => {
            const meta = s === "all" ? { label: "All", color: C.gold, bg: "#E8F0F8" } : STATUS_LABEL[s];
            const active = filter === s;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 20,
                  border: active ? `2px solid ${meta.color}` : `1px solid ${C.border}`,
                  background: active ? meta.bg : C.white,
                  color: active ? meta.color : C.muted,
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {meta.label}
                <span style={{ background: active ? meta.color : C.border, color: active ? "#fff" : C.muted, borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>
                  {counts[s] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>Loading applications…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>
            No applications {filter !== "all" ? `with status "${STATUS_LABEL[filter]?.label ?? filter}"` : ""} found.
          </div>
        ) : (
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#F7F2EC", borderBottom: `2px solid ${C.border}` }}>
                  {["Business", "Owner", "Specialty", "Submitted", "Score", "Status", ""].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 12, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => {
                  const meta = STATUS_LABEL[a.status] ?? { label: a.status, color: C.muted, bg: C.surface };
                  return (
                    <tr key={a.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? C.white : "#FDFAF7" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: C.text }}>
                        {a.business_name || <span style={{ color: C.dim, fontStyle: "italic" }}>Unnamed</span>}
                      </td>
                      <td style={{ padding: "14px 16px", color: C.muted }}>{a.owner_name || "—"}</td>
                      <td style={{ padding: "14px 16px", color: C.muted }}>{a.primary_specialty || "—"}</td>
                      <td style={{ padding: "14px 16px", color: C.dim, fontSize: 13 }}>
                        {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : <span style={{ fontStyle: "italic" }}>Draft</span>}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        {a.admin_score != null
                          ? <span style={{ fontWeight: 700, color: a.admin_score >= 70 ? "#15803D" : a.admin_score >= 50 ? "#92400E" : "#DC2626" }}>{a.admin_score}/100</span>
                          : <span style={{ color: C.dim }}>—</span>}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={{ background: meta.bg, color: meta.color, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                          {meta.label}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <Link href={`/admin/vendors/${a.id}`} style={{ color: C.gold, fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                          Review →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ color: C.dim, fontSize: 12, marginTop: 16 }}>
          {filtered.length} application{filtered.length !== 1 ? "s" : ""} shown
        </p>
      </div>
    </div>
  );
}
