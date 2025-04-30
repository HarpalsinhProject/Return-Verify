import ReturnVerification from "@/components/ReturnVerification";

export default function Home() {
  return (
    // Changed structure for better layout control
    <main className="min-h-screen bg-background p-4 md:p-8">
      <ReturnVerification />
    </main>
  );
}
