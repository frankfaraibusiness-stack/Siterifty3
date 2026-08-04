"use client";

import { useCallback, useEffect, useState } from "react";

// New feature — the original marketplace.js never had a recent-searches
// list (its search was always just the small suggestions dropdown), so
// this has no legacy source to port from. Modeled on the same
// localStorage pattern this app already uses for other small bits of
// client-only preference state (srf_compactMode in useSettingsState.ts,
// the theme picker's srf_theme in ThemeModalProvider.tsx) — same
// "srf_" key prefix, same read-once-on-mount + write-on-change shape.
const STORAGE_KEY = "srf_recentSearches";
const MAX_ITEMS = 15;

export function useRecentSearches() {
  const [items, setItems] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed.filter((x) => typeof x === "string"));
      }
    } catch {
      // ignore — corrupt/unavailable storage just starts empty
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full/unavailable — the in-memory list still works for this session
    }
  }, []);

  // Adds to the front, de-duping case-insensitively (re-searching
  // something bumps it back to the top instead of creating a second
  // entry), capped at MAX_ITEMS — same behavior YouTube's own history
  // shows in the reference screenshot.
  const add = useCallback(
    (term: string) => {
      const clean = term.trim();
      if (!clean) return;
      setItems((prev) => {
        const deduped = prev.filter((x) => x.toLowerCase() !== clean.toLowerCase());
        const next = [clean, ...deduped].slice(0, MAX_ITEMS);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const remove = useCallback(
    (term: string) => {
      setItems((prev) => {
        const next = prev.filter((x) => x !== term);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  return { items, loaded, add, remove, clear };
}
