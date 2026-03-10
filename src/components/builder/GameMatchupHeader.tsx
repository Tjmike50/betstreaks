import { resolveTeamAbbr, getTeamMeta } from "@/lib/nbaTeamMeta";
import type { AISlipLeg } from "@/types/aiSlip";

/** Team pill with color accent */
function TeamPill({ abbr, isSelected }: { abbr: string; isSelected: boolean }) {
  const meta = getTeamMeta(abbr);
  if (!meta) return null;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all ${
      isSelected 
        ? "ring-1 ring-primary/40 bg-primary/5" 
        : "opacity-60"
    }`}>
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0"
        style={{ backgroundColor: `hsl(${meta.color})` }}
      >
        {abbr.slice(0, 2)}
      </div>
      <div className="min-w-0">
        <div className={`text-xs font-bold leading-tight truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {meta.name}
        </div>
      </div>
    </div>
  );
}

interface GameMatchupHeaderProps {
  leg: AISlipLeg;
}

export function GameMatchupHeader({ leg }: GameMatchupHeaderProps) {
  const ctx = leg.data_context;
  if (!ctx) return null;

  const homeRaw = ctx.home_team;
  const awayRaw = ctx.away_team;
  
  const homeAbbr = resolveTeamAbbr(homeRaw) || resolveTeamAbbr(leg.player_name);
  const awayAbbr = resolveTeamAbbr(awayRaw) || resolveTeamAbbr(ctx.opponent);

  if (!homeAbbr && !awayAbbr) return null;

  // Determine which side is selected
  const selectedAbbr = resolveTeamAbbr(leg.player_name) || resolveTeamAbbr(leg.team_abbr);
  const isTotal = leg.bet_type === "total";

  return (
    <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-border/20">
      <div className="flex items-center gap-1.5">
        {awayAbbr && (
          <TeamPill abbr={awayAbbr} isSelected={!isTotal && selectedAbbr === awayAbbr} />
        )}
        <span className="text-[10px] font-bold text-muted-foreground/50 px-0.5">@</span>
        {homeAbbr && (
          <TeamPill abbr={homeAbbr} isSelected={!isTotal && selectedAbbr === homeAbbr} />
        )}
      </div>
      {ctx.is_home != null && !isTotal && (
        <span className="text-[9px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {ctx.is_home ? "HOME" : "AWAY"}
        </span>
      )}
      {isTotal && ctx.total_line != null && (
        <span className="text-[9px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          O/U {ctx.total_line}
        </span>
      )}
    </div>
  );
}
