import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProductVariant {
  templateVariantId: string;
  imagePlaceholders: Array<{ name: string; fileUrl: string }>;
}
interface ProductRequest {
  title: string;
  description: string;
  tags: string[];
  variants: ProductVariant[];
}
interface BulkCreateRequest {
  templateId: string;
  publish: boolean;
  products: ProductRequest[];
}
interface ProductResult {
  productId?: string;
  status: string;
  externalId?: string;
  previewUrl?: string;
  error?: string;
  title: string;
}

async function pollProductStatus(storeId: string, productId: string, apiKey: string): Promise<{ status: string; externalId?: string; previewUrl?: string }> {
  const maxAttempts = 30;
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://ecommerce.gelatoapis.com/v1/stores/${storeId}/products/${productId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      if (response.ok) {
        const product = await response.json();
        const status = product.status;
        if (status === "active" || status === "publishing_error") {
          return { status, externalId: product.externalId, previewUrl: product.previewUrl };
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    } catch (err) {
      console.error(`Polling attempt ${attempt + 1} failed:`, err);
    }
  }
  return { status: "timeout" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ⚠️ TRIM per evitare spazi/virgolette copiate negli secrets
    const GELATO_API_KEY = (Deno.env.get("GELATO_API_KEY") ?? "").trim();
    const GELATO_STORE_ID = (Deno.env.get("GELATO_STORE_ID") ?? "").trim();

    if (!GELATO_API_KEY || !GELATO_STORE_ID) {
      throw new Error("GELATO_API_KEY and GELATO_STORE_ID must be configured");
    }

    // mini-log non sensibile (solo prefisso/lunghezza)
    console.log("Using Gelato key prefix:", GELATO_API_KEY.slice(0, 6), "len:", GELATO_API_KEY.length);

    const requestData: BulkCreateRequest = await req.json();
    const { templateId, publish, products } = requestData;

    console.log(`Starting bulk creation of ${products.length} products`);

    const results: ProductResult[] = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`Creating product ${i + 1}/${products.length}: ${product.title}`);

      try {
        const createResponse = await fetch(`https://ecommerce.gelatoapis.com/v1/stores/${GELATO_STORE_ID}/products:create-from-template`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GELATO_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            templateId,
            title: product.title,
            description: product.description,
            tags: product.tags,
            isVisibleInTheOnlineStore: publish,
            salesChannels: publish ? ["web"] : [],
            variants: product.variants,
          }),
        });

        if (!createResponse.ok) {
          const raw = await createResponse.text();
          let message = raw;
          try {
            const j = JSON.parse(raw);
            message = j.message || raw;
          } catch {}
          console.error(`Failed to create product ${product.title}: ${createResponse.status} - ${message}`);
          results.push({ title: product.title, status: "error", error: `${createResponse.status} - ${message}` });
          continue;
        }

        const created = await createResponse.json();
        const productId = created.id;
        console.log(`Product created with ID: ${productId}, polling status...`);

        const statusResult = await pollProductStatus(GELATO_STORE_ID, productId, GELATO_API_KEY);

        results.push({
          productId,
          title: product.title,
          status: statusResult.status,
          externalId: statusResult.externalId,
          previewUrl: statusResult.previewUrl,
        });

        console.log(`Product ${product.title} finished with status: ${statusResult.status}`);
      } catch (err: any) {
        console.error(`Error creating product ${product.title}:`, err);
        results.push({ title: product.title, status: "error", error: String(err?.message || err) });
      }
    }

    const okCount = results.filter((r) => r.status === "active").length;
    console.log(`Bulk creation completed. Created ${okCount}/${products.length} products successfully`);

    // Se tutti errori → 400 per far comparire il toast rosso lato UI
    const allError = results.length > 0 && results.every((r) => r.status !== "active");
    return new Response(JSON.stringify({ results }), {
      status: allError ? 400 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in gelato-bulk-create:", error);
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
