"use client";

// Ports the IMAGE LIGHTBOX from Js/misc-modals.js (index.html lines
// 22743-22884 + the #srfLightbox markup at 5447-5457) — full-screen
// zoomable/pannable image viewer, opened by clicking any element with
// the .srf-lightbox-trigger class (cover images, gallery screenshots on
// the listing detail page).
//
// The original used a single global DOM node + a document-level click
// delegation listener for `.srf-lightbox-trigger`, since it was one
// big single-page app. This keeps the same delegation pattern (so every
// existing `.srf-lightbox-trigger` + `data-src` already in the listing
// body components works unmodified — see WebsiteListingBody.tsx,
// AppListingBody.tsx, GameListingBody.tsx) but as a React provider
// mounted once in the root layout, with the actual open/close/zoom state
// as component state instead of module-level closure variables.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useScrollLock } from "@/lib/useScrollLock";

const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface LightboxContextValue {
  open: (src: string) => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

export function useLightbox() {
  const ctx = useContext(LightboxContext);
  if (!ctx) throw new Error("useLightbox must be used within ImageLightboxProvider");
  return ctx;
}

export function ImageLightboxProvider({ children }: { children: React.ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchStart = useRef({ dist: 0, scale: 1 });
  const lastTapTime = useRef(0);

  const isOpen = src !== null;
  useScrollLock(isOpen);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const clampPan = useCallback((x: number, y: number, s: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x, y };
    const maxPanX = (wrap.clientWidth * (s - 1)) / 2 + 200;
    const maxPanY = (wrap.clientHeight * (s - 1)) / 2 + 200;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  }, []);

  const open = useCallback((imgSrc: string) => {
    setSrc(imgSrc);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const close = useCallback(() => {
    setSrc(null);
    resetZoom();
  }, [resetZoom]);

  // Delegate: any .srf-lightbox-trigger click anywhere on the page —
  // same document-level delegation as the original, so listing body
  // components don't each need their own click handler.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const trigger = target.closest<HTMLElement>(".srf-lightbox-trigger");
      if (!trigger) return;
      if (target.tagName === "BUTTON" || target.closest("button")) return;
      const triggerSrc = trigger.dataset.src || trigger.querySelector("img")?.src;
      if (triggerSrc && !triggerSrc.includes("placehold.co")) {
        e.stopPropagation();
        open(triggerSrc);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  // Scroll-wheel zoom (desktop)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));
        if (next <= 1.01) {
          setPan({ x: 0, y: 0 });
        } else {
          setPan((p) => clampPan(p.x, p.y, next));
        }
        return next;
      });
    },
    [clampPan]
  );

  // Drag to pan (mouse)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale <= 1.01) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
    },
    [scale, pan]
  );

  useEffect(() => {
    if (!dragging) return;
    function onMouseMove(e: MouseEvent) {
      const nx = dragStart.current.panX + (e.clientX - dragStart.current.x);
      const ny = dragStart.current.panY + (e.clientY - dragStart.current.y);
      setPan(clampPan(nx, ny, scale));
    }
    function onMouseUp() {
      setDragging(false);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, scale, clampPan]);

  // Double-click / double-tap to toggle zoom
  const toggleZoom = useCallback(() => {
    if (scale > 1.01) {
      resetZoom();
    } else {
      setScale(2.2);
    }
  }, [scale, resetZoom]);

  const onTouchEndDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      toggleZoom();
    }
    lastTapTime.current = now;
  }, [toggleZoom]);

  // Pinch to zoom + drag to pan (touch)
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStart.current.dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStart.current.scale = scale;
      } else if (e.touches.length === 1 && scale > 1.01) {
        setDragging(true);
        dragStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
    },
    [scale, pan]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const next = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, pinchStart.current.scale * (dist / pinchStart.current.dist))
        );
        setScale(next);
        setPan((p) => clampPan(p.x, p.y, next));
      } else if (e.touches.length === 1 && dragging) {
        e.preventDefault();
        const nx = dragStart.current.panX + (e.touches[0].clientX - dragStart.current.x);
        const ny = dragStart.current.panY + (e.touches[0].clientY - dragStart.current.y);
        setPan(clampPan(nx, ny, scale));
      }
    },
    [dragging, scale, clampPan]
  );

  const onTouchEnd = useCallback(() => {
    setDragging(false);
    if (scale <= 1.01) resetZoom();
    onTouchEndDoubleTap();
  }, [scale, resetZoom, onTouchEndDoubleTap]);

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      <div id="srfLightbox" className={isOpen ? "active" : ""}>
        <div id="srfLbBackdrop" onClick={() => scale <= 1.01 && close()} />
        <button id="srfLbClose" aria-label="Close" onClick={close}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div
          id="srfLbImgWrap"
          ref={wrapRef}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {src ? (
            <img
              id="srfLbImg"
              ref={imgRef}
              src={src}
              alt="Full size image"
              draggable={false}
              className={scale > 1.01 ? `zoomed${dragging ? " dragging" : ""}` : ""}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
              onMouseDown={onMouseDown}
              onDoubleClick={(e) => {
                e.stopPropagation();
                toggleZoom();
              }}
            />
          ) : null}
        </div>
      </div>
    </LightboxContext.Provider>
  );
}
