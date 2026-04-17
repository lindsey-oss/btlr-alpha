import OpenAI from "openai";

const CATEGORY_MAP = {
  roofing:       { label: "Roofing",          emoji: "🏠", trades: ["roofer", "roofing contractor"] },
  plumbing:      { label: "Plumbing",          emoji: "🔧", trades: ["plumber", "plumbing contractor"] },
  electrical:    { label: "Electrical",        emoji: "⚡", trades: ["electrician", "electrical contractor"] },
  hvac:          { label: "HVAC",              emoji: "❄️",  trades: ["HVAC contractor", "heating and cooling"] },
  pest:          { label: "Pest Control",      emoji: "🐜", trades: ["pest control", "exterminator", "termite control"] },
  foundation:    { label: "Foundation",        emoji: "🏗️",  trades: ["foundation contractor", "structural engineer"] },
  mold:          { label: "Mold Remediation",  emoji: "🧫", trades: ["mold remediation", "water damage restoration"] },
  painting:      { label: "Painting",          emoji: "🎨", trades: ["house painter", "painting contractor"] },
  landscaping:   { label: "Landscaping",       emoji: "🌿", trades: ["landscaper", "lawn service"] },
  general:       { label: "General Contractor",emoji: "🔨", trades: ["general contractor", "handyman"] },
  windows:       { label: "Windows & Doors",   emoji: "🪟", trades: ["window contractor", "door installation"] },
  insulation:    { label: "Insulation",        emoji: "🧱", trades: ["insulation contractor"] },
  waterproofing: { label: "Waterproofing",     emoji: "💧", trades: ["waterproofing contractor"] },
  flooring:      { label: "Flooring",          emoji: "🪵", trades: ["flooring contractor", "tile installer"] },
};

export async function POST(req) {
  try {
    const { issue } = await req.json();
    if (!issue?.trim()) return Response.json({ error: "No issue provided" }, { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a home repair expert who classifies home issues and routes homeowners to the right contractor.

Given a home issue description, return JSON with:
{
  "category": one of: roofing | plumbing | electrical | hvac | pest | foundation | mold | painting | landscaping | general | windows | insulation | waterproofing | flooring,
  "urgency": "emergency" | "urgent" | "normal" | "low",
  "urgency_reason": "brief reason for urgency level",
  "issue_summary": "1-sentence clear description of the problem",
  "what_to_tell_contractor": "2-3 sentences the homeowner should say when calling a contractor",
  "diy_tips": ["up to 2 safe things the homeowner can do right now while waiting"],
  "avg_cost_low": estimated low cost in dollars (number),
  "avg_cost_high": estimated high cost in dollars (number),
  "questions_to_ask": ["3 smart questions to ask when getting quotes"]
}`,
        },
        { role: "user", content: `Home issue: ${issue}` },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const cat = CATEGORY_MAP[parsed.category] ?? CATEGORY_MAP.general;

    return Response.json({
      ...parsed,
      category_label: cat.label,
      category_emoji: cat.emoji,
      search_terms: cat.trades,
    });
  } catch (err) {
    console.error("classify-issue error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
