// Shared Vercel-style (req,res) <-> Next.js Route Handler adapter.
//
// Every file in app/api/_lib and each route's _handler.js is a byte-for-byte
// (or near enough) copy of the original api/*.js Vercel serverless function.
// Those files all expect the old Node http-style `handler(req, res)`
// signature — req.query, req.body, req.headers, req.method, and
// res.status(n).json(x) / res.end() / res.setHeader(k,v). This file is the
// one place that knows how to bridge that shape to/from a real Next.js
// `Request`/`Response`, so individual route.ts adapters stay a two-line
// call into here instead of re-implementing the shim per route.
//
// Only this file's job is the translation — if a specific action's LOGIC
// needs to change, that always belongs in the relevant _handler.js, never
// here.
export async function runLegacyHandler(
  request: Request,
  legacyHandler: (req: any, res: any) => Promise<any> | any
): Promise<Response> {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  let body: any = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  // Forward real request headers through as a plain lowercase-keyed object,
  // matching Node's req.headers shape. Several of these handlers read
  // req.headers.cookie (admin_session gate) or req.headers.authorization
  // (cron secret / bearer tokens) or PayPal's webhook signature headers —
  // none of that worked in the original two-route adapter this was copied
  // from, since neither account.js nor listings.js needed headers.
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let statusCode = 200;
  let responseBody: any = null;
  let responseText: string | null = null;
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  let sent = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      responseBody = payload;
      sent = true;
      return res;
    },
    // A handful of legacy handlers (e.g. OPTIONS preflight replies) call
    // res.status(200).end() with no body rather than .json(...).
    end(payload?: any) {
      if (payload !== undefined) responseText = String(payload);
      sent = true;
      return res;
    },
    setHeader(key: string, value: string) {
      responseHeaders.set(key, value);
      return res;
    },
    headersSent: false,
  };

  const req = { query, body, method: request.method, headers, url: url.pathname + url.search };

  await legacyHandler(req as any, res as any);

  if (!sent) {
    return new Response(JSON.stringify({ error: "No response from handler" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (responseBody !== null) {
    return new Response(JSON.stringify(responseBody), { status: statusCode, headers: responseHeaders });
  }
  return new Response(responseText ?? "", { status: statusCode, headers: responseHeaders });
}
