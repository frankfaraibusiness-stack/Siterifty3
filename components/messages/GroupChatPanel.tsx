"use client";

// Ports the group chat side panel (#groupChatPanel, Js/group-chat.js,
// index.html lines 21220-21528) as a real routed page at
// /messages/group/[id] instead of a global overlay opened via
// window.__openGroupChat(group) — matching the app's convention that
// /messages/deal/[id] and /messages/group/[id] are their own pages, with
// InboxShell's GroupsTab (already built) navigating here via router.push.
//
// The 9 groups themselves (IBX_GROUPS) are a fixed topic list, not
// user-created — already ported in lib/useInbox.ts. This component looks
// up the group by the route's [id] param and 404s (via notFound-style
// inline message) if it doesn't match one of the 9.
//
// Firestore shape: groupChats/{groupId}/messages, ordered by createdAt
// asc, capped at the most recent 80 (same window as the original) via a
// live onSnapshot — matches _gcpSubscribe exactly, including the
// "was I already near the bottom" auto-scroll heuristic (only
// autoscroll on new messages if the viewer was already within ~140px of
// the bottom, so someone scrolled up reading history doesn't get yanked
// down).
//
// Message types ported 1:1: text, image (Imgur upload), file (image
// files go through Imgur same as the image button; non-image files are
// recorded as a filename-only record — this MVP never hosted arbitrary
// binaries, matching the original's own comment on this), and link
// (paste a URL, fetch page title + og:image via the allorigins proxy for
// a preview card). Each message has a 3-dot menu: Delete for your own
// messages (real deleteDoc), Report for others' (client-side ack only,
// no moderation backend exists — matches the original exactly, which
// also never sent reports anywhere).
//
// srfModal.confirm/.alert/.prompt calls in the original are replaced with
// window.confirm/window.prompt + useToast() for failure feedback — the
// real in-app dialog system (support-modals.js) hasn't been built yet
// anywhere in this app, so this matches how EditListingModal.tsx already
// handles the same gap rather than inventing a one-off pattern here.
//
// The .gcp-* CSS this needs already exists in app/globals.css (ported in
// an earlier pass, unused until now). The image lightbox
// (#ibxImgViewer) did NOT exist anywhere — genuinely missing from the
// legacy stylesheet too, not just unported — so it's a small
// self-contained lightbox here instead, built from the original's own
// inline styles (index.html's #ibxImgViewer element was itself styled
// inline, not via a stylesheet rule).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  orderBy,
  limit as fsLimit,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  type Unsubscribe,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useToast } from "@/lib/useToast";
import { IBX_GROUPS } from "@/lib/useInbox";

const IMGUR_CLIENT_ID = "546c25a59c58ad7";

interface GroupMessage {
  id: string;
  uid?: string;
  senderName?: string;
  senderPic?: string;
  type?: "text" | "image" | "file" | "link" | "system";
  text?: string;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
  linkUrl?: string;
  linkTitle?: string;
  linkThumb?: string;
  createdAt?: number | { toMillis?: () => number; seconds?: number };
}

function toMillis(v: GroupMessage["createdAt"]): number {
  if (typeof v === "number") return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

function timeLabel(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function GroupAvatarIcon({ id }: { id: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { width: 18, height: 18 } };
  switch (id) {
    case "all":
      return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>;
    case "gaming":
      return <svg {...common}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="16" cy="11" r="0.5" fill="currentColor" /><circle cx="18" cy="13" r="0.5" fill="currentColor" /></svg>;
    case "websites":
      return <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></svg>;
    case "apps":
      return <svg {...common}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
    case "show_work":
      return <svg {...common}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>;
    case "best_deals":
      return <svg {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>;
    case "startups":
      return <svg {...common}><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" /></svg>;
    case "design":
      return <svg {...common}><circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" /><circle cx="6.5" cy="12.5" r="2.5" /><path d="M12 20c-4 0-8-2-8-6s4-6 8-6 8 2 8 6-4 6-8 6z" /></svg>;
    case "collab":
      return <svg {...common}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>;
    default:
      return null;
  }
}

function MessageRow({
  m,
  isMine,
  onDelete,
  onReport,
  onImageClick,
}: {
  m: GroupMessage;
  isMine: boolean;
  onDelete: () => void;
  onReport: () => void;
  onImageClick: (url: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ms = toMillis(m.createdAt);

  if (m.type === "system") {
    return <div className="gcp-msg-system">{m.text}</div>;
  }

  return (
    <div className={`gcp-msg-outer ${isMine ? "mine" : "theirs"}`}>
      {!isMine && (
        <div className="gcp-msg-av">
          {m.senderPic ? <img src={m.senderPic} alt="" /> : (m.senderName || "U").charAt(0).toUpperCase()}
        </div>
      )}
      {isMine && <div className="gcp-msg-av-spacer" />}
      <div className={`gcp-msg-row ${isMine ? "mine" : "theirs"}`}>
        <div className="gcp-msg-meta">
          {!isMine && m.senderName && <span className="gcp-msg-name">{m.senderName}</span>}
          <span className="gcp-msg-time">{timeLabel(ms)}</span>
          <button
            className="gcp-msg-dots"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title={isMine ? "Delete" : "Report"}
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
          </button>
          {menuOpen && (
            <div className="gcp-ctx-menu" onClick={(e) => e.stopPropagation()}>
              {isMine ? (
                <button
                  className="gcp-ctx-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
                  Delete message
                </button>
              ) : (
                <button
                  className="gcp-ctx-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onReport();
                  }}
                >
                  <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                  Report
                </button>
              )}
            </div>
          )}
        </div>
        {m.type === "image" && m.imageUrl ? (
          <div className="gcp-bubble img-bubble">
            <img src={m.imageUrl} alt="image" onClick={() => onImageClick(m.imageUrl!)} />
          </div>
        ) : m.type === "file" && m.fileUrl ? (
          <div className="gcp-bubble">
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", marginRight: 5, verticalAlign: "middle" }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            <a href={m.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>{m.fileName || "File"}</a>
          </div>
        ) : m.type === "file" ? (
          <div className="gcp-bubble" style={{ opacity: 0.6, fontStyle: "italic" }}>
            {m.fileName || "File"} (file hosting not available)
          </div>
        ) : m.type === "link" && m.linkUrl ? (
          <div className="gcp-bubble link-bubble">
            <div className="ibx-link-prev">
              {m.linkThumb && (
                <img
                  className="ibx-link-prev-img"
                  src={m.linkThumb}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <div className="ibx-link-prev-body">
                <div className="ibx-link-prev-title">{m.linkTitle || m.linkUrl}</div>
                <div className="ibx-link-prev-url">{m.linkUrl}</div>
              </div>
              <button className="ibx-link-prev-btn" onClick={(e) => { e.stopPropagation(); window.open(m.linkUrl, "_blank", "noopener"); }}>
                Visit link
              </button>
            </div>
          </div>
        ) : (
          <div className="gcp-bubble">{m.text}</div>
        )}
      </div>
    </div>
  );
}

export default function GroupChatPanel({
  groupId,
  embedded = false,
  onBack,
}: {
  groupId: string;
  // See DealChatPanel's matching props for the full rationale — desktop
  // split-view (InboxShell.tsx) mounts this as a pane next to the thread
  // list instead of routing to /messages/group/[id].
  embedded?: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { toast, ToastHost } = useToast();

  const group = IBX_GROUPS.find((g) => g.id === groupId);

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Require auth to view a group at all — mirrors the original's
  // ibxRenderGroups row click guard (redirect to login if signed out).
  useEffect(() => {
    if (!user) {
      openAuthModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Subscribe to the last 80 messages, live — mirrors _gcpSubscribe.
  useEffect(() => {
    if (!group || !user) return;
    const q = query(collection(db, "groupChats", group.id, "messages"), orderBy("createdAt", "asc"), fsLimit(80));
    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as GroupMessage)));
      },
      (err) => {
        console.error("Group chat error:", err);
      }
    );
    return () => unsub();
  }, [group, user]);

  // Reset the auto-scroll state whenever the group changes, so switching
  // between groups re-triggers the "jump straight to latest" behavior
  // below instead of carrying over the previous group's scroll state.
  useEffect(() => {
    hasAutoScrolledRef.current = false;
    wasNearBottomRef.current = true;
  }, [group?.id]);

  // Scroll-to-bottom for the message list. Query above orders messages
  // oldest-first (asc) so the newest are last in the DOM — a plain
  // useEffect here ran after paint, so the panel would render at the
  // TOP (oldest messages) for a beat before jumping down, visible as a
  // flash/flicker on open. useLayoutEffect runs synchronously after DOM
  // mutations but before the browser paints, so the jump to bottom
  // happens invisibly. Same pattern as DealChatPanel: (a) always force
  // to bottom the first time this group has messages, and (b) on later
  // updates, only follow new messages down if the viewer was already
  // near the bottom — if they've scrolled up to read history, leave
  // their position alone.
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (!messages.length) return;
    if (!hasAutoScrolledRef.current) {
      el.scrollTop = el.scrollHeight;
      wasNearBottomRef.current = true;
      hasAutoScrolledRef.current = true;
      return;
    }
    if (wasNearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleScroll() {
    const el = messagesRef.current;
    if (!el) return;
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  function senderIdentity() {
    const senderName = profile?.username || user?.displayName || "User";
    const senderPic = profile?.profilePic || user?.photoURL || "";
    return { senderName, senderPic };
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !group || !user) return;
    const { senderName, senderPic } = senderIdentity();
    setSending(true);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await addDoc(collection(db, "groupChats", group.id, "messages"), {
        uid: user.uid, senderName, senderPic, text, type: "text", createdAt: Date.now(),
      });
    } catch (err) {
      console.error("GCP send error:", err);
      toast("Message failed to send. Please try again.");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function uploadToImgur(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        body: fd,
      });
      const json = await res.json();
      if (!json.success) return null;
      return json.data.link as string;
    } catch {
      return null;
    }
  }

  async function handleImagePick(file: File) {
    if (!group || !user) return;
    const { senderName, senderPic } = senderIdentity();
    const url = await uploadToImgur(file);
    if (!url) {
      toast("The image could not be uploaded. Please try a different file.");
      return;
    }
    try {
      await addDoc(collection(db, "groupChats", group.id, "messages"), {
        uid: user.uid, senderName, senderPic, type: "image", imageUrl: url, createdAt: Date.now(),
      });
    } catch (err) {
      console.error("Imgur upload error:", err);
      toast("Something went wrong uploading your image. Please try again.");
    }
  }

  async function handleFilePick(file: File) {
    if (!group || !user) return;
    const { senderName, senderPic } = senderIdentity();
    if (file.type.startsWith("image/")) {
      await handleImagePick(file);
      return;
    }
    // Non-image files: filename-only record — the original never hosted
    // arbitrary binaries for this feature either (see its own comment on
    // this being an MVP limitation).
    try {
      await addDoc(collection(db, "groupChats", group.id, "messages"), {
        uid: user.uid, senderName, senderPic, type: "file", fileName: file.name, fileUrl: "", createdAt: Date.now(),
      });
    } catch {
      // matches original's silent .catch(()=>{})
    }
  }

  async function handleShareLink() {
    if (!group || !user) return;
    const url = window.prompt("Paste a URL to share with the group:");
    if (!url || !url.startsWith("http")) return;
    const { senderName, senderPic } = senderIdentity();
    let linkTitle = url;
    let linkThumb = "";
    try {
      const proxyUrl = "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      const json = await res.json();
      const html = json.contents || "";
      const titleMatch = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
      if (titleMatch) linkTitle = titleMatch[1].trim();
      const ogImg =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (ogImg) linkThumb = ogImg[1];
    } catch {
      // keep the fallback title/no-thumb, same as the original
    }
    try {
      await addDoc(collection(db, "groupChats", group.id, "messages"), {
        uid: user.uid, senderName, senderPic, type: "link", linkUrl: url, linkTitle, linkThumb, createdAt: Date.now(),
      });
    } catch {
      // matches original's silent .catch(()=>{})
    }
  }

  async function handleDeleteMessage(id: string) {
    if (!group) return;
    const ok = window.confirm("This message will be permanently removed for everyone in this group. Delete it?");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "groupChats", group.id, "messages", id));
    } catch (err) {
      console.error(err);
      toast("Could not delete this message. Please try again.");
    }
  }

  function handleReportMessage() {
    window.alert("Message reported. Our moderation team will review this message within 24 hours.");
  }

  function handleClose() {
    if (onBack) {
      onBack();
      return;
    }
    router.push("/messages?tab=groups");
  }

  if (!group) {
    return (
      <div style={embedded ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff" } : { marginTop: 92, padding: "40px 24px 80px", textAlign: "center", color: "#fff" }}>
        <h1>Group not found</h1>
        <p style={{ opacity: 0.6, marginTop: 8 }}>This group doesn&apos;t exist.</p>
        <button onClick={handleClose} style={{ marginTop: 16, background: "none", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "10px 20px", borderRadius: 100, cursor: "pointer" }}>
          Back to groups
        </button>
      </div>
    );
  }

  return (
    <div
      id={embedded ? undefined : "groupChatPanel"}
      className={embedded ? "gcp-embedded" : undefined}
      style={embedded ? { display: "flex", flexDirection: "column", width: "100%", height: "100%", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" } : { position: "fixed", inset: 0, zIndex: 9998, background: "#06060e", display: "flex", flexDirection: "column", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <ToastHost />

      <div className="gcp-header">
        <button className="gcp-back-btn" onClick={handleClose}>
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div className="gcp-av" style={{ background: group.color + "22", color: group.color }}>
          <GroupAvatarIcon id={group.id} />
        </div>
        <div>
          <div className="gcp-title">{group.name}</div>
          <div className="gcp-desc">{group.desc}</div>
        </div>
      </div>

      <div id="gcpMessages" ref={messagesRef} onScroll={handleScroll}>
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            isMine={!!user && m.uid === user.uid}
            onDelete={() => handleDeleteMessage(m.id)}
            onReport={handleReportMessage}
            onImageClick={(url) => setViewerImage(url)}
          />
        ))}
      </div>

      <div className="gcp-input-row">
        <div className="gcp-attach-row">
          <button className="gcp-attach-btn" onClick={() => imageInputRef.current?.click()}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            Image
          </button>
          <button className="gcp-attach-btn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            File
          </button>
          <button className="gcp-attach-btn" onClick={handleShareLink}>
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
            Link
          </button>
        </div>
        <div className="gcp-input-inner">
          <div className="gcp-textarea-wrap">
            <textarea
              ref={textareaRef}
              value={input}
              maxLength={2000}
              rows={1}
              placeholder="Message the group…"
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button onClick={handleSend} disabled={sending}>
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.txt,.zip"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFilePick(f);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleImagePick(f);
        }}
      />

      {viewerImage && (
        <div
          onClick={() => setViewerImage(null)}
          style={{ display: "flex", position: "fixed", inset: 0, zIndex: 10100, background: "rgba(0,0,0,0.95)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", justifyContent: "center", alignItems: "center", cursor: "zoom-out" }}
        >
          <img src={viewerImage} alt="" style={{ maxWidth: "95vw", maxHeight: "92vh", borderRadius: 12, objectFit: "contain", pointerEvents: "none" }} />
        </div>
      )}
    </div>
  );
}
