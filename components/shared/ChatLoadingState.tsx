"use client";

// Replaces the old bare "Loading…" text that sat in a lot of empty
// space and was easy to miss. A small chat-bubble character (outline
// style, matching the rest of the app's icon language) centered in the
// messages area, with a lime accent spinner underneath so it actually
// reads as "in progress" rather than inert text.
export default function ChatLoadingState({
  label = "Loading messages…",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? "0.6rem" : "0.9rem",
        padding: compact ? "1.75rem 1.5rem" : "3rem 1.5rem",
        minHeight: compact ? undefined : "60%",
        color: "rgba(255,255,255,0.35)",
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={compact ? 36 : 52}
        height={compact ? 36 : 52}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.55 }}
        aria-hidden="true"
      >
        {/* chat bubble body */}
        <path d="M10 20a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H24l-10 9v-9h-2a8 8 0 0 1-8-8z" />
        {/* two little "eyes" so it reads as a friendly character, not just a UI icon */}
        <circle cx="26" cy="27" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="38" cy="27" r="1.6" fill="currentColor" stroke="none" />
      </svg>

      <span
        aria-hidden="true"
        style={{
          width: compact ? 16 : 22,
          height: compact ? 16 : 22,
          borderRadius: "50%",
          border: "2.5px solid rgba(163,230,53,0.18)",
          borderTopColor: "#a3e635",
          animation: "dcpSpin 0.7s linear infinite",
        }}
      />

      <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>{label}</span>
    </div>
  );
}
