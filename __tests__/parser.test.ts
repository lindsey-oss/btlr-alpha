/**
 * BTLR Parser Regression Test Suite
 *
 * Tests real inspection PDFs against expected outputs defined in
 * __tests__/parser-fixtures/*.expected.json.
 *
 * Each fixture pair (PDF + expected JSON) is a permanent contract:
 * once a PDF parses correctly, it must keep parsing correctly after
 * any future change to the parser.
 *
 * Run all parser tests:     npm test
 * Run just parser tests:    npx vitest __tests__/parser.test.ts
 * Run in watch mode:        npm run test:watch
 *
 * ──────────────────────────────────────────────────────────────────
 * HOW TO ADD A FIXTURE
 * ──────────────────────────────────────────────────────────────────
 * 1. Drop the PDF in __tests__/parser-fixtures/your-fixture.pdf
 * 2. Create __tests__/parser-fixtures/your-fixture.expected.json
 *    (see README.md in that folder for the schema)
 * 3. Run npm test — the new fixture will be auto-discovered
 *
 * ──────────────────────────────────────────────────────────────────
 * HOW THESE TESTS RUN
 * ──────────────────────────────────────────────────────────────────
 * These are INTEGRATION tests — they call the real OpenAI API and
 * require OPENAI_API_KEY to be set. They are intentionally slow
 * (large PDFs take 60-180s). They are NOT run in CI by default;
 * run them manually before shipping parser changes.
 *
 * To skip fixtures that require OpenAI, set:
 *   BTLR_PARSER_TEST_OFFLINE=true
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface MustInclude {
  _comment?: string;
  category: string;
  descriptionContains?: string;
  severity?: "critical" | "warning" | "info";
}

interface MustNotInclude {
  description?: string;
  category?: string;
}

interface ParserFixtureExpected {
  _comment?: string;
  description: string;
  source?: string;
  fileSizeApproxMB?: number;
  pageCount?: number;
  minimumFindings: number;
  requiredCategories?: string[];
  mustInclude?: MustInclude[];
  mustNotInclude?: MustNotInclude[];
  propertyAddressContains?: string;
  allowedTimeoutMs?: number;
  _updateInstructions?: string;
}

interface ParsedFinding {
  category: string;
  description: string;
  severity: string;
  [key: string]: unknown;
}

interface ParseResult {
  findings: ParsedFinding[];
  property_address?: string | null;
  inspection_date?: string | null;
  company_name?: string | null;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────
// FIXTURE DISCOVERY
// ─────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, "parser-fixtures");

function discoverFixtures(): { name: string; pdfPath: string; expectedPath: string; expected: ParserFixtureExpected }[] {
  const fixtures: ReturnType<typeof discoverFixtures> = [];

  if (!fs.existsSync(FIXTURES_DIR)) return fixtures;

  const files = fs.readdirSync(FIXTURES_DIR);
  const pdfFiles = files.filter(f => f.endsWith(".pdf"));

  for (const pdfFile of pdfFiles) {
    const baseName = pdfFile.replace(/\.pdf$/, "");
    const expectedFile = `${baseName}.expected.json`;
    const expectedPath = path.join(FIXTURES_DIR, expectedFile);

    if (!fs.existsSync(expectedPath)) {
      console.warn(`[parser.test] No expected file for ${pdfFile} — skipping. Create ${expectedFile} to enable.`);
      continue;
    }

    try {
      const expected: ParserFixtureExpected = JSON.parse(fs.readFileSync(expectedPath, "utf-8"));
      fixtures.push({
        name: baseName,
        pdfPath: path.join(FIXTURES_DIR, pdfFile),
        expectedPath,
        expected,
      });
    } catch (e) {
      console.error(`[parser.test] Failed to parse ${expectedFile}:`, e);
    }
  }

  return fixtures;
}

// ─────────────────────────────────────────────────────────────────
// PARSER INVOCATION
//
// Calls the same logic as the route handler — uses the OpenAI Files
// API path (since fixture PDFs are real large files that won't
// extract text via pdfjs). Mirrors exactly what happens in prod.
// ─────────────────────────────────────────────────────────────────

async function runParserOnFixture(pdfPath: string, fixtureName: string): Promise<ParseResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Dynamic import — route.js is a Next.js route, so we import only
  // the functions we need directly from the lib layer.
  // For the Files API path, we replicate the core logic here so tests
  // run without a Next.js server.
  const { normalizeFindings } = await import("../lib/findings/normalizeFinding");

  const pdfBuffer = fs.readFileSync(pdfPath);
  const filename = path.basename(pdfPath);

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
  "summary": "string | null",
  "findings": [
    {
      "category": "string",
      "description": "string",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ]
}

findings: Extract ALL deficiencies, repair items, and observations. A typical 30–40 page report has 15–50+ findings. Most critical first.`;

  console.log(`[parser.test:${fixtureName}] Uploading ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB to OpenAI Files API…`);

  let fileId: string | null = null;
  try {
    const file = await openai.files.create({
      file: new File([pdfBuffer], filename, { type: "application/pdf" }),
      purpose: "user_data",
    });
    fileId = file.id;
    console.log(`[parser.test:${fixtureName}] File uploaded: ${fileId}`);

    // Pass 1
    const c1 = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      seed: 91472,
      messages: [
        { role: "system", content: "You extract structured data from home inspection reports. Read EVERY page exhaustively. Respond only with valid JSON." },
        { role: "user", content: [{ type: "text", text: EXHAUSTIVE_PREAMBLE + PROMPT }, { type: "file", file: { file_id: fileId } }] },
      ],
    });
    const pass1 = JSON.parse(c1.choices[0].message.content ?? "{}");
    const pass1Findings: ParsedFinding[] = pass1.findings ?? [];
    console.log(`[parser.test:${fixtureName}] Pass 1: ${pass1Findings.length} findings`);

    // Pass 2
    const systemCategories = [...new Set(pass1Findings.map((f: ParsedFinding) => f.category))].join(", ");
    const pass2Prompt = `You are doing a SECOND REVIEW of this inspection report. Pass 1 found findings in: ${systemCategories || "none"}.
Find ANYTHING missed — every system, every severity level. Respond ONLY with valid JSON:
{ "findings": [{ "category": "string", "description": "string", "severity": "critical"|"warning"|"info", "estimated_cost": number|null }] }
Return up to 50 new findings not already captured in pass 1.`;

    const c2 = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      seed: 91472,
      messages: [
        { role: "system", content: "Second review of home inspection — find missed findings. Read every page. Respond only with valid JSON." },
        { role: "user", content: [{ type: "text", text: EXHAUSTIVE_PREAMBLE + pass2Prompt }, { type: "file", file: { file_id: fileId } }] },
      ],
    });
    const pass2 = JSON.parse(c2.choices[0].message.content ?? "{}");
    const pass2Findings: ParsedFinding[] = pass2.findings ?? [];
    console.log(`[parser.test:${fixtureName}] Pass 2: ${pass2Findings.length} findings`);

    // Simple merge (deduplicate by category+description similarity)
    const allFindings = [...pass1Findings, ...pass2Findings];
    const seen = new Set<string>();
    const merged: ParsedFinding[] = [];
    for (const f of allFindings) {
      const key = `${f.category}|${(f.description ?? "").slice(0, 40).toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); merged.push(f); }
    }

    console.log(`[parser.test:${fixtureName}] After merge: ${merged.length} findings`);

    const normalized = normalizeFindings(merged);

    return { ...pass1, findings: normalized };
  } finally {
    if (fileId) {
      try { await openai.files.delete(fileId); } catch { /* ignore */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────

const OFFLINE = process.env.BTLR_PARSER_TEST_OFFLINE === "true";
const fixtures = discoverFixtures();

if (fixtures.length === 0) {
  describe("Parser fixture tests", () => {
    it("should have at least one fixture PDF in __tests__/parser-fixtures/", () => {
      console.warn("No parser fixtures found. Add a PDF + .expected.json to __tests__/parser-fixtures/");
      expect(true).toBe(true); // soft pass — we don't want to block CI with no fixtures
    });
  });
} else {
  for (const fixture of fixtures) {
    describe(`Parser fixture: ${fixture.name}`, () => {
      const { expected } = fixture;
      const timeoutMs = expected.allowedTimeoutMs ?? 180_000;

      let result: ParseResult | null = null;
      let parseError: Error | null = null;

      beforeAll(async () => {
        if (OFFLINE) return;
        if (!process.env.OPENAI_API_KEY) {
          console.warn(`[${fixture.name}] OPENAI_API_KEY not set — skipping API call`);
          return;
        }
        try {
          result = await runParserOnFixture(fixture.pdfPath, fixture.name);
        } catch (e) {
          parseError = e as Error;
        }
      }, timeoutMs);

      it("parser completes without error", () => {
        if (OFFLINE || !process.env.OPENAI_API_KEY) return;
        expect(parseError).toBeNull();
        expect(result).not.toBeNull();
      });

      it(`returns at least ${expected.minimumFindings} findings`, () => {
        if (OFFLINE || !process.env.OPENAI_API_KEY || !result) return;
        const count = result.findings?.length ?? 0;
        console.log(`[${fixture.name}] Found ${count} findings (minimum: ${expected.minimumFindings})`);
        expect(count).toBeGreaterThanOrEqual(expected.minimumFindings);
      });

      if (expected.requiredCategories && expected.requiredCategories.length > 0) {
        it(`includes required categories: ${expected.requiredCategories.join(", ")}`, () => {
          if (OFFLINE || !process.env.OPENAI_API_KEY || !result) return;
          const foundCategories = new Set(result.findings.map(f => f.category));
          for (const cat of expected.requiredCategories!) {
            const hit = result.findings.some(f =>
              f.category?.toLowerCase().includes(cat.toLowerCase())
            );
            expect(hit, `Missing required category: ${cat} (found: ${[...foundCategories].join(", ")})`).toBe(true);
          }
        });
      }

      if (expected.mustInclude && expected.mustInclude.length > 0) {
        for (const rule of expected.mustInclude) {
          const label = rule.descriptionContains
            ? `${rule.category} finding containing "${rule.descriptionContains}"`
            : `${rule.category} finding`;

          it(`includes: ${label}`, () => {
            if (OFFLINE || !process.env.OPENAI_API_KEY || !result) return;
            const match = result!.findings.find(f => {
              const catMatch = f.category?.toLowerCase().includes(rule.category.toLowerCase());
              const descMatch = !rule.descriptionContains ||
                f.description?.toLowerCase().includes(rule.descriptionContains.toLowerCase());
              const sevMatch = !rule.severity || f.severity === rule.severity;
              return catMatch && descMatch && sevMatch;
            });
            if (!match) {
              console.error(`[${fixture.name}] Missing: ${label}`);
              console.error(`  Available ${rule.category} findings:`,
                result!.findings.filter(f => f.category?.toLowerCase().includes(rule.category.toLowerCase()))
                  .map(f => `"${f.description?.slice(0, 60)}"`)
              );
            }
            expect(match).not.toBeUndefined();
          });
        }
      }

      if (expected.propertyAddressContains) {
        it(`property address contains "${expected.propertyAddressContains}"`, () => {
          if (OFFLINE || !process.env.OPENAI_API_KEY || !result) return;
          expect(result!.property_address?.toLowerCase()).toContain(
            expected.propertyAddressContains!.toLowerCase()
          );
        });
      }

      it("snapshot: log all findings for review", () => {
        if (OFFLINE || !process.env.OPENAI_API_KEY || !result) return;
        console.log(`\n${"─".repeat(60)}`);
        console.log(`FIXTURE: ${fixture.name} — ${result.findings.length} findings`);
        console.log(`Address: ${result.property_address ?? "not found"}`);
        console.log(`─`.repeat(60));
        result.findings.forEach((f, i) => {
          console.log(`  ${String(i + 1).padStart(2)}. [${f.severity.toUpperCase()}] ${f.category}: ${f.description?.slice(0, 80)}`);
        });
        console.log(`${"─".repeat(60)}\n`);
        expect(true).toBe(true); // always passes — this test is for logging only
      });
    });
  }
}
