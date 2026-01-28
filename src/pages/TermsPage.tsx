import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

const termsContent = [
  {
    title: "Acceptance of Terms",
    content: "By accessing or using BetStreaks (\"the App\"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App."
  },
  {
    title: "Description of Service",
    content: "BetStreaks provides sports statistics, streaks, trends, and analytical data for informational and entertainment purposes only. BetStreaks does not place bets, accept wagers, or facilitate gambling in any way."
  },
  {
    title: "Not Betting Advice",
    content: "All content provided by BetStreaks is NOT betting advice. Past performance does not guarantee future results. You are solely responsible for any decisions you make using information from the App."
  },
  {
    title: "User Responsibility",
    content: "You acknowledge that sports betting involves risk. BetStreaks is not responsible for any losses, damages, or outcomes resulting from your actions."
  },
  {
    title: "Accounts",
    content: "Some features require account creation. You are responsible for maintaining the confidentiality of your login credentials."
  },
  {
    title: "Prohibited Use",
    content: "You agree not to:\n• Use the App for illegal purposes\n• Attempt to reverse engineer, scrape, or abuse the App\n• Circumvent feature limitations or security controls"
  },
  {
    title: "Intellectual Property",
    content: "All content, design, software, and functionality are owned by BetStreaks and may not be copied, reproduced, or redistributed without permission."
  },
  {
    title: "Disclaimer of Warranties",
    content: "The App is provided \"AS IS\" without warranties of any kind. We do not guarantee accuracy, reliability, or availability."
  },
  {
    title: "Limitation of Liability",
    content: "BetStreaks shall not be liable for any direct, indirect, or consequential damages arising from the use of the App."
  },
  {
    title: "Changes to Terms",
    content: "We may update these Terms at any time. Continued use of the App constitutes acceptance of the updated Terms."
  }
];

export default function TermsPage() {
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
            Terms of Service
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
              Please read these Terms of Service carefully before using BetStreaks.
            </p>

            {termsContent.map((section, index) => (
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
