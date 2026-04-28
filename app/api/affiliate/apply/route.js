// POST /api/affiliate/apply
// Called after a homeowner signs up via an affiliate link.
// Body: { code: string, userId: string }
// Auto-populates the homeowner's saved_contacts with the affiliate's info.
// Idempotent — duplicate calls for the same (userId, affiliateId) are a no-op.

import { createClient } from "@supabase/supabase-js";

// Role → category mapping
const ROLE_CATEGORY = {
  realtor:  "real_estate",
  lender:   "real_estate",
  escrow:   "real_estate",
  title:    "real_estate",
  attorney: "real_estate",
  insurance_broker:  "insurance",
  home_warranty:     "insurance",
};

export async function POST(req) {
  try {
    const { code, userId } = await req.json();
    if (!code || !userId) {
      return Response.json({ error: "code and userId required" }, { status: 400 });
    }

    // Service role for writes (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Look up the affiliate
    const { data: affiliate, error: lookupErr } = await supabase
      .from("affiliates")
      .select("id, name, company, role, phone, email, photo_url, website")
      .eq("code", code.toLowerCase().trim())
      .eq("is_active", true)
      .maybeSingle();

    if (lookupErr) throw lookupErr;
    if (!affiliate) return Response.json({ error: "Affiliate not found" }, { status: 404 });

    const category = ROLE_CATEGORY[affiliate.role] ?? "real_estate";

    // 2. Insert saved_contact (UNIQUE constraint on user_id + affiliate_id handles duplicates)
    const { error: insertErr } = await supabase
      .from("saved_contacts")
      .upsert({
        user_id:      userId,
        affiliate_id: affiliate.id,
        name:         affiliate.name,
        company:      affiliate.company ?? null,
        role:         affiliate.role,
        category,
        phone:        affiliate.phone ?? null,
        email:        affiliate.email ?? null,
        website:      affiliate.website ?? null,
        photo_url:    affiliate.photo_url ?? null,
      }, { onConflict: "user_id,affiliate_id", ignoreDuplicates: true });

    if (insertErr) console.error("[affiliate/apply] insert error:", insertErr.message);

    // 3. Log the referral event (ignore duplicates)
    await supabase
      .from("affiliate_referrals")
      .upsert({ affiliate_id: affiliate.id, user_id: userId }, {
        onConflict: "affiliate_id,user_id",
        ignoreDuplicates: true,
      });

    return Response.json({ success: true, contact_created: !insertErr });
  } catch (err) {
    console.error("[affiliate/apply] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
