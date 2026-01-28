import { useState, useEffect } from "react";

const STORAGE_KEY = "joined_waitlist";

export function usePremiumWaitlist() {
  const [hasJoinedWaitlist, setHasJoinedWaitlist] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  const markAsJoined = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setHasJoinedWaitlist(true);
  };

  // Listen for storage changes from other tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setHasJoinedWaitlist(e.newValue === "true");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return { hasJoinedWaitlist, markAsJoined };
}
