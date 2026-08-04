"use client";

// Compact 1-3 image uploader used for "proof" attachments — revenue
// screenshots and traffic/analytics screenshots. Distinct from the
// gallery ImageSlot components used for listing photos: this is smaller,
// supports a variable count up to a max, and is meant to feel like
// evidence attached to a claim rather than marketing media.

import { useRef, useState } from "react";

export interface ProofImage {
  file: File;
  dataUrl: string;
}

export default function ProofUploader({
  images,
  onAdd,
  onRemove,
  max = 3,
  accent,
  accept = "image/png,image/jpeg,image/webp",
}: {
  images: ProofImage[];
  onAdd: (img: ProofImage) => void;
  onRemove: (index: number) => void;
  max?: number;
  accent: string;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setError(null);
    const remaining = max - images.length;
    if (remaining <= 0) return;
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file (PNG, JPG, or WebP).");
        continue;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        onAdd({ file, dataUrl: (e.target?.result as string) || "" });
      };
      reader.readAsDataURL(file);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: images.length < max ? 10 : 0 }}>
        {images.map((img, i) => (
          <div
            key={i}
            style={{
              position: "relative",
              width: 96,
              height: 96,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <img src={img.dataUrl} alt={`Proof ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button
              type="button"
              onClick={() => onRemove(i)}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
              }}
              aria-label="Remove screenshot"
            >
              ✕
            </button>
          </div>
        ))}

        {images.length < max && (
          <div
            onClick={() => inputRef.current?.click()}
            style={{
              width: 96,
              height: 96,
              borderRadius: 10,
              border: `2px dashed ${accent}55`,
              background: "rgba(255,255,255,0.02)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              gap: 4,
              color: accent,
              fontSize: 11,
              fontWeight: 600,
              textAlign: "center",
              padding: 6,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 18, height: 18 }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Add screenshot</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />

      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
        {images.length} / {max} uploaded
      </div>
      {error && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "#fca5a5" }}>{error}</div>
      )}
    </div>
  );
}
