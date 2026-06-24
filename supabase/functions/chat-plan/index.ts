// supabase/functions/chat-plan/index.ts
// Deploy: supabase functions deploy chat-plan

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { messages, tripContext, preferences, mode, category } = await req.json();
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const isTodo = mode === "todo";

    const systemPrompt = isTodo
      ? buildTodoSystemPrompt(tripContext, preferences, category)
      : buildChatSystemPrompt(tripContext, preferences);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system: systemPrompt,
        messages: messages || [{ role: "user", content: "Help me plan my trip." }],
      }),
    });

    const data = await r.json();
    const raw = (data.content || []).map((b: any) => b.text).join("").trim();

    let reply = raw, suggestions: any[] = [], todos: any[] = [];
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        reply = parsed.reply || raw;
        suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
        todos = Array.isArray(parsed.todos) ? parsed.todos : [];
      }
    } catch (_) {}

    return json({ reply, suggestions, todos });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function buildChatSystemPrompt(ctx: any, prefs: any) {
  const destList = (ctx?.countries || []).map((c: any) =>
    `${c.name}${c.planned_days ? ` (${c.planned_days} days)` : ""}`).join(", ");
  const prefText = prefs ? [
    prefs.likes?.length   ? `Loves: ${prefs.likes.join(", ")}` : "",
    prefs.dislikes?.length ? `Avoids: ${prefs.dislikes.join(", ")}` : "",
    prefs.notes ? `Notes: ${prefs.notes}` : "",
  ].filter(Boolean).join(". ") : "";

  return `You are a friendly travel planning assistant for a family trip.
Current destinations: ${destList || "none yet"}.
${prefText ? `Travel style: ${prefText}` : ""}

When suggesting specific places, return JSON:
{
  "reply": "your conversational response (2-4 sentences)",
  "suggestions": [
    {"name": "Place Name", "type": "place|hotel|activity|restaurant", "description": "one sentence", "country": "Country"}
  ]
}
Keep suggestions to 2-3 max. If no specific suggestions, use "suggestions": [].
Return ONLY valid JSON.`;
}

function buildTodoSystemPrompt(ctx: any, prefs: any, category?: string) {
  const destList = (ctx?.countries || []).map((c: any) => c.name).join(", ");
  const prefText = prefs?.notes || "";
  const categoryLabel = category || "Todos";

  const alreadySeen = (ctx?.existingTodos || []).slice(0, 30).join(", ");
  return `You are helping a family prepare for a trip to: ${destList || "various destinations"}.
${prefText ? `Family notes: ${prefText}` : ""}
${alreadySeen ? `Already suggested or added (do NOT repeat these): ${alreadySeen}` : ""}

Suggest 4-6 NEW practical items for the "${categoryLabel}" checklist for this trip, not already in the list above. Return JSON:
{
  "reply": "brief intro sentence",
  "todos": [
    {"title": "What to do", "deadline": "YYYY-MM-DD or null", "reason": "one short reason"}
  ]
}
Deadlines should be realistic (2-8 weeks before departure) — use null where a deadline doesn't make sense (e.g. shopping list items). Return ONLY valid JSON.`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });
}
