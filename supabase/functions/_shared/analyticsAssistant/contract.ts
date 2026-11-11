export const metrics = {
  PTS: { label: "Points", column: "pts" },
  REB: { label: "Rebounds", column: "reb" },
  AST: { label: "Assists", column: "ast" },
  "3PM": { label: "Three-pointers made", column: "fg3m" },
} as const;

export const operators = { gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=" } as const;
export const maxQuestionLength = 240;
export type Metric = keyof typeof metrics;
export type Comparator = keyof typeof operators;
export type Operation = { kind: "average" } | {
  kind: "count";
  comparator: Comparator;
  threshold: number;
};
export type Filters = {
  sport: "NBA";
  window: 5 | 10;
  metric: Metric;
  asOf: string;
  operation: Operation;
};
export type Query = Filters & { playerId: number };
export type Player = { id: number; name: string; team: string; sport: "NBA" };
export type Evidence = { gameId: string; date: string; value: number | null };
export type Coverage = { requested: number; appearances: number; known: number; missing: number };
export type Snapshot = {
  dataset: string;
  revision: string;
  source: string;
  mode: "fixture" | "verified";
  snapshotAt: string;
  coverageThrough: string;
  fetchedAt: string | null;
};
export type Provenance = Snapshot & {
  freshness: "frozen_fixture" | "verified_snapshot" | "stale";
  computedAt: string;
  latestGameDate: string | null;
};
export type Calculation = {
  kind: "average";
  sum: number;
  denominator: number;
  value: number;
} | {
  kind: "count";
  comparator: Comparator;
  threshold: number;
  hits: number;
  denominator: number;
  ties: number;
  pushes: number;
};

export const errors = {
  AUTH_REQUIRED: "Sign in to ask a question.",
  AUTH_UNAVAILABLE: "Sign-in verification is unavailable. Try again shortly.",
  ORIGIN_DENIED: "This app origin is unavailable for the assistant.",
  METHOD_NOT_ALLOWED: "Use POST to ask a question.",
  INVALID_REQUEST: "The request could not be read. Try submitting a new question.",
  REQUEST_TOO_LARGE: "This question or request is too large.",
  UNSUPPORTED_QUESTION: "Ask for an NBA player's average or threshold count in their last 5 or 10 games. Use points, rebounds, assists or three-pointers made.",
  PLAYER_NOT_FOUND: "That player is outside the synthetic roster. Try a full fixture name from the examples.",
  CONTEXT_REQUIRED: "Start with a full player question to use a follow-up.",
  INVALID_CONTEXT: "This question context expired or changed accounts. Start a new question.",
  INVALID_SELECTION: "Choose a player from the current clarification.",
  NO_GAMES: "There are no eligible appearances for this player through the requested date.",
  INSUFFICIENT_COVERAGE: "The requested appearance window is incomplete. The available rows are shown below.",
  DATA_UNVERIFIED: "The source could not establish a complete, consistent set of eligible appearances.",
  DATASET_UNAVAILABLE: "The dataset or its provenance is unavailable.",
  SOURCE_UNAVAILABLE: "The game-log source is unavailable. Try again shortly.",
  STALE_SOURCE: "The requested date is beyond the dataset's verified coverage.",
  TIMEOUT: "The request took too long. Try again shortly.",
  RATE_LIMITED: "The assistant is busy. Wait briefly before trying again.",
  REQUEST_CONFLICT: "This request ID was already used for different input. Submit a new question.",
} as const;
export type ErrorCode = keyof typeof errors;

export type Outcome =
  | { status: "answer"; query: Query; player: Player; coverage: Coverage; evidence: Evidence[];
      provenance: Provenance; calculation: Calculation; context?: string }
  | { status: "clarification"; code: "AMBIGUOUS_PLAYER"; choices: Player[]; context?: string }
  | { status: "error"; code: ErrorCode; query?: Query; player?: Player; coverage?: Coverage;
      evidence?: Evidence[]; provenance?: Provenance; context?: string };
export type Reply = Outcome & { correlationId: string };

export type AssistantRequest = {
  kind: "ask";
  requestId: string;
  question: string;
  context?: string;
} | {
  kind: "select";
  requestId: string;
  playerId: number;
  context: string;
};

export function failure(code: ErrorCode): Extract<Outcome, { status: "error" }> {
  return { status: "error", code };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(value + "T00:00:00Z");
  return Number.isFinite(+time) && time.toISOString().slice(0, 10) === value;
}

export function isPlayerId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isFilters(value: unknown): value is Filters {
  if (!isRecord(value) || Object.keys(value).length !== 5 || value.sport !== "NBA" ||
      (value.window !== 5 && value.window !== 10) || typeof value.metric !== "string" ||
      !Object.prototype.hasOwnProperty.call(metrics, value.metric) || !isDate(value.asOf) || !isRecord(value.operation)) return false;

  const operation = value.operation;
  if (operation.kind === "average") return Object.keys(operation).length === 1;
  return operation.kind === "count" && Object.keys(operation).length === 3 &&
    typeof operation.comparator === "string" && Object.prototype.hasOwnProperty.call(operators, operation.comparator) &&
    typeof operation.threshold === "number" && Number.isFinite(operation.threshold) &&
    operation.threshold >= 0 && operation.threshold <= 200;
}

export function parseRequest(value: unknown): AssistantRequest | undefined {
  if (!isRecord(value) || typeof value.requestId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.requestId)) return;
  const context = value.context;
  if (context !== undefined && (typeof context !== "string" || context.length > 1200 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(context))) return;
  if (value.kind === "ask" &&
      Object.keys(value).every((key) => ["kind", "requestId", "question", "context"].includes(key)) &&
      typeof value.question === "string" && value.question.length <= maxQuestionLength && value.question.trim()) {
    return { kind: "ask", requestId: value.requestId, question: value.question.trim(), context: typeof context === "string" ? context : undefined };
  }
  if (value.kind === "select" && Object.keys(value).length === 4 &&
      isPlayerId(value.playerId) && typeof context === "string") {
    return { kind: "select", requestId: value.requestId, playerId: value.playerId, context };
  }
}

export function easternDate(now: Date, previous = false): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  if (!previous) return date;
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
