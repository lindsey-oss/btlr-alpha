// Plaid — Step 2: Exchange public token for access token
// Called after user completes Plaid Link flow

import { createClient } from "@supabase/supabase-js";
import { getPostHogClient } from "../../../lib/posthog-server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { public_token } = await req.json();

    const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");

    const config = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET": process.env.PLAID_SECRET,
        },
      },
    });

    const plaid = new PlaidApi(config);

    // Exchange the temporary public_token for a permanent access_token
    const exchangeResponse = await plaid.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeResponse.data.access_token;

    // Save access token to Supabase for future data pulls
    const { data: existing } = await supabase
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("properties")
        .update({ plaid_access_token: accessToken })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("properties")
        .insert({ address: "My Home", plaid_access_token: accessToken });
    }

    // Track bank connection server-side
    const posthog = getPostHogClient();
      distinctId: existing?.id ? String(existing.id) : "anonymous",
      event: "bank_account_connected",
      properties: { plaid_env: process.env.PLAID_ENV || "sandbox" },
    });

    // Immediately fetch mortgage data so dashboard populates right away
    try {
      const origin = req.headers.get("origin") || "http://localhost:3000";
      await fetch(`${origin}/api/plaid-data`, { method: "GET" });
    } catch { /* Non-fatal */ }

    return Response.json({ success: true });
  } catch (err) {
    console.error("Plaid exchange error:", err?.response?.data || err.message);
    return Response.json({ error: "Failed to connect bank account." }, { status: 500 });
  }
}
