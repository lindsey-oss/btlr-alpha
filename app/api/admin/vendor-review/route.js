import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function checkAdmin(req) {
  const cookie = req.headers.get("cookie") || "";
  const token = cookie.split(";").find(c => c.trim().startsWith("btlr_admin="))?.split("=")[1];
  return token === process.env.ADMIN_PASSWORD;
}

export async function POST(req) {
  if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, action, admin_notes, admin_score_breakdown, more_info_request } = body;

    const STATUS_MAP = {
      approve:      "approved",
      reject:       "rejected",
      probationary: "probationary",
      more_info:    "needs_more_info",
    };

    const newStatus = STATUS_MAP[action];
    if (!newStatus) return Response.json({ error: "Invalid action" }, { status: 400 });

    // Calculate total score if breakdown provided
    let total = null;
    if (admin_score_breakdown) {
      total = Object.values(admin_score_breakdown).reduce((a, b) => a + (Number(b) || 0), 0);
    }

    const { error } = await supabase
      .from("vendor_applications")
      .update({
        status:                newStatus,
        admin_notes:           admin_notes ?? null,
        admin_score:           total,
        admin_score_licensing:       admin_score_breakdown?.licensing ?? null,
        admin_score_reviews:         admin_score_breakdown?.reviews ?? null,
        admin_score_work_quality:    admin_score_breakdown?.work_quality ?? null,
        admin_score_communication:   admin_score_breakdown?.communication ?? null,
        admin_score_experience:      admin_score_breakdown?.experience ?? null,
        admin_score_professionalism: admin_score_breakdown?.professionalism ?? null,
        admin_more_info_request:     more_info_request ?? null,
        admin_reviewed_at:     new Date().toISOString(),
        is_probationary:       action === "probationary",
      })
      .eq("id", id);

    if (error) throw error;

    // Fetch application to get email
    const { data: app } = await supabase.from("vendor_applications").select("business_email,owner_name,business_name").eq("id", id).single();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://btlrai.com";

    // Send status email to applicant
    if (process.env.RESEND_API_KEY && app?.business_email) {
      const emailMap = {
        approved: {
          subject: `Welcome to the BTLR Trusted Network — ${app.business_name}`,
          message: `We're pleased to inform you that your application to join the BTLR Trusted Network has been <strong>approved</strong>. Our team will reach out within 1–2 business days with onboarding details.`,
        },
        probationary: {
          subject: `BTLR Trusted Network — Conditional Approval`,
          message: `Your application has been conditionally approved. You'll be onboarded on a probationary basis. Please review BTLR's standards and maintain them consistently to achieve full network membership.`,
        },
        rejected: {
          subject: `BTLR Trusted Network Application Update`,
          message: `After careful review, we're unable to approve your application to join the BTLR Trusted Network at this time. We appreciate your interest and encourage you to reapply in the future if your circumstances change.`,
        },
        needs_more_info: {
          subject: `BTLR Application — Additional Information Needed`,
          message: `We're reviewing your application and need a bit more information before we can proceed. ${more_info_request ? `<br/><br/><strong>What we need:</strong> ${more_info_request}` : ""}`,
        },
      };

      const { subject, message } = emailMap[newStatus] || {};
      if (subject) {
        await fetch(`${appUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: app.business_email,
            subject,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#1B2D47;padding:28px 32px">
                  <span style="font-family:sans-serif;font-size:20px;font-weight:800;color:#2C5F8A;letter-spacing:0.14em">BTLR</span>
                </div>
                <div style="padding:40px 32px">
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">Hi ${app.owner_name || "there"},</p>
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 24px">${message}</p>
                  <p style="color:#94a3b8;font-size:12px;margin:0">Questions? Email us at <a href="mailto:support@btlrai.com" style="color:#2C5F8A">support@btlrai.com</a></p>
                </div>
              </div>
            `,
          }),
        });
      }
    }

    return Response.json({ success: true, status: newStatus });
  } catch (err) {
    console.error("vendor-review error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// Admin login
export async function PUT(req) {
  try {
    const { password } = await req.json();
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }
    const res = Response.json({ success: true });
    res.headers.set("Set-Cookie", `btlr_admin=${password}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res;
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
