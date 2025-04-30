import type { Metadata } from 'next';
// Removed Geist font imports
import './globals.css';
import { Toaster } from '@/components/ui/toaster'; // Import Toaster

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
    <html lang="en">
      {/* Removed font variables from body className */}
      <body className={`antialiased`}>
        {children}
        <Toaster /> {/* Add Toaster component here */}
      </body>
    </html>
  );
}
