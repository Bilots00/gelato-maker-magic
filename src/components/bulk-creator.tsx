import React, { useEffect, useState } from "react";
import { StepCard } from "@/components/ui/step-card";
import { ApiConnection } from "@/components/api-connection";
import { ImageUploader } from "@/components/image-uploader";
import { ProductSelector } from "@/components/product-selector";
import { ProductRules } from "@/components/product-rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Loader2, Package, Rocket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { bulkCreate, getTemplate } from "@/lib/supabaseFetch";
import { supabase } from "@/integrations/supabase/client";

const STORE_ID = import.meta.env.VITE_GELATO_STORE_ID as string | undefined;

type ImageFile = {
  id: string;
  file: File;
  preview: string;
  name: string;
  size: string;
};

type Product = {
  id: string;
  name: string;
  type: string;
  variants: string[];
  printAreas: string[];
};

type ProductRulesType = {
  titleMode: "filename" | "ai-simple" | "ai-compound";
  titleMaxWords: number;
  titleCustomText: string;
  descriptionMode: "copy" | "ai";
  descriptionParagraphs: number;
  descriptionSentences: number;
  descriptionCustomHTML: string;
  tagsMode: "copy" | "ai";
  tagsMaxCount: number;
  tagsCustom: string[];
  includeCustomTitle: boolean;
  includeCustomDescription: boolean;
};

const defaultRules: ProductRulesType = {
  titleMode: "ai-simple",
  titleMaxWords: 8,
  titleCustomText: "",
  descriptionMode: "ai",
  descriptionParagraphs: 2,
  descriptionSentences: 3,
  descriptionCustomHTML: "",
  tagsMode: "ai",
  tagsMaxCount: 10,
  tagsCustom: [],
  includeCustomTitle: false,
  includeCustomDescription: false,
};

const isUuid = (s?: string) =>
  !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

// --- helpers: parse variant title -> inches ---
const INCH_PER_CM = 1 / 2.54;

function parseVariantInches(title?: string): [number, number] | null {
  if (!title) return null;
  // es: "12x16 in - 30x40 cm"
  const mIn = title.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*in/i);
  if (mIn) return [parseFloat(mIn[1]), parseFloat(mIn[2])];

  const mCm = title.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*cm/i);
  if (mCm) {
    const w = parseFloat(mCm[1]) * INCH_PER_CM;
    const h = parseFloat(mCm[2]) * INCH_PER_CM;
    return [w, h];
  }
  return null;
}

function extFromType(t: string) {
  return t.includes("png") ? "png" : t.includes("webp") ? "webp" : "jpg";
}

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// stretch  = COVER (riempi, tagli se serve, nessun bordo, no distorsione)
// preserve = CONTAIN (mantieni ratio e centra; possibili bordi)
// exact    = salta trasformazione (usa file originale)
async function transformForVariant(
  file: File,
  targetW: number,
  targetH: number,
  fitMode: "stretch" | "preserve" | "exact",
  upscale: boolean
): Promise<Blob | null> {
  if (fitMode === "exact") return null;

  const img = await fileToImage(file);
  const type = file.type || "image/png";
  const ext = extFromType(type);

  // calcolo dimensioni canvas
  const canvasW = upscale ? Math.round(targetW) : Math.min(Math.round(targetW), img.naturalWidth);
  const canvasH = upscale ? Math.round(targetH) : Math.min(Math.round(targetH), img.naturalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvasW, canvasH);

  const srcR = img.naturalWidth / img.naturalHeight;
  const dstR = canvasW / canvasH;

  let drawW: number, drawH: number, dx: number, dy: number;

  if (fitMode === "stretch") {
    // COVER (riempi tutto, tagli se necessario – niente bordi)
    if (srcR > dstR) {
      // immagine "più larga" -> adatto per altezza, poi croppo ai lati
      drawH = canvasH;
      drawW = Math.round(canvasH * srcR);
    } else {
      // immagine "più alta" -> adatto per larghezza, poi croppo sopra/sotto
      drawW = canvasW;
      drawH = Math.round(canvasW / srcR);
    }
    dx = Math.round((canvasW - drawW) / 2);
    dy = Math.round((canvasH - drawH) / 2);
  } else {
    // PRESERVE (contain + center)
    if (srcR > dstR) {
      drawW = canvasW;
      drawH = Math.round(canvasW / srcR);
    } else {
      drawH = canvasH;
      drawW = Math.round(canvasH * srcR);
    }
    dx = Math.round((canvasW - drawW) / 2);
    dy = Math.round((canvasH - drawH) / 2);
  }

  ctx.drawImage(img, dx, dy, drawW, drawH);

  const quality = type.includes("jpeg") || type.includes("jpg") ? 0.92 : 1;
  return await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), type.includes("image/") ? type : `image/${ext}`, quality)
  );
}


async function uploadAndGetPublicUrl(input: File, destPath: string) {
  const { data, error } = await supabase.storage.from("designs").upload(destPath, input, {
    upsert: true,
    contentType: input.type || "image/png",
    cacheControl: "3600",
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("designs").getPublicUrl(data.path);
  return pub.publicUrl;
}

// ---------- componente ----------
export function BulkCreator() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  const [isConnected, setIsConnected] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string; storeName: string } | null>(null);

  const [images, setImages] = useState<ImageFile[]>([]);
  const [processingOptions, setProcessingOptions] = useState({
    upscale: true,
    fitMode: "stretch" as "stretch" | "preserve" | "exact",
  });

  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();
  const [rules, setRules] = useState<ProductRulesType>(defaultRules);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [createdProducts, setCreatedProducts] = useState<any[]>([]);
  const [template, setTemplate] = useState<any | null>(null);

  // ---- bootstrap credenziali da localStorage ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gelato.creds");
      if (raw) {
        const c = JSON.parse(raw);
        setCredentials(c);
        setIsConnected(true);
        setCurrentStep(2);
      }
    } catch {}
  }, []);

  const handleConnect = (creds: { apiKey: string; storeName: string }) => {
    setCredentials(creds);
    setIsConnected(true);
    setCurrentStep(2);
    try {
      localStorage.setItem("gelato.creds", JSON.stringify(creds));
    } catch {}
    toast({ title: "Connected Successfully!", description: `Connected to ${creds.storeName} via Gelato API` });
  };

  const handleImagesChange = (newImages: ImageFile[]) => {
    setImages(newImages);
    // FIX: avanza sempre almeno allo step 3 (niente più freeze)
    setCurrentStep((prev) => (newImages.length > 0 ? Math.max(prev, 3) : prev));
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    setCurrentStep((prev) => Math.max(prev, 4));
  };

  const handleSaveRules = () => {
    toast({ title: "Rules Saved", description: "Product creation rules have been saved successfully" });
  };

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    if (!isUuid(selectedProduct.id)) {
      toast({
        title: "Invalid template",
        description: "In Step 3 carica un vero Template ID Gelato (UUID) e premi “Load Template”.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setCreationProgress(0);

    try {
      const FALLBACK_TEMPLATE_ID = import.meta.env.VITE_GELATO_TEMPLATE_ID as string | undefined;
      const chosenTemplateId = (isUuid(selectedProduct.id) ? selectedProduct.id : undefined) || FALLBACK_TEMPLATE_ID;

      if (!chosenTemplateId) {
        setIsCreating(false);
        toast({
          title: "Template ID mancante",
          description: "Inserisci un Template ID Gelato (UUID) oppure configura VITE_GELATO_TEMPLATE_ID.",
          variant: "destructive",
        });
        return;
      }

      const tpl = await getTemplate(chosenTemplateId);
      setTemplate(tpl);

      const tplVariants: any[] = tpl?.variants ?? [];
      if (!tplVariants.length) {
        toast({ title: "Template error", description: "Nessuna variante trovata nel template.", variant: "destructive" });
        setIsCreating(false);
        return;
      }

      // Prepara prodotti: per OGNI immagine, genera tutte le varianti del template
const products = await Promise.all(
  images.map(async (image, index) => {
    // 1) Titolo
    let title: string;
    if (rules.titleMode === "filename") {
      title = image.name.replace(/\.[^/.]+$/, "");
    } else if (rules.titleMode === "ai-simple") {
      title = `AI Generated Title ${index + 1}`;
    } else {
      title = `Custom Product ${index + 1}`;
    }
    if (rules.includeCustomTitle && rules.titleCustomText) {
      title += ` ${rules.titleCustomText}`;
    }

    // 2) Per ogni variante calcolo dimensioni target e preparo l'upload
    const variantsPayload = await Promise.all(
      tplVariants.map(async (v: any) => {
        const placeholderName =
          v?.imagePlaceholders?.[0]?.name ||
          tpl?.imagePlaceholders?.[0]?.name ||
          "front";

        const inches = parseVariantInches(v?.title) || [12, 16]; // fallback
        const DPI = processingOptions.upscale ? 300 : 150;
        const targetW = Math.round(inches[0] * DPI);
        const targetH = Math.round(inches[1] * DPI);

        // 🔧 Deve esistere anche fuori dall'if
        let fileToUpload: File = image.file;

        // "stretch" = riempi deformando, "preserve" = contain + centering, "exact" = usa originale
        const transformed = await transformForVariant(
          image.file,
          targetW,
          targetH,
          processingOptions.fitMode,   // "stretch" | "preserve" | "exact"
          processingOptions.upscale
        );

        if (transformed) {
          const baseType = image.file.type || "image/png";
          const ext = baseType.includes("png")
            ? "png"
            : baseType.includes("webp")
            ? "webp"
            : baseType.includes("jpeg") || baseType.includes("jpg")
            ? "jpg"
            : "png";

          const fname = image.name.replace(/\.[^/.]+$/, "");
          fileToUpload = new File(
            [transformed],
            `${fname}-${targetW}x${targetH}.${ext}`,
            { type: baseType }
          );
        }

        const safeName = (fileToUpload.name || image.name)
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9.-]/g, "");

        const destPath = `uploads/${image.id}-${Date.now()}-${safeName}`;
        const publicUrl = await uploadAndGetPublicUrl(fileToUpload, destPath);

        return {
          templateVariantId: v.id,
          imagePlaceholders: [
            {
              name: placeholderName,
              fileUrl: publicUrl,
            },
          ],
        };
      })
    );

    return {
      title,
      description: rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator",
      tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"],
      variants: variantsPayload, // <— tutte le varianti del template
    };
  })
);


      console.log("Starting bulk product creation:", products);

      // Passo anche salesChannels se vuoi “View in Shopify”
      const data = await bulkCreate({
        templateId: tpl.id,
        publish: true,
        products,
        storeId: STORE_ID,
        salesChannels: ["shopify"], // o ["web"] se preferisci
      });

      const results = data.results || [];
      console.log("Bulk creation results:", results);

      setCreatedProducts(results);
      setCreationProgress(100);
      setIsCreating(false);

      const successCount = results.filter((r: any) => r.status === "active").length;
      const errorCount = results.filter((r: any) => r.status === "error").length;

      if (successCount > 0) {
        toast({
          title: "🎉 Products Created",
          description: `Created ${successCount} products in your Gelato store. ${errorCount ? `${errorCount} failed.` : ""}`,
        });
      } else {
        toast({
          title: "Product Creation Failed",
          description: "Failed to create products. Check console for details.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Error creating products:", error);
      setIsCreating(false);
      setCreationProgress(0);
      toast({
        title: "Error creating products",
        description: error?.message ?? "Failed to create products",
        variant: "destructive",
      });
    }
  };

  const completedSteps = [isConnected, images.length > 0, !!selectedProduct, createdProducts.length > 0].filter(Boolean)
    .length;
  const successCount = createdProducts.filter((r: any) => r.status === "active").length;
  const hasSuccess = successCount > 0;

  return (
    <div className="space-y-8">
      <Card className="border-primary/20 bg-gradient-to-r from-card to-muted/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Bulk Product Creation Progress</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              Step {currentStep} of 4
            </Badge>
          </div>
          <Progress value={(completedSteps / 4) * 100} className="mb-2" />
          <p className="text-sm text-muted-foreground">{completedSteps}/4 steps completed</p>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <StepCard
        step={1}
        title="Connect Your Gelato Store"
        description="Enter your API credentials to enable product creation"
        isActive={currentStep === 1}
        isCompleted={isConnected}
      >
        {(!isConnected || currentStep === 1) && (
          <ApiConnection onConnect={handleConnect} isConnected={isConnected} />
        )}
      </StepCard>

      {/* Step 2 */}
      <StepCard
        step={2}
        title="Upload Your Design Files"
        description="Select images and configure processing options"
        isActive={currentStep === 2}
        isCompleted={images.length > 0}
      >
        {(currentStep === 2 || images.length > 0) && isConnected && (
          <ImageUploader
            onImagesChange={handleImagesChange}
            processingOptions={processingOptions}
            onOptionsChange={setProcessingOptions}
          />
        )}
      </StepCard>

      {/* Step 3 */}
      <StepCard
        step={3}
        title="Choose Example Product"
        description="Select a product from your catalog to use as a template"
        isActive={currentStep === 3}
        isCompleted={!!selectedProduct}
      >
        {(currentStep === 3 || selectedProduct) && images.length > 0 && (
          <ProductSelector onProductSelect={handleProductSelect} selectedProduct={selectedProduct} />
        )}
      </StepCard>

      {/* Step 4 */}
      <StepCard
        step={4}
        title="Product Creation Rules"
        description="Set up titles, descriptions, and tags for bulk creation"
        isActive={currentStep === 4}
        isCompleted={createdProducts.length > 0}
      >
        {currentStep === 4 && selectedProduct && (
          <div className="space-y-6">
            <ProductRules rules={rules} onRulesChange={setRules} onSave={handleSaveRules} />

            <Card className="border-success/20 bg-success/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="flex items-center justify-center space-x-2 mb-4">
                  <Package className="h-6 w-6 text-success" />
                  <h3 className="text-lg font-semibold">Ready to Create Products</h3>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground mb-6">
                  <div>
                    <div className="font-medium text-foreground">{images.length}</div>
                    <div>Images Ready</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{(template?.variants || []).length || 0}</div>
                    <div>Product Variants</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      {images.length * ((template?.variants || []).length || 0)}
                    </div>
                    <div>Total Products</div>
                  </div>
                </div>

                {isCreating ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Creating products...</span>
                    </div>
                    <Progress value={creationProgress} />
                    <p className="text-sm text-muted-foreground">{Math.round(creationProgress)}% complete</p>
                  </div>
                ) : hasSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-success">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Products Created Successfully!</span>
                    </div>
                    <div className="text-sm text-muted-foreground">Created {successCount} products in your Gelato store</div>
                  </div>
                ) : (
                  <Button
                    onClick={handleCreateProducts}
                    disabled={!images.length || !selectedProduct}
                    size="lg"
                    className="bg-gradient-to-r from-success to-success/80 hover:opacity-90 text-white"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Create {images.length} Products
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </StepCard>
    </div>
  );
}
