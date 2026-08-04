import type { AttachedRepo } from "@/lib/listings";

// Ports _buildAttachedRepoHtml exactly.
export default function AttachedRepoBlock({ repo, accentColor }: { repo?: AttachedRepo; accentColor: string }) {
  if (!repo || !repo.fullName) return null;
  return (
    <div className="modal-section mp-repo-section">
      <div className="modal-section-title with-icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill={accentColor} stroke="none">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
        GitHub Repository
      </div>
      <a
        href={repo.htmlUrl || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="mp-repo-attached-card"
        style={{ ["--repo-accent" as string]: accentColor }}
      >
        <div className="mp-repo-attached-info">
          <span className="mp-repo-attached-name">{repo.fullName}</span>
          <span className="mp-repo-attached-meta">
            <span className="mp-repo-attached-badge">{repo.private ? "Private" : "Public"}</span>
            {repo.language ? <span>{repo.language}</span> : null}
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M7 17L17 7M7 7h10v10" />
        </svg>
      </a>
      <p className="mp-repo-attached-note">This listing is backed by a verified GitHub repository the seller connected.</p>
    </div>
  );
}
