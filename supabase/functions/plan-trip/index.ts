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

Give a short, practical suggestion covering:
1. Suggested order and rough date ranges for each destination
2. Any timing concerns (too rushed, gaps between flights, etc.)
3. One or two extra places worth adding based on this route, if relevant

Keep it under 180 words. Be warm, specific, and practical. No markdown headers.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    const suggestion = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    return json({ suggestion: suggestion || "No suggestion returned." });
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
