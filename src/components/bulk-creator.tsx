import React, { useEffect, useMemo, useState } from "react";
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

interface ImageFile {
  id: string;
  file: File;
  preview: string;
  name: string;
  size: string;
}

interface Product {
  id: string;         // deve essere un vero UUID del template
  name: string;
  type: string;
  variants: string[]; // titoli visivi, non usati nel payload
  printAreas: string[];
}

interface ProductRulesType {
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
}

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
  includeCustomDescription: false
};

const isUuid = (s?: string) =>
  !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

/* ---------- helpers: Canvas fit (cover/contain/exact) ---------- */

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((res, rej) => {
      const img = new Image();
      img.onload = () => res();
      img.onerror = () => rej();
      img.src = url;
    });
    const img = new Image();
    img.src = url;
    return img;
  } finally {
    // URL.revokeObjectURL lo facciamo dopo l'uso del canvas
  }
}

function drawFit(
  src: HTMLImageElement,
  targetW: number,
  targetH: number,
  mode: "stretch" | "preserve" | "exact",
  bg: string | null = null // null = trasparente
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(targetW));
  canvas.height = Math.max(1, Math.round(targetH));
  const ctx = canvas.getContext("2d")!;

  // background
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    // canvas già trasparente
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const sw = src.width;
  const sh = src.height;
  if (mode === "exact") {
    // centra senza scale
    const dx = (canvas.width - sw) / 2;
    const dy = (canvas.height - sh) / 2;
    ctx.drawImage(src, dx, dy);
    return canvas;
  }

  const targetRatio = canvas.width / canvas.height;
  const srcRatio = sw / sh;

  if (mode === "stretch") {
    // cover: riempi tutto, possibile crop
    let dw = canvas.width;
    let dh = canvas.height;
    let sx = 0, sy = 0, sWidth = sw, sHeight = sh;

    // scegli porzione sorgente da tagliare per coprire
    if (srcRatio > targetRatio) {
      // taglia sui lati orizzontali
      sWidth = sh * targetRatio;
      sx = (sw - sWidth) / 2;
    } else {
      // taglia sopra/sotto
      sHeight = sw / targetRatio;
      sy = (sh - sHeight) / 2;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
    return canvas;
  }

  // preserve → contain: nessun crop, possibili “bordi”
  let scale = 1;
  if (srcRatio > targetRatio) {
    // adatto su larghezza
    scale = canvas.width / sw;
  } else {
    // adatto su altezza
    scale = canvas.height / sh;
  }
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.round((canvas.width - dw) / 2);
  const dy = Math.round((canvas.height - dh) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh, dx, dy, dw, dh);
  return canvas;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
}

/** prova a ricavare le dimensioni in px del placeholder dal template;
 *  se non disponibili, parse del titolo “12x16 in - 30x40 cm” → 300 DPI
 */
function inferPlaceholderSize(variant: any): { w: number; h: number } {
  const p = variant?.imagePlaceholders?.[0];
  if (p?.width && p?.height) return { w: p.width, h: p.height };

  const title: string = variant?.title ?? "";
  // prova inches tipo “12x16 in”
  const mIn = title.match(/(\d+)\s*x\s*(\d+)\s*in/i);
  if (mIn) {
    const w = parseInt(mIn[1], 10) * 300;
    const h = parseInt(mIn[2], 10) * 300;
    return { w, h };
  }
  // prova cm tipo “30x40 cm”
  const mCm = title.match(/(\d+)\s*x\s*(\d+)\s*cm/i);
  if (mCm) {
    // 300 dpi ≈ 118 px/cm
    const w = Math.round(parseInt(mCm[1], 10) * 118);
    const h = Math.round(parseInt(mCm[2], 10) * 118);
    return { w, h };
  }
  // fallback “abbondante”
  return { w: 3600, h: 5400 }; // 12x18 @300dpi
}

async function makeVariantImage(
  file: File,
  variant: any,
  mode: "stretch" | "preserve" | "exact"
): Promise<Blob> {
  const img = await fileToImage(file);
  const { w, h } = inferPlaceholderSize(variant);
  const canvas = drawFit(img, w, h, mode, mode === "preserve" ? null : null);
  const blob = await canvasToPngBlob(canvas);
  // cleanup
  URL.revokeObjectURL(img.src);
  return blob;
}

/* ------------------------- upload helper ------------------------- */

async function uploadAndGetPublicUrl(file: File, destPath: string) {
  const { data, error } = await supabase.storage
    .from("designs")
    .upload(destPath, file, {
      upsert: true,
      contentType: file.type || "image/png",
      cacheControl: "3600",
    });

  if (error) throw error;
  const { data: pub } = supabase.storage.from("designs").getPublicUrl(data.path);
  return pub.publicUrl;
}

/* ================================================================= */

export function BulkCreator() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  const [isConnected, setIsConnected] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string; storeName: string } | null>(
    null
  );

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

  // ripristina credenziali salvate
  useEffect(() => {
    const saved = localStorage.getItem("gelatoCreds");
    if (saved) {
      try {
        const c = JSON.parse(saved);
        if (c?.apiKey && c?.storeName) {
          setCredentials(c);
          setIsConnected(true);
          setCurrentStep(2);
        }
      } catch {}
    }
  }, []);

  const handleConnect = (creds: { apiKey: string; storeName: string }) => {
    setCredentials(creds);
    setIsConnected(true);
    setCurrentStep(2);
    localStorage.setItem("gelatoCreds", JSON.stringify(creds));
    toast({ title: "Connected Successfully!", description: `Connected to ${creds.storeName}` });
  };

  const handleImagesChange = (newImages: ImageFile[]) => {
    setImages(newImages);
    if (newImages.length > 0 && currentStep === 2) setCurrentStep(3);
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    if (currentStep === 3) setCurrentStep(4);
  };

  const handleSaveRules = () => {
    toast({ title: "Rules Saved", description: "Product creation rules saved." });
  };

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    if (!isUuid(selectedProduct.id)) {
      toast({
        title: "Invalid template",
        description:
          "In Step 3 carica un vero Template ID Gelato (UUID) e premi “Load Template”.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setCreationProgress(0);

    try {
      // 1) Template dal backend (ci serve la lista completa delle varianti)
      const tpl = await getTemplate(selectedProduct.id);
      setTemplate(tpl);
      const tplVariants: any[] = tpl?.variants ?? [];
      if (!tpl?.id || !tplVariants.length) {
        throw new Error("Template non valido o senza varianti.");
      }

      // 2) Per ogni immagine, costruiamo TUTTE le varianti con il file già fittato
      const productsPayload = await Promise.all(
        images.map(async (image, idx) => {
          let title = "";
          if (rules.titleMode === "filename") {
            title = image.name.replace(/\.[^/.]+$/, "");
          } else if (rules.titleMode === "ai-simple") {
            title = `AI Generated Title ${idx + 1}`;
          } else {
            title = `Custom Product ${idx + 1}`;
          }
          if (rules.includeCustomTitle && rules.titleCustomText) {
            title += ` ${rules.titleCustomText}`;
          }

          const safeBase =
            image.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]/g, "") || "design";

          const variantEntries = [];
          for (const v of tplVariants) {
            const blob = await makeVariantImage(image.file, v, processingOptions.fitMode);
            const vFile = new File([blob], `${image.id}-${v.id}-${Date.now()}.png`, {
              type: "image/png",
            });
            const url = await uploadAndGetPublicUrl(
              vFile,
              `uploads/${image.id}/${v.id}/${Date.now()}-${safeBase}.png`
            );

            const placeholderName =
              v?.imagePlaceholders?.[0]?.name || tpl?.imagePlaceholders?.[0]?.name || "front";

            variantEntries.push({
              templateVariantId: v.id,
              imagePlaceholders: [
                {
                  name: placeholderName,
                  fileUrl: url,
                },
              ],
            });
          }

          return {
            title,
            description:
              rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator",
            tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"],
            variants: variantEntries, // <-- TUTTE le varianti del template
          };
        })
      );

      console.log("Starting bulk product creation:", productsPayload);

      // 3) Chiamata Edge Function (usa i secrets per storeId; passo anche STORE_ID se presente)
      const data = await bulkCreate({
        templateId: tpl.id,
        publish: true,
        products: productsPayload,
        storeId: STORE_ID,
      });

      const results = data?.results || [];
      console.log("Bulk creation results:", results);

      setCreatedProducts(results);
      setCreationProgress(100);

      const successCount = results.filter((r: any) => r.status === "active").length;
      const errorCount = results.filter((r: any) => r.status === "error").length;

      if (successCount > 0) {
        toast({
          title: "🎉 Products Created",
          description: `Created ${successCount} products. ${errorCount ? `${errorCount} failed.` : ""}`,
        });
      } else {
        toast({
          title: "Product Creation Failed",
          description: "Failed to create products. Check console for details.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error("Error creating products:", err);
      toast({
        title: "Error creating products",
        description: err?.message ?? "Failed to create products",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const completedSteps = useMemo(
    () =>
      [
        isConnected,
        images.length > 0,
        selectedProduct !== undefined,
        createdProducts.length > 0,
      ].filter(Boolean).length,
    [isConnected, images, selectedProduct, createdProducts]
  );

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

      <StepCard
        step={2}
        title="Upload Your Design Files"
        description="Select images and configure processing options"
        isActive={currentStep === 2}
        isCompleted={images.length > 0}
      >
        {(currentStep === 2 || images.length > 0) && isConnected && (
          <ImageUploader
            onImagesChange={setImages}
            processingOptions={processingOptions}
            onOptionsChange={setProcessingOptions}
          />
        )}
      </StepCard>

      <StepCard
        step={3}
        title="Choose Example Product"
        description="Select a product from your catalog to use as a template"
        isActive={currentStep === 3}
        isCompleted={selectedProduct !== undefined}
      >
        {(currentStep === 3 || selectedProduct) && images.length > 0 && (
          <ProductSelector onProductSelect={handleProductSelect} selectedProduct={selectedProduct} />
        )}
      </StepCard>

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
                    <div className="font-medium text-foreground">{template?.variants?.length ?? selectedProduct.variants.length}</div>
                    <div>Product Variants</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      {images.length * (template?.variants?.length ?? selectedProduct.variants.length)}
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
                    <p className="text-sm text-muted-foreground">
                      {Math.round(creationProgress)}% complete
                    </p>
                  </div>
                ) : hasSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-success">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Products Created Successfully!</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Created {successCount} products in your Gelato store
                    </div>
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
