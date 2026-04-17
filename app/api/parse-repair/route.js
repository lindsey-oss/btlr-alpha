import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { inflateRawSync, inflateSync, unzipSync } from "zlib";

export const maxDuration = 60;

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert at parsing home repair documents — invoices, receipts, contractor reports, work orders, and warranties. Extract structured information and return ONLY valid JSON — no markdown, no extra text.

Return this exact structure:
{
  "vendor_name": "string or null",
  "service_date": "string or null (e.g. '2024-03-15' or 'March 15 2024')",
  "repair_summary": "1-2 sentence summary of what was repaired/serviced",
  "system_category": "the home system category — use one of: Roof, HVAC, Electrical, Plumbing, Foundation, Structural, Windows, Doors, Deck, Patio, Insulation, Drywall, Flooring, Appliances, Pest, General",
  "is_completed": true or false (true if work appears complete based on document context),
  "cost": null or number (total cost paid — not estimate, actual if visible),
  "line_items": ["short descriptions of specific work items, one per line"],
  "warranty_period": "string or null (e.g. '1 year parts and labor', '90 days')",
  "notes": "any other relevant information from the document"
}

Rules:
- is_completed: true for invoices/receipts with a paid amount; false for quotes/estimates
- cost: extract the total amount paid (not estimate) — use null if unclear
- system_category: pick the closest match from the allowed list
- line_items: extract specific work items, max 8 items
- If the document is a warranty, set is_completed to true and note coverage in notes`;

// ── PDF extraction (same 3-strategy approach as parse-inspection) ─────────────
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

function extractViaStrings(buffer) {
  const raw = buffer.toString("latin1");
  const runs = raw.match(/[ -~]{5,}/g) || [];
  const useful = runs.filter(s => {
    const wordChars = (s.match(/[A-Za-z0-9 ,.;:!?'"-]/g) || []).length;
    return wordChars / s.length > 0.6 && /[A-Za-z]{2,}/.test(s);
  });
  return useful.join(" ").replace(/\s+/g, " ").trim();
}

function extractViaUtf16(buffer) {
  try {
    const text = buffer.toString("utf16le");
    const runs = text.match(/[ -~\u00A0-\u00FF]{5,}/g) || [];
    return runs.join(" ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

function extractTextFromPdf(buffer) {
  const streamText = extractViaStreams(buffer);
  if (streamText.length >= 200) return { text: streamText, method: "streams" };

  const stringsText = extractViaStrings(buffer);
  if (stringsText.length >= 100) return { text: stringsText, method: "strings" };

  const utf16Text = extractViaUtf16(buffer);
  if (utf16Text.length >= 100) return { text: utf16Text, method: "utf16" };

  const best = [streamText, stringsText, utf16Text].sort((a, b) => b.length - a.length)[0];
  return { text: best, method: "best-effort" };
}

function safeParseJson(raw) {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(clean);
  } catch { return null; }
}

// ── Category key normalizer (must match dashboard logic) ──────────────────────
function toCategoryKey(category) {
  return (category || "general").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Match repair to existing inspection findings ──────────────────────────────
function matchRepairToFindings(repairCategory, existingFindings) {
  if (!existingFindings?.length || !repairCategory) return [];

  const repairKey = toCategoryKey(repairCategory);
  const matches = [];

  for (const finding of existingFindings) {
    const findingKey = toCategoryKey(finding.category);
    // Direct match
    if (findingKey === repairKey) {
      matches.push({ key: findingKey, category: finding.category, confidence: "high" });
      continue;
    }
    // Partial match (one contains the other)
    if (findingKey.includes(repairKey) || repairKey.includes(findingKey)) {
      matches.push({ key: findingKey, category: finding.category, confidence: "medium" });
    }
  }

  return matches;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Auth
  const authHeader = req.headers.get("authorization") || "";
  const userToken = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    userToken ? { global: { headers: { Authorization: `Bearer ${userToken}` } } } : {}
  );

  let userId = null;
  if (userToken) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {}
  }

  try {
    const body = await req.json();
    const { signedUrl, filename, storagePath, existingFindings } = body;

    if (!signedUrl) {
      return Response.json({ success: false, error: "No document URL provided" }, { status: 400 });
    }

    let parsed = {};
    let extractedText = "";

    try {
      // Download and extract text from PDF
      const pdfRes = await fetch(signedUrl);
      if (!pdfRes.ok) throw new Error(`Download failed: ${pdfRes.status}`);

      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      const { text, method } = extractTextFromPdf(pdfBuffer);
      extractedText = text;

      console.log(`[parse-repair] Extraction: ${method}, ${text.length} chars`);

      if (text.length < 30) {
        return Response.json({
          success: false,
          error: "Could not extract text from this document. Please try a text-based PDF."
        });
      }

      // Send to AI (cap at 20k chars — repair docs are usually short)
      const textToSend = text.slice(0, 20000);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        seed: 42,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Parse this home repair document:\n\n${textToSend}` },
        ],
        max_tokens: 1000,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const result = safeParseJson(raw);
      if (result) {
        parsed = result;
      } else {
        console.error("[parse-repair] JSON parse failed:", raw.slice(0, 200));
        return Response.json({ success: false, error: "AI returned unexpected format — please try again." });
      }

    } catch (parseErr) {
      console.error("[parse-repair] Processing error:", parseErr?.message);
      return Response.json({ success: false, error: parseErr?.message || "Processing error" });
    } finally {
      // Clean up storage file after parsing
      if (storagePath) {
        try { await supabase.storage.from("documents").remove([storagePath]); } catch {}
      }
    }

    // Match repair to existing findings
    const suggestedMatches = matchRepairToFindings(parsed.system_category, existingFindings || []);
    const highConfidenceKeys = suggestedMatches.filter(m => m.confidence === "high").map(m => m.key);

    // Save repair document to DB
    let repairDocId = null;
    try {
      const { data: existingProp } = await supabase
        .from("properties")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existingProp?.id && userId) {
        const { data: repairDoc } = await supabase
          .from("repair_documents")
          .insert({
            property_id:          existingProp.id,
            user_id:              userId,
            filename:             filename || "repair-document.pdf",
            vendor_name:          parsed.vendor_name || null,
            service_date:         parsed.service_date || null,
            repair_summary:       parsed.repair_summary || null,
            system_category:      parsed.system_category || null,
            cost:                 parsed.cost || null,
            is_completed:         parsed.is_completed !== false, // default true
            warranty_period:      parsed.warranty_period || null,
            line_items:           parsed.line_items || [],
            resolved_finding_keys: highConfidenceKeys,
            raw_text_preview:     extractedText.slice(0, 1000),
          })
          .select("id")
          .single();

        if (repairDoc) repairDocId = repairDoc.id;

        // Auto-update finding statuses for high-confidence matches
        if (highConfidenceKeys.length > 0 && parsed.is_completed !== false) {
          const statusUpdate = {};
          for (const key of highConfidenceKeys) {
            statusUpdate[key] = "completed";
          }
          await supabase
            .from("properties")
            .update({
              finding_statuses: supabase.rpc ? undefined : statusUpdate, // handled below
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingProp.id);

          // Use jsonb merge for finding_statuses
          await supabase.rpc
            ? supabase.rpc("merge_finding_statuses", {
                property_id: existingProp.id,
                new_statuses: statusUpdate,
              }).catch(() => {
                // Fallback: raw update
                return supabase
                  .from("properties")
                  .update({ finding_statuses: statusUpdate })
                  .eq("id", existingProp.id);
              })
            : supabase
                .from("properties")
                .update({ finding_statuses: statusUpdate })
                .eq("id", existingProp.id);
        }
      }
    } catch (dbErr) {
      console.error("[parse-repair] DB error:", dbErr?.message);
    }

    return Response.json({
      success: true,
      repair_doc_id:      repairDocId,
      vendor_name:        parsed.vendor_name        || null,
      service_date:       parsed.service_date        || null,
      repair_summary:     parsed.repair_summary      || null,
      system_category:    parsed.system_category     || null,
      cost:               parsed.cost                || null,
      is_completed:       parsed.is_completed        !== false,
      warranty_period:    parsed.warranty_period     || null,
      line_items:         parsed.line_items          || [],
      notes:              parsed.notes               || null,
      // Matching results
      suggested_matches:  suggestedMatches,           // all matches for user review
      auto_resolved:      highConfidenceKeys,         // auto-resolved (high confidence)
    });

  } catch (err) {
    console.error("[parse-repair] Fatal:", err?.message);
    return Response.json({ success: false, error: "Server error — please try again." }, { status: 500 });
  }
}
