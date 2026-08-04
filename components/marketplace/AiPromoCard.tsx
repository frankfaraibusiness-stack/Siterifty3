// Ports mpBuildAiPromoCard from marketplace.js — promotes the seller-facing
// AI listing tools (auto-generated titles/descriptions, pricing
// suggestions, screenshot enhancement). Plain link to /aitools per the
// original spec (a plain <a href="/pages/aitools">, no modal wiring, unlike
// SellerPromoCard) — that page doesn't exist in this Next.js app yet
// (same "will 404 until built" situation as the nav drawer's static-page
// links), so this preserves the link rather than routing it to a stub.
export default function AiPromoCard() {
  return (
    <div className="sr-ai-promo">
      <div
        className="sr-ai-promo-media"
        style={{
          backgroundImage:
            "url('https://www.image2url.com/r2/default/images/1783877370971-e6365528-ed07-4b90-81c0-f54c80a83c72.jpg')",
        }}
      >
        <div className="sr-ai-promo-badge">AI TOOLS</div>
      </div>
      <div className="sr-ai-promo-body">
        <h3 className="sr-ai-promo-title">List smarter, sell faster</h3>
        <div className="sr-ai-promo-accent" />
        <ul className="sr-ai-promo-list">
          <li>Generate scroll-stopping titles &amp; descriptions in seconds</li>
          <li>Smart pricing suggestions based on real market data</li>
          <li>Auto-enhance screenshots for a professional look</li>
        </ul>
        <p className="sr-ai-promo-free">Free to use — no credit card required</p>
        <a href="/aitools" className="sr-ai-promo-cta">
          Start using AI tools
        </a>
      </div>
    </div>
  );
}
