'use client';

import { useEffect } from 'react';
import { logError } from '@/lib/monitoring';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError({
      error_type: 'ui_crash',
      message: error.message,
      stack: error.stack,
      route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
      severity: 'critical',
      metadata: { digest: error.digest },
    });
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '40px 24px', maxWidth: 420 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>Something went wrong</h1>
          <p style={{ color: '#64748b', fontSize: 15, margin: '0 0 28px', lineHeight: 1.6 }}>
            We&apos;ve been notified and are looking into it. Try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{ padding: '12px 28px', background: '#1e40af', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
