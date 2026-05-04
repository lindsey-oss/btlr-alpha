import { createClient } from '@supabase/supabase-js';

// Vercel Cron — runs daily at 8am UTC
// Schedule is set in vercel.json
// Secured with CRON_SECRET (set in Vercel env vars)

export async function GET(req: Request) {
  // Verify cron secret so this endpoint can't be called publicly
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const issues: string[] = [];
  const lines: string[] = [];

  // ── 1. Error logs ─────────────────────────────────────────────
  let errorLogsLine = '';
  try {
    const { data: recentErrors, error: e1 } = await supabase
      .from('error_logs')
      .select('id, message, type, created_at')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: prevErrors } = await supabase
      .from('error_logs')
      .select('id')
      .gte('created_at', twoDaysAgo)
      .lt('created_at', yesterday)
      .limit(100);

    if (e1 && e1.message?.includes('does not exist')) {
      errorLogsLine = '⬜ Error logs table not yet created — skip';
    } else if (e1) {
      errorLogsLine = `⚠️ Error log query failed: ${e1.message}`;
      issues.push('Error log query failed');
    } else {
      const count = recentErrors?.length ?? 0;
      const prevCount = prevErrors?.length ?? 0;
      const trend = count > prevCount ? ' (↑ increasing)' : count < prevCount ? ' (↓ decreasing)' : ' (→ stable)';
      if (count === 0) {
        errorLogsLine = '✅ No new errors in last 24h';
      } else {
        errorLogsLine = `⚠️ ${count} errors in last 24h${trend}`;
        issues.push(`${count} errors in last 24h`);
      }
    }
  } catch {
    errorLogsLine = '⬜ Error logs table not found — skip';
  }
  lines.push(errorLogsLine);

  // ── 2. Null-address properties ────────────────────────────────
  const { data: nullAddr, error: e2 } = await supabase
    .from('properties')
    .select('id, created_at')
    .is('address', null);

  let nullAddrLine = '';
  if (e2) {
    nullAddrLine = `⚠️ Null-address check failed: ${e2.message}`;
    issues.push('Null-address query failed');
  } else if (!nullAddr || nullAddr.length === 0) {
    nullAddrLine = '✅ No null-address properties';
  } else {
    const earliest = nullAddr.sort((a, b) => a.created_at < b.created_at ? -1 : 1)[0].created_at;
    nullAddrLine = `🔴 ${nullAddr.length} propert${nullAddr.length === 1 ? 'y' : 'ies'} with null address (oldest: ${earliest?.slice(0, 10)}) — dashboard crash risk`;
    issues.push(`${nullAddr.length} null-address properties`);
  }
  lines.push(nullAddrLine);

  // ── 3. Null-category findings ─────────────────────────────────
  const { data: nullCat, error: e3 } = await supabase
    .from('findings')
    .select('id, property_id')
    .is('category', null)
    .limit(50);

  let nullCatLine = '';
  if (e3) {
    nullCatLine = `⚠️ Null-category check failed: ${e3.message}`;
    issues.push('Null-category query failed');
  } else if (!nullCat || nullCat.length === 0) {
    nullCatLine = '✅ No null-category findings';
  } else {
    const affectedProps = [...new Set(nullCat.map(f => f.property_id))];
    nullCatLine = `⚠️ ${nullCat.length} finding${nullCat.length === 1 ? '' : 's'} with null category (${affectedProps.length} propert${affectedProps.length === 1 ? 'y' : 'ies'} affected)`;
    issues.push(`${nullCat.length} null-category findings`);
  }
  lines.push(nullCatLine);

  // ── 4. Repair documents with null filename ────────────────────
  const { data: repairDocs, error: e4 } = await supabase
    .from('repair_documents')
    .select('id, property_id, filename, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  let repairLine = '';
  if (e4) {
    repairLine = `⚠️ Repair docs check failed: ${e4.message}`;
    issues.push('Repair docs query failed');
  } else {
    const nullFilename = (repairDocs ?? []).filter(d => !d.filename);
    if (nullFilename.length === 0) {
      repairLine = '✅ Repair documents look healthy';
    } else {
      repairLine = `⚠️ ${nullFilename.length} recent repair doc${nullFilename.length === 1 ? '' : 's'} with null filename`;
      issues.push(`${nullFilename.length} repair docs missing filename`);
    }
  }
  lines.push(repairLine);

  // ── 5. Recent properties (new user activity) ──────────────────
  const { data: recentProps, error: e5 } = await supabase
    .from('properties')
    .select('id, created_at')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false });

  let activityLine = '';
  if (e5) {
    activityLine = `⚠️ Activity check failed: ${e5.message}`;
  } else {
    const count = recentProps?.length ?? 0;
    activityLine = `📊 ${count} new propert${count === 1 ? 'y' : 'ies'} in last 24h`;
  }
  lines.push(activityLine);

  // ── Build report ──────────────────────────────────────────────
  const hasIssues = issues.length > 0;
  const subject = hasIssues
    ? `⚠️ BTLR Health — ${issues.length} issue${issues.length === 1 ? '' : 's'} — ${dateLabel}`
    : `✅ BTLR Health — All clear — ${dateLabel}`;

  const actionSection = hasIssues
    ? `<p><strong>Action items:</strong></p><ul>${issues.map(i => `<li>${i}</li>`).join('')}</ul>`
    : `<p><strong>Action items:</strong> None — all clear</p>`;

  const html = `
<div style="font-family: monospace; font-size: 14px; line-height: 1.8; color: #1a1a1a;">
  <p><strong>BTLR Daily Health — ${dateLabel}</strong></p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 12px 0;" />
  ${lines.map(l => `<p style="margin: 4px 0;">${l}</p>`).join('')}
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 12px 0;" />
  ${actionSection}
</div>
`.trim();

  // ── Send email via Resend ─────────────────────────────────────
  const toEmail = process.env.MONITORING_ALERT_EMAIL ?? process.env.VENDOR_NOTIFY_EMAIL;

  if (!toEmail) {
    console.warn('BTLR health check: no MONITORING_ALERT_EMAIL set — skipping email');
    return Response.json({ ok: true, report: lines, issues, skipped: 'no email configured' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('BTLR health check: no RESEND_API_KEY set — skipping email');
    return Response.json({ ok: true, report: lines, issues, skipped: 'no resend key' });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? 'BTLR <onboarding@resend.dev>',
      to: toEmail,
      subject,
      html,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('BTLR health check email failed:', err);
    return Response.json({ ok: false, report: lines, issues, emailError: err }, { status: 500 });
  }

  return Response.json({ ok: true, report: lines, issues, sent: true });
}
