import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTLR — Your Home, Managed",
  description: "The AI-powered home operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Plaid Link — required for bank connection popup */}
        <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="beforeInteractive"/>
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
