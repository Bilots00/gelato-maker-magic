import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Package, Plus, Loader2, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTemplate } from "@/lib/supabaseFetch";
import { useToast } from "@/components/ui/use-toast";

type Product = {
  id: string;
  name: string;
  type: string;
  variants: string[];
  printAreas: string[];
};

type ProductSelectorProps = {
  onProductSelect: (product: Product) => void;
  selectedProduct?: Product;
};

type SavedTemplate = {
  id: string;              // uuid locale
  templateId: string;      // uuid gelato
  name: string;            // come lo vedi nel dropdown
  productType?: string;
  variants?: string[];
  createdAt: number;
};

const LS_KEY = "gelato.savedTemplates";

export function ProductSelector({ onProductSelect, selectedProduct }: ProductSelectorProps) {
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showManual, setShowManual] = useState(true);   // mostra/nasconde il form manuale
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const { toast } = useToast();

  // bootstrap: carica i template salvati localmente
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(saved));
    } catch {}
  }, [saved]);

  const isGuidSelected =
    !!selectedProduct &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
      selectedProduct.id
    );

  const loadTemplateById = async (tplId: string, forcedName?: string) => {
    setIsLoading(true);
    try {
      const template = await getTemplate(tplId);
      const product: Product = {
        id: template.id,
        name: forcedName || template.title || `Template ${tplId}`,
        type: template.productType || "apparel",
        variants: (template.variants || []).map((v: any) => v.title),
        printAreas:
          template.variants?.[0]?.imagePlaceholders?.map((p: any) => p.name) ||
          template.imagePlaceholders?.map((p: any) => p.name) ||
          ["front"],
      };
      onProductSelect(product);
      toast({ title: "Template loaded", description: `Loaded: ${product.name}` });
    } catch (e: any) {
      console.error("[selector] Error loading template:", e);
      toast({
        title: "Error loading template",
        description: e?.message ?? "Failed to load template from Gelato API",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleProductLoad = async () => {
    if (!productId.trim()) return;
    await loadTemplateById(productId, productName || undefined);
    setShowManual(false);
  };

  // dropdown: selezione template salvato
  const onSelectSaved = async (val: string) => {
    if (val === "__other__") {
      setShowManual(true);
      return;
    }
    const picked = saved.find((s) => s.templateId === val);
    if (!picked) return;
    setProductId(picked.templateId);
    setProductName(picked.name);
    setShowManual(false);
    await loadTemplateById(picked.templateId, picked.name);
  };

  // salvataggio template corrente nel dropdown
  const onSaveTemplate = () => {
    if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) {
      toast({ title: "Invalid template ID", description: "Serve un UUID Gelato valido.", variant: "destructive" });
      return;
    }
    const name = productName?.trim() || "Saved Template";
    const entry: SavedTemplate = {
      id: crypto.randomUUID(),
      templateId: productId,
      name,
      createdAt: Date.now(),
    };
    setSaved((prev) => {
      // niente duplicati sullo stesso templateId
      const without = prev.filter((x) => x.templateId !== entry.templateId);
      return [entry, ...without].slice(0, 50);
    });
    toast({ title: "Template saved", description: `Saved as “${name}”.` });
    setShowManual(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Select Example Product</span>
          </CardTitle>
          <CardDescription>Pick a saved template or load a new one from Gelato</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Saved Templates dropdown */}
          <div className="space-y-2">
            <Label>Use a saved template</Label>
            <Select onValueChange={onSelectSaved}>
              <SelectTrigger>
                <SelectValue placeholder={saved.length ? "Choose a saved template…" : "No saved templates yet"} />
              </SelectTrigger>
              <SelectContent>
                {saved.map((s) => (
                  <SelectItem key={s.id} value={s.templateId}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value="__other__">Select another product…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Manual form (shown when “Select another product…”) */}
          {showManual && (
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="productId">Gelato Template ID (UUID)</Label>
                <Input
                  id="productId"
                  placeholder="e.g., 184d99bc-8fbb-40c2-a2f7-32adfc709e98"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  Find product IDs in your Gelato dashboard
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="productName">Product Name (Optional)</Label>
                <Input
                  id="productName"
                  placeholder="Custom name for this product"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button onClick={handleProductLoad} disabled={!productId.trim() || isLoading} className="w-full">
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading Template…
                    </>
                  ) : (
                    "Load Template"
                  )}
                </Button>

                <Button type="button" variant="secondary" onClick={onSaveTemplate} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  Save template
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Product */}
      {isGuidSelected && selectedProduct && (
        <Card className="border-success bg-success/5">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                <Package className="h-6 w-6 text-success" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-success">Selected Product</h3>
                <p className="text-sm text-muted-foreground mt-1">{selectedProduct.name}</p>
                <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                  <span>ID: {selectedProduct.id}</span>
                  <span>•</span>
                  <span>{selectedProduct.variants.length} variants</span>
                  <span>•</span>
                  <span>{selectedProduct.printAreas.join(", ")}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowManual(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Change
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
