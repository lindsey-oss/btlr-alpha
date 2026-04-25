// Email notifications via Resend (resend.com - free 3k emails/month)
// Add RESEND_API_KEY to your Vercel environment variables

export async function POST(req) {
  try {
    const { to, subject, html } = await req.json();

    if (!process.env.RESEND_API_KEY) {
      console.log("No RESEND_API_KEY — email skipped:", subject);
      return Response.json({ success: true, skipped: true });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "BTLR <onboarding@resend.dev>",
        to,
        subject,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Email failed");
    return Response.json({ success: true, data });
  } catch (err) {
    console.error("send-email error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
