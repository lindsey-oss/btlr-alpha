import OpenAI from "openai";

export async function POST(req) {

  const text = await req.text();

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured data from home inspection reports. Respond only with valid JSON."
      },
      {
        role: "user",
        content: `
Extract:

roof_year
hvac_year

Return JSON exactly like:

{
 "roof_year": number | null,
 "hvac_year": number | null
}

Inspection report:
${text.slice(0,8000)}
`
      }
    ]
  });   // ← THIS closing bracket was missing

  const message = completion.choices[0].message.content;

  try {
    return Response.json(JSON.parse(message));
  } catch {
    return Response.json({ roof_year: null, hvac_year: null });
  }

}