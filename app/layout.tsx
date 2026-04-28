import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import CookieBanner from "@/components/CookieBanner";

export const metadata: Metadata = {
  title: "BTLR — Your Home, Managed",
  description: "The AI-powered home operating system",
};

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet"/>
        {/* Plaid Link */}
        <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="beforeInteractive"/>

        {/* ── PostHog Analytics ───────────────────────────────────────────── */}
        {POSTHOG_KEY && (
          <Script id="posthog-init" strategy="afterInteractive">{`
            !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_distinct_id getGroups group resetGroups setPersonProperties resetPersonProperties setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_session_id get_session_replay_url createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
            posthog.init('${POSTHOG_KEY}', {
              api_host: '${POSTHOG_HOST}',
              person_profiles: 'identified_only',
              capture_pageview: true,
              capture_pageleave: true,
              session_recording: { maskAllInputs: true },
            });
          `}</Script>
        )}

        {/* ── Vercel Analytics ────────────────────────────────────────────── */}
        <Script src="https://va.vercel-scripts.com/v1/analytics.js" strategy="afterInteractive" data-endpoint="/api/analytics"/>
        <Script src="https://va.vercel-scripts.com/v1/speed-insights.js" strategy="afterInteractive"/>
      </head>
      <body suppressHydrationWarning>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
