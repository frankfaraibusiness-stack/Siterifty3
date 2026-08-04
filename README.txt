Auction feature — patch zip
============================
Extract this zip directly into the root of your project, overwriting
existing files at matching paths. Folder structure already matches
your project (app/, components/, lib/).

NEW FILES (didn't exist before):
  lib/useAuctionTimer.ts
  components/marketplace/AuctionBadge.tsx
  components/listing/BidModal.tsx

EDITED FILES (overwrite the existing ones):
  lib/listings.ts
  app/api/listings/_handler.js
  app/listing/[id]/getListing.ts
  components/deal/DealCtaBar.tsx
  components/marketplace/SiteCard.tsx
  components/marketplace/AppCard.tsx
  components/marketplace/GameCard.tsx
  components/marketplace/AssetCard.tsx
  components/listing/WebsiteListingForm.tsx
  components/listing/AppListingForm.tsx
  components/listing/GameListingForm.tsx
  components/listing/AssetListingForm.tsx
  app/styles/listing-cards.css
  app/styles/listing-body.css
  app/styles/marketplace.css

NOT CHANGED:
  components/listing/TemplateListingForm.tsx — left untouched on purpose.
  Templates are multi-buyer listings, not unique one-off assets, so
  auctions don't apply (confirmed with you earlier).

IMPORTANT — run before deploying:
  npm run build
I don't have your dependencies installed in my environment, so this was
verified with careful manual review + Node's own syntax checker on the
JS backend file, not a real TypeScript compile. Run your actual build
before shipping.

One bug I introduced and fixed during review: an early edit to
_handler.js accidentally deleted the `handleDelete` function signature,
which would have broken listing deletion entirely. Caught via
`node --check`, fixed, and reverified — the version in this zip is correct.
