window.__ModuleLoader__.load({
	id: "dsh-opencode-usage-footer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var jsxRuntime = require("react/jsx-runtime");
		var jsx = jsxRuntime.jsx;
		var jsxs = jsxRuntime.jsxs;

		/** Same-origin route the host half registers. */
		const ROUTE_PATH = "/opencode-usage";
		/** How often an open page re-reads the host snapshot. */
		const REFRESH_MS = 30000;

		/** Chip text: the window length, which is what a glance needs. */
		const METER_SHORT = { rolling: "5h", weekly: "7d", monthly: "30d" };
		/** Tooltip name: the console's word for the window, plus its length. */
		const METER_LABEL = { rolling: "Rolling 5h", weekly: "Weekly (7d)", monthly: "Monthly (30d)" };
		const ERROR_SHORT = {
			"no-key": "no key",
			unauthorized: "key rejected",
			timeout: "timeout",
			network: "offline",
			http: "http error",
			"bad-payload": "api changed",
			internal: "error"
		};

		// The composer footer is a plain horizontal row filled by pills; these
		// styles borrow its vocabulary (12px, tertiary label, tabular numerals)
		// and read the theme through the same alias tokens the shell publishes.
		const rootStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: "6px",
			color: "var(--dsw-alias-label-tertiary, #8a8a8e)",
			fontSize: "12px",
			lineHeight: "18px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};
		const brandStyle = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "none" };
		const chipStyle = { display: "inline-flex", alignItems: "center", gap: "5px", flex: "none" };
		const shortStyle = { color: "var(--dsw-alias-label-tertiary, #8a8a8e)" };
		const trackStyle = { display: "inline-block", width: "22px", height: "4px", borderRadius: "2px", background: "rgba(127,127,127,0.28)", overflow: "hidden", flex: "none" };
		const valueStyle = { color: "var(--dsw-alias-label-secondary, #6b6b70)", minWidth: "24px", textAlign: "right" };

		function fillStyle(percent) {
			const clamped = Math.min(100, Math.max(0, percent));
			const background = clamped >= 90 ? "#f85149" : clamped >= 70 ? "#d29922" : "#3fb950";
			return { display: "block", height: "100%", width: clamped + "%", borderRadius: "2px", background };
		}

		/** Resolve a meter's spoken name for the aria label and its tooltip. */
		function labelOf(meter) {
			return METER_LABEL[meter.key] !== void 0 ? METER_LABEL[meter.key] : meter.label !== void 0 ? meter.label : meter.short;
		}

		/** One decimal only when the server sent a fraction. */
		function formatPercent(percent) {
			return (Number.isInteger(percent) ? String(percent) : percent.toFixed(1)) + "%";
		}

		/** "3h 33m" / "3d 16h" / "12m" / null while the window has no reset. */
		function countdown(resetsAt, now) {
			if (typeof resetsAt !== "string") return null;
			const target = Date.parse(resetsAt);
			if (!Number.isFinite(target)) return null;
			const ms = target - now;
			if (ms <= 0) return "resets now";
			const minutes = Math.floor(ms / 60000);
			const days = Math.floor(minutes / (60 * 24));
			const hours = Math.floor((minutes % (60 * 24)) / 60);
			if (days > 0) return days + "d " + hours + "h";
			if (hours > 0) return hours + "h " + (minutes % 60) + "m";
			return (minutes % 60) + "m";
		}

		function formatAge(ageMs) {
			if (ageMs === null || ageMs === void 0) return null;
			const seconds = Math.max(0, Math.round(ageMs / 1000));
			if (seconds < 90) return seconds + "s ago";
			const minutes = Math.round(seconds / 60);
			if (minutes < 90) return minutes + "m ago";
			return Math.round(minutes / 60) + "h ago";
		}

		/** Poll the host snapshot, stopping while the tab is hidden. */
		function useUsageSnapshot() {
			const [state, setState] = react.useState({ payload: null, transportError: null });
			react.useEffect(() => {
				let live = true;
				let controller = null;
				const load = async () => {
					if (controller !== null) controller.abort();
					controller = new AbortController();
					try {
						const response = await fetch(ROUTE_PATH, {
							headers: { accept: "application/json" },
							cache: "no-store",
							signal: controller.signal
						});
						if (!response.ok) throw new Error("HTTP " + response.status);
						const payload = await response.json();
						if (live) setState({ payload, transportError: null });
					} catch (error) {
						if (!live || (error !== null && error !== void 0 && error.name === "AbortError")) return;
						const message = error instanceof Error ? error.message : String(error);
						setState((previous) => ({
							payload: previous.payload,
							transportError: message
						}));
					}
				};
				void load();
				const timer = window.setInterval(() => {
					if (document.visibilityState !== "hidden") void load();
				}, REFRESH_MS);
				const onVisibility = () => {
					if (document.visibilityState === "visible") void load();
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					live = false;
					if (controller !== null) controller.abort();
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);
			return state;
		}

		/** The pulse glyph that marks the readout; drawn inline, no icon dependency. */
		function PulseGlyph() {
			return jsx("svg", {
				width: 12,
				height: 12,
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				style: { flex: "none" },
				children: jsx("path", {
					d: "M1.5 8.5h3l2.2-5.4 3 10L12 8.5h2.5",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}

		/**
		 * OpenCode Go usage, live, in the composer footer: one compact chip per
		 * meter. Percentages only — the meter windows, reset countdowns and the
		 * update age live in the tooltips, so the row stays as quiet as the
		 * stats pills beside it.
		 */
		function OpenCodeUsagePill() {
			const state = useUsageSnapshot();
			const payload = state.payload;
			const meters = payload !== null && payload !== void 0 && Array.isArray(payload.meters) ? payload.meters : [];
			const hostError = payload !== null && payload !== void 0 ? payload.error : null;
			const now = Date.now();

			if (state.transportError !== null && payload === null) {
				return jsxs("div", {
					style: rootStyle,
					"data-opencode-usage": "error",
					role: "group",
					"aria-label": "OpenCode Go usage unavailable: " + state.transportError,
					title: "OpenCode Go usage unavailable: " + state.transportError,
					children: [jsx(PulseGlyph, {}), jsx("span", { children: "Go offline" })]
				});
			}

			if (meters.length === 0) {
				if (hostError === null) {
					return jsxs("div", {
						style: rootStyle,
						"data-opencode-usage": "loading",
						role: "group",
						"aria-label": "OpenCode Go usage loading",
						title: "OpenCode Go usage: loading",
						children: [jsx(PulseGlyph, {}), jsx("span", { children: "Go …" })]
					});
				}
				const short = ERROR_SHORT[hostError.code] !== void 0 ? ERROR_SHORT[hostError.code] : "error";
				return jsxs("div", {
					style: rootStyle,
					"data-opencode-usage": "error",
					role: "group",
					"aria-label": "OpenCode Go usage unavailable: " + hostError.message,
					title: "OpenCode Go: " + hostError.message,
					children: [jsx(PulseGlyph, {}), jsx("span", { children: "Go " + short })]
				});
			}

			const age = formatAge(payload !== null && payload !== void 0 ? payload.ageMs : null);
			const stale = payload !== null && payload !== void 0 && payload.stale === true;
			const tooltipParts = ["OpenCode Go usage"];
			if (age !== null) tooltipParts.push("updated " + age);
			if (stale && hostError !== null) tooltipParts.push("last refresh failed: " + hostError.message);
			const aria = meters.map((meter) => labelOf(meter) + " " + formatPercent(meter.percent)).join(", ");

			return jsxs("div", {
				style: rootStyle,
				"data-opencode-usage": stale ? "stale" : "ready",
				role: "group",
				"aria-label": "OpenCode Go usage: " + aria,
				title: tooltipParts.join(" · "),
				children: [
					jsxs("span", { style: brandStyle, children: [jsx(PulseGlyph, {}), jsx("span", { children: "Go" })] }),
					meters.map((meter) => {
						const reset = countdown(meter.resetsAt, now);
						const label = labelOf(meter);
						const chip = METER_SHORT[meter.key] !== void 0 ? METER_SHORT[meter.key] : meter.short;
						const title = label + " · " + formatPercent(meter.percent) + " of the limit" + (reset !== null ? " · resets in " + reset : "");
						return jsxs(
							"span",
							{
								style: chipStyle,
								title,
								"aria-label": title,
								children: [
									jsx("span", { style: shortStyle, children: chip }),
									jsx("span", { style: trackStyle, children: jsx("span", { style: fillStyle(meter.percent), "aria-hidden": true }) }),
									jsx("span", { style: valueStyle, children: formatPercent(meter.percent) })
								]
							},
							meter.key
						);
					})
				]
			});
		}

		/** Required services: the slot registry that carries the composer footer. */
		const inject = ["slots"];

		/**
		 * Client plugin body: register the readout into the composer's own footer
		 * slot, next to the context meter and the harness stats pills.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.composer.dock",
						id: "opencode-usage",
						order: 10
					},
					OpenCodeUsagePill
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

