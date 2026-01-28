import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

const privacyContent = [
  {
    title: "Information We Collect",
    content: "We may collect:\n• Email address (account creation or premium waitlist)\n• User authentication identifiers\n• App usage data (saved picks, feature usage)\n\nWe do NOT collect:\n• Payment information\n• Sportsbook credentials\n• Financial data"
  },
  {
    title: "How We Use Information",
    content: "We use your information to:\n• Operate and improve the App\n• Sync watchlists across devices\n• Notify users about Premium features\n• Maintain security and reliability"
  },
  {
    title: "Data Storage",
    content: "All data is securely stored using Supabase infrastructure and protected with industry-standard security practices."
  },
  {
    title: "Data Sharing",
    content: "We do not sell or share your personal data with third parties, except where required by law."
  },
  {
    title: "Local Storage",
    content: "The App may use local storage to save preferences such as watchlists and alert states."
  },
  {
    title: "Your Rights",
    content: "You may request account deletion and removal of your data at any time."
  },
  {
    title: "Policy Changes",
    content: "We may update this Privacy Policy. Changes will be reflected within the App."
  }
];

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Privacy Policy
          </h1>
          <p className="text-xs text-muted-foreground">
            Last updated: January 2025
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            <p className="text-sm text-muted-foreground">
              Please read this Privacy Policy carefully to understand how BetStreaks handles your information.
            </p>

            {privacyContent.map((section, index) => (
              <div key={index} className="space-y-2">
                <h2 className="text-base font-semibold text-foreground">
                  {index + 1}. {section.title}
                </h2>
                <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {section.content}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
