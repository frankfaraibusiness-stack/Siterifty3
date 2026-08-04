// Delivery / transfer method definitions, shared across Website, App, and
// Game listing forms. Rewritten to read as professional marketplace
// copy — no emoji, no vague labels — and ordered safest-first so the
// escrow-protected / in-platform options are the ones a seller sees first,
// with a one-line security note explaining what protection each method
// does or doesn't carry. "recommended" methods get a visual highlight;
// "caution" methods get a small warning note instead of a green check.

export interface TransferMethod {
  value: string;
  label: string;
  note: string;
  tier: "recommended" | "standard" | "caution";
}

// Website / template listings.
export const WEBSITE_TRANSFER_METHODS: TransferMethod[] = [
  {
    value: "escrow_migration",
    label: "Escrow-Protected Migration",
    note: "Funds are held until the buyer confirms the site works — the safest option for both sides.",
    tier: "recommended",
  },
  {
    value: "source_files",
    label: "Source Files (HTML/CSS/JS or full codebase)",
    note: "Delivered directly through the platform chat, tied to the order record.",
    tier: "recommended",
  },
  {
    value: "domain_push",
    label: "Domain Push (Registrar Transfer)",
    note: "Standard registrar-to-registrar transfer; buyer should confirm the push code before paying in full.",
    tier: "standard",
  },
  {
    value: "site_archive",
    label: "Full Site Archive (Files + Database Export)",
    note: "A complete backup handed off as a single package.",
    tier: "standard",
  },
  {
    value: "hosting_handover",
    label: "Hosting Account Handover",
    note: "Buyer should require the seller to change all passwords immediately after transfer.",
    tier: "standard",
  },
  {
    value: "cpanel",
    label: "cPanel / Control Panel Access",
    note: "Grant scoped access rather than sharing the master login where possible.",
    tier: "standard",
  },
  {
    value: "database_export",
    label: "Database Export (.sql)",
    note: "Use alongside a files transfer method — this alone doesn't include the site's code.",
    tier: "standard",
  },
  {
    value: "repo_transfer",
    label: "GitHub / GitLab Repository Transfer",
    note: "Ownership transfer is logged by the host, which is useful if a dispute comes up later.",
    tier: "standard",
  },
  {
    value: "site_builder_transfer",
    label: "Site Builder Transfer (Wix, Shopify, Webflow, etc.)",
    note: "Use the platform's built-in ownership-transfer tool rather than sharing login credentials.",
    tier: "standard",
  },
  {
    value: "ftp_credentials",
    label: "FTP/SFTP Credentials",
    note: "Caution: credentials alone carry no proof of a completed handover — pair this with escrow.",
    tier: "caution",
  },
];

// App listings.
export const APP_TRANSFER_METHODS: TransferMethod[] = [
  {
    value: "store_account_handover",
    label: "Store Account Handover (App Store Connect / Play Console)",
    note: "Buyer gets developer-account-level ownership — the standard, verifiable way to transfer an app.",
    tier: "recommended",
  },
  {
    value: "escrow_migration",
    label: "Escrow-Protected Migration",
    note: "Funds are held until the buyer confirms the transfer and access both work.",
    tier: "recommended",
  },
  {
    value: "source_code_handover",
    label: "Source Code Handover",
    note: "Delivered directly through the platform chat, tied to the order record.",
    tier: "standard",
  },
  {
    value: "build_transfer",
    label: "Signed Build Transfer (APK/AAB/IPA)",
    note: "A build file alone doesn't transfer store listing ownership — pair with a store account handover.",
    tier: "caution",
  },
  {
    value: "other",
    label: "Other (discuss details in chat before paying)",
    note: "Get the method confirmed in writing before any funds move.",
    tier: "caution",
  },
];

// Game listings.
export const GAME_TRANSFER_METHODS: TransferMethod[] = [
  {
    value: "escrow_migration",
    label: "Escrow-Protected Migration",
    note: "Funds are held until the buyer confirms the game and access both work.",
    tier: "recommended",
  },
  {
    value: "store_account_handover",
    label: "Store Account Handover (Steam / Play Console / App Store Connect)",
    note: "Buyer gets developer-account-level ownership on the relevant storefront.",
    tier: "recommended",
  },
  {
    value: "source_files",
    label: "Source Files / Full Project Handover",
    note: "Delivered directly through the platform chat, tied to the order record.",
    tier: "standard",
  },
  {
    value: "console_store_code",
    label: "Console Store Code (Xbox / PlayStation / Nintendo)",
    note: "Confirm the code is unredeemed and region-matched before paying in full.",
    tier: "standard",
  },
  {
    value: "steam_key_transfer",
    label: "Steam Key / CD Key Transfer",
    note: "Keys can only be redeemed once — confirm it's unused immediately after receiving it.",
    tier: "standard",
  },
  {
    value: "account_handover",
    label: "Player Account Handover (Pre-loaded Save/Progress)",
    note: "Buyer should change all account credentials immediately after transfer.",
    tier: "standard",
  },
  {
    value: "direct_download",
    label: "Direct Build Transfer (EXE/APK/ROM)",
    note: "A build file alone doesn't transfer store listing ownership where one exists.",
    tier: "caution",
  },
];
