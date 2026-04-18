import OpenAI from "openai";

export async function POST(req) {
  try {
    const { question, chatHistory, roofYear, hvacYear, timeline, findings, address } = await req.json();

    if (!question?.trim()) {
      return Response.json({ error: "No question provided" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const currentYear = new Date().getFullYear();
    const roofAge = roofYear ? `${currentYear - roofYear} years old (installed ${roofYear})` : "Unknown";
    const hvacAge = hvacYear ? `${currentYear - hvacYear} years old (installed ${hvacYear})` : "Unknown";

    const findingsSummary = findings?.length
      ? findings.map((f) => `- [${f.severity?.toUpperCase()}] ${f.category}: ${f.description}${f.estimated_cost ? ` (~$${f.estimated_cost.toLocaleString()})` : ""}`).join("\n")
      : "No inspection findings on record.";

    const timelineSummary = timeline?.length
      ? timeline.slice(0, 8).map((t) => `- ${t.date}: ${t.event}`).join("\n")
      : "No timeline events recorded.";

    const systemMessage = {
      role: "system",
      content: `You are BTLR, an expert AI home assistant built specifically for real estate investors and homeowners. You help users understand home systems, plan maintenance, estimate costs, and prioritize repairs. Be concise, practical, and specific. When relevant, reference the homeowner's actual property data provided. Use dollar amounts and timelines when helpful. Format responses clearly but conversationally — no unnecessary filler.

PROPERTY CONTEXT:
- Address: ${address || "Not specified"}
- Roof: ${roofAge}
- HVAC: ${hvacAge}

INSPECTION FINDINGS:
${findingsSummary}

RECENT TIMELINE:
${timelineSummary}`,
    };

    // Build full message thread: system + conversation history + new question
    const history = Array.isArray(chatHistory) ? chatHistory.slice(-10) : []; // cap at 10 prior messages
    const messages = [
      systemMessage,
      ...history,
      { role: "user", content: question },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 600,
    });

    return Response.json({ answer: completion.choices[0].message.content });
  } catch (err) {
    console.error("home-ai error:", err);
    return Response.json({
      error: err.message,
      answer: "I'm having trouble connecting right now. Please try again in a moment.",
    }, { status: 500 });
  }
}
