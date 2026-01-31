import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Crown, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PremiumLockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PremiumLockModal({ open, onOpenChange }: PremiumLockModalProps) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }

    if (email.trim().length > 255) {
      setError("Email must be less than 255 characters");
      return;
    }

    setIsSubmitting(true);

    try {
      // Get current user if authenticated
      const { data: { user } } = await supabase.auth.getUser();

      const { error: insertError } = await supabase
        .from("premium_waitlist")
        .insert({
          email: email.trim().toLowerCase(),
          user_id: user?.id ?? null,
          source: "app_modal",
        });

      if (insertError) {
        // Check for duplicate email
        if (insertError.code === "23505") {
          setIsSuccess(true);
          localStorage.setItem("joined_waitlist", "true");
        } else {
          throw insertError;
        }
      } else {
        setIsSuccess(true);
        localStorage.setItem("joined_waitlist", "true");
      }
    } catch (err) {
      console.error("Waitlist signup error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after modal closes
    setTimeout(() => {
      setEmail("");
      setIsSuccess(false);
      setError(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20">
            {isSuccess ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <Crown className="h-6 w-6 text-yellow-500" />
            )}
          </div>
          <DialogTitle className="text-center">
            {isSuccess ? "You're on the list" : "Get Early Access"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isSuccess
              ? "Premium is launching soon."
              : "Join the early access list to be notified when Premium launches and new features go live."}
          </DialogDescription>
        </DialogHeader>

        {isSuccess ? (
          <DialogFooter className="sm:justify-center pt-2">
            <Button onClick={handleClose} className="w-full sm:w-auto">
              Got it
            </Button>
          </DialogFooter>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                className="w-full"
                autoComplete="email"
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Joining...
                  </>
                ) : (
                  "Join Early Access"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                className="w-full"
                disabled={isSubmitting}
              >
                Not now
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
