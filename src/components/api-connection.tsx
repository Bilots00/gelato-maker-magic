import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, ExternalLink } from "lucide-react";

interface ApiConnectionProps {
  onConnect: (credentials: { apiKey: string; storeName: string }) => void;
  isConnected: boolean;
}

export function ApiConnection({ onConnect, isConnected }: ApiConnectionProps) {
  const [apiKey, setApiKey] = useState("");
  const [storeName, setStoreName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    if (!apiKey.trim() || !storeName.trim()) return;
    
    setIsConnecting(true);
    // Simulate API connection delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    onConnect({ apiKey: apiKey.trim(), storeName: storeName.trim() });
    setIsConnecting(false);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--gelato-orange))] to-[hsl(var(--gelato-blue))]">
          <span className="text-2xl font-bold text-white">G</span>
        </div>
        <CardTitle className="text-xl">Connect to Gelato</CardTitle>
        <CardDescription>
          Enter your Gelato API credentials to start automating product creation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center space-x-2 text-success">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Connected Successfully</span>
            </div>
            <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
              {storeName}
            </Badge>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">Gelato API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your Gelato API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Find your API key in your Gelato dashboard
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="storeName">Store Name</Label>
              <Input
                id="storeName"
                placeholder="Your store name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </div>

            <Button 
              onClick={handleConnect}
              disabled={!apiKey.trim() || !storeName.trim() || isConnecting}
              className="w-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--primary-glow))] hover:opacity-90 transition-opacity"
            >
              {isConnecting ? "Connecting..." : "Connect Store"}
            </Button>

            <div className="flex items-start space-x-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Secure Connection</p>
                <p>Your API credentials are encrypted and never stored on our servers.</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}