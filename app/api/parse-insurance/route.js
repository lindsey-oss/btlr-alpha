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

    // Persist to Supabase — MERGE with existing row so uploading a 2nd policy
    // doesn't erase data from the first. Scalar fields: keep existing if new is null.
    // Array fields (coverageItems, exclusions, endorsements): union-deduplicate.
    if (userId && propId) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
          console.warn("[parse-insurance] Skipping DB save — SUPABASE_SERVICE_ROLE_KEY not set");
        } else {
          const supabase = createClient(supabaseUrl, supabaseKey);

          // Fetch existing row so we can merge rather than overwrite
          const { data: existing } = await supabase
            .from("home_insurance")
            .select("*")
            .eq("user_id", userId)
            .eq("property_id", parseInt(propId))
            .maybeSingle();

          // Prefer new non-null value, fall back to existing
          const m = (newVal, existingVal) => newVal ?? existingVal ?? null;
          // Union-dedup arrays
          const mergeArr = (a, b) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));

          const { error } = await supabase.from("home_insurance").upsert({
            user_id:                     userId,
            property_id:                 parseInt(propId),
            provider:                    m(parsed.provider,                existing?.provider),
            policy_number:               m(parsed.policyNumber,            existing?.policy_number),
            policy_type:                 m(parsed.policyType,              existing?.policy_type),
            agent_name:                  m(parsed.agentName,               existing?.agent_name),
            agent_phone:                 m(parsed.agentPhone,              existing?.agent_phone),
            agent_email:                 m(parsed.agentEmail,              existing?.agent_email),
            dwelling_coverage:           m(parsed.dwellingCoverage,        existing?.dwelling_coverage),
            other_structures:            m(parsed.otherStructures,         existing?.other_structures),
            personal_property:           m(parsed.personalProperty,        existing?.personal_property),
            loss_of_use:                 m(parsed.lossOfUse,               existing?.loss_of_use),
            liability_coverage:          m(parsed.liabilityCoverage,       existing?.liability_coverage),
            medical_payments:            m(parsed.medicalPayments,         existing?.medical_payments),
            deductible_standard:         m(parsed.deductibleStandard,      existing?.deductible_standard),
            deductible_wind:             m(parsed.deductibleWind,          existing?.deductible_wind),
            deductible_hurricane:        m(parsed.deductibleHurricane,     existing?.deductible_hurricane),
            annual_premium:              m(parsed.annualPremium,           existing?.annual_premium),
            payment_amount:              m(parsed.paymentAmount,           existing?.payment_amount),
            payment_frequency:           m(parsed.paymentFrequency,        existing?.payment_frequency),
            payment_due_date:            m(parsed.paymentDueDate,          existing?.payment_due_date),
            payment_method:              m(parsed.paymentMethod,           existing?.payment_method),
            effective_date:              m(parsed.effectiveDate,           existing?.effective_date),
            expiration_date:             m(parsed.expirationDate,          existing?.expiration_date),
            auto_renews:                 m(parsed.autoRenews,              existing?.auto_renews),
            coverage_items:              mergeArr(parsed.coverageItems,    existing?.coverage_items),
            exclusions:                  mergeArr(parsed.exclusions,       existing?.exclusions),
            endorsements:                mergeArr(parsed.endorsements,     existing?.endorsements),
            replacement_cost_dwelling:   m(parsed.replacementCostDwelling, existing?.replacement_cost_dwelling),
            replacement_cost_contents:   m(parsed.replacementCostContents, existing?.replacement_cost_contents),
            claim_phone:                 m(parsed.claimPhone,              existing?.claim_phone),
            claim_url:                   m(parsed.claimUrl,                existing?.claim_url),
            claim_email:                 m(parsed.claimEmail,              existing?.claim_email),
            claim_hours:                 m(parsed.claimHours,              existing?.claim_hours),
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
