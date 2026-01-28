import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { User, LogIn, Star, RefreshCw, Infinity } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function AccountPage() {
  const [showLoginPanel, setShowLoginPanel] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border">
        <h1 className="text-2xl font-bold text-foreground">
          👤 Account
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account
        </p>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mx-auto">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold text-foreground">
                Not logged in
              </h2>
              <p className="text-sm text-muted-foreground">
                Log in to unlock all features
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 text-primary shrink-0" />
                <span>Sync watchlist across devices</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Infinity className="h-4 w-4 text-primary shrink-0" />
                <span>Unlimited saved picks</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Star className="h-4 w-4 text-primary shrink-0" />
                <span>Personalized recommendations</span>
              </div>
            </div>

            <Button 
              className="w-full mt-4" 
              size="lg"
              onClick={() => setShowLoginPanel(true)}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Log in
            </Button>
          </CardContent>
        </Card>
      </main>

      <Footer />

      <Dialog open={showLoginPanel} onOpenChange={setShowLoginPanel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Coming Soon</DialogTitle>
            <DialogDescription className="pt-2">
              Login coming next. This will sync your watchlist across devices and unlock unlimited saves.
            </DialogDescription>
          </DialogHeader>
          <Button 
            variant="outline" 
            className="w-full mt-2"
            onClick={() => setShowLoginPanel(false)}
          >
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
