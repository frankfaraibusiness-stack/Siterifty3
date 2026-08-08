import admin from 'firebase-admin'

// ---------- Supabase (raw REST — no createClient, avoids WebSocket/realtime init on Node 20) ----------
// Multiple Supabase projects ("accounts"), each contributing its own free-tier
// storage allotment. Every account has its own URL, secret key, and bucket
// name/visibility (bucket names/visibility don't have to match across
// accounts — see ACCOUNT.bucket / ACCOUNT.isPublic below).
//
// Uploads are routed to whichever account currently has the LEAST usage
// (see pickAccount()), so the app effectively gets SUM(account storage) of
// total space instead of being capped by a single project.
const ACCOUNTS = [
  {
    id: 1,
    url: 'https://oplxgrrpugpsabvvfoqs.supabase.co',
    secretKey: process.env.SUPABASE_SECRET_KEY,
    bucket: 'sites',
    isPublic: true, // existing bucket — known public
  },
  {
    id: 2,
    url: 'https://waoomqxnfjvluiywpiir.supabase.co',
    secretKey: process.env.SUPABASE_SECRET_KEY_2,
    bucket: 'storage',
    // Set to match account 1 for now (Public). Revisit later — transfer-deal
    // files (credentials.json, private keys, etc.) are only ever exposed via
    // signed URLs from /api/deal regardless of this flag, but a Public bucket
    // means the storedName itself is the only thing stopping direct access.
    // Flip to `false` here once the bucket's dashboard setting is changed to
    // Private — no other code changes needed, supabaseCreateSignedUrl() is
    // already wired up for both accounts.
    isPublic: true,
  },
  {
    id: 3,
    url: 'https://lglralwngxmzxqkdohwf.supabase.co',
    secretKey: process.env.SUPABASE_SECRET_KEY_3,
    bucket: 'storage',
    isPublic: false, // private bucket — uses signed URLs
  },
].filter(a => a.secretKey) // skip any account whose env var isn't set yet

const MAX_STORAGE_BYTES = 800 * 1024 * 1024
const TARGET_STORAGE_BYTES = 700 * 1024 * 1024

// Extensions that are app binaries (Android/iOS build files uploaded via the
// App listing form's "Not Live" / direct APK-IPA flow). These are ALWAYS
// routed to account 2 specifically, rather than the normal least-used
// pickAccount() logic — this keeps account 1 doing exactly what it already
// did (screenshots, templates, game builds, transfer zips, etc.) and gives
// app binaries their own dedicated, isolated storage pool that can be
// reasoned about/limited independently (see resolveMaxSize()).
const APP_BINARY_EXTS = new Set(['apk', 'aab', 'obb', 'apks', 'xapk', 'ipa'])

// Deal deliverable zips (Transfer Deal modal's "finalize" upload only — NOT
// every .zip in the app, since .zip is also accepted by a couple of unrelated
// uploaders). The client marks these explicitly with `isDealFile: true` in
// the request body rather than this being inferred from the extension, since
// extension alone can't distinguish "the one escrow deliverable for this
// deal" from any other zip a user might upload elsewhere. These are ALWAYS
// routed to account 3 (the private bucket) and are deleted immediately once
// the buyer downloads them (see handleEscrowGetDownloadUrl in deal.js) —
// account 3's usage is expected to stay low since files don't accumulate.
const DEAL_FILE_ACCOUNT_ID = 3

async function pickAccountForDealFile() {
  const dealAccount = ACCOUNTS.find(a => a.id === DEAL_FILE_ACCOUNT_ID)
  if (dealAccount) return dealAccount
  console.warn('Account 3 (deal files) not configured — falling back to least-used account for deal zip upload')
  return pickAccount()
}

// Resolve which account a given file extension should upload to.
// - App binaries -> pinned to account 2 (falls back to pickAccount() if
//   account 2 isn't configured yet, so uploads don't hard-fail mid-rollout).
// - Everything else -> normal least-used routing across all accounts.
async function pickAccountForExt(ext) {
  if (APP_BINARY_EXTS.has(ext)) {
    const appsAccount = ACCOUNTS.find(a => a.id === 2)
    if (appsAccount) return appsAccount
    console.warn('Account 2 (apps) not configured — falling back to least-used account for app binary upload')
  }
  return pickAccount()
}

function supabaseHeaders(account, contentType) {
  const key = account.secretKey
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
  if (contentType) h['Content-Type'] = contentType
  return h
}

// Upload a buffer directly via the Supabase Storage REST API
async function supabaseUpload(account, storedName, buffer, contentType) {
  const url = `${account.url}/storage/v1/object/${account.bucket}/${encodeURIComponent(storedName)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(account, contentType),
      'x-upsert': 'true',
    },
    body: buffer,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase upload failed on account ${account.id} (${res.status}): ${body}`)
  }
}

function supabasePublicUrl(account, storedName) {
  return `${account.url}/storage/v1/object/public/${account.bucket}/${encodeURIComponent(storedName)}`
}

// Mint a short-lived signed URL for a private object. Unlike supabasePublicUrl,
// this requires the bucket to be PRIVATE and requires calling with the service
// key (server-side only — never expose the secret key to the client).
// Used for deal deliverables (transfer zips) so a leaked/cached link expires
// instead of granting permanent, unauthenticated access to whatever's inside
// (which can include credentials.json, private keys, etc. bundled by the user).
async function supabaseCreateSignedUrl(account, storedName, expiresInSeconds = 300) {
  const url = `${account.url}/storage/v1/object/sign/${account.bucket}/${encodeURIComponent(storedName)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(account, 'application/json'),
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase sign failed on account ${account.id} (${res.status}): ${body}`)
  }
  const data = await res.json()
  // Supabase returns a relative signedURL like "/object/sign/<bucket>/<path>?token=..."
  return `${account.url}/storage/v1${data.signedURL}`
}

// storedName now encodes which account it lives on (see ACCOUNT_SEP below),
// so callers elsewhere (e.g. deal.js) need the account resolved first.
// Exported for use by other API routes (e.g. deal.js minting a fresh signed
// URL for a deal participant on demand instead of storing a permanent link).
function findAccountById(id) {
  const account = ACCOUNTS.find(a => a.id === Number(id))
  if (!account) throw new Error(`Unknown storage account id: ${id}`)
  return account
}
export { supabaseCreateSignedUrl, findAccountById, deleteFiles }

// List all files in one account's bucket. NOTE: intentionally flat (no folder
// prefixes) — Supabase's list API collapses objects under a common "folder"
// prefix into a single synthetic entry rather than recursing, so per-user
// scoping is done via a filename prefix (see UID_SEP below) and filtered
// client-side instead, to avoid silently breaking this listing (and
// therefore autoCleanup) later.
async function listAllFiles(account) {
  const url = `${account.url}/storage/v1/object/list/${account.bucket}`
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(account, 'application/json'),
    body: JSON.stringify({ prefix: '', limit: 10000, offset: 0 }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase list failed on account ${account.id} (${res.status}): ${body}`)
  }
  return res.json()
}

// Filename prefix separator used to scope files to a uid without using an
// actual storage "folder" (see listAllFiles note above).
const UID_SEP = '--'
// Separator used to stash which account a file lives on, inside storedName,
// so later operations (delete/sign/lookup) know where to find it without a
// database lookup. Format: "<accountId>@@<uid>--<baseName>-<ts>-<rand>.<ext>"
const ACCOUNT_SEP = '@@'

// Sum bytes uploaded by a given user within the trailing windowDays, across
// ALL accounts (a user's quota is global, not per-account).
async function getUserRollingUsage(uid, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const perAccount = await Promise.all(ACCOUNTS.map(a => listAllFiles(a)))
  let total = 0
  for (const files of perAccount) {
    const mine = files.filter(f => f.name && f.name.startsWith(`${uid}${UID_SEP}`))
    total += mine.reduce((sum, f) => {
      const created = f.created_at ? new Date(f.created_at).getTime() : 0
      return created >= cutoff ? sum + (f.metadata?.size || 0) : sum
    }, 0)
  }
  return total
}

// Delete files by name array from a specific account
async function deleteFiles(account, names) {
  if (!names.length) return
  const url = `${account.url}/storage/v1/object/${account.bucket}`
  await fetch(url, {
    method: 'DELETE',
    headers: supabaseHeaders(account, 'application/json'),
    body: JSON.stringify({ prefixes: names }),
  })
}

// Get total bucket usage in bytes
async function getBucketUsage(files) {
  return files.reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
}

// Pick which account a new upload should go to: whichever has the least
// bytes currently stored (auto-balances load across all 3 accounts so no
// single project's free-tier limit gets hit first).
async function pickAccount() {
  if (ACCOUNTS.length === 0) {
    throw new Error('No Supabase accounts configured (check SUPABASE_SECRET_KEY env vars)')
  }
  const usages = await Promise.all(
    ACCOUNTS.map(async a => {
      try {
        const files = await listAllFiles(a)
        return { account: a, usage: await getBucketUsage(files) }
      } catch (e) {
        console.warn(`Could not read usage for account ${a.id}:`, e.message)
        return { account: a, usage: Infinity } // deprioritize accounts we can't read
      }
    })
  )
  usages.sort((x, y) => x.usage - y.usage)
  return usages[0].account
}

// Auto-cleanup: remove excess files once an account is over its storage
// budget. No age-based deletion — marketplace deals often take longer than a
// week to resolve, so files must not disappear out from under an active deal
// purely because of elapsed time. Oldest files are only removed once the
// account is genuinely over MAX_STORAGE_BYTES.
//
// Eviction order is oldest-first across ALL files, transfer-deal or not.
// (Earlier draft tried evicting large transfer-deal files first, on the
// theory that they're "likely stale" — but this file has no visibility into
// deal/escrow status, so a large transfer file could just as easily be part
// of an active, in-progress deal. Prioritizing them for eviction would
// reintroduce the exact "deleted mid-deal" risk that removing age-based
// deletion was meant to avoid. Oldest-first, uniformly, is the safer default
// until cleanup can check actual deal status via Firestore.)
async function autoCleanup() {
  await Promise.all(ACCOUNTS.map(async account => {
    try {
      const files = await listAllFiles(account)
      let totalBytes = await getBucketUsage(files)
      if (totalBytes > MAX_STORAGE_BYTES) {
        const sorted = [...files].sort((a, b) =>
          new Date(a.created_at || 0) - new Date(b.created_at || 0)
        )
        const toDelete = []
        for (const f of sorted) {
          if (totalBytes <= TARGET_STORAGE_BYTES) break
          toDelete.push(f.name)
          totalBytes -= f.metadata?.size || 0
        }
        if (toDelete.length) await deleteFiles(account, toDelete)
      }
    } catch (e) {
      console.warn(`autoCleanup error on account ${account.id} (non-fatal):`, e.message)
    }
  }))
}

// ---------- Firebase Admin init (shared singleton) ----------
// Used to keep its own private admin.initializeApp() credential block
// (see git history) — a fifth independent copy of the same boilerplate
// every other _handler.js file also carried its own copy of. Collapsed
// onto the one shared init in lib/server/adminDb.ts: calling getAdminDb()
// first guarantees the default app is registered (with the exact same
// credentials every other route uses), then admin.apps[0] hands back
// that same default app instance for .auth()/.firestore() below.
import { getAdminDb } from '../../../lib/server/adminDb'
function getFirebaseAdmin() {
  getAdminDb()
  return admin.apps[0]
}

// ---------- Plan limits ----------
// NOTE: transfer-deal uploads (game builds, APK/IPA, zips, db dumps, etc.) are
// inherently larger than marketplace listing assets, so /api/storage applies a
// separate, more generous floor for those file types (see TRANSFER_FILE_EXTS
// and resolveMaxSize() below) on top of the existing plan-based limits.
const PLAN_LIMITS = {
  free:    500 * 1024,        // 500 KB
  starter: 2 * 1024 * 1024,   // 2 MB
  growth:  5 * 1024 * 1024,   // 5 MB
  pro:     8 * 1024 * 1024,   // 8 MB
}

// Rolling per-user upload quota — sum of a user's own uploads within the
// trailing QUOTA_WINDOW_DAYS. Old uploads age out of the sum on their own,
// so this doesn't need a manual reset. This window is independent from
// storage cleanup (autoCleanup() no longer deletes by age — see note above —
// since marketplace deals can run longer than a fixed number of days).
const QUOTA_WINDOW_DAYS = 7
const PLAN_QUOTA_BYTES = {
  free:    5 * 1024 * 1024,    // 5 MB / 7 days
  starter: 20 * 1024 * 1024,   // 20 MB / 7 days
  growth:  45 * 1024 * 1024,   // 45 MB / 7 days
  pro:     75 * 1024 * 1024,   // 75 MB / 7 days
}

// Minimum allowed size for "transfer deal" style binaries/archives (zips,
// db dumps, non-app installers, etc), regardless of plan. Plan limits above
// were tuned for small listing assets (screenshots, page HTML, etc.) — these
// need real headroom. App binaries (apk/aab/obb/apks/xapk/ipa) do NOT use
// this floor — see APP_BINARY_PLAN_LIMITS below, since they live in their
// own dedicated account (account 2) with its own plan-scaled limits instead.
const TRANSFER_FILE_MIN_BYTES = 200 * 1024 * 1024 // 200 MB

// Plan-based limits specifically for app binaries (account 2). Scaled higher
// than the general PLAN_LIMITS since app builds are inherently bigger than
// listing assets, but still bounded per-plan (rather than a flat 200MB floor)
// since account 2 has its own fixed lifetime storage budget to protect.
const APP_BINARY_PLAN_LIMITS = {
  free:    20 * 1024 * 1024,   // 20 MB
  starter: 40 * 1024 * 1024,   // 40 MB
  growth:  75 * 1024 * 1024,   // 75 MB
  pro:     200 * 1024 * 1024,  // 200 MB
}

// Plan-based limits for deal deliverable zips (account 3, the private
// bucket). These files are auto-deleted the moment the buyer downloads them
// (see handleEscrowGetDownloadUrl in deal.js), so account 3's real footprint
// at any given time is just "however many deals currently have an
// undelivered zip" rather than an ever-growing pile — that's what allows
// these limits to be generous relative to account 3's fixed lifetime budget.
const DEAL_FILE_PLAN_LIMITS = {
  free:    5  * 1024 * 1024,   // 5 MB
  starter: 15 * 1024 * 1024,   // 15 MB
  growth:  30 * 1024 * 1024,   // 30 MB
  pro:     50 * 1024 * 1024,   // 50 MB
}
// Free plan gets exactly one deal zip per deal — enforced in the handler
// below by checking Firestore for an existing undelivered deliverable on
// this dealId before accepting a new deal-file upload (see handler()).
const DEAL_FILE_MAX_PER_DEAL_FREE = 1

// ---------- Extension → content-type + default encoding ----------
const EXT_MAP = {
  // ── Text / web ──
  html: { contentType: 'text/html; charset=utf-8',                encoding: 'utf8'   },
  htm:  { contentType: 'text/html; charset=utf-8',                encoding: 'utf8'   },
  css:  { contentType: 'text/css; charset=utf-8',                 encoding: 'utf8'   },
  js:   { contentType: 'application/javascript; charset=utf-8',   encoding: 'utf8'   },
  mjs:  { contentType: 'application/javascript; charset=utf-8',   encoding: 'utf8'   },
  json: { contentType: 'application/json; charset=utf-8',         encoding: 'utf8'   },
  txt:  { contentType: 'text/plain; charset=utf-8',               encoding: 'utf8'   },
  md:   { contentType: 'text/markdown; charset=utf-8',            encoding: 'utf8'   },
  svg:  { contentType: 'image/svg+xml',                           encoding: 'utf8'   },
  sql:  { contentType: 'application/sql; charset=utf-8',          encoding: 'utf8'   },
  env:  { contentType: 'text/plain; charset=utf-8',               encoding: 'utf8'   },
  key:  { contentType: 'text/plain; charset=utf-8',               encoding: 'utf8'   },
  pem:  { contentType: 'application/x-pem-file; charset=utf-8',   encoding: 'utf8'   },
  yml:  { contentType: 'text/yaml; charset=utf-8',                encoding: 'utf8'   },
  yaml: { contentType: 'text/yaml; charset=utf-8',                encoding: 'utf8'   },
  csv:  { contentType: 'text/csv; charset=utf-8',                 encoding: 'utf8'   },

  // ── Images ──
  png:  { contentType: 'image/png',                               encoding: 'base64' },
  jpg:  { contentType: 'image/jpeg',                              encoding: 'base64' },
  jpeg: { contentType: 'image/jpeg',                              encoding: 'base64' },
  gif:  { contentType: 'image/gif',                               encoding: 'base64' },
  webp: { contentType: 'image/webp',                              encoding: 'base64' },

  // ── Documents ──
  pdf:  { contentType: 'application/pdf',                         encoding: 'base64' },
  doc:  { contentType: 'application/msword',                      encoding: 'base64' },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', encoding: 'base64' },
  xls:  { contentType: 'application/vnd.ms-excel',                encoding: 'base64' },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        encoding: 'base64' },

  // ── Archives (site backups, full ZIP downloads, repo exports) ──
  zip:  { contentType: 'application/zip',                         encoding: 'base64' },
  '7z': { contentType: 'application/x-7z-compressed',             encoding: 'base64' },
  rar:  { contentType: 'application/vnd.rar',                     encoding: 'base64' },
  tar:  { contentType: 'application/x-tar',                       encoding: 'base64' },
  gz:   { contentType: 'application/gzip',                        encoding: 'base64' },
  tgz:  { contentType: 'application/gzip',                        encoding: 'base64' },
  bak:  { contentType: 'application/octet-stream',                encoding: 'base64' },

  // ── Apps (App Store Connect / Play Console transfer fallback + Direct APK/IPA) ──
  apk:  { contentType: 'application/vnd.android.package-archive', encoding: 'base64' },
  aab:  { contentType: 'application/octet-stream',                encoding: 'base64' }, // Android App Bundle
  obb:  { contentType: 'application/octet-stream',                encoding: 'base64' }, // Android expansion file (large assets alongside an APK)
  apks: { contentType: 'application/octet-stream',                encoding: 'base64' }, // Split-APK bundle (base APK + config splits)
  xapk: { contentType: 'application/octet-stream',                encoding: 'base64' }, // Split-APK bundle incl. OBB, used by third-party stores
  ipa:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  exe:  { contentType: 'application/vnd.microsoft.portable-executable', encoding: 'base64' },
  msi:  { contentType: 'application/x-msi',                       encoding: 'base64' },
  dmg:  { contentType: 'application/x-apple-diskimage',           encoding: 'base64' },
  pkg:  { contentType: 'application/x-newton-compatible-pkg',     encoding: 'base64' },
  appimage: { contentType: 'application/octet-stream',            encoding: 'base64' },
  deb:  { contentType: 'application/vnd.debian.binary-package',   encoding: 'base64' },

  // ── Games (ROMs / builds / console store codes as text) ──
  rom:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  iso:  { contentType: 'application/x-iso9660-image',             encoding: 'base64' },
  nes:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  sfc:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  gba:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  gb:   { contentType: 'application/octet-stream',                encoding: 'base64' },
  n64:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  nds:  { contentType: 'application/octet-stream',                encoding: 'base64' },
  '3ds':{ contentType: 'application/octet-stream',                encoding: 'base64' },

  // ── Fallback binary ──
  bin:  { contentType: 'application/octet-stream',                encoding: 'base64' },
}

// Extensions treated as "transfer deal" assets — these get the larger
// TRANSFER_FILE_MIN_BYTES floor instead of being capped by the small
// marketplace-listing PLAN_LIMITS.
const TRANSFER_FILE_EXTS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bak', 'sql',
  'apk', 'aab', 'obb', 'apks', 'xapk', 'ipa', 'exe', 'msi', 'dmg', 'pkg', 'appimage', 'deb',
  'rom', 'iso', 'nes', 'sfc', 'gba', 'gb', 'n64', 'nds', '3ds', 'bin',
])

function resolveMaxSize(plan, ext, isDealFile) {
  const planMax = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  if (isDealFile) {
    return DEAL_FILE_PLAN_LIMITS[plan] ?? DEAL_FILE_PLAN_LIMITS.free
  }
  if (APP_BINARY_EXTS.has(ext)) {
    return APP_BINARY_PLAN_LIMITS[plan] ?? APP_BINARY_PLAN_LIMITS.free
  }
  if (TRANSFER_FILE_EXTS.has(ext)) {
    return Math.max(planMax, TRANSFER_FILE_MIN_BYTES)
  }
  return planMax
}

function sanitizeBaseName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9_\-.]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1. Authenticate via Firebase ID token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' })
    }
    const idToken = authHeader.split('Bearer ')[1]
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(idToken)
    const uid = decoded.uid

    // 2. Get user's plan from Firestore
    const db = getFirebaseAdmin().firestore()
    const userDoc = await db.collection('users').doc(uid).get()
    const plan = (userDoc.exists && userDoc.data()?.plan) || 'free'

    // 3. Parse body — back-compat: { html } or new: { filename, content, encoding }
    // isDealFile + dealId are set ONLY by the Transfer Deal modal's finalize
    // upload — this is what pins the file to account 3 and applies the
    // deal-specific plan limits/one-zip-per-deal rule below, rather than any
    // .zip upload being treated as a deal deliverable.
    let { html, filename, content, encoding, isDealFile, dealId } = req.body || {}

    if (html != null && content == null) {
      filename = filename || 'page.html'
      content  = html
      encoding = 'utf8'
    }

    if (content == null) {
      return res.status(400).json({ error: 'Missing "content" (or legacy "html") field' })
    }

    if (isDealFile && !dealId) {
      return res.status(400).json({ error: 'Missing dealId for deal file upload' })
    }

    // 3a. Free plan: at most one deal-deliverable zip per deal. Checked
    // against the dealChats doc directly (dealFileCount field, bumped by
    // deal.js when the finalize message is written) rather than by listing
    // storage, since a deal's zip may already have been auto-deleted after
    // a prior download but the "you already used your one zip" restriction
    // should still hold for that dealId.
    if (isDealFile && plan === 'free') {
      const dealDoc = await db.collection('dealChats').doc(dealId).get()
      const existingCount = (dealDoc.exists && dealDoc.data()?.dealFileCount) || 0
      if (existingCount >= DEAL_FILE_MAX_PER_DEAL_FREE) {
        return res.status(403).json({
          error: `Free plan allows only ${DEAL_FILE_MAX_PER_DEAL_FREE} deliverable zip per deal. Upgrade your plan to send more.`,
        })
      }
    }

    filename = sanitizeBaseName(filename || 'file.txt')
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/)
    const ext = extMatch ? extMatch[1].toLowerCase() : ''
    const known = EXT_MAP[ext]

    if (!known) {
      return res.status(400).json({
        error: `Unsupported file type ".${ext || '?'}". Allowed: ${Object.keys(EXT_MAP).join(', ')}`,
      })
    }

    const useEncoding = (encoding === 'base64' || encoding === 'utf8') ? encoding : known.encoding

    let buffer
    try {
      buffer = useEncoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf-8')
    } catch {
      return res.status(400).json({ error: 'Could not decode file content' })
    }

    if (buffer.length === 0) {
      return res.status(400).json({ error: 'File is empty' })
    }

    const maxSize = resolveMaxSize(plan, ext, isDealFile)
    if (buffer.length > maxSize) {
      const limitLabel = maxSize >= 1024 * 1024
        ? `${(maxSize / (1024 * 1024)).toFixed(0)} MB`
        : `${(maxSize / 1024).toFixed(0)} KB`
      return res.status(413).json({
        error: `File too large. The limit for this file type on your ${plan} plan is ${limitLabel}.`,
      })
    }

    // 3b. Rolling per-user quota check (skipped for transfer-deal file types
    // and deal-deliverable zips, which already have their own dedicated
    // limits and are gated by the deal/escrow flow rather than casual
    // free-tier use)
    if (!TRANSFER_FILE_EXTS.has(ext) && !isDealFile) {
      const quota = PLAN_QUOTA_BYTES[plan] ?? PLAN_QUOTA_BYTES.free
      const used = await getUserRollingUsage(uid, QUOTA_WINDOW_DAYS)
      if (used + buffer.length > quota) {
        const quotaLabel = quota >= 1024 * 1024
          ? `${(quota / (1024 * 1024)).toFixed(0)} MB`
          : `${(quota / 1024).toFixed(0)} KB`
        return res.status(413).json({
          error: `Upload quota exceeded. Your ${plan} plan allows ${quotaLabel} of uploads per ${QUOTA_WINDOW_DAYS} days; older uploads will free up space automatically as they age out.`,
        })
      }
    }

    // 4. Pick which Supabase account to use. Deal-deliverable zips are pinned
    // to account 3 (see pickAccountForDealFile — checked first since a deal
    // zip is still technically a .zip and would otherwise fall through to
    // the app-binary/least-used logic below). App binaries (apk/aab/obb/
    // apks/xapk/ipa) are pinned to account 2. Everything else keeps the
    // existing least-used routing across all accounts. Uploaded via REST (no
    // createClient → no WebSocket init).
    // Filename-prefixed with the uid (not a storage folder — see UID_SEP note
    // above) so per-user rolling usage can be computed from the flat listing,
    // and so one user's files can never collide/overwrite another's. The
    // account id is prefixed too (see ACCOUNT_SEP) so later lookups/deletes/
    // signed-url requests know which account without a DB round-trip.
    const account = isDealFile ? await pickAccountForDealFile() : await pickAccountForExt(ext)
    const baseName  = filename.replace(/\.[a-zA-Z0-9]+$/, '') || 'file'
    const storedName = `${uid}${UID_SEP}${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const fullStoredName = `${account.id}${ACCOUNT_SEP}${storedName}`

    await supabaseUpload(account, storedName, buffer, known.contentType)

    // Bump the deal's on-record zip count so the free-plan one-zip-per-deal
    // check above still holds even after this file is later auto-deleted on
    // buyer download (see handleEscrowGetDownloadUrl in deal.js).
    if (isDealFile) {
      await db.collection('dealChats').doc(dealId).set(
        { dealFileCount: admin.firestore.FieldValue.increment(1) },
        { merge: true }
      ).catch(e => console.warn('dealFileCount increment failed (non-fatal):', e.message))
    }

    // 5. Non-blocking cleanup (runs across all accounts)
    autoCleanup().catch(e => console.warn('cleanup error:', e.message))

    // Transfer-deal files (game builds, zips, credential bundles, etc.) never
    // get a permanent public URL — they're only accessible via a short-lived
    // signed URL minted per-request through /api/deal (escrow-get-download-url),
    // which checks the caller is actually a participant on the deal the file
    // belongs to. This avoids a permanent, unauthenticated link to files that
    // frequently contain credentials.json / private keys / source dumps ending
    // up stored in a Firestore chat message forever.
    if (TRANSFER_FILE_EXTS.has(ext)) {
      return res.status(200).json({
        storagePath: fullStoredName, // includes "<accountId>@@" prefix
        filename:    fullStoredName, // same value — kept consistent with the non-transfer response below so callers can always resolve the account from either field
        contentType: known.contentType,
        size:        buffer.length,
      })
    }

    // Public buckets get a direct public URL; private buckets (like account 2
    // until its visibility is confirmed) get a signed URL instead so the file
    // is still reachable without exposing an unauthenticated permanent link.
    const url = account.isPublic
      ? supabasePublicUrl(account, storedName)
      : await supabaseCreateSignedUrl(account, storedName, 60 * 60 * 24 * 7) // 7 days
    return res.status(200).json({
      url,
      filename:    fullStoredName, // includes "<accountId>@@" prefix so it can be resolved later
      contentType: known.contentType,
      size:        buffer.length,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: err.message })
  }
}
