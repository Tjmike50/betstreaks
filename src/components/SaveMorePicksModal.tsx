import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Cloud } from "lucide-react";

interface SaveMorePicksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
}

export function SaveMorePicksModal({
  open,
  onOpenChange,
  onLogin,
}: SaveMorePicksModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Cloud className="h-6 w-6 text-primary" />
          </div>
          <AlertDialogTitle className="text-center">
            Save unlimited picks
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Log in to save unlimited picks & sync across devices.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction onClick={onLogin} className="w-full">
            Log in
          </AlertDialogAction>
          <AlertDialogCancel className="w-full mt-0">Not now</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
