"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { useConfirm } from "@/lib/useConfirm";
import {
  useDealChat,
  countdownParts,
  verifyCountdownText,
  deleteCountdownText,
  paymentRequestCooldownText,
  isPaymentRequestOnCooldown,
  type DealMessage,
  type PaymentStatus,
} from "@/lib/useDealChat";
import { doc, deleteDoc, collection, getDocs, writeBatch, addDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import RequestPaymentOverlay from "./RequestPaymentOverlay";
import DealExpiredPopup from "@/components/deal/DealExpiredPopup";import SignInRequired from "@/components/auth/SignInRequired";
import { buildListingSlug } from "@/lib/slug";
import { useCurrency } from "@/lib/CurrencyContext";
import NavSpinnerIcon from "@/components/shared/NavSpinnerIcon";
import ChatLoadingState from "@/components/shared/ChatLoadingState";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the deal chat panel from Js/inbox.js (lines 937-2774): sticky
// item bar, escrow announcement bar + actions (pay/release/dispute),
// message list (text/image/link/file/transfer_zip bubbles), send box
// with attach menu, hamburger menu (report/cancel), countdowns, and the
// terminal outcome banner. The Transfer Deal checklist ("Mark Delivered"
// / "Transfer Deal") this panel opens into now lives at its own route,
// /messages/deal/[id]/transfer (see TransferDealRoute.tsx), instead of
// being rendered in-place — a real navigation entry so the Android back
// button steps out of the transfer flow instead of closing this whole
// chat. Both buttons below navigate there via router.push.

const IMGUR_CLIENT_ID = "546c25a59c58ad7";

// Staged, not-yet-sent pick from the image or file input. `previewUrl` is
// an object URL for images (revoked on removal/unmount) so the preview
// strip can show the actual picked photo rather than a generic icon —
// the most useful part of a preview is confirming it's the right image.
type PendingAttachment = {
  id: string;
  file: File;
  kind: "image" | "file";
  previewUrl: string | null;
};


function fmtTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Used only in the escrow release/payment-request confirm dialogs below —
// these state the exact amount that will actually move, so it's kept in
// real USD (not the display currency) to avoid any ambiguity about how
// much money is being released.
function priceLabel(escrowAmount: number | null, listingPrice: number | null): string {
  const amt = escrowAmount ?? listingPrice;
  return amt != null ? "$" + Number(amt).toLocaleString() + " USD" : "the agreed amount";
}

export default function DealChatPanel({
  chatRoomId,
  embedded = false,
  onBack,
}: {
  chatRoomId: string;
  // Desktop split-view (see InboxShell.tsx) mounts this directly next to
  // the thread list instead of navigating to /messages/deal/[id] as its
  // own full-screen route. `embedded` swaps the fixed, viewport-covering
  // wrapper for a plain flex-fill pane and skips the body scroll-lock
  // (the parent page manages its own scrolling — locking it from inside
  // a side-pane would be wrong). `onBack`, when provided, replaces the
  // "return to inbox" navigation below with a plain callback (selecting
  // no thread) instead of a route change, since there's no separate
  // route to leave in split-view. The checkout/transfer sub-flows still
  // navigate to their own real routes either way — those are genuine
  // full-page steps, not just "closing" this panel.
  embedded?: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const chat = useDealChat(chatRoomId);
  const { confirm, prompt, alert, ConfirmHost } = useConfirm();

  // Which inbox tab this chat was opened from — set by InboxShell via
  // ?from= when navigating here from a Chats/Deals row, so Back can
  // return to that exact tab instead of guessing from browser history
  // (see closeChat below). Defaults to "deals" for entry points that
  // don't set it (e.g. DealPopup, notifications, direct links).
  const originTab = searchParams.get("from") === "chats" ? "chats" : "deals";

  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctaBusy, setCtaBusy] = useState(false);
  const [deleteAfterCancel, setDeleteAfterCancel] = useState<{ deleteAt: number } | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState("");
  const [requestPaymentOverlayOpen, setRequestPaymentOverlayOpen] = useState(false);
  // Full-view lightbox for tapped image bubbles — previously image
  // bubbles used window.open(url, "_blank"), which redirected out to a
  // new tab/the raw image URL instead of showing it in-app. Mirrors
  // GroupChatPanel's viewerImage overlay pattern.
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  // Separate from ctaBusy on purpose: this covers the "Transfer Deal"
  // attach-pill in the message composer bar, which is a different button
  // from the announcement bar's Mark Delivered CTA (both can navigate to
  // the same /transfer route, but they're not the same element on
  // screen — reusing ctaBusy here would spinner/disable the announcement
  // bar's button when this pill is the one that was actually tapped).
  const [transferPillBusy, setTransferPillBusy] = useState(false);

  // Files/images picked from the device weren't staged anywhere — the
  // file input's onChange went straight into uploadOneFile/handleImagePick,
  // which uploads AND posts the chat message in the same call. That meant
  // picking a photo sent it immediately, with no chance to see what was
  // picked, swap it, or back out — the opposite of every other chat app's
  // pick-then-preview-then-send flow, and easy to trigger by mistake on a
  // native file/photo picker's own confirm tap.
  //
  // pendingAttachments holds what's been picked but not yet sent. Sending
  // is now a separate, explicit step (dcpSendBtn / Enter), same gesture
  // that already sends typed text — so attaching a file behaves like
  // typing a message: it sits in the composer until the user chooses to
  // send it, and can be removed before that with no side effects, since
  // nothing has touched the network yet.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSeller = !!(user && chat.room && user.uid === chat.room.sellerUid);

  // Revoke any staged-but-never-sent image preview URLs when the panel
  // unmounts (user navigated away/closed chat with a photo still staged),
  // otherwise those object URLs leak for the life of the tab.
  useEffect(() => {
    return () => {
      pendingAttachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared reference-counted lock (see lib/useScrollLock.ts) instead of a
  // hand-rolled html/body position:fixed toggle — the previous version
  // saved/restored styles independently of every other modal's lock, so
  // whichever one unmounted first could rip out another modal's lock (or
  // jump the page's scroll position) if this panel and another overlay
  // were ever open at once. The messages list itself (messagesRef below)
  // has its own independent overflow-y:auto and is the only thing meant
  // to still scroll while this is open — mark it exempt so the shared
  // hook's touch blocker doesn't also swallow scrolls inside it.
  useScrollLock(!embedded);

  // Scroll-to-bottom behavior for the message list. Previous approach
  // used two plain useEffects keyed off chat.messages with a double-rAF
  // delay — in practice that left the panel opening scrolled to the
  // TOP (oldest messages) instead of the latest ones, and new messages
  // (including ones the user just sent) didn't scroll the view down at
  // all. Root cause: useEffect runs after paint but the ref-gated
  // "first jump" effect and the "stay near bottom" effect both fired
  // off the same dependency in the same commit, so the near-bottom
  // effect could read stale scroll metrics before the first jump had
  // actually applied, and there was no guarantee a later render
  // wouldn't race the same way.
  //
  // Fix: a single useLayoutEffect (runs synchronously after DOM
  // mutations, before the browser paints — no rAF needed, no visible
  // jump) that (a) always forces scrollTop to the bottom the first
  // time this chat room has messages, and (b) on every later update,
  // checks — via a ref kept current by a scroll listener, not stale
  // render-time state — whether the user was already near the bottom,
  // and if so follows new content down. If the user has scrolled up to
  // read history, it leaves their position alone.
  const wasNearBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);

  // Called when an image bubble finishes loading (see MessageBubble's
  // onLoad below). Images load asynchronously, after the message list's
  // first paint — the layout effect below fires before the <img> has
  // any height, so it scrolls to what *looks* like the bottom, then the
  // image pops in seconds later, grows the list taller, and pushes the
  // real latest message out of view with nothing re-checking the scroll
  // position. This re-runs the same "stick to bottom if we were there"
  // logic once the image's actual height is known.
  const stickToBottom = useRef(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (!hasAutoScrolledRef.current || wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      wasNearBottomRef.current = true;
    }
  }).current;

  useEffect(() => {
    hasAutoScrolledRef.current = false;
    wasNearBottomRef.current = true;
  }, [chatRoomId]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (!chat.messages.length) return;
    if (!hasAutoScrolledRef.current) {
      // First paint of this chat room's messages — always jump straight
      // to the latest message, like every other chat app.
      el.scrollTop = el.scrollHeight;
      wasNearBottomRef.current = true;
      hasAutoScrolledRef.current = true;
      return;
    }
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages]);

  useEffect(() => {
    // expiryCancelled rooms are reopenable and must NOT auto-delete — this
    // effect (and the delete-after-30-minutes flow it drives below) is
    // only for a deliberate manual cancel (deal-chat-cancel), which is the
    // one closure reason that actually sets deleteAt server-side. Before
    // this check, an expired room fell in here too since it's also
    // cancelled: true, which meant an unresolved deal quietly deleted
    // itself 30 minutes after expiring — the opposite of reopenable.
    if (!chat.room?.cancelled || chat.room.expiryCancelled || chat.room.paymentStatus === "complete") {
      setDeleteAfterCancel(null);
      return;
    }
    const deleteAt = chat.room.deleteAt || (chat.room.cancelledAt || Date.now()) + 30 * 60 * 1000;
    setDeleteAfterCancel({ deleteAt });
  }, [chat.room?.cancelled, chat.room?.expiryCancelled, chat.room?.deleteAt, chat.room?.cancelledAt, chat.room?.paymentStatus]);

  useEffect(() => {
    if (!deleteAfterCancel) return;
    function tick() {
      const ms = deleteAfterCancel!.deleteAt - Date.now();
      if (ms <= 0) {
        setDeleteCountdown("deleting chat…");
        (async () => {
          try {
            const msgsSnap = await getDocs(collection(db, "dealChats", chatRoomId, "messages"));
            const batch = writeBatch(db);
            msgsSnap.forEach((m) => batch.delete(doc(db, "dealChats", chatRoomId, "messages", m.id)));
            await batch.commit().catch(() => {});
            if (chat.room?.sellerUid) await deleteDoc(doc(db, "users", chat.room.sellerUid, "threads", chatRoomId)).catch(() => {});
            if (chat.room?.buyerUid) await deleteDoc(doc(db, "users", chat.room.buyerUid, "threads", chatRoomId)).catch(() => {});
            await deleteDoc(doc(db, "dealChats", chatRoomId)).catch(() => {});
          } catch (e) {
            console.warn("auto-delete cancelled chat", e);
          }
          if (onBack) onBack();
          else router.push(`/messages?tab=${originTab}`);
        })();
        return;
      }
      setDeleteCountdown(deleteCountdownText(deleteAfterCancel!.deleteAt));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deleteAfterCancel, chatRoomId, chat.room, router, onBack, originTab]);

  // Back/Exit should return the user to wherever they actually came from
  // (the "chats" tab, the "deals" tab, a listing page, a notification,
  // etc.) — previously this always hardcoded /messages?tab=deals, so
  // opening a deal chat from anywhere else and tapping Back silently
  // dropped the user onto the Deals tab instead of retracing their own
  // steps, which reads as broken/disorienting navigation. router.back()
  // is the correct primitive here since this panel is a real routed page
  // (pushed via router.push, not a modal) — same convention already used
  // elsewhere in this app (see MyProfileHub's PanelHeader onBack). Falls
  // back to /messages?tab=deals only when there's no in-app history to
  // go back to (e.g. the chat was opened via a deep link / new tab),
  // rather than assuming history always exists.
  function closeChat() {
    if (onBack) {
      onBack();
      return;
    }
    router.push(`/messages?tab=${originTab}`);
  }

  async function handleSend() {
    const text = input;
    const hasText = !!text.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!hasText && !hasAttachments) return;
    if (chat.locked.locked) return;

    if (hasText) {
      setInput("");
      const result = await chat.sendMessage(text);
      if (result?.blocked) {
        setInput(text);
        await alert({
          theme: "danger",
          title: "Message not sent",
          msg: "This looks like it may be a scam attempt: " + result.blocked + " Never pay or share credentials outside Siterifty's escrow flow.",
        });
        // Don't also send attachments if the text portion was blocked —
        // matches the intent of the block (stop the interaction here)
        // rather than letting a file slip through on the same tap.
        return;
      }
    }
    if (hasAttachments) {
      await sendPendingAttachments();
    }
  }

  async function handlePay() {
    // Takes the buyer to the real checkout summary route (real listing/
    // price/fee data — see CheckoutRoute.tsx) instead of processing a
    // payment inline. chat.payEscrow (wallet-to-wallet escrow funding, in
    // useDealChat.ts) is a FUTURE PAYMENT METHOD — not called here or on
    // the checkout page. We don't currently hold a money-transmitter/
    // custodial license to let buyers pay sellers directly from wallet
    // balance (deposits are already off in the wallet modal — see
    // WalletModal.tsx). CheckoutRoute's own Pay button shows the same
    // honest "new provider coming" state this used to show inline here;
    // re-wire both once a licensed payment provider is integrated.
    //
    // setCtaBusy flips the button to its "Processing…" disabled state
    // immediately on tap — previously this button gave zero feedback
    // while router.push resolved and the checkout route's data loaded
    // (worst on a slow connection), so a tap could look like it did
    // nothing for a second or more. CheckoutRoute itself also now has a
    // matching route-level skeleton (loading.tsx) plus an inline
    // skeleton for the brief gap while the deal room doc loads, so the
    // handoff from this button press to real content is never silent.
    setCtaBusy(true);
    router.push(`/messages/deal/${chatRoomId}/checkout`);
  }

  async function handleRelease() {
    if (!chat.room) return;
    const label = priceLabel(chat.room.escrowAmount, chat.room.listingPrice);
    const ok = await confirm({
      theme: "success",
      title: "Release Funds",
      msg: `Confirm you've received and verified the item. This will release ${label} to the seller and cannot be undone from here — if there's a problem, raise a dispute instead.`,
      confirmText: "Release Funds",
    });
    if (!ok) return;
    setCtaBusy(true);
    try {
      await chat.releaseEscrow();
      await alert({ theme: "success", title: "Funds Released", msg: "The deal is now complete. Thanks for using Siterifty!" });
    } catch (err) {
      await alert({ theme: "danger", title: "Failed", msg: err instanceof Error ? err.message : "Something went wrong. Please try again." });
    } finally {
      setCtaBusy(false);
    }
  }

  async function handleDispute() {
    const reason = await prompt({
      theme: "warning",
      title: "Raise A Dispute",
      msg: "Briefly describe the issue. This freezes the escrowed funds and our team will review within 24-48 hours.",
      inputPlaceholder: "What went wrong?",
      confirmText: "Submit Dispute",
    });
    if (!reason) return;
    try {
      await chat.raiseDispute(reason);
      await alert({ theme: "warning", title: "Dispute Submitted", msg: "Funds are frozen and our team will review within 24-48 hours." });
    } catch (err) {
      await alert({ theme: "danger", title: "Failed", msg: err instanceof Error ? err.message : "Something went wrong. Please try again." });
    }
  }

  async function handleRemindBuyer() {
    if (!chat.room) return;
    // Blocked only while still within the cooldown window since the last
    // request — allowed again once it elapses, not a lifetime-once send.
    if (isPaymentRequestOnCooldown(chat.room.paymentRequestedAt)) return;
    const label = priceLabel(chat.room.escrowAmount, chat.room.listingPrice);
    setRequestPaymentOverlayOpen(true);
    try {
      await chat.remindBuyer(label);
    } catch {
      setRequestPaymentOverlayOpen(false);
      await alert({ theme: "danger", title: "Failed", msg: "Could not send the request. Please try again." });
    }
    // Overlay itself holds the 3s "sending" beat, then shows the green
    // checkmark and calls onDone (closing itself) — no ctaBusy needed here.
  }

  async function handleCancelDeal() {
    const ok = await confirm({
      theme: "danger",
      title: "Cancel Deal",
      msg: "This will permanently end the deal chat and mark the deal as cancelled. This action cannot be undone.",
      confirmText: "Cancel Deal",
    });
    if (!ok) return;
    try {
      await chat.cancelDeal();
    } catch {
      await alert({ theme: "warning", title: "Action Failed", msg: "Could not cancel the deal. Please check your connection and try again." });
    }
  }

  // Reopen/Delete for a deal closed by a missed deadline — see
  // DealExpiredPopup.tsx, shown only when chat.locked.reason is
  // "expired-reopenable" or chat.outcome.expiryCancelled (funded-then-
  // expired lands there instead — see useDealChat.ts).
  async function handleReopenExpiredDeal() {
    setReopenBusy(true);
    try {
      const out = await chat.reopenDeal();
      await alert({
        theme: "success",
        title: "Deal Reopened",
        msg: out.penalty > 0
          ? `A $${out.penalty.toFixed(2)} reopen fee was charged to your wallet. You have 7 days to resolve this deal.`
          : "You have 7 days to resolve this deal.",
      });
    } catch (e) {
      await alert({
        theme: "warning",
        title: "Could Not Reopen",
        msg: e instanceof Error ? e.message : "Something went wrong reopening this deal. Please try again.",
      });
    } finally {
      setReopenBusy(false);
    }
  }

  async function handleDeleteExpiredDeal() {
    const ok = await confirm({
      theme: "danger",
      title: "Delete Deal",
      msg: "This will permanently delete this deal chat. This action cannot be undone.",
      confirmText: "Delete Deal",
    });
    if (!ok) return;
    setReopenBusy(true);
    try {
      const msgsSnap = await getDocs(collection(db, "dealChats", chatRoomId, "messages"));
      const batch = writeBatch(db);
      msgsSnap.forEach((m) => batch.delete(doc(db, "dealChats", chatRoomId, "messages", m.id)));
      await batch.commit().catch(() => {});
      if (chat.room?.sellerUid) await deleteDoc(doc(db, "users", chat.room.sellerUid, "threads", chatRoomId)).catch(() => {});
      if (chat.room?.buyerUid) await deleteDoc(doc(db, "users", chat.room.buyerUid, "threads", chatRoomId)).catch(() => {});
      await deleteDoc(doc(db, "dealChats", chatRoomId)).catch(() => {});
      if (onBack) onBack();
      else router.push(`/messages?tab=${originTab}`);
    } catch {
      setReopenBusy(false);
      await alert({ theme: "warning", title: "Action Failed", msg: "Could not delete the deal. Please check your connection and try again." });
    }
  }

  async function handleReportUser() {
    if (!user || !chat.room) return;
    const otherUid = user.uid === chat.room.sellerUid ? chat.room.buyerUid : chat.room.sellerUid;
    const ok = await confirm({
      theme: "report",
      title: "Report User",
      msg: "Our team will review this deal and take action if needed. False reports may result in account restrictions.",
      confirmText: "Report",
    });
    if (!ok) return;
    try {
      const reportRef = await addDoc(collection(db, "reports"), {
        reporterUid: user.uid,
        reportedUid: otherUid || "",
        chatRoomId,
        reason: "deal_chat_report",
        status: "open",
        createdAt: Date.now(),
      });
      const idToken = await user.getIdToken();
      fetch("/api/aistudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "triage-report",
          idToken,
          reportId: reportRef.id,
          evidence: { reporterUid: user.uid, reportedUid: otherUid || "", chatRoomId, reason: "deal_chat_report" },
        }),
      }).catch(() => {});
    } catch (err) {
      console.warn("report write", err);
    }
    await alert({ theme: "report", title: "Report Submitted", msg: "Our team will review this within 24 hours. Thank you for keeping Siterifty safe." });
  }

  // Actually uploads + posts the chat message for one image. Upload logic
  // unchanged from before — the only change in this whole fix is *when*
  // this runs: previously called the instant a file was picked, now only
  // called from sendPendingAttachments once the user taps Send.
  async function uploadImage_upload(file: File) {
    if (!chat.room || !user) return;
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch("https://api.imgur.com/3/image", { method: "POST", headers: { Authorization: "Client-ID " + IMGUR_CLIENT_ID }, body: fd });
    const json = await res.json();
    if (!json.success) throw new Error("The image could not be uploaded. Please try a different file.");
    const now = Date.now();
    await addDoc(collection(db, "dealChats", chatRoomId, "messages"), { uid: user.uid, type: "image", imageUrl: json.data.link, createdAt: now });
    await chat.syncThreads("📷 Image", chat.room.sellerUid, chat.room.buyerUid);
  }

  // Same as above for non-image files — upload logic unchanged, only the
  // call site (and timing) moved to sendPendingAttachments.
  async function uploadFile_upload(file: File) {
    if (!user || !chat.room) return;
    if (file.type.startsWith("image/")) {
      await uploadImage_upload(file);
      return;
    }
    const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/) || ["", ""])[1].toLowerCase();
    const textExts = ["html", "htm", "css", "js", "mjs", "json", "txt", "md", "svg"];
    const idToken = await user.getIdToken();

    let body: Record<string, string>;
    if (textExts.includes(ext)) {
      const text = await file.text();
      body = { filename: file.name, content: text, encoding: "utf8" };
    } else {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = () => reject(new Error("Read failed"));
        r.readAsDataURL(file);
      });
      body = { filename: file.name, content: base64, encoding: "base64" };
    }

    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "The file could not be uploaded.");

    const now = Date.now();
    if (json.storagePath) {
      await addDoc(collection(db, "dealChats", chatRoomId, "messages"), {
        uid: user.uid, type: "transfer_zip", fileName: file.name, storagePath: json.storagePath, fileSize: json.size || file.size, createdAt: now,
      }).catch(() => {});
    } else {
      await addDoc(collection(db, "dealChats", chatRoomId, "messages"), { uid: user.uid, type: "file", fileName: file.name, fileUrl: json.url, createdAt: now }).catch(() => {});
    }
    await chat.syncThreads("📎 " + file.name, chat.room.sellerUid, chat.room.buyerUid);
  }

  // Picking from the photo pill now only stages the image for preview —
  // see pendingAttachments above. Accepts multiple since the native
  // picker can return more than one even though the input isn't
  // `multiple` in every case; each becomes its own staged card.
  function stageImages(files: File[]) {
    const staged: PendingAttachment[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      kind: "image",
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingAttachments((prev) => [...prev, ...staged]);
  }

  // Picking from the file pill stages instead of uploading immediately.
  // Non-image files don't get an object-URL preview (nothing useful to
  // show for a .zip or .html file) — the preview card falls back to a
  // filename + extension icon instead.
  function stageFiles(files: File[]) {
    const isCodeHandoff = chat.room?.transferMethods.includes("html_css_js");
    const toStage = isCodeHandoff ? files.filter((f) => /\.(html|htm|css|js)$/i.test(f.name)) : files;
    if (!toStage.length) {
      alert({ theme: "warning", title: "Unsupported File", msg: "This deal only accepts .html, .css, and .js files." });
      return;
    }
    const staged: PendingAttachment[] = toStage.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      kind: file.type.startsWith("image/") ? "image" : "file",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPendingAttachments((prev) => [...prev, ...staged]);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  // Runs at actual send time (Send button / Enter) — this is the only
  // place upload network calls happen now. Uploads staged attachments
  // one at a time so failures are attributable to a specific file rather
  // than an opaque "something failed" across a batch.
  async function sendPendingAttachments() {
    if (!pendingAttachments.length) return;
    setAttachmentBusy(true);
    const toSend = pendingAttachments;
    const failedIds = new Set<string>();
    for (const att of toSend) {
      try {
        if (att.kind === "image") {
          await uploadImage_upload(att.file);
        } else {
          await uploadFile_upload(att.file);
        }
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      } catch (e) {
        console.error("DCP attachment send error:", e);
        failedIds.add(att.id);
      }
    }
    // Only clear attachments that succeeded — keep failed ones staged so
    // the user can retry without re-picking the file, same principle as
    // handleSend restoring `input` on a blocked text message below.
    setPendingAttachments((prev) => prev.filter((a) => failedIds.has(a.id)));
    setAttachmentBusy(false);
    if (failedIds.size > 0) {
      await alert({
        theme: "warning",
        title: "Send Failed",
        msg: failedIds.size === toSend.length ? "Something went wrong sending your file(s). Please try again." : `${failedIds.size} of ${toSend.length} file(s) failed to send. Please try again for those.`,
      });
    }
  }

  // handleFilesPick removed — picking files now goes through stageFiles
  // (see above), which stages instead of uploading immediately. Upload
  // logic itself moved into uploadFile_upload/uploadImage_upload, called
  // only from sendPendingAttachments at actual send time.


  if (!user) {
    return (
      <div style={embedded ? { display: "flex", flex: 1, minHeight: 0, background: "#06060e", alignItems: "center", justifyContent: "center" } : { position: "fixed", inset: 0, background: "#06060e", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SignInRequired
          withHeaderOffset={false}
          title="Sign in to view this chat"
          description="Deal conversations, offers, and file transfers are only visible once you're signed in."
        />
      </div>
    );
  }

  const room = chat.room;

  return (
    <div
      id={embedded ? undefined : "dealChatPanel"}
      className={embedded ? "dcp-embedded" : undefined}
      style={{ display: "flex" }}
    >
      <ConfirmHost />
      {requestPaymentOverlayOpen ? (
        <RequestPaymentOverlay onDone={() => setRequestPaymentOverlayOpen(false)} />
      ) : null}
      <div className="dcp-box">
        <div className="dcp-header">
          <div className="dcp-header-left">
            <button className="dcp-back-btn" onClick={closeChat} aria-label="Back">
              <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <div className="dcp-header-titles">
              <div className="dcp-title">{room?.chatName || "Deal Chat"}</div>
              {room?.expiresAt && !room.cancelled && room.paymentStatus !== "delivered" && room.paymentStatus !== "complete" && room.paymentStatus !== "refunded" ? (
                <HeaderCountdown expiresAt={room.expiresAt} paymentStatus={room.paymentStatus} />
              ) : room?.autoReleaseAt && room.paymentStatus === "delivered" ? (
                <VerifyCountdown autoReleaseAt={room.autoReleaseAt} />
              ) : null}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <button id="dcpMenuBtn" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </button>
            <div id="dcpMenuDropdown" className={menuOpen ? "open" : ""}>
              <button className="dcp-menu-item" onClick={() => { setMenuOpen(false); handleReportUser(); }}>
                <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                Report User
              </button>
              {room && !(room.paymentStatus === "complete" || room.paymentStatus === "refunded") && !room.cancelled ? (
                <>
                  <div className="dcp-menu-divider" />
                  <button className="dcp-menu-item danger" onClick={() => { setMenuOpen(false); handleCancelDeal(); }}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    End &amp; Cancel Deal
                  </button>
                </>
              ) : room?.paymentStatus === "complete" ? (
                <>
                  <div className="dcp-menu-divider" />
                  <button className="dcp-menu-item dcp-menu-item-exit" onClick={closeChat}>
                    <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
                    Exit Chat
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {room ? <ItemBar room={room} /> : null}

        {room && !room.cancelled && !deleteAfterCancel ? (
          <AnnouncementBar
            room={room}
            isSeller={isSeller}
            busy={ctaBusy}
            requestedAt={room.paymentRequestedAt}
            onPay={handlePay}
            onRelease={handleRelease}
            onDispute={handleDispute}
            onRemindBuyer={handleRemindBuyer}
            onMarkDelivered={() => {
              // Same fix as handlePay above: flip to the busy/"Processing…"
              // state the instant this is tapped, instead of leaving the
              // button looking inert while router.push resolves and the
              // transfer route's own data loads (that route now also has
              // a route-level loading.tsx skeleton — see
              // app/messages/deal/[id]/transfer/loading.tsx).
              setCtaBusy(true);
              router.push(`/messages/deal/${chatRoomId}/transfer`);
            }}
          />
        ) : null}

        <div id="dcpMessages" ref={messagesRef} data-scroll-lock-exempt>
          {chat.chatError ? <div style={{ padding: "0.55rem 1rem", textAlign: "center", color: "#fecaca", fontSize: "0.75rem", fontWeight: 600, background: "#3f1d1d" }}>{chat.chatError}</div> : null}
          {chat.messagesLoading ? (
            <ChatLoadingState label="Loading messages…" />
          ) : chat.messages.length === 0 ? (
            <div style={{ padding: "1.5rem", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: "0.8rem" }}>No messages yet.</div>
          ) : (
            chat.messages.map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                currentUid={user.uid}
                chatRoomId={chatRoomId}
                dealId={room?.dealId || null}
                onDelete={chat.deleteMessage}
                onReport={() => alert({ theme: "report", title: "Message Reported", msg: "Our moderation team will review this message within 24 hours." })}
                onImageLoad={stickToBottom}
                onImageClick={setViewerImage}
              />
            ))
          )}
        </div>

        {(() => {
          // A deal closed by a missed deadline can surface in two ways:
          // unfunded rooms go through chat.locked (reason
          // "expired-reopenable"), while a funded-then-expired room instead
          // shows up as a terminal chat.outcome ("closed") since its
          // paymentStatus flips to "refunded" — carrying expiryCancelled
          // through outcome (see useDealChat.ts) is what lets this branch
          // catch that case too, rather than falling into the plain
          // "Deal Closed" banner below meant for a genuine final refund.
          const isExpiredReopenable =
            chat.locked.reason === "expired-reopenable" ||
            (chat.outcome?.outcome === "closed" && chat.outcome.expiryCancelled);

          if (isExpiredReopenable) {
            return (
              <DealExpiredPopup
                listingTitle={chat.room?.listingTitle || ""}
                listingPrice={chat.room?.listingPrice ?? null}
                isSeller={isSeller}
                sellerUid={chat.room?.sellerUid || null}
                submitting={reopenBusy}
                onReopen={handleReopenExpiredDeal}
                onDelete={handleDeleteExpiredDeal}
              />
            );
          }

          if (chat.outcome) {
            return (
              <div id="dcpExpiredBanner" className={chat.outcome.outcome === "successful" ? "dcp-outcome-successful" : "dcp-outcome-closed"} style={{ display: "flex" }}>
                {chat.outcome.outcome === "successful"
                  ? chat.outcome.auto
                    ? "✅ Deal Successful — the 72-hour verification window passed and funds were automatically released to the seller."
                    : "✅ Deal Successful — the buyer confirmed receipt and funds were released to the seller."
                  : chat.outcome.auto
                  ? "🔒 Deal Closed — the 14-day delivery deadline passed without the deal being completed."
                  : "🔒 Deal Closed — this deal was refunded and is now closed."}
              </div>
            );
          }

          if (deleteAfterCancel) {
            return <div id="dcpExpiredBanner" style={{ display: "flex" }}>This deal was cancelled — {deleteCountdown || "chat will be deleted shortly."}</div>;
          }

          if (chat.locked.locked) {
            return <div id="dcpExpiredBanner" style={{ display: "flex" }}>This deal was cancelled — the chat is now closed.</div>;
          }

          return null;
        })()}

        {!chat.locked.locked && !chat.outcome && !deleteAfterCancel ? (
          <div id="dcpInputRow">
            <div id="dcpAttachRow">
              <button className="dcp-attach-pill" onClick={() => imageInputRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                Image
              </button>
              <button className="dcp-attach-pill" onClick={() => fileInputRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                File
              </button>
              {isSeller ? (
                <button
                  id="dcpOptTransfer"
                  className="dcp-attach-pill dcp-transfer-pill"
                  disabled={transferPillBusy}
                  onClick={() => {
                    setTransferPillBusy(true);
                    router.push(`/messages/deal/${chatRoomId}/transfer`);
                  }}
                >
                  {transferPillBusy ? (
                    <NavSpinnerIcon size={16} />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
                  )}
                  {transferPillBusy ? "Opening…" : "Transfer Deal"}
                </button>
              ) : null}
            </div>
            <div id="dcpInputInner">
              {pendingAttachments.length > 0 ? (
                <div className="dcp-attach-preview-strip" role="list" aria-label="Attachments to send">
                  {pendingAttachments.map((att) => (
                    <div className="dcp-attach-preview-card" role="listitem" key={att.id}>
                      {att.previewUrl ? (
                        <img src={att.previewUrl} alt={att.file.name} className="dcp-attach-preview-thumb" />
                      ) : (
                        <div className="dcp-attach-preview-thumb dcp-attach-preview-file">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                        </div>
                      )}
                      <div className="dcp-attach-preview-name">{att.file.name}</div>
                      <button
                        type="button"
                        className="dcp-attach-preview-remove"
                        aria-label={`Remove ${att.file.name}`}
                        disabled={attachmentBusy}
                        onClick={() => removePendingAttachment(att.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="dcp-textarea-wrap">
                <textarea
                  id="dcpInput"
                  placeholder={pendingAttachments.length ? "Add a caption (optional)…" : "Message…"}
                  value={input}
                  disabled={chat.sending}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                />
                <button
                  id="dcpSendBtn"
                  onClick={handleSend}
                  disabled={chat.sending || attachmentBusy || (!input.trim() && !pendingAttachments.length)}
                  aria-label={pendingAttachments.length ? "Send attachment" : "Send"}
                >
                  {attachmentBusy ? (
                    <NavSpinnerIcon size={14} />
                  ) : (
                    <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) stageImages(files);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple={chat.room?.transferMethods.includes("html_css_js")}
          accept={chat.room?.transferMethods.includes("html_css_js") ? ".html,.htm,.css,.js" : "image/*,application/pdf,.doc,.docx,.txt,.zip,.html,.htm,.css,.js,.mjs,.json,.md,.svg"}
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) stageFiles(files);
          }}
        />
      </div>

      {viewerImage ? (
        <div
          onClick={() => setViewerImage(null)}
          style={{ display: "flex", position: "fixed", inset: 0, zIndex: 10100, background: "rgba(0,0,0,0.95)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", justifyContent: "center", alignItems: "center", cursor: "zoom-out" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewerImage} alt="" style={{ maxWidth: "95vw", maxHeight: "92vh", borderRadius: 12, objectFit: "contain", pointerEvents: "none" }} />
        </div>
      ) : null}
    </div>
  );
}

function HeaderCountdown({ expiresAt, paymentStatus }: { expiresAt: number; paymentStatus: PaymentStatus }) {
  const [text, setText] = useState(() => countdownParts(expiresAt - Date.now()));
  useEffect(() => {
    if (["delivered", "complete", "refunded"].includes(paymentStatus)) return;
    function tick() {
      const ms = expiresAt - Date.now();
      setText(ms <= 0 ? "Expired" : countdownParts(ms));
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [expiresAt, paymentStatus]);
  const remaining = expiresAt - Date.now();
  const color = remaining <= 0 ? "#f87171" : remaining < 43200000 ? "#f87171" : remaining < 172800000 ? "#fbbf24" : "#a3e635";
  return <div className="dcp-countdown" style={{ color }}>⏱ {text}</div>;
}

function VerifyCountdown({ autoReleaseAt }: { autoReleaseAt: number }) {
  const [text, setText] = useState(() => verifyCountdownText(autoReleaseAt));
  useEffect(() => {
    function tick() {
      setText(verifyCountdownText(autoReleaseAt));
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [autoReleaseAt]);
  const color = autoReleaseAt - Date.now() < 21600000 ? "#fbbf24" : "#a3e635";
  return <div className="dcp-countdown" style={{ color }}>⏱ {text}</div>;
}

function ItemBar({ room }: { room: { listingTitle: string; listingImage: string; listingPrice: number | null; listingId: string; chatName: string } }) {
  const { formatPriceShort } = useCurrency();
  const price = room.listingPrice != null ? formatPriceShort(room.listingPrice) : "";
  const priceTooltip = room.listingPrice != null ? `$${Number(room.listingPrice).toLocaleString()} USD` : undefined;
  return (
    <div id="dcpItemBar">
      {room.listingImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img id="dcpItemThumb" src={room.listingImage} alt="" style={{ display: "block" }} onError={(e) => (e.currentTarget.style.display = "none")} />
      ) : (
        <div id="dcpItemThumbFallback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg>
        </div>
      )}
      <div id="dcpItemInfo">
        <div id="dcpItemTitle">{room.listingTitle || room.chatName || "Listing"}</div>
        <div id="dcpItemPrice" title={priceTooltip}>{price}</div>
      </div>
      {room.listingId ? (
        <Link id="dcpViewListingBtn" href={`/listing/${buildListingSlug(room.listingTitle, room.listingId)}`} target="_blank" rel="noopener noreferrer">
          View Listing
        </Link>
      ) : null}
    </div>
  );
}

function AnnouncementBar({
  room,
  isSeller,
  busy,
  requestedAt,
  onPay,
  onRelease,
  onDispute,
  onRemindBuyer,
  onMarkDelivered,
}: {
  room: { paymentStatus: PaymentStatus; escrowAmount: number | null; listingPrice: number | null };
  isSeller: boolean;
  busy: boolean;
  requestedAt: number | null;
  onPay: () => void;
  onRelease: () => void;
  onDispute: () => void;
  onRemindBuyer: () => void;
  onMarkDelivered: () => void;
}) {
  const status = room.paymentStatus;
  if (status === "complete" || status === "refunded") return null;
  const price = priceLabel(room.escrowAmount, room.listingPrice);

  // Ticks every 30s so the cooldown clears and the button re-enables on
  // its own once an hour has passed, without needing a fresh Firestore
  // write/read to notice.
  const [cooldownText, setCooldownText] = useState(() =>
    requestedAt ? paymentRequestCooldownText(requestedAt) : ""
  );
  useEffect(() => {
    if (!requestedAt) {
      setCooldownText("");
      return;
    }
    function tick() {
      setCooldownText(paymentRequestCooldownText(requestedAt!));
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [requestedAt]);
  const requestPending = !!cooldownText;

  const ICON_SHIELD = <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
  const ICON_CARDS = (
    <>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  );
  const ICON_BOX = (
    <>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21l3-3 3 3" />
    </>
  );
  const ICON_CHECK = (
    <>
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  );
  const ICON_ALERT = (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  );

  let mode: "seller-mode" | "buyer-mode" | "disputed-mode" = isSeller ? "seller-mode" : "buyer-mode";
  let icon: React.ReactNode = null;
  let label = "";
  let msg = "";
  let cta: { text: string; onClick: () => void } | null = null;
  let sub: { text: string; onClick: () => void } | null = null;

  if (status === "unfunded") {
    if (isSeller) {
      icon = ICON_SHIELD;
      label = "Awaiting Payment";
      msg = requestPending
        ? "Payment request sent — waiting for buyer to pay " + price + " into escrow"
        : "Waiting for buyer to pay " + price + " into escrow";
      cta = { text: requestPending ? cooldownText : "Request Payment", onClick: onRemindBuyer };
    } else {
      icon = ICON_CARDS;
      label = "Payment Due";
      msg = "Pay " + price + " into escrow to start the deal";
      cta = { text: "Pay Now", onClick: onPay };
    }
  } else if (status === "funded") {
    if (isSeller) {
      icon = ICON_BOX;
      label = price + " Held In Escrow";
      msg = "Deliver the item, then mark as delivered";
      cta = { text: "Mark Delivered", onClick: onMarkDelivered };
      sub = { text: "Something wrong? Raise a dispute", onClick: onDispute };
    } else {
      icon = ICON_SHIELD;
      label = price + " Held In Escrow";
      msg = "Waiting for seller to deliver";
      sub = { text: "Something wrong? Raise a dispute", onClick: onDispute };
    }
  } else if (status === "delivered") {
    if (isSeller) {
      icon = ICON_BOX;
      label = "Delivered";
      msg = "Waiting for buyer to confirm and release " + price + " (auto-releases in 72h if no response)";
    } else {
      icon = ICON_CHECK;
      label = "Confirm Receipt";
      msg = "Release " + price + " to the seller once everything checks out — have questions first? Just ask in the chat.";
      cta = { text: "Release Funds", onClick: onRelease };
      sub = { text: "Not what you expected? Raise a dispute", onClick: onDispute };
    }
  } else if (status === "disputed") {
    mode = "disputed-mode";
    icon = ICON_ALERT;
    label = "Dispute Open";
    msg = "Funds are frozen while our team reviews this deal (24-48 hrs)";
  } else {
    return null;
  }

  return (
    <div id="dcpAnnouncementBar" className={mode}>
      <div className="dcp-ann-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </div>
      <div className="dcp-ann-text">
        <div className="dcp-ann-label">{label}</div>
        <div className="dcp-ann-msg">{msg}</div>
        {sub ? (
          <div className="dcp-ann-sub-link" onClick={sub.onClick}>
            {sub.text}
          </div>
        ) : null}
      </div>
      {cta ? (
        <button className="dcp-ann-cta" disabled={busy || (isSeller && status === "unfunded" && requestPending)} onClick={cta.onClick}>
          {busy ? "Processing…" : cta.text}
        </button>
      ) : null}
    </div>
  );
}

function stripEmoji(text: string): string {
  return (text || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]\uFE0F?/gu, "").replace(/\s{2,}/g, " ").trim();
}

function systemMsgMeta(text: string): { theme: string; icon: React.ReactNode } {
  const t = text || "";
  const CHECK = <polyline points="20 6 9 17 4 12" />;
  const COINS = (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </>
  );
  const BOX = (
    <>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  );
  const REFUND = (
    <>
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  );
  const ALERT = (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </>
  );
  const CLOCK = (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  );

  if (t.includes("has been accepted")) return { theme: "accepted", icon: CHECK };
  if (t.includes("placed in escrow")) return { theme: "paid", icon: COINS };
  if (t.includes("marked this deal as delivered")) return { theme: "delivered", icon: BOX };
  if (t.includes("released to the seller") || t.includes("Deal Successful") || t.includes("Deal complete")) return { theme: "released", icon: CHECK };
  if (t.includes("refunded to the buyer")) return { theme: "refunded", icon: REFUND };
  if (t.includes("dispute has been raised")) return { theme: "disputed", icon: ALERT };
  if (t.includes("deadline passed")) return { theme: "expired", icon: CLOCK };
  return { theme: "paid", icon: COINS };
}

function MessageRow({
  m,
  currentUid,
  chatRoomId,
  dealId,
  onDelete,
  onReport,
  onImageLoad,
  onImageClick,
}: {
  m: DealMessage;
  currentUid: string;
  chatRoomId: string;
  dealId: string | null;
  onDelete: (id: string) => void;
  onReport: () => void;
  onImageLoad: () => void;
  onImageClick: (url: string) => void;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);

  if (m.type === "system") {
    const meta = systemMsgMeta(m.text || "");
    return (
      <div className={`dcp-msg-system theme-${meta.theme}`}>
        <span className="dcp-sys-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{meta.icon}</svg>
        </span>
        <span className="dcp-sys-text">{stripEmoji(m.text || "")}</span>
      </div>
    );
  }

  const isMine = m.uid === currentUid;

  // Siterifty AI bot messages (isBot) — the built-in auto-accept
  // announcement, never sent by a real user. Rendered with its own row
  // shape (avatar + name + bubble) distinct from both the plain system
  // banner above and the normal buyer/seller bubble below.
  if (m.isBot) {
    return (
      <div className="dcp-msg-row theirs bot-msg">
        <div className="dcp-bot-avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.senderPic || "/favicon-32x32.png"} alt="" />
        </div>
        <div className="dcp-bot-body">
          <div className="dcp-msg-meta">
            <span className="dcp-msg-name">{m.senderName || "Siterifty AI"}</span>
            <span className="dcp-msg-time">{fmtTime(m.createdAt)}</span>
          </div>
          <div className="dcp-bubble">{m.text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`dcp-msg-row ${isMine ? "mine" : "theirs"}`}>
      <div className="dcp-msg-meta">
        {!isMine && m.senderName ? <span className="dcp-msg-name">{m.senderName}</span> : null}
        <span className="dcp-msg-time">{fmtTime(m.createdAt)}</span>
        <button className="dcp-msg-dots" onClick={(e) => { e.stopPropagation(); setCtxOpen((v) => !v); }}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
        </button>
        {ctxOpen ? (
          <div className="dcp-ctx-menu" onClick={(e) => e.stopPropagation()}>
            {isMine ? (
              <button className="dcp-ctx-item danger" onClick={() => { setCtxOpen(false); onDelete(m.id); }}>
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                Delete
              </button>
            ) : (
              <button className="dcp-ctx-item danger" onClick={() => { setCtxOpen(false); onReport(); }}>
                <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                Report
              </button>
            )}
          </div>
        ) : null}
      </div>
      <MessageBubble m={m} isMine={isMine} chatRoomId={chatRoomId} dealId={dealId} onImageLoad={onImageLoad} onImageClick={onImageClick} />
    </div>
  );
}

function MessageBubble({ m, isMine, chatRoomId, dealId, onImageLoad, onImageClick }: { m: DealMessage; isMine: boolean; chatRoomId: string; dealId: string | null; onImageLoad: () => void; onImageClick: (url: string) => void }) {
  if (m.type === "image" && m.imageUrl) {
    return (
      <div className="dcp-bubble img-bubble">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.imageUrl} alt="" onClick={() => onImageClick(m.imageUrl!)} onLoad={onImageLoad} />
      </div>
    );
  }
  if (m.type === "link" && m.linkUrl) {
    return (
      <div className="dcp-bubble link-bubble">
        <div className="ibx-link-prev">
          {m.linkThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.linkThumb} className="ibx-link-prev-img" alt="" onLoad={onImageLoad} onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : null}
          <div className="ibx-link-prev-body">
            <div className="ibx-link-prev-title">{m.linkTitle || m.linkUrl}</div>
            <div className="ibx-link-prev-url">{m.linkUrl}</div>
          </div>
          <button className="ibx-link-prev-btn" onClick={(e) => { e.stopPropagation(); window.open(m.linkUrl, "_blank", "noopener"); }}>
            Visit link
          </button>
        </div>
      </div>
    );
  }
  if (m.type === "file") {
    return (
      <div className="dcp-bubble">
        <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", marginRight: 5, verticalAlign: "middle" }}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        {m.fileUrl ? (
          <a href={m.fileUrl} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "underline" }}>
            {m.fileName || "File"}
          </a>
        ) : (
          m.fileName || "File"
        )}
      </div>
    );
  }
  if (m.type === "transfer_zip" && m.storagePath) {
    return <TransferZipBubble m={m} isMine={isMine} chatRoomId={chatRoomId} dealId={dealId} />;
  }
  return <div className="dcp-bubble">{m.text || ""}</div>;
}

function TransferZipBubble({ m, isMine, chatRoomId, dealId }: { m: DealMessage; isMine: boolean; chatRoomId: string; dealId: string | null }) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const sizeLabel = m.fileSize ? (m.fileSize >= 1024 * 1024 ? (m.fileSize / 1024 / 1024).toFixed(1) + " MB" : Math.ceil(m.fileSize / 1024) + " KB") : "";
  const itemCount = Array.isArray(m.items) ? m.items.length : 0;
  const fileCount = typeof m.fileCount === "number" ? m.fileCount : null;
  const subParts = [m.fileName || "transfer.zip"];
  if (fileCount != null) subParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  if (sizeLabel) subParts.push(sizeLabel);

  async function handleDownload() {
    setDownloading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();
      const resp = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "escrow-get-download-url", idToken, chatRoomId, dealId, storagePath: m.storagePath }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Could not get download link");
      try {
        const res = await fetch(json.url);
        if (!res.ok) throw new Error("Download failed (" + res.status + ")");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = m.fileName || "transfer.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      } catch {
        window.open(json.url, "_blank", "noopener");
      }
      setDownloaded(true);
    } catch (e) {
      console.error(e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="dcp-bubble tdm-zip-bubble">
      <div className="tdm-zip-card">
        <div className="tdm-zip-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" />
          </svg>
        </div>
        <div className="tdm-zip-card-body">
          <div className="tdm-zip-card-title">{itemCount ? `${itemCount} transfer item${itemCount === 1 ? "" : "s"}` : "Transfer package"}</div>
          <div className="tdm-zip-card-sub">{subParts.join(" · ")}</div>
        </div>
        {isMine ? (
          <div className="tdm-zip-readonly-badge" title="Only the buyer can download this file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        ) : downloaded ? (
          <div className="tdm-zip-readonly-badge" title="Downloaded — this file has been removed from storage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <button type="button" className="tdm-zip-download-btn" disabled={downloading} onClick={handleDownload}>
            {downloading ? "⋯" : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {!isMine ? <div className="tdm-zip-onetime-notice">This file will be deleted from our system once you download it. If something goes wrong, open a dispute before downloading again.</div> : null}
    </div>
  );
}
