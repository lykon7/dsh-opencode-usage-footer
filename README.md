# dsh-opencode-usage-footer

[![npm](https://img.shields.io/npm/v/dsh-opencode-usage-footer)](https://www.npmjs.com/package/dsh-opencode-usage-footer)
[![license](https://img.shields.io/npm/l/dsh-opencode-usage-footer)](LICENSE)

> OpenCode Go usage — `5h` / `7d` / `30d` — as a quiet pill in the DeepSeek Harness Web composer footer.

```
…  ▂▃▅  Go   5h ▓░░ 12%   7d ▓░░ 34%   30d ▓▓▓ 56%
```

`dsh` plugin. One row in the composer's own footer, next to the harness stats
pills and the context meter. Hover a chip for the window it names, its share of
the limit, and the reset countdown; hover the row for when it last refreshed.
Nothing is clickable — it is a readout, not a control.

## Why this one

Three plugins already show OpenCode Go usage in this GUI
([`dsh-plugin-opencode-usage`](https://www.npmjs.com/package/dsh-plugin-opencode-usage),
[`dsh-opencode-go-usage`](https://www.npmjs.com/package/dsh-opencode-go-usage),
[`dsh-opencode-usage`](https://www.npmjs.com/package/dsh-opencode-usage)) — if you
want history, trends, alerts or an agent tool, use one of those; they do more.

This one is deliberately small and exists for three reasons:

- **It lives in the composer footer**, inline with what the harness already
  prints there, instead of a floating panel or a sidebar badge. It never covers
  the conversation and never adds an entry point to click past.
- **It stops when nobody is watching.** The host half refreshes only while a
  page has polled recently; two minutes after the last poll it makes no upstream
  request at all. An idle GUI costs opencode.ai nothing.
- **It says why it is empty.** `no key`, `key rejected`, `offline`, `timeout`,
  `api changed` — never a confident `0%`.

## Install

```sh
dsh plugin --profile web add dsh-opencode-usage-footer
```

Then restart `dsh web` (or let HMR re-compose the profile) and open a session:
the pill appears under the message box. From a checkout instead of the registry:

```sh
dsh plugin --profile web add /path/to/dsh-opencode-usage-footer
```

**Requirement:** an OpenCode Go subscription, added the normal way in
**Settings → Models → Add model provider → opencode-go**. The harness stores that
provider's Console API key as the credential `OPENCODE_GO_API_KEY`, which is what
this plugin reads (and the same key the provider uses for inference) — no browser
cookie, no second key to manage. Exporting `OPENCODE_GO_API_KEY` in the
environment works too and takes precedence.

## How it works

```text
browser  ── GET /opencode-usage ──▶  host half
                                      │ ctx.credentials.resolve("OPENCODE_GO_API_KEY")
                                      │ GET https://opencode.ai/zen/go/v1/usage
                                      ▼
                                    cached snapshot (60s refresh while watched)
```

The upstream answer is three meters:

```json
{"usage":{
  "rolling":{"status":"ok","percent":12,"resetsAt":"2026-10-15T11:08:22.000Z"},
  "weekly": {"status":"ok","percent":34,"resetsAt":"2026-10-19T00:00:00.000Z"},
  "monthly":{"status":"ok","percent":56,"resetsAt":"2026-10-28T06:35:44.000Z"}}}
```

The host half adds its own cache state and a typed error, so the pill can be
honest when it has nothing:

```json
{"ok":true,"source":"opencode-go","route":"/opencode-usage",
 "meters":[{"key":"rolling","short":"5h","label":"Rolling 5h","percent":12,
            "status":"ok","resetsAt":"2026-10-15T11:08:22.000Z"}],
 "stale":false,"error":null,"fetchedAt":"2026-10-15T08:12:04.900Z","ageMs":1200}
```

| Cadence | Value | Where |
| --- | --- | --- |
| Browser poll (tab visible) | 30s, plus one on refocus | `lib/client.js` |
| Host refresh while watched | 60s | `lib/index.js` |
| Snapshot served without refetch | 45s | `lib/index.js` |
| Background refresh stops | 2 min after the last poll | `lib/index.js` |
| Upstream request timeout | 15s | `lib/index.js` |

## Failure modes

| Pill | Meaning | Fix |
| --- | --- | --- |
| `Go …` | First read in flight | — |
| `Go no key` | `OPENCODE_GO_API_KEY` is not set anywhere | Add the provider in **Settings → Models → Add model provider**, or export the variable |
| `Go key rejected` | opencode.ai answered 401/403 | Reissue the key in the OpenCode console |
| `Go offline` / `Go timeout` | The host could not reach opencode.ai | Check connectivity |
| `Go api changed` | The response carried no meter windows | Update `parseUsage` in `lib/index.js` |
| dimmed numbers | Last good read; the newest refresh failed | Hover for the last error |

## Compatibility

| DSH | Status |
| --- | --- |
| `0.2.0-rc.2` | verified — every seam this plugin uses |

The package declares what it needs in the two places the ecosystem reads:
`engines.dsh` and lockstep `@deepseek-ai/dsh-*` peers (host webserver, client
slot renderer, optional credentials), plus a per-release
`dsh.compatibility.dshReleases` map for catalog UIs. Note for anyone copying the
range: `>=0.2.0-rc.2 <0.3.0-0` must be its own range — a wider
`>=0.2.0-rc.2 <1.0.0-0` silently excludes prereleases of a different
`major.minor.patch` tuple.

## Security and privacy

- The API key never leaves the host process. Only percentages, reset timestamps
  and error *messages* cross to the browser.
- `GET /opencode-usage` is not authenticated; it inherits the webserver's bind
  address. On the default `127.0.0.1` bind only this machine can read it. If you
  bind `0.0.0.0` (or run behind a proxy), anyone who can reach the port reads
  your three percentages — keep it loopback, or gate the path at the proxy.
- Like every harness plugin, this code runs in the host and in your browser with
  your permissions. Read it before you install it.

## Development

```sh
pnpm install
pnpm test        # offline: the upstream route is stubbed
```

- `test/host-half.test.mjs` drives the real `apply()` against a fake host
  context and stubbed `fetch`: route registration, the snapshot shape, cache
  behaviour, `HEAD`/`405`, and every error code.
- `test/client-half.test.mjs` loads the shipped bundle through the real
  `window.__ModuleLoader__` wrapper, mounts it with react-dom in jsdom, and
  asserts the loading paint, the three chips at their percentages, the bars, the
  aria label, the tooltips, the stale state, and both failure surfaces.

## Release

Publishing is tag-driven through npm trusted publishing (OIDC) — no registry
token exists on any machine:

```sh
npm version patch         # or minor/major; updates package.json
git push --follow-tags    # the release workflow runs the tests and publishes
```

## License

MIT — see [LICENSE](LICENSE).
