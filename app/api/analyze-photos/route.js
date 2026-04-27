import OpenAI from "openai";

export const maxDuration = 60;

// ── Generic inspection prompt (used when no focus area is given) ──────────────
const GENERIC_SYSTEM_PROMPT = `You are a licensed home inspector analyzing photos of a residential property.
Identify ALL visible deficiencies, damage, maintenance issues, or notable conditions.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "string — use one of: Roof, HVAC, Plumbing, Electrical, Foundation, Structural, Windows, Doors, Exterior, Siding, Deck, Driveway, Interior, Flooring, Ceiling, Mold, Pest, General",
      "description": "string — specific visible condition with location detail (e.g. 'Moss/algae growth on north-facing shingles near chimney', 'Rust staining on electrical panel door', 'Crack in foundation wall approx 3/8 inch wide')",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — 1-2 sentence overall description of what was visible across all photos"
}

Severity rules:
- "critical" = immediate safety or structural hazard (e.g. exposed wiring, large foundation crack, active roof leak, mold)
- "warning" = needs repair within 6 months (e.g. deteriorating caulk, aging shingles, minor damage)
- "info" = maintenance note, minor issue to monitor, or confirmation of good condition

Rules:
- Only report what is VISUALLY EVIDENT — do not speculate beyond what you can see
- Be specific about location and visible symptoms
- If a system appears in clearly good condition, note it as "info" severity
- estimated_cost: realistic repair cost based on visible damage, or null if unclear
- Max 5 findings per photo, most important first
- If multiple photos show the same issue, report it once`;

// ── System-specific prompts keyed by self-inspection question ID ──────────────
const FOCUSED_PROMPTS = {

  roof_condition: `You are a certified roofing inspector analyzing a photo of residential roof shingles.
Perform a detailed visual condition assessment. Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "Roof",
      "description": "string — be specific: shingle type if identifiable, areas of concern with compass direction if visible, size of affected area",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — overall roof condition summary"
}

Evaluate in this order:
1. SHINGLE CONDITION: Look for curling (cupping = edges curve up; clawing = middle rises), cracking, brittle/dry shingles
2. GRANULE LOSS: Bare patches on shingles, granule accumulation in gutters visible, exposed mat (dark streaks)
3. MISSING/DAMAGED: Count missing shingles if possible; displaced, cracked, or broken pieces
4. MOSS/ALGAE/STAINING: Dark streaking (algae), green growth (moss), lichen
5. SAGGING: Any dips, waves, or uneven planes in the roof deck
6. FLASHING: Around chimney, vents, valleys — lifted, corroded, missing
7. GUTTERS: Sagging, detached, full of debris, rust, poor pitch
8. OVERALL AGE ESTIMATE: Based on shingle appearance, estimate remaining useful life

Severity rules:
- "critical" = active leak evidence, large missing sections, severe structural sagging, or <2 years estimated life
- "warning" = significant granule loss, multiple missing/damaged shingles, moss coverage, 2–5 year horizon
- "info" = minor wear consistent with age, good condition, or maintenance items`,

  roof_leaks: `You are a certified home inspector analyzing a photo for evidence of water intrusion or moisture damage.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "Roof",
      "description": "string — describe stain shape, color, size, and most likely source",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — moisture damage summary"
}

Look specifically for:
1. WATER STAINS: Ring patterns on ceilings/walls (brown/yellow circles = historic leak), active wet spots
2. MOLD/MILDEW: Black, green, or white fuzzy growth — note size and spread
3. EFFLORESCENCE: White chalky mineral deposits on masonry (indicates water migration)
4. WOOD ROT: Darkened, soft, or crumbling wood at roof deck, rafters, or wall plates
5. RUST STAINS: From metal fasteners/flashing indicating prolonged moisture
6. ATTIC CONDENSATION: Frost or moisture on roof deck, insulation clumping or darkening

Severity: "critical" if active moisture/mold present; "warning" if historic staining with no visible source repair; "info" if old staining that appears dry/addressed`,

  struct_cracks: `You are a licensed structural engineer and home inspector analyzing photos of cracks in foundations or walls.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "Foundation",
      "description": "string — crack type, orientation, estimated width, location, displacement if any",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — structural condition summary"
}

Assess by crack pattern:
1. STAIR-STEP CRACKS: In mortar joints following block/brick courses — typically settlement; width matters
2. HORIZONTAL CRACKS: In basement/foundation walls — most serious, indicates lateral soil pressure
3. VERTICAL CRACKS: Often shrinkage (hairline = normal); wide/displaced = structural concern
4. DIAGONAL CRACKS: From corners of windows/doors — differential settlement indicator
5. WIDTH ASSESSMENT: Hairline (<1/16"), minor (1/16"–1/4"), significant (>1/4")
6. DISPLACEMENT: Is one side of the crack higher than the other? (stepped displacement = active movement)
7. STAINING: Efflorescence or water tracks through cracks = active water infiltration

Severity rules:
- "critical" = horizontal cracks, cracks >1/4" wide, displaced/stepped cracks, active water intrusion
- "warning" = stair-step cracks >1/8", diagonal cracks from openings, evidence of past patching
- "info" = hairline shrinkage cracks, previously repaired stable cracks`,

  elec_breakers: `You are a licensed master electrician and home inspector analyzing a photo of a residential electrical panel.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "Electrical",
      "description": "string — specific deficiency with location in panel (top/bottom, left/right bus, breaker position)",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — panel summary including brand, approximate age/capacity if visible, and overall condition"
}

Inspect systematically:
1. PANEL BRAND/MODEL: Read the label — note if it's a recalled brand (Federal Pacific/Stab-Lok, Zinsco/Sylvania, Pushmatic, Bryant — these are known fire hazards)
2. DOUBLE-TAPPING: Multiple wires connected to a single breaker terminal (only certain breakers are listed for this)
3. BREAKER CONDITION: Tripped breakers in mid-position, burned/scorched breakers, breakers that look melted
4. WIRING: Aluminum wiring on 15/20A circuits (silver-colored wires = hazard), improper wire gauges, open knockouts with exposed wiring
5. OVERCURRENT: Oversized breakers for wire gauge (e.g., 20A breaker on 14-gauge wire)
6. LABELING: Unlabeled circuits are a code deficiency; mismatched labels
7. RUST/CORROSION: On panel interior, bus bars, or breaker faces
8. CAPACITY: Total amperage service (100A, 150A, 200A) — note if at or near capacity
9. GROUNDING/BONDING: Visible ground wires, neutral/ground bus condition

Severity rules:
- "critical" = recalled panel brand, double-tapping on non-listed breakers, scorching/burn marks, aluminum wiring, open knockouts
- "warning" = unlabeled circuits, rust, overcrowding, near capacity
- "info" = good condition, well-labeled, properly maintained`,

  plumb_water_heater: `You are a licensed plumber and home inspector analyzing a photo of a water heater.
The PRIMARY goal is to determine the MANUFACTURE DATE and overall condition.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "Plumbing",
      "description": "string — lead with manufacture date if visible, then condition issues",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — must include: brand, estimated manufacture year if determinable, capacity (gallons), and overall condition",
  "manufacture_year": number | null
}

PRIORITY 1 — DECODE MANUFACTURE DATE from serial number:
Most brands encode the date in the serial number. Common patterns:
- Rheem/Ruud: First 4 chars = YYMM (e.g., 0312 = March 2003) or letter+2digits (F04 = June 2004, A=Jan)
- AO Smith/State/American/Whirlpool: 2nd & 3rd digit = year (e.g., 0312xxxxx = 2003), or letter codes
- Bradford White: Letter = decade (F=2000s, G=2010s, H=2020s) + 2nd letter = month (A=Jan), 3rd+4th = year
- Kenmore: Digits 3-4 = year
- Giant/Reliance: First 2 digits = year
If you can read the serial number, attempt to decode the year. State it explicitly.

PRIORITY 2 — CONDITION:
1. BASE RUST/CORROSION: Rust at the bottom of tank, floor staining, mineral deposits = failure imminent
2. ANODE ROD ACCESS: Visible on top — note if accessible
3. PRESSURE RELIEF VALVE: T&P valve present and pipe directed to floor/drain
4. CONNECTIONS: Copper, dielectric unions present (prevents galvanic corrosion)
5. FLUE/VENTING: For gas units — single or double-wall, proper clearances, rust
6. SEDIMENT BUILDUP: Rumbling/popping sounds noted, calcification visible
7. INSULATION/JACKET: Condition of tank exterior coating

Typical lifespan: 8-12 years (tank), 20+ years (tankless)

Severity rules:
- "critical" = active rust/corrosion on tank base, missing T&P valve, improper venting
- "warning" = age 10+ years, minor rust, sediment buildup signs
- "info" = good condition, recent unit, no visible issues`,

  hvac_age: `You are a certified HVAC technician and home inspector analyzing a photo of an HVAC system (furnace, air handler, heat pump, or AC unit).
The PRIMARY goal is to determine the MANUFACTURE DATE and overall condition.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "HVAC",
      "description": "string — lead with manufacture date and equipment details, then condition issues",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — must include: brand/model, manufacture year if determinable, equipment type, and overall condition",
  "manufacture_year": number | null
}

PRIORITY 1 — DECODE MANUFACTURE DATE from serial/model number on data plate:
Common patterns:
- Carrier/Bryant/Payne: 2nd–5th digits of serial = year+week (e.g., 4806 = week 48 of 2006)
- Trane/American Standard: 5th digit = decade (9=1990s, 0=2000s), next 2 = year+week
- Lennox: 1st 4 chars of serial = year+week (e.g., 5206 = week 52 of 2006) or 4th-5th char = year
- Goodman/Amana/Daikin: 2nd + 3rd digits of serial = year (e.g., xx09xxxxxx = 2009)
- York/Coleman/Johnson: 3rd+4th digits = year (e.g., xxxx10xxxxxx = 2010)
- Rheem/Ruud: 1st 4 digits = year+week
- Heil/Tempstar/Comfortmaker: 4th+5th digits = year
If you can read the serial/model number on the data plate, attempt to decode the manufacture year.

PRIORITY 2 — CONDITION:
1. HEAT EXCHANGER (furnaces): Rust, cracks, or soot residue = CO leak risk — CRITICAL
2. BURNER ASSEMBLY: Flame pattern visible? Rust, soot, or debris?
3. FILTER CONDITION: Dirty/clogged filter is visible
4. REFRIGERANT LINES: Ice buildup, improper insulation (suction line only should be insulated)
5. DRAIN PAN/COIL: Rust, standing water, algae in condensate pan
6. WIRING: Burned, frayed, or improperly spliced wires
7. CABINET: Physical damage, rust on casing, missing panels
8. FLUE/VENTING: Proper pitch, no rust holes, secured connections

Typical lifespan: Furnace 15-20yr, AC/heat pump 10-15yr, air handler 15-20yr

Severity rules:
- "critical" = cracked heat exchanger signs, CO risk, refrigerant leak signs, fire hazard wiring
- "warning" = age 12+ years, dirty components, minor rust, filter replacement needed
- "info" = good condition, well-maintained, recent unit`,

  safety_hazards: `You are a certified industrial hygienist and home inspector analyzing a photo for safety hazards in a residential property.
Return ONLY valid JSON — no markdown, no extra text.

{
  "findings": [
    {
      "category": "string — use: Mold, Pest, Electrical, Structural, General, Plumbing",
      "description": "string — describe hazard type, approximate extent/area, and urgency",
      "severity": "critical" | "warning" | "info",
      "estimated_cost": number | null
    }
  ],
  "photo_summary": "string — safety condition summary"
}

Inspect for:
1. MOLD/MILDEW: Color (black/green/white), growth pattern, surface type (drywall vs tile vs wood), estimated square footage
   - Black mold (Stachybotrys) = critical; surface mildew on grout = info
2. WATER DAMAGE: Active leaks, saturated materials, efflorescence, rust staining
3. PEST EVIDENCE: Droppings, gnaw marks, mud tubes (termites), frass (carpenter ants/beetles), nesting material
4. HAZARDOUS MATERIALS INDICATORS: Popcorn ceiling (pre-1980 = potential asbestos), pipe wrap insulation, old floor tiles
5. IMPROPER CHEMICAL STORAGE: Flammables near ignition sources, unlabeled containers
6. TRIP/FALL HAZARDS: Damaged flooring, poor stair conditions, inadequate lighting
7. COMBUSTION SAFETY: Gas appliances near flammables, improper venting, yellow/irregular pilot flames
8. CARBON MONOXIDE RISKS: Evidence of backdrafting, blocked flues, improper combustion

Severity rules:
- "critical" = active mold >10 sq ft, visible pest infestation, CO/fire hazard, structural hazard
- "warning" = small mold patches, pest evidence (not active), water damage without source repair
- "info" = minor maintenance items, potential-only hazards, items to monitor`,
};

export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const body = await req.json();
    const { photoUrls, focusArea } = body;

    if (!photoUrls?.length) {
      return Response.json({ success: false, error: "No photos provided" }, { status: 400 });
    }

    const urls = photoUrls.slice(0, 8); // cap at 8 photos per call

    // Pick system prompt — focused if we know what system is being photographed
    const systemPrompt = (focusArea && FOCUSED_PROMPTS[focusArea])
      ? FOCUSED_PROMPTS[focusArea]
      : GENERIC_SYSTEM_PROMPT;

    // Build vision content — each photo as an image_url block
    const imageContent = urls.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "high" },
    }));

    // User message — more specific when focus area is known
    const userText = focusArea
      ? `Analyze this photo of ${getFocusLabel(focusArea)}. ${getFocusInstruction(focusArea)} Return all findings in the specified JSON format.`
      : `Analyze ${urls.length} home photo${urls.length > 1 ? "s" : ""} for visible deficiencies and conditions. Return all findings in the specified JSON format.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text", text: userText },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[analyze-photos] JSON parse failed:", raw.slice(0, 200));
      return Response.json({ success: false, error: "AI returned unexpected format — please try again." });
    }

    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];

    // Normalize and tag with source: "photo"
    const findings = rawFindings
      .filter(f => f.description)
      .map(f => ({
        category:       f.category || "General",
        description:    f.description,
        severity:       ["critical", "warning", "info"].includes(f.severity) ? f.severity : "info",
        estimated_cost: typeof f.estimated_cost === "number" ? f.estimated_cost : null,
        source:         "photo",
      }));

    console.log(`[analyze-photos] focus=${focusArea ?? "generic"} | ${urls.length} photo(s) → ${findings.length} findings`);

    return Response.json({
      success:          true,
      findings,
      photo_summary:    parsed.photo_summary || "",
      manufacture_year: parsed.manufacture_year ?? null,
      photo_count:      urls.length,
    });

  } catch (err) {
    console.error("[analyze-photos] Error:", err?.message);
    return Response.json({ success: false, error: "Photo analysis failed — please try again." }, { status: 500 });
  }
}

function getFocusLabel(focusArea) {
  const labels = {
    roof_condition:      "roof shingles",
    roof_leaks:          "water staining or moisture damage",
    struct_cracks:       "foundation or structural cracks",
    elec_breakers:       "the electrical panel",
    plumb_water_heater:  "the water heater and its data label",
    hvac_age:            "the HVAC system data plate",
    safety_hazards:      "a potential safety hazard area",
  };
  return labels[focusArea] || "a home system";
}

function getFocusInstruction(focusArea) {
  const instructions = {
    plumb_water_heater: "Read the serial number on the data plate and decode the manufacture year. State the brand, year, and capacity clearly in photo_summary.",
    hvac_age:           "Read the serial/model number on the data plate and decode the manufacture year. State the brand, year, and equipment type clearly in photo_summary.",
    elec_breakers:      "Identify the panel brand first — check if it is a recalled brand. Then inspect for double-tapping, scorching, and other deficiencies.",
    struct_cracks:      "Classify each crack by type (horizontal/vertical/stair-step/diagonal), estimate width, and note any displacement.",
    roof_condition:     "Walk through the full condition checklist: shingle integrity, granule loss, moss/algae, flashing, gutters.",
  };
  return instructions[focusArea] || "Be thorough and specific.";
}
