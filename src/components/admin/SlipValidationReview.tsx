import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle, ClipboardCheck, TrendingDown, BarChart3, CalendarDays, Target, Gauge, Lightbulb } from "lucide-react";

interface MarketContext {
  books_count: number;
  sportsbooks: string[];
  best_over_odds: string | null;
  best_under_odds: string | null;
  is_main_line: boolean;
  value_score: number | null;
  volatility_score: number | null;
  consistency_score: number | null;
  scored_at: string | null;
  scoring_stale: boolean;
}

interface LegOutcome {
  id: string;
  player_name: string;
  stat_type: string;
  threshold: number;
  pick: string;
  leg_order: number;
  team_abbr: string | null;
  actual_value: number | null;
  hit: boolean | null;
  confidence_score: number | null;
  market?: MarketContext;
}

interface SlipWithLegs {
  id: string;
  slip_name: string;
  risk_label: string;
  estimated_odds: string | null;
  game_date: string;
  leg_count: number;
  legs_hit: number | null;
  slip_hit: boolean | null;
  first_failed_leg: number | null;
  prompt: string | null;
  legs: LegOutcome[];
}

interface DiagnosticPattern {
  label: string;
  description: string;
  severity: "warning" | "info" | "success";
  count: number;
  total: number;
  rate: number;
}

// Semantic color helper for hit-rate cells
function rateColor(pctStr: string): string {
  if (pctStr === "—") return "";
  const v = parseInt(pctStr);
  if (isNaN(v)) return "";
  if (v >= 55) return "text-green-600 dark:text-green-400";
  if (v >= 45) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function rateBg(pctStr: string): string {
  if (pctStr === "—") return "";
  const v = parseInt(pctStr);
  if (isNaN(v)) return "";
  if (v >= 55) return "bg-green-500/10";
  if (v >= 45) return "bg-yellow-500/10";
  return "bg-red-500/10";
}

function computeDiagnostics(slips: SlipWithLegs[]): DiagnosticPattern[] {
  const patterns: DiagnosticPattern[] = [];
  const allLegs = slips.flatMap(s => s.legs).filter(l => l.hit != null);
  if (allLegs.length === 0) return patterns;

  const statMap: Record<string, { hit: number; total: number }> = {};
  for (const l of allLegs) {
    if (!statMap[l.stat_type]) statMap[l.stat_type] = { hit: 0, total: 0 };
    statMap[l.stat_type].total++;
    if (l.hit) statMap[l.stat_type].hit++;
  }
  const worstStat = Object.entries(statMap)
    .filter(([, v]) => v.total >= 3)
    .sort(([, a], [, b]) => (a.hit / a.total) - (b.hit / b.total))[0];
  if (worstStat) {
    const rate = Math.round((worstStat[1].hit / worstStat[1].total) * 100);
    if (rate < 45) {
      patterns.push({
        label: `${worstStat[0]} underperforming`,
        description: `${worstStat[0]} props hitting at ${rate}% (${worstStat[1].hit}/${worstStat[1].total})`,
        severity: rate < 30 ? "warning" : "info",
        count: worstStat[1].hit, total: worstStat[1].total, rate,
      });
    }
  }

  const lowConf = allLegs.filter(l => l.confidence_score != null && l.confidence_score < 40);
  if (lowConf.length >= 3) {
    const lowHits = lowConf.filter(l => l.hit).length;
    const rate = Math.round((lowHits / lowConf.length) * 100);
    patterns.push({
      label: "Low confidence legs",
      description: `Confidence < 40 hitting at ${rate}% (${lowHits}/${lowConf.length})`,
      severity: rate < 35 ? "warning" : "info",
      count: lowHits, total: lowConf.length, rate,
    });
  }

  const highConf = allLegs.filter(l => l.confidence_score != null && l.confidence_score >= 65);
  if (highConf.length >= 3) {
    const highHits = highConf.filter(l => l.hit).length;
    const rate = Math.round((highHits / highConf.length) * 100);
    patterns.push({
      label: "High confidence legs",
      description: `Confidence ≥ 65 hitting at ${rate}% (${highHits}/${highConf.length})`,
      severity: rate >= 55 ? "success" : "warning",
      count: highHits, total: highConf.length, rate,
    });
  }

  const singleBook = allLegs.filter(l => l.market && l.market.books_count === 1);
  if (singleBook.length >= 3) {
    const hits = singleBook.filter(l => l.hit).length;
    const rate = Math.round((hits / singleBook.length) * 100);
    patterns.push({
      label: "Single-book legs",
      description: `1-book props hitting at ${rate}% (${hits}/${singleBook.length})`,
      severity: rate < 40 ? "warning" : "info",
      count: hits, total: singleBook.length, rate,
    });
  }

  const multiBook = allLegs.filter(l => l.market && l.market.books_count >= 3);
  if (multiBook.length >= 3) {
    const hits = multiBook.filter(l => l.hit).length;
    const rate = Math.round((hits / multiBook.length) * 100);
    patterns.push({
      label: "Multi-book legs (3+)",
      description: `3+ book props hitting at ${rate}% (${hits}/${multiBook.length})`,
      severity: rate >= 55 ? "success" : "info",
      count: hits, total: multiBook.length, rate,
    });
  }

  const staleLegs = allLegs.filter(l => l.market?.scoring_stale);
  if (staleLegs.length >= 3) {
    const hits = staleLegs.filter(l => l.hit).length;
    const rate = Math.round((hits / staleLegs.length) * 100);
    patterns.push({
      label: "Stale-scoring legs",
      description: `Stale scoring data hitting at ${rate}% (${hits}/${staleLegs.length})`,
      severity: rate < 40 ? "warning" : "info",
      count: hits, total: staleLegs.length, rate,
    });
  }

  const failedSlips = slips.filter(s => s.slip_hit === false && s.first_failed_leg != null);
  if (failedSlips.length >= 3) {
    const earlyFails = failedSlips.filter(s => s.first_failed_leg! <= 1).length;
    const rate = Math.round((earlyFails / failedSlips.length) * 100);
    if (rate > 50) {
      patterns.push({
        label: "Early leg failures",
        description: `${rate}% of failed slips fail on leg 1 or 2 (${earlyFails}/${failedSlips.length})`,
        severity: "warning",
        count: earlyFails, total: failedSlips.length, rate,
      });
    }
  }

  const riskMap: Record<string, { hit: number; total: number }> = {};
  for (const s of slips.filter(s => s.slip_hit != null)) {
    if (!riskMap[s.risk_label]) riskMap[s.risk_label] = { hit: 0, total: 0 };
    riskMap[s.risk_label].total++;
    if (s.slip_hit) riskMap[s.risk_label].hit++;
  }
  for (const [label, v] of Object.entries(riskMap)) {
    if (v.total >= 3 && label === "safe") {
      const rate = Math.round((v.hit / v.total) * 100);
      if (rate < 40) {
        patterns.push({
          label: `"Safe" slips underperforming`,
          description: `Safe-labeled slips hitting at only ${rate}% (${v.hit}/${v.total})`,
          severity: "warning",
          count: v.hit, total: v.total, rate,
        });
      }
    }
  }

  return patterns;
}

function LegMarketChips({ market }: { market?: MarketContext }) {
  if (!market) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mt-1">
      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
        market.books_count >= 3 ? "border-green-500/40 text-green-600" :
        market.books_count >= 2 ? "border-yellow-500/40 text-yellow-600" :
        "border-red-500/40 text-red-600"
      }`}>
        {market.books_count}bk
      </Badge>
      {market.sportsbooks.length > 0 && (
        <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">
          {market.sportsbooks.map(s => s === "draftkings" ? "DK" : s === "fanduel" ? "FD" : s === "betmgm" ? "MGM" : s === "pointsbet" ? "PB" : s.slice(0, 3).toUpperCase()).join("·")}
        </Badge>
      )}
      {market.is_main_line && (
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/40 text-primary">main</Badge>
      )}
      {!market.is_main_line && market.books_count > 0 && (
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-yellow-500/40 text-yellow-600">alt</Badge>
      )}
      {market.value_score != null && (
        <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
          market.value_score >= 60 ? "border-green-500/40 text-green-600" :
          market.value_score >= 40 ? "border-yellow-500/40 text-yellow-600" :
          "border-red-500/40 text-red-600"
        }`}>
          V:{Math.round(market.value_score)}
        </Badge>
      )}
      {market.scoring_stale && (
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-yellow-500/40 text-yellow-600">⏳ stale</Badge>
      )}
      {market.best_over_odds && (
        <span className="text-[8px] text-muted-foreground font-mono">O:{market.best_over_odds}</span>
      )}
      {market.best_under_odds && (
        <span className="text-[8px] text-muted-foreground font-mono">U:{market.best_under_odds}</span>
      )}
    </div>
  );
}

function SlipRow({ slip }: { slip: SlipWithLegs }) {
  const [expanded, setExpanded] = useState(false);

  const riskColor = slip.risk_label === "safe"
    ? "border-green-500/50 text-green-600"
    : slip.risk_label === "aggressive"
      ? "border-red-500/50 text-red-600"
      : "border-yellow-500/50 text-yellow-600";

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {slip.slip_hit === true && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
        {slip.slip_hit === false && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
        {slip.slip_hit == null && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />}

        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate block">{slip.slip_name}</span>
          <span className="text-[10px] text-muted-foreground">{slip.game_date}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={`text-[9px] ${riskColor}`}>{slip.risk_label}</Badge>
          {slip.estimated_odds && <span className="text-[10px] font-mono text-muted-foreground">{slip.estimated_odds}</span>}
          <span className="text-[10px] font-mono">
            {slip.legs_hit != null ? `${slip.legs_hit}/${slip.leg_count}` : `—/${slip.leg_count}`}
          </span>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/20 bg-muted/10 px-3 py-2 space-y-1.5">
          {slip.prompt && (
            <p className="text-[10px] text-muted-foreground italic mb-2 truncate">"{slip.prompt}"</p>
          )}
          {slip.legs
            .sort((a, b) => a.leg_order - b.leg_order)
            .map((leg) => {
              const isFirstFailed = slip.first_failed_leg != null && leg.leg_order === slip.first_failed_leg;
              return (
                <div
                  key={leg.id}
                  className={`rounded px-2 py-1.5 ${
                    isFirstFailed ? "bg-destructive/10 border border-destructive/20" : "bg-card/50"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    {leg.hit === true && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                    {leg.hit === false && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                    {leg.hit == null && <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />}

                    <span className="text-muted-foreground font-mono w-4">L{leg.leg_order + 1}</span>
                    <span className="font-medium truncate">{leg.player_name}</span>
                    <span className="text-muted-foreground">{leg.stat_type} {leg.pick} {leg.threshold}</span>

                    <span className="font-mono ml-auto shrink-0">
                      {leg.actual_value != null ? leg.actual_value : "—"}
                    </span>

                    {leg.confidence_score != null && (
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${
                        leg.confidence_score >= 65 ? "border-green-500/50 text-green-600" :
                        leg.confidence_score >= 40 ? "border-yellow-500/50 text-yellow-600" :
                        "border-red-500/50 text-red-600"
                      }`}>
                        C:{Math.round(leg.confidence_score)}
                      </Badge>
                    )}

                    {isFirstFailed && (
                      <Badge variant="destructive" className="text-[9px] shrink-0">1st fail</Badge>
                    )}
                  </div>
                  <LegMarketChips market={leg.market} />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function mkKey(player: string, stat: string, threshold: number, date: string) {
  return `${player.toLowerCase()}|${stat.toLowerCase()}|${threshold}|${date}`;
}

/* ─── Daily Breakdown Table with color coding ─── */
function DailyBreakdownTable({ slips }: { slips: SlipWithLegs[] }) {
  const dateMap: Record<string, SlipWithLegs[]> = {};
  for (const s of slips) {
    if (!dateMap[s.game_date]) dateMap[s.game_date] = [];
    dateMap[s.game_date].push(s);
  }

  const pct = (h: number, t: number) => t > 0 ? `${Math.round((h / t) * 100)}%` : "—";

  const rows = Object.entries(dateMap)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, daySlips]) => {
      const gradedSlips = daySlips.filter(s => s.slip_hit != null);
      const slipHits = gradedSlips.filter(s => s.slip_hit).length;
      const allLegs = daySlips.flatMap(s => s.legs).filter(l => l.hit != null);
      const legHits = allLegs.filter(l => l.hit).length;

      const singleBook = allLegs.filter(l => l.market && l.market.books_count === 1);
      const multiBook = allLegs.filter(l => l.market && l.market.books_count >= 3);
      const stale = allLegs.filter(l => l.market?.scoring_stale);
      const strong = allLegs.filter(l => l.market && l.market.books_count >= 3 && (l.confidence_score ?? 0) >= 50);
      const weak = allLegs.filter(l => l.market && l.market.books_count <= 1 && (l.confidence_score ?? 0) < 40);

      return {
        date, totalSlips: daySlips.length,
        slipRate: pct(slipHits, gradedSlips.length), gradedSlips: gradedSlips.length,
        totalLegs: allLegs.length, legRate: pct(legHits, allLegs.length),
        singleBook: pct(singleBook.filter(l => l.hit).length, singleBook.length),
        multiBook: pct(multiBook.filter(l => l.hit).length, multiBook.length),
        stale: pct(stale.filter(l => l.hit).length, stale.length),
        strong: pct(strong.filter(l => l.hit).length, strong.length),
        weak: pct(weak.filter(l => l.hit).length, weak.length),
        singleBookN: singleBook.length, multiBookN: multiBook.length,
        staleN: stale.length, strongN: strong.length, weakN: weak.length,
      };
    });

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          Daily Breakdown
        </h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] px-1.5 h-8">Date</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Slips</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Slip HR</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Legs</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Leg HR</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">1-Bk</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">3+Bk</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Stale</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Strong</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Weak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.date}>
                  <TableCell className="text-[10px] px-1.5 py-1 font-mono">{r.date}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center">{r.totalSlips}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center font-medium ${rateColor(r.slipRate)} ${rateBg(r.slipRate)}`}>{r.slipRate}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center">{r.totalLegs}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center font-medium ${rateColor(r.legRate)} ${rateBg(r.legRate)}`}>{r.legRate}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${rateColor(r.singleBook)} ${rateBg(r.singleBook)}`}>
                    <span title={`${r.singleBookN} legs`}>{r.singleBook}</span>
                  </TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${rateColor(r.multiBook)} ${rateBg(r.multiBook)}`}>
                    <span title={`${r.multiBookN} legs`}>{r.multiBook}</span>
                  </TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${rateColor(r.stale)} ${rateBg(r.stale)}`}>
                    <span title={`${r.staleN} legs`}>{r.stale}</span>
                  </TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${rateColor(r.strong)} ${rateBg(r.strong)}`}>
                    <span title={`${r.strongN} legs`}>{r.strong}</span>
                  </TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${rateColor(r.weak)} ${rateBg(r.weak)}`}>
                    <span title={`${r.weakN} legs`}>{r.weak}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Stat Type Breakdown ─── */
function StatTypeBreakdown({ slips }: { slips: SlipWithLegs[] }) {
  const allLegs = slips.flatMap(s => s.legs).filter(l => l.hit != null);
  if (allLegs.length === 0) return null;

  const statMap: Record<string, {
    total: number; hits: number;
    confSum: number; confCount: number;
    valSum: number; valCount: number;
    staleCount: number; booksSum: number; booksCount: number;
  }> = {};

  for (const l of allLegs) {
    const st = l.stat_type;
    if (!statMap[st]) statMap[st] = { total: 0, hits: 0, confSum: 0, confCount: 0, valSum: 0, valCount: 0, staleCount: 0, booksSum: 0, booksCount: 0 };
    const m = statMap[st];
    m.total++;
    if (l.hit) m.hits++;
    if (l.confidence_score != null) { m.confSum += l.confidence_score; m.confCount++; }
    if (l.market?.value_score != null) { m.valSum += l.market.value_score; m.valCount++; }
    if (l.market?.scoring_stale) m.staleCount++;
    if (l.market) { m.booksSum += l.market.books_count; m.booksCount++; }
  }

  const rows = Object.entries(statMap)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([stat, m]) => ({
      stat,
      total: m.total,
      hitRate: `${Math.round((m.hits / m.total) * 100)}%`,
      avgConf: m.confCount > 0 ? Math.round(m.confSum / m.confCount) : null,
      avgVal: m.valCount > 0 ? Math.round(m.valSum / m.valCount) : null,
      avgBooks: m.booksCount > 0 ? (m.booksSum / m.booksCount).toFixed(1) : "—",
      stale: m.staleCount,
    }));

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Stat Type Breakdown
        </h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] px-1.5 h-8">Stat Type</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Legs</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Hit Rate</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Avg Conf</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Avg Value</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Avg Books</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Stale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.stat}>
                  <TableCell className="text-[10px] px-1.5 py-1 font-medium">{r.stat}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center">{r.total}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center font-medium ${rateColor(r.hitRate)} ${rateBg(r.hitRate)}`}>{r.hitRate}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center font-mono">{r.avgConf ?? "—"}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center font-mono">{r.avgVal ?? "—"}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center font-mono">{r.avgBooks}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center ${r.stale > 0 ? "text-yellow-600" : ""}`}>{r.stale}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Confidence Calibration Summary ─── */
function ConfidenceCalibration({ slips }: { slips: SlipWithLegs[] }) {
  const allLegs = slips.flatMap(s => s.legs).filter(l => l.hit != null && l.confidence_score != null);
  if (allLegs.length < 5) return null;

  const buckets = [
    { label: "0–39", min: 0, max: 39 },
    { label: "40–49", min: 40, max: 49 },
    { label: "50–59", min: 50, max: 59 },
    { label: "60–69", min: 60, max: 69 },
    { label: "70+", min: 70, max: 999 },
  ];

  const rows = buckets.map(b => {
    const legs = allLegs.filter(l => l.confidence_score! >= b.min && l.confidence_score! <= b.max);
    const hits = legs.filter(l => l.hit).length;
    const total = legs.length;
    const actualRate = total > 0 ? Math.round((hits / total) * 100) : null;
    const expectedMid = (b.min + Math.min(b.max, 85)) / 2;
    let calibration: "overconfident" | "underconfident" | "calibrated" | null = null;
    if (actualRate != null && total >= 3) {
      if (actualRate >= expectedMid + 10) calibration = "underconfident";
      else if (actualRate <= expectedMid - 10) calibration = "overconfident";
      else calibration = "calibrated";
    }
    return { ...b, total, hits, actualRate, calibration };
  });

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          Confidence Calibration Summary
        </h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] px-1.5 h-8">Bucket</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Legs</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Hit Rate</TableHead>
                <TableHead className="text-[9px] px-1.5 h-8 text-center">Calibration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.label}>
                  <TableCell className="text-[10px] px-1.5 py-1 font-mono">{r.label}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center">{r.total}</TableCell>
                  <TableCell className={`text-[10px] px-1.5 py-1 text-center font-medium ${r.actualRate != null ? rateColor(`${r.actualRate}%`) : ""} ${r.actualRate != null ? rateBg(`${r.actualRate}%`) : ""}`}>
                    {r.actualRate != null ? `${r.actualRate}%` : "—"}
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-1 text-center">
                    {r.calibration === "calibrated" && <Badge variant="outline" className="text-[8px] border-green-500/40 text-green-600">calibrated</Badge>}
                    {r.calibration === "overconfident" && <Badge variant="outline" className="text-[8px] border-red-500/40 text-red-600">overconfident</Badge>}
                    {r.calibration === "underconfident" && <Badge variant="outline" className="text-[8px] border-yellow-500/40 text-yellow-600">underconfident</Badge>}
                    {r.calibration == null && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Recommended Tuning Actions ─── */
function TuningActions({ slips }: { slips: SlipWithLegs[] }) {
  const allLegs = slips.flatMap(s => s.legs).filter(l => l.hit != null);
  if (allLegs.length < 5) return null;

  interface Action { priority: "high" | "medium" | "low"; title: string; detail: string }
  const actions: Action[] = [];

  // 1. Stat types underperforming
  const statMap: Record<string, { hit: number; total: number }> = {};
  for (const l of allLegs) {
    if (!statMap[l.stat_type]) statMap[l.stat_type] = { hit: 0, total: 0 };
    statMap[l.stat_type].total++;
    if (l.hit) statMap[l.stat_type].hit++;
  }
  for (const [stat, v] of Object.entries(statMap)) {
    if (v.total >= 5) {
      const rate = Math.round((v.hit / v.total) * 100);
      if (rate < 40) actions.push({ priority: "high", title: `Reduce ${stat} weight`, detail: `${stat} hitting ${rate}% (${v.hit}/${v.total}). Consider de-weighting or adding filters.` });
    }
  }

  // 2. Confidence buckets overstated
  const highConf = allLegs.filter(l => l.confidence_score != null && l.confidence_score >= 60);
  if (highConf.length >= 5) {
    const rate = Math.round((highConf.filter(l => l.hit).length / highConf.length) * 100);
    if (rate < 50) actions.push({ priority: "high", title: "Confidence scores overstated", detail: `60+ confidence legs hitting only ${rate}%. Re-calibrate scoring weights.` });
  }

  // 3. Safe slips underperforming
  const safeSlips = slips.filter(s => s.risk_label === "safe" && s.slip_hit != null);
  if (safeSlips.length >= 5) {
    const rate = Math.round((safeSlips.filter(s => s.slip_hit).length / safeSlips.length) * 100);
    if (rate < 40) actions.push({ priority: "high", title: '"Safe" slips unreliable', detail: `Safe slips hitting ${rate}%. Tighten safe criteria or raise confidence floor.` });
  }

  // 4. Single-book props weak
  const singleBook = allLegs.filter(l => l.market && l.market.books_count === 1);
  if (singleBook.length >= 5) {
    const rate = Math.round((singleBook.filter(l => l.hit).length / singleBook.length) * 100);
    if (rate < 40) actions.push({ priority: "medium", title: "Filter single-book props", detail: `1-book legs hitting ${rate}%. Consider requiring ≥2 books.` });
  }

  // 5. Stale scoring underperforming
  const stale = allLegs.filter(l => l.market?.scoring_stale);
  if (stale.length >= 5) {
    const rate = Math.round((stale.filter(l => l.hit).length / stale.length) * 100);
    const freshLegs = allLegs.filter(l => l.market && !l.market.scoring_stale);
    const freshRate = freshLegs.length > 0 ? Math.round((freshLegs.filter(l => l.hit).length / freshLegs.length) * 100) : null;
    if (freshRate != null && rate < freshRate - 10) actions.push({ priority: "medium", title: "Flag stale-scoring legs", detail: `Stale legs hit ${rate}% vs fresh ${freshRate}%. Add staleness penalty or require fresh data.` });
  }

  if (actions.length === 0) {
    actions.push({ priority: "low", title: "No urgent actions", detail: "Current performance within acceptable ranges. Continue monitoring." });
  }

  const prioColor = { high: "border-red-500/40 text-red-600", medium: "border-yellow-500/40 text-yellow-600", low: "border-green-500/40 text-green-600" };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          Recommended Tuning Actions
        </h3>
        {actions.map((a, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <Badge variant="outline" className={`text-[8px] px-1.5 py-0 mt-0.5 shrink-0 ${prioColor[a.priority]}`}>{a.priority}</Badge>
            <div>
              <span className="font-medium">{a.title}</span>
              <p className="text-muted-foreground">{a.detail}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SlipValidationReview() {
  const [dateFilter, setDateFilter] = useState<"3d" | "7d" | "14d" | "30d">("7d");

  const daysBack = { "3d": 3, "7d": 7, "14d": 14, "30d": 30 }[dateFilter];
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const sinceDateStr = sinceDate.toISOString().split("T")[0];

  const { data: slips = [], isLoading } = useQuery({
    queryKey: ["validation-slips", sinceDateStr],
    queryFn: async () => {
      const { data: slipRows } = await supabase
        .from("slip_outcomes")
        .select("*")
        .gte("game_date", sinceDateStr)
        .order("game_date", { ascending: false })
        .limit(50);

      if (!slipRows || slipRows.length === 0) return [];

      const slipIds = slipRows.map(s => s.id);
      const { data: legRows } = await supabase
        .from("slip_leg_outcomes")
        .select("*")
        .in("slip_outcome_id", slipIds);

      const gameDates = [...new Set(slipRows.map(s => s.game_date))];

      const { data: lineSnaps } = await supabase
        .from("line_snapshots")
        .select("player_name, stat_type, threshold, game_date, sportsbook, over_odds, under_odds")
        .in("game_date", gameDates)
        .limit(1000);

      const { data: propScores } = await supabase
        .from("player_prop_scores")
        .select("player_name, stat_type, threshold, game_date, value_score, volatility_score, consistency_score, scored_at")
        .in("game_date", gameDates)
        .limit(1000);

      const marketMap: Record<string, MarketContext> = {};

      for (const snap of lineSnaps || []) {
        const key = mkKey(snap.player_name, snap.stat_type, snap.threshold, snap.game_date);
        if (!marketMap[key]) {
          marketMap[key] = { books_count: 0, sportsbooks: [], best_over_odds: null, best_under_odds: null, is_main_line: false, value_score: null, volatility_score: null, consistency_score: null, scored_at: null, scoring_stale: false };
        }
        const m = marketMap[key];
        if (!m.sportsbooks.includes(snap.sportsbook)) {
          m.sportsbooks.push(snap.sportsbook);
          m.books_count = m.sportsbooks.length;
        }
        if (snap.over_odds && (!m.best_over_odds || parseInt(snap.over_odds) > parseInt(m.best_over_odds))) m.best_over_odds = snap.over_odds;
        if (snap.under_odds && (!m.best_under_odds || parseInt(snap.under_odds) > parseInt(m.best_under_odds))) m.best_under_odds = snap.under_odds;
      }

      const mainLineMap: Record<string, { threshold: number; count: number }> = {};
      for (const snap of lineSnaps || []) {
        const groupKey = `${snap.player_name.toLowerCase()}|${snap.stat_type.toLowerCase()}|${snap.game_date}`;
        const fullKey = mkKey(snap.player_name, snap.stat_type, snap.threshold, snap.game_date);
        const booksCount = marketMap[fullKey]?.books_count || 0;
        if (!mainLineMap[groupKey] || booksCount > mainLineMap[groupKey].count) {
          mainLineMap[groupKey] = { threshold: snap.threshold, count: booksCount };
        }
      }
      for (const [key, ctx] of Object.entries(marketMap)) {
        const parts = key.split("|");
        const groupKey = `${parts[0]}|${parts[1]}|${parts[3]}`;
        const threshold = parseFloat(parts[2]);
        ctx.is_main_line = mainLineMap[groupKey]?.threshold === threshold;
      }

      for (const score of propScores || []) {
        const key = mkKey(score.player_name, score.stat_type, score.threshold, score.game_date);
        if (marketMap[key]) {
          marketMap[key].value_score = score.value_score;
          marketMap[key].volatility_score = score.volatility_score;
          marketMap[key].consistency_score = score.consistency_score;
          marketMap[key].scored_at = score.scored_at;
          if (score.scored_at) {
            const scoredTime = new Date(score.scored_at).getTime();
            const gameDay = new Date(score.game_date + "T12:00:00Z").getTime();
            marketMap[key].scoring_stale = (gameDay - scoredTime) > 12 * 60 * 60 * 1000;
          }
        } else {
          marketMap[key] = {
            books_count: 0, sportsbooks: [], best_over_odds: null, best_under_odds: null, is_main_line: false,
            value_score: score.value_score, volatility_score: score.volatility_score, consistency_score: score.consistency_score,
            scored_at: score.scored_at,
            scoring_stale: score.scored_at ? (new Date(score.game_date + "T12:00:00Z").getTime() - new Date(score.scored_at).getTime()) > 12 * 60 * 60 * 1000 : true,
          };
        }
      }

      const legsBySlip: Record<string, LegOutcome[]> = {};
      for (const leg of legRows || []) {
        if (!legsBySlip[leg.slip_outcome_id]) legsBySlip[leg.slip_outcome_id] = [];
        const parentSlip = slipRows.find(s => s.id === leg.slip_outcome_id);
        const gameDate = parentSlip?.game_date || "";
        const key = mkKey(leg.player_name, leg.stat_type, leg.threshold, gameDate);
        legsBySlip[leg.slip_outcome_id].push({ ...leg, market: marketMap[key] || undefined });
      }

      return slipRows.map(s => ({ ...s, legs: legsBySlip[s.id] || [] })) as SlipWithLegs[];
    },
  });

  const diagnostics = computeDiagnostics(slips);

  const gradedSlips = slips.filter(s => s.slip_hit != null);
  const slipHits = gradedSlips.filter(s => s.slip_hit).length;
  const slipRate = gradedSlips.length > 0 ? Math.round((slipHits / gradedSlips.length) * 100) : null;

  const allLegs = slips.flatMap(s => s.legs).filter(l => l.hit != null);
  const legHits = allLegs.filter(l => l.hit).length;
  const legRate = allLegs.length > 0 ? Math.round((legHits / allLegs.length) * 100) : null;

  const legsWithMarket = slips.flatMap(s => s.legs).filter(l => l.market && l.market.books_count > 0).length;
  const totalLegs = slips.flatMap(s => s.legs).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          Slip Validation Review
        </h2>
        <div className="flex gap-1">
          {(["3d", "7d", "14d", "30d"] as const).map(f => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                dateFilter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2">
            <Card>
              <CardContent className="py-3 text-center">
                <div className="text-lg font-bold text-primary">{slipRate != null ? `${slipRate}%` : "—"}</div>
                <div className="text-[10px] text-muted-foreground">Slip Rate ({gradedSlips.length})</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <div className="text-lg font-bold text-primary">{legRate != null ? `${legRate}%` : "—"}</div>
                <div className="text-[10px] text-muted-foreground">Leg Rate ({allLegs.length})</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <div className="text-lg font-bold text-primary">{slips.length}</div>
                <div className="text-[10px] text-muted-foreground">Slips</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <div className="text-lg font-bold text-primary">
                  {totalLegs > 0 ? `${Math.round((legsWithMarket / totalLegs) * 100)}%` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">Mkt Coverage</div>
              </CardContent>
            </Card>
          </div>

          {/* Diagnostics */}
          {diagnostics.length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Pattern Diagnostics
                </h3>
                {diagnostics.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {d.severity === "warning" && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />}
                    {d.severity === "info" && <TrendingDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                    {d.severity === "success" && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />}
                    <div>
                      <span className="font-medium">{d.label}</span>
                      <p className="text-muted-foreground">{d.description}</p>
                    </div>
                    <div className="ml-auto shrink-0 w-12 h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full rounded-full ${d.rate >= 55 ? "bg-green-500" : d.rate >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${d.rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Daily Breakdown Table */}
          {slips.length > 0 && <DailyBreakdownTable slips={slips} />}

          {/* Stat Type Breakdown */}
          {slips.length > 0 && <StatTypeBreakdown slips={slips} />}

          {/* Confidence Calibration */}
          {slips.length > 0 && <ConfidenceCalibration slips={slips} />}

          {/* Tuning Actions */}
          {slips.length > 0 && <TuningActions slips={slips} />}

          {/* Slip list */}
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
            {slips.map(slip => (
              <SlipRow key={slip.id} slip={slip} />
            ))}
          </div>

          {slips.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No slip outcomes found for the last {daysBack} days. Run grading first.
            </p>
          )}
        </>
      )}
    </div>
  );
}