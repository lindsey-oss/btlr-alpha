import OpenAI from "openai";
import { extractPdfText } from "../../../lib/extractPdfText";

const PROMPT = `Extract structured data from this home inspection report. Respond only with valid JSON in exactly this shape:

{
  "roof_year": number | null,
  "hvac_year": number | null,
  "findings": [
    {
      "category": "string — e.g. Roof, HVAC, Plumbing, Electrical, Foundation, Pest, Windows, Structural",
      "description": "string — specific issue described in the report",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ]
}

Rules:
- roof_year: year roof was installed or last replaced; null if not mentioned
- hvac_year: year HVAC system was installed or last replaced; null if not mentioned
- findings: ALL deficiencies, repair items, or maintenance issues found in the report
- severity: "critical" = safety or structural concern; "warning" = significant repair needed; "info" = maintenance recommendation
- estimated_cost: dollar amount if stated in the report, otherwise null
- Return at most 25 findings, most critical first
- Omit findings with no description`;

export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let inspectionText = "";

  try {
    // Client sends { signedUrl, filename, storagePath } as JSON
    const body = await req.json();
    const { signedUrl, filename } = body;

    if (signedUrl) {
      const fileRes = await fetch(signedUrl);
      if (!fileRes.ok) throw new Error(`Could not fetch inspection file: ${fileRes.status}`);

      const isPdf = (filename || "").toLowerCase().endsWith(".pdf")
        || (fileRes.headers.get("content-type") || "").includes("pdf");

      if (isPdf) {
        const arrayBuffer = await fileRes.arrayBuffer();
        inspectionText = extractPdfText(Buffer.from(arrayBuffer));
      } else {
        // Plain text / other readable file
        inspectionText = await fileRes.text();
      }
    }
  } catch {
    // Legacy fallback: raw text body (old client versions sent text directly)
    try { inspectionText = await req.text(); } catch { /* ignore */ }
  }

  if (!inspectionText || inspectionText.trim().length < 20) {
    return Response.json({ roof_year: null, hvac_year: null, findings: [] });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured data from home inspection reports. Respond only with valid JSON.",
      },
      {
        role: "user",
        content: `${PROMPT}\n\nInspection report:\n${inspectionText.slice(0, 12000)}`,
      },
    ],
  });

  const message = completion.choices[0].message.content;

  try {
    const parsed = JSON.parse(message);
    return Response.json({
      roof_year: parsed.roof_year ?? null,
      hvac_year: parsed.hvac_year ?? null,
      findings:  Array.isArray(parsed.findings) ? parsed.findings : [],
    });
  } catch {
    return Response.json({ roof_year: null, hvac_year: null, findings: [] });
  }
}
