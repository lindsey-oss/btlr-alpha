// POST /api/affiliate/upload-photo
// Accepts a multipart form with a single "file" field.
// Uploads to Supabase storage bucket "affiliate-assets" using service role.
// Returns { url } — the public URL of the uploaded photo.
// No auth required — called from the public /affiliate registration page.

import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file     = formData.get("file");

    if (!file || typeof file === "string") {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate: image only, max 5 MB
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      return Response.json({ error: "Only JPEG, PNG, WebP, or GIF allowed" }, { status: 400 });
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "File must be under 5 MB" }, { status: 400 });
    }

    const ext      = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const filename = `headshots/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const arrayBuffer = await file.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("affiliate-assets")
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from("affiliate-assets")
      .getPublicUrl(filename);

    return Response.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error("[affiliate/upload-photo] error:", err);
    return Response.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}
