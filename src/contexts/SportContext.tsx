import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SPORT,
  ENABLED_SPORTS,
  SPORTS,
  SportConfig,
  SportKey,
  isValidSport,
} from "@/lib/sports/registry";

const STORAGE_KEY = "betstreaks.activeSport";

interface SportContextValue {
  sport: SportKey;
  config: SportConfig;
  setSport: (sport: SportKey) => void;
  availableSports: SportConfig[];
}

const SportContext = createContext<SportContextValue | undefined>(undefined);

function readInitialSport(): SportKey {
  if (typeof window === "undefined") return DEFAULT_SPORT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValidSport(stored)) return stored;
  } catch {
    // ignore (private mode, etc.)
  }
  return DEFAULT_SPORT;
}

export function SportProvider({ children }: { children: React.ReactNode }) {
  const [sport, setSportState] = useState<SportKey>(() => readInitialSport());

  const setSport = useCallback((next: SportKey) => {
    if (!isValidSport(next)) return;
    setSportState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    // Notify listeners (e.g. analytics) — non-fatal if unused.
    try {
      window.dispatchEvent(new CustomEvent("betstreaks:sport-changed", { detail: { sport: next } }));
    } catch {
      // ignore
    }
  }, []);

  // Keep state in sync if the value changes in another tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && isValidSport(e.newValue)) {
        setSportState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<SportContextValue>(
    () => ({
      sport,
      config: SPORTS[sport],
      setSport,
      availableSports: ENABLED_SPORTS,
    }),
    [sport, setSport],
  );

  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

export function useSport(): SportContextValue {
  const ctx = useContext(SportContext);
  if (!ctx) {
    // Safe fallback so components don't crash if accidentally rendered outside
    // the provider (shouldn't happen, but defensive).
    return {
      sport: DEFAULT_SPORT,
      config: SPORTS[DEFAULT_SPORT],
      setSport: () => {},
      availableSports: ENABLED_SPORTS,
    };
  }
  return ctx;
}
