"use client";

import { useState } from "react";
import {
  X, ChevronRight, ChevronLeft, Activity, Upload,
  TrendingDown, Users, FileText, Wrench, CheckCircle2,
} from "lucide-react";

// ── Design tokens (mirrors dashboard) ─────────────────────────────────────
const C = {
  bg:       "#F7F2EC",
  surface:  "#FFFFFF",
  navy:     "#1B2D47",
  accent:   "#2C5F8A",
  accentLt: "#5C8FB8",
  accentBg: "rgba(44,95,138,0.08)",
  text:     "#1C1914",
  text2:    "#4A453E",
  text3:    "#6B6558",
  border:   "rgba(28,25,20,0.08)",
  green:    "#2D6A4F",
  greenBg:  "#F0FAF4",
};

// ── Step definitions ───────────────────────────────────────────────────────
interface Step {
  icon:    React.ReactNode;
  title:   string;
  body:    React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="12" fill={C.navy}/>
        <path d="M20 8L8 18V32H16V24H24V32H32V18L20 8Z" fill="white" opacity="0.9"/>
      </svg>
    ),
    title: "Welcome to BTLR",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          BTLR is your home's command center — a single place to understand your home's health, stay on top of repairs, and plan ahead with confidence.
        </p>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          This quick walkthrough covers the key parts of the app. It only takes a minute.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Activity size={22} color="white"/></div>,
    title: "Your Home Health Score",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          The <strong style={{ color: C.text }}>Home Health Score</strong> (0–100) reflects the overall condition of your home's key systems — things like the roof, electrical, plumbing, and HVAC.
        </p>
        <div style={{ background: C.accentBg, borderRadius: 10, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ margin: 0, fontSize: 13, color: C.accent, lineHeight: 1.6 }}>
            <strong>80–100</strong> — Good to Excellent &nbsp;·&nbsp; <strong>65–79</strong> — Fair &nbsp;·&nbsp; <strong>50–64</strong> — Needs Attention &nbsp;·&nbsp; <strong>0–49</strong> — Needs Work
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          Your score improves as you resolve findings and keep up with maintenance. Every home has a starting point — the score is there to guide you, not to judge you.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: "#0ea5e9", display: "flex", alignItems: "center", justifyContent: "center" }}><Upload size={20} color="white"/></div>,
    title: "Upload Your Inspection Report",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          BTLR reads your home inspection report and automatically extracts findings — no manual data entry required.
        </p>
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#0369a1" }}>How to upload</p>
          <p style={{ margin: 0, fontSize: 13, color: "#0c4a6e", lineHeight: 1.6 }}>
            Go to the <strong>Documents tab</strong> and tap <strong>Upload Inspection</strong>. BTLR accepts PDF reports from any licensed inspector.
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          After upload, your score and repair list update automatically. You can re-upload at any time — previous data is preserved.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center" }}><TrendingDown size={20} color="white"/></div>,
    title: "Track Your Repairs",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          The <strong style={{ color: C.text }}>Repairs tab</strong> turns your inspection findings into an actionable list, organized by system — roof, electrical, plumbing, and more.
        </p>
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#9a3412" }}>What you can do</p>
          <p style={{ margin: 0, fontSize: 13, color: "#7c2d12", lineHeight: 1.6 }}>
            Mark items as <strong>Completed</strong>, <strong>Monitoring</strong>, or <strong>Not Needed</strong>. Resolved items move to the archive and your score updates in real time.
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          Each item also shows an estimated cost range so you can plan and budget ahead.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={20} color="white"/></div>,
    title: "Find Trusted Vendors",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          The <strong style={{ color: C.text }}>Vendors tab</strong> connects you with service providers across four categories: Real Estate, Insurance, Maintenance, and Repair.
        </p>
        <div style={{ background: C.greenBg, border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: C.green }}>Store your contacts</p>
          <p style={{ margin: 0, fontSize: 13, color: "#14532d", lineHeight: 1.6 }}>
            Save your existing contractors, agents, and insurers for easy reference — or use BTLR to find new ones.
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          When a repair is flagged, BTLR can suggest the right vendor category so you always know who to call.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: "#8b5cf6", display: "flex", alignItems: "center", justifyContent: "center" }}><Wrench size={20} color="white"/></div>,
    title: "Stay Ahead with Maintenance",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          The <strong style={{ color: C.text }}>Maintenance tab</strong> gives you a proactive checklist of seasonal and recurring tasks to keep your home running well year-round.
        </p>
        <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#6d28d9" }}>Why it matters</p>
          <p style={{ margin: 0, fontSize: 13, color: "#4c1d95", lineHeight: 1.6 }}>
            Routine maintenance is the most effective way to protect your home's score and prevent small issues from becoming expensive ones.
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          Also in the <strong style={{ color: C.text }}>Documents tab</strong> — upload and store your warranties, insurance docs, and any past inspection reports.
        </p>
      </>
    ),
  },
  {
    icon: <div style={{ width: 40, height: 40, borderRadius: 12, background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><CheckCircle2 size={22} color="white"/></div>,
    title: "You're all set",
    body: (
      <>
        <p style={{ margin: "0 0 12px", fontSize: 15, color: C.text2, lineHeight: 1.6 }}>
          BTLR works best when it has your inspection report to work from. Start by uploading one in the <strong style={{ color: C.text }}>Documents tab</strong> — it takes less than a minute.
        </p>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: C.text3, lineHeight: 1.6 }}>
          Not ready yet? No problem. You can explore the dashboard anytime and come back to this guide via the <strong style={{ color: C.text }}>?</strong> button in the top-right corner.
        </p>
        <div style={{ background: C.accentBg, borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ margin: 0, fontSize: 13, color: C.accent, lineHeight: 1.6, fontWeight: 500 }}>
            Your home. Understood. — That's BTLR.
          </p>
        </div>
      </>
    ),
  },
];

// ── Component ──────────────────────────────────────────────────────────────
interface TutorialModalProps {
  open:    boolean;
  onClose: () => void;
}

export default function TutorialModal({ open, onClose }: TutorialModalProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current   = STEPS[step];
  const isFirst   = step === 0;
  const isLast    = step === STEPS.length - 1;
  const progress  = ((step + 1) / STEPS.length) * 100;

  function handleClose() {
    setStep(0); // reset for next open
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(15,25,40,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(2px)",
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        background: C.surface, borderRadius: 20,
        width: "100%", maxWidth: 480,
        boxShadow: "0 24px 80px rgba(15,31,61,0.28)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>

        {/* Progress bar */}
        <div style={{ height: 3, background: C.border }}>
          <div style={{
            height: "100%", background: C.accent,
            width: `${progress}%`,
            transition: "width 0.3s ease",
          }}/>
        </div>

        {/* Header */}
        <div style={{
          padding: "20px 24px 0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.09em" }}>
            Step {step + 1} of {STEPS.length}
          </p>
          <button
            onClick={handleClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4, display: "flex", alignItems: "center", borderRadius: 8 }}
            title="Close tutorial"
          >
            <X size={18}/>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px 24px", flex: 1 }}>
          {/* Icon + title */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
            <div style={{ flexShrink: 0 }}>{current.icon}</div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.25, paddingTop: 6 }}>
              {current.title}
            </h2>
          </div>

          {/* Body */}
          <div>{current.body}</div>
        </div>

        {/* Footer: dot nav + buttons */}
        <div style={{
          padding: "0 24px 22px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderTop: `1px solid ${C.border}`,
          paddingTop: 16,
        }}>
          {/* Step dots */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                style={{
                  width: i === step ? 20 : 7,
                  height: 7, borderRadius: 4,
                  background: i === step ? C.accent : i < step ? C.accentLt : C.border,
                  border: "none", cursor: "pointer",
                  padding: 0,
                  transition: "all 0.25s ease",
                }}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "8px 14px", borderRadius: 10,
                  background: C.bg, border: `1px solid ${C.border}`,
                  color: C.text2, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <ChevronLeft size={15}/> Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={handleClose}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "8px 18px", borderRadius: 10,
                  background: C.accent, border: "none",
                  color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Get Started
              </button>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "8px 18px", borderRadius: 10,
                  background: C.accent, border: "none",
                  color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Next <ChevronRight size={15}/>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
