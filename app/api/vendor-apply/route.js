import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Legacy route — still used by the nav quick-modal if present.
// Maps old simple fields to the current vendor_applications schema.
export async function POST(req) {
  try {
    const { trade, name, company, email, phone, zip } = await req.json();

    if (!name || !email) {
      return Response.json({ error: "Name and email are required" }, { status: 400 });
    }

    const { data, error: dbError } = await supabase
      .from("vendor_applications")
      .insert({
        owner_name:         name    || null,
        business_name:      company || null,
        business_email:     email   || null,
        business_phone:     phone   || null,
        address_zip:        zip     || null,
        service_categories: trade ? [trade] : null,
        status:             "draft",
      })
      .select("id")
      .single();

    if (dbError) throw dbError;

    const appId = data?.id;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://btlrai.com";
    const notifyEmail = process.env.VENDOR_NOTIFY_EMAIL || "lindsey@eatplayloveot.com";

    // Notify admin
    if (process.env.RESEND_API_KEY) {
      await fetch(`${appUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: notifyEmail,
          subject: `New vendor interest: ${name}${company ? ` (${company})` : ""} — ${trade || "General"}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
              <div style="background:#1B2D47;padding:24px 28px;margin-bottom:0">
                <span style="font-family:sans-serif;font-size:18px;font-weight:800;color:#2C5F8A;letter-spacing:0.14em">BTLR</span>
              </div>
              <div style="padding:28px;background:#f7f2ec;border:1px solid #e8e3dc">
                <h2 style="color:#1C1914;margin:0 0 16px">New Vendor Interest Form</h2>
                <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e8e3dc">
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8;width:120px">Trade</td><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #f0ede8">${trade || "—"}</td></tr>
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Name</td><td style="padding:10px 14px;border-bottom:1px solid #f0ede8">${name}</td></tr>
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Company</td><td style="padding:10px 14px;border-bottom:1px solid #f0ede8">${company || "—"}</td></tr>
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Email</td><td style="padding:10px 14px;border-bottom:1px solid #f0ede8"><a href="mailto:${email}">${email}</a></td></tr>
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px;border-bottom:1px solid #f0ede8">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #f0ede8">${phone || "—"}</td></tr>
                  <tr><td style="padding:10px 14px;color:#6B6558;font-size:13px">ZIP</td><td style="padding:10px 14px">${zip || "—"}</td></tr>
                </table>
                ${appId ? `<a href="${appUrl}/admin/vendors/${appId}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#2C5F8A;color:white;text-decoration:none;font-weight:700;font-size:13px">View in Admin →</a>` : ""}
              </div>
            </div>
          `,
        }),
      });

      // Confirmation to vendor
      await fetch(`${appUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "Thanks for your interest in the BTLR Trusted Network",
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto">
              <div style="background:#1B2D47;padding:24px 28px">
                <span style="font-family:sans-serif;font-size:18px;font-weight:800;color:#2C5F8A;letter-spacing:0.14em">BTLR</span>
              </div>
              <div style="padding:36px 28px">
                <h2 style="color:#1C1914;margin:0 0 12px">We received your information</h2>
                <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">Hi ${name},</p>
                <p style="color:#6B6558;line-height:1.7;margin:0 0 16px">
                  Thanks for expressing interest in joining the BTLR Trusted Network${trade ? ` as a <strong>${trade}</strong> professional` : ""}. Our team will review your submission and reach out within a few business days.
                </p>
                <p style="color:#6B6558;line-height:1.7;margin:0 0 24px">
                  To complete a full application and be considered for the network, visit our application page:
                </p>
                <a href="${appUrl}/apply" style="display:inline-block;padding:13px 28px;background:#2C5F8A;color:white;text-decoration:none;font-weight:700;font-size:13px">
                  Complete Full Application →
                </a>
                <p style="color:#94a3b8;font-size:12px;margin-top:28px">Questions? <a href="mailto:support@btlrai.com" style="color:#2C5F8A">support@btlrai.com</a></p>
              </div>
            </div>
          `,
        }),
      });
    }

    return Response.json({ success: true, id: appId });
  } catch (err) {
    console.error("vendor-apply error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
