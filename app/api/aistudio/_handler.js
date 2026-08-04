// /api/aistudio.js
// Siterifty AI Studio — single entry point for every AI feature on the
// platform, plus a couple of non-AI features folded in here purely to
// stay under the hobby-plan serverless function count:
//   1. Support chat ("Chay")               action: 'chat'
//   2. User-to-user chat scam guard        action: 'scam-check'
//   3. Listing auto-description generator  action: 'auto-description'
//   4. Send-deal message assist            action: 'deal-message-assist'
//   5. Reports/disputes auto-triage        action: 'triage-report' | 'triage-dispute'
//   6. Feedback suggestion dedupe          action: 'feedback-dedupe' (gray-zone tiebreaker only)
//   7. "Recommended for you" listings      action: 'recommendations' (no AI call — folded in from old /api/aisearch.js)
//   8. In-app feedback board               action: 'feedback-submit' | 'feedback-list-top' | 'feedback-vote-existing' | 'feedback-list-archive' | 'feedback-get-cycle' | 'feedback-list-for-review' | 'feedback-set-status' | 'check-nudge' (folded in from old /api/feedback.js; weekly 7-day cycle with a permanent top-3-per-week archive, see the FEATURE comment block below for the full schema)
//   9. Seller AI agent's model calls       action: 'agent-deal-decision' | 'agent-auto-reply' (internal-token only — called by the AI agent module folded into api/deal.js, which owns eligibility/quota/scheduling and settles deals via its own settleDealCore)
//
// Providers: Groq (GROQ_API_KEY) + Google AI Studio / Gemini (GEMINI_API_KEY).
// Every feature has a PRIMARY model and an ordered FALLBACK chain. If a call
// fails (rate limit, 5xx, timeout) we automatically try the next model in the
// chain. This matters because several Groq free-tier models here are capped
// at ~1K requests/day — a single point of failure would take the feature down
// for the rest of the day.
//
// Env vars required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY, GROQ_API_KEY, GEMINI_API_KEY

import admin from 'firebase-admin';

// ── Firebase Admin init (singleton across invocations) ──
//
// During `next build`, Next.js imports/parses every API route module as
// part of the build's collection phase — even though this handler never
// actually runs at build time. Vercel's build container does not have the
// production Firebase env vars populated then, so admin.credential.cert()
// would throw ("Service account object must contain a string 'project_id'
// property.") purely from module evaluation and crash the whole build.
// Fall back to a dummy credential in that case so the module can load; any
// real Firestore call made through this dummy credential at runtime would
// still fail loudly (as it should) if the real env vars are truly missing
// in production.
if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  } else {
    credential = {
      getAccessToken: () => Promise.resolve({ access_token: 'dummy', expires_in: 3600 }),
    };
  }
  admin.initializeApp({ credential });
}
// Lazy so `admin.firestore()` — which throws immediately if the credential
// isn't a real cert/ADC credential — never runs at module-import time (e.g.
// during `next build` page-data collection). It only runs the first time a
// request handler actually touches `db`, by which point real env vars are
// present in production.
let _db;
const db = new Proxy({}, {
  get(_target, prop) {
    if (!_db) _db = admin.firestore();
    return _db[prop];
  },
});
const FieldValue = admin.firestore.FieldValue;

// ════════════════════════════════════════════════════════════════════════
// PROVIDER ROUTER
//
// A "model spec" is { provider: 'groq' | 'gemini', model: '<id>' }.
// callModel() normalizes both providers to the same shape the rest of this
// file uses: { content, tool_calls } — so feature code never has to know
// which provider actually answered.
//
// IMPORTANT: model ID strings below are taken directly from the rate-limit
// table provided when this router was built. Verify exact API model-ID
// strings (they can differ slightly from dashboard display names) against
// https://console.groq.com/docs/models and Google AI Studio before relying
// on this in production — some names here (Gemini 3.x line) could not be
// independently verified at the time this file was written.
// ════════════════════════════════════════════════════════════════════════

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

async function callGroq({ model, messages, tools, temperature, max_tokens }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
      temperature: temperature ?? 0.4,
      max_tokens: max_tokens ?? 1000,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`groq:${model} ${res.status} ${errText}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    tool_calls: choice?.message?.tool_calls ?? null,
    raw_message: choice?.message ?? null,
  };
}

// Gemini's REST shape differs from OpenAI's. We translate a plain
// system+messages array into Gemini's { systemInstruction, contents } shape.
// Tool-calling on Gemini uses a different schema (functionDeclarations); for
// simplicity/reliability, Gemini is used here as a TEXT/VISION fallback
// (no tool-calls) — if a Groq tool-calling model chain is fully exhausted,
// the feature falls back to a plain-text Gemini answer instead of erroring.
async function callGemini({ model, messages, temperature, max_tokens, imageParts }) {
  const systemMsg = messages.find(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system' && m.role !== 'tool');

  const contents = rest.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  // Attach images (for vision use-cases) to the final user turn.
  if (imageParts?.length && contents.length) {
    contents[contents.length - 1].parts.push(...imageParts);
  }

  const body = {
    contents,
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    generationConfig: {
      temperature: temperature ?? 0.4,
      maxOutputTokens: max_tokens ?? 1000,
    },
  };

  const res = await fetch(GEMINI_URL(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gemini:${model} ${res.status} ${errText}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return { content: text, tool_calls: null, raw_message: null };
}

// ── Daily usage tracking ──
// Each provider resets its daily (RPD) quota at a different clock boundary:
//   - Google AI Studio: midnight Pacific Time, every day, regardless of when
//     you hit the cap.
//   - Groq: daily quotas reset on a rolling 24h-from-first-use / UTC daily
//     cycle per Groq's own docs. We bucket Groq by UTC calendar day here;
//     adjust getDateBucket() if Groq's dashboard shows a different boundary
//     for your account tier.
// RPM/TPM (per-minute) limits are NOT tracked here — those are rolling
// windows, not daily, so a 429 on those is handled by the reactive catch in
// callWithFallback() rather than by this proactive counter.
function getDateBucket(provider) {
  const now = new Date();
  if (provider === 'gemini') {
    // Convert to Pacific Time (UTC-8 standard / UTC-7 daylight). Using
    // Intl so DST is handled correctly rather than a fixed offset.
    const pt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    return pt; // 'YYYY-MM-DD' in Pacific time
  }
  // Groq: bucket by UTC calendar day.
  return now.toISOString().slice(0, 10);
}

async function getUsageCount(provider, model) {
  const bucket = getDateBucket(provider);
  const docId = `${provider}__${model.replace(/\//g, '_')}__${bucket}`;
  try {
    const snap = await db.collection('aiUsage').doc(docId).get();
    return snap.exists ? (snap.data().count || 0) : 0;
  } catch (err) {
    console.error('[aistudio] usage read failed, assuming 0:', err.message);
    return 0; // fail open — don't block calls if Firestore hiccups
  }
}

async function incrementUsageCount(provider, model) {
  const bucket = getDateBucket(provider);
  const docId = `${provider}__${model.replace(/\//g, '_')}__${bucket}`;
  try {
    await db.collection('aiUsage').doc(docId).set({
      provider, model, bucket,
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('[aistudio] usage increment failed (non-fatal):', err.message);
  }
}

// Try each model in `chain` in order until one succeeds. `chain` is an array
// of model specs: [{provider:'groq', model:'...', rpd:N}, ...].
// Before calling a model we check its counted usage today against its rpd
// cap (90% safety margin) and skip straight to the next model if it's
// likely exhausted — this avoids wasting a round-trip on a call we can
// already predict will 429. We still catch actual 429s as a fallback for
// cases where our counter is out of sync (e.g. other traffic hitting the
// same key outside this app).
async function callWithFallback(chain, params, { requireContent = false } = {}) {
  let lastErr;
  for (const spec of chain) {
    if (spec.rpd) {
      const used = await getUsageCount(spec.provider, spec.model);
      if (used >= spec.rpd * 0.9) {
        console.warn(`[aistudio] skipping ${spec.provider}:${spec.model} — ${used}/${spec.rpd} daily requests used`);
        continue;
      }
    }
    try {
      const out = spec.provider === 'groq'
        ? { ...(await callGroq({ ...params, model: spec.model })), usedModel: `groq:${spec.model}` }
        : { ...(await callGemini({ ...params, model: spec.model })), usedModel: `gemini:${spec.model}` };
      // Some callers (e.g. auto-description) need actual prose back — a model
      // can return HTTP 200 with empty/blank content (max_tokens hit before
      // any text, a safety filter emptying the candidate, tool-call-only
      // response with no message text, etc.). Without this check that was
      // treated as a *success* with an empty string, so the description box
      // silently stayed blank with no error shown anywhere. Treat it as a
      // failure here so we fall through to the next model in the chain, and
      // only give up (with a real error message) once every model has either
      // errored or come back empty.
      if (requireContent && !(out.content || '').trim()) {
        lastErr = new Error(`${out.usedModel} returned an empty response`);
        console.error('[aistudio] model returned empty content, trying next:', out.usedModel);
        continue;
      }
      incrementUsageCount(spec.provider, spec.model); // fire-and-forget, don't block the response
      return out;
    } catch (err) {
      lastErr = err;
      const isRateLimit = /429|rate.?limit|resource_exhausted/i.test(err.message);
      if (isRateLimit) {
        // Our counter may be stale (e.g. shared key usage elsewhere) — mark
        // this model as maxed for the rest of today so we stop retrying it.
        await db.collection('aiUsage').doc(`${spec.provider}__${spec.model.replace(/\//g, '_')}__${getDateBucket(spec.provider)}`)
          .set({ count: spec.rpd || 999999 }, { merge: true }).catch(() => {});
      }
      console.error('[aistudio] model failed, trying next:', err.message);
    }
  }
  throw new Error(`All models in chain exhausted. Last error: ${lastErr?.message}`);
}

// ── Per-feature model chains ──
// NOTE ON PROMPT GUARD: meta-llama/llama-prompt-guard-2-* is a jailbreak /
// prompt-injection CLASSIFIER, not a scam-detector — it's trained to catch
// attempts to manipulate an LLM, not human-to-human "pay me outside escrow"
// scams. For the marketplace scam-guard we use it only as a cheap first-pass
// filter on the incoming text, then run the actual scam judgment through
// gpt-oss-safeguard-20b (a policy-classification model) with a scam-specific
// policy. Both run before a message is ever delivered.
// `rpd` = requests/day cap from the provider table used to build this router.
// Used by the usage tracker below to proactively skip a model BEFORE it 429s,
// instead of waiting for a failed call. Gemini models reset at midnight
// Pacific Time; Groq resets on its own daily cycle (UTC) per Groq's docs —
// see getDateBucket() below for how each is computed.
const CHAINS = {
  chat: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'groq', model: 'openai/gpt-oss-120b', rpd: 1000 },
    { provider: 'groq', model: 'qwen/qwen3-32b', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash', rpd: 20 },
  ],
  scamGuardClassifier: [ // fast first pass, injection/jailbreak style signals
    { provider: 'groq', model: 'meta-llama/llama-prompt-guard-2-86m', rpd: 14400 },
    { provider: 'groq', model: 'meta-llama/llama-prompt-guard-2-22m', rpd: 14400 },
  ],
  scamGuardJudge: [ // actual scam-pattern judgment
    { provider: 'groq', model: 'openai/gpt-oss-safeguard-20b', rpd: 1000 },
    { provider: 'groq', model: 'qwen/qwen3-32b', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  autoDescription: [
    { provider: 'groq', model: 'openai/gpt-oss-20b', rpd: 1000 },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  dealMessageAssist: [
    { provider: 'groq', model: 'openai/gpt-oss-20b', rpd: 1000 },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  reportsTriage: [
    { provider: 'groq', model: 'openai/gpt-oss-120b', rpd: 1000 },
    { provider: 'groq', model: 'qwen/qwen3-32b', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash', rpd: 20 },
  ],
  vision: [ // image reading (listing photos, dispute evidence) — Groq has no
            // vision-capable text model in our current lineup, so this is
            // Gemini-only.
    { provider: 'gemini', model: 'gemini-2.5-flash', rpd: 20 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  feedbackDedupe: [ // tiny yes/no classification — feedback.js's local text
                     // similarity handles almost every case on its own; this
                     // chain only gets called for the rare gray-zone pair
                     // that local scoring can't confidently call, so it's
                     // fine to put on the smallest/cheapest models.
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'groq', model: 'qwen/qwen3-32b', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  agentDealDecision: [ // seller AI agent: accept/reject/hold judgment on a
                        // pending deal — see handleAgentDealDecision below
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'groq', model: 'openai/gpt-oss-120b', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
  agentAutoReply: [ // seller AI agent: drafts a reply in a deal chat
    { provider: 'groq', model: 'openai/gpt-oss-20b', rpd: 1000 },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', rpd: 1000 },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', rpd: 20 },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// FEATURE 1 — Support chat ("Chay")
// ════════════════════════════════════════════════════════════════════════

const PLATFORM_INFO = `
You are Siterifty Support, the friendly, knowledgeable AI assistant for Siterifty — a marketplace where small developers buy and sell websites, apps, and games.

🎯 YOUR JOB:
- Welcome users by name.
- Answer any question about how the platform works in clear, step‑by‑step detail.
- Look up the CALLER'S OWN deals when asked (use get_my_deals tool).
- File a report against another user via the report_user tool only when the caller explicitly asks to report someone.
- If you cannot do something, don't just say "I can't". Explain exactly why, and suggest what the user CAN do instead.
- NEVER invent data or claim you looked up something you didn't fetch.

📚 PLATFORM DETAILS:
- Sellers list a website/app/game with a price.
- Buyers send a "deal" (offer/intro message) on a listing.
- The seller can Accept or Reject the deal.
- Accepting creates a private chat named "Deal · <first two words>…" between buyer and seller.
- That chat auto‑locks (read‑only) 7 days after acceptance. Both sides must complete handover/payment within that window.
- Users can report others for bad behaviour. If someone types "@username" while asking you to report, use the report_user tool. Do NOT ask them to report manually.

🔒 PRIVACY RULES:
- You can see only the CALLER'S own profile and deals.
- You CANNOT see other users' private info (email, deals, messages).
- If asked to reveal another user's details, politely decline and offer to help with their own account or suggest filing a report if appropriate.

🗣️ TONE:
- Be warm, concise, and helpful — like a real support person.
- Break down complex answers into numbered steps.
- Use examples when it helps.
`;

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'report_user',
      description: 'File a report against another user (by @username) and notify them. Use ONLY when the caller clearly asks to report someone. Returns the report ID if successful.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The username being reported, without the @ symbol.' },
          reason: { type: 'string', description: 'Short summary of why they are being reported.' },
        },
        required: ['username', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_deals',
      description: "Fetch the CALLER'S own deals (buyer or seller) including status, expiration, and listing title. Returns only the caller's data.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

async function resolveUsernamePublic(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  const snap = await db.collection('users').where('usernameLower', '==', clean).limit(1).get();
  if (snap.empty) {
    const snap2 = await db.collection('users').where('username', '==', clean).limit(1).get();
    if (snap2.empty) return null;
    const d = snap2.docs[0];
    return { uid: d.id, username: d.data().username || clean };
  }
  const d = snap.docs[0];
  return { uid: d.id, username: d.data().username || clean };
}

async function toolReportUser({ username, reason }, callerUid, callerName) {
  const target = await resolveUsernamePublic(username);
  if (!target) return { ok: false, message: `I couldn't find a user named @${username.replace(/^@/, '')}.` };
  if (target.uid === callerUid) return { ok: false, message: "You can't report yourself." };

  const reportRef = db.collection('reports').doc();
  const now = FieldValue.serverTimestamp();
  await reportRef.set({
    reportedUid: target.uid,
    reportedUsername: target.username,
    reporterUid: callerUid,
    reporterName: callerName || 'A user',
    reason: reason || 'No reason provided',
    status: 'open',
    source: 'ai_support',
    createdAt: now,
  });

  await db.collection('users').doc(target.uid).collection('notifications').add({
    type: 'report_filed',
    title: 'You were reported',
    body: `Someone reported your account. Our team will review it. If you believe this was a mistake, you can contact support.`,
    read: false,
    createdAt: now,
  });

  return { ok: true, message: `Filed a report against @${target.username} and notified them. Report ID: ${reportRef.id}` };
}

async function toolGetMyDeals(callerUid) {
  const snap = await db.collection('users').doc(callerUid).collection('deals')
    .orderBy('createdAt', 'desc').limit(20).get();
  const deals = snap.docs.map(d => {
    const v = d.data();
    return {
      id: d.id,
      listingTitle: v.listingTitle || 'Untitled',
      status: v.status || 'pending',
      role: v.sellerUid === callerUid ? 'seller' : 'buyer',
      expiresAt: v.expiresAt || null,
      createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : null,
    };
  });
  return { deals };
}

async function handleChat({ messages, callerUid, callerName }) {
  if (!Array.isArray(messages) || !messages.length) {
    throw httpError(400, 'messages array required');
  }

  const systemPrompt = `${PLATFORM_INFO}\n\nThe person you're talking to is logged in as "${callerName}" (uid: ${callerUid}). Greet them warmly and use the tools available to look up their own deals or file a report. If you cannot do something, explain exactly why and suggest what they CAN do.`;

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-20),
  ];

  let result = await callWithFallback(CHAINS.chat, { messages: chatMessages, tools: CHAT_TOOLS });

  let loopGuard = 0;
  while (result.tool_calls && result.tool_calls.length && loopGuard < 3) {
    loopGuard++;
    chatMessages.push(result.raw_message);

    for (const call of result.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* default {} */ }

      let toolResult;
      if (call.function.name === 'report_user') {
        toolResult = await toolReportUser(args, callerUid, callerName);
      } else if (call.function.name === 'get_my_deals') {
        toolResult = await toolGetMyDeals(callerUid);
      } else {
        toolResult = { ok: false, message: 'Unknown tool' };
      }

      chatMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
    }

    result = await callWithFallback(CHAINS.chat, { messages: chatMessages, tools: CHAT_TOOLS });
  }

  return {
    reply: result.content || "I'm not sure how to help with that — could you rephrase? I'm here to assist with your account, deals, and platform questions.",
    model: result.usedModel,
  };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE 2 — User-to-user chat scam guard
//
// Behavior (per product decision): auto-delete on HIGH-confidence scam
// signals (off-platform payment requests, phishing links, fake escrow
// impersonation, etc). On LOWER-confidence/ambiguous signals, deliver the
// message but attach a warning banner instead of deleting it.
// Every check is logged to `moderationLogs` regardless of outcome, so
// patterns and false-positives can be audited later.
// ════════════════════════════════════════════════════════════════════════

const SCAM_POLICY = `
You are a scam-detection classifier for Siterifty, a marketplace where users chat 1:1 to complete deals (buying/selling websites, apps, games) through escrow-protected transactions.

Classify the message below for SCAM RISK. Common scam patterns on this platform:
- Asking to pay or communicate "outside the platform" / "off Siterifty" to avoid fees or escrow protection.
- Sharing external payment links, wallet addresses, or "faster" payment methods that bypass escrow.
- Impersonating Siterifty staff, support, or escrow/admin.
- Urgency/pressure tactics ("deal expires in 5 minutes, pay now via this link").
- Requesting sensitive credentials (passwords, 2FA codes, hosting/domain logins) outside the normal secure handover flow.
- Fake "buyer already paid, just send the code first" pressure before funds actually clear.

Respond ONLY with strict JSON, no markdown, no commentary:
{"risk": "high" | "low" | "none", "reason": "<one short sentence>"}

"high" = confident this is a scam attempt, message should be blocked.
"low" = suspicious pattern but not conclusive, message should be delivered with a warning.
"none" = normal deal conversation, no concern.
`;

async function classifyScamRisk(text) {
  // First pass: cheap injection/jailbreak-style classifier as a quick filter.
  // (Prompt Guard scores adversarial-prompt patterns; we treat a high score
  // here only as a signal to weight the judge step more heavily, not as a
  // verdict on its own — it isn't trained on marketplace scam language.)
  let guardFlag = false;
  try {
    const guardRes = await callWithFallback(CHAINS.scamGuardClassifier, {
      messages: [{ role: 'user', content: text }],
      max_tokens: 20,
    });
    guardFlag = /malicious|injection|jailbreak/i.test(guardRes.content || '');
  } catch (err) {
    console.error('[aistudio] prompt-guard pass failed, continuing to judge step:', err.message);
  }

  const judgeRes = await callWithFallback(CHAINS.scamGuardJudge, {
    messages: [
      { role: 'system', content: SCAM_POLICY },
      { role: 'user', content: `Message to classify:\n"""${text}"""${guardFlag ? '\n\n(Note: an upstream filter flagged this text as containing adversarial/manipulative patterns — weigh that in your judgment.)' : ''}` },
    ],
    temperature: 0.1,
    max_tokens: 150,
  });

  let parsed;
  try {
    const cleaned = (judgeRes.content || '').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { risk: 'low', reason: 'Could not parse classifier output — defaulting to warn.' };
  }
  return { ...parsed, model: judgeRes.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// SCAM GUARD ESCALATION — YouTube-style strike system
//
// Policy (product decision):
//   • 3 'warned' verdicts within a rolling 24h window  → 1 strike
//   • 2 'blocked' verdicts within a rolling 24h window → 1 strike (harsher,
//     since a block is already a higher-confidence signal than a warn)
//   • Strike 1                                          → 1 hour suspension
//   • Strike 2, if within 48h of the oldest active strike → 5 hour suspension
//   • Strike 3, if within 72h of the oldest active strike → PERMANENT BAN
//   • Strikes older than 72h (measured from the oldest strike still in the
//     window) expire and drop off the list — this demotes the severity of
//     whatever strike comes next rather than keeping someone banned forever
//     for one bad week. There is no ban-equivalent "4th strike"; ban is the
//     ceiling for scam-guard violations — accounts are never banned outright
//     by this system without passing through the suspension ladder first.
//
// All of this lives on users/{uid}.moderation, written in the SAME schema
// maintenance-banned.js already reads (banned/banReason/suspended/
// suspendedUntil/suspendReason) so the existing full-screen account-status
// overlay picks this up with zero front-end changes.
// ════════════════════════════════════════════════════════════════════════

const SCAM_WARN_WINDOW_MS    = 24 * 60 * 60 * 1000; // 3 warns within this window = 1 strike
const SCAM_WARN_THRESHOLD    = 3;
const SCAM_BLOCK_WINDOW_MS   = 24 * 60 * 60 * 1000; // 2 blocks within this window = 1 strike
const SCAM_BLOCK_THRESHOLD   = 2;
const SCAM_STRIKE2_WINDOW_MS = 48 * 60 * 60 * 1000; // strike 2 must land within this of strike 1 to count as strike 2
const SCAM_STRIKE3_WINDOW_MS = 72 * 60 * 60 * 1000; // strike 3 must land within this of the oldest strike to trigger a ban

const SCAM_SUSPEND_MS_BY_STRIKE = {
  1: 60 * 60 * 1000,       // strike 1 → 1 hour
  2: 5 * 60 * 60 * 1000,   // strike 2 → 5 hours
};

// Drop any timestamps older than `windowMs` relative to `now`, keeping the
// array sorted ascending (oldest first) — used for both the warn/block
// event lists and the strikes list itself.
function _scamPruneOld(timestamps, windowMs, now) {
  return (timestamps || []).filter(ts => now - ts <= windowMs).sort((a, b) => a - b);
}

// Given the user's current moderation state and a new event ('warned' or
// 'blocked') just recorded at `now`, returns the updated moderation object
// plus any account-status change that should be applied (suspend/ban), or
// null if no threshold was crossed.
function _scamApplyEscalation(moderation, eventType, now) {
  const mod = {
    warnEvents:  _scamPruneOld(moderation?.warnEvents,  SCAM_WARN_WINDOW_MS,  now),
    blockEvents: _scamPruneOld(moderation?.blockEvents, SCAM_BLOCK_WINDOW_MS, now),
    strikes:     _scamPruneOld(moderation?.strikes,     SCAM_STRIKE3_WINDOW_MS, now),
  };

  if (eventType === 'warned') mod.warnEvents.push(now);
  else if (eventType === 'blocked') mod.blockEvents.push(now);

  let newStrike = false;
  if (eventType === 'warned' && mod.warnEvents.length >= SCAM_WARN_THRESHOLD) {
    mod.warnEvents = []; // consumed into a strike
    newStrike = true;
  } else if (eventType === 'blocked' && mod.blockEvents.length >= SCAM_BLOCK_THRESHOLD) {
    mod.blockEvents = []; // consumed into a strike
    newStrike = true;
  }

  let statusChange = null;
  if (newStrike) {
    mod.strikes.push(now);
    // Re-prune: the strike we just pushed may make an old one fall outside
    // the 72h window relative to itself — but the correct reference point
    // is the OLDEST strike still being counted, so prune once more here
    // using that oldest timestamp rather than `now`.
    const oldest = mod.strikes[0];
    mod.strikes = mod.strikes.filter(ts => ts - oldest <= SCAM_STRIKE3_WINDOW_MS);

    const strikeNumber = mod.strikes.length; // 1, 2, or 3 (post-prune, post-push)

    if (strikeNumber >= 3) {
      // Third strike within the 72h window from the oldest strike → permanent ban.
      statusChange = { type: 'ban', reason: '3 scam-guard strikes within 72 hours.' };
      mod.strikes = []; // banned — no further strikes need tracking
    } else if (strikeNumber === 2) {
      // Strike 2 only counts as strike 2 if it's within 48h of strike 1
      // (mod.strikes[0] is strike 1's timestamp at this point).
      const withinEscalationWindow = (now - mod.strikes[0]) <= SCAM_STRIKE2_WINDOW_MS;
      if (withinEscalationWindow) {
        statusChange = { type: 'suspend', ms: SCAM_SUSPEND_MS_BY_STRIKE[2], reason: '2nd scam-guard strike within 48 hours.' };
      } else {
        // Strike 1 aged out of relevance for escalation purposes — treat
        // this as a fresh strike 1 instead of a harsher strike 2.
        mod.strikes = [now];
        statusChange = { type: 'suspend', ms: SCAM_SUSPEND_MS_BY_STRIKE[1], reason: '1st scam-guard strike.' };
      }
    } else {
      // strikeNumber === 1
      statusChange = { type: 'suspend', ms: SCAM_SUSPEND_MS_BY_STRIKE[1], reason: '1st scam-guard strike.' };
    }
  }

  return { moderation: mod, statusChange };
}

// Applies a scam-guard verdict's consequence (if any) to users/{uid} inside
// a transaction, so concurrent messages from the same user can't race each
// other's strike math. Writes suspended/suspendedUntil/suspendReason or
// banned/banReason using the exact field names maintenance-banned.js reads.
async function applyScamGuardEscalation(uid, action) {
  if (action !== 'warned' && action !== 'blocked') return null; // 'allowed' never escalates
  if (!uid) return null;

  const now = Date.now();
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    const { moderation, statusChange } = _scamApplyEscalation(data.moderation, action, now);

    const update = { moderation };

    if (statusChange?.type === 'ban') {
      update.banned = true;
      update.banReason = statusChange.reason;
      // A ban supersedes any active suspension — clear it so the overlay
      // shows the (permanent) ban state, not a suspension countdown.
      update.suspended = false;
      update.suspendedUntil = null;
    } else if (statusChange?.type === 'suspend') {
      update.suspended = true;
      update.suspendedUntil = new Date(now + statusChange.ms);
      update.suspendReason = statusChange.reason;
    }

    tx.set(userRef, update, { merge: true });
    return statusChange; // null if this event didn't cross a strike threshold
  });
}

async function handleScamCheck({ text, callerUid, chatId }) {
  if (!text || typeof text !== 'string') throw httpError(400, 'text required');

  const verdict = await classifyScamRisk(text);
  const action = verdict.risk === 'high' ? 'blocked' : verdict.risk === 'low' ? 'warned' : 'allowed';

  await db.collection('moderationLogs').add({
    type: 'scam_guard',
    chatId: chatId || null,
    userId: callerUid,
    textSample: text.slice(0, 500),
    risk: verdict.risk,
    reason: verdict.reason,
    action,
    model: verdict.model,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Feed this verdict into the strike/escalation ladder. Returns null if no
  // strike threshold was crossed this time, or the resulting suspend/ban
  // decision if one was — surfaced below so the client can react instantly
  // (e.g. force the account-status overlay) instead of waiting for the next
  // auth-state refresh to notice suspended/banned flipped true.
  let statusChange = null;
  try {
    statusChange = await applyScamGuardEscalation(callerUid, action);
  } catch (err) {
    console.error('[aistudio] scam-guard escalation failed:', err.message);
    // Fail open — a broken escalation write should never block the
    // underlying blocked/warned/allowed message decision above.
  }

  return {
    action,               // 'blocked' | 'warned' | 'allowed'
    risk: verdict.risk,
    reason: verdict.reason,
    warningText: action === 'warned'
      ? `⚠️ Heads up — this message has patterns common in scams (${verdict.reason}). Never pay or share credentials outside Siterifty's escrow flow.`
      : null,
    accountStatusChange: statusChange, // null | { type: 'suspend', ms, reason } | { type: 'ban', reason }
  };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE 3 — Listing auto-description generator
//
// Plan-based char limits (minimum the USER can request; user still picks
// within their plan's ceiling):
//   Free: up to 100   Start: up to 500   Growth: up to 1500   Pro: up to 5000
// The user supplies the listing TITLE + desired length; AI writes the
// description scoped to that length.
// ════════════════════════════════════════════════════════════════════════

const PLAN_LIMITS = { free: 100, start: 500, growth: 1500, pro: 5000 };

const DESCRIPTION_SYSTEM = `
You are a marketplace listing copywriter for Siterifty (buy/sell websites, apps, games).
Given a listing TITLE and a target length, write a compelling, honest, specific product description.
Rules:
- Do not invent fake stats, revenue figures, user counts, or technical claims not implied by the title.
- Write in an active, confident tone aimed at a buyer evaluating a small digital asset.
- Stay as close as possible to the requested character count without going over it.
- No markdown, no headers, no emoji spam — plain prose paragraphs suitable for a listing page.
- Do not include placeholder text like "[insert detail]" — write naturally around missing specifics instead.
`;

async function handleAutoDescription({ title, targetLength, plan, callerUid }) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw httpError(400, 'title is required so the AI knows what it is describing');
  }
  const cap = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const requested = Math.max(20, Math.min(Number(targetLength) || cap, cap));

  const result = await callWithFallback(CHAINS.autoDescription, {
    messages: [
      { role: 'system', content: DESCRIPTION_SYSTEM },
      { role: 'user', content: `Listing title: "${title.trim()}"\nTarget length: approximately ${requested} characters (plan cap: ${cap}).\nWrite the description now.` },
    ],
    temperature: 0.6,
    max_tokens: Math.ceil(requested / 3) + 100, // rough token headroom for char budget
  }, { requireContent: true });

  let description = (result.content || '').trim();
  if (!description) {
    // Should be unreachable now that callWithFallback enforces requireContent,
    // but keep this as a hard backstop so the client never silently gets an
    // empty description with a 200 OK — it always either gets real text or a
    // thrown error the UI can show.
    throw new Error('AI returned an empty description — please try again.');
  }
  if (description.length > cap) description = description.slice(0, cap).replace(/\s+\S*$/, '') + '…';

  return { description, charCount: description.length, cap, model: result.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE 4 — Send-deal message assist
// Helps a buyer/seller write their deal intro/offer message.
// ════════════════════════════════════════════════════════════════════════

const DEAL_MESSAGE_SYSTEM = `
You help a user write a short, effective message when sending a "deal" (an offer/intro) on a Siterifty listing.
Write ONE message option (2-5 sentences) that is:
- Polite, direct, and specific to the listing context given.
- States genuine interest and, if a price/offer was given, references it naturally.
- Does not invent details about the listing that weren't provided.
- Does not pressure, guarantee, or make claims about payment happening outside the platform's escrow flow.
Return ONLY the message text — no preamble, no quotes around it.
`;

async function handleDealMessageAssist({ listingTitle, listingSummary, offerAmount, userDraft, callerUid }) {
  const context = [
    listingTitle ? `Listing: "${listingTitle}"` : null,
    listingSummary ? `Listing summary: ${listingSummary}` : null,
    offerAmount ? `Offer amount: ${offerAmount}` : null,
    userDraft ? `User's rough draft to improve: "${userDraft}"` : 'User has not written a draft yet — write one from scratch.',
  ].filter(Boolean).join('\n');

  const result = await callWithFallback(CHAINS.dealMessageAssist, {
    messages: [
      { role: 'system', content: DEAL_MESSAGE_SYSTEM },
      { role: 'user', content: context },
    ],
    temperature: 0.6,
    max_tokens: 300,
  });

  return { message: (result.content || '').trim(), model: result.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE 5 — Reports/disputes support-assist triage
//
// Per product decision: the AI does NOT move money, ban users, or change
// dispute/report status on its own — a marketplace refund/ban is too
// consequential to hand to an LLM's judgment call unsupervised, especially
// since verifying "who's actually at fault" often requires checking whether
// delivered code/product genuinely works, which text analysis can't confirm.
// Instead, the AI reads the last 10 TEXT messages of the deal chat (image/
// file messages are skipped from its input — token budget — but counted so
// the agent knows more evidence exists) and writes a severity flag + plain-
// English summary + suggested next step onto the report/dispute doc. A
// human on the support team still makes and executes the actual call.
// ════════════════════════════════════════════════════════════════════════

// SUPPORT-ASSIST TRIAGE — this does NOT move money, ban users, or change
// dispute/report status. It reads the last 10 TEXT messages of the deal
// chat (skipping images/files — just noting they exist) plus the filed
// reason, and writes a support-facing summary: severity flag + a plain-
// English recap + a suggested next step. A human on the support team reads
// this and decides/executes the actual action. This keeps the AI's job to
// what it can reliably do (summarize a conversation) rather than what it
// can't safely verify alone (whether delivered code/product actually works,
// or who's "at fault" in a way that should move real money automatically).
const TRIAGE_SYSTEM = `
You are a support-assist triage tool for Siterifty, an escrow-based marketplace. You are NOT deciding the outcome — a human support agent will read your summary and decide. Your job is to make their job fast.

You'll be given: the dispute/report reason, and the last up to 10 text messages exchanged between the buyer and seller in their deal chat (if available).

Respond ONLY with strict JSON, no markdown:
{
  "severity": "low" | "medium" | "high",
  "summary": "<3-5 sentence plain-English recap of what happened, from the chat evidence, written for a support agent who hasn't read the chat yet>",
  "suggestedAction": "<one short sentence: what a reasonable next step looks like, e.g. 'Ask seller for delivery proof' or 'Likely straightforward refund — buyer never received access'>",
  "flags": ["<short tag>", ...]
}

Guidance:
- "high" severity = large sums, clear-cut bad behavior (ghosting, credential theft, abusive language), or urgent buyer/seller safety concern.
- "low" severity = minor miscommunication, first-time/small dispute, or insufficient info to tell.
- flags examples: "no_delivery", "seller_unresponsive", "buyer_pressuring", "credential_request_offplatform", "possible_scam_language", "insufficient_evidence".
- Do NOT recommend refunding or releasing funds as a final decision — only as a suggestion for the agent to verify. Do NOT claim to know whether delivered code/product actually works — you cannot verify that from chat text alone.
- Be honest if the chat evidence is too thin to say anything useful — a short accurate "not enough information" is better than a confident guess.
`;

// Fetch the last N TEXT-only messages from a deal chat, oldest-first, for
// the AI to read. Images/files are skipped from the model input (it can't
// see them) but we note how many existed so the agent knows evidence exists.
async function getRecentChatTextMessages(chatRoomId, limit = 10) {
  if (!chatRoomId) return { messages: [], nonTextCount: 0 };
  try {
    const snap = await db.collection('dealChats').doc(chatRoomId).collection('messages')
      .orderBy('createdAt', 'desc').limit(40).get(); // pull a bit extra so we can filter to text-only and still get `limit`
    let nonTextCount = 0;
    const textMsgs = [];
    for (const d of snap.docs) {
      const v = d.data();
      if (v.type && v.type !== 'text') { nonTextCount++; continue; }
      if (!v.text) continue;
      textMsgs.push({ uid: v.uid, text: String(v.text).slice(0, 600), createdAt: v.createdAt || null });
      if (textMsgs.length >= limit) break;
    }
    return { messages: textMsgs.reverse(), nonTextCount }; // oldest-first for the model
  } catch (err) {
    console.error('[aistudio] failed to read chat history for triage:', err.message);
    return { messages: [], nonTextCount: 0 };
  }
}

async function handleTriage({ kind, reportId, disputeId, evidence, callerUid }) {
  const docId = reportId || disputeId;
  if (!docId || !evidence) throw httpError(400, 'reportId/disputeId and evidence are required');

  const collection = kind === 'dispute' ? 'disputes' : 'reports';

  const { messages: chatMessages, nonTextCount } = await getRecentChatTextMessages(evidence.chatRoomId, 10);
  const transcript = chatMessages.length
    ? chatMessages.map(m => `[${m.uid === evidence.sellerUid ? 'seller' : m.uid === evidence.buyerUid ? 'buyer' : m.uid}]: ${m.text}`).join('\n')
    : '(no text messages available)';

  const result = await callWithFallback(CHAINS.reportsTriage, {
    messages: [
      { role: 'system', content: TRIAGE_SYSTEM },
      { role: 'user', content: `Case type: ${kind}\nFiled reason/evidence:\n${JSON.stringify(evidence, null, 2)}\n\nLast ${chatMessages.length} text messages in the deal chat (oldest first)${nonTextCount ? ` — plus ${nonTextCount} non-text message(s) (image/file) not shown here` : ''}:\n${transcript}` },
    ],
    temperature: 0.2,
    max_tokens: 400,
  });

  let analysis;
  try {
    analysis = JSON.parse((result.content || '').replace(/```json|```/g, '').trim());
  } catch {
    analysis = { severity: 'medium', summary: 'Could not parse AI output — please review manually.', suggestedAction: 'Manual review needed.', flags: ['ai_parse_error'] };
  }

  // Support-facing fields only — status is deliberately left untouched so a
  // human on the team still opens and resolves this the normal way. No money
  // moves, no bans, nothing auto-applied.
  await db.collection(collection).doc(docId).set({
    aiSeverity: analysis.severity || 'medium',
    aiSummary: analysis.summary || '',
    aiSuggestedAction: analysis.suggestedAction || '',
    aiFlags: Array.isArray(analysis.flags) ? analysis.flags : [],
    aiModel: result.usedModel,
    aiTriagedAt: FieldValue.serverTimestamp(),
    aiChatMessagesSeen: chatMessages.length,
    aiNonTextMessagesSkipped: nonTextCount,
  }, { merge: true });

  return {
    severity: analysis.severity,
    summary: analysis.summary,
    suggestedAction: analysis.suggestedAction,
    flags: analysis.flags,
    model: result.usedModel,
  };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE 6 (bonus) — Image reading
// For listing screenshots or dispute evidence photos. Gemini-only (vision).
// ════════════════════════════════════════════════════════════════════════

async function handleImageRead({ imageBase64, mimeType, question }) {
  if (!imageBase64) throw httpError(400, 'imageBase64 required');
  const result = await callWithFallback(CHAINS.vision, {
    messages: [
      { role: 'system', content: 'You read images uploaded to a marketplace (listing screenshots or dispute evidence). Describe factually what you see. Do not speculate about intent beyond what is visibly shown.' },
      { role: 'user', content: question || 'Describe what is shown in this image, factually and concisely.' },
    ],
    imageParts: [{ inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } }],
    max_tokens: 500,
  });
  return { description: result.content, model: result.usedModel };
}

// ── Reported-content image check ──
// Deliberately scoped tight: ONE image, only for content that a human has
// already flagged (a reported listing, or dispute evidence) — never run
// across every image on every new listing. Vision (Gemini) daily quotas here
// are ~20 requests/day per model in the fallback chain, so this only stays
// usable if call volume matches "occasional reported item," not "every
// upload." Callers must pass a single imageUrl; this function does not
// accept or loop over an array, by design.
async function handleAnalyzeReportedImage({ imageUrl, context, reportId, disputeId }) {
  if (!imageUrl || typeof imageUrl !== 'string') throw httpError(400, 'imageUrl (single URL) is required');

  let imageBase64, mimeType;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
    mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    imageBase64 = buf.toString('base64');
  } catch (err) {
    throw httpError(502, `Could not fetch image for analysis: ${err.message}`);
  }

  const result = await callWithFallback(CHAINS.vision, {
    messages: [
      { role: 'system', content: `You review a single image from a marketplace listing that has been reported or is part of a dispute. Judge ONLY appropriateness/policy concerns — not whether the underlying product is good. Respond ONLY with strict JSON, no markdown:
{"appropriate": true|false, "concerns": ["<short tag>", ...], "summary": "<1-2 sentence factual description>"}
Concern tags to use when relevant: "explicit_content", "violence", "misleading_stock_photo", "unrelated_to_listing", "contains_personal_info", "copyright_watermark_mismatch", "none".
Be factual — do not guess intent beyond what's visibly in the image.` },
      { role: 'user', content: context ? `Context: ${context}\n\nReview this image.` : 'Review this image.' },
    ],
    imageParts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }],
    max_tokens: 300,
  });

  let analysis;
  try {
    analysis = JSON.parse((result.content || '').replace(/```json|```/g, '').trim());
  } catch {
    analysis = { appropriate: null, concerns: ['ai_parse_error'], summary: 'Could not parse AI output — please review manually.' };
  }

  // Write the verdict back onto whichever doc this check was triggered for,
  // same pattern as handleTriage — support-facing only, no auto-action.
  const docId = reportId || disputeId;
  if (docId) {
    const collection = disputeId ? 'disputes' : 'reports';
    await db.collection(collection).doc(docId).set({
      aiImageAppropriate: analysis.appropriate,
      aiImageConcerns: Array.isArray(analysis.concerns) ? analysis.concerns : [],
      aiImageSummary: analysis.summary || '',
      aiImageModel: result.usedModel,
      aiImageCheckedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(err => console.error('[aistudio] failed to write image verdict:', err.message));
  }

  return { ...analysis, model: result.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE — Feedback suggestion dedupe tiebreaker
//
// feedback.js does all duplicate-detection with free local text similarity
// (token overlap + character trigrams) and only calls this when two
// suggestions score in a genuine gray zone — not obviously the same idea,
// not obviously different. This keeps the call rare and the prompt trivial:
// a single yes/no judgment on two short strings.
// ════════════════════════════════════════════════════════════════════════

const FEEDBACK_DEDUPE_SYSTEM = `
You compare two short user-submitted feature/change suggestions for a marketplace app and judge whether they are asking for the SAME underlying change, even if worded differently.

Respond ONLY with strict JSON, no markdown:
{"sameRequest": true|false, "reason": "<one short sentence>"}

Treat them as the SAME request if a developer would reasonably build one fix/feature that satisfies both. Treat them as DIFFERENT if they target different parts of the product, or one is clearly broader/narrower in a way that isn't just phrasing.
`;

async function handleFeedbackDedupe({ textA, textB }) {
  if (!textA || !textB) throw httpError(400, 'textA and textB are required');

  const result = await callWithFallback(CHAINS.feedbackDedupe, {
    messages: [
      { role: 'system', content: FEEDBACK_DEDUPE_SYSTEM },
      { role: 'user', content: `Suggestion A: "${textA}"\nSuggestion B: "${textB}"` },
    ],
    temperature: 0.1,
    max_tokens: 60,
  });

  let parsed;
  try {
    const cleaned = (result.content || '').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { sameRequest: false, reason: 'Could not parse classifier output — defaulting to distinct.' };
  }
  return { sameRequest: !!parsed.sameRequest, reason: parsed.reason || '', model: result.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE — "Recommended for you" listings panel (formerly /api/aisearch.js)
//
// Zero-input personalized recommender, NOT a text query box — plain
// keyword/type search still lives in the regular search bar. No text-model
// call here at all; ranking is a plain in-memory score over Firestore
// listings, so it's folded in here purely to stay under the hobby-plan
// serverless function count, not because it shares any model/provider code
// with the rest of aistudio.js.
//
// Ranking signals combined into one score per listing:
//   - recency:  freshness boost that decays over ~14 days
//   - saves:    log-scaled popularity (so one viral listing can't dominate
//               every ranking)
//   - boost:    sellers with an active `boostedUntil` get a flat multiplier
//   - affinity: if the caller is signed in, bonus for listing types/
//               categories matching their users/{uid}/savedListings.
//               Signed-out callers just get the non-personalized ranking.
//
// Results are then diversified (round-robin across types) so the first
// page doesn't clump same-type listings together.
//
// Base (non-personalized) scores are cached for BASE_CACHE_MS so repeated
// opens don't re-scan Firestore every time; affinity is cheap and always
// computed fresh per request since it depends on the caller.
// ════════════════════════════════════════════════════════════════════════

const RECS_RESULT_LIMIT = 24;
const RECS_BASE_CACHE_MS = 60 * 1000;
const RECS_RECENCY_HALFLIFE_DAYS = 14;
const RECS_BOOST_MULTIPLIER = 1.6;
const RECS_AFFINITY_BONUS = 0.9;

function recsToMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}
function recsIsBoostedNow(listing) {
  return recsToMillis(listing.boostedUntil) > Date.now();
}
function recsRecencyScore(listing) {
  const createdMs = recsToMillis(listing.createdAt);
  if (!createdMs) return 0;
  const ageDays = Math.max(0, (Date.now() - createdMs) / 86400000);
  return Math.pow(0.5, ageDays / RECS_RECENCY_HALFLIFE_DAYS);
}
function recsSavesScore(listing) {
  const saves = typeof listing.saves === 'number' ? listing.saves : 0;
  return Math.log10(saves + 1);
}
function recsListingCategory(v) {
  return v.category || v.tech?.frontend || v.tech?.backend || '';
}
function recsToLite(id, v) {
  return {
    id,
    title: v.title || 'Untitled',
    type: v.type || 'website',
    price: typeof v.financials?.price === 'number' ? v.financials.price : null,
    saves: typeof v.saves === 'number' ? v.saves : 0,
    boosted: recsIsBoostedNow(v),
  };
}

let _recsBaseCache = null; // { at, scored: [{id, v, base}] }

async function recsGetBaseScored() {
  if (_recsBaseCache && Date.now() - _recsBaseCache.at < RECS_BASE_CACHE_MS) {
    return _recsBaseCache.scored;
  }
  const snap = await db.collection('listings').where('status', '==', 'active').get();
  const scored = snap.docs.map(d => {
    const v = d.data();
    const base = recsRecencyScore(v) + recsSavesScore(v) * (recsIsBoostedNow(v) ? RECS_BOOST_MULTIPLIER : 1);
    return { id: d.id, v, base };
  });
  _recsBaseCache = { at: Date.now(), scored };
  return scored;
}

async function recsGetUserAffinity(uid) {
  const types = new Map();
  const categories = new Map();
  try {
    const snap = await db.collection('users').doc(uid).collection('savedListings').get();
    snap.forEach(d => {
      const v = d.data();
      if (v.type) types.set(v.type, (types.get(v.type) || 0) + 1);
      if (v.category) categories.set(v.category, (categories.get(v.category) || 0) + 1);
    });
  } catch (err) {
    console.error('[aistudio] recommendations affinity lookup failed', err.message);
  }
  return { types, categories };
}

function recsDiversify(scoredSorted, limit) {
  const byType = new Map();
  for (const item of scoredSorted) {
    const t = item.v.type || 'website';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(item);
  }
  const buckets = [...byType.values()];
  const out = [];
  let i = 0;
  while (out.length < limit && buckets.some(b => i < b.length)) {
    for (const bucket of buckets) {
      if (i < bucket.length) out.push(bucket[i]);
      if (out.length >= limit) break;
    }
    i++;
  }
  return out;
}

// callerUid may be null here (signed-out callers still get non-personalized
// recommendations) — this is the one action in this file where auth is
// optional rather than required; see OPTIONAL_AUTH_ACTIONS in the handler.
async function handleRecommendations({ callerUid }) {
  const baseScored = await recsGetBaseScored();

  if (!baseScored.length) {
    return {
      mode: 'recommendations',
      reply: "No active listings yet — check back soon.",
      listingIds: [],
      listings: [],
      personalized: false,
    };
  }

  let affinity = null;
  if (callerUid) affinity = await recsGetUserAffinity(callerUid);

  const scored = baseScored.map(item => {
    let score = item.base;
    if (affinity) {
      const t = item.v.type;
      const c = recsListingCategory(item.v);
      if (t && affinity.types.has(t)) score += RECS_AFFINITY_BONUS;
      if (c && affinity.categories.has(c)) score += RECS_AFFINITY_BONUS;
    }
    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = recsDiversify(scored, RECS_RESULT_LIMIT);
  const listings = picked.map(item => recsToLite(item.id, item.v));
  const personalized = !!(affinity && (affinity.types.size || affinity.categories.size));

  return {
    mode: 'recommendations',
    reply: personalized
      ? 'Recommended for you, based on what you\u2019ve saved.'
      : 'Recommended listings for you right now.',
    listingIds: listings.map(l => l.id),
    listings,
    personalized,
  };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE — In-app feedback suggestion board (formerly /api/feedback.js)
//
// Folded in here for the same hobby-plan function-count reason as
// recommendations above — this one DOES touch the feedback-dedupe AI
// tiebreaker, but since it now lives in the same process/file, that call
// is a direct function call below, not an HTTP round-trip to itself.
//
// What this does:
//   1. Users submit short feature/change suggestions.
//   2. Before saving, compare the new text against existing OPEN
//      suggestions using cheap local text-similarity (no external API
//      call, no cost, no embeddings). Clear duplicates bump the existing
//      suggestion's voteCount instead of creating a new row.
//   3. Only a genuine gray-zone pair (not obviously same, not obviously
//      different) calls handleFeedbackDedupe() as a tiebreaker — rare, so
//      it stays cheap.
//   4. Popular suggestions bubble to the top for the team via
//      'list-for-review' (admin-only).
//
// Firestore collections:
//
// "feedbackSuggestions" (the live, weekly-reset board)
//   { textNormalized, textOriginal, votes: { [uid]: score }, voteCount
//     (= number of voters), totalScore (= sum of votes), status:
//     'open'|'planned'|'done'|'declined', createdAt, updatedAt,
//     lastVotedAt, submittedByUid, aiMatchedCount }
//
//   Voting scale (each voter can cast ONE vote per suggestion, changeable):
//     3  = "Fantastic idea"
//     2  = "Nice idea"
//     1  = "Average"
//    -1  = "Bad idea"
//   totalScore is just the sum of every cast vote. Suggestions are ranked
//   by totalScore, highest first.
//
// "feedbackArchive" ("What We're Working On" — permanent, never deleted)
//   { textOriginal, totalScore, voteCount, cycleEndedAt, archivedAt }
//   Written to (never overwritten) every time a 7-day cycle ends — the
//   week's top 3 open suggestions get appended here, so this list only
//   ever grows, +3 per week, regardless of how large the live board gets.
//
// "feedbackCycle/current" (single doc — the 7-day cycle clock)
//   { cycleStart: Timestamp }
//   cycleStart is set the first time anyone hits the board (effectively
//   "when this feature goes live"), and again every time a cycle resets.
//   The countdown shown to users is always cycleStart + 7 days.
// ════════════════════════════════════════════════════════════════════════

const FB_CYCLE_DAYS = 7;
const FB_CYCLE_MS = FB_CYCLE_DAYS * 24 * 60 * 60 * 1000;
const FB_TOP_N = 3;

const FB_VOTE_SCORES = { fantastic: 3, nice: 2, average: 1, bad: -1 };

function fbSumVotes(votesMap) {
  return Object.values(votesMap || {}).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}

function fbVoteBreakdown(votesMap) {
  const out = { fantastic: 0, nice: 0, average: 0, bad: 0 };
  for (const v of Object.values(votesMap || {})) {
    if (v === 3) out.fantastic++;
    else if (v === 2) out.nice++;
    else if (v === 1) out.average++;
    else if (v === -1) out.bad++;
  }
  return out;
}

// Ensures the cycle-clock doc exists, and returns its cycleStart (ms).
// Does NOT perform the reset itself — see fbMaybeRunReset() for that.
async function fbGetOrInitCycleStart() {
  const ref = db.collection('feedbackCycle').doc('current');
  const snap = await ref.get();
  if (snap.exists && snap.data().cycleStart) {
    return { ref, startMs: snap.data().cycleStart.toMillis() };
  }
  const now = FieldValue.serverTimestamp();
  await ref.set({ cycleStart: now }, { merge: true });
  const fresh = await ref.get();
  return { ref, startMs: fresh.data().cycleStart.toMillis() };
}

// Client-triggered reset check: called whenever someone opens the feedback
// board. If the 7-day window has elapsed, this:
//   1. Grabs the current top 3 OPEN suggestions by totalScore.
//   2. Appends them to feedbackArchive (permanent — "What We're Working On").
//   3. Deletes every remaining feedbackSuggestions doc (all of them, not
//      just non-top-3 — the whole board resets empty).
//   4. Restarts the cycle clock from now.
// Because this only fires when a real visit happens after expiry, a reset
// can run late (no one to trigger it exactly on time) but never early, and
// never runs twice for the same cycle (the cycle clock is what's checked,
// not a fixed schedule).
async function fbMaybeRunReset() {
  const { ref: cycleRef, startMs } = await fbGetOrInitCycleStart();
  const now = Date.now();
  const msRemaining = (startMs + FB_CYCLE_MS) - now;
  if (msRemaining > 0) {
    return { ranReset: false, cycleStart: startMs, msRemaining };
  }

  // Expired — run the reset.
  const openSnap = await db.collection('feedbackSuggestions')
    .where('status', '==', 'open')
    .get();

  const scored = openSnap.docs
    .map(d => {
      const data = d.data();
      return { id: d.id, data, totalScore: typeof data.totalScore === 'number' ? data.totalScore : fbSumVotes(data.votes) };
    })
    .sort((a, b) => b.totalScore - a.totalScore);

  const top3 = scored.slice(0, FB_TOP_N);

  const batch = db.batch();
  const archivedAt = FieldValue.serverTimestamp();
  for (const item of top3) {
    const archiveRef = db.collection('feedbackArchive').doc();
    batch.set(archiveRef, {
      textOriginal: item.data.textOriginal,
      totalScore: item.totalScore,
      voteCount: Object.keys(item.data.votes || {}).length,
      cycleEndedAt: archivedAt,
      archivedAt,
    });
  }
  // Delete ALL suggestions (including the top 3 just archived, and every
  // non-top-3 one) — the live board always comes back empty.
  for (const doc of openSnap.docs) {
    batch.delete(doc.ref);
  }
  // Also sweep any non-open (planned/done/declined) leftovers so the board
  // fully clears each cycle rather than accumulating old triaged rows.
  const nonOpenSnap = await db.collection('feedbackSuggestions')
    .where('status', '!=', 'open')
    .get();
  for (const doc of nonOpenSnap.docs) {
    batch.delete(doc.ref);
  }

  batch.set(cycleRef, { cycleStart: archivedAt }, { merge: true });
  await batch.commit();

  const freshCycle = await cycleRef.get();
  const newStartMs = freshCycle.data().cycleStart.toMillis();
  return { ranReset: true, archivedCount: top3.length, cycleStart: newStartMs, msRemaining: FB_CYCLE_MS };
}
// ════════════════════════════════════════════════════════════════════════

const FB_STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','to','of','in',
  'on','for','and','or','but','it','this','that','these','those','with',
  'as','at','by','from','so','if','than','then','there','their','they',
  'i','we','you','my','our','your','me','us','can','could','would','should',
  'will','shall','do','does','did','please','pls','plz','add','make','want',
  'wish','need','like','also','just','really','very','some','more','app',
  'feature','option','ability','allow','let','have','has','get','when',
]);

function fbNormalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function fbTokenSet(normText) {
  return new Set(normText.split(' ').filter(w => w.length > 1 && !FB_STOPWORDS.has(w)));
}
function fbJaccard(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
function fbTrigrams(normText) {
  const s = `  ${normText.replace(/\s+/g, ' ')} `;
  const grams = new Set();
  for (let i = 0; i < s.length - 2; i++) grams.add(s.slice(i, i + 3));
  return grams;
}
function fbSimilarity(textA, textB) {
  const normA = fbNormalize(textA);
  const normB = fbNormalize(textB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const jac = fbJaccard(fbTokenSet(normA), fbTokenSet(normB));
  const tri = fbJaccard(fbTrigrams(normA), fbTrigrams(normB));
  return Math.max(jac, tri);
}

const FB_DUPLICATE_THRESHOLD = 0.62;
const FB_GRAY_ZONE_MIN = 0.38;

// Find the best existing match for newText among open suggestions.
async function fbFindBestMatch(newText) {
  // where('status', '==', 'open') + orderBy('updatedAt', 'desc') requires a
  // composite index (same situation as fbGetTopOpen below). Fall back to an
  // in-memory filter/sort if that index hasn't been created/deployed yet,
  // so this never hard-fails the request.
  let snap;
  try {
    snap = await db.collection('feedbackSuggestions')
      .where('status', '==', 'open')
      .orderBy('updatedAt', 'desc')
      .limit(300) // recent/active window — keeps this cheap as the board grows
      .get();
  } catch (err) {
    if (err.message?.includes('requires an index') || err.message?.includes('FAILED_PRECONDITION')) {
      const allSnap = await db.collection('feedbackSuggestions').get();
      const docs = allSnap.docs
        .filter(d => d.data().status === 'open')
        .sort((a, b) => {
          const at = a.data().updatedAt?.toMillis?.() ?? 0;
          const bt = b.data().updatedAt?.toMillis?.() ?? 0;
          return bt - at;
        })
        .slice(0, 300);
      snap = { forEach: (fn) => docs.forEach(fn) };
    } else {
      throw err;
    }
  }

  let best = null;
  const grayZoneCandidates = [];

  snap.forEach(doc => {
    const data = doc.data();
    const score = fbSimilarity(newText, data.textOriginal);
    if (score >= FB_DUPLICATE_THRESHOLD) {
      if (!best || score > best.score) best = { id: doc.id, data, score, viaAi: false };
    } else if (score >= FB_GRAY_ZONE_MIN) {
      grayZoneCandidates.push({ id: doc.id, data, score });
    }
  });

  if (best) return best;

  // Only escalate to the AI tiebreaker for the single closest gray-zone
  // candidate — keeps this to at most one extra model call per submission.
  if (grayZoneCandidates.length) {
    grayZoneCandidates.sort((a, b) => b.score - a.score);
    const top = grayZoneCandidates[0];
    try {
      const verdict = await handleFeedbackDedupe({ textA: newText, textB: top.data.textOriginal });
      if (verdict.sameRequest === true) return { id: top.id, data: top.data, score: top.score, viaAi: true };
    } catch (err) {
      console.error('[aistudio] feedback tiebreaker failed, treating as distinct:', err.message);
    }
  }

  return null;
}

async function handleFeedbackSubmit({ text, callerUid }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw httpError(400, 'text required');
  if (trimmed.length < 4) throw httpError(400, 'Tell us a bit more — a few words is enough.');
  if (trimmed.length > 500) throw httpError(400, 'Keep it under 500 characters.');

  // Per-user rate limit: max 20 open suggestions authored per user, so this
  // can't be spammed into an unusable list.
  const authoredSnap = await db.collection('feedbackSuggestions')
    .where('submittedByUid', '==', callerUid)
    .where('status', '==', 'open')
    .limit(21)
    .get();
  if (authoredSnap.size >= 20) {
    throw httpError(429, 'You have a lot of open suggestions already — we\'ll get to them! Try again once some are reviewed.');
  }

  const match = await fbFindBestMatch(trimmed);

  if (match) {
    const existingVotes = match.data.votes || {};
    const alreadyVoted = Object.prototype.hasOwnProperty.call(existingVotes, callerUid);
    if (alreadyVoted) {
      return {
        merged: true,
        alreadyCounted: true,
        suggestionId: match.id,
        message: 'You already suggested something like this — we\'ve got it noted!',
      };
    }
    // Merging into an existing suggestion still counts as the submitter
    // liking it a lot — same +3 "Fantastic" auto-vote as a brand new one.
    const newVotes = { ...existingVotes, [callerUid]: FB_VOTE_SCORES.fantastic };
    const ref = db.collection('feedbackSuggestions').doc(match.id);
    await ref.set({
      votes: newVotes,
      voteCount: Object.keys(newVotes).length,
      totalScore: fbSumVotes(newVotes),
      updatedAt: FieldValue.serverTimestamp(),
      lastVotedAt: FieldValue.serverTimestamp(),
      ...(match.viaAi ? { aiMatchedCount: FieldValue.increment(1) } : {}),
    }, { merge: true });
    return {
      merged: true,
      alreadyCounted: false,
      suggestionId: match.id,
      message: 'Someone already suggested this — we\'ve added your vote!',
    };
  }

  const newRef = db.collection('feedbackSuggestions').doc();
  const initialVotes = { [callerUid]: FB_VOTE_SCORES.fantastic };
  await newRef.set({
    textOriginal: trimmed,
    textNormalized: fbNormalize(trimmed),
    votes: initialVotes,
    voteCount: 1,
    totalScore: fbSumVotes(initialVotes),
    status: 'open',
    submittedByUid: callerUid,
    aiMatchedCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastVotedAt: FieldValue.serverTimestamp(),
  });
  return {
    merged: false,
    suggestionId: newRef.id,
    message: 'Thanks — added to the board!',
  };
}

// Public: top open suggestions, ranked by totalScore (highest first), for
// the board view in the widget. callerUid may be null (signed-out callers
// can still browse). Also runs the 7-day cycle check first (see
// fbMaybeRunReset) since this is the read every board-open triggers.
async function handleFeedbackListTop({ limit, callerUid }) {
  const cycleInfo = await fbMaybeRunReset();

  // where('status', '==', 'open') + orderBy('totalScore', 'desc') requires
  // a composite Firestore index. If it hasn't been created yet (or is
  // still building), Firestore throws FAILED_PRECONDITION instead of
  // silently degrading — fall back to an in-memory filter/sort over the
  // full collection so this endpoint never crashes the caller's view.
  // The proper fix is still to create the index via the URL in the
  // original error message; this is just a safety net.
  const capLimit = Math.min(limit || 50, 100);
  let docs;
  try {
    const snap = await db.collection('feedbackSuggestions')
      .where('status', '==', 'open')
      .orderBy('totalScore', 'desc')
      .limit(capLimit)
      .get();
    docs = snap.docs;
  } catch (err) {
    if (err.message?.includes('requires an index') || err.message?.includes('FAILED_PRECONDITION')) {
      const allSnap = await db.collection('feedbackSuggestions').get();
      docs = allSnap.docs
        .filter(d => d.data().status === 'open')
        .sort((a, b) => (b.data().totalScore || 0) - (a.data().totalScore || 0))
        .slice(0, capLimit);
    } else {
      throw err;
    }
  }

  return {
    suggestions: docs.map(d => {
      const data = d.data();
      const votes = data.votes || {};
      return {
        id: d.id,
        text: data.textOriginal,
        totalScore: typeof data.totalScore === 'number' ? data.totalScore : fbSumVotes(votes),
        voteCount: Object.keys(votes).length,
        breakdown: fbVoteBreakdown(votes),
        myVote: callerUid && Object.prototype.hasOwnProperty.call(votes, callerUid) ? votes[callerUid] : null,
      };
    }),
    cycle: {
      cycleStart: cycleInfo.cycleStart,
      cycleEnd: cycleInfo.cycleStart + FB_CYCLE_MS,
      msRemaining: Math.max(0, cycleInfo.msRemaining),
      serverNow: Date.now(),
      justReset: !!cycleInfo.ranReset,
    },
  };
}

// Cast or change a vote on an existing suggestion. `score` must be one of
// the 4 allowed values (3/2/1/-1) — see FB_VOTE_SCORES. One vote per user
// per suggestion; casting again just overwrites their previous score
// (so users can change their mind).
async function handleFeedbackVoteExisting({ suggestionId, callerUid, score }) {
  if (!suggestionId) throw httpError(400, 'suggestionId required');
  const allowedScores = Object.values(FB_VOTE_SCORES);
  if (!allowedScores.includes(score)) {
    throw httpError(400, `score must be one of: ${allowedScores.join(', ')}`);
  }
  const ref = db.collection('feedbackSuggestions').doc(suggestionId);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, 'Suggestion not found');
  const data = snap.data();
  const votes = { ...(data.votes || {}) };
  const alreadyCast = Object.prototype.hasOwnProperty.call(votes, callerUid);
  const previousScore = alreadyCast ? votes[callerUid] : null;

  votes[callerUid] = score;
  const totalScore = fbSumVotes(votes);

  await ref.set({
    votes,
    voteCount: Object.keys(votes).length,
    totalScore,
    updatedAt: FieldValue.serverTimestamp(),
    lastVotedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    voted: true,
    changed: alreadyCast && previousScore !== score,
    previousScore,
    score,
    totalScore,
    voteCount: Object.keys(votes).length,
    breakdown: fbVoteBreakdown(votes),
  };
}

// Public: the permanent "What We're Working On" archive — every past
// cycle's top 3, oldest or newest first depending on `order`. Never
// deleted, only ever appended to (+3 per week).
async function handleFeedbackListArchive({ limit }) {
  const snap = await db.collection('feedbackArchive')
    .orderBy('archivedAt', 'desc')
    .limit(Math.min(limit || 300, 500))
    .get();
  return {
    items: snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        text: data.textOriginal,
        totalScore: data.totalScore || 0,
        voteCount: data.voteCount || 0,
        archivedAt: data.archivedAt ? data.archivedAt.toMillis() : null,
      };
    }),
  };
}

// Public: current cycle countdown info, without necessarily loading the
// full suggestion list (used to paint the countdown/header even before the
// board tab is opened). Also safe to call to trigger the reset check on
// its own.
async function handleFeedbackGetCycle() {
  const cycleInfo = await fbMaybeRunReset();
  return {
    cycleStart: cycleInfo.cycleStart,
    cycleEnd: cycleInfo.cycleStart + FB_CYCLE_MS,
    msRemaining: Math.max(0, cycleInfo.msRemaining),
    serverNow: Date.now(),
    justReset: !!cycleInfo.ranReset,
  };
}

// Admin-only: review queue sorted by votes, for the team to triage.
async function handleFeedbackListForReview({ callerData, status }) {
  if (!callerData?.isAdmin) throw httpError(403, 'Admin only');
  const effectiveStatus = status || 'open';
  let docs;
  try {
    const snap = await db.collection('feedbackSuggestions')
      .where('status', '==', effectiveStatus)
      .orderBy('totalScore', 'desc')
      .limit(100)
      .get();
    docs = snap.docs;
  } catch (err) {
    if (err.message?.includes('requires an index') || err.message?.includes('FAILED_PRECONDITION')) {
      const allSnap = await db.collection('feedbackSuggestions').get();
      docs = allSnap.docs
        .filter(d => d.data().status === effectiveStatus)
        .sort((a, b) => (b.data().totalScore || 0) - (a.data().totalScore || 0))
        .slice(0, 100);
    } else {
      throw err;
    }
  }
  return { suggestions: docs.map(d => ({ id: d.id, ...d.data() })) };
}

async function handleFeedbackSetStatus({ callerData, suggestionId, status }) {
  if (!callerData?.isAdmin) throw httpError(403, 'Admin only');
  if (!['open', 'planned', 'done', 'declined'].includes(status)) {
    throw httpError(400, 'Invalid status');
  }
  await db.collection('feedbackSuggestions').doc(suggestionId).set({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
}

// ── Daily nudge eligibility ──
// Decided server-side and stamped once per user per day, so the same user
// can't get re-rolled by reloading the page — but the outcome itself is a
// random-looking per-day coin flip (not always the same clock time), and
// only fires on ~1 in 3 active days so it doesn't feel naggy.
async function handleFeedbackCheckNudge({ callerUid, recentAction }) {
  if (!callerUid) return { shouldShow: false, alreadyDecidedToday: false, shown: false };

  const bucket = new Date().toISOString().slice(0, 10); // UTC day bucket
  const ref = db.collection('feedbackNudges').doc(`${callerUid}__${bucket}`);
  const snap = await ref.get();

  if (snap.exists) {
    const data = snap.data();
    return { shouldShow: false, alreadyDecidedToday: true, shown: !!data.shown };
  }

  const seed = `${callerUid}__${bucket}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const showProbability = 0.35;
  const willShow = (hash % 1000) / 1000 < showProbability;

  await ref.set({
    createdAt: FieldValue.serverTimestamp(),
    shown: willShow,
    recentAction: recentAction || null,
  });

  return { shouldShow: willShow, alreadyDecidedToday: false, shown: willShow };
}

// ════════════════════════════════════════════════════════════════════════
// FEATURE — Seller AI Agent's model calls (formerly a standalone agent.js
// file's own Groq client; the agent module is now folded into api/deal.js).
// That module still owns eligibility, quota,
// scheduling, and — since the deal.js refactor — the actual accept/reject
// transaction (via deal.js's settleDealInternal). This file's job is only
// the "what should the agent do" judgment call and reply drafting, so
// every AI feature on the platform goes through the same router, fallback
// chain, and usage tracking rather than that module keeping its own separate
// Groq instance and model list.
// ════════════════════════════════════════════════════════════════════════

const AGENT_DEAL_DECISION_SYSTEM = `
You are a marketplace seller's AI agent on Siterifty, evaluating one pending deal offer.

Respond ONLY with strict JSON, no markdown:
{"action":"accept"|"reject"|"hold","reason":"<one short sentence>"}

Rules:
- "accept" only if the offer is reasonable relative to the listed price and the buyer's message reads as genuine interest, not a lowball or spam.
- "reject" if the offer is far below the listed price with no justification, or the message reads as spam/abusive.
- "hold" if you're not confident either way — a human seller should decide. Prefer "hold" over guessing.
- There is no counter-offer mechanism on this platform — do not invent one or mention negotiating a specific alternate price.
`;

async function handleAgentDealDecision({ listingTitle, listingPrice, offerPrice, buyerMessage, autoAcceptMinPercent, autoRejectFloor }) {
  // Deterministic fast paths — skip the model call entirely when the
  // seller's own configured thresholds already give a clear answer.
  const offer = typeof offerPrice === 'number' ? offerPrice : listingPrice ?? 0;

  // autoAcceptMinPercent is a percentage of the listing's own price (e.g.
  // 80 = must offer >= 80% of listed price) rather than a flat dollar
  // figure, so one seller's threshold works across listings of very
  // different prices.
  if (
    typeof autoAcceptMinPercent === 'number' &&
    typeof listingPrice === 'number' &&
    listingPrice > 0 &&
    offer >= listingPrice * (autoAcceptMinPercent / 100)
  ) {
    return { action: 'accept', reason: 'Meets your configured minimum offer percentage.', model: null };
  }
  if (typeof autoRejectFloor === 'number' && offer < autoRejectFloor) {
    return { action: 'reject', reason: 'Below your configured floor price.', model: null };
  }

  const result = await callWithFallback(CHAINS.agentDealDecision, {
    messages: [
      { role: 'system', content: AGENT_DEAL_DECISION_SYSTEM },
      { role: 'user', content: `Listing: "${listingTitle || 'Unknown'}"
Listed price: ${listingPrice != null ? `$${listingPrice}` : 'not set'}
Buyer offer: ${offerPrice != null ? `$${offerPrice}` : 'no specific offer, asking about listed price'}
Buyer message: "${buyerMessage || ''}"` },
    ],
    temperature: 0.2,
    max_tokens: 120,
  });

  let parsed;
  try {
    parsed = JSON.parse((result.content || '').replace(/```json|```/g, '').trim());
  } catch {
    parsed = { action: 'hold', reason: 'Could not parse agent decision — defaulting to hold for human review.' };
  }
  if (!['accept', 'reject', 'hold'].includes(parsed.action)) parsed.action = 'hold';
  return { action: parsed.action, reason: parsed.reason || '', model: result.usedModel };
}

async function handleAgentAutoReply({ listingTitle, buyerMessage, tone }) {
  if (!buyerMessage) throw httpError(400, 'buyerMessage required');
  const useTone = tone || 'professional';

  const result = await callWithFallback(CHAINS.agentAutoReply, {
    messages: [
      { role: 'system', content: `You are an AI agent replying for a marketplace seller on Siterifty. Reply in a ${useTone} tone. Keep it 2-4 sentences. Listing: "${listingTitle || 'your listing'}". Respond ONLY with JSON: {"reply":"<your message>"}` },
      { role: 'user', content: `Buyer sent: "${buyerMessage}"\nWrite a ${useTone} seller reply.` },
    ],
    temperature: 0.4,
    max_tokens: 200,
  });

  let parsed;
  try {
    parsed = JSON.parse((result.content || '').replace(/```json|```/g, '').trim());
  } catch {
    parsed = { reply: '' };
  }
  return { reply: parsed.reply || '', model: result.usedModel };
}

// ════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════════

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const action = body.action;
    if (!action) return res.status(400).json({ error: 'action is required' });

    // ── Auth ──
    // Normal path: verify the caller's Firebase ID token (all user-facing
    // actions require login).
    // Internal path: deal.js/listings.js call triage-report/triage-dispute/
    // analyze-reported-image right after filing a report/dispute — there is
    // no logged-in "caller" for that server-to-server call, so it
    // authenticates with a shared secret instead. Restricted to these three
    // system-triggered actions; every other action still requires a real
    // Firebase ID token.
    const internalToken = req.headers['x-internal-token'];
    const INTERNAL_ACTIONS = ['triage-report', 'triage-dispute', 'analyze-reported-image', 'feedback-dedupe', 'agent-deal-decision', 'agent-auto-reply'];
    const isInternalTriageCall = internalToken
      && process.env.AISTUDIO_INTERNAL_TOKEN
      && internalToken === process.env.AISTUDIO_INTERNAL_TOKEN
      && INTERNAL_ACTIONS.includes(action);

    // These must work fully signed-out (browsing the archive and the
    // countdown doesn't require an account — only submitting/voting does).
    const PUBLIC_ACTIONS = ['feedback-list-archive', 'feedback-get-cycle'];
    const isPublicAction = PUBLIC_ACTIONS.includes(action);

    // recommendations is a user-facing action that must also work
    // signed-out (the panel shows non-personalized results in that case) —
    // so it verifies a token if one was sent, but doesn't require it.
    // check-nudge similarly degrades gracefully to "no nudge" if signed out.
    // feedback-list-top is the same story: signed-out callers can still
    // browse the board, but if a token IS sent we decode it so each
    // suggestion can report the caller's own already-cast vote (myVote).
    const OPTIONAL_AUTH_ACTIONS = ['recommendations', 'check-nudge', 'feedback-list-top'];
    const isOptionalAuthAction = OPTIONAL_AUTH_ACTIONS.includes(action);

    let callerUid = null;
    let callerName = 'System';
    let callerData = {};

    if (!isInternalTriageCall && !isPublicAction) {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!idToken && !isOptionalAuthAction) {
        return res.status(401).json({ error: 'Missing auth token' });
      }

      if (idToken) {
        let decoded;
        try {
          decoded = await admin.auth().verifyIdToken(idToken);
        } catch {
          if (isOptionalAuthAction) {
            decoded = null; // bad/expired token on an optional-auth action -> treat as signed-out, don't fail the request
          } else {
            return res.status(401).json({ error: 'Invalid or expired auth token' });
          }
        }
        if (decoded) {
          callerUid = decoded.uid;
          const callerSnap = await db.collection('users').doc(callerUid).get();
          callerData = callerSnap.exists ? callerSnap.data() : {};
          callerName = callerData.username || callerData.displayName || 'there';
        }
      }
    }

    let result;
    switch (action) {
      case 'chat':
        result = await handleChat({ messages: body.messages, callerUid, callerName });
        break;
      case 'scam-check':
        result = await handleScamCheck({ text: body.text, callerUid, chatId: body.chatId });
        break;
      case 'auto-description':
        result = await handleAutoDescription({
          title: body.title,
          targetLength: body.targetLength,
          plan: body.plan || callerData.plan || 'free',
          callerUid,
        });
        break;
      case 'deal-message-assist':
        result = await handleDealMessageAssist({
          listingTitle: body.listingTitle,
          listingSummary: body.listingSummary,
          offerAmount: body.offerAmount,
          userDraft: body.userDraft,
          callerUid,
        });
        break;
      case 'triage-report':
        result = await handleTriage({ kind: 'report', reportId: body.reportId, evidence: body.evidence, callerUid });
        break;
      case 'triage-dispute':
        result = await handleTriage({ kind: 'dispute', disputeId: body.disputeId, evidence: body.evidence, callerUid });
        break;
      case 'read-image':
        result = await handleImageRead({ imageBase64: body.imageBase64, mimeType: body.mimeType, question: body.question });
        break;
      case 'analyze-reported-image':
        result = await handleAnalyzeReportedImage({ imageUrl: body.imageUrl, context: body.context, reportId: body.reportId, disputeId: body.disputeId });
        break;
      case 'feedback-dedupe':
        result = await handleFeedbackDedupe({ textA: body.textA, textB: body.textB });
        break;
      case 'agent-deal-decision':
        result = await handleAgentDealDecision({
          listingTitle: body.listingTitle,
          listingPrice: body.listingPrice,
          offerPrice: body.offerPrice,
          buyerMessage: body.buyerMessage,
          autoAcceptMinPercent: body.autoAcceptMinPercent,
          autoRejectFloor: body.autoRejectFloor,
        });
        break;
      case 'agent-auto-reply':
        result = await handleAgentAutoReply({ listingTitle: body.listingTitle, buyerMessage: body.buyerMessage, tone: body.tone });
        break;
      case 'recommendations':
        result = await handleRecommendations({ callerUid });
        break;
      case 'feedback-submit':
        result = await handleFeedbackSubmit({ text: body.text, callerUid });
        break;
      case 'feedback-list-top':
        result = await handleFeedbackListTop({ limit: body.limit, callerUid });
        break;
      case 'feedback-vote-existing':
        result = await handleFeedbackVoteExisting({ suggestionId: body.suggestionId, callerUid, score: body.score });
        break;
      case 'feedback-list-archive':
        result = await handleFeedbackListArchive({ limit: body.limit });
        break;
      case 'feedback-get-cycle':
        result = await handleFeedbackGetCycle();
        break;
      case 'feedback-list-for-review':
        result = await handleFeedbackListForReview({ callerData, status: body.status });
        break;
      case 'feedback-set-status':
        result = await handleFeedbackSetStatus({ callerData, suggestionId: body.suggestionId, status: body.status });
        break;
      case 'check-nudge':
        result = await handleFeedbackCheckNudge({ callerUid, recentAction: body.recentAction });
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('aistudio handler error:', err);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
}
