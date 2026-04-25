/**
 * BTLR Tracking Helpers
 * ─────────────────────
 * Thin wrappers around Supabase inserts for:
 *   · trackEvent()   — analytics_events
 *   · trackConsent() — user_consents
 *   · trackFeedback() — feedback_reports
 *   · trackError()   — error_logs
 *
 * All calls are fire-and-forget (errors are swallowed so they never
 * break the UI). Sensitive document content must never be passed into
 * event_data — only non-identifiable metadata.
 */

import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventName =
  | "signup_completed"
  | "inspection_uploaded"
  | "document_uploaded"
  | "score_viewed"
  | "vendor_clicked"
  | "claim_clicked"
  | "repair_fund_viewed"
  | "feedback_submitted"
  | "cookie_accepted";

export type ConsentType = "cookie" | "privacy" | "terms";

export type FeedbackType = "bug" | "feedback" | "confusion" | "feature_request";

export type ErrorSeverity = "info" | "warning" | "error" | "critical";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pageUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

function browserInfo(): string {
  if (typeof window === "undefined") return "";
  return navigator.userAgent;
}

function currentUserId(): string | null {
  // Resolved synchronously from the Supabase auth cache — no await needed
  // for fire-and-forget tracking. May be null for anonymous events.
  try {
    const raw = localStorage.getItem(
      `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split("//")[1]?.split(".")[0]}-auth-token`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── trackEvent ──────────────────────────────────────────────────────────────

/**
 * Log a product usage event.
 *
 * @param name       One of the EventName literals
 * @param data       Optional non-sensitive metadata (no document content)
 * @param propertyId Optional property UUID for property-scoped events
 *
 * @example
 * trackEvent("inspection_uploaded", { pages: 42 }, property.id);
 * trackEvent("vendor_clicked", { vendor_name: "ABC Plumbing" });
 * trackEvent("cookie_accepted");
 */
export async function trackEvent(
  name: EventName,
  data?: Record<string, unknown>,
  propertyId?: string
): Promise<void> {
  try {
    await supabase.from("analytics_events").insert({
      user_id: currentUserId(),
      property_id: propertyId ?? null,
      event_name: name,
      event_data: data ?? null,
      page_url: pageUrl(),
    });
  } catch {
    // Silently swallow — tracking must never break the UI
  }
}

// ─── trackConsent ─────────────────────────────────────────────────────────────

/**
 * Record that a user accepted a consent prompt.
 *
 * @param type  "cookie" | "privacy" | "terms"
 *
 * @example
 * trackConsent("cookie");
 */
export async function trackConsent(type: ConsentType): Promise<void> {
  try {
    await supabase.from("user_consents").insert({
      user_id: currentUserId(),
      consent_type: type,
      accepted: true,
      user_agent: browserInfo(),
    });
  } catch {
    // Silently swallow
  }
}

// ─── trackFeedback ────────────────────────────────────────────────────────────

/**
 * Submit a feedback report from a user.
 *
 * @example
 * trackFeedback("bug", "The upload button doesn't work on Safari", propertyId);
 */
export async function trackFeedback(
  type: FeedbackType,
  message: string,
  propertyId?: string
): Promise<void> {
  try {
    await supabase.from("feedback_reports").insert({
      user_id: currentUserId(),
      property_id: propertyId ?? null,
      type,
      message,
      page_url: pageUrl(),
      browser: browserInfo(),
      status: "new",
    });
  } catch {
    // Silently swallow
  }
}

// ─── trackError ───────────────────────────────────────────────────────────────

/**
 * Log a client-side error for debugging.
 *
 * @example
 * trackError("Failed to load score", err.stack, "error");
 */
export async function trackError(
  message: string,
  stack?: string,
  severity: ErrorSeverity = "error"
): Promise<void> {
  try {
    await supabase.from("error_logs").insert({
      user_id: currentUserId(),
      page_url: pageUrl(),
      error_message: message,
      stack_trace: stack ?? null,
      browser: browserInfo(),
      severity,
    });
  } catch {
    // Silently swallow
  }
}
