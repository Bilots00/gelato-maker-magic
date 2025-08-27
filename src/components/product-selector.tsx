import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Package, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Product {
  id: string;
  name: string;
  type: string;
  variants: number;
  printAreas: string[];
}

interface ProductSelectorProps {
  onProductSelect: (product: Product) => void;
  selectedProduct?: Product;
}

const sampleProducts: Product[] = [
  {
    id: "gelato-tshirt-001",
    name: "Premium T-Shirt",
    type: "Apparel",
    variants: 24,
    printAreas: ["Front", "Back"]
  },
  {
    id: "gelato-mug-001", 
    name: "Ceramic Mug 11oz",
    type: "Drinkware",
    variants: 12,
    printAreas: ["Wrap Around"]
  },
  {
    id: "gelato-poster-001",
    name: "Premium Poster",
    type: "Wall Art",
    variants: 8,
    printAreas: ["Full Coverage"]
  }
];

export function ProductSelector({ onProductSelect, selectedProduct }: ProductSelectorProps) {
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSamples, setShowSamples] = useState(true);

  const handleProductLoad = async () => {
    if (!productId.trim()) return;
    
    setIsLoading(true);
    // Simulate API call to fetch product details
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockProduct: Product = {
      id: productId,
      name: productName || "Custom Product",
      type: "Custom",
      variants: 16,
      printAreas: ["Front", "Back"]
    };
    
    onProductSelect(mockProduct);
    setIsLoading(false);
  };

  const handleSampleSelect = (product: Product) => {
    onProductSelect(product);
    setShowSamples(false);
  };

  return (
    <div className="space-y-6">
      {/* Custom Product Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Select Example Product</span>
          </CardTitle>
          <CardDescription>
            Choose a product from your Gelato catalog to use as a template
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="productId">Product ID</Label>
            <Input
              id="productId"
              placeholder="e.g., gelato-product-123456"
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

          <Button 
            onClick={handleProductLoad}
            disabled={!productId.trim() || isLoading}
            className="w-full"
          >
            {isLoading ? "Loading Product..." : "Load Product"}
          </Button>
        </CardContent>
      </Card>

      {/* Sample Products */}
      {showSamples && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Start - Sample Products</CardTitle>
            <CardDescription>
              Click on any sample product to get started quickly
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sampleProducts.map((product) => (
                <Card 
                  key={product.id}
                  className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/50"
                  onClick={() => handleSampleSelect(product)}
                >
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold text-sm">{product.name}</h4>
                        <Badge variant="secondary" className="text-xs">
                          {product.type}
                        </Badge>
                      </div>
                      
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Variants:</span>
                          <span>{product.variants}</span>
                        </div>
                        <div>
                          <span>Print Areas:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {product.printAreas.map((area) => (
                              <Badge 
                                key={area} 
                                variant="outline" 
                                className="text-xs px-1 py-0"
                              >
                                {area}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selected Product Display */}
      {selectedProduct && (
        <Card className="border-success bg-success/5">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                <Package className="h-6 w-6 text-success" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-success">Selected Product</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedProduct.name}
                </p>
                <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                  <span>ID: {selectedProduct.id}</span>
                  <span>•</span>
                  <span>{selectedProduct.variants} variants</span>
                  <span>•</span>
                  <span>{selectedProduct.printAreas.join(", ")}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSamples(true)}
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