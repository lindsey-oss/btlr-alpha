// Insurance PDF Parser
// Upload your homeowners insurance policy and AI extracts key details

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
      const arrayBuffer = await req.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      text = await extractPdfTextAsync(buffer);
    } else {
      text = await req.text();
    }

    if (!text || text.trim().length < 10) {
      return Response.json({ error: "Could not extract text from file." }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a homeowners insurance document parser.
Extract these fields from the policy document:
- provider: insurance company name (string)
- policyNumber: policy number (string)
- premium: annual or monthly premium amount (number, always annualize it)
- premiumFrequency: "annual" or "monthly"
- coverageAmount: dwelling coverage limit (number)
- deductible: deductible amount (number)
- effectiveDate: policy start date (YYYY-MM-DD or null)
- expirationDate: policy end date / renewal date (YYYY-MM-DD or null)
- propertyAddress: insured address (string)

Return ONLY valid JSON with these exact keys. Use null for anything not found.`,
        },
        {
          role: "user",
          content: `Parse this insurance policy document:\n\n${text.slice(0, 12000)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Save to Supabase
    const { data: existing } = await supabase
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from("properties").update({
        insurance_premium:  parsed.premium ?? null,
        insurance_renewal:  parsed.expirationDate ?? null,
      }).eq("id", existing.id);
    }

    return Response.json({ success: true, data: parsed });
  } catch (err) {
    console.error("parse-insurance error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
