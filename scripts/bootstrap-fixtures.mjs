/**
 * BTLR Parser Fixture Bootstrapper
 *
 * Runs every PDF in __tests__/parser-fixtures/ that does NOT yet have an
 * .expected.json through the real two-pass GPT-4o parser and writes a
 * starter .expected.json for each one.
 *
 * Review each generated file and tweak minimumFindings before committing.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/bootstrap-fixtures.mjs
 *
 * Options:
 *   --only=smith-inspection   Only process one fixture by base name
 *   --force                   Regenerate even if .expected.json already exists
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../__tests__/parser-fixtures");

const args = process.argv.slice(2);
const onlyFlag = args.find(a => a.startsWith("--only="))?.split("=")[1] ?? null;
const force    = args.includes("--force");

const EXHAUSTIVE_PREAMBLE =
  "IMPORTANT: This is a multi-page home inspection report. You MUST read and analyze " +
  "EVERY page from start to finish before responding. Do NOT stop after finding a few items. " +
  "A thorough 30–40 page inspection typically has 15–50+ individual findings. Extract every " +
  "deficiency, repair item, and observation — including minor, maintenance, and informational items.\n\n";

const PROMPT = `Extract structured data from this home inspection report. Respond ONLY with valid JSON:

{
  "property_address": "string | null",
  "inspection_date": "string | null",
  "company_name": "string | null",
  "inspector_name": "string | null",
  "findings": [
    {
      "category": "string",
      "description": "string",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ]
}

findings: Extract ALL deficiencies, repair items, and observations. A typical 30-40 page report has 15-50+ findings. Most critical first.`;

const PASS2_PROMPT = (categories) =>
  `You are doing a SECOND REVIEW of this inspection report. Pass 1 found findings in: ${categories || "none"}.
Find ANYTHING missed — every system, every severity level. Respond ONLY with valid JSON:
{ "findings": [{ "category": "string", "description": "string", "severity": "critical"|"warning"|"info", "estimated_cost": number|null }] }
Return up to 50 new findings not already captured in pass 1.`;

// ── Pick 3-5 representative mustInclude rules from findings ────────────────
function pickMustIncludes(findings) {
  const rules = [];
  const seen = new Set();

  // Priority categories to look for
  const priority = ["roof", "electrical", "plumbing", "hvac", "foundation", "structural", "safety"];

  for (const cat of priority) {
    const match = findings.find(f =>
      f.category?.toLowerCase().includes(cat) &&
      f.description?.length > 10 &&
      !seen.has(cat)
    );
    if (match) {
      seen.add(cat);
      const rule = {
        category: match.category,
        descriptionContains: match.description.split(" ").slice(0, 3).join(" ").toLowerCase(),
      };
      if (match.severity === "critical" || match.severity === "warning") {
        rule.severity = match.severity;
      }
      rules.push(rule);
      if (rules.length >= 4) break;
    }
  }

  // Fill remaining slots with whatever is left
  if (rules.length < 3) {
    for (const f of findings) {
      if (rules.length >= 3) break;
      const key = f.category?.toLowerCase().split(" ")[0];
      if (!seen.has(key) && f.description?.length > 10) {
        seen.add(key);
        rules.push({
          category: f.category,
          descriptionContains: f.description.split(" ").slice(0, 3).join(" ").toLowerCase(),
        });
      }
    }
  }

  return rules;
}

// ── Two-pass parse ─────────────────────────────────────────────────────────
async function parsePdf(openai, pdfPath, name) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const sizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(1);
  console.log(`\n[${name}] Uploading ${sizeMB}MB…`);

  let fileId = null;
  try {
    const file = await openai.files.create({
      file: new File([pdfBuffer], path.basename(pdfPath), { type: "application/pdf" }),
      purpose: "user_data",
    });
    fileId = file.id;
    console.log(`[${name}] File ID: ${fileId}`);

    // Pass 1
    const c1 = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      seed: 91472,
      messages: [
        { role: "system", content: "You extract structured data from home inspection reports. Read EVERY page exhaustively. Respond only with valid JSON." },
        { role: "user", content: [
          { type: "text", text: EXHAUSTIVE_PREAMBLE + PROMPT },
          { type: "file", file: { file_id: fileId } },
        ]},
      ],
    });
    const pass1 = JSON.parse(c1.choices[0].message.content ?? "{}");
    const pass1Findings = pass1.findings ?? [];
    console.log(`[${name}] Pass 1: ${pass1Findings.length} findings`);

    // Pass 2
    const cats = [...new Set(pass1Findings.map(f => f.category))].join(", ");
    const c2 = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      seed: 91472,
      messages: [
        { role: "system", content: "Second review of home inspection — find missed findings. Read every page. Respond only with valid JSON." },
        { role: "user", content: [
          { type: "text", text: EXHAUSTIVE_PREAMBLE + PASS2_PROMPT(cats) },
          { type: "file", file: { file_id: fileId } },
        ]},
      ],
    });
    const pass2 = JSON.parse(c2.choices[0].message.content ?? "{}");
    const pass2Findings = pass2.findings ?? [];
    console.log(`[${name}] Pass 2: ${pass2Findings.length} additional findings`);

    // Merge + dedupe
    const all = [...pass1Findings, ...pass2Findings];
    const seen = new Set();
    const merged = [];
    for (const f of all) {
      const key = `${f.category}|${(f.description ?? "").slice(0, 40).toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); merged.push(f); }
    }
    console.log(`[${name}] Merged: ${merged.length} findings`);

    return { ...pass1, findings: merged, _sizeMB: sizeMB };
  } finally {
    if (fileId) {
      try { await openai.files.delete(fileId); } catch {}
      console.log(`[${name}] File deleted`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set.");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const pdfs = fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".pdf"))
    .filter(f => !onlyFlag || f.replace(/\.pdf$/, "") === onlyFlag);

  if (pdfs.length === 0) {
    console.log("No PDFs found in", FIXTURES_DIR);
    console.log("Drop your inspection PDFs there and re-run.");
    process.exit(0);
  }

  const toProcess = pdfs.filter(pdf => {
    const base = pdf.replace(/\.pdf$/, "");
    const expectedPath = path.join(FIXTURES_DIR, `${base}.expected.json`);
    if (!force && fs.existsSync(expectedPath)) {
      console.log(`[${base}] Already has .expected.json — skipping (use --force to regenerate)`);
      return false;
    }
    return true;
  });

  console.log(`\nBootstrapping ${toProcess.length} fixture(s)…`);

  for (const pdf of toProcess) {
    const base = pdf.replace(/\.pdf$/, "");
    const pdfPath = path.join(FIXTURES_DIR, pdf);
    const expectedPath = path.join(FIXTURES_DIR, `${base}.expected.json`);

    try {
      const result = await parsePdf(openai, pdfPath, base);
      const findings = result.findings ?? [];

      // Build required categories from what was actually found
      const foundCats = [...new Set(findings.map(f => f.category))];
      const requiredCategories = foundCats
        .filter(c => ["roof", "electrical", "plumbing", "hvac", "foundation"].some(k => c.toLowerCase().includes(k)))
        .slice(0, 4);

      // minimumFindings = actual count minus 20% buffer (so small regressions don't fail)
      const minimumFindings = Math.floor(findings.length * 0.8);

      const expected = {
        _comment: `Auto-generated by bootstrap-fixtures.mjs on ${new Date().toISOString().slice(0, 10)}. Review and adjust minimumFindings before committing.`,
        description: `${findings.length}-finding parse of ${base}.pdf (${result._sizeMB}MB)`,
        source: result.company_name ?? "Unknown",
        fileSizeApproxMB: parseFloat(result._sizeMB),
        minimumFindings,
        requiredCategories,
        mustInclude: pickMustIncludes(findings),
        mustNotInclude: [],
        ...(result.property_address ? { propertyAddressContains: result.property_address.split(",")[0]?.trim() } : {}),
        allowedTimeoutMs: 240000,
        _updateInstructions: "After a successful parse, review mustInclude entries and adjust minimumFindings if needed.",
        _rawFindingCount: findings.length,
        _categories: foundCats,
      };

      fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2));
      console.log(`[${base}] ✓ Written: ${expectedPath}`);
      console.log(`           ${findings.length} findings → minimumFindings: ${minimumFindings}`);
      console.log(`           Address: ${result.property_address ?? "not found"}`);
      console.log(`           Categories: ${foundCats.join(", ")}`);

    } catch (err) {
      console.error(`[${base}] FAILED:`, err.message);
    }
  }

  console.log("\nDone. Review each .expected.json before committing.");
  console.log("Then run: npx vitest __tests__/parser.test.ts");
}

main();
