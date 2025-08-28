import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProductVariant {
  templateVariantId: string;
  imagePlaceholders: Array<{
    name: string;
    fileUrl: string;
  }>;
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
  const maxAttempts = 30; // 30 seconds timeout
  const pollInterval = 1000; // 1 second

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://api.gelato.com/v1/stores/${storeId}/products/${productId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const product = await response.json();
        const status = product.status;
        
        if (status === 'active' || status === 'publishing_error') {
          return {
            status,
            externalId: product.externalId,
            previewUrl: product.previewUrl
          };
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error(`Polling attempt ${attempt + 1} failed:`, error);
    }
  }

  return { status: 'timeout' };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY');
    const GELATO_STORE_ID = Deno.env.get('GELATO_STORE_ID');

    if (!GELATO_API_KEY || !GELATO_STORE_ID) {
      throw new Error('GELATO_API_KEY and GELATO_STORE_ID must be configured');
    }

    const requestData: BulkCreateRequest = await req.json();
    const { templateId, publish, products } = requestData;

    console.log(`Starting bulk creation of ${products.length} products`);

    const results: ProductResult[] = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`Creating product ${i + 1}/${products.length}: ${product.title}`);

      try {
        // Create product from template
        const createResponse = await fetch(`https://api.gelato.com/v1/stores/${GELATO_STORE_ID}/products:create-from-template`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GELATO_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateId,
            title: product.title,
            description: product.description,
            tags: product.tags,
            isVisibleInTheOnlineStore: publish,
            salesChannels: publish ? ["web"] : [],
            variants: product.variants
          }),
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          console.error(`Failed to create product ${product.title}: ${createResponse.status} - ${errorText}`);
          results.push({
            title: product.title,
            status: 'error',
            error: `${createResponse.status} - ${errorText}`
          });
          continue;
        }

        const createdProduct = await createResponse.json();
        const productId = createdProduct.id;
        console.log(`Product created with ID: ${productId}, polling status...`);

        // Poll for product status
        const statusResult = await pollProductStatus(GELATO_STORE_ID, productId, GELATO_API_KEY);

        results.push({
          productId,
          title: product.title,
          status: statusResult.status,
          externalId: statusResult.externalId,
          previewUrl: statusResult.previewUrl
        });

        console.log(`Product ${product.title} finished with status: ${statusResult.status}`);

      } catch (error) {
        console.error(`Error creating product ${product.title}:`, error);
        results.push({
          title: product.title,
          status: 'error',
          error: error.message
        });
      }
    }

    console.log(`Bulk creation completed. Created ${results.filter(r => r.status === 'active').length}/${products.length} products successfully`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in gelato-bulk-create:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});