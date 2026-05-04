// PUT /api/me — update the current user's profile (name, email, phone)
// Called by Settings > Profile card.
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

export async function PUT(req) {
  try {
    const supabase = authedClient(req);

    // Verify session
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { first_name, email, phone } = body;

    // Upsert into user_profiles
    const profileUpdate = {};
    if (first_name !== undefined) profileUpdate.first_name = first_name;
    if (phone      !== undefined) profileUpdate.phone      = phone;

    if (Object.keys(profileUpdate).length > 0) {
      profileUpdate.id         = user.id;
      profileUpdate.updated_at = new Date().toISOString();

      const { error: profileErr } = await supabase
        .from("user_profiles")
        .upsert(profileUpdate, { onConflict: "id" });

      if (profileErr) throw profileErr;
    }

    // If email changed, update Supabase Auth (triggers verification email)
    if (email && email !== user.email) {
      const { error: emailErr } = await supabase.auth.updateUser({ email });
      if (emailErr) throw emailErr;
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/me]", err);
    return Response.json({ error: err.message ?? "Update failed" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("first_name, phone, tier")
      .eq("id", user.id)
      .maybeSingle();

    return Response.json({
      id:         user.id,
      email:      user.email,
      first_name: profile?.first_name ?? user.user_metadata?.first_name ?? "",
      phone:      profile?.phone ?? "",
      tier:       profile?.tier ?? "free",
    });
  } catch (err) {
    console.error("[GET /api/me]", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
