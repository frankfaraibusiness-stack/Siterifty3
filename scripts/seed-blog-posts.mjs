/**
 * Publishes 3 SEO-targeted blog posts to Siterifty via the real,
 * admin-gated POST /api/blog endpoint — the same path the "Add Blog"
 * button in the UI uses. This does NOT write to Firestore directly;
 * it goes through app/api/blog/route.ts's own admin verification,
 * so it only works with real admin credentials.
 *
 * USAGE:
 *   1. Set these env vars before running:
 *        SITE_URL=https://your-deployed-domain.com   (defaults to http://localhost:3000)
 *        ADMIN_ID_TOKEN=<a fresh Firebase ID token for your ADMIN_EMAIL account>
 *
 *      To get ADMIN_ID_TOKEN: sign in to the site as your admin account in
 *      the browser, open devtools console, and run:
 *        await firebase.auth().currentUser.getIdToken()
 *      (or however your app's client SDK exposes the current user —
 *      the token just needs to belong to the ADMIN_EMAIL account and
 *      be less than ~1hr old when you run this script).
 *
 *   2. Run:  node scripts/seed-blog-posts.mjs
 *
 * Each post's coverImage points at /images/siterifty-logo.png on your
 * own domain (SITE_URL) — swap in a real hero image per post if you
 * have one; the logo is used here as the safe default asset that's
 * already in the repo.
 */

const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const ADMIN_ID_TOKEN = process.env.ADMIN_ID_TOKEN;

if (!ADMIN_ID_TOKEN) {
  console.error(
    "Missing ADMIN_ID_TOKEN. Sign in as your admin account, grab a fresh ID token, and set ADMIN_ID_TOKEN before running this script."
  );
  process.exit(1);
}

const LOGO_URL = `${SITE_URL}/images/siterifty-logo.png`;

const posts = [
  {
    title: "How to Sell a Website Fast: A Founder's Guide to a Clean Exit",
    description: `Selling a website or SaaS product is nothing like selling a used car — there's no blue book value, and most founders only do it once. Here's the real playbook.

Start with your numbers, not your story. Buyers on Siterifty care about three things above everything else: monthly recurring revenue or traffic trend, how much of the business depends on you personally, and how clean your books are. Before you list anything, pull 12 months of revenue data, screenshot your analytics dashboard, and write down every recurring cost — hosting, APIs, contractors, subscriptions. A listing backed by real numbers sells faster than one backed by adjectives.

Price it like a buyer, not a founder. Most small web businesses sell for a multiple of monthly profit, not revenue — typically somewhere between 20x and 40x monthly net profit depending on growth trend, diversification of traffic/customers, and how automated the operations are. A site that needs you working on it 20 hours a week will sell for less than one that runs itself. If you're unsure where you land, list a fair range and let escrow-protected offers do the rest of the work.

Get your documentation in order before you list. The single biggest reason deals fall apart mid-negotiation is a buyer discovering something during due diligence that wasn't disclosed upfront — an expiring contract, a customer concentration risk, a piece of unlicensed code. Write a short, honest "known issues" section into your listing. It slows down zero serious buyers and it filters out every unserious one.

Use escrow, every time. Wire transfers and PayPal invoices outside of an escrow system are how website sales turn into cautionary Reddit threads. On Siterifty, funds are held until the buyer confirms the assets — domain, codebase, accounts, credentials — have actually transferred, which protects both sides and removes the "trust me" step that kills deals.

Finally, don't ghost your buyer after the sale. A 30-minute handoff call answering "how do I redeploy this" questions costs you almost nothing and is the difference between a five-star review and a dispute. Sellers who over-communicate during handoff get repeat buyers and referrals; sellers who disappear get chargebacks.

If you're getting ready to list, start by browsing Siterifty's marketplace to see how similar sites in your category are priced and described — then write your own listing to match or beat the best ones you find.`,
    coverImage: LOGO_URL,
  },
  {
    title: "Buying Your First Website: 7 Red Flags to Check Before You Pay",
    description: `Buying an existing website or app can be a genuine shortcut past the hardest part of building a business — getting to your first customers. It can also be a very fast way to lose money if you skip the checks that matter. Here's what actually separates a good acquisition from an expensive mistake.

1. Traffic and revenue that don't match the screenshots. Screenshots can be cropped, filtered, or simply old. Before you commit to anything, ask for read-only access to the actual analytics account (Google Analytics, Stripe, ad platform dashboards) covering at least the trailing 12 months. A seller who's reluctant to share this is telling you something.

2. Revenue concentrated in one customer or one traffic source. A site earning $3,000/month evenly across hundreds of customers is a fundamentally different (and safer) asset than one earning $3,000/month from a single client or a single Google ranking that could vanish in an algorithm update. Ask directly: "What's your largest single source of revenue as a percentage of the total?"

3. Hidden technical debt. Get access to the actual codebase, not just a demo, before you finalize anything. Outdated dependencies, deprecated APIs, or code tightly coupled to a service the seller personally maintains can turn "buy and run" into "buy and rebuild."

4. Declining trend dressed up as a one-time dip. Ask for month-by-month numbers, not just a total. A site that's down 30% over the last two quarters needs a very different offer than one that's flat or growing — and a seller presenting only annual totals is often (not always) hiding a slide.

5. Unclear ownership of assets. Confirm the seller actually owns the domain, the code, any trademarks, and any third-party licenses being transferred — and get it in writing as part of the deal terms. This is exactly what escrow-based transfers are built to verify before funds ever release.

6. No handoff plan. If the business depends on knowledge that only exists in the seller's head — a manual process, an undocumented workaround, a relationship with a supplier — get that documented or get a defined handoff period written into the deal before you pay.

7. Pressure to skip due diligence. "Someone else is about to buy it" urgency is the oldest trick in any sales process, digital assets included. A legitimate seller with a solid business can afford to give you a week to verify the numbers. If they can't, that's the biggest red flag on this list.

None of this means slow-walking every deal into paralysis — it means checking the handful of things that actually predict whether an acquisition works out. Browse active listings on Siterifty's marketplace, and use escrow on every purchase so your payment is protected until you've verified exactly what you're buying.`,
    coverImage: LOGO_URL,
  },
  {
    title: "Escrow for Website Sales, Explained: Why 'Just Send a Wire' Is How Deals Go Wrong",
    description: `Every experienced buyer and seller of websites, apps, or digital businesses has a story — or knows someone with a story — about a deal that fell apart after money moved without protection. Escrow exists specifically to make sure that story doesn't become yours.

Here's the problem escrow solves. A typical website sale has an awkward sequencing issue: the buyer doesn't want to pay before receiving the domain, codebase, and account access, and the seller doesn't want to hand over a business they built before getting paid. Whoever moves first is trusting a stranger. Escrow removes that standoff by having a neutral third party hold the funds until both sides confirm their part of the deal is done.

How it actually works on a platform like Siterifty: the buyer's payment goes into escrow, not directly to the seller. The seller then transfers the agreed assets — domain registrar access, source code, hosting/server access, social accounts, customer data if applicable, whatever was specified in the listing. The buyer gets a defined window to verify everything works and matches what was described. Only once the buyer confirms does escrow release the funds to the seller. If something doesn't match what was promised, there's a dispute process instead of a buyer just being out their money with no recourse.

Why "just send a wire, I'll transfer everything right after" is riskier than it sounds. Once funds leave a buyer's account via wire or an unprotected payment, there's no built-in mechanism to reverse it if the seller doesn't deliver, delivers something different than described, or simply disappears. This isn't about assuming bad faith — most sellers are honest — it's that escrow removes the need to bet an entire transaction on trust between two people who, in most cases, just met.

What escrow protects sellers from too. It's not only a buyer safeguard. Sellers benefit from knowing the funds are real and already secured before they do the work of transferring a domain, migrating a codebase, or handing over admin credentials — instead of transferring first and hoping payment follows.

What to actually check before any deal closes, escrow or not: confirm asset ownership matches what's listed, get the handoff scope in writing (exactly which accounts/credentials transfer), and don't release final confirmation until you've logged into everything and verified it works.

Escrow doesn't replace due diligence — it protects the money while due diligence happens. Read more on how it works on Siterifty's escrow and buyer protection pages before your next deal, and always keep transactions inside the platform's protected flow rather than moving to a side payment "to save on fees" — that's the single most common way protection gets voided.`,
    coverImage: LOGO_URL,
  },
];

async function publish(post) {
  const res = await fetch(`${SITE_URL}/api/blog`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_ID_TOKEN}`,
    },
    body: JSON.stringify({ action: "create", ...post }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Failed to publish "${post.title}": ${json.error || res.status}`);
  }
  return json.post;
}

(async () => {
  for (const post of posts) {
    try {
      const saved = await publish(post);
      console.log(`✓ Published: ${saved.title} (id: ${saved.id})`);
    } catch (err) {
      console.error(`✗ ${err.message}`);
    }
  }
})();
