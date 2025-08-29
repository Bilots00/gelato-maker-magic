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

interface Product {
  id: string;
  name: string;
  type: string;
  variants: string[];
  printAreas: string[];
}

interface ProductSelectorProps {
  onProductSelect: (product: Product) => void;
  selectedProduct?: Product;
}

type SavedTpl = { id: string; name: string; savedAt: number };

const LS_KEY = "gelatoSavedTemplates";

function readSaved(): SavedTpl[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

function writeSaved(list: SavedTpl[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 50))); // tieni gli ultimi 50
}

export function ProductSelector({ onProductSelect, selectedProduct }: ProductSelectorProps) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<SavedTpl[]>(() => readSaved());

  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"pick" | "manual">("pick"); // pick = dropdown, manual = input

  useEffect(() => {
    setSaved(readSaved());
  }, []);

  const isGuidSelected =
    !!selectedProduct &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      selectedProduct.id
    );

  const handleLoadById = async (tplId: string, nameHint?: string) => {
    if (!tplId) return;
    setIsLoading(true);
    try {
      const template = await getTemplate(tplId);

      const product: Product = {
        id: template.id,
        name: template.title || nameHint || `Template ${tplId}`,
        type: template.productType || "product",
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

  const onPickChange = async (value: string) => {
    if (value === "__manual__") {
      setMode("manual");
      return;
    }
    // value = templateId
    const item = saved.find((s) => s.id === value);
    await handleLoadById(value, item?.name);
  };

  const onSaveTemplate = () => {
    if (!productId || !/^[0-9a-fA-F-]{36}$/.test(productId)) {
      toast({
        title: "Invalid template ID",
        description: "Inserisci un vero Template ID (UUID).",
        variant: "destructive",
      });
      return;
    }
    const name = productName?.trim() || `Template ${productId.slice(0, 8)}`;
    const next: SavedTpl[] = [
      { id: productId, name, savedAt: Date.now() },
      ...saved.filter((s) => s.id !== productId),
    ];
    setSaved(next);
    writeSaved(next);
    toast({ title: "Template saved", description: `${name} salvato nei preferiti` });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Select Example Product</span>
          </CardTitle>
          <CardDescription>
            Pick a previously saved template or add a new one
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Dropdown dei template salvati */}
          <div className="space-y-2">
            <Label>Saved templates</Label>
            <Select onValueChange={onPickChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={saved.length ? "Choose a template…" : "No saved templates yet"} />
              </SelectTrigger>
              <SelectContent>
                {saved.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {s.id}
                  </SelectItem>
                ))}
                <SelectItem value="__manual__">Select another product…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Modalità MANUAL: inserisci nuovo UUID + Salva + Carica */}
          {mode === "manual" && (
            <div className="space-y-4 border rounded-md p-4">
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
                <Label htmlFor="productName">Product Name (to save)</Label>
                <Input
                  id="productName"
                  placeholder="Custom name for this product"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  onClick={onSaveTemplate}
                  className="w-full"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save template
                </Button>

                <Button
                  onClick={() => handleLoadById(productId, productName)}
                  disabled={!productId.trim() || isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading Template…
                    </>
                  ) : (
                    "Load Template"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Product Display */}
      {isGuidSelected && (
        <Card className="border-success bg-success/5">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                <Package className="h-6 w-6 text-success" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-success">Selected Product</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedProduct?.name}
                </p>
                <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                  <span>ID: {selectedProduct?.id}</span>
                  <span>•</span>
                  <span>{selectedProduct?.variants.length} variants</span>
                  <span>•</span>
                  <span>{selectedProduct?.printAreas.join(", ")}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode("pick")}
              >
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
