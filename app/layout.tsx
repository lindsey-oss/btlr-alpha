import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import CookieBanner from "@/components/CookieBanner";
import Analytics from "@/components/Analytics";

export const metadata: Metadata = {
  title: "BTLR — Your Home, Managed",
  description: "The AI-powered home operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet"/>
        {/* Plaid Link */}
        <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="beforeInteractive"/>

        {/* ── Vercel Analytics ────────────────────────────────────────────── */}
        <Script src="https://va.vercel-scripts.com/v1/analytics.js" strategy="afterInteractive" data-endpoint="/api/analytics"/>
        <Script src="https://va.vercel-scripts.com/v1/speed-insights.js" strategy="afterInteractive"/>
      </head>
      <body suppressHydrationWarning>
        {children}
        <Analytics />
        <CookieBanner />
      </body>
    </html>
  );
}
