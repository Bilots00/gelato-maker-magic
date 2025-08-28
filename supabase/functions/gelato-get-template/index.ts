import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY');
    if (!GELATO_API_KEY) {
      throw new Error('GELATO_API_KEY is not configured');
    }

    // ...
const url = new URL(req.url);
// PRIMA prendevi l'ultimo pezzo del path (sbagliato)
// Ora leggiamo il query param ?templateId=...
const templateId = url.searchParams.get("templateId");

if (!templateId) {
  throw new Error("Template ID is required");
}
// ...


    console.log(`Fetching template ${templateId} from Gelato API`);

    const response = await fetch(`https://ecommerce.gelatoapis.com/v1/templates/${templateId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GELATO_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gelato API error: ${response.status} - ${errorText}`);
      throw new Error(`Gelato API error: ${response.status} - ${errorText}`);
    }

    const templateData = await response.json();
    console.log('Template fetched successfully:', templateData);

    return new Response(JSON.stringify(templateData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in gelato-get-template:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});