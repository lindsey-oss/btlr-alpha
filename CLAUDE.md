# BTLR Codebase — Claude Working Guide

**Last stable baseline: 2026-04-27**
**Committed through:** `602a968` (Fix dollhouse scroll: labels independent of video load state)

---

## What's Working — Do Not Break

### Landing Page (`app/page.tsx`)
- Scroll-scrub video dollhouse: `#dollhouse` section is `340vh`, sticky div is `100vh`. Video scrub runs via RAF loop in `useEffect`. **Labels must appear independent of `v.duration`** — the scroll handler shows/hides labels based on raw scroll progress, and only updates `targetTime` when `v.duration` is ready. Breaking this gating will silently kill the animation.
- `body { overflow-x: clip }` — NOT `hidden`. `overflow-x: hidden` on body/html breaks `position: sticky` in Firefox/Chrome by creating an implicit scroll container. Never revert this.
- `#sv-labels-mobile` default `display: none` is set in the `<style>` block, NOT as an inline React style. Inline styles override media queries. Never move it back to inline.
- Hero scroll hint is in normal document flow (not `position: absolute`) to prevent overlap with the contractor link on mobile.
- Vendor modal removed — "Join Trusted Network" links to `/apply`.

### Dashboard (`app/dashboard/page.tsx`) — 7,171 lines
- **Properties table**: no `created_at` column — use `.order("id", ...)` not `.order("created_at", ...)`.
- **Documents table**: column is `file_path` NOT `storage_path` (except `receipt_storage_path` which is on a different table).
- **`photoRef` and `inspRef`**: always-rendered hidden file inputs. They must remain outside all nav conditionals — if wrapped in a conditional they become null refs and click handlers silently fail.
- **Claim URL normalization**: warranty/insurance `claimUrl` values are stored without protocol. Always prepend `https://` if no `http` prefix present.
- **Score persistence**: `loadAllProperties()` → `loadProperty()` → scoring pipeline. Score is saved to `properties` table. Findings are stored in `findings` table (source of truth) with JSONB `inspection_findings` as fallback for legacy data.
- **Real-time subscription** on `job_requests` uses no server-side column filter — Supabase UPDATE events only include PK in replica identity. User-scoping is done in the query, not the subscription filter.

### VendorsView (`app/components/VendorsView.tsx`)
- **`locationForSearch`**: full address → `cityParsed` → zip. This variable — NOT `city || zip` — must be passed to `NearbyVendorsMap` and used in Yelp links. `city` is for display only and has a fallback of `"your area"` (truthy string) which breaks Google/Yelp location searches.
- **Category display names**: `structure_foundation` → "Structure", `site_grading_drainage` → "Site & Drainage", `roof_drainage_exterior` → "Roof", `exterior` → "Exterior", `appliances` → "Appliances", `interior_windows_doors` → "Interior".
- **Contractor contact flow**: 3-step UI (brief confirmed → choose mode → contractor cards). Uses `/api/find-contractors` (Google Places Text Search + Place Details). Free — no Twilio.

### MyJobsView (`app/components/MyJobsView.tsx`)
- Delete job button uses `confirm()` before calling Supabase delete.
- Real-time channel subscribes to all `job_requests` events (no filter) and re-runs `loadJobs(uid)` on any change — user scoping is in the query.

### Inspection Parser (`app/api/parse-inspection/route.js`)
- Two-tier cache: L1 in-process Map, L2 Supabase `parse_cache` table.
- Two-pass AI extraction: pass 1 finds main findings, pass 2 finds gaps, `mergeFindings()` deduplicates.
- `resolveAddress()` picks best property address from pass 1, pass 2, and regex pre-extraction candidates (prefers ZIP+state > state > any).
- Vision fallback for scanned/image PDFs via OpenAI Files API.
- Temperature `0`, seed `91472` — never change these. Determinism is critical for cache hits.

### Scoring Engine (`lib/scoring-engine.ts` and `lib/scoring-*.ts`)
**Confirmed weights (locked by user):**
| System | Weight |
|---|---|
| Structure/Foundation | 25% |
| Roof/Envelope | 20% |
| Electrical | 15% |
| Plumbing | 15% |
| HVAC | 15% |
| Appliances | 10% |

Safety is a **hard modifier** — not a weighted system. Critical safety findings apply a fixed penalty regardless of other scores.

---

## Architecture

```
Next.js App Router (TypeScript)
├── app/page.tsx                    — Marketing landing page
├── app/dashboard/page.tsx          — Main app (7k lines, all-in-one)
├── app/components/
│   ├── VendorsView.tsx             — Vendor/contractor tab
│   └── MyJobsView.tsx              — Job requests tab
├── app/api/
│   ├── parse-inspection/           — PDF → findings + score (GPT-4o, 2-pass)
│   ├── find-contractors/           — Google Places Text Search + Details
│   ├── analyze-photos/             — Photo-based condition analysis
│   ├── classify-issue/             — Issue → trade classification
│   ├── home-ai/                    — AI concierge chat
│   ├── parse-warranty/             — Warranty PDF extraction
│   ├── parse-insurance/            — Insurance doc extraction
│   ├── parse-mortgage/             — Mortgage statement extraction
│   └── vendor-apply/               — Contractor onboarding flow
├── lib/
│   ├── scoring-engine.ts           — Home health score computation
│   ├── findings/                   — Finding normalization + classification
│   └── extractPdfText.js           — PDF text extraction utility
└── supabase/migrations/            — All schema migrations (run manually)
```

**Supabase tables (key ones):**
- `properties` — one row per property, JSONB blobs for inspection/photo findings, scores
- `findings` — normalized findings table (source of truth, post-migration)
- `documents` — uploaded files metadata (`file_path` column = path in "documents" bucket)
- `job_requests` — contractor job requests from homeowners
- `parse_cache` — persistent L2 cache for inspection parse results
- `vendor_applications` — contractor onboarding submissions

**Environment variables required:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `RESEND_API_KEY` (email)

---

## Styling Conventions

- **Design tokens**: inline style objects using `C.xxx` color constants defined at the top of each component. No external CSS files.
- **Fonts**: Outfit (headings), Syne (labels/eyebrows), DM Sans (body). Loaded via Google Fonts in `app/layout.tsx`.
- **Dashboard color palette**: `navy #0f1f3d`, `accent #2563eb`, `bg #f0f4f8`, `surface #ffffff`
- **Landing page palette**: `gold #2C5F8A`, `navy #1B2D47`, `surface #F7F2EC`
- **No Tailwind in dashboard** — all inline styles. Landing page has some global CSS classes (reveal, feat-card, etc.) in a `<style>` block.

---

## Known Gotchas

1. **Git lock file**: The sandbox cannot remove `.git/HEAD.lock` or `.git/index.lock`. If a commit fails with lock error, Lindsey must run `rm -f .git/*.lock` before pushing.
2. **Supabase replica identity**: UPDATE events in real-time subscriptions only include primary key columns. Never filter a subscription channel by non-PK columns (like `user_id`) — it will silently never match.
3. **iOS video scrubbing**: Setting `video.currentTime` on iOS Safari requires user interaction in some versions. The scroll-scrub on the landing page may degrade to a still image on iOS — this is expected. The label reveal still works.
4. **`overflow-x: clip` vs `hidden`**: `hidden` breaks `position: sticky`. Always use `clip` on body-level elements.
5. **Inline style vs media query**: CSS media queries cannot override inline React styles. Default states for elements that change at breakpoints must live in the `<style>` block, not in the `style={{}}` prop.
6. **Properties table**: no `created_at` column. If you need one, run: `ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`

---

## Feature Roadmap (discussed, not built)

- **Severity renaming**: "Critical" → "Needs Attention", "Warning" → "Plan Ahead", "Info" → "On Watch" (or "Monitor"). User prefers less alarming language.
- **Milestone/gamification**: Oura Ring-style daily check-in, streak tracking, crown/tier badges (Caretaker → Guardian → Steward → BTLR Elite), monthly Vitals Report email.
- **Contractor network**: currently uses Google Places free search. Future: BTLR-vetted vendor network with direct job dispatch.
- **Email**: Resend configured but custom domain needed for arbitrary recipient delivery.
