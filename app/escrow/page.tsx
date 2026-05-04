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

export default function EscrowPage() {
  return (
    <div style={{ fontFamily: OUTFIT, color: C.text }}>
      {/* Navigation */}
      <nav
        style={{
          backgroundColor: C.bg,
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 64px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              color: C.navy,
              fontWeight: 800,
              fontSize: 22,
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
            }}
          >
            For Escrow & Title
          </div>
        </div>
        <a
          href="#register"
          style={{
            backgroundColor: C.gold,
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
          backgroundColor: C.navy,
          padding: "120px 64px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 20,
            }}
          >
            For Escrow & Title
          </div>
          <h1
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "clamp(36px, 5vw, 68px)",
              fontWeight: 300,
              color: "white",
              lineHeight: 1.1,
              marginBottom: 20,
              margin: 0,
            }}
          >
            The closing table is just the beginning.
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
            }}
          >
            BTLR turns the inspection report your buyers already have into a
            Home Health Score with a personalized action plan. You become part
            of their Home Team — the escrow professional who gave them more than
            a smooth closing.
          </p>
          <a
            href="#register"
            style={{
              backgroundColor: C.gold,
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
          backgroundColor: C.surface,
          padding: "100px 64px",
          margin: "0 auto",
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 34,
              fontWeight: 300,
              marginBottom: 28,
              lineHeight: 1.3,
            }}
          >
            You're the most trusted person in the room — and the first one
            forgotten.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            Escrow officers and title professionals sit at the center of the
            biggest financial transaction most people will ever make. Buyers
            trust you with their money, their documents, their timeline. You
            handle the stress so they don't have to.
          </p>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            Then the transaction closes. And you vanish from their life. The
            agent gets the thank-you card. The lender gets the refi call. You
            get nothing — until the next transaction, when you have to earn
            trust all over again.
          </p>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            BTLR changes that. You hand your buyers a tool at closing that
            keeps your name in their home for years.
          </p>
        </div>
      </section>

      {/* Two Highlighted Benefits */}
      <section
        style={{
          backgroundColor: "white",
          padding: "80px 64px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
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
              backgroundColor: C.surface,
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
              style={{ marginBottom: 16 }}
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <h3
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 22,
                fontWeight: 700,
                color: C.text,
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              A post-closing relationship that actually sticks
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your buyer signs up through your referral link, you're
              automatically placed in their BTLR Home Team — your name and
              company front and center in the tool they use every time they
              manage their home. No other escrow company is doing this. You
              become the professional who cared enough to stay.
            </p>
          </div>

          {/* Card B */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              padding: "48px 40px",
              backgroundColor: C.surface,
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
              style={{ marginBottom: 16 }}
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <h3
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 22,
                fontWeight: 700,
                color: C.text,
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              Get notified when past clients are active
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your past buyers search for a vendor, request a repair
              estimate, or ask BTLR for help — you have visibility into the
              moments that signal another transaction. When they buy their next
              home, you're not a cold call. You're the escrow officer who's been
              with them since day one.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section
        style={{
          backgroundColor: C.navy,
          padding: "100px 64px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              marginBottom: 16,
            }}
          >
            How It Works
          </div>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              color: "white",
              fontSize: 36,
              fontWeight: 300,
              textAlign: "center",
              marginBottom: 0,
              marginTop: 0,
            }}
          >
            Three steps to a permanent post-closing relationship.
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 48,
            marginTop: 64,
            maxWidth: 1100,
            margin: "64px auto 0",
          }}
        >
          {/* Step 1 */}
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
                backgroundColor: "transparent",
                borderRadius: "50%",
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
                marginTop: 0,
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
              your name and company.
            </p>
          </div>

          {/* Step 2 */}
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
                backgroundColor: "transparent",
                borderRadius: "50%",
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
                marginTop: 0,
              }}
            >
              Include it in your closing communication.
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
              Add your BTLR link to the closing email, the signing appointment,
              or your post-close follow-up. When the buyer signs up, you're in
              their Home Team.
            </p>
          </div>

          {/* Step 3 */}
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
                backgroundColor: "transparent",
                borderRadius: "50%",
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
                marginTop: 0,
              }}
            >
              Stay present in their homeownership journey.
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
              Every time they check their score, track a repair, or look up a
              vendor, your name and company are right there.
            </p>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section
        style={{
          backgroundColor: "white",
          padding: "100px 64px",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 36,
              fontWeight: 300,
              marginBottom: 48,
              marginTop: 0,
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
                backgroundColor: C.surface,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: C.gold,
                  marginBottom: 16,
                }}
              />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  display: "block",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                The ultimate closing differentiator
              </span>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Compete on service, not just fees. BTLR is the value-add that
                makes your closing packet memorable.
              </p>
            </div>

            {/* Card 2 */}
            <div
              style={{
                padding: "36px 32px",
                border: `1px solid ${C.border}`,
                backgroundColor: C.surface,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: C.gold,
                  marginBottom: 16,
                }}
              />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  display: "block",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Repeat business you didn't have to work for
              </span>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                When your past clients buy again, you're already in their Home
                Team. The relationship is pre-built.
              </p>
            </div>

            {/* Card 3 */}
            <div
              style={{
                padding: "36px 32px",
                border: `1px solid ${C.border}`,
                backgroundColor: C.surface,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: C.gold,
                  marginBottom: 16,
                }}
              />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  display: "block",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Visibility into client activity
              </span>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Know which clients are engaged with their home. When they're
                active, the door is open.
              </p>
            </div>

            {/* Card 4 */}
            <div
              style={{
                padding: "36px 32px",
                border: `1px solid ${C.border}`,
                backgroundColor: C.surface,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: C.gold,
                  marginBottom: 16,
                }}
              />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  display: "block",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Zero cost. Zero obligation.
              </span>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Free for your buyers during beta. Your referral link is free
                forever.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Registration CTA */}
      <section
        id="register"
        style={{
          backgroundColor: C.surface2,
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
            marginTop: 0,
          }}
        >
          Be the escrow officer they never forget.
        </h2>
        <p
          style={{
            fontSize: 16,
            color: C.muted,
            marginBottom: 40,
            marginTop: 0,
          }}
        >
          Create your BTLR affiliate account. Get your unique referral link in
          60 seconds.
        </p>
        <Link
          href="/affiliate"
          style={{
            backgroundColor: C.gold,
            color: "white",
            padding: "18px 48px",
            fontSize: 15,
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-block",
            borderRadius: 4,
          }}
        >
          Create Your Free Affiliate Account
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          backgroundColor: C.navy,
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
            display: "flex",
            justifyContent: "center",
            gap: 32,
            marginTop: 12,
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
        <div
          style={{
            color: "rgba(255,255,255,0.3)",
            fontSize: 12,
            marginTop: 16,
          }}
        >
          © 2026 BTLR
        </div>
      </footer>
    </div>
  );
}
