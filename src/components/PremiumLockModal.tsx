import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";

interface PremiumLockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PremiumLockModal({ open, onOpenChange }: PremiumLockModalProps) {
  const navigate = useNavigate();

  const handleJoinWaitlist = () => {
    onOpenChange(false);
    navigate("/premium");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20">
            <Crown className="h-6 w-6 text-yellow-500" />
          </div>
          <DialogTitle className="text-center">Premium Preview</DialogTitle>
          <DialogDescription className="text-center">
            Premium features are available in early access. Payments will launch soon.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleJoinWaitlist} className="w-full">
            Join Early Access
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
