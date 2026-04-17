import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const body = await req.json();

    const { data, error } = await supabase
      .from("job_requests")
      .insert({
        homeowner_email:         body.homeowner_email ?? null,
        property_address:        body.property_address ?? null,
        trade:                   body.trade ?? null,
        trade_emoji:             body.trade_emoji ?? null,
        issue_summary:           body.issue_summary ?? null,
        full_description:        body.full_description ?? null,
        urgency:                 body.urgency ?? "normal",
        urgency_reason:          body.urgency_reason ?? null,
        what_to_tell_contractor: body.what_to_tell_contractor ?? null,
        diy_tips:                body.diy_tips ?? [],
        questions_to_ask:        body.questions_to_ask ?? [],
        estimated_cost_low:      body.estimated_cost_low ?? null,
        estimated_cost_high:     body.estimated_cost_high ?? null,
        related_findings:        body.related_findings ?? null,
        status:                  "pending",
      })
      .select("id")
      .single();

    if (error) throw error;

    // Send job link email to homeowner (confirmation) if email provided
    const jobUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://btlr-alpha.vercel.app"}/job/${data.id}`;
    if (body.homeowner_email) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://btlr-alpha.vercel.app"}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: body.homeowner_email,
          subject: `✅ Job request sent — ${body.trade}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
              <h2 style="color:#0f1f3d;margin-bottom:8px">Your job request was sent!</h2>
              <p style="color:#475569">We've created a job brief for a <strong>${body.trade}</strong> contractor.</p>
              <div style="background:#f0f4f8;border-radius:12px;padding:16px 20px;margin:20px 0">
                <p style="margin:0 0 6px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">Issue</p>
                <p style="margin:0;color:#0f172a;font-weight:600">${body.issue_summary}</p>
              </div>
              <p style="color:#475569">Share this link with any contractor — they'll see the full job details and can accept directly:</p>
              <a href="${jobUrl}" style="display:inline-block;margin:12px 0;padding:12px 24px;background:#1e3a8a;color:white;border-radius:10px;text-decoration:none;font-weight:600">
                View Job Brief →
              </a>
              <p style="color:#94a3b8;font-size:13px;margin-top:24px">Powered by BTLR Home OS</p>
            </div>
          `,
        }),
      }).catch(() => {});
    }

    return Response.json({ success: true, job_id: data.id, job_url: jobUrl });
  } catch (err) {
    console.error("request-job error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
