import { createClient } from "@supabase/supabase-js";

// Use service role for storage operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const applicationId = formData.get("applicationId");
    const documentType = formData.get("documentType");

    if (!file || !applicationId || !documentType) {
      return Response.json({ error: "Missing file, applicationId, or documentType" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name.split(".").pop();
    const filePath = `${applicationId}/${documentType}/${Date.now()}.${ext}`;

    // Upload to Supabase Storage (bucket: vendor-docs)
    const { error: uploadErr } = await supabase.storage
      .from("vendor-docs")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      // If bucket doesn't exist yet, return a helpful error
      if (uploadErr.message?.includes("Bucket not found")) {
        return Response.json({ error: "Storage bucket 'vendor-docs' not found. Create it in Supabase Storage first." }, { status: 500 });
      }
      throw uploadErr;
    }

    // Save document record
    const { error: dbErr } = await supabase
      .from("vendor_application_documents")
      .insert({
        application_id: applicationId,
        document_type:  documentType,
        file_name:      file.name,
        file_path:      filePath,
        file_size:      file.size,
        mime_type:      file.type,
      });

    if (dbErr) throw dbErr;

    return Response.json({ success: true, filePath, fileName: file.name });
  } catch (err) {
    console.error("vendor-apply/upload error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
