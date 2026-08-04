"use client";

import { useNavDrawer } from "@/components/layout/NavDrawerProvider";

// Ports #navOverlay — the semi-transparent backdrop behind the open
// drawer. Click-to-close mirrors navOverlay.addEventListener('click', closeNav)
// in auth-modal.js.
export default function NavDrawerOverlay() {
  const { isOpen, closeNav } = useNavDrawer();
  return <div id="navOverlay" className={isOpen ? "open" : undefined} onClick={closeNav} />;
}
