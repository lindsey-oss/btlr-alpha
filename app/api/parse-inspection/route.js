import OpenAI from "openai";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../../lib/scoring-engine";

// ─────────────────────────────────────────────────────────────────────────────
// SMART SECTION EXTRACTOR
//
// Inspection reports are structured very differently:
//   • CBHI / HomeGauge style: 70-100 pages, findings buried mid-report,
//     "General Summary" section at the end condenses everything.
//   • HouseMaster / WIN style: shorter, findings inline from page 1.
//   • Digital / SaaS reports: may start with findings immediately.
//
// Strategy:
//   1. Look for "General Summary" / "Summary of Findings" section — this is
//      the most information-dense part of long reports.
//   2. If no summary, look for the first cluster of "Repair or Replace" /
//      deficiency markers (skip boilerplate intro pages).
//   3. Fall back to the start of the text if no markers found.
//
// Always send up to CHAR_LIMIT chars to OpenAI so we capture all findings.
// ─────────────────────────────────────────────────────────────────────────────
const CHAR_LIMIT = 32000; // ~8k tokens — well within gpt-4o-mini context

function smartExtractSection(fullText) {
  const len = fullText.length;

  // Always grab the cover page / first ~1500 chars so property address,
  // inspection date, and company name can be found even when we jump ahead
  // to the summary section for findings.
  const coverPage = fullText.slice(0, 1500);

  // ── Strategy 1: Find "General Summary" / known summary headers ───────────
  // The second occurrence is the actual section (first is usually the TOC line).
  const summaryPatterns = [
    "General Summary",
    "GENERAL SUMMARY",
    "Summary of Findings",
    "SUMMARY OF FINDINGS",
    "Summary of Conditions",
    "SUMMARY OF CONDITIONS",
    "Inspection Summary",
    "INSPECTION SUMMARY",
    "DEFICIENCY SUMMARY",
    "Deficiency Summary",
    "CONCERNS AND RECOMMENDATIONS",
    "Concerns and Recommendations",
  ];

  for (const pattern of summaryPatterns) {
    let idx = fullText.indexOf(pattern);
    if (idx === -1) continue;

    // Skip TOC entry — real section is past 30% of the document
    const threshold = len * 0.3;
    if (idx < threshold) {
      // Look for second occurrence (past the TOC)
      idx = fullText.indexOf(pattern, idx + pattern.length);
      if (idx === -1 || idx < threshold) continue;
    }

    const section = fullText.slice(idx, idx + CHAR_LIMIT);
    console.log(`[parse-inspection] Using "${pattern}" section at char ${idx} (${section.length} chars)`);
    return coverPage + "\n\n---SUMMARY SECTION---\n\n" + section;
  }

  // ── Strategy 2: Skip intro, find first dense findings block ──────────────
  // Most reports have Repair/Replace or similar markers where findings start.
  const findingMarkers = [
    "Repair or Replace",
    "REPAIR OR REPLACE",
    "Repair/Replace",
    "DEFICIENCY",
    "Deficiency",
    "Safety Concern",
    "SAFETY CONCERN",
    "Further Evaluation",
    "FURTHER EVALUATION",
  ];

  // Search only after first 15% of document (skip cover/intro pages)
  const searchStart = Math.floor(len * 0.15);

  for (const marker of findingMarkers) {
    const idx = fullText.indexOf(marker, searchStart);
    if (idx === -1) continue;

    // Back up 300 chars to capture the section header above the first finding
    const start = Math.max(searchStart, idx - 300);
    const section = fullText.slice(start, start + CHAR_LIMIT);
    console.log(`[parse-inspection] Using findings block at char ${idx} via marker "${marker}" (${section.length} chars)`);
    return coverPage + "\n\n---FINDINGS SECTION---\n\n" + section;
  }

  // ── Strategy 3: Fall back — send from char 0 but with bigger limit ────────
  console.log(`[parse-inspection] No summary section found — sending first ${CHAR_LIMIT} chars`);
  return fullText.slice(0, CHAR_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const PROMPT = `Extract structured data from this home inspection report. Respond only with valid JSON in exactly this shape:

{
  "property_address": "string | null",
  "inspection_date": "string | null",
  "company_name": "string | null",
  "summary": "string | null",
  "roof_year": number | null,
  "hvac_year": number | null,
  "findings": [
    {
      "category": "string — e.g. Roof, HVAC, Plumbing, Electrical, Foundation, Pest, Windows, Structural, Exterior, Appliances, Pool, Spa",
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
- property_address: the full street address of the inspected property, including city and state if present. Look for labels like "Property Address:", "Subject Property:", "Inspection Address:", "Site Address:", or similar. Return null if not found.
- inspection_date: the date the inspection was performed (as a string in the format it appears, e.g. "March 15, 2024" or "2024-03-15"). Return null if not found.
- company_name: the name of the inspection company or inspector. Return null if not found.
- summary: a 1-2 sentence plain-language summary of the overall condition of the home. Write it yourself based on the findings — do NOT copy the inspector's boilerplate.
- roof_year: the year the roof was last replaced or installed — NOT the year the home was built or constructed. If the report only mentions the home's construction/build year without a specific roof replacement date, return null. Only populate if the report explicitly mentions a roof replacement or installation year.
- hvac_year: the year the HVAC system was last replaced or installed — NOT the year the home was built or constructed. If the report only mentions the home's construction/build year without a specific HVAC replacement date, return null. Only populate if the report explicitly mentions an HVAC replacement or installation year.
- findings: ALL deficiencies, repair items, or maintenance issues found in the report. Include pool/spa findings if present.
- Common report formats use "Repair or Replace" (RR), "Further Evaluation", "Safety Concern", or numbered deficiency items — treat all of these as findings
- severity rules:
  • "critical" = immediate safety hazard, structural failure risk, active leak, or mold/pest infestation
  • "warning" = significant repair needed, system nearing end of life, or recommended by inspector for repair
  • "info" = maintenance tip, minor cosmetic issue, or informational note
- estimated_cost: dollar amount if stated in the report, otherwise null
- age_years: how old this specific system or component is in years, if mentioned; null otherwise
- remaining_life_years: inspector's stated estimate of remaining useful life in years; null if not stated
- lifespan_years: typical total expected lifespan — use: Roof 25, HVAC 15, Water Heater 12, Electrical Panel 40, Plumbing 50, Foundation 100, Windows 20, Deck 15, Siding 20, Pool Equipment 10; null if not applicable
- Return at most 25 findings, most critical first
- Omit findings with no description
- If the text appears to be a General Summary or list of deficiencies, extract all items listed`;

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
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

  const charCount = inspectionText.trim().length;
  console.log(`[parse-inspection] Extracted ${charCount} chars from PDF`);

  if (!inspectionText || charCount < 20) {
    console.error("[parse-inspection] Text extraction failed or too short — scanned/image PDF or unsupported encoding");
    return Response.json({
      property_address: null, inspection_date: null, company_name: null, summary: null,
      roof_year: null, hvac_year: null, findings: [], home_health_report: null,
      _error: "Could not extract text from this PDF. Please ensure it is a text-based PDF, not a scanned image.",
    });
  }

  // Extract the most findings-rich section of the text
  const textForAI = smartExtractSection(inspectionText);
  console.log(`[parse-inspection] Sending ${textForAI.length} chars to OpenAI`);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "You extract structured data from home inspection reports. Respond only with valid JSON.",
      },
      {
        role: "user",
        content: `${PROMPT}\n\nInspection report text:\n${textForAI}`,
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
    // construction year instead of a system replacement year, null it out.
    const currentYear = new Date().getFullYear();
    const rawRoofYear = parsed.roof_year;
    const rawHvacYear = parsed.hvac_year;
    const safeRoofYear = rawRoofYear && (currentYear - rawRoofYear) <= 50 ? rawRoofYear : null;
    const safeHvacYear = rawHvacYear && (currentYear - rawHvacYear) <= 30 ? rawHvacYear : null;
    if (rawRoofYear && !safeRoofYear) console.warn(`[parse-inspection] Discarded implausible roof_year ${rawRoofYear}`);
    if (rawHvacYear && !safeHvacYear) console.warn(`[parse-inspection] Discarded implausible hvac_year ${rawHvacYear}`);

    // ── Scoring Engine Integration ─────────────────────────────────────────
    const roofAgeYears = safeRoofYear ? currentYear - safeRoofYear : null;
    const hvacAgeYears = safeHvacYear ? currentYear - safeHvacYear : null;

    let home_health_report = null;
    try {
      const normalizedItems = normalizeLegacyFindings(findings, roofAgeYears, hvacAgeYears);
      home_health_report = computeHomeHealthReport(normalizedItems);
    } catch (engineErr) {
      console.error("[parse-inspection] Scoring engine error:", engineErr?.message);
    }

    return Response.json({
      property_address:    parsed.property_address  ?? null,
      inspection_date:     parsed.inspection_date   ?? null,
      company_name:        parsed.company_name      ?? null,
      summary:             parsed.summary           ?? null,
      roof_year:           safeRoofYear,
      hvac_year:           safeHvacYear,
      findings,
      home_health_report,
    });
  } catch {
    return Response.json({ property_address: null, inspection_date: null, company_name: null, summary: null, roof_year: null, hvac_year: null, findings: [], home_health_report: null });
  }
}
