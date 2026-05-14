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
  titleMode: "filename", 
  titleMaxWords: 8,
  titleCustomText: "",
  descriptionMode: "copy", 
  descriptionParagraphs: 2,
  descriptionSentences: 3,
  descriptionCustomHTML: "",
  tagsMode: "copy", 
  tagsMaxCount: 10,
  tagsCustom: [],
  includeCustomTitle: false,
  includeCustomDescription: false,
};

const isUuid = (s?: string) =>
  !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

// ==========================================
// HELPER PER RAGGRUPPAMENTO (SMART GROUPING)
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
// MOTORE DI UPLOAD MULTIPART (Bypassa limiti rete e crasch Cloudflare)
// ==========================================
async function uploadOriginalFile(file: File, exactFileName: string) {
  const BASE_URL = "https://gelato-backend.andrea-bilotta00.workers.dev";
  const CHUNK_SIZE = 10 * 1024 * 1024; // Fette da 10MB per aggirare il blocco 413
  
  // 1. Inizializza
  const startRes = await fetch(`${BASE_URL}/upload-start?filename=${encodeURIComponent(exactFileName)}`, { method: "POST" });
  if (!startRes.ok) throw new Error("Errore inizializzazione sul server");
  const { uploadId, key } = await startRes.json();

  const parts = [];
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 2. Invia Fette
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    // file.slice() legge solo quel frammento dal disco: Zero RAM sprecata!
    const chunk = file.slice(start, end);
    const partNumber = i + 1;

    const partRes = await fetch(`${BASE_URL}/upload-part?uploadId=${uploadId}&key=${encodeURIComponent(key)}&partNumber=${partNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk
    });

    if (!partRes.ok) throw new Error(`Upload parte ${partNumber}/${totalChunks} fallito (Rete interrotta)`);
    const partData = await partRes.json();
    parts.push(partData);
  }

  // 3. Completa e Incolla su R2
  const completeRes = await fetch(`${BASE_URL}/upload-complete?uploadId=${uploadId}&key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts })
  });

  if (!completeRes.ok) throw new Error("Errore durante l'assemblaggio finale dell'immagine");
  const finalData = await completeRes.json();
  return finalData.url; 
}


// ---------- COMPONENTE PRINCIPALE ----------
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
    try {
      localStorage.setItem("gelato.creds", JSON.stringify(creds));
    } catch {}
    toast({ title: "Connected Successfully!", description: `Connected to ${creds.storeName} via Gelato API` });
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

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    if (!isUuid(selectedProduct.id)) {
      toast({
        title: "Invalid template",
        description: "Carica un VERO Template ID Gelato (UUID)",
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
        toast({ title: "Template ID mancante", variant: "destructive" });
        return;
      }

      // 1. OTTENGO IL TEMPLATE
      const tplRes = await fetch(`https://gelato-backend.andrea-bilotta00.workers.dev/gelato-get-template?templateId=${chosenTemplateId}`);
      if (!tplRes.ok) throw new Error("Errore nel download del Template da Gelato");
      const tpl = await tplRes.json();
      setTemplate(tpl);

      const tplVariants: any[] = tpl?.variants ?? [];
      if (!tplVariants.length) {
        toast({ title: "Template error", description: "Nessuna variante trovata nel template.", variant: "destructive" });
        setIsCreating(false);
        return;
      }

      // 2. RAGGRUPPAMENTO SMART 
      const groupedProducts: Record<string, Record<string, ImageFile>> = {};
      
      for (const img of images) {
        const baseTitle = getCleanBaseTitle(img.name);
        const ratioTag = getFileRatioTag(img.name);
        if (!groupedProducts[baseTitle]) groupedProducts[baseTitle] = {};
        groupedProducts[baseTitle][ratioTag] = img;
      }

      // 3. UPLOAD SEQUENZIALE E CREAZIONE
      const products = [];
      let processedGroups = 0;
      const totalGroups = Object.keys(groupedProducts).length;

      for (const [baseTitle, fileMap] of Object.entries(groupedProducts)) {
        
        let title: string;
        if (rules.titleMode === "filename") {
          title = baseTitle;
        } else if (rules.titleMode === "ai-simple") {
          title = `AI Generated Title ${processedGroups + 1}`;
        } else {
          title = `Custom Product ${processedGroups + 1}`;
        }
        if (rules.includeCustomTitle && rules.titleCustomText) {
          title += ` ${rules.titleCustomText}`;
        }

        const uploadedUrls: Record<string, string> = {};
        
        // ASPETTA IL CARICAMENTO COMPLETO DI OGNI FILE
        for (const [ratioTag, imageObj] of Object.entries(fileMap)) {
           let exactFileName = `${baseTitle}.jpg`; 
           if (ratioTag === '3x4') exactFileName = `${baseTitle} (3x4).jpg`;
           if (ratioTag === '5x7') exactFileName = `${baseTitle} ISO (5x7).jpg`;

           // Avvia l'Upload "A Fette" invulnerabile ai drop di connessione
           const publicUrl = await uploadOriginalFile(imageObj.file, exactFileName);
           uploadedUrls[ratioTag] = publicUrl;
        }

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
          tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"],
          variants: variantsPayload,
        });

        processedGroups++;
        setCreationProgress((processedGroups / totalGroups) * 50); 
      }

      // 4. SOLO DOPO L'UPLOAD: CHIAMATA DIRETTA AL WORKER PER IL BULK CREATE
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

      if (!createRes.ok) throw new Error("Errore durante la creazione dei prodotti in Gelato");
      
      const data = await createRes.json();
      const results = data.results || [];
      setCreatedProducts(results);
      setCreationProgress(100);
      setIsCreating(false);

      const successCount = results.filter((r: any) => r.status === "active" || r.status === "created_in_background").length;
      const errorCount = results.filter((r: any) => r.status === "error").length;

      if (successCount > 0) {
        toast({
          title: "🎉 Prodotti Creati",
          description: `Creati ${successCount} prodotti con successo. ${errorCount ? `${errorCount} falliti.` : ""}`,
        });
      } else {
        toast({
          title: "Creazione Fallita",
          description: "La creazione su Gelato è fallita. Guarda la console per dettagli.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Errore irreversibile:", error);
      setIsCreating(false);
      setCreationProgress(0);
      toast({
        title: "Errore Rete/Upload",
        description: error?.message ?? "Operazione fallita",
        variant: "destructive",
      });
    }
  };

  const totalGroupsCalculated = Object.keys(images.reduce((acc: any, img) => {
    acc[getCleanBaseTitle(img.name)] = true;
    return acc;
  }, {})).length;

  const completedSteps = [isConnected, images.length > 0, !!selectedProduct, createdProducts.length > 0].filter(Boolean).length;
  const successCount = createdProducts.filter((r: any) => r.status === "active").length;
  const hasSuccess = successCount > 0;

  return (
    <div className="space-y-8">
      <Card className="border-primary/20 bg-gradient-to-r from-card to-muted/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Stato Avanzamento Creazione</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              Step {currentStep} di 4
            </Badge>
          </div>
          <Progress value={(completedSteps / 4) * 100} className="mb-2" />
          <p className="text-sm text-muted-foreground">{completedSteps}/4 step completati</p>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <StepCard
        step={1}
        title="Connetti lo Store Gelato"
        description="Inserisci le credenziali API"
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
        title="Carica le Immagini Originali"
        description="Nessuna compressione. Caricamento file giganteschi senza limiti via Chunking (pezzetti da 10MB)."
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
        title="Scegli Template"
        description="Carica il Template ID di Gelato (UUID)"
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
        title="Creazione Definitiva Prodotti"
        description="Lancio del processo (Upload Multipart -> Generazione su Gelato)"
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
                  <h3 className="text-lg font-semibold">Pronto per Creare i Prodotti</h3>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground mb-6">
                  <div>
                    <div className="font-medium text-foreground">{images.length}</div>
                    <div>File Pronti all'Upload</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{(template?.variants || []).length || 0}</div>
                    <div>Varianti Gelato Trovate</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      {totalGroupsCalculated}
                    </div>
                    <div>Prodotti Singoli Finiti</div>
                  </div>
                </div>

                {isCreating ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Caricamento a blocchi e Creazione in corso...</span>
                    </div>
                    <Progress value={creationProgress} />
                    <p className="text-sm text-muted-foreground">{Math.round(creationProgress)}% completato</p>
                  </div>
                ) : hasSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-success">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Prodotti Creati con Successo!</span>
                    </div>
                    <div className="text-sm text-muted-foreground">Trovati {successCount} prodotti nel tuo Store Gelato.</div>
                  </div>
                ) : (
                  <Button
                    onClick={handleCreateProducts}
                    disabled={!images.length || !selectedProduct}
                    size="lg"
                    className="bg-gradient-to-r from-success to-success/80 hover:opacity-90 text-white"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Upload Estremo e Crea {totalGroupsCalculated} Prodotti
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
