import { easternDate, isDate, type Comparator, type Filters, type Metric, type Operation } from "./contract.ts";

const aliases: Record<string, Metric> = {
  points: "PTS", pts: "PTS", rebounds: "REB", reb: "REB", assists: "AST", ast: "AST",
  "three-pointers made": "3PM", "three pointers made": "3PM", "threes": "3PM",
  "three-pointers": "3PM", "3-pointers": "3PM", "3pm": "3PM",
};
const comparisons: Record<string, Comparator> = {
  "at least": "gte", ">=": "gte", "≥": "gte", "or more": "gte",
  "more than": "gt", over: "gt", ">": "gt",
  "at most": "lte", "<=": "lte", "≤": "lte", "or fewer": "lte",
  "less than": "lt", "fewer than": "lt", under: "lt", "<": "lt",
  exactly: "eq", "=": "eq",
};
const metricPattern = Object.keys(aliases).sort((a, b) => b.length - a.length).join("|");
const comparisonPattern = "at least|more than|fewer than|less than|at most|exactly|over|under|>=|<=|≥|≤|>|<|=";
const namePattern = "[\\p{L}][\\p{L} .’'-]{0,63}?";
const dateClause = / (?:as of|through|on) (\d{4}-\d{2}-\d{2}|today|yesterday)$| (today|yesterday)$/;
const windowClause = / (?:(?:in|over|across|during) )?(?:(?:the|his|her|their) )?last[ -](5|10)(?: (?:games?|appearances?))?$/;
const metricOnly = new RegExp(`^(${metricPattern})$`, "u");
const thresholdOnly = new RegExp(`^(${comparisonPattern}) ?(\\d{1,3}(?:\\.\\d{1,2})?)$`, "u");
const averages = [
  new RegExp(`^average (${metricPattern}) (?:for|by) (${namePattern})$`, "u"),
  new RegExp(`^what did (${namePattern}) average (?:for |in )?(${metricPattern})$`, "u"),
  new RegExp(`^what (?:was|is) (${namePattern})[’']s average (${metricPattern})$`, "u"),
  new RegExp(`^(${namePattern}) (?:average|averaged) (${metricPattern})$`, "u"),
  new RegExp(`^(${namePattern}) (${metricPattern}) average$`, "u"),
];
const counts = new RegExp(
  `^(?:(?:how many times|how many games) did )?(${namePattern}) (?:(?:score|have|record|make) )?` +
  `(?:(${comparisonPattern}) ?(\\d{1,3}(?:\\.\\d{1,2})?) (${metricPattern})|(\\d{1,3}(?:\\.\\d{1,2})?) (or more|or fewer) (${metricPattern}))$`,
  "u",
);

export type Question =
  | { kind: "new"; name: string; team?: string; filters: Filters }
  | { kind: "follow_up"; change: Partial<Pick<Filters, "metric" | "window" | "asOf" | "operation">> };

function operation(comparator: string, value: string): Operation | undefined {
  const threshold = Number(value);
  if (threshold > 200) return;
  return { kind: "count", comparator: comparisons[comparator], threshold };
}

export function normalizeName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
}

export function parseQuestion(question: string, defaultDate: string, now: Date): Question | undefined {
  let text = question.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  if (/\b(wnba|mlb|nfl|nhl|ncaa|live|season|odds|bet|parlay|sql)\b/.test(text)) return;
  text = text.replace(/^nba /, "");

  const date = dateClause.exec(text);
  const dateWord = date?.[1] ?? date?.[2];
  const asOf = dateWord === "today" || dateWord === "yesterday"
    ? easternDate(now, dateWord === "yesterday")
    : dateWord ?? defaultDate;
  if (!isDate(asOf)) return;
  if (date) text = text.slice(0, date.index);

  // Follow-ups change one validated filter and keep the rest of the previous query.
  const followUp = /^(?:what about|how about)(?: (.*))?$/.exec(text);
  if (followUp) {
    const rest = followUp[1] ?? "";
    if (!rest && dateWord) return { kind: "follow_up", change: { asOf } };
    const followWindow = /^(?:the )?last[ -](5|10)(?: (?:games?|appearances?))?$/.exec(rest);
    const threshold = thresholdOnly.exec(rest);
    const nextOperation = threshold && operation(threshold[1], threshold[2]);
    const change = metricOnly.test(rest) ? { metric: aliases[rest] }
      : followWindow ? { window: Number(followWindow[1]) as 5 | 10 }
      : nextOperation ? { operation: nextOperation } : undefined;
    return change ? { kind: "follow_up", change: { ...change, ...(dateWord ? { asOf } : {}) } } : undefined;
  }

  const windowMatch = windowClause.exec(text);
  if (!windowMatch) return;
  text = text.slice(0, windowMatch.index);
  const base = { sport: "NBA" as const, window: Number(windowMatch[1]) as 5 | 10, asOf };
  let name: string;
  let metric: Metric;
  let calculation: Operation | undefined;
  const counted = counts.exec(text);
  if (counted) {
    name = counted[1];
    metric = aliases[counted[4] ?? counted[7]];
    calculation = operation(counted[2] ?? counted[6], counted[3] ?? counted[5]);
  } else {
    const index = averages.findIndex((regex) => regex.test(text));
    if (index === -1) return;
    const match = averages[index].exec(text)!;
    name = index === 0 ? match[2] : match[1];
    metric = aliases[index === 0 ? match[1] : match[2]];
    calculation = { kind: "average" };
  }
  if (!metric || !calculation) return;

  const qualified = /^(.*?) (?:on|for) ([a-z]{3})$/.exec(name);
  return {
    kind: "new",
    name: normalizeName(qualified?.[1] ?? name),
    team: qualified?.[2]?.toUpperCase(),
    filters: { ...base, metric, operation: calculation },
  };
}
