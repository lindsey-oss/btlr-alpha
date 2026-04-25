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

export async function GET(req, { params }) {
  if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;

    const [appResult, docsResult] = await Promise.all([
      supabase.from("vendor_applications").select("*").eq("id", id).single(),
      supabase.from("vendor_application_documents").select("*").eq("application_id", id).order("created_at", { ascending: true }),
    ]);

    if (appResult.error) throw appResult.error;

    // Generate signed URLs for documents
    const docs = docsResult.data || [];
    const docsWithUrls = await Promise.all(
      docs.map(async (doc) => {
        const { data: signed } = await supabase.storage
          .from("vendor-docs")
          .createSignedUrl(doc.file_path, 3600); // 1 hour
        return { ...doc, signed_url: signed?.signedUrl ?? null };
      })
    );

    return Response.json({ data: appResult.data, documents: docsWithUrls });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
