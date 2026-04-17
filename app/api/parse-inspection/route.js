import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { inflateRawSync, inflateSync, unzipSync } from "zlib";

export const maxDuration = 120;

const CURRENT_YEAR = new Date().getFullYear();

const SYSTEM_PROMPT = `You are an expert home inspection report parser. Extract key data and return ONLY valid JSON — no markdown, no extra text.

Return this exact structure:
{
  "inspection_type": "string",
  "property_address": "string or null",
  "inspection_date": "string or null",
  "inspector_name": "string or null",
  "company_name": "string or null",
  "summary": "2-3 sentence summary of overall condition",
  "findings": [
    { "category": "string", "description": "string", "severity": "info|warning|critical", "estimated_cost": null or number }
  ],
  "recommendations": ["string"],
  "total_estimated_cost": null or number,
  "roof_year": null or number (4-digit year the roof was installed, NOT age),
  "hvac_year": null or number (4-digit year the HVAC was installed, NOT age),
  "timeline_events": ["short event strings"]
}

Rules:
- severity: critical = safety hazard or cost > $2000; warning = aging/wear/minor issue; info = observation only
- roof_year and hvac_year must be a 4-digit installation year (e.g. 2008), NOT an age in years
- If you only see an age (e.g. "15 years old"), calculate the install year: ${CURRENT_YEAR} - age
- roof_year must be between 1950 and ${CURRENT_YEAR}; hvac_year must be between 1970 and ${CURRENT_YEAR}
- If uncertain, return null rather than guessing
- Deduplicate findings — one entry per distinct system/category
- Extract ALL findings — work through every section of the report`;

// ── Normalize and validate extracted data ────────────────────────────────
function normalizeData(parsed) {
  const out = { ...parsed };

  // Validate roof_year
  if (out.roof_year !== null && out.roof_year !== undefined) {
    const ry = parseInt(out.roof_year, 10);
    if (isNaN(ry) || ry < 1950 || ry > CURRENT_YEAR) {
      console.warn(`[VALIDATION] Discarding invalid roof_year=${out.roof_year}`);
      out.roof_year = null;
    } else {
      out.roof_year = ry;
    }
  }

  // Validate hvac_year
  if (out.hvac_year !== null && out.hvac_year !== undefined) {
    const hy = parseInt(out.hvac_year, 10);
    if (isNaN(hy) || hy < 1970 || hy > CURRENT_YEAR) {
      console.warn(`[VALIDATION] Discarding invalid hvac_year=${out.hvac_year}`);
      out.hvac_year = null;
    } else {
      out.hvac_year = hy;
    }
  }

  // Normalize findings
  const validSeverities = new Set(["info", "warning", "critical"]);
  if (Array.isArray(out.findings)) {
    // Normalize each finding
    const normalized = out.findings.map(f => ({
      ...f,
      category: (f.category || "General").trim(),
      description: (f.description || "").trim(),
      severity: validSeverities.has((f.severity || "").toLowerCase())
        ? f.severity.toLowerCase()
        : "info",
      estimated_cost: f.estimated_cost != null
        ? (isNaN(Number(f.estimated_cost)) ? null : Math.abs(Number(f.estimated_cost)))
        : null,
    }));

    // Deduplicate by category — keep highest severity entry
    const severityRank = { critical: 3, warning: 2, info: 1 };
    const seen = new Map();
    for (const f of normalized) {
      const key = f.category.toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = seen.get(key);
      if (!existing || (severityRank[f.severity] || 0) > (severityRank[existing.severity] || 0)) {
        seen.set(key, f);
      }
    }
    out.findings = Array.from(seen.values());
    console.log(`[NORMALIZE] ${normalized.length} raw → ${out.findings.length} deduped findings`);
  }

  return out;
}

// ── Strategy 1: decompress zlib/deflate streams and parse PDF text operators ──
function extractViaStreams(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [];
  const streamRe = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const bytes = Buffer.from(m[1], "latin1");
    let content = "";
    const tries = [
      () => inflateRawSync(bytes).toString("utf8"),
      () => inflateSync(bytes).toString("utf8"),
      () => unzipSync(bytes).toString("utf8"),
      () => m[1],
    ];
    for (const fn of tries) {
      try { content = fn(); break; } catch {}
    }
    const textRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")|(\[(?:[^[\]]*(?:\([^)]*\)[^[\]]*)*)\])\s*TJ/g;
    let t;
    while ((t = textRe.exec(content)) !== null) {
      if (t[1]) {
        chunks.push(t[1]
          .replace(/\\n/g, "\n").replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t").replace(/\\\\/g, "\\")
          .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
          .replace(/\\(.)/g, "$1"));
      } else if (t[2]) {
        const inner = t[2].match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
        if (inner) chunks.push(inner.map(s => s.slice(1, -1)).join(""));
      }
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

// ── Strategy 2: scan raw bytes for printable ASCII runs ≥ 5 chars ──
function extractViaStrings(buffer) {
  const raw = buffer.toString("latin1");
  const runs = raw.match(/[ -~]{5,}/g) || [];
  const useful = runs.filter(s => {
    const wordChars = (s.match(/[A-Za-z0-9 ,.;:!?'"-]/g) || []).length;
    return wordChars / s.length > 0.6 && /[A-Za-z]{2,}/.test(s);
  });
  return useful.join(" ").replace(/\s+/g, " ").trim();
}

// ── Strategy 3: UTF-16 scan ──
function extractViaUtf16(buffer) {
  try {
    const text = buffer.toString("utf16le");
    const runs = text.match(/[ -~\u00A0-\u00FF]{5,}/g) || [];
    return runs.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractTextFromPdf(buffer) {
  const streamText = extractViaStreams(buffer);
  console.log(`Stream extraction: ${streamText.length} chars`);
  if (streamText.length >= 500) return { text: streamText, method: "streams" };

  const stringsText = extractViaStrings(buffer);
  console.log(`Strings extraction: ${stringsText.length} chars`);
  if (stringsText.length >= 300) return { text: stringsText, method: "strings" };

  const utf16Text = extractViaUtf16(buffer);
  console.log(`UTF-16 extraction: ${utf16Text.length} chars`);
  if (utf16Text.length >= 300) return { text: utf16Text, method: "utf16" };

  const best = [streamText, stringsText, utf16Text].sort((a, b) => b.length - a.length)[0];
  return { text: best, method: "best-effort" };
}

function safeParseJson(raw) {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

const EMPTY_SUCCESS = {
  success: true,
  inspection_type: "Home Inspection",
  summary: "Report received. Upload a text-based PDF for full AI analysis.",
  findings: [],
  recommendations: [],
  total_estimated_cost: null,
  roof_year: null,
  hvac_year: null,
  timeline_events: [],
};

export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build user-scoped Supabase client from Authorization header
  const authHeader = req.headers.get("authorization") || "";
  const userToken = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    userToken ? { global: { headers: { Authorization: `Bearer ${userToken}` } } } : {}
  );

  // Get user id
  let userId = null;
  if (userToken) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {}
  }

  try {
    const { signedUrl, filename, storagePath } = await req.json();
    if (!signedUrl) return Response.json(EMPTY_SUCCESS);

    let parsed = {};
    let debugInfo = { method: null, rawChars: 0, sentChars: 0, rawAiOutput: null, validationNotes: [] };

    try {
      console.log("Downloading PDF...");
      const pdfRes = await fetch(signedUrl);
      if (!pdfRes.ok) throw new Error(`Download failed: ${pdfRes.status}`);

      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      console.log(`Downloaded: ${Math.round(pdfBuffer.length / 1024)}KB`);

      const { text: fullText, method } = extractTextFromPdf(pdfBuffer);
      debugInfo.method = method;
      debugInfo.rawChars = fullText.length;
      console.log(`Extraction method: ${method}, total chars: ${fullText.length}`);

      if (fullText.length < 50) {
        throw new Error(`Could not extract text (only ${fullText.length} chars). This may be a scanned image-only PDF.`);
      }

      // Sample across the full document — start, middle, end
      const SAMPLE = 60000;
      let text;
      if (fullText.length <= SAMPLE) {
        text = fullText;
      } else {
        const mid = Math.floor(fullText.length / 2) - 10000;
        text = [
          fullText.slice(0, 25000),
          "\n\n[...]\n\n",
          fullText.slice(mid, mid + 20000),
          "\n\n[...]\n\n",
          fullText.slice(-15000),
        ].join("");
      }

      debugInfo.sentChars = text.length;
      debugInfo.textPreview = text.slice(0, 500);
      console.log(`Sending ${text.length} chars to gpt-4o-mini (temperature=0)...`);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        seed: 42,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Parse this home inspection report:\n\n${text}` },
        ],
        max_tokens: 2500,
      });

      const raw = completion.choices[0]?.message?.content || "";
      debugInfo.rawAiOutput = raw.slice(0, 2000);
      const result = safeParseJson(raw);
      if (result) {
        // Normalize and validate before using
        parsed = normalizeData(result);
        console.log(`Parsed+normalized — ${parsed.findings?.length ?? 0} findings, roof: ${parsed.roof_year}, hvac: ${parsed.hvac_year}, total_cost: ${parsed.total_estimated_cost}`);
      } else {
        console.error("JSON parse failed. Raw:", raw.slice(0, 300));
        parsed.summary = "Inspection uploaded. AI analysis returned an unexpected format — try again.";
      }

    } catch (parseErr) {
      console.error("Processing error:", parseErr?.message);
      parsed.summary = parseErr?.message || "Processing error.";
    } finally {
      if (storagePath) {
        try { await supabase.storage.from("documents").remove([storagePath]); } catch {}
      }
    }

    // Save everything to Supabase properties table
    try {
      const updateData = {
        inspection_summary:     parsed.summary              || null,
        inspection_type:        parsed.inspection_type      || "Home Inspection",
        inspection_date:        parsed.inspection_date      || null,
        inspector_company:      parsed.company_name         || null,
        inspection_findings:    parsed.findings             || [],
        recommendations:        parsed.recommendations      || [],
        total_estimated_cost:   parsed.total_estimated_cost || null,
        inspection_uploaded_at: new Date().toISOString(),
        updated_at:             new Date().toISOString(),
      };
      if (parsed.roof_year) updateData.roof_year = parsed.roof_year;
      if (parsed.hvac_year) updateData.hvac_year = parsed.hvac_year;

      const { data: existing } = await supabase
        .from("properties")
        .select("id, address")
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        // Always claim the row with this user's id (in case it was null before)
        if (userId) updateData.user_id = userId;
        // Update address only if we got a real address and current one is blank
        if (parsed.property_address && (!existing.address || existing.address === "My Home")) {
          updateData.address = parsed.property_address;
        }
        const { error: updateErr } = await supabase.from("properties").update(updateData).eq("id", existing.id);
        if (updateErr) console.error("Properties update error:", updateErr.message);
      } else {
        const { error: insertErr } = await supabase.from("properties").insert({
          address: parsed.property_address || "My Home",
          user_id: userId,
          ...updateData,
        });
        if (insertErr) console.error("Properties insert error:", insertErr.message);
      }
    } catch (dbErr) {
      console.error("Supabase DB error:", dbErr?.message);
    }

    return Response.json({
      success: true,
      inspection_type:      parsed.inspection_type      ?? "Home Inspection",
      property_address:     parsed.property_address     ?? null,
      inspection_date:      parsed.inspection_date      ?? null,
      inspector_name:       parsed.inspector_name       ?? null,
      company_name:         parsed.company_name         ?? null,
      summary:              parsed.summary              ?? "Inspection analyzed.",
      findings:             parsed.findings             ?? [],
      recommendations:      parsed.recommendations      ?? [],
      total_estimated_cost: parsed.total_estimated_cost ?? null,
      roof_year:            parsed.roof_year            ?? null,
      hvac_year:            parsed.hvac_year            ?? null,
      timeline_events:      parsed.timeline_events      ?? [],
      _debug: {
        extraction_method:  debugInfo.method,
        raw_chars_extracted: debugInfo.rawChars,
        chars_sent_to_ai:   debugInfo.sentChars,
        text_preview:       debugInfo.textPreview,
        raw_ai_output:      debugInfo.rawAiOutput,
      },
    });

  } catch (err) {
    console.error("Fatal error:", err?.message);
    return Response.json(EMPTY_SUCCESS);
  }
}
