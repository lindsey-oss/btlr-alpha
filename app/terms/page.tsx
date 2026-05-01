import Link from "next/link";

const text  = "#0f172a";
const text2 = "#475569";
const text3 = "#94a3b8";
const accent = "#2563eb";
const border = "#e2e8f0";
const bg = "#f8fafc";

export const metadata = {
  title: "Terms of Service — BTLR",
  description: "Terms governing your use of the BTLR platform.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: text, margin: "0 0 12px", paddingBottom: 10, borderBottom: `1px solid ${border}` }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 16, color: text2, lineHeight: 1.75, margin: "0 0 12px" }}>{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: "8px 0 12px", paddingLeft: 24 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 16, color: text2, lineHeight: 1.75, marginBottom: 4 }}>{item}</li>
      ))}
    </ul>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#fffbeb", border: `1px solid #fde68a`, borderRadius: 10, padding: "12px 16px", margin: "12px 0" }}>
      <p style={{ fontSize: 14, color: "#92400e", margin: 0, lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Inter', sans-serif" }}>

      {/* Nav */}
      <nav style={{ padding: "16px 32px", borderBottom: `1px solid ${border}`, background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "white", fontSize: 13, fontWeight: 800 }}>B</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: text }}>BTLR</span>
        </Link>
        <Link href="/privacy" style={{ fontSize: 14, color: accent, textDecoration: "none", fontWeight: 600 }}>Privacy Policy →</Link>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 740, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: text, margin: "0 0 8px", letterSpacing: "-0.5px" }}>Terms of Service</h1>
          <p style={{ fontSize: 15, color: text3, margin: 0 }}>Effective: April 23, 2026 · btlrai.com</p>
          <p style={{ fontSize: 16, color: text2, marginTop: 16, lineHeight: 1.75 }}>
            These terms cover your use of BTLR. We&apos;ve written them to be readable, not just legally defensible.
          </p>
        </div>

        <Section title="1. What BTLR Is">
          <P>BTLR (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) is a home management platform that helps homeowners understand their property through AI-powered document analysis, health scoring, vendor routing, and financial data integration.</P>
          <P>BTLR provides information and tools — it is not a licensed home inspector, contractor, financial advisor, or insurance agent.</P>
        </Section>

        <Section title="2. Your Account">
          <UL items={[
            "You must be 18 or older and a legal resident of the United States to use BTLR",
            "You are responsible for keeping your login credentials secure",
            "One account per person — do not share accounts",
            "You are responsible for all activity that occurs under your account",
            "Notify us immediately at btlr.info@gmail.com if you suspect unauthorized access",
          ]} />
        </Section>

        <Section title="3. What You Can Do">
          <P>With BTLR you may:</P>
          <UL items={[
            "Upload your own home documents (inspections, insurance, mortgages)",
            "Use AI analysis for personal home management purposes",
            "Connect your bank account to view financial data",
            "Find and contact contractors for legitimate home repair needs",
          ]} />
        </Section>

        <Section title="4. What You Cannot Do">
          <UL items={[
            "Upload documents you don't have the right to share",
            "Use BTLR for any illegal purpose",
            "Attempt to reverse engineer, scrape, or exploit the platform",
            "Impersonate another person or create fake accounts",
            "Use BTLR to harass, defraud, or harm contractors or other users",
          ]} />
        </Section>

        <Section title="5. AI Limitations — Important">
          <P>BTLR uses AI to analyze your documents and generate estimates. You acknowledge:</P>
          <UL items={[
            "AI analysis may contain errors, omissions, or inaccuracies",
            "Cost estimates are approximations, not quotes",
            "Health scores are indicators, not professional assessments",
            "Nothing in BTLR constitutes licensed home inspection, legal, financial, or insurance advice",
            "Always get professional opinions before making significant home decisions",
          ]} />
          <Note>For any repair costing over $1,000 or involving structural, electrical, or plumbing systems, consult a licensed professional directly.</Note>
        </Section>

        <Section title="6. Vendor Recommendations">
          <P>When BTLR suggests contractors or links to Google Maps, Yelp, or Angi:</P>
          <UL items={[
            "We do not endorse, vet, or guarantee any contractor",
            "We are not a party to any agreement between you and a contractor",
            "We are not responsible for the quality, timeliness, or safety of contractor work",
            "Always verify licenses and insurance before hiring anyone",
          ]} />
        </Section>

        <Section title="7. Financial Data (Plaid)">
          <P>If you connect your bank account:</P>
          <UL items={[
            "BTLR provides a read-only view of your financial data for informational purposes",
            "We do not initiate transfers, payments, or any financial transactions",
            "You are solely responsible for financial decisions based on information shown",
            "BTLR is not a bank, financial institution, or registered investment advisor",
          ]} />
        </Section>

        <Section title="8. Your Content">
          <P>You own the documents and data you upload. By uploading them, you grant BTLR a limited license to process and analyze that content to provide the service. We do not claim ownership of your documents.</P>
          <P>You represent that you have the right to upload all content you provide.</P>
        </Section>

        <Section title="9. Service Availability">
          <P>BTLR is an early-stage product. We work hard to keep it running but cannot guarantee 100% uptime. We may:</P>
          <UL items={[
            "Perform maintenance that temporarily interrupts service",
            "Change, add, or remove features",
            "Discontinue the service with reasonable notice",
          ]} />
        </Section>

        <Section title="10. Limitation of Liability">
          <P>To the maximum extent permitted by law, BTLR is not liable for:</P>
          <UL items={[
            "Decisions you make based on AI-generated analysis",
            "Issues arising from contractor work found through BTLR",
            "Data loss due to technical failures",
            "Indirect, incidental, or consequential damages",
          ]} />
          <P>Our total liability to you for any claim is limited to the amount you paid us in the 12 months before the claim.</P>
        </Section>

        <Section title="11. Indemnification">
          <P>You agree to defend and hold BTLR harmless from claims arising out of your use of the service in violation of these terms or applicable law.</P>
        </Section>

        <Section title="12. Governing Law">
          <P>These terms are governed by the laws of California, United States. Any disputes will be resolved in the courts of San Diego County, California.</P>
        </Section>

        <Section title="13. Changes to These Terms">
          <P>We&apos;ll notify you by email at least 14 days before making material changes to these terms. Continued use after changes take effect means you accept the updated terms.</P>
        </Section>

        <Section title="14. Contact">
          <P>Questions about these terms? Email: <a href="mailto:btlr.info@gmail.com" style={{ color: accent }}>btlr.info@gmail.com</a></P>
        </Section>

      </main>

      {/* Footer */}
      <footer style={{ padding: "24px 32px", borderTop: `1px solid ${border}`, background: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: text3, margin: 0 }}>© 2026 BTLR. All rights reserved.</p>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/privacy" style={{ fontSize: 13, color: text3, textDecoration: "none" }}>Privacy Policy</Link>
          <Link href="/terms" style={{ fontSize: 13, color: accent, textDecoration: "none", fontWeight: 600 }}>Terms of Service</Link>
        </div>
      </footer>

    </div>
  );
}
