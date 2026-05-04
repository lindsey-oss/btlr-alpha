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

export default function AgentsPage() {
  return (
    <div style={{ fontFamily: OUTFIT, color: C.text }}>
      {/* Nav */}
      <nav
        style={{
          backgroundColor: C.bg,
          padding: "0 64px",
          height: "64px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "0.12em",
              color: C.navy,
            }}
          >
            BTLR
          </div>
          <div
            style={{
              border: `1px solid ${C.gold}`,
              color: C.gold,
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "4px",
            }}
          >
            For Real Estate Agents
          </div>
        </div>
        <a
          href="#register"
          style={{
            backgroundColor: C.gold,
            color: "white",
            fontSize: "12px",
            fontWeight: 700,
            padding: "10px 22px",
            borderRadius: "6px",
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
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: "16px",
            }}
          >
            For Real Estate Agents
          </div>
          <h1
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "clamp(36px, 5vw, 68px)",
              fontWeight: 300,
              color: "white",
              lineHeight: 1.1,
              marginBottom: "20px",
              margin: "0 0 20px 0",
            }}
          >
            Your closing gift that keeps giving.
          </h1>
          <p
            style={{
              fontSize: "18px",
              fontWeight: 300,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.8,
              maxWidth: "580px",
              margin: "0 auto 44px auto",
            }}
          >
            BTLR gives your buyers a Home Health Score and a personalized repair plan — powered by their actual inspection report. You stay in their Home Team as their trusted agent, for years after closing.
          </p>
          <a
            href="#register"
            style={{
              backgroundColor: C.gold,
              color: "white",
              padding: "16px 40px",
              fontSize: "14px",
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-block",
              cursor: "pointer",
              borderRadius: "4px",
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
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "36px",
              fontWeight: 300,
              marginBottom: "28px",
              margin: "0 0 28px 0",
            }}
          >
            After closing, you disappear.
          </h2>
          <p
            style={{
              fontSize: "16px",
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: "16px",
            }}
          >
            Your buyers just made the biggest purchase of their lives. They have a 40-page inspection report they can't interpret, a house full of systems they don't understand, and no idea which contractor to call. Within 90 days, most of them can't remember your name.
          </p>
          <p
            style={{
              fontSize: "16px",
              color: C.muted,
              lineHeight: 1.82,
              marginBottom: "16px",
            }}
          >
            You spent months earning their trust. BTLR keeps that trust alive.
          </p>
        </div>
      </section>

      {/* Two Highlighted Benefits */}
      <section
        style={{
          backgroundColor: C.bg,
          padding: "80px 64px",
        }}
      >
        <div
          style={{
            maxWidth: "1100px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "60px",
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
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginBottom: "16px" }}
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <h3
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "22px",
                fontWeight: 700,
                color: C.text,
                marginBottom: "16px",
                marginTop: "16px",
                margin: "16px 0 16px 0",
              }}
            >
              Stay top of mind for the life of the home
            </h3>
            <p
              style={{
                fontSize: "15px",
                color: C.muted,
                lineHeight: 1.8,
              }}
            >
              When a buyer signs up through your referral link, you're permanently placed in their Home Team — your name, photo, and contact info front and center in the tool they use every time they check their Home Health Score, schedule a repair, or search for a vendor. Not buried in a CRM. In their home.
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
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginBottom: "16px" }}
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <h3
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "22px",
                fontWeight: 700,
                color: C.text,
                marginBottom: "16px",
                marginTop: "16px",
                margin: "16px 0 16px 0",
              }}
            >
              Get notified when clients ask for help
            </h3>
            <p
              style={{
                fontSize: "15px",
                color: C.muted,
                lineHeight: 1.8,
              }}
            >
              When your clients search for a contractor, ask BTLR for a vendor recommendation, or flag an urgent repair — you'll know. BTLR keeps you connected to the moments that matter, so you're the first call when they're ready to buy their next home.
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
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.5)",
                marginBottom: "16px",
              }}
            >
              How It Works
            </div>
            <h2
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "36px",
                fontWeight: 300,
                color: "white",
                margin: "0",
              }}
            >
              Three steps to a permanent post-closing relationship.
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "48px",
            }}
          >
            {/* Step 1 */}
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: "18px",
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
                  fontSize: "15px",
                  fontWeight: 700,
                  marginBottom: "10px",
                  margin: "0 0 10px 0",
                }}
              >
                Register in 60 seconds.
              </h3>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "14px",
                  lineHeight: 1.72,
                }}
              >
                Fill out the form below. You'll get a unique referral link tied to your name, company, and headshot.
              </p>
            </div>

            {/* Step 2 */}
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: "18px",
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
                  fontSize: "15px",
                  fontWeight: 700,
                  marginBottom: "10px",
                  margin: "0 0 10px 0",
                }}
              >
                Share at closing.
              </h3>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "14px",
                  lineHeight: 1.72,
                }}
              >
                Text it, email it, include it in your closing packet. When they sign up, you're automatically added to their Home Team.
              </p>
            </div>

            {/* Step 3 */}
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: `1.5px solid ${C.gold}`,
                  color: C.gold,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 800,
                  fontSize: "18px",
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
                  fontSize: "15px",
                  fontWeight: 700,
                  marginBottom: "10px",
                  margin: "0 0 10px 0",
                }}
              >
                Stay connected — without the work.
              </h3>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "14px",
                  lineHeight: 1.72,
                }}
              >
                Every time they check their score, prioritize a repair, or contact a vendor, your name is right there. No drip campaigns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section
        style={{
          backgroundColor: C.bg,
          padding: "100px 64px",
        }}
      >
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "36px",
              fontWeight: 300,
              marginBottom: "48px",
              margin: "0 0 48px 0",
            }}
          >
            What you get as a BTLR affiliate.
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "32px",
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
                  width: "8px",
                  height: "8px",
                  backgroundColor: C.gold,
                  borderRadius: "1px",
                  marginBottom: "16px",
                }}
              />
              <h3
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: "8px",
                  margin: "0 0 8px 0",
                }}
              >
                Permanent presence in their home
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: C.muted,
                  lineHeight: 1.7,
                }}
              >
                Your name, photo, and contact info live inside the tool your clients use to manage their home — for as long as they own it.
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
                  width: "8px",
                  height: "8px",
                  backgroundColor: C.gold,
                  borderRadius: "1px",
                  marginBottom: "16px",
                }}
              />
              <h3
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: "8px",
                  margin: "0 0 8px 0",
                }}
              >
                A closing experience no one else offers
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: C.muted,
                  lineHeight: 1.7,
                }}
              >
                Stop competing on commission splits. Compete on what happens after the keys change hands.
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
                  width: "8px",
                  height: "8px",
                  backgroundColor: C.gold,
                  borderRadius: "1px",
                  marginBottom: "16px",
                }}
              />
              <h3
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: "8px",
                  margin: "0 0 8px 0",
                }}
              >
                Referral visibility
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: C.muted,
                  lineHeight: 1.7,
                }}
              >
                See which clients signed up through your link. Know who's engaged and active. Dashboard coming soon.
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
                  width: "8px",
                  height: "8px",
                  backgroundColor: C.gold,
                  borderRadius: "1px",
                  marginBottom: "16px",
                }}
              />
              <h3
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: "8px",
                  margin: "0 0 8px 0",
                }}
              >
                Zero cost. Zero obligation.
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: C.muted,
                  lineHeight: 1.7,
                }}
              >
                BTLR is free for your clients during beta. Your referral link is free forever.
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
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "36px",
              fontWeight: 300,
              marginBottom: "16px",
              margin: "0 0 16px 0",
            }}
          >
            Ready to stop disappearing after closing?
          </h2>
          <p
            style={{
              fontSize: "16px",
              color: C.muted,
              marginBottom: "40px",
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
              fontSize: "15px",
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-block",
              borderRadius: "4px",
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
            fontFamily: "'Syne', sans-serif",
            fontSize: "20px",
            color: "white",
            fontWeight: 800,
          }}
        >
          BTLR
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "32px",
            marginTop: "12px",
          }}
        >
          <a
            href="/"
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            Home
          </a>
          <a
            href="/affiliate"
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            Affiliate Sign Up
          </a>
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.3)",
            fontSize: "12px",
            marginTop: "16px",
          }}
        >
          © 2026 BTLR
        </div>
      </footer>
    </div>
  );
}
