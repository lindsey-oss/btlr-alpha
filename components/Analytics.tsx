"use client";

/**
 * BTLR Analytics Provider
 * ─────────────────────────────────────────────────────────────────
 * - Only initialises PostHog AFTER the user accepts cookies
 * - Stops session recording on /dashboard (contains financial/home data)
 * - Listens for consent changes mid-session (e.g. banner accepted)
 * - Safe to render in every layout — does nothing until consent exists
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const CONSENT_KEY   = "btlr_cookies_accepted";
const POSTHOG_KEY   = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST  = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

// Routes where session recording is disabled (sensitive user data)
const NO_RECORD_ROUTES = ["/dashboard", "/settings", "/documents"];

function hasConsent(): boolean {
  try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; }
}

function getPostHog(): any | null {
  return typeof window !== "undefined" ? (window as any).posthog ?? null : null;
}

function initPostHog() {
  if (!POSTHOG_KEY || getPostHog()?.__loaded) return;

  // Inject script dynamically — only called after consent
  const script = document.createElement("script");
  script.src = `${POSTHOG_HOST.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/array.js`;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.onload = () => {
    getPostHog()?.init(POSTHOG_KEY, {
      api_host:        POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      session_recording: {
        maskAllInputs:     true,   // never record what users type
        maskTextSelector:  ".ph-mask",  // add class to mask specific elements
      },
      // Disable recording entirely on dashboard — stops after init via route watcher
      disable_session_recording: NO_RECORD_ROUTES.some(r =>
        window.location.pathname.startsWith(r)
      ),
    });
  };
  document.head.appendChild(script);
}

export default function Analytics() {
  const pathname     = usePathname();
  const initialized  = useRef(false);

  // ── Initialize once if consent already exists ────────────────────────────
  useEffect(() => {
    if (!POSTHOG_KEY || initialized.current) return;
    if (hasConsent()) {
      initPostHog();
      initialized.current = true;
    }
  }, []);

  // ── Listen for consent being granted mid-session (cookie banner accept) ──
  useEffect(() => {
    if (!POSTHOG_KEY || initialized.current) return;

    function onStorage(e: StorageEvent) {
      if (e.key === CONSENT_KEY && e.newValue) {
        initPostHog();
        initialized.current = true;
      }
    }

    // Also poll briefly in case consent fires in the same tab
    // (StorageEvent only fires in OTHER tabs for same-origin)
    const interval = setInterval(() => {
      if (hasConsent() && !initialized.current) {
        initPostHog();
        initialized.current = true;
        clearInterval(interval);
      }
    }, 500);

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);

  // ── Pause / resume session recording based on route ───────────────────────
  useEffect(() => {
    const ph = getPostHog();
    if (!ph) return;

    const isSensitive = NO_RECORD_ROUTES.some(r => pathname?.startsWith(r));
    if (isSensitive) {
      ph.stopSessionRecording?.();
    } else {
      // Only resume if recording was previously active
      if (ph.sessionRecordingStarted?.()) ph.startSessionRecording?.();
    }
  }, [pathname]);

  return null; // renders nothing — pure side-effect component
}
