import { useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  errors, failure, isDate, isFilters, isPlayerId, isRecord,
  type AssistantRequest, type Reply,
} from "../../supabase/functions/_shared/analyticsAssistant/contract.ts";

function isPlayer(value: unknown) {
  return isRecord(value) && isPlayerId(value.id) && value.sport === "NBA" &&
    typeof value.name === "string" && typeof value.team === "string";
}

function validDetails(value: Record<string, unknown>) {
  if (!isPlayer(value.player) || !isRecord(value.query)) return false;
  const { playerId, ...filters } = value.query;
  if (!isPlayerId(playerId) || !isFilters(filters)) return false;
  const provenance = value.provenance;
  if (!isRecord(provenance) || typeof provenance.dataset !== "string" ||
      typeof provenance.source !== "string" || typeof provenance.revision !== "string" ||
      !isDate(provenance.coverageThrough) || typeof provenance.snapshotAt !== "string" ||
      typeof provenance.computedAt !== "string" ||
      (provenance.latestGameDate !== null && !isDate(provenance.latestGameDate)) ||
      (provenance.fetchedAt !== null && typeof provenance.fetchedAt !== "string") ||
      !["frozen_fixture", "verified_snapshot", "stale"].includes(String(provenance.freshness))) return false;
  if (value.coverage === undefined && value.evidence === undefined) return value.status === "error";
  if (!isRecord(value.coverage) || !Array.isArray(value.evidence) || value.evidence.length > 10) return false;
  return ["requested", "appearances", "known", "missing"].every((key) => {
    const count = (value.coverage as Record<string, unknown>)[key];
    return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 10;
  }) && value.evidence.every((row) => isRecord(row) && typeof row.gameId === "string" &&
    isDate(row.date) && (row.value === null || Number.isSafeInteger(row.value)));
}

function isReply(value: unknown): value is Reply {
  if (!isRecord(value) || typeof value.correlationId !== "string" ||
      (value.context !== undefined && typeof value.context !== "string")) return false;
  if (value.status === "clarification") {
    return value.code === "AMBIGUOUS_PLAYER" && typeof value.context === "string" &&
      Array.isArray(value.choices) && value.choices.length >= 2 && value.choices.length <= 5 &&
      value.choices.every(isPlayer);
  }
  if (value.status === "error") {
    return typeof value.code === "string" && Object.prototype.hasOwnProperty.call(errors, value.code) &&
      (value.query === undefined ? value.coverage === undefined && value.evidence === undefined &&
        value.provenance === undefined && value.player === undefined : validDetails(value));
  }
  if (value.status !== "answer" || !validDetails(value) || !isRecord(value.calculation)) return false;
  const calculation = value.calculation;
  const query = value.query as { operation: { kind: string; comparator?: string; threshold?: number } };
  if (calculation.kind !== query.operation.kind || !Number.isSafeInteger(calculation.denominator) ||
      Number(calculation.denominator) <= 0) return false;
  return calculation.kind === "average"
    ? Number.isSafeInteger(calculation.sum) && Number.isFinite(calculation.value)
    : calculation.comparator === query.operation.comparator && calculation.threshold === query.operation.threshold &&
      [calculation.hits, calculation.ties, calculation.pushes].every(Number.isSafeInteger);
}

export function useAnalyticsAssistant() {
  const [result, setResult] = useState<Reply | null>(null);
  const [pending, setPending] = useState(false);
  const [hasContext, setHasContext] = useState(false);
  const context = useRef<string>();
  const active = useRef<AbortController>();
  useEffect(() => () => {
    active.current?.abort();
    active.current = undefined;
  }, []);

  function cancel() {
    active.current?.abort();
    active.current = undefined;
    setPending(false);
  }

  function clearContext() {
    context.current = undefined;
    setHasContext(false);
  }

  function reset() {
    cancel();
    clearContext();
    setResult(null);
  }

  async function send(input: AssistantRequest) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analytics-assistant", {
        body: input,
        signal: controller.signal,
        timeout: 6000,
      });
      const payload: unknown = error instanceof FunctionsHttpError ? await error.context.json() : data;
      if (active.current !== controller) return;
      const next = isReply(payload) ? payload : { ...failure("SOURCE_UNAVAILABLE"), correlationId: "" };
      if (next.status === "error" && ["AUTH_REQUIRED", "INVALID_CONTEXT"].includes(next.code)) clearContext();
      if (next.context) {
        context.current = next.context;
        setHasContext(next.status !== "clarification");
      }
      setResult(next);
    } catch {
      if (active.current === controller) setResult({ ...failure("SOURCE_UNAVAILABLE"), correlationId: "" });
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setPending(false);
      }
    }
  }

  function ask(question: string, fresh = false) {
    if (active.current) return;
    if (fresh) clearContext();
    return send({ kind: "ask", requestId: crypto.randomUUID(), question, context: context.current });
  }

  function select(playerId: number) {
    if (context.current) return send({ kind: "select", requestId: crypto.randomUUID(), playerId, context: context.current });
  }

  return { result, pending, hasContext, ask, select, cancel, reset };
}
