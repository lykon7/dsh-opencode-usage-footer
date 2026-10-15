# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-15

First release.

### Added

- Composer-footer pill with one chip per OpenCode Go meter: `5h`, `7d`, `30d`,
  each with a mini bar, its share of the limit, and a reset countdown in the
  tooltip.
- Host half that resolves `OPENCODE_GO_API_KEY` from the harness credential
  store (environment first), reads `GET https://opencode.ai/zen/go/v1/usage`,
  caches it, and serves it same-origin on `GET /opencode-usage`.
- Idle-gated refresh: the background read stops entirely once no page has polled
  for two minutes.
- Typed failure states in the pill (`no key`, `key rejected`, `offline`,
  `timeout`, `api changed`) instead of a confident zero.
- Offline test suite: a host-half test against a stubbed upstream, and a
  jsdom + react-dom render test of the shipped bundle.
