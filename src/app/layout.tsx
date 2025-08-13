import type { Metadata } from 'next';
// Removed Geist font imports
import './globals.css';
import { Toaster } from '@/components/ui/toaster'; // Import Toaster
import { cn } from '@/lib/utils'; // Import cn utility
import Script from 'next/script'; // Import Script component

export const metadata: Metadata = {
  title: 'ReturnVerify',
  description: 'Verify ecommerce returns easily',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      {/* Add Google AdSense script */}
      <Script
        async
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4831269495709966"
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
      {/* Removed font variables from body className */}
      {/* Added flex flex-col min-h-screen to body for footer positioning */}
      <body className={cn("antialiased flex flex-col min-h-screen")}>
        <div className="flex-grow"> {/* Wrap main content to push footer down */}
          {children}
        </div>
        <Toaster /> {/* Add Toaster component here */}
        {/* Simple Footer */}
        <footer className="mt-auto py-4 px-4 md:px-8 bg-muted text-muted-foreground text-center text-sm">
          <p>&copy; {new Date().getFullYear()} ReturnVerify. All rights reserved.</p>
          <p>Design by Harpalsinh Gohil</p>
        </footer>
      </body>
    </html>
  );
}
