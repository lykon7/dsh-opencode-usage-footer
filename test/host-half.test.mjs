/**
 * Host-half test. No network and no credentials: the upstream is stubbed, so
 * the assertions cover exactly what the browser half is promised.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const upstream = JSON.parse(readFileSync(join(here, "fixtures/upstream.json"), "utf8"));
const plugin = await import("../lib/index.js");

const realFetch = globalThis.fetch;
const savedKey = process.env.OPENCODE_GO_API_KEY;
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Boot one plugin instance over a fake host context. */
function boot({ key = "oc_sk_test", credentials = true } = {}) {
  const routes = [];
  const disposers = [];
  const requests = [];
  const store = {
    resolve: async (ref) => (credentials && ref === "OPENCODE_GO_API_KEY" ? { value: key, source: "credential store" } : undefined)
  };
  const ctx = {
    webServer: {
      register: (route) => {
        routes.push(route);
        return () => {};
      }
    },
    get: (name) => (name === "credentials" ? store : undefined),
    effect: (callback) => {
      const disposer = callback();
      disposers.push(disposer);
      return () => disposer?.();
    }
  };
  plugin.apply(ctx);
  const route = routes.find((candidate) => candidate.path === "/opencode-usage");
  assert.ok(route, "the snapshot route is registered");
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return jsonResponse(upstream);
  };
  const call = (method = "GET") =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("response never arrived")), 5000);
      const res = {
        status: 0,
        headers: null,
        body: null,
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers ?? null;
        },
        end(body) {
          this.body = body === undefined ? null : body;
          clearTimeout(timer);
          resolve(this);
        }
      };
      route.handler({ method }, res);
    });
  return {
    route,
    requests,
    call,
    snapshot: async (method = "GET") => JSON.parse((await call(method)).body),
    dispose: () => disposers.forEach((disposer) => disposer?.())
  };
}

try {
  // 1. The row declares its required service.
  assert.deepEqual(plugin.inject, ["webServer"]);

  // 2. A successful read: three meters, chip labels, cache age, no stale flag.
  {
    delete process.env.OPENCODE_GO_API_KEY;
    const host = boot();
    const response = await host.call();
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    const snapshot = JSON.parse(response.body);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.source, "opencode-go");
    assert.equal(snapshot.route, "/opencode-usage");
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.error, null);
    assert.deepEqual(
      snapshot.meters.map((meter) => [meter.key, meter.short, meter.percent]),
      [["rolling", "5h", 12], ["weekly", "7d", 34], ["monthly", "30d", 56]]
    );
    assert.deepEqual(
      snapshot.meters.map((meter) => meter.label),
      ["Rolling 5h", "Weekly (7d)", "Monthly (30d)"]
    );
    assert.ok(Date.parse(snapshot.fetchedAt) > 0, "fetchedAt is an ISO timestamp");
    assert.equal(typeof snapshot.ageMs, "number");
    assert.equal(host.requests.length, 1);
    assert.equal(host.requests[0].url, "https://opencode.ai/zen/go/v1/usage");
    assert.equal(host.requests[0].init.headers.authorization, "Bearer oc_sk_test");
    assert.equal(host.requests[0].init.headers.accept, "application/json");
    assert.match(String(host.requests[0].init.headers["user-agent"]), /^dsh-opencode-usage-footer\//);

    // 3. The cache serves a second poll without touching the upstream.
    await host.snapshot();
    assert.equal(host.requests.length, 1, "a fresh snapshot is served from cache");
    host.dispose();
  }

  // 4. HEAD answers the same headers without a body; other methods are refused.
  {
    const host = boot();
    const head = await host.call("HEAD");
    assert.equal(head.status, 200);
    const refused = await host.call("POST");
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.allow, "GET, HEAD");
    host.dispose();
  }

  // 5. A rejected key is reported as such, never as a confident zero.
  {
    const host = boot();
    globalThis.fetch = async () => jsonResponse({ error: "unauthorized" }, 401);
    const snapshot = await host.snapshot();
    assert.equal(snapshot.ok, false);
    assert.equal(snapshot.error.code, "unauthorized");
    assert.deepEqual(snapshot.meters, []);
    host.dispose();
  }

  // 6. No key anywhere: the pill is told why, and no upstream call is made.
  {
    const host = boot({ credentials: false });
    let called = 0;
    globalThis.fetch = async () => {
      called += 1;
      return jsonResponse(upstream);
    };
    const snapshot = await host.snapshot();
    assert.equal(snapshot.error.code, "no-key");
    assert.match(snapshot.error.message, /OPENCODE_GO_API_KEY/);
    assert.equal(called, 0);
    host.dispose();
  }

  // 7. A changed upstream shape is named instead of reported as zero usage.
  {
    const host = boot();
    globalThis.fetch = async () => jsonResponse({ usage: {} });
    const snapshot = await host.snapshot();
    assert.equal(snapshot.error.code, "bad-payload");
    host.dispose();
  }

  // 8. A network failure with nothing cached is an error, and the error is the story.
  {
    const host = boot();
    globalThis.fetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND opencode.ai");
    };
    const snapshot = await host.snapshot();
    assert.equal(snapshot.ok, false);
    assert.equal(snapshot.error.code, "network");
    assert.match(snapshot.error.message, /ENOTFOUND/);
    assert.deepEqual(snapshot.meters, []);
    host.dispose();
  }

  // 9. A later failure keeps the last good numbers and marks them stale. The
  //    freshness window is skipped by moving the clock, not by waiting it out.
  {
    const host = boot();
    await host.snapshot();
    const realNow = Date.now;
    Date.now = () => realNow.call(Date) + 60_000;
    try {
      globalThis.fetch = async () => {
        throw new Error("getaddrinfo ENOTFOUND opencode.ai");
      };
      const snapshot = await host.snapshot();
      assert.equal(snapshot.ok, false);
      assert.equal(snapshot.stale, true);
      assert.equal(snapshot.error.code, "network");
      assert.equal(snapshot.meters.length, 3, "the last good numbers are kept");
    } finally {
      Date.now = realNow;
    }
    host.dispose();
  }

  // 10. The environment wins over the credential store.
  {
    process.env.OPENCODE_GO_API_KEY = "oc_sk_from_env";
    const host = boot({ credentials: false });
    await host.snapshot();
    assert.equal(host.requests[0].init.headers.authorization, "Bearer oc_sk_from_env");
    host.dispose();
  }

  console.log("HOST HALF OK");
} finally {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env.OPENCODE_GO_API_KEY;
  else process.env.OPENCODE_GO_API_KEY = savedKey;
}
