import { Shield, TrendingDown, BarChart3, Target, Users, UserMinus, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { BuilderFilters } from "@/types/builderFilters";
import { DEFAULT_BUILDER_FILTERS } from "@/types/builderFilters";

interface Props {
  filters: BuilderFilters;
  onChange: (f: BuilderFilters) => void;
}

interface QuickChipDef {
  label: string;
  icon: typeof Shield;
  isActive: (f: BuilderFilters) => boolean;
  apply: (f: BuilderFilters) => BuilderFilters;
}

const QUICK_CHIPS: QuickChipDef[] = [
  {
    label: "Safe Only",
    icon: Shield,
    isActive: (f) => f.riskLevel === "safe",
    apply: (f) => ({ ...f, riskLevel: f.riskLevel === "safe" ? null : "safe" }),
  },
  {
    label: "Strong Markets",
    icon: CheckCircle2,
    isActive: (f) => f.minBooksCount >= 2 && f.minMarketConfidence >= 50 && f.excludeSingleBookProps,
    apply: (f) => {
      const isActive = f.minBooksCount >= 2 && f.minMarketConfidence >= 50 && f.excludeSingleBookProps;
      return isActive
        ? { ...f, minBooksCount: DEFAULT_BUILDER_FILTERS.minBooksCount, minMarketConfidence: DEFAULT_BUILDER_FILTERS.minMarketConfidence, excludeSingleBookProps: false }
        : { ...f, minBooksCount: 2, minMarketConfidence: 50, excludeSingleBookProps: true, verifiedOnly: true, mainLinesOnly: true };
    },
  },
  {
    label: "High Confidence",
    icon: TrendingDown,
    isActive: (f) => f.minConfidence !== null && f.minConfidence >= 65,
    apply: (f) => ({
      ...f,
      minConfidence: f.minConfidence !== null && f.minConfidence >= 65 ? null : 65,
    }),
  },
  {
    label: "Low Volatility",
    icon: BarChart3,
    isActive: (f) => f.maxVolatility !== null && f.maxVolatility <= 35,
    apply: (f) => ({
      ...f,
      maxVolatility: f.maxVolatility !== null && f.maxVolatility <= 35 ? null : 35,
    }),
  },
  {
    label: "Props Only",
    icon: Target,
    isActive: (f) => f.betType === "player_props",
    apply: (f) => ({ ...f, betType: f.betType === "player_props" ? null : "player_props" }),
  },
  {
    label: "Same Game",
    icon: Users,
    isActive: (f) => f.sameGameOnly,
    apply: (f) => ({ ...f, sameGameOnly: !f.sameGameOnly, crossGameOnly: false }),
  },
  {
    label: "No Repeats",
    icon: UserMinus,
    isActive: (f) => f.noRepeatPlayers,
    apply: (f) => ({ ...f, noRepeatPlayers: !f.noRepeatPlayers }),
  },
  {
    label: "No Questionable",
    icon: AlertTriangle,
    isActive: (f) => f.avoidUncertainLineups,
    apply: (f) => ({ ...f, avoidUncertainLineups: !f.avoidUncertainLineups, avoidStaleAvailability: !f.avoidUncertainLineups }),
  },
];

export function BuilderQuickChips({ filters, onChange }: Props) {
  return (
    <div className="flex gap-2 flex-wrap">
      {QUICK_CHIPS.map((chip) => {
        const Icon = chip.icon;
        const active = chip.isActive(filters);
        return (
          <button
            key={chip.label}
            onClick={() => onChange(chip.apply(filters))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              active
                ? "bg-primary/20 text-primary border border-primary/30"
                : "bg-secondary/50 text-muted-foreground hover:bg-secondary border border-transparent"
            }`}
          >
            <Icon className="h-3 w-3" />
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
