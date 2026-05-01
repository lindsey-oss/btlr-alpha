import Link from "next/link";

export const metadata = {
  title: "Join the BTLR Trusted Network — Apply",
  description: "Apply to become a screened, trusted home service professional on the BTLR platform.",
};

const C = {
  text:   "#1C1914",
  muted:  "#6B6558",
  gold:   "#2C5F8A",
  goldDk: "#1E4568",
  goldDim:"rgba(44,95,138,.08)",
  border: "rgba(28,25,20,0.08)",
  borderGold: "rgba(44,95,138,0.22)",
  surface:"#F7F2EC",
  bg:     "#FFFFFF",
};

const INTER = "'Inter', sans-serif";
// OUTFIT replaced by Inter
// DM replaced by Inter

const CRITERIA = [
  { n: "01", title: "Valid Licensing & Insurance", body: "Every vendor must carry current state licensing, general liability insurance, and workers' compensation where applicable. No exceptions." },
  { n: "02", title: "Verified References", body: "We contact all three client references provided in your application. We also review your Google, Yelp, and BBB profiles directly." },
  { n: "03", title: "Demonstrated Work Quality", body: "Applicants submit photos of completed jobs and written project examples. We look for quality, not just volume." },
  { n: "04", title: "Communication Standards", body: "BTLR homeowners expect prompt, professional responses. We screen for communication habits, not just technical skill." },
  { n: "05", title: "Long-Term Fit", body: "We ask why you want to join BTLR. We're building lasting relationships between homeowners and professionals — not a lead marketplace." },
];

const PROCESS = [
  { step: "1", title: "Submit Application", body: "Complete our 9-step application. Save your progress and return at any time — the form auto-saves." },
  { step: "2", title: "Document Verification", body: "Our team reviews your license, insurance certificates, and references within 5–7 business days." },
  { step: "3", title: "Decision", body: "You'll receive an email with our decision. If approved, you'll be onboarded to the BTLR platform." },
];

export default function ApplyPage() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: INTER, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;600&family=Outfit:wght@300;700;800&family=Syne:wght@600;700;800&display=swap');
        @media(max-width:768px){
          .apply-nav-label{display:none !important}
          .apply-hero{grid-template-columns:1fr !important;gap:40px !important;padding:80px 24px 56px !important}
          .apply-stats{flex-direction:column !important;gap:0 !important}
          .apply-criteria{grid-template-columns:1fr !important}
          .apply-process{grid-template-columns:1fr !important;gap:20px !important}
          .apply-section-pad{padding:64px 24px !important}
          .apply-cta{padding:64px 24px !important}
          .apply-footer{padding:20px 24px !important;flex-direction:column !important;gap:12px !important;align-items:flex-start !important}
          .apply-nav{padding:16px 20px !important}
        }
      `}</style>

      {/* Nav */}
      <nav className="apply-nav" style={{ padding: "20px 48px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.96)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" }}>
        <Link href="/" style={{ fontFamily: INTER, fontSize: 18, fontWeight: 800, letterSpacing: "0.14em", color: C.gold, textDecoration: "none" }}>BTLR</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span className="apply-nav-label" style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted }}>Trusted Network Application</span>
          <Link href="/dashboard" style={{ fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, textDecoration: "none" }}>Homeowner Login</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="apply-hero" style={{ padding: "100px 48px 80px", maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.goldDim, border: `1px solid ${C.borderGold}`, padding: "6px 14px", marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, display: "inline-block" }}/>
            <span style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.gold }}>By Application Only</span>
          </div>
          <h1 style={{ fontFamily: INTER, fontSize: "clamp(34px,4vw,58px)", fontWeight: 300, lineHeight: 1.1, marginBottom: 12, letterSpacing: "-0.02em" }}>
            Join the BTLR<br/><strong style={{ fontWeight: 800, color: C.gold }}>Trusted Network.</strong>
          </h1>
          <p style={{ fontSize: 17, fontWeight: 300, color: C.muted, lineHeight: 1.8, marginBottom: 32, maxWidth: 480 }}>
            BTLR connects homeowners with screened, professional home service contractors. We curate — we don't aggregate. Not all applicants are accepted.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/apply/form" style={{ fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 36px", background: C.gold, color: "#fff", textDecoration: "none", display: "inline-block" }}>
              Start Application →
            </Link>
            <a href="#how-it-works" style={{ fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 24px", color: C.muted, textDecoration: "none", border: `1px solid ${C.border}`, display: "inline-block" }}>
              See How It Works
            </a>
          </div>
        </div>
        <div className="apply-stats" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { label: "Application Steps", value: "9" },
            { label: "Review Turnaround", value: "5–7 days" },
            { label: "Acceptance Rate", value: "Selective" },
            { label: "Marketplace Fees", value: "None" },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", background: C.surface, border: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted }}>{label}</span>
              <span style={{ fontFamily: INTER, fontSize: 22, fontWeight: 700, color: C.gold }}>{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* What We Look For */}
      <section className="apply-section-pad" style={{ background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: "100px 48px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 60 }}>
            <div style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 1, background: C.gold, display: "inline-block" }}/>
              Our Standards
            </div>
            <h2 style={{ fontFamily: INTER, fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
              What we look for in<br/><strong style={{ fontWeight: 700 }}>every applicant.</strong>
            </h2>
          </div>
          <div className="apply-criteria" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2 }}>
            {CRITERIA.map(({ n, title, body }) => (
              <div key={n} style={{ background: "#fff", padding: "32px 28px", border: `1px solid ${C.border}`, borderTop: `2px solid ${C.gold}` }}>
                <div style={{ fontFamily: INTER, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: C.gold, marginBottom: 16, opacity: 0.6 }}>{n}</div>
                <div style={{ fontFamily: INTER, fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12, letterSpacing: "0.02em" }}>{title}</div>
                <div style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.75 }}>{body}</div>
              </div>
            ))}
            <div style={{ background: C.gold, padding: "32px 28px", border: `1px solid ${C.gold}`, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: INTER, fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Not your typical contractor marketplace.</div>
                <div style={{ fontSize: 14, fontWeight: 300, color: "rgba(255,255,255,.82)", lineHeight: 1.75 }}>We don't sell leads. We build long-term homeowner relationships — and we protect them.</div>
              </div>
              <Link href="/apply/form" style={{ marginTop: 28, fontFamily: INTER, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
                Apply Now →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="apply-section-pad" style={{ padding: "100px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 60, textAlign: "center" }}>
          <div style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold, marginBottom: 12 }}>Process</div>
          <h2 style={{ fontFamily: INTER, fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            How the application<br/><strong style={{ fontWeight: 700 }}>process works.</strong>
          </h2>
        </div>
        <div className="apply-process" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 40 }}>
          {PROCESS.map(({ step, title, body }) => (
            <div key={step} style={{ textAlign: "center", padding: "40px 28px", border: `1px solid ${C.border}` }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.goldDim, border: `1px solid ${C.borderGold}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontFamily: INTER, fontSize: 14, fontWeight: 800, color: C.gold }}>{step}</div>
              <div style={{ fontFamily: INTER, fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>{title}</div>
              <div style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.75 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Strip */}
      <section className="apply-cta" style={{ background: "#1B2D47", padding: "80px 48px", textAlign: "center" }}>
        <p style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,.45)", marginBottom: 16 }}>Ready to apply?</p>
        <h2 style={{ fontFamily: INTER, fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 300, color: "#EDE9DC", lineHeight: 1.15, marginBottom: 8, letterSpacing: "-0.02em" }}>
          Built for professionals who take<br/><strong style={{ fontWeight: 700 }}>homeownership seriously.</strong>
        </h2>
        <p style={{ fontSize: 15, color: "rgba(237,233,220,.6)", marginBottom: 36, fontWeight: 300 }}>The application takes 20–30 minutes. Save your progress and return anytime.</p>
        <Link href="/apply/form" style={{ fontFamily: INTER, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "18px 44px", background: C.gold, color: "#fff", textDecoration: "none", display: "inline-block" }}>
          Start Your Application
        </Link>
        <p style={{ fontSize: 12, color: "rgba(237,233,220,.4)", marginTop: 20, fontFamily: INTER, letterSpacing: "0.08em" }}>Applying does not guarantee acceptance into the BTLR Trusted Network.</p>
      </section>

      {/* Footer */}
      <footer className="apply-footer" style={{ padding: "28px 48px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontFamily: INTER, fontSize: 13, fontWeight: 800, color: C.gold }}>BTLR</span>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/privacy" style={{ fontSize: 12, color: C.muted, textDecoration: "none" }}>Privacy</Link>
          <Link href="/terms" style={{ fontSize: 12, color: C.muted, textDecoration: "none" }}>Terms</Link>
          <Link href="mailto:support@btlrai.com" style={{ fontSize: 12, color: C.muted, textDecoration: "none" }}>support@btlrai.com</Link>
        </div>
      </footer>
    </div>
  );
}
