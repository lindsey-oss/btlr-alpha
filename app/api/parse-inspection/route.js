import OpenAI from "openai";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../../lib/scoring-engine";

const PROMPT = `Extract structured data from this home inspection report. Respond only with valid JSON in exactly this shape:

{
  "roof_year": number | null,
  "hvac_year": number | null,
  "findings": [
    {
      "category": "string — e.g. Roof, HVAC, Plumbing, Electrical, Foundation, Pest, Windows, Structural",
      "description": "string — specific issue described in the report",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null,
      "age_years": number | null,
      "remaining_life_years": number | null,
      "lifespan_years": number | null
    }
  ]
}

Rules:
- roof_year: the year the roof was last replaced or installed — NOT the year the home was built or constructed. If the report only mentions the home's construction/build year without a specific roof replacement date, return null. Only populate if the report explicitly mentions a roof replacement or installation year.
- hvac_year: the year the HVAC system was last replaced or installed — NOT the year the home was built or constructed. If the report only mentions the home's construction/build year without a specific HVAC replacement date, return null. Only populate if the report explicitly mentions an HVAC replacement or installation year.
- findings: ALL deficiencies, repair items, or maintenance issues found in the report
- severity: "critical" = safety or structural concern; "warning" = significant repair needed; "info" = maintenance recommendation
- estimated_cost: dollar amount if stated in the report, otherwise null
- age_years: how old this specific system or component is in years, if mentioned in the report; null otherwise
- remaining_life_years: inspector's stated estimate of remaining useful life in years (e.g. "3-5 years remaining" → 4); null if not stated
- lifespan_years: typical total expected lifespan for this system type — use these standards: Roof 25, HVAC 15, Water Heater 12, Electrical Panel 40, Plumbing 50, Foundation 100, Windows 20, Deck 15, Siding 20; null if category doesn't apply
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
        inspectionText = await extractPdfTextAsync(Buffer.from(arrayBuffer));
      } else {
        // Plain text / other readable file
        inspectionText = await fileRes.text();
      }
    }
  } catch {
    // Legacy fallback: raw text body (old client versions sent text directly)
    try { inspectionText = await req.text(); } catch { /* ignore */ }
  }

  console.log(`[parse-inspection] Extracted ${inspectionText.trim().length} chars from PDF`);
  if (!inspectionText || inspectionText.trim().length < 20) {
    console.error("[parse-inspection] Text extraction failed or too short — scanned/image PDF or unsupported encoding");
    return Response.json({
      roof_year: null, hvac_year: null, findings: [], home_health_report: null,
      _error: "Could not extract text from this PDF. Please ensure it is a text-based PDF, not a scanned image.",
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.1, // low but not zero — zero is too strict on imperfect PDF text
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
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    console.log(`[parse-inspection] OpenAI returned ${findings.length} findings`);

    // ── Sanitize extracted years ───────────────────────────────────────────
    // Roofs last at most ~50 years; HVAC ~30 years. If AI extracted the home's
    // construction year (e.g. 1940) instead of a system replacement year, the
    // computed age would be absurd. Null out any year that implies an impossible age.
    const currentYear = new Date().getFullYear();
    const rawRoofYear = parsed.roof_year;
    const rawHvacYear = parsed.hvac_year;
    const safeRoofYear = rawRoofYear && (currentYear - rawRoofYear) <= 50 ? rawRoofYear : null;
    const safeHvacYear = rawHvacYear && (currentYear - rawHvacYear) <= 30 ? rawHvacYear : null;
    if (rawRoofYear && !safeRoofYear) console.warn(`[parse-inspection] Discarded implausible roof_year ${rawRoofYear} (age ${currentYear - rawRoofYear}y — likely house construction year)`);
    if (rawHvacYear && !safeHvacYear) console.warn(`[parse-inspection] Discarded implausible hvac_year ${rawHvacYear} (age ${currentYear - rawHvacYear}y — likely house construction year)`);

    // ── Scoring Engine Integration ─────────────────────────────────────────
    const roofAgeYears = safeRoofYear ? currentYear - safeRoofYear : null;
    const hvacAgeYears = safeHvacYear ? currentYear - safeHvacYear : null;

    let home_health_report = null;
    try {
      const normalizedItems = normalizeLegacyFindings(findings, roofAgeYears, hvacAgeYears);
      home_health_report = computeHomeHealthReport(normalizedItems);
    } catch (engineErr) {
      console.error("[parse-inspection] Scoring engine error:", engineErr?.message);
      // Non-fatal — continue without report
    }

    return Response.json({
      roof_year:          safeRoofYear,
      hvac_year:          safeHvacYear,
      findings,
      home_health_report, // null if engine errored; dashboard falls back gracefully
    });
  } catch {
    return Response.json({ roof_year: null, hvac_year: null, findings: [], home_health_report: null });
  }
}
