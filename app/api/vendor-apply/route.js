import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { trade, name, company, email, phone, zip } = await req.json();

    if (!trade || !name || !company || !email) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Save to Supabase
    const { error: dbError } = await supabase
      .from("vendor_applications")
      .insert({ trade, name, company, email, phone: phone || null, zip: zip || null });

    if (dbError) throw dbError;

    // Notify you (Lindsey) that a new vendor applied
    if (process.env.RESEND_API_KEY && process.env.NEXT_PUBLIC_APP_URL) {
      const notifyEmail = process.env.VENDOR_NOTIFY_EMAIL || "lindsey@eatplayloveot.com";
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: notifyEmail,
          subject: `New vendor application: ${name} (${trade})`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
              <h2 style="color:#2C5F8A">New Vendor Application</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:8px 0;color:#6B6558;width:120px">Trade</td><td style="padding:8px 0;font-weight:600">${trade}</td></tr>
                <tr><td style="padding:8px 0;color:#6B6558">Name</td><td style="padding:8px 0">${name}</td></tr>
                <tr><td style="padding:8px 0;color:#6B6558">Company</td><td style="padding:8px 0">${company}</td></tr>
                <tr><td style="padding:8px 0;color:#6B6558">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
                <tr><td style="padding:8px 0;color:#6B6558">Phone</td><td style="padding:8px 0">${phone || "—"}</td></tr>
                <tr><td style="padding:8px 0;color:#6B6558">ZIP</td><td style="padding:8px 0">${zip || "—"}</td></tr>
              </table>
              <p style="margin-top:24px;color:#6B6558;font-size:13px">View all applications in your <a href="https://supabase.com/dashboard" style="color:#2C5F8A">Supabase dashboard</a> → vendor_applications table.</p>
            </div>
          `,
        }),
      });

      // Confirmation email to the vendor
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "You're on the BTLR Trusted Network waitlist",
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
              <h2 style="color:#2C5F8A">Thanks for applying, ${name}!</h2>
              <p style="color:#475569;line-height:1.7">
                We received your application for <strong>${trade}</strong> in the BTLR Trusted Network.
                We're onboarding contractors by area and trade — we'll be in touch soon to verify your license and activate your profile.
              </p>
              <p style="color:#475569;line-height:1.7">
                In the meantime, if you have any questions reply to this email or reach us at
                <a href="mailto:support@btlrai.com" style="color:#2C5F8A">support@btlrai.com</a>.
              </p>
              <p style="color:#94a3b8;font-size:13px;margin-top:32px">— The BTLR Team · btlrai.com</p>
            </div>
          `,
        }),
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("vendor-apply error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
