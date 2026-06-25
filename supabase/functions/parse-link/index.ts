// supabase/functions/parse-link/index.ts
// Deploy: supabase functions deploy parse-link

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { url } = await req.json();
    if (!url) return json({ error: "Missing url" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured." }, 503);

    // Fetch the page server-side (bypasses browser CORS)
    let pageText = "";
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TripPlannerBot/1.0)",
          "Accept": "text/html",
        },
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();

      // Extract useful text: title, og tags, meta description
      const extract = (pattern: RegExp) => html.match(pattern)?.[1]?.trim() || "";
      const title       = extract(/<title[^>]*>([^<]+)<\/title>/i);
      const ogTitle     = extract(/property=["']og:title["'][^>]+content=["']([^"']+)/i)
                       || extract(/content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      const ogDesc      = extract(/property=["']og:description["'][^>]+content=["']([^"']+)/i)
                       || extract(/content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
      const metaDesc    = extract(/name=["']description["'][^>]+content=["']([^"']+)/i);

      pageText = [title, ogTitle, ogDesc, metaDesc].filter(Boolean).join("\n");
    } catch (_) {
      // Fetch failed — try to infer from URL alone
      pageText = url;
    }

    // Always include the URL itself — slug/path often contains location ("hoi-an-vietnam")
    pageText = [pageText, url].filter(Boolean).join("\n");
    if (!pageText) return json({ place: null, country: null });

    // Ask Claude to identify the travel destination
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 180,
        messages: [{
          role: "user",
          content: `From this webpage content, identify the travel destination. Return ONLY a JSON object, no other text:
{"name": "hotel/Airbnb/restaurant/attraction name if this is a specific listing, otherwise null", "place": "city or destination name or null", "country": "country name or null", "type": "hotel if this is a hotel or accommodation listing, place if it is a travel content page, null if unclear"}

Content:
${pageText.slice(0, 800)}

URL: ${url}

Examples:
- Booking.com hotel page → {"name": "Hotel Le Marais", "place": "Paris", "country": "France", "type": "hotel"}
- Airbnb listing → {"name": "Oceanfront Villa", "place": "Bali", "country": "Indonesia", "type": "hotel"}
- Instagram post about Hoi An → {"name": null, "place": "Hoi An", "country": "Vietnam", "type": "place"}
If nothing clear, return {"name": null, "place": null, "country": null, "type": null}.`,
        }],
      }),
    });

    const data = await r.json();
    const raw = (data.content || []).map((b: any) => b.text).join("").trim();

    let name = null, place = null, country = null, type = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) ({ name, place, country, type } = JSON.parse(match[0]));
    } catch (_) {}

    return json({ name, place, country, type });
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
