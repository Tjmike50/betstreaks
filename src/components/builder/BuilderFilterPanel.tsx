import { useState } from "react";
import {
  ChevronDown, ChevronUp, SlidersHorizontal, X, Shield, Zap, Target,
  TrendingUp, Users, UserMinus, BarChart3, Dices, Filter, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  BuilderFilters, RiskLevel, BetType, StatType, OverUnder,
} from "@/types/builderFilters";
import {
  DEFAULT_BUILDER_FILTERS, getActiveBuilderFilterCount,
} from "@/types/builderFilters";
import { BuilderQuickChips } from "./BuilderQuickChips";
import { BuilderActiveFilters } from "./BuilderActiveFilters";
import { TeamMultiSelect } from "./TeamMultiSelect";

interface Props {
  filters: BuilderFilters;
  onChange: (f: BuilderFilters) => void;
  isPremium: boolean;
}

const RISK_OPTIONS: { value: RiskLevel; label: string; icon: typeof Shield }[] = [
  { value: "safe", label: "Safe", icon: Shield },
  { value: "balanced", label: "Balanced", icon: Target },
  { value: "aggressive", label: "Aggressive", icon: Zap },
];

const BET_TYPE_OPTIONS: { value: BetType; label: string }[] = [
  { value: "player_props", label: "Player Props" },
  { value: "moneyline", label: "Moneyline" },
  { value: "spread", label: "Spread" },
  { value: "totals", label: "Totals" },
  { value: "mixed", label: "Mixed" },
];

const STAT_OPTIONS: { value: StatType; label: string }[] = [
  { value: "points", label: "Points" },
  { value: "rebounds", label: "Rebounds" },
  { value: "assists", label: "Assists" },
  { value: "threes", label: "Threes" },
  { value: "steals", label: "Steals" },
  { value: "blocks", label: "Blocks" },
];

export function BuilderFilterPanel({ filters, onChange, isPremium }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeCount = getActiveBuilderFilterCount(filters);

  const update = (partial: Partial<BuilderFilters>) =>
    onChange({ ...filters, ...partial });

  const toggleStat = (stat: StatType) => {
    const current = filters.statTypes;
    update({
      statTypes: current.includes(stat)
        ? current.filter((s) => s !== stat)
        : [...current, stat],
    });
  };

  const clearAll = () => onChange({ ...DEFAULT_BUILDER_FILTERS, slipCount: filters.slipCount });

  return (
    <div className="space-y-3">
      {/* Quick Chips */}
      <BuilderQuickChips filters={filters} onChange={onChange} />

      {/* Toggle Button */}
      <Button
        variant={isOpen ? "default" : "outline"}
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full gap-2"
      >
        {isOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
        {isOpen ? "Close Filters" : "Filters"}
        {activeCount > 0 && !isOpen && (
          <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
            {activeCount}
          </Badge>
        )}
      </Button>

      {/* Active Filters Summary */}
      {!isOpen && activeCount > 0 && (
        <BuilderActiveFilters filters={filters} onChange={onChange} onClearAll={clearAll} />
      )}

      {/* Filter Panel */}
      {isOpen && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-5 animate-in slide-in-from-top-2 duration-200">
          {/* ── CORE FILTERS ── */}
          <Section title="Core" icon={<Filter className="h-4 w-4" />}>
            {/* Target Odds */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target Odds</Label>
              <Input
                placeholder="e.g. +200"
                value={filters.targetOdds}
                onChange={(e) => update({ targetOdds: e.target.value })}
                className="h-9 bg-secondary/50"
              />
            </div>

            {/* Legs + Slips */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Legs per slip</Label>
                <Select
                  value={filters.legCount?.toString() || "auto"}
                  onValueChange={(v) => update({ legCount: v === "auto" ? null : Number(v) })}
                >
                  <SelectTrigger className="h-9 bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    {[2, 3, 4, 5, 6].map((n) => (
                      <SelectItem key={n} value={n.toString()}>{n} legs</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Slips</Label>
                <Select
                  value={filters.slipCount.toString()}
                  onValueChange={(v) => update({ slipCount: Number(v) })}
                >
                  <SelectTrigger className="h-9 bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5].map((n) => (
                      <SelectItem key={n} value={n.toString()} disabled={!isPremium && n > 1}>
                        {n} {n === 1 ? "slip" : "slips"}{!isPremium && n > 1 ? " 🔒" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Risk Level */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Risk Level</Label>
              <div className="flex gap-2">
                {RISK_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = filters.riskLevel === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => update({ riskLevel: isActive ? null : opt.value })}
                      className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? opt.value === "safe" ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : opt.value === "aggressive" ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                          : "bg-secondary/50 text-muted-foreground hover:bg-secondary border border-transparent"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bet Type */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bet Type</Label>
              <Select
                value={filters.betType || "any"}
                onValueChange={(v) => update({ betType: v === "any" ? null : (v as BetType) })}
              >
                <SelectTrigger className="h-9 bg-secondary/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {BET_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Section>

          {/* ── PROP FILTERS ── */}
          <Section title="Prop Filters" icon={<BarChart3 className="h-4 w-4" />}>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Stat Types</Label>
              <div className="flex gap-1.5 flex-wrap">
                {STAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleStat(opt.value)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      filters.statTypes.includes(opt.value)
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Direction</Label>
              <div className="flex gap-2">
                {(["both", "over", "under"] as OverUnder[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => update({ overUnder: v })}
                    className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${
                      filters.overUnder === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {v === "both" ? "Both" : v === "over" ? "Over Only" : "Under Only"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ToggleRow label="Same Game Parlay" checked={filters.sameGameOnly}
                onChange={(v) => update({ sameGameOnly: v, crossGameOnly: v ? false : filters.crossGameOnly })} />
              <ToggleRow label="Cross Game Only" checked={filters.crossGameOnly}
                onChange={(v) => update({ crossGameOnly: v, sameGameOnly: v ? false : filters.sameGameOnly })} />
            </div>
          </Section>

          {/* ── TEAM / PLAYER FILTERS ── */}
          <Section title="Teams & Players" icon={<Users className="h-4 w-4" />}>
            <TagInput
              label="Include Teams"
              placeholder="e.g. LAL, BOS"
              values={filters.includeTeams}
              onChange={(v) => update({ includeTeams: v })}
            />
            <TagInput
              label="Exclude Teams"
              placeholder="e.g. NYK"
              values={filters.excludeTeams}
              onChange={(v) => update({ excludeTeams: v })}
            />
            <TagInput
              label="Include Players"
              placeholder="e.g. LeBron James"
              values={filters.includePlayers}
              onChange={(v) => update({ includePlayers: v })}
            />
            <TagInput
              label="Exclude Players"
              placeholder="e.g. Anthony Davis"
              values={filters.excludePlayers}
              onChange={(v) => update({ excludePlayers: v })}
            />
          </Section>

          {/* ── ADVANCED (Data Quality + Diversity) ── */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Advanced Filters
                </span>
                {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-2">
              {/* Data Quality */}
              <Section title="Data Quality" icon={<TrendingUp className="h-4 w-4" />}>
                <SliderRow label="Min Confidence" value={filters.minConfidence} min={0} max={100}
                  onChange={(v) => update({ minConfidence: v === 0 ? null : v })} suffix="%" />
                <SliderRow label="Min Hit Rate" value={filters.minHitRate} min={0} max={100}
                  onChange={(v) => update({ minHitRate: v === 0 ? null : v })} suffix="%" />
                <SliderRow label="Max Volatility" value={filters.maxVolatility} min={0} max={100}
                  onChange={(v) => update({ maxVolatility: v === 0 ? null : v })} suffix="" />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min Sample Size</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 10"
                    value={filters.minSampleSize ?? ""}
                    onChange={(e) => update({ minSampleSize: e.target.value ? Number(e.target.value) : null })}
                    className="h-9 bg-secondary/50"
                  />
                </div>
                <ToggleRow label="Starters Only" checked={filters.startersOnly} onChange={(v) => update({ startersOnly: v })} />
                <ToggleRow label="Avoid Uncertain Lineups" checked={filters.avoidUncertainLineups} onChange={(v) => update({ avoidUncertainLineups: v })} />
                <ToggleRow label="Avoid Stale Availability" checked={filters.avoidStaleAvailability} onChange={(v) => update({ avoidStaleAvailability: v })} />
                <ToggleRow label="Require Fresh Market Data" checked={filters.requireFreshMarketData} onChange={(v) => update({ requireFreshMarketData: v })} />
              </Section>

              {/* Diversity */}
              <Section title="Diversity" icon={<Dices className="h-4 w-4" />}>
                <ToggleRow label="No Repeat Players Across Slips" checked={filters.noRepeatPlayers} onChange={(v) => update({ noRepeatPlayers: v })} />
                <ToggleRow label="Max One Leg Per Player" checked={filters.maxOnePerPlayer} onChange={(v) => update({ maxOnePerPlayer: v })} />
                <ToggleRow label="Max One Leg Per Team" checked={filters.maxOnePerTeam} onChange={(v) => update({ maxOnePerTeam: v })} />
                <ToggleRow label="Diversify Slips" checked={filters.diversifySlips} onChange={(v) => update({ diversifySlips: v })} />
              </Section>
            </CollapsibleContent>
          </Collapsible>

          {/* Clear All */}
          {activeCount > 0 && (
            <Button variant="outline" size="sm" onClick={clearAll} className="w-full">
              Clear All Filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-muted-foreground cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SliderRow({ label, value, min, max, onChange, suffix }: {
  label: string; value: number | null; min: number; max: number; onChange: (v: number) => void; suffix: string;
}) {
  const display = value ?? min;
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-medium text-primary">{value ? `${value}${suffix}` : "Any"}</span>
      </div>
      <Slider value={[display]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={5} />
    </div>
  );
}

function TagInput({ label, placeholder, values, onChange }: {
  label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim().toUpperCase();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="h-8 bg-secondary/50 text-xs flex-1"
        />
        <Button size="sm" variant="secondary" onClick={add} className="h-8 text-xs px-3">Add</Button>
      </div>
      {values.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => onChange(values.filter((x) => x !== v))}>
              {v} <X className="h-2.5 w-2.5" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
