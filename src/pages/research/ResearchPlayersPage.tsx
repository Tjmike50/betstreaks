// =============================================================================
// ResearchPlayersPage — searchable, sortable list of players for the active sport.
// Sport-aware via SportContext; offseason → empty state.
// =============================================================================
import { ArrowLeft, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useResearchPlayers } from "@/hooks/useResearchPlayers";
import { useSport } from "@/contexts/SportContext";
import { PlayerSearchTable } from "@/components/research/PlayerSearchTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";

export default function ResearchPlayersPage() {
  const navigate = useNavigate();
  const { sport, config } = useSport();
  const { data: rows, isLoading, error } = useResearchPlayers();

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 pb-24 md:pb-8">
        <button
          onClick={() => navigate("/research")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Research
        </button>

        <header className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">
              {config.tagline} · Players
            </p>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Players
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search players, sort by current streak or season hit rate, then drill in.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-md" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load players. Try again in a moment.
            </p>
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              No player data yet
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {config.tagline} doesn't have active streak data right now.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/cheatsheets")}>
              Browse Cheatsheets
            </Button>
          </div>
        ) : (
          <PlayerSearchTable rows={rows} sport={sport} />
        )}
      </div>
      <Footer />
    </div>
  );
}
