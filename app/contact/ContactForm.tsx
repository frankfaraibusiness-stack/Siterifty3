"use client";

import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Full port of the contact form from Js/support-modals.js (lines
// 159-201 of the original). The version that was here before stayed a
// plain info page on the reasoning that no /api route existed for
// submissions — but the original form never used an API route either: it
// writes straight to Firestore's `supportRequests` collection client-side,
// the same direct-write pattern SellerProfileHeader.tsx already uses for
// listing/seller reports (`reports` collection). So the "missing backend"
// wasn't actually missing — this replaces the info-only page with the
// real, working form.
const TOPICS = [
  { value: "general", label: "General question" },
  { value: "account", label: "Account issue" },
  { value: "billing", label: "Billing" },
  { value: "deal", label: "A specific deal" },
  { value: "bug", label: "Report a bug" },
  { value: "other", label: "Other" },
];

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("general");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const em = email.trim();
    const msg = message.trim();
    if (!n || !em || !msg) {
      setStatus("err");
      setStatusMsg("Please fill in all fields.");
      return;
    }

    setStatus("sending");
    setStatusMsg("");
    try {
      const user = auth.currentUser;
      await addDoc(collection(db, "supportRequests"), {
        name: n,
        email: em,
        topic,
        message: msg,
        uid: user ? user.uid : null,
        status: "open",
        createdAt: serverTimestamp(),
      });
      setStatus("ok");
      setStatusMsg("Message sent — we'll get back to you by email.");
      setName("");
      setEmail("");
      setTopic("general");
      setMessage("");
    } catch (err) {
      console.error("[contact form]", err);
      setStatus("err");
      setStatusMsg("Could not send your message. Please try again in a moment.");
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--mp-surface)",
    border: "1px solid var(--mp-border)",
    borderRadius: "var(--mp-radius)",
    color: "var(--mp-text)",
    fontSize: 14.5,
    padding: "10px 14px",
    outline: "none",
    fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "var(--mp-text-sec)",
    fontSize: 12.5,
    fontWeight: 700,
    marginBottom: 6,
  };

  return (
    <StaticPage
      eyebrow="Contact Us"
      title="Get in touch"
      intro="Have a question about a listing, a deal, or your account? Send us a message below."
    >
      <StaticSection>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="contactName">Name</label>
            <input id="contactName" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="contactEmail">Email</label>
            <input id="contactEmail" type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="contactTopic">Topic</label>
            <select id="contactTopic" style={inputStyle} value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="contactMessage">Message</label>
            <textarea
              id="contactMessage"
              style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's going on…"
            />
          </div>

          {statusMsg ? (
            <div style={{ fontSize: 13.5, fontWeight: 600, color: status === "ok" ? "var(--mp-accent)" : "#f87171" }}>
              {statusMsg}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              alignSelf: "flex-start",
              background: "var(--mp-accent)",
              color: "#050505",
              fontWeight: 700,
              border: "none",
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 14,
              cursor: status === "sending" ? "default" : "pointer",
              opacity: status === "sending" ? 0.7 : 1,
            }}
          >
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
        </form>
      </StaticSection>

      <StaticSection heading="Active deal or dispute">
        <p>
          If your question is about a specific deal, the fastest way to get help is from inside
          that deal&apos;s chat — messages there are tied to the transaction, which lets support
          see the full context immediately. For disputes already raised through escrow, our team
          reviews and responds within 24–48 hours of the dispute being opened.
        </p>
      </StaticSection>

      <StaticSection heading="Reporting a listing or seller">
        <p>
          You can report a listing or seller directly from their profile page. Reports go to our
          review team and aren&apos;t visible to the seller.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
