# Siterifty — Notification Center Fixes

## 1. Panel was see-through / hard to read
`.notif-center-panel` had a flat solid fill (`#0a0a0f`) while the blur
lived on the overlay behind it instead — combined with a fairly thin
visual treatment, it read as insubstantial/see-through rather than a
real glassy surface.

Fixed in `app/styles/notifications.css`: the blur + saturation now live
on the panel itself, layered over a solid near-black base
(`rgba(8,8,12,0.92)` + `backdrop-filter: blur(24px) saturate(140%)`),
with a subtle left border and drop shadow. Proper glassy-black card now,
text stays fully legible (titles are solid white, body text 50% white —
plenty of contrast either way).

## 2. Real notifications never showed up, only the unread count worked
Root cause: both `useNotificationCenter` and `useNotifications` (the
hook that also feeds the toast stack / "missed while away" carousel)
queried with `orderBy("createdAt", "desc")`.

Firestore's `orderBy(field)` **silently excludes any document where that
field doesn't exist** — no error, just missing from the results. Some
notification docs in this app don't have `createdAt` (older ones, or
ones written by a path that doesn't set it), so the ordered query was
returning zero/partial results for real users. The separate unread-count
badge query (`where("read","==",false)`, no `orderBy`) doesn't exclude
anything, so it kept counting correctly — that mismatch is exactly the
"counter's right, list is empty" symptom.

Fixed in `lib/notifications.ts`: both hooks now query without `orderBy`
and sort client-side instead (`rows.sort(...)` by `ntfToMillis`), which
never drops a document regardless of what fields it has.
