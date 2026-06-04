// supabase/functions/investigate/index.ts
// Deploy with:  supabase functions deploy investigate
// Set the key:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// This runs on Supabase's servers, NOT in the browser, so your
// Anthropic key is never exposed to users.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { city, country } = await req.json();
    if (!city) {
      return json({ error: "Missing city" }, 400);
    }

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "AI key not configured on the server yet." }, 503);

    const prompt =
      `You are helping two parents plan a family trip with kids. ` +
      `Give a concise, practical briefing on ${city}${country ? ", " + country : ""}. ` +
      `Cover, in short paragraphs: what it's known for, the top things to do ` +
      `(especially family/kid-friendly), best time to visit, and one or two ` +
      `practical tips (getting around, where to stay). Keep it under 220 words, ` +
      `warm and useful, no markdown headers.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    return json({ text: text || "No response." });
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
