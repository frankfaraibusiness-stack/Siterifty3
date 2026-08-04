"use client";

// Ports mpShowAdThenAction + mpOpenPreview + mpOpenGameFullscreen from
// Js/marketplace.js (~lines 3600-3730 and 2156-2200). Free-plan viewers
// get a 10s skippable ad countdown (#mpAdOverlay) before either preview
// opens; paid plans skip straight to the preview. Website listings open
// their `url` directly in the iframe; game listings additionally handle
// gameType === 'upload' by fetching the game's HTML and loading it via
// srcdoc (falls back to a plain iframe src on fetch failure), caching
// the result so re-opening the same game during one session doesn't
// re-fetch. Shared by WebsiteListingBody and GameListingBody so the two
// call sites don't duplicate this markup/state.
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { usePlansModal } from "@/components/billing/PlansModalProvider";

const AD_BANNER = {
  key: "837d8d50ffa851dddd18e0f1d01833aa",
  width: 320,
  height: 50,
  invokeSrc: "https://beavercolourfuldelinquent.com/837d8d50ffa851dddd18e0f1d01833aa/invoke.js",
};
const AD_RECT = {
  key: "02d530955f964bb754200c047d5cab26",
  width: 300,
  height: 250,
  invokeSrc: "https://beavercolourfuldelinquent.com/02d530955f964bb754200c047d5cab26/invoke.js",
};

function adSrcDoc(unit: typeof AD_BANNER) {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style>" +
    "</head><body>" +
    "<script>atOptions = " +
    JSON.stringify({ key: unit.key, format: "iframe", height: unit.height, width: unit.width, params: {} }) +
    ";<" +
    "/script>" +
    '<script src="' +
    unit.invokeSrc +
    '"><' +
    "/script>" +
    "</body></html>"
  );
}

interface PreviewTarget {
  title: string;
  // Website preview: just a URL loaded directly in the iframe.
  // Game preview: url + gameType, so the upload/srcdoc branch can run.
  url: string;
  gameType?: string;
}

export function useAdGatedPreview() {
  const { profile } = useAuth();
  const { openPlansModal } = usePlansModal();

  const [adActive, setAdActive] = useState(false);
  const [adDone, setAdDone] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(10);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [iframeSrc, setIframeSrc] = useState("");
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string | undefined>(undefined);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<PreviewTarget | null>(null);
  // Caches a fetched game's HTML per URL so re-opening the same game
  // during this session doesn't re-fetch it — mirrors the original's
  // per-listing _gameBlobUrl closure variable.
  const gameHtmlCache = useRef<Map<string, string>>(new Map());

  const isFreePlan = (profile?.plan || "free").toLowerCase() === "free";

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runPreview = useCallback(async (target: PreviewTarget) => {
    setPreviewTitle(target.title);
    setPreviewLoading(true);
    setIframeSrc("");
    setIframeSrcDoc(undefined);
    setPreviewOpen(true);

    if (target.gameType === "upload") {
      const cached = gameHtmlCache.current.get(target.url);
      if (cached !== undefined) {
        setIframeSrcDoc(cached);
      } else {
        try {
          const res = await fetch(target.url);
          const html = await res.text();
          gameHtmlCache.current.set(target.url, html);
          setIframeSrcDoc(html);
        } catch {
          // Fetch failed — fall back to loading the URL directly.
          setIframeSrc(target.url);
        }
      }
    } else {
      setIframeSrc(target.url);
    }
  }, []);

  const open = useCallback(
    (target: PreviewTarget) => {
      pendingRef.current = target;

      if (!isFreePlan) {
        runPreview(target);
        return;
      }

      clearTimer();
      setAdDone(false);
      setSecondsLeft(10);
      setAdActive(true);

      let sec = 10;
      timerRef.current = setInterval(() => {
        sec -= 1;
        setSecondsLeft(Math.max(sec, 0));
        if (sec <= 0) {
          clearTimer();
          setAdDone(true);
        }
      }, 1000);
    },
    [isFreePlan, runPreview, clearTimer]
  );

  const skipAd = useCallback(() => {
    setAdActive(false);
    clearTimer();
    if (pendingRef.current) runPreview(pendingRef.current);
  }, [runPreview, clearTimer]);

  const removeAdsClick = useCallback(() => {
    setAdActive(false);
    clearTimer();
    openPlansModal();
  }, [openPlansModal, clearTimer]);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setIframeSrc("");
    setIframeSrcDoc(undefined);
    setPreviewLoading(true);
  }, []);

  const AdOverlayHost = useCallback(() => {
    if (!adActive) return null;
    return (
      <div id="mpAdOverlay" className="active">
        <div id="mpAdOverlayInner">
          <div id="mpAdOverlayHeader">
            <div id="mpAdOverlayTitle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <span id="mpAdOverlayTitleText">{pendingRef.current?.title || "Preparing…"}</span>
            </div>
            <button
              id="mpAdOverlayRemoveAds"
              style={{ display: "flex", background: "rgba(163,230,53,0.12)", border: "1px solid rgba(163,230,53,0.3)", color: "#a3e635", fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s", whiteSpace: "nowrap" }}
              onClick={removeAdsClick}
            >
              ❖ Remove Ads
            </button>
          </div>
          <div id="mpAdOverlayBody">
            <div id="mpAdBox">
              <iframe
                width={AD_RECT.width}
                height={AD_RECT.height}
                scrolling="no"
                title="Advertisement"
                loading="lazy"
                srcDoc={adSrcDoc(AD_RECT)}
                style={{ border: "none", maxWidth: "100%" }}
              />
            </div>
            <div id="mpAdCountdownWrap">
              <div id="mpAdCountdownBar">
                <div id="mpAdCountdownFill" style={{ transform: `scaleX(${secondsLeft / 10})` }} />
              </div>
              <div id="mpAdCountdownText">{adDone ? "Done!" : `${secondsLeft}s`}</div>
            </div>
          </div>
          <button id="mpAdSkipBtn" style={{ display: adDone ? "block" : "none" }} onClick={skipAd}>
            Continue →
          </button>
        </div>
      </div>
    );
  }, [adActive, adDone, secondsLeft, removeAdsClick, skipAd]);

  const PreviewHost = useCallback(() => {
    if (!previewOpen) return null;
    return (
      <div id="mpSitePreview" style={{ display: "flex", flexDirection: "column" }}>
        <div className="mp-preview-header">
          <div className="mp-preview-top-ad" id="mpPreviewTopAd">
            <iframe
              width={AD_BANNER.width}
              height={AD_BANNER.height}
              scrolling="no"
              title="Advertisement"
              loading="lazy"
              srcDoc={adSrcDoc(AD_BANNER)}
              style={{ border: "none", maxWidth: "100%" }}
            />
          </div>
          <div className="mp-preview-ctrl-row">
            <span
              id="mpPreviewGameTitle"
              style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {previewTitle}
            </span>
            {isFreePlan && (
              <button
                id="mpPreviewRemoveAds"
                style={{ display: "flex", background: "rgba(163,230,53,0.12)", border: "1px solid rgba(163,230,53,0.3)", color: "#a3e635", fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => openPlansModal()}
              >
                ❖ Remove Ads
              </button>
            )}
            <button className="mp-preview-close" id="mpPreviewClose" onClick={closePreview}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Close preview
            </button>
          </div>
        </div>
        <div id="mpSiteFrameWrap">
          <div id="mpPreviewSpinner" className={previewLoading ? "" : "hidden"}>
            <div className="mp-spinner-ring" />
            <span className="mp-spinner-label">Loading, please wait…</span>
          </div>
          <iframe
            id="mpSiteFrame"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
            src={iframeSrcDoc ? undefined : iframeSrc}
            srcDoc={iframeSrcDoc}
            style={{ opacity: previewLoading ? 0 : 1 }}
            onLoad={() => setPreviewLoading(false)}
          />
        </div>
      </div>
    );
  }, [previewOpen, previewTitle, previewLoading, iframeSrc, iframeSrcDoc, isFreePlan, openPlansModal, closePreview]);

  return { openPreview: open, AdOverlayHost, PreviewHost };
}
