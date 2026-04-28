import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALERT_EMAIL = process.env.MONITORING_ALERT_EMAIL ?? 'lindsey@eatplayloveot.com';
const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.RESEND_FROM_EMAIL ?? 'BTLR Alerts <alerts@btlrai.com>';

async function sendAlert(subject: string, html: string) {
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: ALERT_EMAIL, subject, html }),
  }).catch(() => {});
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { error_type, message, stack, route, severity = 'error', metadata = {}, user_id } = body;

    // Log to database
    await supabase.from('error_logs').insert({
      user_id: user_id ?? null,
      error_type,
      message,
      stack,
      route,
      severity,
      metadata,
    });

    // Send email alert for critical errors
    if (severity === 'critical') {
      await sendAlert(
        `🚨 BTLR Critical Error: ${error_type}`,
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;padding:24px">
          <h2 style="color:#dc2626;margin:0 0 16px">Critical Error Detected</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:700;width:120px">Type</td><td style="padding:8px">${error_type}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;font-weight:700">Message</td><td style="padding:8px">${message}</td></tr>
            <tr><td style="padding:8px;font-weight:700">Route</td><td style="padding:8px">${route ?? 'unknown'}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;font-weight:700">Time</td><td style="padding:8px">${new Date().toISOString()}</td></tr>
          </table>
          ${stack ? `<pre style="background:#f1f5f9;padding:16px;border-radius:8px;overflow:auto;font-size:12px;margin-top:16px">${stack.slice(0, 800)}</pre>` : ''}
          <p style="color:#64748b;font-size:13px;margin-top:20px">Check your <a href="https://supabase.com/dashboard">Supabase dashboard</a> → error_logs table for full details.</p>
        </div>
        `
      );
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
