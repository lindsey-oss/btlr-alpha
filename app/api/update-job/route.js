import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const {
      job_id, status,
      contractor_name, contractor_phone, contractor_notes,
      // Job details passed from client to avoid RLS SELECT conflict:
      // server-side anon client has auth.uid() = null, which blocks any
      // SELECT against job_requests rows protected by user_id = auth.uid().
      homeowner_email, issue_summary, trade, property_address,
    } = await req.json();

    if (!job_id) return Response.json({ error: "Missing job_id" }, { status: 400 });

    const update = { status };
    if (contractor_name)  update.contractor_name  = contractor_name;
    if (contractor_phone) update.contractor_phone = contractor_phone;
    if (contractor_notes) update.contractor_notes = contractor_notes;
    if (status === "accepted")  update.accepted_at  = new Date().toISOString();
    if (status === "declined")  update.declined_at  = new Date().toISOString();
    if (status === "completed") update.completed_at = new Date().toISOString();

    const { error } = await supabase
      .from("job_requests")
      .update(update)
      .eq("id", job_id);

    if (error) throw error;

    // Email homeowner when contractor accepts
    if (status === "accepted" && homeowner_email) {
      const jobUrl = `${process.env.NEXT_PUBLIC_APP_URL}/job/${job_id}`;
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: homeowner_email,
          subject: `🎉 Contractor accepted your ${trade} job!`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
              <h2 style="color:#0f1f3d;margin-bottom:8px">A contractor accepted your job!</h2>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:20px 0">
                <p style="margin:0 0 4px;color:#16a34a;font-weight:700;font-size:16px">✓ ${contractor_name ?? "A contractor"} is on the way</p>
                ${contractor_phone ? `<p style="margin:4px 0 0;color:#475569">📞 ${contractor_phone}</p>` : ""}
                ${contractor_notes ? `<p style="margin:8px 0 0;color:#475569;font-style:italic">"${contractor_notes}"</p>` : ""}
              </div>
              <p style="color:#475569"><strong>Job:</strong> ${issue_summary ?? ""}</p>
              <p style="color:#475569"><strong>Property:</strong> ${property_address ?? ""}</p>
              <a href="${jobUrl}" style="display:inline-block;margin:12px 0;padding:12px 24px;background:#1e3a8a;color:white;border-radius:10px;text-decoration:none;font-weight:600">
                View Job Brief →
              </a>
              <p style="color:#94a3b8;font-size:13px;margin-top:24px">Powered by BTLR Home OS</p>
            </div>
          `,
        }),
      }).catch(() => {});
    }

    // Email homeowner when contractor declines
    if (status === "declined" && homeowner_email) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: homeowner_email,
          subject: `A contractor passed on your ${trade} job`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
              <h2 style="color:#0f1f3d;margin-bottom:8px">A contractor passed on your job</h2>
              <p style="color:#475569">The contractor wasn't available for your <strong>${trade}</strong> request. No worries — you can share your job link with another contractor to get a fresh response.</p>
              <div style="background:#f0f4f8;border-radius:12px;padding:16px 20px;margin:20px 0">
                <p style="margin:0 0 6px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">Issue</p>
                <p style="margin:0;color:#0f172a;font-weight:600">${issue_summary ?? ""}</p>
              </div>
              <p style="color:#475569">Share your job link with another contractor — they can view the full brief and accept directly.</p>
              <p style="color:#94a3b8;font-size:13px;margin-top:24px">Powered by BTLR Home OS</p>
            </div>
          `,
        }),
      }).catch(() => {});
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
