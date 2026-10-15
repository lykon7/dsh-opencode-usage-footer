/**
 * Host half of `dsh-opencode-usage`.
 *
 * Reads the OpenCode Go usage meters from opencode.ai with the API key already
 * stored in the harness credential store, caches them, and serves the snapshot
 * on a same-origin route the browser half polls.
 *
 * Dependency-free on purpose: the profile loader resolves this package from the
 * dsh installation or from the profile directory, so a bare import of another
 * harness package is not guaranteed to resolve from here.
 * @module dsh-opencode-usage
 */

/** OpenCode Go's official usage endpoint, authenticated with the Console API key. */
const USAGE_ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
/** Same-origin JSON route the browser half polls. */
const ROUTE_PATH = "/opencode-usage";
/** Credential reference resolved through the harness credential store. */
const CREDENTIAL_REF = "OPENCODE_GO_API_KEY";
/** The three meters the OpenCode console shows, in console order. */
const METER_DEFS = [
  { key: "rolling", short: "5h", label: "Rolling 5h" },
  { key: "weekly", short: "7d", label: "Weekly (7d)" },
  { key: "monthly", short: "30d", label: "Monthly (30d)" }
];
/** Background refresh cadence; the browser polls faster and reads this cache. */
const REFRESH_INTERVAL_MS = 60_000;
/** Serve the cache without touching opencode.ai while it is younger than this. */
const FRESH_FOR_MS = 45_000;
/** Stop the background refresh once no page has polled for this long. */
const IDLE_AFTER_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Identify the client, as the Go terms ask of non-CLI consumers. */
const USER_AGENT = "dsh-opencode-usage-footer/0.1.0";

export const name = "opencode-usage";
/** Required services: the HTTP server that carries the snapshot route. */
export const inject = ["webServer"];

/** Coerce a JSON number-or-numeric-string to a finite number. */
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Read the API key: the launch environment wins, then the credential store. */
async function resolveApiKey(ctx) {
  const fromEnv = typeof process.env[CREDENTIAL_REF] === "string" ? process.env[CREDENTIAL_REF].trim() : "";
  if (fromEnv !== "") return { key: fromEnv, source: "environment" };
  let store;
  try {
    store = ctx.get("credentials");
  } catch {
    store = void 0;
  }
  if (store === void 0 || typeof store.resolve !== "function") return { key: "", source: "none" };
  try {
    const hit = await store.resolve(CREDENTIAL_REF);
    const value = typeof hit === "string" ? hit : hit === null || hit === void 0 ? "" : hit.value;
    const key = typeof value === "string" ? value.trim() : "";
    return { key, source: key === "" ? "none" : "credential store" };
  } catch {
    return { key: "", source: "none" };
  }
}

/** Project the endpoint payload onto the three meters the console shows. */
function parseUsage(payload) {
  const usage = payload !== null && typeof payload === "object" ? payload.usage : void 0;
  if (usage === null || typeof usage !== "object") return [];
  const meters = [];
  for (const def of METER_DEFS) {
    const meter = usage[def.key];
    if (meter === null || typeof meter !== "object") continue;
    const percent = toNumber(meter.percent);
    if (percent === null) continue;
    meters.push({
      key: def.key,
      short: def.short,
      label: def.label,
      percent: Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10,
      status: typeof meter.status === "string" ? meter.status : "ok",
      resetsAt: typeof meter.resetsAt === "string" ? meter.resetsAt : null
    });
  }
  return meters;
}

/** One usage read. Never throws; a failure is returned as an error code. */
async function fetchUsage(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(USAGE_ENDPOINT, {
      headers: {
        authorization: "Bearer " + apiKey,
        accept: "application/json",
        "user-agent": USER_AGENT
      },
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      return { meters: null, error: { code: "unauthorized", message: "OpenCode refused the API key (HTTP " + response.status + ")." } };
    }
    if (!response.ok) {
      return { meters: null, error: { code: "http", message: "OpenCode answered HTTP " + response.status + "." } };
    }
    const payload = await response.json().catch(() => null);
    if (payload === null) {
      return { meters: null, error: { code: "bad-payload", message: "OpenCode answered with a body that is not JSON." } };
    }
    const meters = parseUsage(payload);
    if (meters.length === 0) {
      return { meters: null, error: { code: "bad-payload", message: "The usage response carried no meter windows; opencode.ai may have changed its API." } };
    }
    return { meters, error: null };
  } catch (error) {
    if (error !== null && typeof error === "object" && error.name === "AbortError") {
      return { meters: null, error: { code: "timeout", message: "opencode.ai did not answer within " + REQUEST_TIMEOUT_MS + " ms." } };
    }
    return {
      meters: null,
      error: { code: "network", message: error instanceof Error ? error.message : String(error) }
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param ctx - host plugin context carrying the injected `webServer`.
 */
export function apply(ctx) {
  /** Last good meters, kept across a later failure so the pill shows stale data, not a zero. */
  let meters = [];
  /** Last successful read, in epoch ms; 0 while nothing has succeeded yet. */
  let fetchedAt = 0;
  /** Last error, cleared by the next success. */
  let lastError = null;
  /** Last attempt, successful or not, so a failing upstream is not hammered. */
  let attemptedAt = 0;
  /** Single-flight read shared by the poll and by request-triggered refreshes. */
  let inflight = null;
  /** Last snapshot request served; a page that stops polling stops the upstream reads. */
  let lastRequestedAt = 0;

  const snapshot = () => ({
    ok: lastError === null && meters.length > 0,
    source: "opencode-go",
    route: ROUTE_PATH,
    meters,
    stale: lastError !== null && meters.length > 0,
    error: lastError,
    fetchedAt: fetchedAt === 0 ? null : new Date(fetchedAt).toISOString(),
    ageMs: fetchedAt === 0 ? null : Date.now() - fetchedAt
  });

  const read = async () => {
    const credential = await resolveApiKey(ctx);
    if (credential.key === "") {
      return { meters: null, error: { code: "no-key", message: "No OpenCode Go API key. Save one as " + CREDENTIAL_REF + " in Settings, Credentials." } };
    }
    return fetchUsage(credential.key);
  };

  const refresh = () => {
    if (inflight !== null) return inflight;
    attemptedAt = Date.now();
    inflight = read()
      .then((result) => {
        if (result.error === null) {
          meters = result.meters;
          fetchedAt = Date.now();
          lastError = null;
        } else {
          lastError = result.error;
        }
        return snapshot();
      })
      .catch((error) => {
        lastError = { code: "internal", message: error instanceof Error ? error.message : String(error) };
        return snapshot();
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const respond = async (res) => {
    try {
      if (Date.now() - attemptedAt > FRESH_FOR_MS) await refresh();
      const body = JSON.stringify(snapshot());
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
    } catch (error) {
      const body = JSON.stringify({ ok: false, meters: [], error: { code: "internal", message: error instanceof Error ? error.message : String(error) } });
      res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
    }
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: ROUTE_PATH,
        handler: (req, res) => {
          lastRequestedAt = Date.now();
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { allow: "GET, HEAD" });
            res.end();
            return;
          }
          void respond(res);
        }
      }),
    "opencode-usage: usage snapshot route"
  );

  // Keep the cache warm while an open page is watching, so its next poll is a
  // cache hit. Idle hosts make no upstream calls at all: the timer only fires
  // between the first browser poll and two minutes after the last one.
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastRequestedAt > IDLE_AFTER_MS) return;
      void refresh().catch(() => {});
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, "opencode-usage: background refresh");
}
