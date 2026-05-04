"use client";

import Link from "next/link";

const C = {
  bg: "#FFFFFF",
  surface: "#F7F2EC",
  surface2: "#EDE5D4",
  gold: "#2C5F8A",
  goldDk: "#1E4568",
  goldLt: "#5C8FB8",
  goldDim: "rgba(44,95,138,.10)",
  navy: "#1B2D47",
  text: "#1C1914",
  muted: "#6B6558",
  dim: "#A09C92",
  border: "rgba(28,25,20,0.08)",
  borderGold: "rgba(44,95,138,0.22)",
};

const OUTFIT = "'Outfit', sans-serif";

export default function InsurancePage() {
  return (
    <div style={{ fontFamily: OUTFIT, color: C.text }}>
      {/* Nav */}
      <nav
        style={{
          background: C.bg,
          height: 64,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 64px",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 22,
              fontWeight: 800,
              color: C.navy,
              letterSpacing: "0.12em",
            }}
          >
            BTLR
          </div>
          <div
            style={{
              border: `1px solid ${C.gold}`,
              color: C.gold,
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 4,
              fontWeight: 700,
            }}
          >
            For Insurance Brokers
          </div>
        </div>
        <a
          href="#register"
          style={{
            background: C.gold,
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            padding: "10px 22px",
            borderRadius: 6,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Get Your Free Link
        </a>
      </nav>

      {/* Hero */}
      <section
        style={{
          background: C.navy,
          padding: "120px 64px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 20,
              display: "block",
            }}
          >
            For Insurance Brokers
          </span>
          <h1
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "clamp(34px, 4.5vw, 62px)",
              fontWeight: 300,
              color: "white",
              lineHeight: 1.1,
              marginBottom: 20,
              margin: "0 0 20px 0",
            }}
          >
            Your clients' biggest risk isn't their health — it's their home.
          </h1>
          <p
            style={{
              fontSize: 18,
              fontWeight: 300,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.8,
              maxWidth: 580,
              marginBottom: 44,
              display: "block",
              marginLeft: "auto",
              marginRight: "auto",
              margin: "0 auto 44px auto",
            }}
          >
            BTLR gives homeowners a Home Health Score and a proactive maintenance
            plan — powered by their actual inspection report. You stay connected
            as their trusted insurance advisor in their Home Team, for the life
            of the policy and beyond.
          </p>
          <a
            href="#register"
            style={{
              background: C.gold,
              color: "white",
              padding: "16px 40px",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-block",
              cursor: "pointer",
              borderRadius: 4,
            }}
          >
            Get Your Free Referral Link
          </a>
        </div>
      </section>

      {/* Problem Section */}
      <section
        style={{
          background: C.surface,
          padding: "100px 64px",
          maxWidth: 800,
          margin: "0 auto",
        }}
      >
        <h2
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 34,
            fontWeight: 300,
            marginBottom: 28,
            lineHeight: 1.3,
            margin: "0 0 28px 0",
          }}
        >
          You write the policy. Then you wait for a claim.
        </h2>
        <p
          style={{
            fontSize: 16,
            color: C.muted,
            lineHeight: 1.82,
            marginBottom: 16,
          }}
        >
          Your clients renew once a year — if they don't shop around first. Between
          renewals, their home is aging, systems are failing, and deferred
          maintenance is becoming future claims. You have no visibility into any of
          it.
        </p>
        <p
          style={{
            fontSize: 16,
            color: C.muted,
            lineHeight: 1.82,
            marginBottom: 16,
          }}
        >
          The claims that hurt most aren't catastrophic events. They're the
          slow-building failures — a roof that wasn't maintained, a water heater
          that was years overdue, an electrical panel that should have been
          flagged. BTLR catches those before they become claims.
        </p>
        <p
          style={{
            fontSize: 16,
            color: C.muted,
            lineHeight: 1.82,
            marginBottom: 16,
          }}
        >
          BTLR keeps you connected to the home — and the homeowner — year-round.
        </p>
      </section>

      {/* Two Highlighted Benefits */}
      <section
        style={{
          background: "white",
          padding: "80px 64px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 60,
          }}
        >
          {/* Card A */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              padding: "48px 40px",
              background: C.surface,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.gold}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <h3
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                color: C.text,
                marginBottom: 16,
                marginTop: 16,
                margin: "16px 0 16px 0",
              }}
            >
              Stay connected year-round — not just at renewal
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your clients sign up through your referral link, you're
              permanently placed in their BTLR Home Team — your name, company,
              and contact info in the tool they open every time they manage their
              home. You're not a policy number they remember once a year. You're
              their advisor.
            </p>
          </div>

          {/* Card B */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              padding: "48px 40px",
              background: C.surface,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.gold}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <h3
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                color: C.text,
                marginBottom: 16,
                marginTop: 16,
                margin: "16px 0 16px 0",
              }}
            >
              Get notified before a claim becomes a claim
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your clients flag a roof issue, report water damage, or ask BTLR
              about coverage for a specific repair — you'll know. BTLR gives you
              visibility into the moments that matter: when a maintenance issue is
              escalating and when your client might be picking up the phone.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section
        style={{
          background: C.navy,
          padding: "100px 64px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <span
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              marginBottom: 16,
              display: "block",
            }}
          >
            How It Works
          </span>
          <h2
            style={{
              color: "white",
              fontFamily: "'Inter', sans-serif",
              fontSize: 36,
              fontWeight: 300,
              textAlign: "center",
              margin: 0,
            }}
          >
            Three steps to a permanent client relationship.
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 48,
            marginTop: 64,
            maxWidth: 900,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {/* Step 01 */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: `1.5px solid ${C.gold}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Inter', sans-serif",
                fontSize: 18,
                fontWeight: 800,
                color: C.gold,
                margin: "0 auto 20px",
                background: "transparent",
              }}
            >
              01
            </div>
            <h3
              style={{
                color: "white",
                fontSize: 15,
                fontWeight: 700,
                textAlign: "center",
                marginBottom: 10,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 10px 0",
              }}
            >
              Register in 60 seconds.
            </h3>
            <p
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: 14,
                lineHeight: 1.72,
                textAlign: "center",
                margin: 0,
              }}
            >
              Fill out the form below. You'll get a unique referral link tied to
              your name and brokerage.
            </p>
          </div>

          {/* Step 02 */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: `1.5px solid ${C.gold}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Inter', sans-serif",
                fontSize: 18,
                fontWeight: 800,
                color: C.gold,
                margin: "0 auto 20px",
                background: "transparent",
              }}
            >
              02
            </div>
            <h3
              style={{
                color: "white",
                fontSize: 15,
                fontWeight: 700,
                textAlign: "center",
                marginBottom: 10,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 10px 0",
              }}
            >
              Share with clients when you write the policy.
            </h3>
            <p
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: 14,
                lineHeight: 1.72,
                textAlign: "center",
                margin: 0,
              }}
            >
              Include your BTLR link in your welcome email, your onboarding
              packet, or your renewal communication. When they sign up, you're
              automatically added to their Home Team.
            </p>
          </div>

          {/* Step 03 */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: `1.5px solid ${C.gold}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Inter', sans-serif",
                fontSize: 18,
                fontWeight: 800,
                color: C.gold,
                margin: "0 auto 20px",
                background: "transparent",
              }}
            >
              03
            </div>
            <h3
              style={{
                color: "white",
                fontSize: 15,
                fontWeight: 700,
                textAlign: "center",
                marginBottom: 10,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 10px 0",
              }}
            >
              Stay top-of-mind for every renewal and referral.
            </h3>
            <p
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: 14,
                lineHeight: 1.72,
                textAlign: "center",
                margin: 0,
              }}
            >
              Your client manages their home with your name right there. When
              their neighbor asks who their insurance broker is, the answer is
              easy to find.
            </p>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section
        style={{
          background: "white",
          padding: "100px 64px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <h2
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 36,
            fontWeight: 300,
            marginBottom: 48,
            margin: "0 0 48px 0",
          }}
        >
          What you get as a BTLR affiliate.
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 32,
          }}
        >
          {/* Card 1 */}
          <div
            style={{
              padding: "36px 32px",
              border: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                background: C.gold,
                marginBottom: 16,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 8px 0",
              }}
            >
              Persistent presence between renewals
            </h3>
            <p
              style={{
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              You're not just the person they call once a year. You're in the
              tool they open every time they manage their home.
            </p>
          </div>

          {/* Card 2 */}
          <div
            style={{
              padding: "36px 32px",
              border: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                background: C.gold,
                marginBottom: 16,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 8px 0",
              }}
            >
              Fewer surprises at renewal
            </h3>
            <p
              style={{
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              Clients who maintain their homes file fewer claims, stay on better
              rates, and renew more reliably. BTLR aligns your interests.
            </p>
          </div>

          {/* Card 3 */}
          <div
            style={{
              padding: "36px 32px",
              border: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                background: C.gold,
                marginBottom: 16,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 8px 0",
              }}
            >
              Referral visibility
            </h3>
            <p
              style={{
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              See which clients are active on BTLR. Engaged homeowners are more
              likely to refer. Dashboard coming soon.
            </p>
          </div>

          {/* Card 4 */}
          <div
            style={{
              padding: "36px 32px",
              border: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                background: C.gold,
                marginBottom: 16,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
                margin: "0 0 8px 0",
              }}
            >
              Zero cost. Zero obligation.
            </h3>
            <p
              style={{
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              Free for your clients during beta. Your referral link is free
              forever.
            </p>
          </div>
        </div>
      </section>

      {/* Registration CTA */}
      <section
        id="register"
        style={{
          background: C.surface2,
          padding: "100px 64px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 36,
            fontWeight: 300,
            marginBottom: 16,
            margin: "0 0 16px 0",
          }}
        >
          Be the insurance broker they never forget.
        </h2>
        <p
          style={{
            fontSize: 16,
            color: C.muted,
            marginBottom: 40,
            margin: "0 0 40px 0",
          }}
        >
          Create your BTLR affiliate account. Get your unique referral link in 60
          seconds.
        </p>
        <Link
          href="/affiliate"
          style={{
            background: C.gold,
            color: "white",
            padding: "18px 48px",
            fontSize: 15,
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-block",
            borderRadius: 4,
          }}
        >
          Get Started
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: C.navy,
          padding: "40px 64px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "'Syne', sans-serif",
            color: "white",
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "0.12em",
          }}
        >
          BTLR
        </div>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            justifyContent: "center",
            gap: 32,
          }}
        >
          <Link
            href="/"
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Home
          </Link>
          <Link
            href="/affiliate"
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Affiliate Sign Up
          </Link>
        </div>
        <p
          style={{
            color: "rgba(255,255,255,0.3)",
            fontSize: 12,
            marginTop: 16,
            margin: "16px 0 0 0",
          }}
        >
          © 2026 BTLR
        </p>
      </footer>
    </div>
  );
}
