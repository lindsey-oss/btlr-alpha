import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { extractPdfTextAsync } from "../../../lib/extractPdfText";

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
    const { signedUrl, filename, storagePath, existingFindings, propertyId } = body;

    if (!signedUrl) {
      return Response.json({ success: false, error: "No document URL provided" }, { status: 400 });
    }

    let parsed = {};
    let extractedText = "";
    let parseWarning = null;  // non-fatal note (e.g. image file, short text)

    try {
      // Download and extract text from PDF
      const pdfRes = await fetch(signedUrl);
      if (!pdfRes.ok) throw new Error(`Download failed: ${pdfRes.status}`);

      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      extractedText = await extractPdfTextAsync(pdfBuffer);

      console.log(`[parse-repair] Extraction: ${extractedText.length} chars`);

      if (extractedText.length < 30) {
        // Image files (JPG, PNG) or scanned PDFs return near-zero text.
        // Don't return early — still create the repair_documents row so the
        // receipt appears in Repair History. Just skip the AI parse step.
        parseWarning = "Receipt saved. Text extraction not available for image files — details were not auto-filled.";
        console.log("[parse-repair] Short/empty text — saving receipt without AI parse");
      } else {
        // Send to AI (cap at 20k chars — repair docs are usually short)
        const textToSend = extractedText.slice(0, 20000);

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
          parseWarning = "Receipt saved. AI parsing returned an unexpected format.";
        }
      }

    } catch (parseErr) {
      console.error("[parse-repair] Processing error:", parseErr?.message);
      // Don't return — fall through so the repair_documents row is still created.
      parseWarning = parseErr?.message || "Processing error — receipt saved but details not extracted.";
    }

    // Match repair to existing findings
    const suggestedMatches = matchRepairToFindings(parsed.system_category, existingFindings || []);
    const isCompleted = parsed.is_completed !== false;

    // Auto-resolve high-confidence matches always.
    // Also auto-resolve medium-confidence matches when the repair is confirmed complete
    // (invoice/receipt) — this ensures the score reflects the real repair.
    // Medium confidence = partial key match (e.g. "HVAC" repair → "HVAC Cooling" finding).
    const autoResolvedKeys = suggestedMatches
      .filter(m => m.confidence === "high" || (m.confidence === "medium" && isCompleted))
      .map(m => m.key);

    // Save repair document to DB
    let repairDocId = null;
    try {
      // Use the propertyId passed from the client (active property).
      // Fall back to querying the first property only if none was provided.
      let resolvedPropertyId = propertyId ? Number(propertyId) : null;
      if (!resolvedPropertyId) {
        const { data: existingProp } = await supabase
          .from("properties")
          .select("id")
          .limit(1)
          .maybeSingle();
        resolvedPropertyId = existingProp?.id ?? null;
      }

      if (resolvedPropertyId && userId) {
        const { data: repairDoc } = await supabase
          .from("repair_documents")
          .insert({
            property_id:           resolvedPropertyId,
            user_id:               userId,
            filename:              filename || "repair-document.pdf",
            vendor_name:           parsed.vendor_name || null,
            service_date:          parsed.service_date || null,
            repair_summary:        parsed.repair_summary || (parseWarning ? "Receipt uploaded — details not extracted" : null),
            system_category:       parsed.system_category || null,
            cost:                  parsed.cost || null,
            is_completed:          isCompleted,
            warranty_period:       parsed.warranty_period || null,
            line_items:            parsed.line_items || [],
            resolved_finding_keys: autoResolvedKeys,
            raw_text_preview:      extractedText.slice(0, 1000),
          })
          .select("id")
          .single();

        if (repairDoc) repairDocId = repairDoc.id;

        // Persist resolved finding statuses server-side — proper read-merge-write.
        // The old approach tried supabase.rpc("merge_finding_statuses") which is a
        // non-existent function; this caused it to silently overwrite (not merge)
        // existing statuses. Now we read → merge → write to preserve prior repairs.
        if (autoResolvedKeys.length > 0 && isCompleted) {
          const { data: propData } = await supabase
            .from("properties")
            .select("finding_statuses")
            .eq("id", resolvedPropertyId)
            .maybeSingle();

          const current = (propData?.finding_statuses && typeof propData.finding_statuses === "object")
            ? propData.finding_statuses
            : {};
          const merged = { ...current };
          for (const key of autoResolvedKeys) {
            merged[key] = "completed";
          }

          await supabase
            .from("properties")
            .update({ finding_statuses: merged, updated_at: new Date().toISOString() })
            .eq("id", resolvedPropertyId);
        }
      }
    } catch (dbErr) {
      console.error("[parse-repair] DB error:", dbErr?.message);
    }

    return Response.json({
      success:            true,
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
      parse_warning:      parseWarning,              // non-null when text extraction was skipped (image files)
      // Matching results
      suggested_matches:  suggestedMatches,   // all matches for user review
      auto_resolved:      autoResolvedKeys,   // auto-resolved (high confidence always; medium when completed)
    });

  } catch (err) {
    console.error("[parse-repair] Fatal:", err?.message);
    return Response.json({ success: false, error: "Server error — please try again." }, { status: 500 });
  }
}
