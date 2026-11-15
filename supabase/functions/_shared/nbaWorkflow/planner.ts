import { isRecord } from "../analyticsAssistant/contract.ts";
import { isMetric, tools, type ResearchPlan, type ResearchTool, validLine } from "./domain.ts";

export function validatePlan(value: unknown, defaults: ResearchPlan): ResearchPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length < 1 || value.tools.length > tools.length ||
    !value.tools.every((tool) => tools.includes(tool)) || new Set(value.tools).size !== value.tools.length) return;
  const line = value.line ?? defaults.line;
  const metric = value.metric ?? defaults.metric;
  const window = value.window ?? defaults.window;
  const side = value.side ?? defaults.side;
  if (!validLine(line) || !isMetric(metric) || (window !== 5 && window !== 10) ||
    (side !== "over" && side !== "under" && side !== "at_least")) return;
  return { tools: value.tools, line, metric, window, side };
}

export function rulesPlan(question: string, defaults: ResearchPlan): ResearchPlan | undefined {
  const text = question.trim().toLowerCase();
  const selected: ResearchTool[] = [];
  if (/\b(hits?|hit rate|games?|above|below|over|under|rebounds?|points?|assists?|three|last)\b/.test(text) ||
    /^what about\b/.test(text)) selected.push("game_logs");
  if (/\b(score|rank|ranking|ranked|factor|factors|confidence|why)\b/.test(text)) selected.push("scores");
  if (/\b(price|prices|odds|book|sportsbook|changed|moved|movement|quote|quotes|line)\b/.test(text)) selected.push("quotes");
  if (/\b(available|availability|injury|injuries|out|playing|questionable|status)\b/.test(text)) selected.push("availability");
  if (!selected.length) return;
  const newLine = /\b(?:about|over|under|above|below|line(?: at)?)\s+(\d+(?:\.\d+)?)(?![\d.]|\s*games|\s*appearances)/.exec(text);
  const line = newLine ? Number(newLine[1]) : defaults.line;
  if (!validLine(line)) return;
  const metric = /\brebounds?\b/.test(text) ? "REB" : /\bassists?\b/.test(text) ? "AST"
    : /\b(?:threes?|three[- ]pointers?|3pm)\b/.test(text) ? "3PM" : /\bpoints?\b/.test(text) ? "PTS" : defaults.metric;
  const window = /\blast 10\b/.test(text) ? 10 : /\blast 5\b/.test(text) ? 5 : defaults.window;
  const side = /\bat least\b/.test(text) ? "at_least"
    : /\b(?:under|below)\s+\d/.test(text) ? "under"
    : /\b(?:over|above)\s+\d/.test(text) ? "over" : defaults.side;
  return { tools: selected, line, metric, window, side };
}

// The same Google Gemini gateway used by the existing NBA Builder and Analyzer.
// The model may choose read-only operations. Scores and prose from it are discarded.
export async function googlePlan(options: {
  key: string; model: string; question: string; defaults: ResearchPlan; signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<ResearchPlan | undefined> {
  const response = await (options.fetcher ?? fetch)("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      response_format: { type: "json_object" },
      max_tokens: 300,
      messages: [
        { role: "system", content: "Route a basketball research question into JSON only. Allowed keys are tools, line, metric, window, side. " +
          "tools is a nonempty subset of game_logs, scores, quotes, availability. Preserve defaults unless the question " +
          "explicitly changes the threshold, side (over, under, at_least), metric (PTS, REB, AST, 3PM), or last-5/last-10 window. " +
          "Return an empty tools array for unsupported questions, predictions or requests to act. Do not provide facts or prose." },
        { role: "user", content: JSON.stringify({ question: options.question, defaults: options.defaults }) },
      ],
    }),
  });
  if (!response.ok) return;
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 2000) return;
  return validatePlan(JSON.parse(content), options.defaults);
}
