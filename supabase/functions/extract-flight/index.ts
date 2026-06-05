// supabase/functions/extract-flight/index.ts
// Deploy: supabase functions deploy extract-flight
// Uses the same ANTHROPIC_API_KEY secret as the investigate function.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) return json({ error: "Missing image data" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured on the server." }, 503);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType || "image/png",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Extract all flights shown in this screenshot. Return ONLY a valid JSON array, no other text.
Each item:
{
  "from": "airport code or city",
  "to": "airport code or city",
  "date": "e.g. Nov 22",
  "departure_time": "e.g. 9:25 AM",
  "arrival_time": "e.g. 9:55 PM",
  "duration": "e.g. 9h",
  "stops": 1,
  "stop_airports": ["DXB"],
  "airline": "Emirates",
  "codeshare": "operated by flydubai or null",
  "price_per_person": "$418"
}
If you cannot find a value, use null. Return only the JSON array.`,
            },
          ],
        }],
      }),
    });

    const data = await r.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let flights = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) flights = JSON.parse(match[0]);
    } catch (_) {}

    return json({ flights });
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
