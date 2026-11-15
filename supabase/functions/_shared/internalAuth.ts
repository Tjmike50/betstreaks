import { timingSafeEqual } from "node:crypto";

export interface InternalSecret {
  env: string;
  header: string;
}

export const dailyPickCron = {
  env: "DAILY_PICK_CRON_SECRET",
  header: "x-daily-pick-cron-secret",
};

export const pipelineCron = {
  env: "PIPELINE_CRON_SECRET",
  header: "x-pipeline-cron-secret",
};

export const refreshCaller = {
  env: "REFRESH_SECRET",
  header: "x-admin-secret",
};

export const scheduleVerification = {
  env: "SCHEDULE_VERIFICATION_SECRET",
  header: "x-schedule-verification-secret",
};

export function readInternalSecret(secret: InternalSecret): string | undefined {
  const value = Deno.env.get(secret.env);
  return value && /^[A-Za-z0-9_-]{32,}$/.test(value) ? value : undefined;
}

export function matchesSecret(candidate: string | null, expected: string | undefined): boolean {
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(candidate);
  const right = encoder.encode(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
