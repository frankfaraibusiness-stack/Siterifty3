"use client";

// Lightweight, disposable UI-confirmation toasts — "Link copied",
// "Filters cleared", "Added to favorites", etc. Deliberately separate
// from components/notifications/NotificationToastStack.tsx: that system
// is for real notifications (deal updates, messages) that are persisted
// server-side and have a "missed while away" panel. These toasts have no
// backing data, exist only for the moment they're shown, and vanish —
// calling useSrToast().show(...) is fire-and-forget, no Firestore write,
// no auth requirement, safe to call from anywhere (signed in or not).
import { createContext, useCallback, useContext, useRef, useState } from "react";

export type SrToastType = "success" | "error" | "info";

interface SrToastItem {
  id: string;
  message: string;
  type: SrToastType;
}

interface SrToastContextValue {
  show: (message: string, type?: SrToastType) => void;
}

const SrToastContext = createContext<SrToastContextValue | null>(null);

const DURATION_MS = 2600;

// Small inline icon set — kept local rather than pulling in an icon
// library dependency for three glyphs.
function ToastIcon({ type }: { type: SrToastType }) {
  if (type === "success") {
    return (
      <svg className="sr-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg className="sr-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    );
  }
  return (
    <svg className="sr-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </svg>
  );
}

function Toast({ item, onDone }: { item: SrToastItem; onDone: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dismissedRef = useRef(false);

  // Double-rAF before showing, same pattern as NotificationToastStack —
  // lets the unanimated insert paint first so the CSS transition runs.
  useState(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    const timer = setTimeout(dismiss, DURATION_MS);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  });

  function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setVisible(false);
    setLeaving(true);
    setTimeout(() => onDone(item.id), 240);
  }

  return (
    <div
      className={`sr-toast t-${item.type}${visible ? " show" : ""}${leaving ? " leaving" : ""}`}
      role="status"
      onClick={dismiss}
    >
      <ToastIcon type={item.type} />
      {item.message}
    </div>
  );
}

export function SrToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<SrToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback((message: string, type: SrToastType = "success") => {
    idRef.current += 1;
    const id = `srt-${idRef.current}`;
    setItems((prev) => [...prev, { id, message, type }]);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <SrToastContext.Provider value={{ show }}>
      {children}
      <div id="srToastStack">
        {items.map((item) => (
          <Toast key={item.id} item={item} onDone={remove} />
        ))}
      </div>
    </SrToastContext.Provider>
  );
}

export function useSrToast(): SrToastContextValue {
  const ctx = useContext(SrToastContext);
  if (!ctx) {
    // Fails soft rather than throwing — a toast call from a component
    // that somehow renders outside the provider (or during a test/
    // Storybook-style isolated render) shouldn't crash the page over a
    // non-critical confirmation message.
    return { show: () => {} };
  }
  return ctx;
}
