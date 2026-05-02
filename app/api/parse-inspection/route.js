import OpenAI from "openai";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300; // Vercel max — two GPT-4o passes on large PDFs need the full window
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
  // Include PARSE_VERSION so changing the prompt/normalization invalidates old cache entries
  return createHash("sha256").update(PARSE_VERSION + "|" + text).digest("hex");
}

function l1Get(key)        { return l1Cache.get(key) ?? null; }
function l1Set(key, result) {
  if (l1Cache.size >= L1_MAX) l1Cache.delete(l1Cache.keys().next().value);
  l1Cache.set(key, result);
}

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

async function cacheGet(hash) {
  const l1 = l1Get(hash);
  if (l1) { console.log(`[parse-inspection] Cache L1 HIT (${hash.slice(0,10)}…)`); return l1; }
  const l2 = await l2Get(hash);
  if (l2) {
    console.log(`[parse-inspection] Cache L2 HIT (${hash.slice(0,10)}…) — promoting to L1`);
    l1Set(hash, l2);
    return l2;
  }
  return null;
}

async function cacheSet(hash, result) {
  l1Set(hash, result);
  await l2Set(hash, result);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CHAR_LIMIT     = 24000;   // ~6k tokens — gpt-4o-mini handles this in ~15s per pass
const MIN_TEXT_LENGTH = 80;     // below this = likely image/scanned PDF

const AI_TEMPERATURE = 0;
const AI_SEED = 91472;          // fixed — never change

// ── CACHE VERSION ─────────────────────────────────────────────────────────────
// Increment whenever prompt rules or normalization logic change.
// This invaluates all L1 + L2 cached results so the next upload re-parses
// with the corrected logic.  DO NOT change the seed above.
const PARSE_VERSION = "v10";

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS CANDIDATE PRE-EXTRACTOR
//
// Scans the ENTIRE document for address-like patterns before sending to AI.
// Supports: CBHI, HomeGauge, Spectora, HouseMaster, WIN, Palm-Tech, 3D Inspect,
//           iReport, ReportHost, Home Inspector Pro, and custom text exports.
// ─────────────────────────────────────────────────────────────────────────────
function extractAddressCandidates(fullText) {
  const candidates = [];
  const seen = new Set();

  function add(candidate) {
    const clean = candidate.trim().replace(/\s+/g, " ")
      // Strip trailing junk often appended (page numbers, dates)
      .replace(/\s+(?:Page|Pg|p\.)\s*\d+.*$/i, "")
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, "")
      .trim();
    if (clean.length < 8 || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    candidates.push(clean);
  }

  // ── 1. Labeled patterns (highest confidence) ─────────────────────────────
  const labelPatterns = [
    // Standard labels
    /(?:property|subject|inspection|site|service|inspected)\s+address\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    /(?:address of (?:inspection|inspected property|property))\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    /(?:property (?:is )?(?:located|situated) at|located at)\s*[:\-–]?\s*([^\n\r]{8,150})/gi,
    /(?:subject property|property being inspected|inspected property)\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    /(?:home|house|building|structure) address\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    // Spectora / HomeGauge / 3D Inspect: standalone label lines
    /^(?:Address|Location|Property|Site)[:\s]+([^\n\r]{8,150})$/gim,
    // Palm-Tech style: "Property:" or "Property Location:"
    /^Property(?:\s+Location)?\s*:\s*([^\n\r]{8,150})$/gim,
    // WIN / HouseMaster: "Prepared for ... at address"
    /(?:Prepared for|Inspection for|Report for)[^\n\r]*\n+([^\n\r]{8,150})/gi,
    // iReport: "Client Property Address:"
    /Client\s+Property\s+(?:Address)?\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    // ReportHost / custom: "Inspection Location:"
    /Inspection\s+Location\s*[:\-–]\s*([^\n\r]{8,150})/gi,
    // "Home / Property at:"
    /(?:home|property)\s+at\s*[:\-–]?\s*([^\n\r]{8,150})/gi,
    // Common "for the property located at" phrase
    /for\s+the\s+property\s+(?:located\s+)?at\s+([^\n\r,.]{10,150})/gi,
    // Address in parens after buyer name: "John Smith (123 Main St)"
    /\((\d{2,6}\s+[A-Z][A-Za-z0-9\s]{4,80}(?:Street|St|Avenue|Ave|Blvd|Boulevard|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Trail|Trl|Terrace|Ter|Highway|Hwy|Pkwy)[^\)]{0,50})\)/g,
    // "Service Address" label
    /^Service\s+Address\s*:\s*([^\n\r]{8,150})$/gim,
    // CBHI style: address on line right after "Report Date" block
    /Report\s+Date[^\n]*\n+([^\n\r]{10,150})/gi,
  ];

  for (const pattern of labelPatterns) {
    let match;
    const resetPattern = new RegExp(pattern.source, pattern.flags);
    while ((match = resetPattern.exec(fullText)) !== null) {
      add(match[1]);
      if (candidates.length >= 10) break;
    }
    if (candidates.length >= 10) break;
  }

  // ── 2. Street number + street name pattern ───────────────────────────────
  // Matches addresses like "1234 N Main Street, Tucson, AZ 85701"
  // or just "1234 Main St" (partial address still useful as hint)
  const streetRe = /\b(\d{2,6}\s+(?:[NSEW](?:orth|outh|ast|est)?\s+)?[A-Z][A-Za-z0-9\s]{2,50}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Trail|Trl|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\.?)(?:[,\s]+(?:[A-Za-z\s]{2,35})[,\s]+(?:[A-Z]{2})\s+(?:\d{5}(?:-\d{4})?))?/g;

  let streetMatch;
  let searchCount = 0;
  while ((streetMatch = streetRe.exec(fullText)) !== null && searchCount < 25) {
    add(streetMatch[0]);
    searchCount++;
    if (candidates.length >= 10) break;
  }

  // ── 3. ZIP-anchored fallback ─────────────────────────────────────────────
  // If we still have < 2 candidates, search for any line containing a 5-digit ZIP
  // (very common in inspection reports — the property address always has one)
  if (candidates.length < 2) {
    const zipLineRe = /^([^\n\r]{10,120}\b\d{5}(?:-\d{4})?\b[^\n\r]{0,40})$/gm;
    let zipMatch;
    while ((zipMatch = zipLineRe.exec(fullText)) !== null) {
      const line = zipMatch[1].trim();
      // Exclude lines that look like phone numbers, dates, or pure numbers
      if (!/^\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(line) &&
          !/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) &&
          /[A-Za-z]/.test(line)) {
        add(line);
        if (candidates.length >= 10) break;
      }
    }
  }

  console.log(`[parse-inspection] Address candidates (${candidates.length}):`, candidates);
  return candidates.slice(0, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART SECTION EXTRACTOR
//
// Builds the text blob sent to the AI by combining:
//   A) Full document address context (first 3000 chars, any address sections,
//      and last 500 chars for footer addresses)
//   B) Findings-dense section: looks for summary sections or first dense
//      block of deficiencies
//
// Handles report styles:
//   • CBHI / HomeGauge: 70-100 pages, summary at the END of the document
//   • HouseMaster / WIN: findings inline from page 1
//   • Spectora / Home Inspector Pro: single-page digital reports, ALL inline
//   • Palm-Tech / 3D Inspect: findings in numbered sections throughout
//   • iReport / ReportHost: custom narrative format
//   • Short custom reports: < 10 pages, send everything
// ─────────────────────────────────────────────────────────────────────────────
function smartExtractSection(fullText) {
  const len = fullText.length;

  // ── A. Address context block ─────────────────────────────────────────────
  const coverPage = fullText.slice(0, 3500);
  const footer    = len > 3500 ? fullText.slice(-600) : "";

  // Find paragraphs containing address labels anywhere in the doc
  let addressSection = "";
  const addressLabelRe = /(?:property|subject|site|inspection|client\s+property|service)\s+address/gi;
  let m;
  while ((m = addressLabelRe.exec(fullText)) !== null) {
    const start   = Math.max(0, m.index - 100);
    const end     = Math.min(len, m.index + 500);
    const snippet = fullText.slice(start, end);
    if (!coverPage.includes(snippet.slice(0, 50))) {
      addressSection += "\n\n---ADDRESS SECTION---\n" + snippet;
    }
    if (addressSection.length > 1500) break;
  }

  const contextBlock = coverPage
    + (footer       ? "\n\n---FOOTER---\n"         + footer       : "")
    + (addressSection                                              );

  // ── B. Summary / findings section ────────────────────────────────────────
  //
  // More markers than before — covers many more software formats:
  //
  const summaryPatterns = [
    // Standard
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
    // HomeGauge
    "CONCERNS AND RECOMMENDATIONS",
    "Concerns and Recommendations",
    "Items Requiring Attention",
    "ITEMS REQUIRING ATTENTION",
    // HouseMaster / WIN
    "Significant Findings",
    "SIGNIFICANT FINDINGS",
    "Key Findings",
    "KEY FINDINGS",
    "Action Required",
    "ACTION REQUIRED",
    // Spectora
    "Major Concerns",
    "MAJOR CONCERNS",
    "Minor Concerns",
    "MINOR CONCERNS",
    "Safety Issues",
    "SAFETY ISSUES",
    "Repair Items",
    "REPAIR ITEMS",
    // Palm-Tech
    "Repair or Replace",
    "REPAIR OR REPLACE",
    "Immediate Attention",
    "IMMEDIATE ATTENTION",
    "Monitor",
    "MONITOR",
    // 3D Inspect / iReport
    "Critical Items",
    "CRITICAL ITEMS",
    "Priority Items",
    "PRIORITY ITEMS",
    "Items of Note",
    "ITEMS OF NOTE",
    // ReportHost / custom
    "Findings Summary",
    "FINDINGS SUMMARY",
    "Maintenance Items",
    "MAINTENANCE ITEMS",
    "Recommended Actions",
    "RECOMMENDED ACTIONS",
    "Action Items",
    "ACTION ITEMS",
    // CBHI
    "SECTION SUMMARIES",
    "Section Summaries",
    "OVERALL ASSESSMENT",
    "Overall Assessment",
  ];

  // For short documents (< 15k chars ≈ ~5 pages), lower the TOC-skip threshold
  // so we don't accidentally skip the ONLY occurrence of the section header.
  const tocThresholdFraction = len < 15000 ? 0.10 : 0.20;

  for (const pattern of summaryPatterns) {
    let idx = fullText.indexOf(pattern);
    if (idx === -1) continue;

    const threshold = len * tocThresholdFraction;
    if (idx < threshold) {
      // Try second occurrence (the real section, not a TOC entry)
      const secondIdx = fullText.indexOf(pattern, idx + pattern.length);
      if (secondIdx !== -1 && secondIdx >= threshold) {
        idx = secondIdx;
      } else if (idx < threshold && len > 5000) {
        // For longer docs only skip; for short docs use the first occurrence
        continue;
      }
    }

    const section = fullText.slice(idx, idx + CHAR_LIMIT);
    console.log(`[parse-inspection] Using summary pattern "${pattern}" at char ${idx} (${section.length} chars)`);
    return contextBlock + "\n\n---SUMMARY SECTION---\n\n" + section;
  }

  // ── Strategy 2: Find first dense findings block ───────────────────────────
  const findingMarkers = [
    // Classic severity labels
    "Repair or Replace",   "REPAIR OR REPLACE",
    "Repair/Replace",      "REPAIR/REPLACE",
    "DEFICIENCY",          "Deficiency",
    "Safety Concern",      "SAFETY CONCERN",
    "Safety Issue",        "SAFETY ISSUE",
    "Further Evaluation",  "FURTHER EVALUATION",
    "Immediate Action",    "IMMEDIATE ACTION",
    "Recommended Repair",  "RECOMMENDED REPAIR",
    // Spectora checkbox-style
    "Major Concern",       "MAJOR CONCERN",
    "Minor Concern",       "MINOR CONCERN",
    // Palm-Tech / 3D Inspect icon labels
    "IN2",  "RR",  "FE",  "SC",  "MO",   // common abbreviations
    // Numbered finding blocks
    "1. ",                 // many reports start finding #1 after the cover
    // Any line starting "Finding:"
    "Finding:",            "FINDING:",
    // Narrative flags
    "was found",           "was observed",
    "requires repair",     "recommend",
  ];

  // Search after first 8% (skip pure cover/intro pages for larger docs)
  const searchStart = Math.floor(len * (len < 15000 ? 0.03 : 0.08));

  for (const marker of findingMarkers) {
    const idx = fullText.indexOf(marker, searchStart);
    if (idx === -1) continue;

    const start   = Math.max(searchStart, idx - 600);
    const section = fullText.slice(start, start + CHAR_LIMIT);
    console.log(`[parse-inspection] Using findings block at char ${idx} via "${marker}" (${section.length} chars)`);
    return contextBlock + "\n\n---FINDINGS SECTION---\n\n" + section;
  }

  // ── Strategy 3: Short / unstructured report — send everything ────────────
  console.log(`[parse-inspection] No structure found — sending full document (${Math.min(len, CHAR_LIMIT)} chars)`);
  return fullText.slice(0, CHAR_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(addressCandidates) {
  const addressHint = addressCandidates.length > 0
    ? `\nADDRESS CANDIDATES (pre-extracted from document — pick the inspected PROPERTY address):\n${addressCandidates.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}\n`
    : "";

  return `Extract structured data from this home inspection report. Respond ONLY with valid JSON in exactly this shape:

{
  "property_address": "string | null",
  "inspection_date": "string | null",
  "company_name": "string | null",
  "inspector_name": "string | null",
  "summary": "string | null",
  "property_type": "single_family" | "condo" | "townhouse" | "multi_family" | null,
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
  - The street address of the INSPECTED PROPERTY (not the inspector's office or buyer's home)
  - Look for labels: "Property Address", "Subject Property", "Inspection Address",
    "Site Address", "Property", "Location", "Address", "Client Property Address",
    "Inspection Location", "Service Address" — in any format
  - May appear ANYWHERE — cover page, header, footer, or body
  - Use the address candidates above as strong hints if present
  - Prefer the candidate with a recognizable street number + street name + city + state + zip
  - If multiple candidates exist, choose the one that looks like the inspected home
    (not the inspector's office or the report recipient's mailing address)
  - Include city, state, zip if visible
  - Return null ONLY if absolutely no address can be found anywhere in the document

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
  - Year the HVAC was last REPLACED or INSTALLED
  - Only populate if explicitly mentioned as a replacement/installation

property_type:
  - The type of dwelling being inspected
  - Return "condo" if the report mentions: "condominium", "condo unit", "HOA", "common area", "unit #", "homeowners association", "association-maintained", or if the report explicitly excludes roof/exterior/structure as "HOA responsibility" or "association maintained"
  - Return "townhouse" if the report mentions: "townhouse", "townhome", "row house", or similar attached dwelling with its own roof
  - Return "multi_family" if the report mentions: "duplex", "triplex", "fourplex", "multi-family", "investment property" with multiple units
  - Return "single_family" if the report clearly describes a detached single-family home
  - Return null if uncertain — do NOT guess

findings:
  - Extract ALL deficiencies, repair items, maintenance items, and observations
  - Include pool, spa, deck, outbuilding, and detached garage findings if present
  - Report formats vary widely — look for ALL of these severity markers:
      • "Repair or Replace" / "RR" / "R/R"
      • "Further Evaluation" / "FE"
      • "Safety Concern" / "Safety Issue" / "SC"
      • "Major Concern" / "Minor Concern" (Spectora)
      • "Deficiency" / numbered items / checkboxes
      • "Recommended" / "Noted" / "Observed" / "Monitor"
      • Items in any summary, deficiency list, or findings list
      • Inline narrative text: "was found to be...", "requires repair", "recommend..."
  - category: use EXACTLY one of these strings:
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
    CRITICAL CATEGORY RULES — READ CAREFULLY:
      • Ceiling texture/stains, drywall, wall cracks, floor issues, interior paint → "Interior" or specific label
      • Window glass/seals/sashes/frames → "Windows"
      • Entry/interior/sliding/screen doors → "Doors"
      • NEVER use "Windows" for ceilings, floors, walls, or interior surfaces
      • NEVER use "Exterior" for purely indoor observations
      • If nothing fits, use "General"

    WIRING / ELECTRICAL — CRITICAL OVERRIDE:
      • ANY finding about exposed wiring, open wiring, bare wiring, Romex cable,
        NM cable, unprotected wiring, junction boxes, breakers, outlets, GFCI, panels,
        or any electrical component → ALWAYS "Electrical", regardless of WHERE it is located.
      • "Exposed Romex wires at rear exterior wall" → "Electrical"  (NOT "Exterior", NOT "Roof")
      • "Open wiring in attic" → "Electrical"  (NOT "Attic", NOT "Roof")
      • "Knob-and-tube wiring in basement" → "Electrical"  (NOT "Basement", NOT "Foundation")
      • Location words like "exterior", "wall", "attic", "crawlspace" DO NOT change an
        electrical finding into a roof or exterior finding.

    VEGETATION / LANDSCAPING:
      • Vegetation, trees, shrubs, plants, vines, or branches in contact with or
        growing against the building → "Exterior" or "Siding"
      • This is NOT a "Roof" finding even if plant material touches the roof.
      • "Vegetation in contact with siding" → "Siding"
      • "Tree limbs overhanging/touching roof" → "Exterior"

    EXTERIOR CLADDING / STUCCO — CRITICAL OVERRIDE:
      • Stucco, EIFS, exterior plaster, exterior cladding, exterior wall finish,
        exterior paint, exterior coating, exterior masonry, exterior brick → "Exterior"
      • These are wall surface materials — NEVER "Roof", even if they appear near the roofline
      • "Damaged/deteriorated stucco" → "Exterior"
      • "Stucco repairs needed" → "Exterior"
      • "Stucco cracks at exterior walls" → "Exterior"
      • Chimney stucco/mortar → "Chimney", NOT "Roof"
      • Rule: if a licensed STUCCO CONTRACTOR does the work → category is "Exterior"

    DEDUPLICATION — IMPORTANT:
      • Each distinct physical deficiency must appear EXACTLY ONCE in your findings array.
      • If the same defect appears in both a summary section AND a detailed section of the
        report, extract it ONCE only — use the most detailed description available.
      • Two findings are duplicates when they describe the same physical problem at the
        same location, even if the wording differs slightly.
      • It IS correct to have multiple findings with the same category when they describe
        genuinely different physical defects (e.g., damaged gutters AND damaged stucco are
        two separate findings even though both are "Exterior/Siding").
  - severity:
      "critical" = immediate safety hazard, structural failure, active leak, mold, pest infestation, open wiring, gas leak
      "warning"  = significant repair needed, system nearing end of life, inspector recommends repair soon
      "info"     = maintenance tip, minor cosmetic issue, monitor only, advisory note
  - estimated_cost: dollar amount only if stated; otherwise null
  - age_years: years old if mentioned; null otherwise
  - remaining_life_years: inspector's stated remaining useful life; null if not stated
  - lifespan_years defaults (use when relevant):
      Roof 25, HVAC 15, Water Heater 12, Electrical Panel 40, Plumbing 50,
      Foundation 100, Windows 20, Deck 15, Siding 20, Pool Equipment 10; null if not applicable
  - Return up to 30 findings, most critical first
  - Omit findings with empty or whitespace-only descriptions`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECOND-PASS PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildSecondPassPrompt(firstPassFindings, addressCandidates) {
  const addressHint = addressCandidates.length > 0
    ? `\nADDRESS CANDIDATES:\n${addressCandidates.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}\n`
    : "";

  const systemCategories = [...new Set(firstPassFindings.map(f => f.category))].join(", ");

  return `You are doing a SECOND REVIEW of this home inspection report. Pass 1 found findings in: ${systemCategories || "none yet"}.

Your job: find ANYTHING missed. Cover every system regardless of whether pass 1 touched it:
- Additional findings within already-found categories
- Systems not yet covered: pool, spa, deck, garage, fireplace, attic, crawlspace,
  chimney, gutters, grading/drainage, water heater, doors, windows, appliances,
  insulation, ventilation, environmental hazards, radon, mold, pest
- Minor maintenance/info-level items
- Age or condition notes for any system not yet captured
- Findings embedded in narrative paragraphs (not just summary lists)

Respond ONLY with valid JSON in exactly this shape:
{
  "property_address": "string | null",
  "inspection_date": "string | null",
  "company_name": "string | null",
  "inspector_name": "string | null",
  "summary": "string | null",
  "property_type": "single_family" | "condo" | "townhouse" | "multi_family" | null,
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
Same CRITICAL CATEGORY RULES as pass 1:
  • Ceilings/walls/floors/drywall/interior paint → "Interior" or specific
  • Window glass/seals/frames → "Windows"  |  Doors → "Doors"
  • NEVER use "Windows" for interior surfaces
  • Exposed wiring / Romex / NM cable / open wiring → ALWAYS "Electrical" regardless of location
  • Vegetation/plants in contact with siding, walls, or roof → "Siding" or "Exterior" (NOT "Roof")
  • Stucco / EIFS / exterior plaster / exterior cladding / exterior wall finish → ALWAYS "Exterior" (NEVER "Roof")
  • If a licensed stucco contractor does the repair → category is "Exterior"
  • Do NOT re-extract findings already captured in pass 1 (the merger handles deduplication).
Return findings you find that are NOT already in the pass 1 list above. Return up to 30 new findings.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDINGS MERGER
// ─────────────────────────────────────────────────────────────────────────────
function mergeFindings(pass1, pass2) {
  const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

  function norm(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  }

  function similarity(a, b) {
    const wa = new Set(norm(a).split(" ").filter(w => w.length > 3));
    const wb = new Set(norm(b).split(" ").filter(w => w.length > 3));
    if (wa.size === 0 && wb.size === 0) return 1;
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    return inter / Math.max(wa.size, wb.size);
  }

  function categoriesMatch(c1, c2) {
    const a = norm(c1);
    const b = norm(c2);
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return similarity(a, b) >= 0.50;
  }

  const merged = [...pass1];

  for (const f2 of pass2) {
    const dupIdx = merged.findIndex(f1 =>
      categoriesMatch(f1.category, f2.category) &&
      similarity(f1.description, f2.description) >= 0.55
    );

    if (dupIdx === -1) {
      const catOnlyDup = merged.findIndex(f1 =>
        categoriesMatch(f1.category, f2.category) &&
        (!f2.description || f2.description.trim().length < 20)
      );
      if (catOnlyDup === -1) {
        merged.push(f2);
      }
    } else {
      const existing = merged[dupIdx];
      const existRank = SEVERITY_RANK[existing.severity] ?? 0;
      const newRank   = SEVERITY_RANK[f2.severity]       ?? 0;
      const betterCategory =
        (f2.category || "").length > (existing.category || "").length
          ? f2.category : existing.category;
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

  const order = f => `${3 - (SEVERITY_RANK[f.severity] ?? 0)}_${(f.category || "").toLowerCase()}`;
  merged.sort((a, b) => order(a).localeCompare(order(b)));

  return merged.slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE / SCANNED PDF FALLBACK
//
// If text extraction yields too little (scanned PDF, image-based report),
// upload the raw PDF buffer to OpenAI Files API and let gpt-4o read it
// natively using its document understanding capability.
// ─────────────────────────────────────────────────────────────────────────────
async function parseViaFileUpload(openai, pdfBuffer, filename, prompt) {
  console.log("[parse-inspection] Attempting vision fallback via OpenAI Files API");
  let fileId = null;
  try {
    const file = await openai.files.create({
      file: new File([pdfBuffer], filename || "inspection.pdf", { type: "application/pdf" }),
      purpose: "user_data",
    });
    fileId = file.id;
    console.log(`[parse-inspection] Uploaded to OpenAI Files: ${fileId}`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: AI_TEMPERATURE,
      seed: AI_SEED,
      messages: [
        {
          role: "system",
          content: "You extract structured data from home inspection reports in any format. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "file", file: { file_id: fileId } },
          ],
        },
      ],
    });

    return completion.choices[0].message.content;
  } finally {
    if (fileId) {
      try { await openai.files.delete(fileId); } catch { /* ignore */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS RESOLVER
//
// After both AI passes run, consolidate the best property_address from:
//   1. Pass 1 AI result
//   2. Pass 2 AI result
//   3. Pre-extracted candidates (regex-based)
//
// Preference order: AI address with city+state+zip > AI address with city/state >
//   AI address (any) > best regex candidate with zip > best regex candidate (any)
// ─────────────────────────────────────────────────────────────────────────────
function resolveAddress(pass1Address, pass2Address, candidates) {
  const hasZipCity = (s) => s && /\b\d{5}\b/.test(s) && /,\s*[A-Z]{2}\b/.test(s);
  const hasState   = (s) => s && /,\s*[A-Z]{2}\b/.test(s);
  const isValid    = (s) => s && s.trim().length > 8;

  const options = [
    pass1Address,
    pass2Address,
    ...candidates,
  ].filter(isValid);

  // Prefer address with ZIP + state, then state only, then any
  const withZipCity = options.filter(hasZipCity);
  if (withZipCity.length > 0) return withZipCity[0];

  const withState = options.filter(hasState);
  if (withState.length > 0) return withState[0];

  return options[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let inspectionText = "";
  let pdfBuffer      = null;
  let filename       = "";

  let propertyId = null;
  try {
    const body = await req.json();
    filename   = body.filename   || "";
    propertyId = body.propertyId ?? null;
    const { signedUrl, rawText } = body;
    const storagePath = body.storagePath || "";

    // ── Fast path: client extracted text — skip server-side PDF download ──────
    if (rawText && rawText.trim().length > MIN_TEXT_LENGTH) {
      inspectionText = rawText;
      console.log(`[parse-inspection] Using client-extracted text (${inspectionText.length} chars) — skipping server PDF download`);

    } else if (storagePath) {
      // ── Service-role SDK download — avoids signed URL fetch hang ─────────────
      // The signed URL fetch() hangs indefinitely for large files (Supabase
      // throttles egress). Using the service-role SDK download() is more reliable.
      console.log(`[parse-inspection] Downloading via SDK: ${storagePath}`);

      // Race the download against a 90-second timeout so we surface the error
      // rather than silently hanging for the full 300s Vercel limit.
      const { data: blob, error: dlErr } = await Promise.race([
        supabaseAdmin.storage.from("documents").download(storagePath),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("STORAGE_TIMEOUT")), 90_000)
        ),
      ]);

      if (dlErr) throw new Error(`Storage download failed: ${dlErr.message}`);

      const arrayBuffer = await blob.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);

      // For large PDFs, pdf-parse consumes the entire 300s budget just parsing.
      // Route directly to the Files API (gpt-4o reads the PDF natively) instead.
      const LARGE_PDF_BYTES = 4 * 1024 * 1024; // 4 MB
      if (pdfBuffer.length > LARGE_PDF_BYTES) {
        console.log(`[parse-inspection] Large PDF (${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB) — skipping pdf-parse, routing to Files API + gpt-4o`);
        // Leave inspectionText empty → charCount=0 → isLikelyImagePdf=true → Files API path below
      } else {
        console.log(`[parse-inspection] Downloaded ${pdfBuffer.length} bytes — running pdf-parse`);
        inspectionText = await extractPdfTextAsync(pdfBuffer);
      }

    } else if (signedUrl) {
      // Legacy fallback: signed URL fetch (kept for backwards compat)
      console.log(`[parse-inspection] Fetching via signedUrl (legacy path)`);
      const fileRes = await fetch(signedUrl);
      if (!fileRes.ok) throw new Error(`Could not fetch file: ${fileRes.status}`);
      const isPdf = filename.toLowerCase().endsWith(".pdf") || (fileRes.headers.get("content-type") || "").includes("pdf");
      if (isPdf) {
        const arrayBuffer = await fileRes.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        inspectionText = await extractPdfTextAsync(pdfBuffer);
      } else {
        inspectionText = await fileRes.text();
      }
    }
  } catch (downloadErr) {
    const msg = downloadErr?.message || String(downloadErr);
    if (msg === "STORAGE_TIMEOUT") {
      console.error("[parse-inspection] Storage download timed out after 90s");
      return Response.json({
        _error: "Your inspection file took too long to load from storage. Please try uploading again.",
        property_address: null, findings: [], home_health_report: null,
      }, { status: 408 });
    }
    console.error("[parse-inspection] Download error:", msg);
    try { inspectionText = await req.text(); } catch { /* ignore */ }
  }

  const charCount = inspectionText.trim().length;
  console.log(`[parse-inspection] Extracted ${charCount} chars from document`);
  let _parseHash = null;

  // ── DB-findings fast path ─────────────────────────────────────────────────
  // If this property already has professional inspection findings stored in the
  // findings table, return those EXACT findings instead of re-running the AI.
  // This guarantees the same report always produces the same findings — even
  // after serverless cold starts wipe the in-process L1 cache, and even if
  // Supabase L2 cache writes failed.
  //
  // We only do this when propertyId is provided by the dashboard, which always
  // sends it for authenticated uploads (after property creation).
  if (propertyId) {
    try {
      const { data: existingRows, error: existErr } = await supabaseAdmin
        .from("findings")
        .select("raw_finding, category, description, severity, normalized_finding_key, scorable, score_impact, recommended_action, estimated_cost_min, estimated_cost_max, confidence_score, classification_reason, needs_review, title, system, component, issue_type, location")
        .eq("property_id", propertyId)
        .eq("finding_source", "professional")
        .order("created_at", { ascending: true })
        .limit(100);

      if (!existErr && existingRows && existingRows.length > 0) {
        console.log(`[parse-inspection] DB fast-path: returning ${existingRows.length} stored findings for property ${propertyId}`);

        // Reconstruct findings in the shape the dashboard expects
        const restoredFindings = existingRows.map(row => ({
          ...(row.raw_finding ?? {}),
          category:               row.category,
          description:            row.description ?? "",
          severity:               row.severity    ?? "info",
          normalized_finding_key: row.normalized_finding_key,
          title:                  row.title,
          system:                 row.system,
          component:              row.component,
          issue_type:             row.issue_type,
          location:               row.location,
          recommended_action:     row.recommended_action,
          estimated_cost_min:     row.estimated_cost_min,
          estimated_cost_max:     row.estimated_cost_max,
          is_scorable:            row.scorable,
          scorable:               row.scorable,
          score_impact:           row.score_impact,
          confidence_score:       row.confidence_score       ?? "medium",
          classification_reason:  row.classification_reason  ?? null,
          needs_review:           row.needs_review            ?? false,
        }));

        // Compute a fresh score from the restored findings
        let home_health_report = null;
        try {
          const normalizedItems = normalizeLegacyFindings(restoredFindings, null, null);
          home_health_report    = computeHomeHealthReport(normalizedItems);
        } catch { /* non-fatal */ }

        return Response.json({
          property_address:  null,   // already stored on the property row
          inspection_date:   null,
          company_name:      null,
          inspector_name:    null,
          summary:           null,
          roof_year:         null,
          hvac_year:         null,
          findings:          restoredFindings,
          home_health_report,
          _source:           "db_findings_cache",
        });
      }
    } catch (dbFastPathErr) {
      console.warn("[parse-inspection] DB fast-path check failed (will re-parse):", dbFastPathErr?.message);
    }
  }

  // ── Image / scanned PDF detection ────────────────────────────────────────
  const isLikelyImagePdf = charCount < MIN_TEXT_LENGTH;
  let message = null;

  if (isLikelyImagePdf) {
    if (pdfBuffer) {
      const bufHash = createHash("sha256").update(pdfBuffer).digest("hex");
      _parseHash = bufHash;
      const cachedVision = await cacheGet(bufHash);
      if (cachedVision) return Response.json(cachedVision);

      console.log("[parse-inspection] Sparse text — trying Files API vision fallback");
      try {
        const candidates = [];
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
  let addressCandidates = [];

  if (!message) {
    addressCandidates = extractAddressCandidates(inspectionText);

    const textForAI = smartExtractSection(inspectionText);
    console.log(`[parse-inspection] Sending ${textForAI.length} chars to gpt-4o-mini`);

    const hash = cacheKey(textForAI);
    _parseHash = hash;
    const cached = await cacheGet(hash);
    if (cached) return Response.json(cached);

    const prompt = buildPrompt(addressCandidates);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: AI_TEMPERATURE,
      seed: AI_SEED,
      messages: [
        {
          role: "system",
          content: "You are an expert at reading home inspection reports in any format — CBHI, HomeGauge, Spectora, HouseMaster, WIN, Palm-Tech, 3D Inspect, iReport, ReportHost, and custom formats. Extract structured data precisely and completely. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: `${prompt}\n\nINSPECTION REPORT TEXT:\n${textForAI}`,
        },
      ],
    });

    message = completion.choices[0].message.content;

    // ── Second pass — find anything missed ────────────────────────────────
    try {
      const pass1Findings = JSON.parse(message).findings ?? [];
      const pass2Prompt   = buildSecondPassPrompt(pass1Findings, addressCandidates);

      const completion2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",  // faster + cheaper for dedup pass; quality adequate for finding missed items
        response_format: { type: "json_object" },
        temperature: AI_TEMPERATURE,
        seed: AI_SEED,
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

      const pass2Raw      = JSON.parse(completion2.choices[0].message.content);
      const pass2Findings = Array.isArray(pass2Raw.findings) ? pass2Raw.findings : [];
      console.log(`[parse-inspection] Pass 1: ${pass1Findings.length} | Pass 2: ${pass2Findings.length}`);

      const mergedFindings = mergeFindings(pass1Findings, pass2Findings);
      console.log(`[parse-inspection] After merge: ${mergedFindings.length} findings`);

      // ── Resolve best address across both passes + regex candidates ────────
      const pass1Parsed = JSON.parse(message);
      const bestAddress = resolveAddress(
        pass1Parsed.property_address,
        pass2Raw.property_address,
        addressCandidates
      );
      console.log(`[parse-inspection] Resolved address: "${bestAddress}"`);

      message = JSON.stringify({
        ...pass1Parsed,
        property_address: bestAddress,
        findings: mergedFindings,
      });
    } catch (pass2Err) {
      console.error("[parse-inspection] Second pass failed (using first pass):", pass2Err?.message);
    }
  }

  try {
    const parsed   = JSON.parse(message);
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    console.log(`[parse-inspection] ${findings.length} findings, address="${parsed.property_address}"`);

    // ── Sanitize years ────────────────────────────────────────────────────
    const currentYear   = new Date().getFullYear();
    const rawRoofYear   = parsed.roof_year;
    const rawHvacYear   = parsed.hvac_year;
    const safeRoofYear  = rawRoofYear  && (currentYear - rawRoofYear)  <= 50 ? rawRoofYear  : null;
    const safeHvacYear  = rawHvacYear  && (currentYear - rawHvacYear)  <= 30 ? rawHvacYear  : null;
    if (rawRoofYear  && !safeRoofYear)  console.warn(`[parse-inspection] Discarded implausible roof_year ${rawRoofYear}`);
    if (rawHvacYear  && !safeHvacYear)  console.warn(`[parse-inspection] Discarded implausible hvac_year ${rawHvacYear}`);

    // ── Scoring engine ────────────────────────────────────────────────────
    const roofAgeYears = safeRoofYear ? currentYear - safeRoofYear : null;
    const hvacAgeYears = safeHvacYear ? currentYear - safeHvacYear : null;

    let home_health_report = null;
    try {
      const normalizedItems  = normalizeLegacyFindings(findings, roofAgeYears, hvacAgeYears);
      home_health_report     = computeHomeHealthReport(normalizedItems);
    } catch (engineErr) {
      console.error("[parse-inspection] Scoring engine error:", engineErr?.message);
    }

    // ── Normalization + dedup ─────────────────────────────────────────────
    const normalizedFindings = normalizeFindings(findings);

    // ── Confidence audit ─────────────────────────────────────────────────
    const confidenceCounts = { high: 0, medium: 0, low: 0, unconfirmed: 0 };
    const needsReviewItems = [];
    for (const nf of normalizedFindings) {
      confidenceCounts[nf.confidence_score] = (confidenceCounts[nf.confidence_score] ?? 0) + 1;
      if (nf.needs_review) needsReviewItems.push({ category: nf.category, reason: nf.classification_reason, desc: nf.description.slice(0, 80) });
    }
    console.log(`[parse-inspection] Confidence:`, confidenceCounts);
    if (needsReviewItems.length > 0) {
      console.warn(`[parse-inspection] ${needsReviewItems.length} findings flagged needs_review:`, needsReviewItems);
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

    if (_parseHash) cacheSet(_parseHash, finalResult);

    return Response.json(finalResult);
  } catch {
    return Response.json({
      property_address: null, inspection_date: null, company_name: null,
      inspector_name: null, summary: null,
      roof_year: null, hvac_year: null, findings: [], home_health_report: null,
    });
  }
}
