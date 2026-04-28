import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ error: "Missing application id" }, { status: 400 });

    // Fetch current application
    const { data: app, error: fetchErr } = await supabase
      .from("vendor_applications")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr) throw fetchErr;

    // Hard gate: must have license and insurance
    if (!app.license_number || !app.insurance_provider) {
      return Response.json({ error: "License number and insurance provider are required before submitting." }, { status: 422 });
    }

    // Hard gate: must have accepted all agreements
    const agreements = [
      "agree_license_insurance", "agree_response_window", "agree_transparent_pricing",
      "agree_written_estimates", "agree_no_upsells", "agree_professional",
      "agree_job_updates", "agree_rating_system", "agree_performance_standards",
      "agree_probationary_removal"
    ];
    const missingAgreements = agreements.filter(a => !app[a]);
    if (missingAgreements.length > 0) {
      return Response.json({ error: "All BTLR standards agreements must be accepted." }, { status: 422 });
    }

    // Mark submitted
    const { error: updateErr } = await supabase
      .from("vendor_applications")
      .update({ status: "pending_review", submitted_at: new Date().toISOString(), final_confirmation: true })
      .eq("id", id);
    if (updateErr) throw updateErr;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://btlrai.com";
    const notifyEmail = process.env.VENDOR_NOTIFY_EMAIL || "lindsey@eatplayloveot.com";

    // Notify admin
    if (process.env.RESEND_API_KEY) {
      await fetch(`${appUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: notifyEmail,
          subject: `New Vendor Application: ${app.business_name || "Unknown"} (${app.primary_specialty || app.service_categories?.[0] || "General"})`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#1B2D47;padding:28px 32px;margin-bottom:0">
                <span style="font-family:sans-serif;font-size:20px;font-weight:800;color:#2C5F8A;letter-spacing:0.14em">BTLR</span>
              </div>
              <div style="padding:32px;background:#f7f2ec;border:1px solid #e8e3dc">
                <h2 style="color:#1C1914;margin:0 0 8px">New Vendor Application Received</h2>
                <p style="color:#6B6558;margin:0 0 24px">A new application is ready for review in your admin dashboard.</p>
                <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e8e3dc">
                  <tr><td style="padding:12px 16px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8;width:160px">Business</td><td style="padding:12px 16px;font-weight:600;border-bottom:1px solid #f0ede8">${app.business_name || "—"}</td></tr>
                  <tr><td style="padding:12px 16px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Owner</td><td style="padding:12px 16px;border-bottom:1px solid #f0ede8">${app.owner_name || "—"}</td></tr>
                  <tr><td style="padding:12px 16px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Email</td><td style="padding:12px 16px;border-bottom:1px solid #f0ede8"><a href="mailto:${app.business_email}">${app.business_email || "—"}</a></td></tr>
                  <tr><td style="padding:12px 16px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Specialty</td><td style="padding:12px 16px;border-bottom:1px solid #f0ede8">${app.primary_specialty || "—"}</td></tr>
                  <tr><td style="padding:12px 16px;color:#6B6558;font-size:13px">Years in Business</td><td style="padding:12px 16px">${app.years_in_business || "—"}</td></tr>
                </table>
                <a href="${appUrl}/admin/vendors/${id}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#2C5F8A;color:white;text-decoration:none;font-weight:700;font-size:13px">Review Application →</a>
              </div>
            </div>
          `,
        }),
      });

      // Confirmation to applicant
      if (app.business_email) {
        await fetch(`${appUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: app.business_email,
            subject: "Your BTLR Trusted Network application has been received",
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#1B2D47;padding:28px 32px">
                  <span style="font-family:sans-serif;font-size:20px;font-weight:800;color:#2C5F8A;letter-spacing:0.14em">BTLR</span>
                </div>
                <div style="padding:40px 32px">
                  <h2 style="color:#1C1914;margin:0 0 12px">Application Received</h2>
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">Hi ${app.owner_name || "there"},</p>
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">
                    We've received your application to join the BTLR Trusted Network for <strong>${app.business_name || "your business"}</strong>.
                  </p>
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">
                    Our team reviews every application personally. You can expect to hear from us within <strong>5–7 business days</strong>.
                  </p>
                  <p style="color:#6B6558;line-height:1.7;margin:0 0 32px">
                    If we need any additional information, we'll reach out directly. Otherwise, you'll receive an email with our decision.
                  </p>
                  <div style="background:#f7f2ec;border-left:3px solid #2C5F8A;padding:16px 20px;margin-bottom:32px">
                    <p style="color:#1C1914;font-weight:600;margin:0 0 4px;font-size:14px">What happens next?</p>
                    <p style="color:#6B6558;margin:0;font-size:13px;line-height:1.6">We'll verify your license and insurance, contact your references, and review your work samples before making a decision.</p>
                  </div>
                  <p style="color:#94a3b8;font-size:12px;margin:0">Questions? Email us at <a href="mailto:support@btlrai.com" style="color:#2C5F8A">support@btlrai.com</a></p>
                </div>
              </div>
            `,
          }),
        });
      }
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("vendor-apply/submit error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
