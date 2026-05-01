/**
 * BTLR Document Photo Scanner
 *
 * Uses GPT-4o Vision to extract structured data from photos of:
 *   - Home inspection reports (printed pages)
 *   - Insurance declarations pages
 *   - Home warranty documents
 *   - Mortgage statements
 *
 * POST /api/scan-document
 * Body: { photoUrls: string[], documentType: "inspection"|"insurance"|"warranty"|"mortgage" }
 *
 * Returns the same field structure as the corresponding parse-* text routes
 * so the client can use the exact same handlers.
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS — one per document type
// ─────────────────────────────────────────────────────────────────────────────

const PROMPTS = {

  inspection: `You are a licensed home inspector reading a photo of a printed home inspection report.
Extract ALL findings, deficiencies, and observations visible on the page(s).
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "string — one of: Roof, HVAC, Plumbing, Electrical, Foundation, Structural, Windows, Doors, Exterior, Siding, Deck, Driveway, Interior, Flooring, Ceiling, Mold, Pest, Appliances, General",
      "description": "string — verbatim or close paraphrase of the finding from the report",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null,
      "location": "string — room or area if stated, or null"
    }
  ],
  "summary": "string — overall summary from the report if present, otherwise a 1-sentence overview",
  "inspector_name": "string or null",
  "inspection_date": "YYYY-MM-DD or null",
  "property_address": "string or null"
}

Severity mapping from typical report language:
- "critical" = Safety hazard, Major defect, Requires immediate attention, Health hazard, Recommend specialist
- "warning" = Monitor, Repair recommended, Marginal, Approaching end of life, Deferred maintenance
- "info" = Maintenance item, Minor, Cosmetic, Noted for information, Satisfactory condition

Rules:
- Read ALL text visible on the page — do not skip items
- If you see a checklist or table, extract each checked or noted item
- If a section is marked "Satisfactory" with no issues, you may skip it
- estimated_cost: include if stated in the report, otherwise null
- Extract as many findings as are visible — do not cap at 5`,

  insurance: `You are reading a photo of a home insurance declarations page or policy document.
Extract all coverage details visible on the page(s).
Return ONLY valid JSON — no markdown, no extra text.

{
  "provider": "string or null",
  "policyNumber": "string or null",
  "policyType": "string or null — e.g. HO-3, HO-5, HO-6, DP-3, FAIR Plan",
  "agentName": "string or null",
  "agentPhone": "string or null",
  "dwellingCoverage": number | null,
  "otherStructures": number | null,
  "personalProperty": number | null,
  "lossOfUse": number | null,
  "liabilityCoverage": number | null,
  "medicalPayments": number | null,
  "deductibleStandard": number | null,
  "deductibleWind": number | null,
  "deductibleHurricane": number | null,
  "annualPremium": number | null,
  "effectiveDate": "YYYY-MM-DD or null",
  "expirationDate": "YYYY-MM-DD or null",
  "autoRenews": boolean | null,
  "coverageItems": ["array of what is covered"],
  "exclusions": ["array of what is excluded"],
  "endorsements": ["array of riders or add-ons"],
  "replacementCostDwelling": boolean | null,
  "replacementCostContents": boolean | null,
  "claimPhone": "string or null",
  "claimUrl": "string or null"
}

Rules:
- Dollar amounts should be plain numbers (no $ or commas)
- Dates in YYYY-MM-DD format
- coverageItems, exclusions, endorsements must be arrays (empty array if none visible)
- Use null for any field not visible in the photo`,

  warranty: `You are reading a photo of a home warranty or service contract document.
Extract all coverage and contact details visible on the page(s).
Return ONLY valid JSON — no markdown, no extra text.

{
  "provider": "string or null",
  "planName": "string or null",
  "policyNumber": "string or null",
  "serviceFee": number | null,
  "coverageItems": ["array of what is covered — list each system and appliance explicitly"],
  "exclusions": ["array of what is not covered"],
  "effectiveDate": "YYYY-MM-DD or null",
  "expirationDate": "YYYY-MM-DD or null",
  "autoRenews": boolean | null,
  "paymentAmount": number | null,
  "paymentFrequency": "monthly" | "annual" | null,
  "claimPhone": "string or null",
  "claimUrl": "string or null",
  "waitingPeriod": "string or null",
  "responseTime": "string or null",
  "maxAnnualBenefit": number | null
}

Rules:
- coverageItems and exclusions must always be arrays
- Dollar amounts as plain numbers
- Dates in YYYY-MM-DD format
- Use null for any field not visible`,

  mortgage: `You are reading a photo of a mortgage statement, loan disclosure, or closing document.
Extract all loan details visible on the page(s).
Return ONLY valid JSON — no markdown, no extra text.

{
  "lender": "string or null — lender/servicer name",
  "balance": number | null,
  "payment": number | null,
  "due_day": number | null,
  "rate": number | null
}

Rules:
- balance: current outstanding principal balance as a plain number
- payment: total monthly payment amount (PITI if shown, otherwise P&I)
- due_day: day of the month payment is due (1-31)
- rate: interest rate as a decimal (e.g. 0.0375 for 3.75%) — if shown as percentage, divide by 100
- lender: the company you pay, not the original originator if different
- Use null for any field not visible in the photo`,

};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();
    const { photoUrls, documentType, userId, propertyId } = body;

    if (!photoUrls?.length) {
      return Response.json({ error: "No photos provided" }, { status: 400 });
    }

    const validTypes = ["inspection", "insurance", "warranty", "mortgage"];
    if (!validTypes.includes(documentType)) {
      return Response.json({ error: `Invalid documentType. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
    }

    const urls = photoUrls.slice(0, 6); // cap at 6 pages per scan
    const systemPrompt = PROMPTS[documentType];

    // Build vision content
    const imageContent = urls.map(url => ({
      type: "image_url",
      image_url: { url, detail: "high" },
    }));

    const completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      temperature:     0.1,
      response_format: { type: "json_object" },
      max_tokens:      3000,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: `This is a photo of a home ${documentType} document. Extract all information visible on the page(s) and return the structured JSON as specified.`,
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[scan-document] JSON parse failed:", raw.slice(0, 200));
      return Response.json({ error: "AI returned unexpected format — please try again." }, { status: 500 });
    }

    console.log(`[scan-document] type=${documentType} | ${urls.length} photo(s) scanned`);

    // ── Persist to DB for insurance/warranty (same as parse-* routes) ─────────
    if (userId && propertyId) {
      const propId = parseInt(propertyId);

      if (documentType === "insurance") {
        await persistInsurance(parsed, userId, propId);
      } else if (documentType === "warranty") {
        await persistWarranty(parsed, userId, propId);
      }
      // inspection + mortgage are handled client-side (same as existing flows)
    }

    return Response.json({ success: true, documentType, data: parsed });

  } catch (err) {
    console.error("[scan-document] Error:", err?.message);
    return Response.json({ error: "Document scan failed — please try again." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB HELPERS — mirrors parse-insurance and parse-warranty save logic
// ─────────────────────────────────────────────────────────────────────────────

async function persistInsurance(parsed, userId, propId) {
  try {
    const { data: existing } = await supabaseAdmin
      .from("home_insurance")
      .select("*")
      .eq("user_id", userId)
      .eq("property_id", propId)
      .maybeSingle();

    const m = (n, e) => n ?? e ?? null;
    const mergeArr = (a, b) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));

    await supabaseAdmin.from("home_insurance").upsert({
      user_id:                   userId,
      property_id:               propId,
      provider:                  m(parsed.provider,                existing?.provider),
      policy_number:             m(parsed.policyNumber,            existing?.policy_number),
      policy_type:               m(parsed.policyType,              existing?.policy_type),
      agent_name:                m(parsed.agentName,               existing?.agent_name),
      agent_phone:               m(parsed.agentPhone,              existing?.agent_phone),
      dwelling_coverage:         m(parsed.dwellingCoverage,        existing?.dwelling_coverage),
      other_structures:          m(parsed.otherStructures,         existing?.other_structures),
      personal_property:         m(parsed.personalProperty,        existing?.personal_property),
      loss_of_use:               m(parsed.lossOfUse,               existing?.loss_of_use),
      liability_coverage:        m(parsed.liabilityCoverage,       existing?.liability_coverage),
      medical_payments:          m(parsed.medicalPayments,         existing?.medical_payments),
      deductible_standard:       m(parsed.deductibleStandard,      existing?.deductible_standard),
      deductible_wind:           m(parsed.deductibleWind,          existing?.deductible_wind),
      deductible_hurricane:      m(parsed.deductibleHurricane,     existing?.deductible_hurricane),
      annual_premium:            m(parsed.annualPremium,           existing?.annual_premium),
      effective_date:            m(parsed.effectiveDate,           existing?.effective_date),
      expiration_date:           m(parsed.expirationDate,          existing?.expiration_date),
      auto_renews:               m(parsed.autoRenews,              existing?.auto_renews),
      coverage_items:            mergeArr(parsed.coverageItems,    existing?.coverage_items),
      exclusions:                mergeArr(parsed.exclusions,        existing?.exclusions),
      endorsements:              mergeArr(parsed.endorsements,      existing?.endorsements),
      replacement_cost_dwelling: m(parsed.replacementCostDwelling, existing?.replacement_cost_dwelling),
      replacement_cost_contents: m(parsed.replacementCostContents, existing?.replacement_cost_contents),
      claim_phone:               m(parsed.claimPhone,              existing?.claim_phone),
      claim_url:                 m(parsed.claimUrl,                existing?.claim_url),
    }, { onConflict: "user_id,property_id" });
  } catch (e) {
    console.warn("[scan-document] Insurance persist failed:", e.message);
  }
}

async function persistWarranty(parsed, userId, propId) {
  try {
    await supabaseAdmin.from("home_warranty").upsert({
      user_id:            userId,
      property_id:        propId,
      provider:           parsed.provider           ?? null,
      plan_name:          parsed.planName           ?? null,
      policy_number:      parsed.policyNumber       ?? null,
      service_fee:        parsed.serviceFee         ?? null,
      coverage_items:     parsed.coverageItems      ?? [],
      exclusions:         parsed.exclusions         ?? [],
      effective_date:     parsed.effectiveDate      ?? null,
      expiration_date:    parsed.expirationDate     ?? null,
      auto_renews:        parsed.autoRenews         ?? null,
      payment_amount:     parsed.paymentAmount      ?? null,
      payment_frequency:  parsed.paymentFrequency   ?? null,
      claim_phone:        parsed.claimPhone         ?? null,
      claim_url:          parsed.claimUrl           ?? null,
      waiting_period:     parsed.waitingPeriod      ?? null,
      response_time:      parsed.responseTime       ?? null,
      max_annual_benefit: parsed.maxAnnualBenefit   ?? null,
    }, { onConflict: "user_id,property_id" });
  } catch (e) {
    console.warn("[scan-document] Warranty persist failed:", e.message);
  }
}
