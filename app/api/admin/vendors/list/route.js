import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function checkAdmin(req) {
  const cookie = req.headers.get("cookie") || "";
  const token = cookie.split(";").find(c => c.trim().startsWith("btlr_admin="))?.split("=")[1];
  return token === process.env.ADMIN_PASSWORD;
}

export async function GET(req) {
  if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("vendor_applications")
      .select("id, business_name, owner_name, business_email, primary_specialty, status, submitted_at, created_at, admin_score, years_in_business")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
