import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefreshStatus } from "@/hooks/useRefreshStatus";
import { cn } from "@/lib/utils";

interface DataFreshnessIndicatorProps {
  className?: string;
}

export function DataFreshnessIndicator({ className }: DataFreshnessIndicatorProps) {
  const { isStale, formattedTime, isLoading, refetch, lastRun } = useRefreshStatus();

  if (isLoading) {
    return null; // Don't show loading state, just hide until ready
  }

  // No data available
  if (!lastRun) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Clock className="h-3 w-3" />
        <span>Update status unavailable</span>
      </div>
    );
  }

  // Data is stale (>24h old) - show warning banner
  if (isStale) {
    return (
      <div className={cn(
        "bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3",
        className
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-500">Data may be delayed</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last update: {formattedTime}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetch}
            className="text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10 h-8 px-2"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Data is fresh - show subtle indicator
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Clock className="h-3 w-3" />
      <span>{formattedTime}</span>
    </div>
  );
}
