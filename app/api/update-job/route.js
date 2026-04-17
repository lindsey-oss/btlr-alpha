import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { job_id, status, contractor_name, contractor_phone, contractor_notes } = await req.json();
    if (!job_id) return Response.json({ error: "Missing job_id" }, { status: 400 });

    const update = { status };
    if (contractor_name)  update.contractor_name  = contractor_name;
    if (contractor_phone) update.contractor_phone = contractor_phone;
    if (contractor_notes) update.contractor_notes = contractor_notes;
    if (status === "accepted")   update.accepted_at   = new Date().toISOString();
    if (status === "completed")  update.completed_at  = new Date().toISOString();

    const { error } = await supabase
      .from("job_requests")
      .update(update)
      .eq("id", job_id);

    if (error) throw error;

    // Email homeowner when contractor accepts
    if (status === "accepted") {
      const { data: job } = await supabase
        .from("job_requests")
        .select("homeowner_email,issue_summary,trade,property_address")
        .eq("id", job_id)
        .single();

      if (job?.homeowner_email) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://btlr-alpha.vercel.app"}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: job.homeowner_email,
            subject: `🎉 Contractor accepted your ${job.trade} job!`,
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                <h2 style="color:#0f1f3d;margin-bottom:8px">A contractor accepted your job!</h2>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:20px 0">
                  <p style="margin:0 0 4px;color:#16a34a;font-weight:700;font-size:16px">✓ ${contractor_name ?? "A contractor"} is on the way</p>
                  ${contractor_phone ? `<p style="margin:4px 0 0;color:#475569">📞 ${contractor_phone}</p>` : ""}
                  ${contractor_notes ? `<p style="margin:8px 0 0;color:#475569;font-style:italic">"${contractor_notes}"</p>` : ""}
                </div>
                <p style="color:#475569"><strong>Job:</strong> ${job.issue_summary}</p>
                <p style="color:#475569"><strong>Property:</strong> ${job.property_address}</p>
                <p style="color:#94a3b8;font-size:13px;margin-top:24px">Powered by BTLR Home OS</p>
              </div>
            `,
          }),
        }).catch(() => {});
      }
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
