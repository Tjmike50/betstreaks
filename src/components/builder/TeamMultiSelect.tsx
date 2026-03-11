import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import teams, { getTeamMeta } from "@/lib/nbaTeamMeta";

interface Props {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}

const TEAM_LIST = Object.entries(teams).map(([abbr, meta]) => ({
  abbr,
  label: `${meta.city} ${meta.name}`,
})).sort((a, b) => a.label.localeCompare(b.label));

export function TeamMultiSelect({ label, values, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? TEAM_LIST.filter(
        (t) =>
          t.label.toLowerCase().includes(search.toLowerCase()) ||
          t.abbr.toLowerCase().includes(search.toLowerCase())
      )
    : TEAM_LIST;

  const toggle = (abbr: string) => {
    onChange(
      values.includes(abbr)
        ? values.filter((v) => v !== abbr)
        : [...values, abbr]
    );
  };

  return (
    <div className="space-y-1.5" ref={ref}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between h-9 px-3 rounded-md border border-input bg-secondary/50 text-sm text-foreground hover:bg-secondary transition-colors"
      >
        <span className="text-muted-foreground text-xs">
          {values.length === 0
            ? "Select teams..."
            : `${values.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 w-[calc(100%-2rem)] mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-7 px-2 text-xs bg-secondary/50 border border-input rounded-md outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="overflow-y-auto max-h-40 p-1">
            {filtered.map((t) => {
              const selected = values.includes(t.abbr);
              const meta = getTeamMeta(t.abbr);
              return (
                <button
                  key={t.abbr}
                  type="button"
                  onClick={() => toggle(t.abbr)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                    selected
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-secondary"
                  }`}
                >
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: meta
                        ? `hsl(${meta.color})`
                        : "hsl(var(--muted))",
                    }}
                  />
                  <span className="flex-1 text-left truncate">{t.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {t.abbr}
                  </span>
                  {selected && <Check className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-3">
                No teams found
              </div>
            )}
          </div>
        </div>
      )}

      {values.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {values.map((abbr) => {
            const meta = getTeamMeta(abbr);
            return (
              <Badge
                key={abbr}
                variant="secondary"
                className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20"
                onClick={() => onChange(values.filter((v) => v !== abbr))}
              >
                {meta ? `${meta.city} ${meta.name}` : abbr}{" "}
                <X className="h-2.5 w-2.5" />
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
