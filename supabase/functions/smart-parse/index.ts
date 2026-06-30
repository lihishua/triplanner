// supabase/functions/smart-parse/index.ts
// Deploy: supabase functions deploy smart-parse

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { text, imageBase64, tripContext } = await req.json();
    if (!text && !imageBase64) return json({ error: "Provide text or image" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    const countries: string[] = tripContext?.countries || [];
    const prepTabs: { id: string; name: string }[] = tripContext?.prepTabs || [
      { id: "todos", name: "Todos" },
    ];

    const systemPrompt = `You are a travel app assistant. Parse the user's input and classify it.
Today's date is ${new Date().toISOString().slice(0, 10)}.

Existing countries in this trip: ${countries.length ? countries.join(", ") : "none yet"}
Available prep tabs: ${prepTabs.map((t) => `${t.id} ("${t.name}")`).join(", ")}

Return ONLY a JSON object — no markdown, no explanation:
{
  "type": "flight | hotel | place | todo | unknown",
  "summary": "one sentence describing what was found, e.g. 'Flight TLV → BKK on Aug 12'",
  "destination": "flight_research | hotels | countries | <prep-tab-id>",
  "extractedData": {}
}

extractedData by type:
- flight: { "origin": "IATA or city", "destination": "IATA or city", "depart_date": "YYYY-MM-DD or null", "depart_time": "HH:MM or null", "airline": "string or null", "flight_no": "string or null", "price": "string or null", "notes": "string or null" }
- hotel: { "name": "hotel name or null", "city": "city or null", "country": "country name or null", "link": "url or null" }
- place: { "name": "city/place name", "country": "country name or null" }
- todo: { "text": "the task text, translated to English if in another language" }
- unknown: {}

For destination, use the prep tab id that best fits (e.g. "todos" for general tasks, "shopping" for items to buy, "first_aid" for medical items). If no prep tab fits, use "todos".

For unknown content, still make a best guess at type and destination.`;

    const contentBlocks: unknown[] = [];
    if (imageBase64) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
      });
    }
    contentBlocks.push({
      type: "text",
      text: text
        ? `Parse this input:\n${text}`
        : "Parse the image above and extract travel-related information.",
    });

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
        system: systemPrompt,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    const data = await r.json();
    if (!r.ok) return json({ error: `Anthropic API error: ${JSON.stringify(data)}` }, 502);
    const raw = (data.content || []).map((b: { text: string }) => b.text).join("").trim();

    let type = "unknown", summary = "Could not parse", destination = "todos";
    let extractedData: Record<string, unknown> = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        type = parsed.type || "unknown";
        summary = parsed.summary || "Could not parse";
        destination = parsed.destination || "todos";
        extractedData = parsed.extractedData || {};
      }
    } catch (_) {}

    const VALID_TYPES = ['flight', 'hotel', 'place', 'todo', 'unknown'];
    if (!VALID_TYPES.includes(type)) type = 'unknown';

    return json({ type, summary, destination, extractedData });
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
