// supabase/functions/visa-info/index.ts
// Deploy: supabase functions deploy visa-info
// Uses the same ANTHROPIC_API_KEY secret as the other AI functions.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { countries, nationality } = await req.json();
    if (!Array.isArray(countries) || !countries.length) {
      return json({ error: "No destination countries provided" }, 400);
    }
    if (!nationality || !String(nationality).trim()) {
      return json({ error: "No nationality provided" }, 400);
    }

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured on the server." }, 503);

    const countriesText = countries.map((c: string) => `- ${c}`).join("\n");

    const prompt = `You are a visa and travel-bureaucracy assistant. For each destination country listed below, use web search to find the actual current visa requirements for the stated traveler nationality. Be specific: whether a visa is required, how to get it (e-visa, visa on arrival, embassy application, or visa-free), how long the permitted stay is, and the typical fee if you can find it.

Traveler nationality: ${nationality}

Destinations:
${countriesText}

Return ONLY a valid JSON array, no other text. Each item:
{
  "country": "Sri Lanka",
  "visa_required": true,
  "summary": "One or two plain-language sentences covering the requirement, how to get it, and the fee if known.",
  "max_stay": "e.g. 30 days (or null if not applicable)"
}
If you cannot find reliable current information for a country, still include it with "summary" explaining that, and "visa_required": null.`;

    let messages: Array<Record<string, unknown>> = [{ role: "user", content: prompt }];
    const tools = [{ type: "web_search_20260209", name: "web_search" }];
    let data: any = null;

    for (let i = 0; i < 3; i++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          tools,
          messages,
        }),
      });
      data = await r.json();
      if (data.stop_reason !== "pause_turn") break;
      messages = [
        { role: "user", content: prompt },
        { role: "assistant", content: data.content },
      ];
    }

    const text = (data?.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let visas: any[] = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) visas = JSON.parse(match[0]);
    } catch (_) {}

    return json({ visas });
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
