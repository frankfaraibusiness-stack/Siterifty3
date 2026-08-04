const ICON_PATHS: Record<string, string> = {
  domain_push: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 010 20M2 12h20"/>',
  zip_download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  cpanel: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>',
  hosting_handover: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>',
  db_dump: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  ftp: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
  site_builder: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  escrow_migration: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  license_key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  apk_ipa: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  app_store_connect: '<path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M8 12l2.5 2.5L16 9"/>',
  play_console: '<polygon points="5 3 19 12 5 21 5 3"/>',
  credentials: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  qr_code: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/>',
  api_key: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  steam_key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  direct_download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  account_handover: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  gift_code: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>',
  console_code: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  google_play_games: '<polygon points="5 3 19 12 5 21 5 3"/>',
  launcher: '<path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.95C18.88 4 12 4 12 4s-6.88 0-8.59.47A2.78 2.78 0 001.46 6.42 29 29 0 001 12a29 29 0 00.46 5.58 2.78 2.78 0 001.95 1.95C5.12 20 12 20 12 20s6.88 0 8.59-.47a2.78 2.78 0 001.95-1.95A29 29 0 0023 12a29 29 0 00-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>',
  browser_login: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 010 20M2 12h20"/>',
  html_css_js: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  // Current values without a legacy equivalent above — reuse the closest
  // existing icon shape rather than adding new artwork.
  store_account_handover: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  source_files: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  source_code_handover: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  site_archive: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  database_export: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  repo_transfer: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>',
  site_builder_transfer: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  ftp_credentials: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
  build_transfer: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  console_store_code: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  steam_key_transfer: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  other: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};

const LABELS: Record<string, string> = {
  // Current values (see components/listing/shared/transferMethods.ts)
  escrow_migration: "Escrow-Protected Migration",
  store_account_handover: "Store Account Handover",
  source_files: "Source Files / Full Handover",
  source_code_handover: "Source Code Handover",
  domain_push: "Domain Push",
  site_archive: "Full Site Archive",
  hosting_handover: "Hosting Handover",
  cpanel: "cPanel Access",
  database_export: "Database Export (.sql)",
  repo_transfer: "GitHub / GitLab Transfer",
  site_builder_transfer: "Site Builder Transfer",
  ftp_credentials: "FTP/SFTP Credentials",
  build_transfer: "Signed Build Transfer",
  console_store_code: "Console Store Code",
  steam_key_transfer: "Steam Key Transfer",
  account_handover: "Player Account Handover",
  direct_download: "Direct Build Transfer",
  other: "Other (confirmed in chat)",

  // Legacy values — kept so older listings created before this label set
  // was introduced still render a readable pill instead of a raw key.
  zip_download: "Full Site ZIP",
  github: "GitHub / GitLab Transfer",
  db_dump: "Database Dump (.sql)",
  ftp: "FTP Credentials",
  site_builder: "Site Builder Transfer",
  license_key: "License Key",
  apk_ipa: "APK / IPA Download",
  app_store_connect: "App Store Connect",
  play_console: "Google Play Console",
  credentials: "Account Credentials",
  qr_code: "QR Code",
  api_key: "API Key Delivery",
  steam_key: "Steam Key",
  gift_code: "Gift Code",
  console_code: "Console Store Code",
  google_play_games: "Google Play Games",
  launcher: "Launcher Transfer",
  browser_login: "Browser Login",
  source_code: "Source Code Handover",
  html_css_js: "HTML/CSS/JS Files",
};

// Ports _buildTransferMethodsHtml exactly — a pill row of the methods a
// seller offers to deliver a listing through.
export default function TransferMethodsBlock({ methods, accentColor }: { methods?: string[]; accentColor: string }) {
  if (!methods || methods.length === 0) return null;
  return (
    <div className="modal-section mp-transfer-section">
      <div className="modal-section-title mp-transfer-title">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={accentColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        How You&apos;ll Receive This
      </div>
      <p className="mp-transfer-note">The seller will deliver via one or more of these methods:</p>
      <div className="mp-transfer-pills">
        {methods.map((m) => (
          <span
            key={m}
            className="mp-transfer-pill"
            style={{ ["--tp-accent" as string]: accentColor }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, opacity: 0.8 }}
              dangerouslySetInnerHTML={{ __html: ICON_PATHS[m] || "" }}
            />
            {LABELS[m] || m.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
