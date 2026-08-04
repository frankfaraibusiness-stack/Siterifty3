FIXES ONLY — round 2 (scroll dead on Profile/Settings/Wallet, banner
hidden under header, Back button). Drop these into your project at the
same paths, overwriting the existing files.

1) SCROLL COMPLETELY DEAD ON /myprofile AND /settings
   components/profile/MyProfileHub.tsx
   app/settings/page.tsx
   - Root cause: both pages had a permanent, unconditional scroll lock
     left over from when they were fixed-viewport overlays —
     MyProfileHub called useScrollLock(true) (always on, for the entire
     time the component was mounted), and Settings called
     useScrollLock(!!user) (on for as long as you were signed in). That
     locks html+body scroll globally — not just "while a modal is open
     over this page," but literally the whole page, permanently. Removed
     both. Settings' internal sidebar+detail-panel two-pane scroll still
     works — it never needed the document-level lock to begin with, that
     was solving a self-inflicted layout problem (see next item).

2) PROFILE BANNER RENDERING UNDERNEATH THE REAL HEADER
   app/styles/profile.css
   app/settings/page.tsx
   - Root cause: #profileModal (and Settings' wrapper) never got the
     marginTop:92 every other real page uses to clear the real site
     Header (52px, position:fixed) + AnnouncementBar (40px,
     position:fixed) stacked above it. They used to get that clearance
     for free from their own PanelHeader (now removed, see #3), which
     occupied roughly that space itself. Added margin-top:92px to
     #profileModal, corrected .pm-modal-header's sticky offset from
     52px to 92px to match (it was sticking underneath/overlapping the
     announcement bar), and gave Settings' wrapper the same marginTop:92
     + a proper calc(100dvh - 92px) height instead of min-height:100dvh
     with no top offset.

3) BACK BUTTON — REAL HEADER NOW HANDLES IT, PanelHeader REMOVED
   components/layout/AnnouncementBar.tsx
   components/profile/MyProfileHub.tsx
   app/settings/page.tsx
   - AnnouncementBar already swapped its Upgrade/Manage-Plan button for
     a Back button on /upgrade and /donate/[id]. Extended that same
     mechanism to /myprofile and /settings, and removed both pages' own
     PanelHeader (a duplicate hamburger+logo+back row that never
     accounted for the announcement bar's height — the actual source of
     item #2). /myprofile's Back button always goes to "/" (Home) — it
     can be reached from many different places (a listing's seller
     avatar, a notification, a deep link), so router.back() there could
     land anywhere including an empty history stack; Home is the one
     predictable destination. /settings and /upgrade/donate keep normal
     router.back() (go to wherever you came from), since those are
     reached from a small, predictable set of places.

4) TOUCH-SCROLL DEAD INSIDE SEVERAL MODALS' OWN CONTENT
   components/wallet/WalletModal.tsx (#walletModalBody)
   components/listing/EditListingModal.tsx (.el-body)
   components/auth/AuthModal.tsx (.am-body)
   components/marketplace/SearchOverlay.tsx (.mp-so-body)
   components/marketplace/MarketplaceModal.tsx (modal root itself)
   components/boost/BoostModal.tsx (inline overflowY:auto body)
   components/dispute/DisputePicker.tsx (#srfDisputeBody)
   components/messages/TransferDealModal.tsx (.tdm-checklist-main, both
     the loading and real-content occurrences)
   components/support/AiSupportChatPanel.tsx (message list)
   - Same root cause as the earlier NavDrawer scroll fix: the shared
     scroll lock (lib/useScrollLock.ts) blocks touchmove everywhere on
     the page while any modal is open, except on elements marked
     data-scroll-lock-exempt. Each of the 9 files above has its own
     internal overflow-y:auto scroll area that was never given that
     exemption, so on touch devices none of these could be
     drag-scrolled at all while open — audited every component in the
     codebase that calls useScrollLock and checked each one's actual
     scroll container; these were the ones still missing it.
   - AuthModal specifically still had a *stale* attribute name,
     data-sr-modal-scroll, left over from before the shared
     useScrollLock hook existed — the current hook's touch blocker only
     recognizes data-scroll-lock-exempt, so that old attribute was
     silently doing nothing. Fixed to the current attribute name.
   - Checked and confirmed already correct / no fix needed: RateOverlay
     (no internal scroll), ThemeModal, AgentModal, DiscoverPanel,
     NavDrawer, OnboardingWizard, DealChatPanel, LogoutModal,
     FeedbackWidget, RequestPaymentOverlay, and the 3 system takeover
     overlays (Maintenance/AccountAppeal/AccountStatus — none of these
     have an internal scrollbox to begin with).

HOW TO APPLY
============
Extract this zip into the ROOT of your project (the folder containing
your app/, components/, and lib/ folders) — paths mirror your project
structure exactly. Every file here overwrites an existing file; nothing
in this zip is new.
