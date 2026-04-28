// GET /api/affiliate/lookup?code=XXX
// Public — no auth required. Returns affiliate profile for the landing page.

import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return Response.json({ error: "code required" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const { data, error } = await supabase
    .from("affiliates")
    .select("id, code, name, company, role, phone, email, photo_url, bio, website")
    .eq("code", code.toLowerCase().trim())
    .eq("is_active", true)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data)  return Response.json({ error: "Affiliate not found" }, { status: 404 });

  return Response.json({ affiliate: data });
}
