import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GELATO_API_KEY = Deno.env.get("GELATO_API_KEY");
    if (!GELATO_API_KEY) throw new Error("GELATO_API_KEY is not configured");

    // Leggi sia query (?templateId=) sia body JSON { templateId }
    const url = new URL(req.url);
    let templateId = url.searchParams.get("templateId");
    if (!templateId && req.method !== "GET") {
      try {
        const body = await req.json();
        templateId = body?.templateId;
      } catch { /* ignore */ }
    }
    if (!templateId) {
      return new Response(JSON.stringify({ error: "Template ID is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[get-template] calling Gelato for ${templateId}`);

    const resp = await fetch(`https://ecommerce.gelatoapis.com/v1/templates/${templateId}`, {
      method: "GET",
      headers: { "X-API-KEY": GELATO_API_KEY },
    });

    const payload = await resp.json();
    if (!resp.ok) {
      console.error("[get-template] Gelato error", resp.status, payload);
      return new Response(JSON.stringify({ error: payload?.message ?? "Gelato API error", raw: payload }), {
        status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error in gelato-get-template:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
