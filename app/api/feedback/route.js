import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const body = await req.json();
    const { whatHappened, whatTrying, currentPage, userId, userEmail, userAgent } = body;

    if (!whatHappened?.trim()) {
      return Response.json({ error: "whatHappened is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[feedback] Missing Supabase env vars — feedback not saved");
      return Response.json({ success: true, warn: "not_persisted" });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.from("feedback").insert({
      user_id:       userId   ?? null,
      user_email:    userEmail ?? null,
      what_happened: whatHappened.trim(),
      what_trying:   whatTrying?.trim() ?? null,
      current_page:  currentPage ?? null,
      user_agent:    userAgent ?? null,
      app_version:   "1.0",
      status:        "new",
    });

    if (error) {
      console.error("[feedback] DB insert error:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Email notification via Resend
    if (process.env.RESEND_API_KEY) {
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "BTLR <onboarding@resend.dev>";
      const emailBody = [
        `<h2 style="color:#E8742A;margin:0 0 16px">New BTLR Feedback</h2>`,
        `<p><strong>What happened:</strong><br>${whatHappened.trim().replace(/\n/g, "<br>")}</p>`,
        whatTrying?.trim() ? `<p><strong>What they were trying to do:</strong><br>${whatTrying.trim().replace(/\n/g, "<br>")}</p>` : "",
        userEmail ? `<p><strong>User:</strong> ${userEmail}</p>` : "",
        currentPage ? `<p><strong>Page:</strong> ${currentPage}</p>` : "",
        userAgent ? `<p style="font-size:11px;color:#888"><strong>User agent:</strong> ${userAgent}</p>` : "",
      ].filter(Boolean).join("\n");

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: "btlr.info@gmail.com",
          subject: `[BTLR Feedback] ${whatHappened.trim().slice(0, 60)}${whatHappened.trim().length > 60 ? "…" : ""}`,
          html: emailBody,
        }),
      }).catch(e => console.warn("[feedback] email send failed:", e.message));
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[feedback] error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
