"use client";

import { useEffect, useRef } from 'react';
import { Card } from './ui/card';

declare global {
  interface Window {
    adsbygoogle: any;
  }
}

const AdBanner = () => {
  const adRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if the ad container has any child elements added by AdSense
    if (adRef.current && adRef.current.children.length === 0) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        console.error("AdSense error:", err);
      }
    }
  }, []);

  // You can get your ad-client and ad-slot from your AdSense account
  // For development, AdSense will show a placeholder. For production, you must use your real IDs.
  const adClient = "ca-pub-4831269495709966"; // REPLACE WITH YOUR AD CLIENT ID
  const adSlot = "5152022156";             // REPLACE WITH YOUR AD SLOT ID

  // In a real app, you might not want to show a placeholder if AdSense fails,
  // but for this example, we show a card.
  return (
    <Card ref={adRef} className="w-[728px] h-[90px] flex justify-center items-center bg-muted/50">
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
