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

const STORE_ID = import.meta.env.VITE_GELATO_STORE_ID as string | undefined;

type ImageFile = { id: string; file: File; preview: string; name: string; size: string; };
type Product = { id: string; name: string; type: string; variants: string[]; printAreas: string[]; };
type ProductRulesType = {
  titleMode: "filename" | "ai-simple" | "ai-compound"; titleMaxWords: number; titleCustomText: string;
  descriptionMode: "copy" | "ai"; descriptionParagraphs: number; descriptionSentences: number; descriptionCustomHTML: string;
  tagsMode: "copy" | "ai"; tagsMaxCount: number; tagsCustom: string[]; includeCustomTitle: boolean; includeCustomDescription: boolean;
};

const defaultRules: ProductRulesType = {
  titleMode: "filename", titleMaxWords: 8, titleCustomText: "",
  descriptionMode: "copy", descriptionParagraphs: 2, descriptionSentences: 3, descriptionCustomHTML: "",
  tagsMode: "copy", tagsMaxCount: 10, tagsCustom: [], includeCustomTitle: false, includeCustomDescription: false,
};

const isUuid = (s?: string) => !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

// ==========================================
// FUNZIONI HELPER: SMART GROUPING
// ==========================================
function getFileRatioTag(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('(3x4)') || lower.includes('3x4')) return '3x4';
  if (lower.includes('(5x7)') || lower.includes('5x7') || lower.includes('iso')) return '5x7';
  if (lower.includes('(1x1)') || lower.includes('1x1')) return '1x1';
  return 'default';
}

function getCleanBaseTitle(filename: string): string {
  let base = filename.replace(/\.[^/.]+$/, ""); 
  base = base.replace(/\s*(?:\bISO\b)?\s*\([^)]*\)/i, '').trim(); 
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function getVariantRatioTag(variantTitle: string): string {
  const lower = (variantTitle || "").toLowerCase();
  if (lower.includes('30x40') || lower.includes('40x30') || lower.includes('60x45') || lower.includes('75x100')) return '3x4';
  if (lower.includes('50x70') || lower.includes('70x50') || lower.includes('100x140') || lower.includes('140x100')) return '5x7';
  if (lower.includes('30x30') || lower.includes('50x50') || lower.includes('100x100') || lower.includes('70x70')) return '1x1';
  return 'default';
}

// ==========================================
// FUNZIONI HELPER: SMART OPTIMIZER (Anti-Crash Cloudflare)
// ==========================================
async function fileToImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = (e) => rej(e);
  });
  return { img, url };
}

// Se il file è enorme (es 107MB) lo ottimizziamo tenendo la risoluzione PIXEL intatta
async function smartOptimizeImage(file: File): Promise<File> {
  // Se pesa < 50MB, Cloudflare non lo blocca. Lasciamolo PURO.
  if (file.size < 50 * 1024 * 1024) return file;

  const { img, url } = await fileToImage(file);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  
  // Cap di sicurezza (Pixel massimi) per non far crashare la RAM di Chrome, ma qualità stampa perfetta
  const MAX_DIM = 9000;
  if (w > MAX_DIM || h > MAX_DIM) {
      const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        URL.revokeObjectURL(url);
        canvas.width = 0; canvas.height = 0;
        if (!blob) reject(new DOMException("Canvas failed", "EncodingError"));
        else resolve(new File([blob], file.name, { type: "image/jpeg" })); // Esporta come JPEG Fine Art HQ
      },
      "image/jpeg",
      0.96 
    );
  });
}

async function uploadAndGetPublicUrl(input: File, exactFileName: string) {
  const uploadRes = await fetch(`https://gelato-backend.andrea-bilotta00.workers.dev/upload?filename=${encodeURIComponent(exactFileName)}`, {
    method: "POST",
    headers: { "Content-Type": input.type || "image/jpeg" },
    body: input // Byte diretti, ma ora sicuri sotto i 100MB di limite
  });

  if (!uploadRes.ok) throw new Error("Errore durante il caricamento dell'immagine su Cloudflare R2");
  const data = await uploadRes.json();
  return data.url; 
}

// ---------- componente ----------
export function BulkCreator() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isConnected, setIsConnected] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string; storeName: string } | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [processingOptions, setProcessingOptions] = useState({ upscale: true, fitMode: "stretch" as "stretch" | "preserve" | "exact" });
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();
  const [rules, setRules] = useState<ProductRulesType>(defaultRules);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [createdProducts, setCreatedProducts] = useState<any[]>([]);
  const [template, setTemplate] = useState<any | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gelato.creds");
      if (raw) { setCredentials(JSON.parse(raw)); setIsConnected(true); setCurrentStep(2); }
    } catch {}
  }, []);

  const handleConnect = (creds: { apiKey: string; storeName: string }) => {
    setCredentials(creds); setIsConnected(true); setCurrentStep(2);
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

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    if (!isUuid(selectedProduct.id)) {
      toast({ title: "Invalid template", description: "Carica un Template ID Gelato (UUID)", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    setCreationProgress(0);

    try {
      const FALLBACK_TEMPLATE_ID = import.meta.env.VITE_GELATO_TEMPLATE_ID as string | undefined;
      const chosenTemplateId = (isUuid(selectedProduct.id) ? selectedProduct.id : undefined) || FALLBACK_TEMPLATE_ID;

      if (!chosenTemplateId) {
        setIsCreating(false); toast({ title: "Template ID mancante", variant: "destructive" }); return;
      }

      // DOWNLOAD TEMPLATE
      const tplRes = await fetch(`https://gelato-backend.andrea-bilotta00.workers.dev/gelato-get-template?templateId=${chosenTemplateId}`);
      if (!tplRes.ok) throw new Error("Errore nel download del Template da Gelato");
      const tpl = await tplRes.json();
      setTemplate(tpl);

      const tplVariants: any[] = tpl?.variants ?? [];
      if (!tplVariants.length) {
        toast({ title: "Template error", description: "Nessuna variante trovata.", variant: "destructive" });
        setIsCreating(false); return;
      }

      // FASE 1: SMART GROUPING
      const groupedProducts: Record<string, Record<string, File>> = {};
      for (const img of images) {
        const baseTitle = getCleanBaseTitle(img.name);
        const ratioTag = getFileRatioTag(img.name);
        if (!groupedProducts[baseTitle]) groupedProducts[baseTitle] = {};
        groupedProducts[baseTitle][ratioTag] = img.file;
      }

      // FASE 2: PROCESSO SEQUENZIALE
      const products = [];
      let processedGroups = 0;
      const totalGroups = Object.keys(groupedProducts).length;

      for (const [baseTitle, fileMap] of Object.entries(groupedProducts)) {
        let title: string = rules.titleMode === "filename" ? baseTitle : `Custom Product ${processedGroups + 1}`;
        if (rules.includeCustomTitle && rules.titleCustomText) title += ` ${rules.titleCustomText}`;

        // UPLOAD A R2
        const uploadedUrls: Record<string, string> = {};
        for (const [ratioTag, rawFile] of Object.entries(fileMap)) {
           let exactFileName = `${baseTitle}.jpg`; 
           if (ratioTag === '3x4') exactFileName = `${baseTitle} (3x4).jpg`;
           if (ratioTag === '5x7') exactFileName = `${baseTitle} ISO (5x7).jpg`;

           // Anti-Crash Cloudflare (Limita peso MB, conserva Pixel)
           const fileToUpload = await smartOptimizeImage(rawFile);
           
           const publicUrl = await uploadAndGetPublicUrl(fileToUpload, exactFileName);
           uploadedUrls[ratioTag] = publicUrl;
        }

        // COSTRUISCI VARIANTI E ASSEGNA FOTO ESATTA
        const variantsPayload = [];
        for (const v of tplVariants) {
          const placeholderName = v?.imagePlaceholders?.[0]?.name || tpl?.imagePlaceholders?.[0]?.name || "front";
          const variantRatio = getVariantRatioTag(v.title);
          
          const matchedUrl = uploadedUrls[variantRatio] || uploadedUrls['default'] || Object.values(uploadedUrls)[0];

          variantsPayload.push({
            templateVariantId: v.id,
            imagePlaceholders: [{ name: placeholderName, fileUrl: matchedUrl }],
          });
        }

        products.push({
          title,
          description: rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator",
          tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato"],
          variants: variantsPayload,
        });

        processedGroups++;
        setCreationProgress((processedGroups / totalGroups) * 50); 
      }

      // FASE 3: CHIAMATA BULK CREATE (Cloudflare Worker)
      const createRes = await fetch("https://gelato-backend.andrea-bilotta00.workers.dev/gelato-bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: tpl.id,
          publish: true,
          products,
          storeId: STORE_ID,
          salesChannels: ["shopify"],
        })
      });

      if (!createRes.ok) throw new Error("Errore durante la creazione dei prodotti via Cloudflare");
      
      const data = await createRes.json();
      const results = data.results || [];
      setCreatedProducts(results);
      setCreationProgress(100);
      setIsCreating(false);

      const successCount = results.filter((r: any) => r.status === "active" || r.status === "created_in_background").length;
      if (successCount > 0) {
        toast({ title: "🎉 Products Created", description: `Created ${successCount} grouped products.` });
      } else {
        toast({ title: "Product Creation Failed", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("Error creating products:", error);
      setIsCreating(false); setCreationProgress(0);
      toast({ title: "Error creating products", description: error?.message, variant: "destructive" });
    }
  };

  const totalGroupsCalculated = Object.keys(images.reduce((acc: any, img) => { acc[getCleanBaseTitle(img.name)] = true; return acc; }, {})).length;
  const completedSteps = [isConnected, images.length > 0, !!selectedProduct, createdProducts.length > 0].filter(Boolean).length;
  const hasSuccess = createdProducts.filter((r: any) => r.status === "active").length > 0;

  return (
    <div className="space-y-8">
      <Card className="border-primary/20 bg-gradient-to-r from-card to-muted/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Bulk Product Creation Progress</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary">Step {currentStep} of 4</Badge>
          </div>
          <Progress value={(completedSteps / 4) * 100} className="mb-2" />
          <p className="text-sm text-muted-foreground">{completedSteps}/4 steps completed</p>
        </CardContent>
      </Card>

      <StepCard step={1} title="Connect Your Gelato Store" description="Enter your API credentials" isActive={currentStep === 1} isCompleted={isConnected}>
        {(!isConnected || currentStep === 1) && <ApiConnection onConnect={handleConnect} isConnected={isConnected} />}
      </StepCard>

      <StepCard step={2} title="Upload Your Design Files" description="Select images (3x4 and 5x7 formats automatically grouped)" isActive={currentStep === 2} isCompleted={images.length > 0}>
        {(currentStep === 2 || images.length > 0) && isConnected && (
          <ImageUploader onImagesChange={handleImagesChange} processingOptions={processingOptions} onOptionsChange={setProcessingOptions} />
        )}
      </StepCard>

      <StepCard step={3} title="Choose Example Product" description="Select a product from your catalog to use as a template" isActive={currentStep === 3} isCompleted={!!selectedProduct}>
        {(currentStep === 3 || selectedProduct) && images.length > 0 && (
          <ProductSelector onProductSelect={handleProductSelect} selectedProduct={selectedProduct} />
        )}
      </StepCard>

      <StepCard step={4} title="Product Creation Rules" description="Set up titles, descriptions, and tags for bulk creation" isActive={currentStep === 4} isCompleted={createdProducts.length > 0}>
        {currentStep === 4 && selectedProduct && (
          <div className="space-y-6">
            <ProductRules rules={rules} onRulesChange={setRules} onSave={() => {}} />
            <Card className="border-success/20 bg-success/5">
              <CardContent className="p-6 text-center space-y-4">
                <div className="flex items-center justify-center space-x-2 mb-4">
                  <Package className="h-6 w-6 text-success" />
                  <h3 className="text-lg font-semibold">Ready to Create Smart Products</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground mb-6">
                  <div><div className="font-medium text-foreground">{images.length}</div><div>Files Uploaded</div></div>
                  <div><div className="font-medium text-foreground">{(template?.variants || []).length || 0}</div><div>Product Variants</div></div>
                  <div><div className="font-medium text-foreground">{totalGroupsCalculated}</div><div>Unique Products to Create</div></div>
                </div>

                {isCreating ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2"><Loader2 className="h-4 w-4 animate-spin" /><span>Processing files and creating products...</span></div>
                    <Progress value={creationProgress} />
                  </div>
                ) : hasSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-success"><CheckCircle className="h-5 w-5" /><span className="font-medium">Products Created Successfully!</span></div>
                  </div>
                ) : (
                  <Button onClick={handleCreateProducts} disabled={!images.length || !selectedProduct} size="lg" className="bg-gradient-to-r from-success to-success/80 hover:opacity-90 text-white">
                    <Rocket className="h-4 w-4 mr-2" /> Create {totalGroupsCalculated} Grouped Products
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
