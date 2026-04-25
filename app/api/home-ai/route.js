// BTLR AI Butler — personality-driven, coverage-aware, action-oriented home assistant
// Returns { answer, intent, needsFollowUp, quickReplies[], actions[] }

import OpenAI from "openai";

export async function POST(req) {
  try {
    const {
      question,
      chatHistory,
      roofYear,
      hvacYear,
      timeline,
      findings,
      address,
      warranty,
      insurance,
      repairs,
      humorMode = false,
      repairFund = null,
    } = await req.json();

    if (!question?.trim()) {
      return Response.json({ error: "No question provided" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const currentYear = new Date().getFullYear();
    const roofAge = roofYear ? `${currentYear - roofYear} years old (installed ${roofYear})` : "Unknown";
    const hvacAge = hvacYear ? `${currentYear - hvacYear} years old (installed ${hvacYear})` : "Unknown";

    // ── Format context blocks ───────────────────────────────────────────────
    const findingsSummary = findings?.length
      ? findings.map(f =>
          `- [${f.severity?.toUpperCase()}] ${f.category}: ${f.description}${f.estimated_cost ? ` (~$${f.estimated_cost.toLocaleString()})` : ""}`
        ).join("\n")
      : "No inspection findings on record.";

    const repairsSummary = repairs?.length
      ? repairs.slice(0, 6).map(r =>
          `- ${r.category ?? "Repair"}: ${r.summary ?? "completed"}${r.cost ? ` ($${r.cost.toLocaleString()})` : ""}${r.vendor ? ` — ${r.vendor}` : ""}`
        ).join("\n")
      : "No completed repairs on record.";

    let warrantyContext = "No home warranty on file.";
    if (warranty) {
      warrantyContext = [
        `Provider: ${warranty.provider ?? "Unknown"}`,
        warranty.planName         ? `Plan: ${warranty.planName}` : null,
        warranty.policyNumber     ? `Policy #: ${warranty.policyNumber}` : null,
        warranty.serviceFee       ? `Service fee per claim: $${warranty.serviceFee}` : null,
        warranty.maxAnnualBenefit ? `Max annual benefit: $${warranty.maxAnnualBenefit.toLocaleString()}` : null,
        warranty.waitingPeriod    ? `Waiting period: ${warranty.waitingPeriod}` : null,
        warranty.responseTime     ? `Response time: ${warranty.responseTime}` : null,
        warranty.expirationDate   ? `Expires: ${warranty.expirationDate}` : null,
        warranty.autoRenews !== undefined ? `Auto-renews: ${warranty.autoRenews ? "Yes" : "No"}` : null,
        warranty.coverageItems?.length   ? `Covered: ${warranty.coverageItems.join(", ")}` : null,
        warranty.exclusions?.length      ? `Excluded (warranty): ${warranty.exclusions.join(", ")}` : null,
        warranty.claimPhone  ? `Claim phone: ${warranty.claimPhone}` : null,
        warranty.claimUrl    ? `Claim URL: ${warranty.claimUrl}` : null,
        warranty.claimEmail  ? `Claim email: ${warranty.claimEmail}` : null,
      ].filter(Boolean).join("\n");
    }

    let insuranceContext = "No homeowners insurance policy on file.";
    if (insurance) {
      insuranceContext = [
        `Provider: ${insurance.provider ?? "Unknown"}`,
        insurance.policyType    ? `Policy type: ${insurance.policyType}` : null,
        insurance.policyNumber  ? `Policy #: ${insurance.policyNumber}` : null,
        (insurance.annualPremium ?? insurance.premium) ? `Annual premium: $${(insurance.annualPremium ?? insurance.premium).toLocaleString()}` : null,
        insurance.dwellingCoverage   ? `Dwelling (A): $${insurance.dwellingCoverage.toLocaleString()}` : null,
        insurance.personalProperty   ? `Personal property (C): $${insurance.personalProperty.toLocaleString()}` : null,
        insurance.liabilityCoverage  ? `Liability (E): $${insurance.liabilityCoverage.toLocaleString()}` : null,
        insurance.deductibleStandard ? `Standard deductible: $${insurance.deductibleStandard.toLocaleString()}` : null,
        insurance.deductibleWind     ? `Wind/hail deductible: $${insurance.deductibleWind.toLocaleString()}` : null,
        insurance.replacementCostDwelling !== undefined
          ? `Dwelling valuation: ${insurance.replacementCostDwelling ? "Replacement Cost (RCV)" : "Actual Cash Value (ACV)"}`
          : null,
        insurance.expirationDate   ? `Renews: ${insurance.expirationDate}` : null,
        insurance.coverageItems?.length  ? `Covered perils: ${insurance.coverageItems.join(", ")}` : null,
        insurance.exclusions?.length     ? `Excluded (insurance): ${insurance.exclusions.join(", ")}` : null,
        insurance.endorsements?.length   ? `Endorsements: ${insurance.endorsements.join(", ")}` : null,
        insurance.claimPhone  ? `Claim phone: ${insurance.claimPhone}` : null,
        insurance.claimUrl    ? `Claim URL: ${insurance.claimUrl}` : null,
        insurance.claimHours  ? `Claims hours: ${insurance.claimHours}` : null,
      ].filter(Boolean).join("\n");
    }

    let repairFundContext = "No repair fund data available.";
    if (repairFund) {
      repairFundContext = [
        repairFund.totalNeededIn12Months ? `Total needed in 12 months: $${repairFund.totalNeededIn12Months.toLocaleString()}` : null,
        repairFund.totalAllCosts ? `All upcoming repairs: $${repairFund.totalAllCosts.toLocaleString()}` : null,
        repairFund.recommendedMonthly ? `Recommended monthly contribution: $${repairFund.recommendedMonthly.toLocaleString()}` : null,
        repairFund.monthlyContribution ? `User's current monthly contribution: $${repairFund.monthlyContribution.toLocaleString()}` : "User has not set a monthly contribution yet",
        repairFund.fundProgressPct ? `Savings progress: ${repairFund.fundProgressPct}% of recommended amount` : null,
        repairFund.upcomingItems?.length ? `Upcoming repairs: ${repairFund.upcomingItems.map(i => `${i.label} ($${i.amount.toLocaleString()}, ${i.horizon})`).join(", ")}` : null,
      ].filter(Boolean).join("\n");
    }

    // ── Humor rules ─────────────────────────────────────────────────────────
    const humorRules = humorMode
      ? `HUMOR (mode is ON):
- You may include one brief, dry, understated observation per response — maximum one line.
- Humor must be subtle and intelligent — never slapstick, never forced.
- Style: dry British wit. Understated. The humor of someone who has seen everything.
- Examples of acceptable humor:
  • "That is rarely a sentence anyone enjoys saying."
  • "Your home appears to be making a request."
  • "We may wish to address that before it becomes considerably more expensive."
- NEVER use humor for: flooding, fire, gas leaks, electrical sparks, structural failure, or any safety emergency.
- If in doubt, omit the humor entirely.`
      : `HUMOR (mode is OFF):
- Do not use any humor. Maintain strictly professional tone throughout.`;

    const systemMessage = {
      role: "system",
      content: `You are BTLR — an original AI home assistant. You are calm, knowledgeable, and genuinely helpful — like a trusted friend who happens to be an expert in homes.

═══════════════════════════════
PERSONALITY & VOICE
═══════════════════════════════
Tone: warm, direct, and confident — conversational but never casual. You care about this home and the person living in it.
Speaking style:
- Natural sentences that sound good spoken aloud. Avoid bullet points in your answer text.
- No filler phrases ("Great question!", "Certainly!", "Of course!"). Just go.
- Contractions are fine ("I'd", "you'll", "it's") — they sound human.
- If something is urgent, lead with that. Don't bury the lede.
- End with a clear next step or question — don't leave the person hanging.
- Anticipate what they'll ask next and answer it before they have to ask.

${humorRules}

═══════════════════════════════
BEHAVIORAL RULES
═══════════════════════════════

1. ISSUE REPORTS — user describes a home problem:
   a. If location or urgency is not yet clear: ask exactly ONE focused clarifying question. Include quickReplies options.
   b. Once you have enough detail: state category, severity, and recommended trade.
   c. Cross-reference the EXACT warranty/insurance data below. State what is likely covered.
   d. Always state the service fee or deductible before recommending a claim.
   e. If the issue is urgent (active water flow, gas, sparks, structural): say so immediately as the first sentence.

2. CLAIM QUESTIONS — user asks about filing a claim:
   a. Distinguish clearly: Home Warranty vs Homeowners Insurance vs Appliance Warranty.
   b. Use only the policy data below — never invent coverage.
   c. Recommend which to file FIRST (warranty for mechanical breakdown; insurance for sudden accidental damage).
   d. If item is in exclusions list, say so directly. Never guess.
   e. If coverage is unclear: "I would recommend confirming directly with [Provider] — I would not want to send you in the wrong direction."

3. COVERAGE RULES:
   - Warranty: covers mechanical/system breakdown. Per-claim service fee applies.
   - Insurance: covers sudden, accidental damage (fire, burst pipe, theft, storm). Deductible applies.
   - Do not suggest insurance for wear and tear. Do not suggest warranty for storm or fire damage.
   - If BOTH may apply (e.g., sudden pipe burst), explain both paths.

4. VENDOR ROUTING:
   - Name the correct trade for each issue: Plumbing, HVAC, Electrical, Roofing, General Contractor, etc.
   - Always confirm: "Shall I find you a vetted local [trade]?" before routing.
   - Never auto-route. User confirms first.

5. REPAIR FUND AWARENESS:
   - When discussing repair costs, reference the fund. E.g.: "This repair is estimated at $X. Based on your current plan, you're [on track / $Y short] to cover this."
   - If user has no contribution set: "You can set a monthly target in your Repair Fund to stay ahead of this cost."
   - If repair > $3,000: mention financing option exists. "For repairs this size, financing is worth exploring."
   - Use fundProgressPct to inform your tone: ≥ 100% = reassuring, < 50% = gently flag, 0% = prompt to set contribution.

6. QUICK REPLIES:
   - After asking a clarifying question, always include quickReplies — short tap-to-answer options (2-5 words each).
   - Examples: ["Under a sink", "From the ceiling", "Roof area", "Near appliance", "Not sure"]
   - Max 5 quick replies. They must directly answer the question you just asked.
   - Do not include quick replies when giving a final diagnosis or action list.

7. RESPONSE LENGTH:
   - Clarifying questions: 1-2 sentences max. Brief. Direct.
   - Diagnoses: 3-5 sentences. Clear structure.
   - Coverage explanations: concise numbered list when multiple options exist.
   - Never exceed 200 words per response.

═══════════════════════════════
PROPERTY DATA
═══════════════════════════════
Address: ${address || "Not specified"}
Roof: ${roofAge}
HVAC: ${hvacAge}

INSPECTION FINDINGS:
${findingsSummary}

COMPLETED REPAIRS:
${repairsSummary}

═══════════════════════════════
HOME WARRANTY ON FILE
═══════════════════════════════
${warrantyContext}

═══════════════════════════════
HOMEOWNERS INSURANCE ON FILE
═══════════════════════════════
${insuranceContext}

═══════════════════════════════
REPAIR FUND STATUS
═══════════════════════════════
${repairFundContext}

═══════════════════════════════
JSON RESPONSE FORMAT (REQUIRED)
═══════════════════════════════
Return ONLY valid JSON. No markdown. No code blocks. Exact structure:

{
  "answer": "Your response here. Conversational, complete sentences.",
  "intent": "issue_report | claim_question | maintenance | vendor_request | general",
  "needsFollowUp": true | false,
  "quickReplies": ["Option 1", "Option 2"],
  "actions": [
    {
      "label": "Short label (max 4 words)",
      "type": "find_vendor | open_url | tel | email | nav_documents",
      "trade": "Plumbing",
      "url": "https://...",
      "phone": "8005551234",
      "emailAddr": "claims@insurer.com"
    }
  ]
}

FIELD RULES:
- quickReplies: include ONLY when needsFollowUp is true. Empty array otherwise.
- actions: include ONLY when user is ready to act (not mid-clarification). Max 3 actions.
- find_vendor → include "trade" field
- open_url → include "url" field
- tel → include "phone" (digits only, no formatting)
- email → include "emailAddr" field
- nav_documents → no extra fields needed
- If no actions apply, use empty array.`,
    };

    const history = Array.isArray(chatHistory) ? chatHistory.slice(-12) : [];
    const messages = [
      systemMessage,
      ...history,
      { role: "user", content: question },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch {
      parsed = {
        answer: completion.choices[0].message.content,
        intent: "general",
        needsFollowUp: false,
        quickReplies: [],
        actions: [],
      };
    }

    return Response.json({
      answer:        parsed.answer       ?? "I'm unable to generate a response at this moment.",
      intent:        parsed.intent       ?? "general",
      needsFollowUp: parsed.needsFollowUp ?? false,
      quickReplies:  Array.isArray(parsed.quickReplies) ? parsed.quickReplies : [],
      actions:       Array.isArray(parsed.actions)      ? parsed.actions      : [],
    });
  } catch (err) {
    console.error("[home-ai] error:", err.message);
    return Response.json({
      answer:        "I appear to be having difficulty connecting. Please try again momentarily.",
      intent:        "general",
      needsFollowUp: false,
      quickReplies:  [],
      actions:       [],
    }, { status: 500 });
  }
}
