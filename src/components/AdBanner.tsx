"use client";

import { useEffect } from 'react';
import { Card } from './ui/card';

declare global {
  interface Window {
    adsbygoogle: any;
  }
}

const AdBanner = () => {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error("AdSense error:", err);
    }
  }, []);

  // You can get your ad-client and ad-slot from your AdSense account
  // For development, AdSense will show a placeholder. For production, you must use your real IDs.
  const adClient = "ca-pub-xxxxxxxxxxxxxxxx"; // REPLACE WITH YOUR AD CLIENT ID
  const adSlot = "xxxxxxxxxx";             // REPLACE WITH YOUR AD SLOT ID

  // In a real app, you might not want to show a placeholder if AdSense fails,
  // but for this example, we show a card.
  return (
    <Card className="w-[728px] h-[90px] flex justify-center items-center bg-muted/50">
      <ins
        className="adsbygoogle"
        style={{ display: 'inline-block', width: '728px', height: '90px' }}
        data-ad-client={adClient}
        data-ad-slot={adSlot}
      ></ins>
       {/* Fallback content in case the ad doesn't load */}
      <p className="text-muted-foreground">Advertisement - 728x90</p>
    </Card>
  );
};

export default AdBanner;
