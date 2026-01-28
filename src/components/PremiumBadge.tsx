import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface PremiumBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

export function PremiumBadge({ className, size = "sm" }: PremiumBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-yellow-500/20 text-yellow-500 font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      <Lock className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Premium
    </span>
  );
}
