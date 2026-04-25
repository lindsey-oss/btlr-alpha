// Home Insurance Policy Parser
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
          content: `You are a home insurance policy document parser.
Extract ALL of the following fields from the declarations page or full policy. Be thorough.

Return ONLY valid JSON with these exact keys:
- provider: insurance company name (string or null)
- policyNumber: policy number or ID (string or null)
- policyType: policy form type e.g. "HO-3", "HO-5", "HO-6", "DP-3" (string or null)
- agentName: agent or agency name (string or null)
- agentPhone: agent phone number (string or null)
- agentEmail: agent email (string or null)
- dwellingCoverage: Coverage A — dwelling replacement cost amount in dollars (number or null)
- otherStructures: Coverage B — other structures amount in dollars (number or null)
- personalProperty: Coverage C — personal property amount in dollars (number or null)
- lossOfUse: Coverage D — loss of use / additional living expenses amount (number or null)
- liabilityCoverage: Coverage E — personal liability amount in dollars (number or null)
- medicalPayments: Coverage F — medical payments to others amount (number or null)
- deductibleStandard: standard / all-peril deductible in dollars (number or null)
- deductibleWind: wind or hail deductible if listed separately (number or null)
- deductibleHurricane: hurricane deductible if listed separately (number or null)
- annualPremium: total annual premium in dollars (number or null)
- paymentAmount: installment payment amount if paid in installments (number or null)
- paymentFrequency: "monthly", "annual", or "semi-annual" (string or null)
- paymentDueDate: day of month payment is due if monthly, e.g. 1 (number or null)
- paymentMethod: how premium is paid e.g. "escrow", "direct bill", "auto-pay" (string or null)
- effectiveDate: policy start date (YYYY-MM-DD or null)
- expirationDate: policy expiration / renewal date (YYYY-MM-DD or null)
- autoRenews: whether the policy auto-renews (boolean or null)
- coverageItems: array of strings — what IS covered. Be specific. e.g. ["Fire and smoke damage", "Windstorm and hail", "Theft", "Water damage from burst pipes", "Falling objects", "Ice and snow collapse", "Vandalism", "Lightning"]
- exclusions: array of strings — what is NOT covered / explicitly excluded. e.g. ["Flood", "Earthquake", "Mold", "Sewer backup", "Gradual water damage", "Pest/rodent damage", "Power failure", "Intentional loss"]
- endorsements: array of strings — riders or add-ons attached to the policy. e.g. ["Jewelry floater $5,000", "Home office coverage $2,500", "Identity theft protection", "Water backup and sump overflow $10,000"]
- replacementCostDwelling: true if dwelling is insured at replacement cost value; false if actual cash value (boolean or null)
- replacementCostContents: true if personal property is insured at replacement cost; false if actual cash value (boolean or null)
- claimPhone: phone number to call for claims (string or null)
- claimUrl: website URL for filing claims online (string or null)
- claimEmail: email for claims if present (string or null)
- claimHours: claims availability hours e.g. "24/7" or "Mon-Fri 8am-5pm" (string or null)

Use null for any field not found. coverageItems, exclusions, and endorsements must always be arrays (empty array if none found).`,
        },
        {
          role: "user",
          content: `Parse this home insurance policy document:\n\n${text.slice(0, 14000)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Persist to Supabase — isolated try/catch so a missing key never kills the parse response
    if (userId && propId) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
          console.warn("[parse-insurance] Skipping DB save — SUPABASE_SERVICE_ROLE_KEY not set");
        } else {
          const supabase = createClient(supabaseUrl, supabaseKey);
          const { error } = await supabase.from("home_insurance").upsert({
            user_id:                     userId,
            property_id:                 parseInt(propId),
            provider:                    parsed.provider,
            policy_number:               parsed.policyNumber,
            policy_type:                 parsed.policyType,
            agent_name:                  parsed.agentName,
            agent_phone:                 parsed.agentPhone,
            agent_email:                 parsed.agentEmail,
            dwelling_coverage:           parsed.dwellingCoverage,
            other_structures:            parsed.otherStructures,
            personal_property:           parsed.personalProperty,
            loss_of_use:                 parsed.lossOfUse,
            liability_coverage:          parsed.liabilityCoverage,
            medical_payments:            parsed.medicalPayments,
            deductible_standard:         parsed.deductibleStandard,
            deductible_wind:             parsed.deductibleWind,
            deductible_hurricane:        parsed.deductibleHurricane,
            annual_premium:              parsed.annualPremium,
            payment_amount:              parsed.paymentAmount,
            payment_frequency:           parsed.paymentFrequency,
            payment_due_date:            parsed.paymentDueDate,
            payment_method:              parsed.paymentMethod,
            effective_date:              parsed.effectiveDate,
            expiration_date:             parsed.expirationDate,
            auto_renews:                 parsed.autoRenews,
            coverage_items:              parsed.coverageItems  ?? [],
            exclusions:                  parsed.exclusions     ?? [],
            endorsements:                parsed.endorsements   ?? [],
            replacement_cost_dwelling:   parsed.replacementCostDwelling,
            replacement_cost_contents:   parsed.replacementCostContents,
            claim_phone:                 parsed.claimPhone,
            claim_url:                   parsed.claimUrl,
            claim_email:                 parsed.claimEmail,
            claim_hours:                 parsed.claimHours,
            parsed_at:                   new Date().toISOString(),
          }, { onConflict: "user_id,property_id" });
          if (error) console.error("[parse-insurance] DB error:", error.message);
        }
      } catch (dbErr) {
        console.error("[parse-insurance] DB save failed (non-fatal):", dbErr.message);
      }
    }

    return Response.json({ success: true, data: parsed });
  } catch (err) {
    console.error("[parse-insurance] error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
