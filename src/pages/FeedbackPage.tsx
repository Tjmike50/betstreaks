import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Footer } from "@/components/Footer";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@supabase/supabase-js";

const categories = [
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature Request" },
  { value: "data_issue", label: "Data Issue" },
  { value: "general", label: "General Feedback" },
];

export default function FeedbackPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ message?: string; category?: string }>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user?.email) {
        setEmail(session.user.email);
      }
    });
  }, []);

  const validateForm = (): boolean => {
    const newErrors: { message?: string; category?: string } = {};

    if (!category) {
      newErrors.category = "Please select a category";
    }

    if (!message.trim()) {
      newErrors.message = "Message is required";
    } else if (message.trim().length < 5) {
      newErrors.message = "Message must be at least 5 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.from("app_feedback").insert({
      user_id: user?.id ?? null,
      email: email.trim() || null,
      category,
      message: message.trim(),
      app_version: "v1",
    });

    setIsSubmitting(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send feedback. Please try again.",
      });
      return;
    }

    toast({
      title: "Thanks for the feedback 🙏",
      description: "We appreciate you taking the time to help us improve.",
    });

    setCategory("");
    setMessage("");
    setEmail(user?.email ?? "");
    navigate(-1);
  };

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
          <h1 className="text-xl font-bold text-foreground">Send Feedback</h1>
          <p className="text-xs text-muted-foreground">
            Help us improve BetStreaks
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger 
                    id="category"
                    className={errors.category ? "border-destructive" : ""}
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && (
                  <p className="text-xs text-destructive">{errors.category}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Tell us what's on your mind</Label>
                <Textarea
                  id="message"
                  placeholder="Describe the issue or share your idea..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className={`min-h-[120px] resize-none ${errors.message ? "border-destructive" : ""}`}
                />
                {errors.message && (
                  <p className="text-xs text-destructive">{errors.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  We'll only use this to follow up if needed
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Feedback
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
