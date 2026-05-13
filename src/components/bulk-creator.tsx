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
  titleMode: "filename", // <-- CAMBIATO DA "ai-simple"
  titleMaxWords: 8,
  titleCustomText: "",
  descriptionMode: "copy", // <-- CAMBIATO DA "ai"
  descriptionParagraphs: 2,
  descriptionSentences: 3,
  descriptionCustomHTML: "",
  tagsMode: "copy", // <-- CAMBIATO DA "ai"
  tagsMaxCount: 10,
  tagsCustom: [],
  includeCustomTitle: false,
  includeCustomDescription: false,
};

const isUuid = (s?: string) =>
  !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const INCH_PER_CM = 1 / 2.54;

function parseVariantInches(title?: string): [number, number] | null {
  if (!title) return null;
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
  try {
    const img = new Image();
    img.src = url;
    if ("decode" in img) {
      await (img as any).decode().catch(
        () =>
          new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = (e) => rej(e);
          })
      );
    } else {
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = (e) => rej(e);
      });
    }
    return img;
  } finally {
    // Il browser svuoterà la memoria da solo
  }
}

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

  const MAX_W = 8192;
  const MAX_H = 8192;
  const MAX_PIXELS = 48_000_000;

  const scaleBySource = Math.min(img.naturalWidth / targetW, img.naturalHeight / targetH);
  let scale = upscale ? 1 : Math.min(1, scaleBySource);

  const capBySide = Math.min(MAX_W / targetW, MAX_H / targetH, 1);
  const capByPixels = Math.sqrt(Math.min(1, MAX_PIXELS / (targetW * targetH)));
  const safeCap = Math.min(capBySide, capByPixels);

  scale = Math.min(scale, safeCap);
  const canvasW = Math.max(1, Math.round(targetW * scale));
  const canvasH = Math.max(1, Math.round(targetH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvasW, canvasH);

  if (fitMode === "stretch") {
    ctx.drawImage(img, 0, 0, canvasW, canvasH);
  } else {
    const srcR = img.naturalWidth / img.naturalHeight;
    const dstR = canvasW / canvasH;
    let drawW: number, drawH: number;
    if (srcR > dstR) {
      drawW = canvasW;
      drawH = Math.round(canvasW / srcR);
    } else {
      drawH = canvasH;
      drawW = Math.round(canvasH * srcR);
    }
    const dx = Math.round((canvasW - drawW) / 2);
    const dy = Math.round((canvasH - drawH) / 2);
    ctx.drawImage(img, dx, dy, drawW, drawH);
  }

  const quality = /jpe?g/i.test(type) ? 0.92 : 1;

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new DOMException("Canvas encoding failed", "EncodingError"));
        else resolve(b);
      },
      type.includes("image/") ? type : `image/${ext}`,
      quality
    );
  });
}

// 🚀 UPLOAD OTTIMIZZATO SENZA FORMDATA PER FILE GIGANTI
async function uploadAndGetPublicUrl(input: File, destPath: string) {
  const safeFileName = destPath.split('/').pop() || "image.jpg";
  
  const uploadRes = await fetch("https://gelato-backend.andrea-bilotta00.workers.dev/upload", {
    method: "POST",
    headers: {
      "Content-Type": input.type || "application/octet-stream",
      "x-file-name": safeFileName
    },
    body: input // <- Mandiamo il file nudo e crudo! Zero memory leak!
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    console.error("Cloudflare upload error:", errorText);
    throw new Error("Errore durante il caricamento dell'immagine su Cloudflare R2");
  }

  const cloudflareData = await uploadRes.json();
  return cloudflareData.url; 
}

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
    try { localStorage.setItem("gelato.creds", JSON.stringify(creds)); } catch {}
    toast({ title: "Connected Successfully!", description: `Connected to ${creds.storeName}` });
  };

  const handleImagesChange = (newImages: ImageFile[]) => {
    setImages(newImages);
    setCurrentStep((prev) => (newImages.length > 0 ? Math.max(prev, 3) : prev));
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    setCurrentStep((prev) => Math.max(prev, 4));
  };

  const handleSaveRules = () => {
    toast({ title: "Rules Saved", description: "Product creation rules have been saved successfully" });
  };

  // 🚀 LOGICA SEQUENZIALE ANTI-CRASH
  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    if (!isUuid(selectedProduct.id)) {
      toast({ title: "Invalid template", description: "Carica un VERO Template ID Gelato (UUID)", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    setCreationProgress(0);

    try {
      const chosenTemplateId = selectedProduct.id;
      const tpl = await getTemplate(chosenTemplateId);
      setTemplate(tpl);

      const tplVariants: any[] = tpl?.variants ?? [];
      if (!tplVariants.length) {
        toast({ title: "Template error", description: "Nessuna variante trovata.", variant: "destructive" });
        setIsCreating(false);
        return;
      }

      const products = [];
      const totalSteps = images.length * tplVariants.length;

      // CICLO FOR: Processiamo le immagini UNA alla volta
      for (let imgIndex = 0; imgIndex < images.length; imgIndex++) {
        const image = images[imgIndex];

        let title: string;
        if (rules.titleMode === "filename") title = image.name.replace(/\.[^/.]+$/, "");
        else if (rules.titleMode === "ai-simple") title = `AI Generated Title ${imgIndex + 1}`;
        else title = `Custom Product ${imgIndex + 1}`;
        
        if (rules.includeCustomTitle && rules.titleCustomText) title += ` ${rules.titleCustomText}`;

        const variantsPayload = [];
        
        // Magia Nera: Se l'utente vuole "exact match", carichiamo l'immagine UNA volta e la usiamo per tutto!
        let singleUploadUrl = null;
        if (processingOptions.fitMode === "exact") {
            const safeName = (image.file.name || image.name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]/g, "");
            const destPath = `uploads/${image.id}-${Date.now()}-${safeName}`;
            singleUploadUrl = await uploadAndGetPublicUrl(image.file, destPath);
        }

        // CICLO FOR: Processiamo le varianti UNA alla volta
        for (let vIndex = 0; vIndex < tplVariants.length; vIndex++) {
            const v = tplVariants[vIndex];
            
            const currentStepNum = (imgIndex * tplVariants.length) + vIndex;
            setCreationProgress((currentStepNum / totalSteps) * 80); // L'80% del tempo è upload

            const placeholderName = v?.imagePlaceholders?.[0]?.name || tpl?.imagePlaceholders?.[0]?.name || "default";
            let finalUrl = singleUploadUrl;

            // Se non è "exact", elaboriamo e carichiamo il file specifico per la variante
            if (!finalUrl) {
                const inches = parseVariantInches(v?.title) || [12, 16]; 
                const DPI = processingOptions.upscale ? 300 : 150;
                const targetW = Math.round(inches[0] * DPI);
                const targetH = Math.round(inches[1] * DPI);

                const transformed = await transformForVariant(
                  image.file, targetW, targetH, processingOptions.fitMode, processingOptions.upscale
                );

                let fileToUpload: File = image.file;
                if (transformed) {
                  const baseType = image.file.type || "image/png";
                  const ext = baseType.includes("png") ? "png" : baseType.includes("webp") ? "webp" : "jpg";
                  const fname = image.name.replace(/\.[^/.]+$/, "");
                  fileToUpload = new File([transformed], `${fname}-${targetW}x${targetH}.${ext}`, { type: baseType });
                }

                const safeName = (fileToUpload.name || image.name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]/g, "");
                const destPath = `uploads/${image.id}-${Date.now()}-${safeName}`;
                finalUrl = await uploadAndGetPublicUrl(fileToUpload, destPath);
            }

            variantsPayload.push({
              templateVariantId: v.id,
              imagePlaceholders: [{ name: placeholderName, fileUrl: finalUrl }]
            });
        }

        products.push({
          title,
          description: rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator",
          tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"],
          variants: variantsPayload,
        });
      }

      setCreationProgress(90); // Invio dati al worker

      const data = await bulkCreate({
        templateId: tpl.id,
        publish: true,
        products,
        storeId: STORE_ID,
        salesChannels: ["shopify"],
      });

      const results = data.results || [];
      setCreatedProducts(results);
      setCreationProgress(100);
      setIsCreating(false);

      const successCount = results.filter((r: any) => r.status === "active" || r.status === "created_in_background").length;
      const errorCount = results.filter((r: any) => r.status === "error").length;

      if (successCount > 0) {
        toast({
          title: "🎉 Products Created",
          description: `Created ${successCount} products. ${errorCount ? `${errorCount} failed.` : ""}`,
        });
      } else {
        toast({ title: "Creation Failed", description: "Check console for details.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("Error creating products:", error);
      setIsCreating(false);
      setCreationProgress(0);
      toast({ title: "Error", description: error?.message ?? "Failed to create products", variant: "destructive" });
    }
  };

  const completedSteps = [isConnected, images.length > 0, !!selectedProduct, createdProducts.length > 0].filter(Boolean).length;
  const successCount = createdProducts.filter((r: any) => r.status === "active" || r.status === "created_in_background").length;
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

      <StepCard step={1} title="Connect Your Gelato Store" description="Enter your API credentials to enable product creation" isActive={currentStep === 1} isCompleted={isConnected}>
        {(!isConnected || currentStep === 1) && <ApiConnection onConnect={handleConnect} isConnected={isConnected} />}
      </StepCard>

      <StepCard step={2} title="Upload Your Design Files" description="Select images and configure processing options" isActive={currentStep === 2} isCompleted={images.length > 0}>
        {(currentStep === 2 || images.length > 0) && isConnected && <ImageUploader onImagesChange={handleImagesChange} processingOptions={processingOptions} onOptionsChange={setProcessingOptions} />}
      </StepCard>

      <StepCard step={3} title="Choose Example Product" description="Select a product from your catalog to use as a template" isActive={currentStep === 3} isCompleted={!!selectedProduct}>
        {(currentStep === 3 || selectedProduct) && images.length > 0 && <ProductSelector onProductSelect={handleProductSelect} selectedProduct={selectedProduct} />}
      </StepCard>

      <StepCard step={4} title="Product Creation Rules" description="Set up titles, descriptions, and tags for bulk creation" isActive={currentStep === 4} isCompleted={createdProducts.length > 0}>
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
                  <div><div className="font-medium text-foreground">{images.length}</div><div>Images Ready</div></div>
                  <div><div className="font-medium text-foreground">{(template?.variants || []).length || 0}</div><div>Product Variants</div></div>
                  <div><div className="font-medium text-foreground">{images.length * ((template?.variants || []).length || 0)}</div><div>Total Uploads</div></div>
                </div>

                {isCreating ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing and Uploading...</span>
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
                  </div>
                ) : (
                  <Button onClick={handleCreateProducts} disabled={!images.length || !selectedProduct} size="lg" className="bg-gradient-to-r from-success to-success/80 text-white">
                    <Rocket className="h-4 w-4 mr-2" /> Create {images.length} Products
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
