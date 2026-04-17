// Property Data — auto-fetch tax, value, and details from address
// Uses ATTOM Data API (attomdata.com) — free trial available
// Fallback: OpenAI estimates if no API key configured

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { address } = await req.json();
    if (!address) return Response.json({ error: "Address required" }, { status: 400 });

    let propertyData = null;

    // ── Try ATTOM Data API first ──────────────────────────────────────
    if (process.env.ATTOM_API_KEY) {
      try {
        const encoded = encodeURIComponent(address);
        const res = await fetch(
          `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?address=${encoded}`,
          {
            headers: {
              "apikey": process.env.ATTOM_API_KEY,
              "Accept": "application/json",
            },
          }
        );
        const json = await res.json();
        const prop = json?.property?.[0];

        if (prop) {
          propertyData = {
            source:            "attom",
            homeValue:         prop.avm?.amount?.value ?? null,
            propertyTaxAnnual: prop.assessment?.tax?.taxamt ?? null,
            yearBuilt:         prop.summary?.yearbuilt ?? null,
            sqft:              prop.building?.size?.universalsize ?? null,
            bedrooms:          prop.building?.rooms?.beds ?? null,
            bathrooms:         prop.building?.rooms?.bathsfull ?? null,
            lotSize:           prop.lot?.lotsize2 ?? null,
          };
        }
      } catch (attomErr) {
        console.warn("ATTOM lookup failed, falling back to AI estimate:", attomErr.message);
      }
    }

    // ── Fallback: AI-powered estimate ─────────────────────────────────
    if (!propertyData) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a real estate data assistant. Based on the address provided, give realistic estimated property data for that area.
Return JSON only: { "homeValue": number, "propertyTaxAnnual": number, "yearBuilt": number|null, "sqft": number|null, "source": "ai-estimate" }
Base estimates on typical values for that city/region. Be conservative and realistic.`,
          },
          {
            role: "user",
            content: `Estimate property data for: ${address}`,
          },
        ],
      });

      const parsed = JSON.parse(completion.choices[0].message.content);
      propertyData = { ...parsed, source: "ai-estimate" };
    }

    // ── Save to Supabase ───────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();

    const updates = {
      home_value:            propertyData.homeValue,
      property_tax_annual:   propertyData.propertyTaxAnnual,
    };

    if (existing?.id) {
      await supabase.from("properties").update(updates).eq("id", existing.id);
    }

    return Response.json({ success: true, data: propertyData });
  } catch (err) {
    console.error("property-data error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
