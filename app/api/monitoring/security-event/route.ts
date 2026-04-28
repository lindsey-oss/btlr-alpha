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
    const { event_type, description, severity = 'info', metadata = {}, user_id } = body;

    // Get IP from request headers
    const ip_address = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';

    // Log to database
    await supabase.from('security_events').insert({
      user_id: user_id ?? null,
      event_type,
      description,
      ip_address,
      severity,
      metadata,
    });

    // Email alert for warnings and critical events
    if (severity === 'warning' || severity === 'critical') {
      const emoji = severity === 'critical' ? '🚨' : '⚠️';
      await sendAlert(
        `${emoji} BTLR Security Alert: ${event_type}`,
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;padding:24px">
          <h2 style="color:${severity === 'critical' ? '#dc2626' : '#d97706'};margin:0 0 16px">${emoji} Security Event: ${event_type}</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:700;width:120px">Severity</td><td style="padding:8px;text-transform:uppercase;font-weight:700;color:${severity === 'critical' ? '#dc2626' : '#d97706'}">${severity}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;font-weight:700">Event</td><td style="padding:8px">${event_type}</td></tr>
            <tr><td style="padding:8px;font-weight:700">Description</td><td style="padding:8px">${description}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;font-weight:700">IP Address</td><td style="padding:8px">${ip_address}</td></tr>
            <tr><td style="padding:8px;font-weight:700">Time</td><td style="padding:8px">${new Date().toISOString()}</td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;margin-top:20px">Check your <a href="https://supabase.com/dashboard">Supabase dashboard</a> → security_events table for full history.</p>
        </div>
        `
      );
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
