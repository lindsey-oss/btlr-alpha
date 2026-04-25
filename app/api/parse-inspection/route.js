import OpenAI from "openai";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../../lib/scoring-engine";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CHAR_LIMIT = 48000;        // ~12k tokens — plenty for gpt-4o context
const MIN_TEXT_LENGTH = 80;      // below this = likely image/scanned PDF

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS CANDIDATE PRE-EXTRACTOR
//
// Scans the ENTIRE document for address-like patterns before sending to AI.
// Candidates are injected into the prompt as hints so the model doesn't have
// to hunt through noisy text — they're handed to it directly.
//
// Looks for:
//   1. Labeled patterns: "Property Address: 123 Main St"
//   2. Street address patterns anywhere in the doc
//   3. Common inspection software header blocks (Spectora, HomeGauge, etc.)
// ─────────────────────────────────────────────────────────────────────────────
function extractAddressCandidates(fullText) {
  const candidates = [];
  const seen = new Set();

  function add(candidate) {
    const clean = candidate.trim().replace(/\s+/g, " ");
    if (clean.length < 8 || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    candidates.push(clean);
  }

  // ── Labeled patterns (highest confidence) ────────────────────────────────
  const labelPatterns = [
    /(?:property|subject|inspection|site|service)\s+address\s*[:\-–]\s*([^\n\r]{8,120})/gi,
    /(?:address of (?:inspection|inspected property|property))\s*[:\-–]\s*([^\n\r]{8,120})/gi,
    /(?:property (?:is )?(?:located|situated) at|located at)\s*[:\-–]?\s*([^\n\r]{8,120})/gi,
    /(?:subject property|property being inspected)\s*[:\-–]\s*([^\n\r]{8,120})/gi,
    /(?:home|house|building) address\s*[:\-–]\s*([^\n\r]{8,120})/gi,
    // Spectora / HomeGauge: address on its own line after a label
    /^(?:Address|Location)[:\s]+([^\n\r]{8,120})$/gim,
    // "Prepared for: ... Property: 123 Main St"
    /Property:\s*([^\n\r]{8,120})/gi,
    // Common "Inspected By" adjacent line patterns
    /(?:Inspected|Report)\s+for[:\s]+[^\n\r]*\n([^\n\r]{8,120})/gi,
  ];

  for (const pattern of labelPatterns) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      add(match[1]);
      if (candidates.length >= 8) break;
    }
  }

  // ── Street address pattern: number + street name + type ──────────────────
  // Search entire doc (not just cover page) since address can appear anywhere.
  const streetRe = /\b(\d{2,6}\s+(?:[NSEW]\s+)?[A-Z][A-Za-z0-9\s]{2,40}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Trail|Trl|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\.?)(?:[,\s]+(?:[A-Za-z\s]{2,30})[,\s]+(?:[A-Z]{2})\s+(?:\d{5}(?:-\d{4})?))?/g;

  let streetMatch;
  let searchCount = 0;
  while ((streetMatch = streetRe.exec(fullText)) !== null && searchCount < 20) {
    add(streetMatch[0]);
    searchCount++;
    if (candidates.length >= 8) break;
  }

  // Return top 5 candidates — more than that dilutes the hint
  return candidates.slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART SECTION EXTRACTOR
//
// Builds the text blob sent to the AI by combining:
//   A) Full document address context (first 3000 chars, ANY address-labelled
//      section, and last 500 chars — covers edge cases like address in footer)
//   B) Findings-dense section: General Summary, deficiency list, or first
//      findings block — up to CHAR_LIMIT chars
//
// Handles report styles:
//   • CBHI / HomeGauge: 70-100 pages, summary at the end
//   • HouseMaster / WIN: findings inline from page 1
//   • Spectora / Home Inspector Pro: single-page digital reports
//   • Custom / text exports: free-form structure
// ─────────────────────────────────────────────────────────────────────────────
function smartExtractSection(fullText) {
  const len = fullText.length;

  // ── A. Address context block ─────────────────────────────────────────────
  // Cover page (first 3000 chars) + last 500 chars (some reports put address
  // in the footer) + any paragraph containing an address label anywhere in doc
  const coverPage = fullText.slice(0, 3000);
  const footer    = len > 3000 ? fullText.slice(-500) : "";

  // Find any paragraph (up to 400 chars) surrounding an address label
  let addressSection = "";
  const addressLabelRe = /(?:property|subject|site|inspection)\s+address/gi;
  let m;
  while ((m = addressLabelRe.exec(fullText)) !== null) {
    const start = Math.max(0, m.index - 100);
    const end   = Math.min(len, m.index + 400);
    const snippet = fullText.slice(start, end);
    if (!coverPage.includes(snippet.slice(0, 40))) {
      // Only add if it's not already covered by the cover page
      addressSection += "\n\n---ADDRESS SECTION---\n" + snippet;
    }
    if (addressSection.length > 1200) break; // cap at ~3 snippets
  }

  const contextBlock = coverPage + (footer ? "\n\n---FOOTER---\n" + footer : "") + addressSection;

  // ── B. Summary / findings section ────────────────────────────────────────
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
    "Items Requiring Attention",
    "ITEMS REQUIRING ATTENTION",
    "Significant Findings",
    "SIGNIFICANT FINDINGS",
    "Key Findings",
    "KEY FINDINGS",
    "Action Required",
    "ACTION REQUIRED",
  ];

  for (const pattern of summaryPatterns) {
    let idx = fullText.indexOf(pattern);
    if (idx === -1) continue;

    // Skip likely TOC entries (real section is usually past 25% of the document)
    const threshold = len * 0.25;
    if (idx < threshold) {
      const secondIdx = fullText.indexOf(pattern, idx + pattern.length);
      if (secondIdx !== -1 && secondIdx >= threshold) {
        idx = secondIdx;
      } else if (idx < threshold) {
        continue;
      }
    }

    const section = fullText.slice(idx, idx + CHAR_LIMIT);
    console.log(`[parse-inspection] Using "${pattern}" at char ${idx} (${section.length} chars)`);
    return contextBlock + "\n\n---SUMMARY SECTION---\n\n" + section;
  }

  // ── Strategy 2: Find first dense findings block ───────────────────────────
  const findingMarkers = [
    "Repair or Replace",
    "REPAIR OR REPLACE",
    "Repair/Replace",
    "REPAIR/REPLACE",
    "DEFICIENCY",
    "Deficiency",
    "Safety Concern",
    "SAFETY CONCERN",
    "Further Evaluation",
    "FURTHER EVALUATION",
    "Immediate Action",
    "IMMEDIATE ACTION",
    "Recommended Repair",
    "RECOMMENDED REPAIR",
  ];

  // Search after first 10% (skip pure cover/intro pages)
  const searchStart = Math.floor(len * 0.10);

  for (const marker of findingMarkers) {
    const idx = fullText.indexOf(marker, searchStart);
    if (idx === -1) continue;

    // Back up to capture the section header
    const start = Math.max(searchStart, idx - 500);
    const section = fullText.slice(start, start + CHAR_LIMIT);
    console.log(`[parse-inspection] Using findings block at char ${idx} via "${marker}" (${section.length} chars)`);
    return contextBlock + "\n\n---FINDINGS SECTION---\n\n" + section;
  }

  // ── Strategy 3: Short report — send everything ────────────────────────────
  // If we still haven't found a structure, the report is probably short or
  // non-standard — just send the full document up to CHAR_LIMIT.
  console.log(`[parse-inspection] No structure found — sending full document (${Math.min(len, CHAR_LIMIT)} chars)`);
  return fullText.slice(0, CHAR_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(addressCandidates) {
  const addressHint = addressCandidates.length > 0
    ? `\nADDRESS CANDIDATES (pre-extracted from document — choose the one that is the inspected property address):\n${addressCandidates.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}\n`
    : "";

  return `Extract structured data from this home inspection report. Respond ONLY with valid JSON in exactly this shape:

{
  "property_address": "string | null",
  "inspection_date": "string | null",
  "company_name": "string | null",
  "inspector_name": "string | null",
  "summary": "string | null",
  "roof_year": number | null,
  "hvac_year": number | null,
  "findings": [
    {
      "category": "string",
      "description": "string",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null,
      "age_years": number | null,
      "remaining_life_years": number | null,
      "lifespan_years": number | null
    }
  ]
}
${addressHint}
FIELD RULES:

property_address:
  - The street address of the INSPECTED PROPERTY (not the inspector's office)
  - Look for: "Property Address:", "Subject Property:", "Inspection Address:", "Site Address:", "Property:", "Location:", "Address:"
  - It may appear anywhere in the document — not just the cover page
  - Use the address candidates above as strong hints if present
  - Include city, state, zip if visible
  - Return null only if absolutely no address can be found anywhere

inspection_date:
  - Date the inspection was performed (not the report date or purchase date)
  - Return as string in whatever format it appears ("March 15, 2024" or "2024-03-15")

company_name:
  - The inspection COMPANY name (e.g. "HomeTeam Inspection Service", "WIN Home Inspection")
  - Not the real estate agent or buyer's name

inspector_name:
  - The individual inspector's name if listed

summary:
  - 1-2 sentence plain-language summary of overall home condition
  - Write it based on the findings — do NOT copy inspector boilerplate
  - Example: "The home has several critical electrical and plumbing issues requiring immediate repair, along with an aging roof nearing end of life."

roof_year:
  - Year the roof was last REPLACED or INSTALLED — NOT the home's construction year
  - Only populate if the report explicitly says "roof replaced in XXXX" or "new roof XXXX"
  - Return null if only the home's build year is mentioned

hvac_year:
  - Year the HVAC was last REPLACED or INSTALLED — NOT the home's construction year
  - Only populate if explicitly mentioned as a replacement/installation

findings:
  - Extract ALL deficiencies, repair items, maintenance issues, and observations
  - Include pool, spa, deck, outbuilding findings if present
  - Report formats vary widely — look for ALL of these marker types:
      • "Repair or Replace" / "RR"
      • "Further Evaluation" / "FE"
      • "Safety Concern" / "SC"
      • "Deficiency" / numbered items
      • "Recommended" / "Noted" / "Observed"
      • Items in a General Summary or deficiency list
  - category: one of — Roof, HVAC, Plumbing, Electrical, Foundation, Structural,
    Exterior, Windows, Appliances, Insulation, Pest, Pool, Spa, Deck, Garage,
    Fireplace, Safety, Environmental, General
  - severity:
      "critical" = immediate safety hazard, structural failure, active leak, mold, pest infestation
      "warning"  = significant repair needed, system nearing end of life, inspector recommends repair
      "info"     = maintenance tip, minor cosmetic issue, monitor only
  - estimated_cost: dollar amount only if stated in the report; otherwise null
  - age_years: years old if mentioned; null otherwise
  - remaining_life_years: inspector's stated remaining useful life; null if not stated
  - lifespan_years: use these defaults when relevant — Roof 25, HVAC 15, Water Heater 12,
    Electrical Panel 40, Plumbing 50, Foundation 100, Windows 20, Deck 15, Siding 20,
    Pool Equipment 10; null if not applicable
  - Return up to 30 findings, most critical first
  - Omit findings with empty descriptions`;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE/SCANNED PDF FALLBACK
//
// If text extraction yields too little (scanned PDF, image-based report),
// upload the raw PDF buffer to OpenAI Files API and let gpt-4o read it
// natively using its document understanding capability.
// ─────────────────────────────────────────────────────────────────────────────
async function parseViaFileUpload(openai, pdfBuffer, filename, prompt) {
  console.log("[parse-inspection] Attempting vision fallback via OpenAI Files API");
  let fileId = null;
  try {
    // Upload PDF to OpenAI
    const file = await openai.files.create({
      file: new File([pdfBuffer], filename || "inspection.pdf", { type: "application/pdf" }),
      purpose: "user_data",
    });
    fileId = file.id;
    console.log(`[parse-inspection] Uploaded to OpenAI Files: ${fileId}`);

    // Use the file in a completion — gpt-4o can read PDFs via file content type
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You extract structured data from home inspection reports. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              // OpenAI file content reference
              type: "file",
              file: { file_id: fileId },
            },
          ],
        },
      ],
    });

    return completion.choices[0].message.content;
  } finally {
    // Always clean up the uploaded file
    if (fileId) {
      try { await openai.files.delete(fileId); } catch { /* ignore cleanup errors */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let inspectionText = "";
  let pdfBuffer = null;
  let filename = "";

  try {
    const body = await req.json();
    filename = body.filename || "";
    const { signedUrl } = body;

    if (signedUrl) {
      const fileRes = await fetch(signedUrl);
      if (!fileRes.ok) throw new Error(`Could not fetch file: ${fileRes.status}`);

      const isPdf = filename.toLowerCase().endsWith(".pdf")
        || (fileRes.headers.get("content-type") || "").includes("pdf");

      if (isPdf) {
        const arrayBuffer = await fileRes.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        inspectionText = await extractPdfTextAsync(pdfBuffer);
      } else {
        inspectionText = await fileRes.text();
      }
    }
  } catch {
    try { inspectionText = await req.text(); } catch { /* ignore */ }
  }

  const charCount = inspectionText.trim().length;
  console.log(`[parse-inspection] Extracted ${charCount} chars from document`);

  // ── Image / scanned PDF detection ────────────────────────────────────────
  // If text extraction produced almost nothing, the PDF is likely scanned.
  // Try the OpenAI Files API vision fallback if we have the raw buffer.
  const isLikelyImagePdf = charCount < MIN_TEXT_LENGTH;
  let message = null;

  if (isLikelyImagePdf) {
    if (pdfBuffer) {
      console.log("[parse-inspection] Sparse text — trying Files API vision fallback");
      try {
        const candidates = []; // no text to pre-scan
        const prompt = buildPrompt(candidates);
        message = await parseViaFileUpload(openai, pdfBuffer, filename, prompt);
      } catch (visionErr) {
        console.error("[parse-inspection] Vision fallback failed:", visionErr?.message);
      }
    }

    if (!message) {
      return Response.json({
        property_address: null, inspection_date: null, company_name: null,
        inspector_name: null, summary: null,
        roof_year: null, hvac_year: null, findings: [], home_health_report: null,
        _error: "This appears to be a scanned or image-based PDF. Please export a text-based PDF from your inspection software, or contact support.",
      });
    }
  }

  // ── Text-based PDF path ───────────────────────────────────────────────────
  if (!message) {
    // Pre-extract address candidates from full document
    const addressCandidates = extractAddressCandidates(inspectionText);
    console.log(`[parse-inspection] Address candidates: ${JSON.stringify(addressCandidates)}`);

    // Extract the most relevant sections
    const textForAI = smartExtractSection(inspectionText);
    console.log(`[parse-inspection] Sending ${textForAI.length} chars to gpt-4o`);

    const prompt = buildPrompt(addressCandidates);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You are an expert at reading home inspection reports in any format — CBHI, HomeGauge, Spectora, HouseMaster, WIN, and custom formats. Extract structured data precisely. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: `${prompt}\n\nINSPECTION REPORT TEXT:\n${textForAI}`,
        },
      ],
    });

    message = completion.choices[0].message.content;
  }

  try {
    const parsed = JSON.parse(message);
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    console.log(`[parse-inspection] Extracted ${findings.length} findings, address="${parsed.property_address}"`);

    // ── Sanitize years ────────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    const rawRoofYear = parsed.roof_year;
    const rawHvacYear = parsed.hvac_year;
    const safeRoofYear = rawRoofYear && (currentYear - rawRoofYear) <= 50 ? rawRoofYear : null;
    const safeHvacYear = rawHvacYear && (currentYear - rawHvacYear) <= 30 ? rawHvacYear : null;
    if (rawRoofYear && !safeRoofYear) console.warn(`[parse-inspection] Discarded implausible roof_year ${rawRoofYear}`);
    if (rawHvacYear && !safeHvacYear) console.warn(`[parse-inspection] Discarded implausible hvac_year ${rawHvacYear}`);

    // ── Scoring engine ────────────────────────────────────────────────────
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
      property_address:  parsed.property_address  ?? null,
      inspection_date:   parsed.inspection_date   ?? null,
      company_name:      parsed.company_name      ?? null,
      inspector_name:    parsed.inspector_name    ?? null,
      summary:           parsed.summary           ?? null,
      roof_year:         safeRoofYear,
      hvac_year:         safeHvacYear,
      findings,
      home_health_report,
    });
  } catch {
    return Response.json({
      property_address: null, inspection_date: null, company_name: null,
      inspector_name: null, summary: null,
      roof_year: null, hvac_year: null, findings: [], home_health_report: null,
    });
  }
}
