import OpenAI from "openai";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a licensed home inspector analyzing photos of a residential property.
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

export async function POST(req) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const body = await req.json();
    const { photoUrls } = body;

    if (!photoUrls?.length) {
      return Response.json({ success: false, error: "No photos provided" }, { status: 400 });
    }

    const urls = photoUrls.slice(0, 8); // cap at 8 photos per call

    // Build vision content — each photo as an image_url block
    const imageContent = urls.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "high" },
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: `Analyze ${urls.length} home photo${urls.length > 1 ? "s" : ""} for visible deficiencies and conditions. Return all findings in the specified JSON format.`,
            },
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

    console.log(`[analyze-photos] ${urls.length} photo(s) → ${findings.length} findings`);

    return Response.json({
      success:       true,
      findings,
      photo_summary: parsed.photo_summary || "",
      photo_count:   urls.length,
    });

  } catch (err) {
    console.error("[analyze-photos] Error:", err?.message);
    return Response.json({ success: false, error: "Photo analysis failed — please try again." }, { status: 500 });
  }
}
