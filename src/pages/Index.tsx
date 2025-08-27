import React from "react";
import { BulkCreator } from "@/components/bulk-creator";
import heroImage from "@/assets/gelato-hero.jpg";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 animated-gradient opacity-10" />
        <div className="relative container mx-auto px-4 py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="space-y-4">
                <h1 className="text-4xl lg:text-6xl font-bold leading-tight">
                  <span className="gradient-text">Automate</span> Your{" "}
                  <br />
                  Gelato Product Creation
                </h1>
                <p className="text-xl text-muted-foreground max-w-lg">
                  Upload your designs, set your rules, and watch as we automatically create 
                  hundreds of products in your Gelato store with perfect sizing and placement.
                </p>
              </div>
              
              <div className="flex items-center space-x-6 text-sm text-muted-foreground">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-success rounded-full" />
                  <span>Bulk Upload</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-gelato-orange rounded-full" />
                  <span>Smart Resizing</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-primary rounded-full" />
                  <span>AI Generation</span>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-gelato-blue/20 rounded-3xl blur-3xl" />
              <img
                src={heroImage}
                alt="Gelato Bulk Product Creator"
                className="relative w-full h-auto rounded-2xl shadow-2xl float"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">
            Get Started in 4 Simple Steps
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our streamlined process makes it easy to transform your design files 
            into a complete product catalog on Gelato.
          </p>
        </div>
        
        <BulkCreator />
      </section>
    </div>
  );
};

export default Index;
