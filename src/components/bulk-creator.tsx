import React, { useState } from "react";
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
import { bulkCreate } from "@/lib/supabaseFetch";
import { supabase } from "@/integrations/supabase/client";


interface ImageFile {
  id: string;
  file: File;
  preview: string;
  name: string;
  size: string;
}

interface Product {
  id: string;
  name: string;
  type: string;
  variants: string[];
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

async function uploadAndGetPublicUrl(file: File, destPath: string) {
  const { data, error } = await supabase
    .storage
    .from("designs")               // bucket pubblico creato al passo 1
    .upload(destPath, file, {
      upsert: true,
      contentType: file.type || "image/png",
      cacheControl: "3600",
    });

  if (error) throw error;

  const { data: pub } = supabase.storage.from("designs").getPublicUrl(data.path);
  return pub.publicUrl;            // URL pubblico pronto per Gelato
}

export function BulkCreator() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isConnected, setIsConnected] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string; storeName: string } | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [processingOptions, setProcessingOptions] = useState({
    upscale: true,
    fitMode: "stretch" as "stretch" | "preserve" | "exact"
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();
  const [rules, setRules] = useState<ProductRulesType>(defaultRules);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [createdProducts, setCreatedProducts] = useState<any[]>([]);

  const handleConnect = (creds: { apiKey: string; storeName: string }) => {
    setCredentials(creds);
    setIsConnected(true);
    setCurrentStep(2);
    toast({
      title: "Connected Successfully!",
      description: `Connected to ${creds.storeName} via Gelato API`,
    });
  };

  const handleImagesChange = (newImages: ImageFile[]) => {
    setImages(newImages);
    if (newImages.length > 0 && currentStep === 2) {
      setCurrentStep(3);
    }
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    if (currentStep === 3) {
      setCurrentStep(4);
    }
  };

  const handleSaveRules = () => {
    toast({
      title: "Rules Saved",
      description: "Product creation rules have been saved successfully",
    });
  };

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;

    setIsCreating(true);
    setCreationProgress(0);
    
    try {
      // Prepare products data for bulk creation
   // piccola guardia: assicuriamoci che il template abbia variant e printArea
if (!selectedProduct.variants?.length || !selectedProduct.printAreas?.length) {
  toast({
    title: "Template incompleto",
    description: "Il prodotto di esempio non ha varianti o print area.",
    variant: "destructive",
  });
  setIsCreating(false);
  return;
}

// carichiamo i file su Storage e usiamo l'URL pubblico
const products = await Promise.all(
  images.map(async (image, index) => {
    // titolo come prima
    let title = "";
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

    // path pulito/unique per lo Storage
    const safeName = image.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9.-]/g, "");
    const destPath = `uploads/${image.id}-${Date.now()}-${safeName}`;

    // ⬇️ UPLOAD su Supabase Storage → URL pubblico
    const publicUrl = await uploadAndGetPublicUrl(image.file, destPath);

    return {
      title,
      description: rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator",
      tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"],
      variants: [
        {
          templateVariantId: selectedProduct.variants[0],
          imagePlaceholders: [
            {
              name: selectedProduct.printAreas[0],
              fileUrl: publicUrl,          // ⬅️ URL pubblico, non più image.preview
            },
          ],
        },
      ],
    };
  })
);

      console.log('Starting bulk product creation:', products);


      const data = await bulkCreate({
      templateId: selectedProduct.id,
       publish: true, // o false, se vuoi solo creare in bozza
      products
       });

      const results = data.results;

      const successCount = results.filter((r: any) => r.status === 'active').length;
      const errorCount = results.filter((r: any) => r.status === 'error').length;

      console.log('Bulk creation results:', results);

      setCreatedProducts(results);
      setCreationProgress(100);
      setIsCreating(false);

      if (successCount > 0) {
        toast({
          title: "🎉 Products Created Successfully!",
          description: `Created ${successCount} products in your Gelato store. ${errorCount > 0 ? `${errorCount} failed.` : ''}`,
        });
      } else {
        toast({
          title: "Product Creation Failed",
          description: `Failed to create products. Check console for details.`,
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error('Error creating products:', error);
      setIsCreating(false);
      setCreationProgress(0);
      toast({
        title: "Error creating products",
        description: error instanceof Error ? error.message : 'Failed to create products',
        variant: "destructive",
      });
    }
  };

  const completedSteps = [
    isConnected,
    images.length > 0,
    selectedProduct !== undefined,
    createdProducts.length > 0
  ].filter(Boolean).length;

  return (
    <div className="space-y-8">
      {/* Progress Overview */}
      <Card className="border-primary/20 bg-gradient-to-r from-card to-muted/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Bulk Product Creation Progress</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              Step {currentStep} of 4
            </Badge>
          </div>
          <Progress value={(completedSteps / 4) * 100} className="mb-2" />
          <p className="text-sm text-muted-foreground">
            {completedSteps}/4 steps completed
          </p>
        </CardContent>
      </Card>

      {/* Step 1: Connect to Gelato */}
      <StepCard
        step={1}
        title="Connect Your Gelato Store"
        description="Enter your API credentials to enable product creation"
        isActive={currentStep === 1}
        isCompleted={isConnected}
      >
        {(!isConnected || currentStep === 1) && (
          <ApiConnection 
            onConnect={handleConnect}
            isConnected={isConnected}
          />
        )}
      </StepCard>

      {/* Step 2: Upload Images */}
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

      {/* Step 3: Select Product Template */}
      <StepCard
        step={3}
        title="Choose Example Product"
        description="Select a product from your catalog to use as a template"
        isActive={currentStep === 3}
        isCompleted={selectedProduct !== undefined}
      >
        {(currentStep === 3 || selectedProduct) && images.length > 0 && (
          <ProductSelector
            onProductSelect={handleProductSelect}
            selectedProduct={selectedProduct}
          />
        )}
      </StepCard>

      {/* Step 4: Configure Creation Rules */}
      <StepCard
        step={4}
        title="Product Creation Rules"
        description="Set up titles, descriptions, and tags for bulk creation"
        isActive={currentStep === 4}
        isCompleted={createdProducts.length > 0}
      >
        {currentStep === 4 && selectedProduct && (
          <div className="space-y-6">
            <ProductRules
              rules={rules}
              onRulesChange={setRules}
              onSave={handleSaveRules}
            />
            
            {/* Create Products Button */}
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
                    <div className="font-medium text-foreground">{selectedProduct.variants.length}</div>
                    <div>Product Variants</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{images.length * selectedProduct.variants.length}</div>
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
                ) : createdProducts.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-success">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Products Created Successfully!</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Created {createdProducts.length} products in your Gelato store
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