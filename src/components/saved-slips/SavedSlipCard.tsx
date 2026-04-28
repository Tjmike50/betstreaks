import { useState } from "react";
import { Trash2, Loader2, Shield, Target, Zap, Calendar, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { AISlip } from "@/types/aiSlip";
import { parlayAmerican } from "@/lib/parlayOdds";

function getRiskBadge(risk: string) {
  switch (risk) {
    case "safe": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "balanced": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "aggressive": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "";
  }
}

function getRiskIcon(risk: string) {
  switch (risk) {
    case "safe": return Shield;
    case "aggressive": return Zap;
    default: return Target;
  }
}

interface SavedSlipCardProps {
  slip: AISlip;
  onRemove: (id: string) => void;
  onCopyToBuilder?: (slip: AISlip) => void;
}

export function SavedSlipCard({ slip, onRemove, onCopyToBuilder }: SavedSlipCardProps) {
  const [removing, setRemoving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const RiskIcon = getRiskIcon(slip.risk_label);
  const displayedOdds = parlayAmerican(slip.legs.map((leg) => leg.odds)) ?? slip.estimated_odds;

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove(slip.id);
    setRemoving(false);
  };

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <h3 className="text-base font-bold leading-tight">{slip.slip_name}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[11px] ${getRiskBadge(slip.risk_label)}`}>
                <RiskIcon className="h-3 w-3 mr-1" />
                {slip.risk_label}
              </Badge>
              {displayedOdds && (
                <span className="text-sm font-mono font-black text-primary">{displayedOdds}</span>
              )}
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={removing}
                className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-xs">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove saved slip?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove "{slip.slip_name}" from your saved slips. You can always regenerate it later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Reasoning (collapsible) */}
        {slip.reasoning && (
          <div>
            <p className={`text-xs text-muted-foreground leading-relaxed ${!expanded ? "line-clamp-2" : ""}`}>
              {slip.reasoning}
            </p>
            {slip.reasoning.length > 120 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[11px] text-primary font-medium flex items-center gap-0.5 mt-1"
              >
                {expanded ? "Show less" : "Show more"}
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>
        )}

        {/* Legs */}
        <div className="space-y-1.5">
          {slip.legs.map((leg, i) => (
            <div key={i} className="bg-secondary/50 border border-border/20 rounded-lg px-3 py-2 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {leg.team_abbr && (
                    <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                      {leg.team_abbr}
                    </span>
                  )}
                  <span className="text-sm font-semibold truncate">{leg.player_name}</span>
                </div>
                {leg.odds && (
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">{leg.odds}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-primary font-medium">
                  {leg.pick && <span className="font-bold mr-1">{leg.pick}</span>}
                  {leg.line} {leg.stat_type}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Saved {new Date(slip.created_at).toLocaleDateString()}</span>
            <span>•</span>
            <span>{slip.legs.length} legs</span>
          </div>
          {onCopyToBuilder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-primary gap-1"
              onClick={() => onCopyToBuilder(slip)}
            >
              <Copy className="h-3 w-3" />
              Reuse
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
