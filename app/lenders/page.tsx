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

export default function LendersPage() {
  return (
    <div style={{ fontFamily: OUTFIT, color: C.text }}>
      {/* Nav */}
      <nav
        style={{
          backgroundColor: C.bg,
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 64px",
          height: 64,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxSizing: "border-box",
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
              borderRadius: 3,
              fontWeight: 700,
            }}
          >
            For Mortgage Lenders
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
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
          }}
        >
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
            For Mortgage Lenders
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
            The post-closing relationship you&apos;ve been losing.
          </h1>
          <p
            style={{
              fontSize: 18,
              fontWeight: 300,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.8,
              maxWidth: 580,
              marginBottom: 44,
              margin: "0 auto 44 auto",
            }}
          >
            BTLR helps your borrowers protect their largest asset — their home. You stay connected as their trusted lender in their Home Team, positioned for the refi, the HELOC, and the next purchase.
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
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
          }}
        >
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 36,
              fontWeight: 300,
              marginBottom: 28,
              margin: "0 0 28px 0",
            }}
          >
            You fund the loan. Then you lose the client.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            Your borrower closes. They move in. Within six months, they can&apos;t remember which lender funded their mortgage. When they need a refi, a HELOC, or a second home loan, they Google it — and you&apos;re back to competing on rate.
          </p>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            Meanwhile, their home — the asset you helped them buy — is deteriorating without a plan. Deferred maintenance becomes emergency spending. Emergency spending strains the budget.
          </p>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: 16,
            }}
          >
            BTLR keeps you connected to the borrower AND helps them protect the collateral.
          </p>
        </div>
      </section>

      {/* Two Highlighted Benefits */}
      <section
        style={{
          backgroundColor: "white",
          padding: "80px 64px",
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
              width={36}
              height={36}
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.gold}
              strokeWidth="1.5"
              style={{ marginBottom: 16 }}
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" />
            </svg>
            <h3
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                color: C.text,
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              Stay in their financial life — not just their inbox
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your borrower signs up through your referral link, you&apos;re permanently placed in their BTLR Home Team. Every time they check their Home Health Score or manage a repair, your name is right there — not buried in an email they archived. In the tool they use to manage their largest asset.
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
              width={36}
              height={36}
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.gold}
              strokeWidth="1.5"
              style={{ marginBottom: 16 }}
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <h3
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                color: C.text,
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              Know when they&apos;re ready for their next loan
            </h3>
            <p
              style={{
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              When your borrowers ask BTLR about renovation costs, request contractor quotes, or start tracking major repairs — those signals matter to you. BTLR keeps you connected to the moments that lead to HELOCs, refis, and second purchases.
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
        <div
          style={{
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 12,
            }}
          >
            How It Works
          </div>
          <h2
            style={{
              color: "white",
              fontFamily: "'Inter', sans-serif",
              fontSize: 36,
              fontWeight: 300,
              margin: 0,
            }}
          >
            Three steps to a permanent post-closing relationship.
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 48,
              marginTop: 64,
            }}
          >
            {/* Step 1 */}
            <div>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px auto",
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
                Fill out the form below. You&apos;ll get a unique referral link tied to your name and company.
              </p>
            </div>

            {/* Step 2 */}
            <div>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px auto",
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
                  margin: "0 0 10px 0",
                }}
              >
                Include BTLR in your post-closing communication.
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
                Add it to your closing email, your welcome packet, or your post-close drip. When your borrower signs up, you&apos;re in their Home Team.
              </p>
            </div>

            {/* Step 3 */}
            <div>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px auto",
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
                  margin: "0 0 10px 0",
                }}
              >
                Stay top-of-mind for the next transaction.
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
                Your borrower manages their home with your name right there. When it&apos;s time for a refi or a new purchase, you&apos;re not a stranger.
              </p>
            </div>
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
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
          }}
        >
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 36,
              fontWeight: 300,
              margin: 0,
              marginBottom: 48,
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
                  marginBottom: 12,
                }}
              />
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  margin: "0 0 8px 0",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Persistent presence in your borrower&apos;s financial life
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Not in their inbox (they&apos;ll unsubscribe). In the tool they use to manage their largest asset.
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
                  marginBottom: 12,
                }}
              />
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  margin: "0 0 8px 0",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                A differentiated post-close experience
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Every lender sends a closing gift basket. You send a tool that actually helps them protect the home you helped them buy.
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
                  marginBottom: 12,
                }}
              />
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  margin: "0 0 8px 0",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Protection of your collateral
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                Borrowers who maintain their homes default less, refinance smarter, and buy again sooner. BTLR aligns your interests.
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
                  marginBottom: 12,
                }}
              />
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 8,
                  margin: "0 0 8px 0",
                  fontFamily: "'Inter', sans-serif",
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
                Free for your borrowers during beta. Your referral link is free forever.
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
        <div
          style={{
            maxWidth: 600,
            margin: "0 auto",
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
            Stop losing borrowers after funding.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: C.muted,
              marginBottom: 40,
              margin: "0 0 40px 0",
            }}
          >
            Create your BTLR affiliate account. Get your unique referral link in 60 seconds.
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
            Get Started
          </Link>
        </div>
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
            color: "white",
            fontFamily: "'Syne', sans-serif",
            fontSize: 20,
            marginBottom: 12,
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
            marginBottom: 16,
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
