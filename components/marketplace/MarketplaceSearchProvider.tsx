"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import MarketplaceModal from "@/components/marketplace/MarketplaceModal";

// Lets any component — regardless of which page it's mounted on — open
// the full-screen marketplace search takeover (MarketplaceModal, with
// SearchOverlay auto-opened). Same provider shape as
// WalletModalProvider/AuthModalProvider: consumers call
// useMarketplaceSearch().openSearch() instead of managing their own
// modal/portal state.
//
// This exists specifically so BottomNav's search button (#fnavSearch),
// which is mounted globally via HomeMarketplaceOnly and has no access to
// any single page's local state, has something to call — previously it
// had no onClick at all and did nothing when tapped.
interface MarketplaceSearchContextValue {
  openSearch: () => void;
}

const MarketplaceSearchContext = createContext<MarketplaceSearchContextValue>({
  openSearch: () => {},
});

export function useMarketplaceSearch() {
  return useContext(MarketplaceSearchContext);
}

export function MarketplaceSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <MarketplaceSearchContext.Provider value={{ openSearch: () => setOpen(true) }}>
      {children}
      <MarketplaceModal open={open} onClose={() => setOpen(false)} />
    </MarketplaceSearchContext.Provider>
  );
}
