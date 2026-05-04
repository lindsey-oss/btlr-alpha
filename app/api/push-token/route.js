// POST /api/push-token — register or refresh a device push token
// Called by the native app on every launch after permission is granted.
// Auth: Bearer token in Authorization header.

import { createClient } from "@supabase/supabase-js";

function authedClient(req) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );
}

export async function POST(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token, platform } = await req.json();
    if (!token)    return Response.json({ error: "token required" }, { status: 400 });
    if (!platform) return Response.json({ error: "platform required" }, { status: 400 });

    // Upsert — one row per user+token combination
    const { error } = await supabase
      .from("push_tokens")
      .upsert(
        { user_id: user.id, token, platform, updated_at: new Date().toISOString() },
        { onConflict: "user_id,token" }
      );

    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/push-token]", err);
    return Response.json({ error: err.message ?? "Failed to register token" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await req.json();
    if (!token) return Response.json({ error: "token required" }, { status: 400 });

    await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", user.id)
      .eq("token", token);

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/push-token]", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
