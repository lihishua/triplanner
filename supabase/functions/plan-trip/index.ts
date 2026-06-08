// supabase/functions/plan-trip/index.ts
// Deploy: supabase functions deploy plan-trip

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { places, flights, preferences } = await req.json();
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const placesText = places.length
      ? places.map((p: any) =>
          `- ${p.name}${p.country ? `, ${p.country}` : ""}${p.planned_days ? `: ${p.planned_days} days` : " (duration not set)"}`
        ).join("\n")
      : "No places added yet.";

    const flightsText = flights.length
      ? flights.map((f: any) =>
          `- ${f.from} → ${f.to}${f.date ? ` on ${f.date}` : ""}${f.airline ? ` (${f.airline})` : ""}${f.price ? `, ${f.price}/person` : ""}`
        ).join("\n")
      : "No flights added yet.";

    const prefText = preferences ? [
      preferences.likes?.length   ? `They love: ${preferences.likes.join(', ')}.`   : '',
      preferences.dislikes?.length ? `They prefer to avoid: ${preferences.dislikes.join(', ')}.` : '',
      preferences.notes ? `Notes: ${preferences.notes}.` : '',
    ].filter(Boolean).join(' ') : '';

    const prompt = `You are helping plan a family trip. Here is what's planned so far:

Destinations:
${placesText}

Flights:
${flightsText}
${prefText ? `\nTravel style: ${prefText}` : ''}

Give practical advice. Return a JSON object with exactly two fields:

"suggestion": A narrative (under 200 words, markdown ok) covering: suggested order + date ranges, timing concerns, flight gaps to book.

"actionable": Array of specific countries/destinations worth adding to this trip (max 3). Each item:
  { "name": "Philippines", "days": 12, "reason": "one short sentence why it fits" }
  Only include places NOT already in the destinations list above. Empty array if nothing to add.

Return only valid JSON, no other text.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    const raw = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("").trim();

    let suggestion = raw, actionable: any[] = [];
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        suggestion = parsed.suggestion || raw;
        actionable = Array.isArray(parsed.actionable) ? parsed.actionable : [];
      }
    } catch (_) {}

    return json({ suggestion, actionable });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
