/**
 * BTLR Regional Cost Estimates API
 * Patent Pending — Proprietary
 *
 * Fetches geographically-accurate home repair cost estimates for a given address.
 * Uses GPT-4o to generate structured regional ranges, stored in Supabase and
 * loaded into the scoring engine via registerCostOverrides() on property load.
 *
 * POST /api/cost-estimates
 * Body: { address: string, propertyId: number }
 *
 * Returns:
 * {
 *   ranges: Record<string, Record<string, CostRange>>,
 *   location: { city, state, zip },
 *   fetched_at: ISO string,
 *   source: "ai_regional"
 * }
 *
 * Caching:
 *   Results are stored in properties.regional_cost_ranges (jsonb).
 *   Stale threshold: 90 days. Client checks before calling this route.
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ─────────────────────────────────────────────────────────────────
// SYSTEMS TO FETCH (matches STATIC_COST_TABLE categories)
// ─────────────────────────────────────────────────────────────────
const SYSTEMS = [
  "structure_foundation",
  "roof_drainage_exterior",
  "electrical",
  "plumbing",
  "hvac",
  "appliances_water_heater",
  "interior_windows_doors",
  "safety_environmental",
  "site_grading_drainage",
];

const REPAIR_TYPES = ["maintenance", "minor_repair", "major_repair", "replacement"];

// ─────────────────────────────────────────────────────────────────
// SYSTEM LABELS (human-readable names for the AI prompt)
// ─────────────────────────────────────────────────────────────────
const SYSTEM_LABELS = {
  structure_foundation:    "Structure & Foundation",
  roof_drainage_exterior:  "Roof, Gutters & Exterior",
  electrical:              "Electrical",
  plumbing:                "Plumbing",
  hvac:                    "HVAC (Heating & Cooling)",
  appliances_water_heater: "Appliances & Water Heater",
  interior_windows_doors:  "Interior, Windows & Doors",
  safety_environmental:    "Safety & Environmental (mold, radon, pests)",
  site_grading_drainage:   "Site Grading & Drainage",
};

const REPAIR_TYPE_LABELS = {
  maintenance:  "routine maintenance / annual service",
  minor_repair: "minor repair (single component or small fix)",
  major_repair: "major repair (significant labor or multiple components)",
  replacement:  "full system or component replacement",
};

// ─────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────
function buildPrompt(city, state, zip) {
  const location = [city, state, zip].filter(Boolean).join(", ");

  const systemList = SYSTEMS.map(sys => {
    const label = SYSTEM_LABELS[sys];
    const types = REPAIR_TYPES.map(rt => `    - ${rt}: ${REPAIR_TYPE_LABELS[rt]}`).join("\n");
    return `  ${sys} (${label}):\n${types}`;
  }).join("\n\n");

  return `You are a home repair cost estimator with deep knowledge of regional labor and materials markets across the United States.

Provide current (2024–2025) home repair cost estimates for a residential property located in: ${location}

For each system and repair type below, return a cost range in USD (min and max) that reflects actual contractor costs in this specific market. Account for local labor rates, material costs, and regional demand. Do NOT use national averages — use regional pricing for ${location}.

Systems and repair types:
${systemList}

Return a JSON object with this exact structure:
{
  "location": {
    "city": "${city || ""}",
    "state": "${state || ""}",
    "zip": "${zip || ""}",
    "market_notes": "brief note about this market's cost level (e.g. high-cost metro, mid-range suburban, rural low-cost)"
  },
  "ranges": {
    "<system_key>": {
      "<repair_type>": {
        "estimated_cost_min": <number>,
        "estimated_cost_max": <number>,
        "cost_confidence": "<low|medium|high>",
        "label": "<human readable label>",
        "note": "<optional brief note about what this covers or cost drivers>"
      }
    }
  }
}

Rules:
- Always return a range (min and max), never a single number
- estimated_cost_min and estimated_cost_max must be integers (no decimals)
- cost_confidence: "high" if rates are well-established in this market, "medium" if moderate variance, "low" if highly variable
- Include all ${SYSTEMS.length} systems and all 4 repair types for each
- Do not include any explanation outside the JSON object`;
}

// ─────────────────────────────────────────────────────────────────
// ADDRESS PARSER — extracts city/state/zip from a freeform address
// ─────────────────────────────────────────────────────────────────
function parseAddress(address) {
  if (!address) return { city: null, state: null, zip: null };

  // ZIP code
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch?.[1] ?? null;

  // State abbreviation (2 uppercase letters, possibly before ZIP)
  const stateMatch = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?/);
  const state = stateMatch?.[1] ?? null;

  // City — text between last comma before state and the state itself
  // e.g. "123 Main St, Austin, TX 78701" → "Austin"
  const parts = address.split(",").map(s => s.trim());
  let city = null;
  if (parts.length >= 3) {
    // Third-to-last part or second-to-last before "STATE ZIP"
    const cityCandidate = parts[parts.length - 2];
    if (cityCandidate && !/\d{5}/.test(cityCandidate) && cityCandidate.length > 1) {
      city = cityCandidate.replace(/\s+[A-Z]{2}\s*$/, "").trim();
    }
  } else if (parts.length === 2) {
    // "City, ST ZIP"
    const last = parts[1].replace(/\d{5}.*/, "").replace(/[A-Z]{2}\s*$/, "").trim();
    if (last.length > 1) city = last;
  }

  return { city, state, zip };
}

// ─────────────────────────────────────────────────────────────────
// RESPONSE VALIDATOR
// Ensures the AI returned well-formed ranges for all systems
// ─────────────────────────────────────────────────────────────────
function validateRanges(ranges) {
  if (!ranges || typeof ranges !== "object") return false;
  for (const sys of SYSTEMS) {
    if (!ranges[sys]) return false;
    for (const rt of REPAIR_TYPES) {
      const r = ranges[sys][rt];
      if (!r) return false;
      if (typeof r.estimated_cost_min !== "number") return false;
      if (typeof r.estimated_cost_max !== "number") return false;
      if (r.estimated_cost_min >= r.estimated_cost_max) return false;
      if (!["low", "medium", "high"].includes(r.cost_confidence)) return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const body = await req.json();
    const { address, propertyId } = body;

    if (!address) {
      return Response.json({ error: "address is required" }, { status: 400 });
    }

    const { city, state, zip } = parseAddress(address);

    // Require at least city+state or ZIP to proceed
    if (!zip && (!city || !state)) {
      return Response.json(
        { error: "Could not extract location from address. Provide city and state or ZIP code." },
        { status: 422 }
      );
    }

    const prompt = buildPrompt(city, state, zip);

    // ── Call GPT-4o ───────────────────────────────────────────────
    let parsed;
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.1,  // slight warmth for regional variation, not full greedy
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert home repair cost estimator. Always respond with valid JSON only. Never add explanation outside the JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      parsed = JSON.parse(raw);
    } catch (aiErr) {
      console.error("[cost-estimates] OpenAI call failed:", aiErr.message);
      return Response.json({ error: "AI cost lookup failed", detail: aiErr.message }, { status: 502 });
    }

    const { ranges, location: aiLocation } = parsed;

    // ── Validate ──────────────────────────────────────────────────
    if (!validateRanges(ranges)) {
      console.error("[cost-estimates] AI returned invalid ranges structure:", JSON.stringify(ranges).slice(0, 200));
      return Response.json({ error: "AI returned incomplete cost data — try again" }, { status: 500 });
    }

    const fetchedAt = new Date().toISOString();
    const result = {
      ranges,
      location: {
        city:         aiLocation?.city   ?? city,
        state:        aiLocation?.state  ?? state,
        zip:          aiLocation?.zip    ?? zip,
        market_notes: aiLocation?.market_notes ?? null,
      },
      fetched_at: fetchedAt,
      source: "ai_regional",
    };

    // ── Persist to DB ─────────────────────────────────────────────
    // Store on the property row so future loads skip this API call
    // for 90 days. Non-fatal if this fails — ranges still returned to client.
    if (propertyId) {
      const { error: dbErr } = await supabaseAdmin
        .from("properties")
        .update({
          regional_cost_ranges:      result,
          regional_cost_ranges_at:   fetchedAt,
        })
        .eq("id", propertyId);

      if (dbErr) {
        console.warn("[cost-estimates] DB persist failed (non-fatal):", dbErr.message);
      } else {
        console.log(`[cost-estimates] ✓ Saved regional ranges for property ${propertyId} (${city}, ${state})`);
      }
    }

    return Response.json(result);

  } catch (err) {
    console.error("[cost-estimates] Unhandled error:", err.message);
    return Response.json({ error: "Internal error", detail: err.message }, { status: 500 });
  }
}
