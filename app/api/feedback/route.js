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

    return Response.json({ success: true });
  } catch (err) {
    console.error("[feedback] error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
