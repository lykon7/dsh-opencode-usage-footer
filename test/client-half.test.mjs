/**
 * Client-half test: the shipped bundle, loaded through the real module wrapper
 * and mounted with react-dom in jsdom. The host route is stubbed, so this runs
 * offline and asserts what a user looking at the composer footer sees.
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const BUNDLE = new URL("../lib/client.js", import.meta.url).href;
const CHIP = { rolling: "5h", weekly: "7d", monthly: "30d" };

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: "http://127.0.0.1:3080/",
  pretendToBeVisual: true
});
const { window } = dom;
const registrations = [];
window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) };
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
await import(BUNDLE + "?v=" + Date.now());

// 1. The bundle is exactly one module registration under the package name.
assert.equal(registrations.length, 1, "one module registration");
const registration = registrations[0];
assert.equal(registration.id, "dsh-opencode-usage-footer");

const jsxRuntime = await import("react/jsx-runtime");
const plugin = registration.factory((specifier) => {
  if (specifier === "react") return React;
  if (specifier === "react/jsx-runtime") return jsxRuntime;
  throw new Error("unexpected require: " + specifier);
});
assert.deepEqual(plugin.inject, ["slots"]);

// 2. It registers into the composer footer, after the harness stats pills.
let options = null;
let Component = null;
plugin.apply({
  slots: {
    inject: (name, callback) => {
      assert.equal(name, "conversation.composer.dock");
      callback();
    },
    register: (registerOptions, component) => {
      options = registerOptions;
      Component = component;
      return () => {};
    }
  }
});
assert.deepEqual(options, { name: "conversation.composer.dock", id: "opencode-usage", order: 10 });

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const SNAPSHOT = {
  ok: true,
  source: "opencode-go",
  route: "/opencode-usage",
  stale: false,
  error: null,
  fetchedAt: new Date().toISOString(),
  ageMs: 1200,
  meters: [
    { key: "rolling", short: "5h", label: "Rolling 5h", percent: 12, status: "ok", resetsAt: future(3) },
    { key: "weekly", short: "7d", label: "Weekly (7d)", percent: 34, status: "ok", resetsAt: future(80) },
    { key: "monthly", short: "30d", label: "Monthly (30d)", percent: 56, status: "ok", resetsAt: future(300) }
  ]
};
const ERROR_SNAPSHOT = {
  ok: false,
  source: "opencode-go",
  route: "/opencode-usage",
  stale: false,
  error: { code: "no-key", message: "No OpenCode Go API key. Add the opencode-go provider in Settings → Models → Add model provider, or export OPENCODE_GO_API_KEY." },
  fetchedAt: null,
  ageMs: null,
  meters: []
};

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const settle = (ms = 60) => new Promise((resolve) => window.setTimeout(resolve, ms));
const mounted = [];
function mount(fetchImpl) {
  globalThis.fetch = fetchImpl;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(Component));
  const entry = {
    container,
    unmount() {
      root.unmount();
      container.remove();
    }
  };
  mounted.push(entry);
  return entry;
}

// 3. First paint says it is loading, then shows the meters.
let release;
const deferred = new Promise((resolve) => {
  release = resolve;
});
const view = mount((input) => {
  assert.equal(String(input), "/opencode-usage");
  return deferred;
});
await settle(30);
assert.match(view.container.textContent, /Go/, "the first paint is the loading pill");

release(json(SNAPSHOT));
await settle(80);
const pill = view.container.querySelector("[data-opencode-usage]");
const text = view.container.textContent;
assert.equal(pill.getAttribute("data-opencode-usage"), "ready");
for (const meter of SNAPSHOT.meters) {
  assert.ok(text.includes(CHIP[meter.key] + meter.percent + "%"), CHIP[meter.key] + meter.percent + "% is on screen, got " + text);
}
assert.deepEqual(
  [...pill.querySelectorAll("span > span")].map((node) => node.style.width).filter((width) => /%$/.test(width)),
  SNAPSHOT.meters.map((meter) => meter.percent + "%"),
  "one bar per meter, at its percentage"
);
const aria = pill.getAttribute("aria-label");
assert.match(aria, /Rolling 5h 12%/);
assert.match(aria, /Weekly \(7d\) 34%/);
assert.match(aria, /Monthly \(30d\) 56%/);
assert.match(pill.getAttribute("title"), /updated \d+s ago/);
const tooltips = [...pill.querySelectorAll("span[title]")].map((node) => node.getAttribute("title"));
assert.equal(tooltips.length, SNAPSHOT.meters.length);
for (const tooltip of tooltips) assert.match(tooltip, /of the limit · resets in /);

// 4. A reliable read that arrives late marks the numbers stale instead of hiding them.
const stale = mount(async () => json({ ...SNAPSHOT, stale: true, error: { code: "network", message: "getaddrinfo ENOTFOUND opencode.ai" } }));
await settle(80);
const stalePill = stale.container.querySelector("[data-opencode-usage]");
assert.equal(stalePill.getAttribute("data-opencode-usage"), "stale");
assert.match(stalePill.getAttribute("title"), /last refresh failed/);
assert.ok(stale.container.textContent.includes("5h12%"), "stale numbers stay on screen");

// 5. An empty read says why, never a confident zero.
const failed = mount(async () => json(ERROR_SNAPSHOT));
await settle(80);
assert.equal(failed.container.textContent, "Go no key");
assert.match(failed.container.querySelector("[data-opencode-usage]").getAttribute("title"), /OPENCODE_GO_API_KEY/);

// 6. A route that never answers is a transport failure, not a zero.
const offline = mount(async () => {
  throw new Error("ECONNREFUSED 127.0.0.1:3080");
});
await settle(80);
assert.equal(offline.container.textContent, "Go offline");
assert.match(offline.container.querySelector("[data-opencode-usage]").getAttribute("aria-label"), /ECONNREFUSED/);

for (const entry of mounted) entry.unmount();
console.log("CLIENT HALF OK");
