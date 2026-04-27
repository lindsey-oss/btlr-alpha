import OpenAI from "openai";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";
import { normalizeLegacyFindings, computeHomeHealthReport } from "../../../lib/scoring-engine";
import { normalizeFindings } from "../../../lib/findings/normalizeFinding";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE ADMIN CLIENT — used for persistent parse cache (survives restarts)
// ─────────────────────────────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ─────────────────────────────────────────────────────────────────────────────
// TWO-TIER PARSE CACHE
//
// Tier 1 (L1): In-process Map — zero-latency for same-session re-uploads.
// Tier 2 (L2): Supabase parse_cache table — survives server restarts and
//   redeployments. Same PDF = same SHA-256 = identical result forever.
//
// Read order:  L1 → L2 → AI (on miss)
// Write order: AI result → L1 + L2
// ─────────────────────────────────────────────────────────────────────────────
const l1Cache = new Map();      // hash → result (in-process, no TTL needed)
const L1_MAX  = 100;

function cacheKey(text) {
  return createHash("sha256").update(text).digest("hex");
}

// L1 read/write
function l1Get(key)        { return l1Cache.get(key) ?? null; }
function l1Set(key, result) {
  if (l1Cache.size >= L1_MAX) l1Cache.delete(l1Cache.keys().next().value);
  l1Cache.set(key, result);
}

// L2 read/write — Supabase parse_cache table
async function l2Get(hash) {
  try {
    const { data } = await supabaseAdmin
      .from("parse_cache")
      .select("result")
      .eq("text_hash", hash)
      .maybeSingle();
    return data?.result ?? null;
  } catch { return null; }
}

async function l2Set(hash, result) {
  try {
    await supabaseAdmin
      .from("parse_cache")
      .upsert({ text_hash: hash, result }, { onConflict: "text_hash" });
  } catch (e) {
    console.warn("[parse-inspection] L2 cache write failed (non-fatal):", e?.message);
  }
}

// Combined cache lookup — L1 first, then L2
async function cacheGet(hash) {
  const l1 = l1Get(hash);
  if (l1) { console.log(`[parse-inspection] Cache L1 HIT (${hash.slice(0,10)}…)`); return l1; }
  const l2 = await l2Get(hash);
  if (l2) {
    console.log(`[parse-inspection] Cache L2 HIT (${hash.slice(0,10)}…) — promoting to L1`);
    l1Set(hash, l2); // promote to L1
    return l2;
  }
  return null;
}

// Write result to both tiers
async function cacheSet(hash, result) {
  l1Set(hash, result);
  await l2Set(hash, result);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CHAR_LIMIT = 48000;        // ~12k tokens — plenty for gpt-4o context
const MIN_TEXT_LENGTH = 80;      // below this = likely image/scanned PDF

// Determinism settings — critical for consistent results across re-uploads
// temperature: 0  → fully greedy decoding, no sampling randomness
// seed: fixed int → OpenAI uses same internal RNG state each call
const AI_TEMPERATURE = 0;
const AI_SEED = 91472;  // arbitrary fixed value — never change this

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
  - category: choose the MOST SPECIFIC label that fits from the list below.
    Use EXACTLY one of these strings (spelling matters):
      Roof | Gutters | Siding | Exterior | Deck | Patio | Chimney | Fireplace
      HVAC | Furnace | Air Conditioning | Ductwork | Thermostat
      Plumbing | Water Heater
      Electrical | Panel
      Foundation | Structural | Crawlspace | Basement
      Windows | Doors | Garage Door
      Interior | Floors | Ceilings | Walls | Drywall | Insulation | Attic
      Appliances | Dishwasher | Oven | Range | Refrigerator | Washer | Dryer
      Safety | Environmental | Pest | Mold | Radon | Asbestos
      Pool | Spa | Hot Tub | Pool Equipment
      Garage | General
    CRITICAL CATEGORY RULES — always follow these:
      • Acoustic/popcorn ceiling texture, ceiling stains, drywall damage, wall cracks,
        floor issues, interior paint → use "Interior" or the specific label (Ceilings, Walls, Floors)
      • Window glass, window seals, window sashes, window frames → use "Windows"
      • Entry doors, interior doors, sliding doors, screen doors → use "Doors"
      • NEVER use "Windows" for ceilings, floors, walls, drywall, or interior surfaces
      • NEVER use "Exterior" for indoor observations
      • If a category does not fit any label above, use "General"
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
// SECOND-PASS PROMPT
//
// The second pass uses a different system instruction to encourage the model
// to find anything the first pass missed — especially minor/info findings and
// systems not covered in the main summary section.
// ─────────────────────────────────────────────────────────────────────────────
function buildSecondPassPrompt(firstPassFindings, addressCandidates) {
  const addressHint = addressCandidates.length > 0
    ? `\nADDRESS CANDIDATES:\n${addressCandidates.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}\n`
    : "";

  const systemCategories = [...new Set(firstPassFindings.map(f => f.category))].join(", ");

  return `You are doing a SECOND REVIEW of this home inspection report. A first pass already found findings in these categories: ${systemCategories || "none yet"}.

Your job is to find ANYTHING that was missed — report every finding regardless of system type, including:
- Additional findings within already-identified categories
- Systems not yet represented: pool, spa, deck, garage, fireplace, attic, crawlspace, chimney, gutters, grading/drainage, water heater, doors, windows, appliances, insulation, ventilation, environmental hazards
- Minor maintenance items (info-level findings)
- Age or condition notes for any system not yet captured

Respond ONLY with valid JSON in exactly this shape:
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
Use the same CRITICAL CATEGORY RULES as pass 1:
  • Ceilings, walls, floors, drywall, interior paint, acoustic/popcorn texture → "Interior" or specific (Ceilings, Walls, Floors)
  • Window glass/seals/frames → "Windows"  |  Doors → "Doors"
  • NEVER use "Windows" for interior surfaces, ceilings, or walls
Return ALL findings you see across all systems. The merger will deduplicate against pass 1. Return up to 30 findings.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDINGS MERGER
//
// Combines two sets of findings, deduplicating by semantic similarity.
// A finding is considered a duplicate if it has the same category AND
// its description overlaps significantly with an existing finding.
// Always keeps the higher-severity version when there's a conflict.
// ─────────────────────────────────────────────────────────────────────────────
function mergeFindings(pass1, pass2) {
  const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

  // Normalise a string for fuzzy comparison
  function norm(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  }

  // Word-overlap ratio between two strings (Jaccard on word sets, words > 3 chars)
  function similarity(a, b) {
    const wa = new Set(norm(a).split(" ").filter(w => w.length > 3));
    const wb = new Set(norm(b).split(" ").filter(w => w.length > 3));
    if (wa.size === 0 && wb.size === 0) return 1;
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    return inter / Math.max(wa.size, wb.size);
  }

  // Two categories are considered the same topic when:
  //  - one string contains the other ("Pool" ⊂ "Pool, Spa, Equipment & Safety"), OR
  //  - their word-overlap is ≥ 50% ("Electrical Panel" ~ "Electrical Panel & Wiring")
  function categoriesMatch(c1, c2) {
    const a = norm(c1);
    const b = norm(c2);
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return similarity(a, b) >= 0.50;
  }

  const merged = [...pass1];

  for (const f2 of pass2) {
    // Find a duplicate: same-topic category AND similar description.
    // Threshold raised from 0.40 → 0.55 to prevent near-misses leaking through
    // as new findings and inflating the count on re-upload.
    const dupIdx = merged.findIndex(f1 =>
      categoriesMatch(f1.category, f2.category) &&
      similarity(f1.description, f2.description) >= 0.55
    );

    if (dupIdx === -1) {
      // Also check: same-topic category with very short / empty descriptions
      // (parser sometimes returns a header-only finding the second time)
      const catOnlyDup = merged.findIndex(f1 =>
        categoriesMatch(f1.category, f2.category) &&
        (!f2.description || f2.description.trim().length < 20)
      );
      if (catOnlyDup === -1) {
        merged.push(f2);
      }
      // else: second pass added a thin duplicate of an existing category — skip it
    } else {
      // Duplicate — keep the higher-severity version, prefer the longer category name
      const existing = merged[dupIdx];
      const existRank = SEVERITY_RANK[existing.severity] ?? 0;
      const newRank   = SEVERITY_RANK[f2.severity] ?? 0;
      const betterCategory =
        (f2.category || "").length > (existing.category || "").length
          ? f2.category
          : existing.category;
      if (newRank > existRank) {
        merged[dupIdx] = { ...existing, ...f2, category: betterCategory };
      } else {
        merged[dupIdx] = {
          estimated_cost:       existing.estimated_cost       ?? f2.estimated_cost,
          age_years:            existing.age_years            ?? f2.age_years,
          remaining_life_years: existing.remaining_life_years ?? f2.remaining_life_years,
          lifespan_years:       existing.lifespan_years       ?? f2.lifespan_years,
          ...existing,
          category: betterCategory,
        };
      }
    }
  }

  // Sort: critical first, then warning, then info; within tier sort by category
  const order = f => `${3 - (SEVERITY_RANK[f.severity] ?? 0)}_${(f.category || "").toLowerCase()}`;
  merged.sort((a, b) => order(a).localeCompare(order(b)));

  return merged.slice(0, 30); // cap at 30
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
      temperature: AI_TEMPERATURE,
      seed: AI_SEED,
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
  let _parseHash = null; // hoisted so cacheSet can reference it after the if block

  // ── Image / scanned PDF detection ────────────────────────────────────────
  // If text extraction produced almost nothing, the PDF is likely scanned.
  // Try the OpenAI Files API vision fallback if we have the raw buffer.
  const isLikelyImagePdf = charCount < MIN_TEXT_LENGTH;
  let message = null;

  if (isLikelyImagePdf) {
    if (pdfBuffer) {
      // Check cache by PDF buffer hash before hitting OpenAI vision
      const bufHash = createHash("sha256").update(pdfBuffer).digest("hex");
      _parseHash = bufHash;
      const cachedVision = await cacheGet(bufHash);
      if (cachedVision) return Response.json(cachedVision);

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

    // ── Cache check — same text always returns same result (L1 + L2) ───────
    const hash = cacheKey(textForAI);
    _parseHash = hash;
    const cached = await cacheGet(hash);
    if (cached) {
      return Response.json(cached);
    }

    const prompt = buildPrompt(addressCandidates);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: AI_TEMPERATURE,
      seed: AI_SEED,
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

    // ── Second pass — find anything missed ───────────────────────────────
    // Run a second AI call with a gap-focused prompt, then merge results.
    // Both calls use temperature=0 + same seed so each pass is itself stable.
    try {
      const pass1Findings = JSON.parse(message).findings ?? [];
      const pass2Prompt   = buildSecondPassPrompt(pass1Findings, addressCandidates);

      const completion2 = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: AI_TEMPERATURE,
        seed: AI_SEED, // same seed as pass1 — full determinism, no "explore" drift
        messages: [
          {
            role: "system",
            content: "You are reviewing a home inspection report for a SECOND TIME to find missed findings. Respond only with valid JSON.",
          },
          {
            role: "user",
            content: `${pass2Prompt}\n\nINSPECTION REPORT TEXT:\n${textForAI}`,
          },
        ],
      });

      const pass2Raw     = JSON.parse(completion2.choices[0].message.content);
      const pass2Findings = Array.isArray(pass2Raw.findings) ? pass2Raw.findings : [];
      console.log(`[parse-inspection] Pass 1: ${pass1Findings.length} findings | Pass 2: ${pass2Findings.length} findings`);

      // Merge and replace the message with a combined payload
      const mergedFindings = mergeFindings(pass1Findings, pass2Findings);
      console.log(`[parse-inspection] After merge: ${mergedFindings.length} findings`);

      const pass1Parsed = JSON.parse(message);
      message = JSON.stringify({ ...pass1Parsed, findings: mergedFindings });
    } catch (pass2Err) {
      // Second pass failed — first pass result still used
      console.error("[parse-inspection] Second pass failed (using first pass):", pass2Err?.message);
    }
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

    // ── PASS 2: NORMALIZATION + DEDUP ────────────────────────────────────────
    // Each raw finding goes through:
    //   categoryMap.toCategoryKey()          → canonical category
    //   normalizeFinding.deriveIssueType()   → pattern-matched issue_type
    //   normalizeFinding.deriveLocation()    → pattern-matched location
    //   normalizeFinding.deriveComponentAndSystem() → component + system slugs
    //   generateNormalizedFindingKey()       → stable 5-part identity key
    // Deduplication: same key → keep highest severity, then highest confidence.
    const normalizedFindings = normalizeFindings(findings);

    // ── PASS 3: VALIDATION + CONFIDENCE AUDIT ────────────────────────────────
    // classifyFinding() (called inside normalizeFinding) has already computed
    // confidence_score and classification_reason on each finding.
    // Here we log the distribution and surface any unconfirmed findings.
    const confidenceCounts = { high: 0, medium: 0, low: 0, unconfirmed: 0 };
    const needsReviewItems = [];
    for (const nf of normalizedFindings) {
      confidenceCounts[nf.confidence_score] = (confidenceCounts[nf.confidence_score] ?? 0) + 1;
      if (nf.needs_review) needsReviewItems.push({ category: nf.category, reason: nf.classification_reason, desc: nf.description.slice(0, 80) });
    }
    console.log(`[parse-inspection] Pass 3 confidence distribution:`, confidenceCounts);
    if (needsReviewItems.length > 0) {
      console.warn(`[parse-inspection] ${needsReviewItems.length} unconfirmed finding(s) flagged needs_review:`, needsReviewItems);
    }

    const finalResult = {
      property_address:  parsed.property_address  ?? null,
      inspection_date:   parsed.inspection_date   ?? null,
      company_name:      parsed.company_name      ?? null,
      inspector_name:    parsed.inspector_name    ?? null,
      summary:           parsed.summary           ?? null,
      roof_year:         safeRoofYear,
      hvac_year:         safeHvacYear,
      findings:          normalizedFindings,
      home_health_report,
    };

    // Persist to both cache tiers — L2 (Supabase) write is fire-and-forget
    if (_parseHash) cacheSet(_parseHash, finalResult); // async, intentionally not awaited

    return Response.json(finalResult);
  } catch {
    return Response.json({
      property_address: null, inspection_date: null, company_name: null,
      inspector_name: null, summary: null,
      roof_year: null, hvac_year: null, findings: [], home_health_report: null,
    });
  }
}
