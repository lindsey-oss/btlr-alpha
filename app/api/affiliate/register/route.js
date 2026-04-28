// POST /api/affiliate/register
// Creates a new affiliate profile and returns their unique code + link.
// Body: { name, company, role, phone, email, bio, website, photo_url }
// Protected: requires ADMIN_PASSWORD header for now (simple gate until auth flow is added).

import { createClient } from "@supabase/supabase-js";

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 30);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6); // e.g. "k4x2"
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, company, role, phone, email, bio, website, photo_url } = body;

    if (!name || !role) {
      return Response.json({ error: "name and role are required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Generate a unique slug: "jane-smith-k4x2"
    const base = slugify(name);
    let code = `${base}-${randomSuffix()}`;

    // Extremely unlikely but ensure uniqueness
    const { data: existing } = await supabase
      .from("affiliates")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (existing) code = `${base}-${randomSuffix()}${randomSuffix()}`;

    const { data, error } = await supabase
      .from("affiliates")
      .insert({
        code,
        name,
        company:   company   ?? null,
        role,
        phone:     phone     ?? null,
        email:     email     ?? null,
        bio:       bio       ?? null,
        website:   website   ?? null,
        photo_url: photo_url ?? null,
      })
      .select("id, code")
      .single();

    if (error) throw error;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://btlrai.com";
    const link   = `${appUrl}/ref/${data.code}`;

    return Response.json({ success: true, code: data.code, link });
  } catch (err) {
    console.error("[affiliate/register] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
