"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trackConsent, trackEvent } from "@/lib/tracking";

const STORAGE_KEY = "btlr_cookies_accepted";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — just don't show
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    trackConsent("cookie");
    trackEvent("cookie_accepted");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#1e293b",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.82)", margin: 0, lineHeight: 1.5, flex: "1 1 280px" }}>
        We use cookies to improve your experience and understand how BTLR is used.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Link
          href="/privacy"
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.5)",
            textDecoration: "none",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          Learn More
        </Link>
        <button
          onClick={accept}
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            background: "#2563eb",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
