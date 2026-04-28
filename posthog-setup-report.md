<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the BTLR Next.js App Router project. Here is a summary of all changes made:

## Infrastructure changes

- **`instrumentation-client.ts`** (new) — Initializes PostHog client-side using `posthog-js` with the `/ingest` reverse proxy, exception capture enabled, and the `2026-01-30` defaults. This replaces the old script-snippet approach in `layout.tsx`.
- **`lib/posthog-server.ts`** (new) — Singleton server-side PostHog client using `posthog-node` for API route event tracking.
- **`next.config.ts`** (updated) — Added `/ingest/*`, `/ingest/static/*`, and `/ingest/array/*` rewrites to proxy PostHog traffic through the Next.js server, avoiding ad-blockers. Added `skipTrailingSlashRedirect: true`.
- **`app/layout.tsx`** (updated) — Removed the old script-snippet PostHog initialization (now handled by `instrumentation-client.ts`).
- **`package.json`** (updated) — Added `posthog-js` and `posthog-node` dependencies.
- **`.env.local`** (updated) — Confirmed `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are set.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `user_signed_up` | User successfully created a new account | `app/login/page.tsx` |
| `user_logged_in` | User successfully signed into an existing account | `app/login/page.tsx` |
| `property_created` | User created a new property entry in the dashboard | `app/dashboard/page.tsx` |
| `inspection_report_uploaded` | User uploaded and successfully parsed an inspection PDF | `app/dashboard/page.tsx` |
| `home_health_score_calculated` | Home health score was computed after inspection parsing | `app/dashboard/page.tsx` |
| `contractor_search_started` | User triggered a contractor search from the vendors tab | `app/components/VendorsView.tsx` |
| `affiliate_referral_viewed` | Visitor landed on an affiliate referral page | `app/ref/[code]/page.tsx` |
| `vendor_application_step_completed` | Vendor advanced to the next step in the application form | `app/apply/form/page.tsx` |
| `job_requested` | Homeowner submitted a job request (server-side) | `app/api/request-job/route.js` |
| `bank_account_connected` | User connected their bank account via Plaid (server-side) | `app/api/plaid-exchange/route.js` |
| `vendor_application_submitted` | Contractor submitted their application for review (server-side) | `app/api/vendor-apply/submit/route.js` |

## User identification

- On **signup**: `posthog.identify(userId, { email })` called with the Supabase user ID as the distinct ID.
- On **login**: `posthog.identify(userId, { email })` called after successful `signInWithPassword`.
- On **server-side events**: `distinctId` is set to `user_id` (Supabase UUID), `homeowner_email`, or `business_email` to correlate client and server events.

## Error tracking

- Login and signup errors are captured with `posthog.captureException()`.
- `capture_exceptions: true` in `instrumentation-client.ts` enables automatic unhandled exception capture globally.

## Next steps

We've set up the following insights in your PostHog project for monitoring user behavior based on the events just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/401152/dashboard)
- **Signup funnel**: `affiliate_referral_viewed` → `user_signed_up` → `property_created` → `inspection_report_uploaded`
- **Core value delivery**: `inspection_report_uploaded` → `home_health_score_calculated`
- **Job request flow**: `home_health_score_calculated` → `contractor_search_started` → `job_requested`
- **Vendor funnel**: `vendor_application_step_completed` (by step) → `vendor_application_submitted`
- **Financial engagement**: `bank_account_connected` trend over time

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
