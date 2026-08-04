"use client";

import { useCallback, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
}

let nextId = 0;

// Ports toast() from support-modals.js: fixed bottom-center pill,
// fades in via animation, auto-dismisses after 2s (fade) + 2.4s (remove).
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  const ToastHost = useCallback(
    () => (
      <>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              position: "fixed",
              bottom: "2rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 999,
              background: "#fff",
              color: "#000",
              fontWeight: 700,
              padding: "0.7rem 1.6rem",
              borderRadius: 50,
              fontSize: "0.85rem",
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              pointerEvents: "none",
              animation: "srf-toast-fade-in-up 0.3s ease forwards",
            }}
          >
            {t.message}
          </div>
        ))}
      </>
    ),
    [toasts]
  );

  return { toast, ToastHost };
}
