// =============================================================================
// RegenerateDailyPickButton — admin-only control on the AI Daily Pick card.
// - Renders nothing for non-admins.
// - Confirms via AlertDialog before invoking the edge function.
// - Disabled while in flight + 5s post-success cooldown to prevent spam.
// - Adapts copy to "Generate" (no pick yet) vs "Regenerate" (existing pick).
// =============================================================================
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAdmin } from "@/hooks/useAdmin";
import { useSport } from "@/contexts/SportContext";
import { useRegenerateDailyPick } from "@/hooks/useRegenerateDailyPick";

interface Props {
  hasExistingPick: boolean;
}

const COOLDOWN_MS = 5000;

export function RegenerateDailyPickButton({ hasExistingPick }: Props) {
  const { isAdmin } = useAdmin();
  const { sport } = useSport();
  const regenerate = useRegenerateDailyPick();
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    if (!regenerate.isSuccess) return;
    setCooldown(true);
    const t = setTimeout(() => setCooldown(false), COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [regenerate.isSuccess, regenerate.data]);

  if (!isAdmin) return null;

  const verb = hasExistingPick ? "Regenerate" : "Generate";
  const disabled = regenerate.isPending || cooldown;

  const handleConfirm = async () => {
    setOpen(false);
    await regenerate.mutateAsync().catch(() => {
      // toast handled by hook
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 px-2 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          title={`${verb} today's ${sport} pick (admin)`}
        >
          <RefreshCw
            className={`h-3 w-3 ${regenerate.isPending ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">{verb}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} today's {sport} Daily Pick?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasExistingPick
              ? `This will permanently replace the current ${sport} pick visible to all users. The deterministic picker will re-select legs from today's scored props.`
              : `This will run the deterministic picker for today's ${sport} scored props and create a new Daily Pick visible to all users.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {verb} now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
