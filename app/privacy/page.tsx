import Link from "next/link";

const text  = "#0f172a";
const text2 = "#475569";
const text3 = "#94a3b8";
const accent = "#2563eb";
const border = "#e2e8f0";
const bg = "#f8fafc";

export const metadata = {
  title: "Privacy Policy — BTLR",
  description: "How BTLR collects, uses, and protects your data.",
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
    <div style={{ background: "#eff6ff", border: `1px solid #bfdbfe`, borderRadius: 10, padding: "12px 16px", margin: "12px 0" }}>
      <p style={{ fontSize: 14, color: accent, margin: 0, lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Nav */}
      <nav style={{ padding: "16px 32px", borderBottom: `1px solid ${border}`, background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "white", fontSize: 13, fontWeight: 800 }}>B</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: text }}>BTLR</span>
        </Link>
        <Link href="/terms" style={{ fontSize: 14, color: accent, textDecoration: "none", fontWeight: 600 }}>Terms of Service →</Link>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 740, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: text, margin: "0 0 8px", letterSpacing: "-0.5px" }}>Privacy Policy</h1>
          <p style={{ fontSize: 15, color: text3, margin: 0 }}>Effective: April 23, 2026 · btlrai.com</p>
          <p style={{ fontSize: 16, color: text2, marginTop: 16, lineHeight: 1.75 }}>
            We built BTLR to help you understand and manage your home. Here&apos;s how we handle your data — plainly.
          </p>
        </div>

        <Section title="1. What We Collect">
          <p style={{ fontSize: 15, fontWeight: 600, color: text, margin: "0 0 6px" }}>Information you give us</p>
          <UL items={[
            "Name and email address when you sign up",
            "Property address",
            "Documents you upload: inspection reports, insurance policies, mortgage statements",
            "Photos of your home or issues",
            "Messages you type into the AI assistant",
          ]} />
          <p style={{ fontSize: 15, fontWeight: 600, color: text, margin: "12px 0 6px" }}>Information from connected services</p>
          <UL items={[
            "Bank account data via Plaid (only if you choose to connect your bank)",
            "Property data from third-party sources like ATTOM",
          ]} />
          <p style={{ fontSize: 15, fontWeight: 600, color: text, margin: "12px 0 6px" }}>Information we collect automatically</p>
          <UL items={[
            "Basic usage data: which features you use, how often",
            "Device type and browser (for compatibility)",
            "Error logs so we can fix bugs",
          ]} />
          <Note>We do not sell your data. Ever. We do not run ads. Your home documents are yours.</Note>
        </Section>

        <Section title="2. How We Use Your Information">
          <P>We use your information to:</P>
          <UL items={[
            "Provide the BTLR service — parse your documents, score your home, route you to contractors",
            "Improve the AI models that analyze your reports",
            "Send you emails you ask for (job briefs, summaries)",
            "Diagnose bugs and improve reliability",
            "Communicate with you about your account",
          ]} />
          <P>We do not use your data for advertising or share it with data brokers.</P>
        </Section>

        <Section title="3. Document Parsing & AI">
          <P>When you upload a PDF — inspection report, insurance policy, mortgage statement — we send the text to OpenAI&apos;s API to extract findings and summaries. This means:</P>
          <UL items={[
            "OpenAI processes your document text subject to their privacy policy",
            "We do not send your name, email, or address to OpenAI — only the document content",
            "AI-generated summaries are estimates, not professional advice",
          ]} />
          <Note>OpenAI privacy policy: openai.com/privacy</Note>
        </Section>

        <Section title="4. Bank Connection (Plaid)">
          <P>If you choose to connect your bank account, we use Plaid — a secure financial data service used by thousands of apps.</P>
          <UL items={[
            "Plaid connects directly to your bank using your bank's own login flow",
            "We never see or store your bank username or password",
            "We only access read-only data: mortgage balance, payment amount, due date",
            "We do not initiate any transactions or move any money",
            "You can disconnect your bank at any time in Settings",
          ]} />
          <Note>Plaid privacy policy: plaid.com/legal/privacy-policy</Note>
        </Section>

        <Section title="5. How We Store & Protect Your Data">
          <UL items={[
            "Your data is stored in Supabase, a secure cloud database with encryption at rest and in transit",
            "Documents are stored in encrypted cloud storage",
            "We use HTTPS for all data in transit",
            "Access to your data requires authentication",
            "We are an early-stage startup — we take security seriously but no system is 100% immune to breaches",
          ]} />
        </Section>

        <Section title="6. Sharing Your Data">
          <P>We share your data only in these situations:</P>
          <UL items={[
            "With OpenAI, to process document text (document content only, no personal identifiers)",
            "With Plaid, if you connect your bank (subject to Plaid's own policies)",
            "With service providers we use to operate BTLR (hosting, email delivery) — under confidentiality agreements",
            "If required by law or to protect the rights and safety of our users",
            "If BTLR is acquired, your data may transfer — we will notify you",
          ]} />
        </Section>

        <Section title="7. Your Rights">
          <UL items={[
            "Access: ask us what data we have about you",
            "Correction: ask us to fix inaccurate data",
            "Deletion: ask us to delete your account and data",
            "Export: ask for a copy of your data",
            "Disconnect bank: remove Plaid connection at any time in Settings",
          ]} />
          <P>To exercise any of these rights, email: <a href="mailto:privacy@btlrai.com" style={{ color: accent }}>privacy@btlrai.com</a></P>
        </Section>

        <Section title="8. Cookies & Tracking">
          <P>We use minimal cookies — only what&apos;s needed to keep you logged in and remember your preferences. We do not use advertising trackers or third-party analytics that sell your data.</P>
        </Section>

        <Section title="9. Children">
          <P>BTLR is not intended for users under 18. We do not knowingly collect data from minors. If you believe a minor has created an account, contact us and we will delete it.</P>
        </Section>

        <Section title="10. Changes to This Policy">
          <P>If we make significant changes, we&apos;ll notify you by email before they take effect. The &ldquo;Effective&rdquo; date at the top always reflects the most recent version.</P>
        </Section>

        <Section title="Contact">
          <P>Questions about your privacy? Email us: <a href="mailto:privacy@btlrai.com" style={{ color: accent }}>privacy@btlrai.com</a></P>
        </Section>

      </main>

      {/* Footer */}
      <footer style={{ padding: "24px 32px", borderTop: `1px solid ${border}`, background: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: text3, margin: 0 }}>© 2026 BTLR. All rights reserved.</p>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/privacy" style={{ fontSize: 13, color: accent, textDecoration: "none", fontWeight: 600 }}>Privacy Policy</Link>
          <Link href="/terms" style={{ fontSize: 13, color: text3, textDecoration: "none" }}>Terms of Service</Link>
        </div>
      </footer>

    </div>
  );
}
