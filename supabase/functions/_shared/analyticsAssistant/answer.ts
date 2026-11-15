import { calculate, validSnapshot } from "./calculate.ts";
import { failure, type AssistantRequest, type Filters, type Outcome } from "./contract.ts";
import { contextCodec } from "./context.ts";
import { normalizeName, parseQuestion } from "./questions.ts";
import type { GameLogSource } from "./source.ts";

export async function answer(
  input: AssistantRequest,
  userId: string,
  secret: string,
  source: GameLogSource,
  now: Date,
  signal: AbortSignal,
): Promise<Outcome> {
  if (!validSnapshot(source.snapshot)) return failure("DATASET_UNAVAILABLE");
  const codec = contextCodec(secret, userId);
  const prior = input.context ? await codec.read(input.context, +now) : undefined;
  if (input.context && !prior) return failure("INVALID_CONTEXT");

  let playerId: number;
  let filters: Filters;
  if (input.kind === "select") {
    if (prior?.kind !== "clarify" || !prior.choices.includes(input.playerId)) return failure("INVALID_SELECTION");
    playerId = input.playerId;
    filters = prior.filters;
  } else {
    const question = parseQuestion(input.question, source.snapshot.coverageThrough, now);
    if (!question) return failure("UNSUPPORTED_QUESTION");
    if (question.kind === "follow_up") {
      if (prior?.kind !== "resolved") return failure("CONTEXT_REQUIRED");
      playerId = prior.playerId;
      filters = { ...prior.filters, ...question.change };
    } else {
      const matches = source.players.filter((player) => player.sport === "NBA" &&
        normalizeName(player.name) === question.name && (!question.team || player.team === question.team));
      const choices = [...new Map(matches.map((player) => [player.id, player])).values()].slice(0, 5);
      if (choices.length === 0) return failure("PLAYER_NOT_FOUND");
      if (choices.length > 1) {
        const context = await codec.sign({
          kind: "clarify", filters: question.filters, choices: choices.map((choice) => choice.id),
        }, +now);
        return { status: "clarification", code: "AMBIGUOUS_PLAYER", choices, context };
      }
      playerId = choices[0].id;
      filters = question.filters;
    }
  }

  const player = source.players.find((candidate) => candidate.id === playerId && candidate.sport === "NBA");
  if (!player) return failure("PLAYER_NOT_FOUND");
  const outcome = await calculate(source, { ...filters, playerId }, player, now, signal);
  const context = await codec.sign({ kind: "resolved", filters, playerId }, +now);
  return { ...outcome, context };
}
