// Home Warranty / Maintenance Policy Parser
// Extracts structured coverage data from uploaded PDF or text

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";

export async function POST(req) {
  try {
    const url    = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const propId = url.searchParams.get("propertyId");

    const contentType = req.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
      const arrayBuffer = await req.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      text = await extractPdfTextAsync(buffer);
    } else {
      text = await req.text();
    }

    if (!text || text.trim().length < 20) {
      return Response.json({ error: "Could not extract text from document." }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a home warranty and maintenance policy document parser.
Extract ALL of the following fields from the policy document. Be thorough.

Return ONLY valid JSON with these exact keys:
- provider: company name (string or null)
- planName: plan/tier name e.g. "Gold Plan", "Total Home Warranty" (string or null)
- policyNumber: policy or contract number (string or null)
- serviceFee: service call fee / deductible per claim in dollars (number or null)
- coverageItems: array of strings — what IS covered. Be specific: list systems and appliances covered. e.g. ["HVAC heating", "Central air conditioning", "Water heater", "Plumbing stoppages", "Electrical panel", "Dishwasher", "Refrigerator"]
- exclusions: array of strings — what is NOT covered or explicitly excluded. e.g. ["Pre-existing conditions", "Code violations", "Cosmetic defects", "Outdoor sprinklers", "Pool/spa equipment"]
- coverageLimits: object with system → dollar limit pairs where specified, e.g. {"HVAC": 2000, "Roof leak": 500} (object or null)
- effectiveDate: coverage start date (YYYY-MM-DD or null)
- expirationDate: coverage end/renewal date (YYYY-MM-DD or null)
- autoRenews: whether the policy auto-renews (boolean or null)
- paymentAmount: monthly or annual premium amount in dollars (number or null)
- paymentFrequency: "monthly" or "annual" (string or null)
- paymentDueDate: day of month payment is due if monthly, e.g. 1 (number or null)
- claimPhone: phone number to call for claims (string or null)
- claimUrl: website URL for filing claims online (string or null)
- claimEmail: email for claims if present (string or null)
- waitingPeriod: waiting period before coverage starts, e.g. "30 days" (string or null)
- responseTime: guaranteed response time after claim, e.g. "24 hours" (string or null)
- maxAnnualBenefit: total maximum payout per year if stated (number or null)

Use null for any field not found. coverageItems and exclusions must always be arrays (empty array if none found).`,
        },
        {
          role: "user",
          content: `Parse this home warranty/maintenance policy document:\n\n${text.slice(0, 14000)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Persist to Supabase if we have user/property context
    if (userId && propId) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const { error } = await supabase.from("home_warranties").upsert({
        user_id:             userId,
        property_id:         parseInt(propId),
        provider:            parsed.provider,
        plan_name:           parsed.planName,
        policy_number:       parsed.policyNumber,
        service_fee:         parsed.serviceFee,
        coverage_items:      parsed.coverageItems ?? [],
        exclusions:          parsed.exclusions ?? [],
        coverage_limits:     parsed.coverageLimits,
        effective_date:      parsed.effectiveDate,
        expiration_date:     parsed.expirationDate,
        auto_renews:         parsed.autoRenews,
        payment_amount:      parsed.paymentAmount,
        payment_frequency:   parsed.paymentFrequency,
        payment_due_date:    parsed.paymentDueDate,
        claim_phone:         parsed.claimPhone,
        claim_url:           parsed.claimUrl,
        claim_email:         parsed.claimEmail,
        waiting_period:      parsed.waitingPeriod,
        response_time:       parsed.responseTime,
        max_annual_benefit:  parsed.maxAnnualBenefit,
        parsed_at:           new Date().toISOString(),
      }, { onConflict: "user_id,property_id" });

      if (error) console.error("[parse-warranty] DB error:", error.message);
    }

    return Response.json({ success: true, data: parsed });
  } catch (err) {
    console.error("[parse-warranty] error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
