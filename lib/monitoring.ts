// ─────────────────────────────────────────────────────────────────────────────
// BTLR Monitoring & Analytics Helpers
// ─────────────────────────────────────────────────────────────────────────────

// ── PostHog client-side analytics ────────────────────────────────────────────
export function phCapture(event: string, properties?: Record<string, unknown>) {
  try {
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.capture(event, properties);
    }
  } catch { /* silent */ }
}

export function phIdentify(userId: string, traits?: Record<string, unknown>) {
  try {
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.identify(userId, traits);
    }
  } catch { /* silent */ }
}

export function phReset() {
  try {
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.reset();
    }
  } catch { /* silent */ }
}

// ── Error logging ─────────────────────────────────────────────────────────────
export async function logError(payload: {
  error_type: string;
  message: string;
  stack?: string;
  route?: string;
  severity?: 'warning' | 'error' | 'critical';
  metadata?: Record<string, unknown>;
}) {
  try {
    await fetch('/api/monitoring/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* never throw from monitoring */ }
}

// ── Security event logging ────────────────────────────────────────────────────
export async function logSecurityEvent(payload: {
  event_type: string;
  description: string;
  severity?: 'info' | 'warning' | 'critical';
  metadata?: Record<string, unknown>;
}) {
  try {
    await fetch('/api/monitoring/security-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* never throw from monitoring */ }
}

// ── Common tracked events ─────────────────────────────────────────────────────
export const EVENTS = {
  // Onboarding
  SIGNUP:               'user_signed_up',
  LOGIN:                'user_logged_in',
  ONBOARDING_COMPLETE:  'onboarding_completed',

  // Core features
  REPORT_UPLOADED:      'inspection_report_uploaded',
  SCORE_VIEWED:         'home_score_viewed',
  REPAIR_VIEWED:        'repair_detail_viewed',
  REPAIR_COMPLETED:     'repair_marked_complete',

  // Documents
  INSURANCE_UPLOADED:   'insurance_uploaded',
  WARRANTY_UPLOADED:    'warranty_uploaded',
  MORTGAGE_UPLOADED:    'mortgage_uploaded',

  // Financial
  PLAID_CONNECTED:      'bank_account_connected',
  PLAID_DISCONNECTED:   'bank_account_disconnected',

  // Vendors
  VENDOR_ADDED:         'vendor_added',
  VENDOR_VIEWED:        'vendor_profile_viewed',
  CONTRACTOR_SEARCHED:  'contractor_searched',

  // Engagement
  AI_QUESTION_ASKED:    'ai_question_asked',
  FEEDBACK_SUBMITTED:   'feedback_submitted',
  PHOTO_ANALYZED:       'photo_analyzed',

  // Navigation
  TAB_VIEWED:           'tab_viewed',
} as const;
