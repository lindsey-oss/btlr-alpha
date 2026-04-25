import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (id) {
      // Update existing draft
      const { data, error } = await supabase
        .from("vendor_applications")
        .update({ ...fields, status: fields.status ?? "draft" })
        .eq("id", id)
        .select("id")
        .single();
      if (error) throw error;
      return Response.json({ success: true, id: data.id });
    } else {
      // Create new draft
      const { data, error } = await supabase
        .from("vendor_applications")
        .insert({ ...fields, status: "draft" })
        .select("id")
        .single();
      if (error) throw error;
      return Response.json({ success: true, id: data.id });
    }
  } catch (err) {
    console.error("vendor-apply/save error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

    const { data, error } = await supabase
      .from("vendor_applications")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
