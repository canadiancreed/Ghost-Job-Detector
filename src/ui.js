/* In-page UI: the Ghost Risk card and the search-result badges.
 * Everything renders inside shadow roots so site CSS can't break it (and vice versa).
 * Exposes globalThis.GJUI.
 */
(function () {
  "use strict";

  const FLAG_REASONS = [
    ["reposted", "Constantly reposted"],
    ["filled", "Seems already filled"],
    ["vague", "No real details"],
    ["scam", "Fake or scam"],
    ["other", "Other"],
  ];
  const OUTCOMES = [
    ["no_response", "Never heard back"],
    ["rejected", "Auto-rejected"],
    ["ghosted_after_interview", "Ghosted after interview"],
    ["interview", "Got an interview"],
    ["offer", "Got an offer"],
  ];
  const LABEL = Object.fromEntries(FLAG_REASONS.concat(OUTCOMES));

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .card {
      --bg: #ffffff; --fg: #1d2226; --muted: #5e6b74; --line: #e3e6e8; --chip: #f3f5f6; --chip-hover: #e7ebee;
      --good: #1f9d55; --bad: #c53030;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-left: 6px solid var(--band);
      border-radius: 10px; padding: 12px 14px; margin: 12px 0; box-shadow: 0 1px 3px rgba(0,0,0,.08);
      max-width: 760px;
    }
    @media (prefers-color-scheme: dark) {
      .card { --bg: #1f2428; --fg: #e8eaed; --muted: #9aa5ad; --line: #3a4148; --chip: #2b3237; --chip-hover: #353d43; --good: #48bb78; --bad: #fc8181; }
    }
    .card.floating { position: fixed; right: 16px; bottom: 16px; width: 360px; max-width: calc(100vw - 32px); max-height: 70vh; overflow: auto; z-index: 2147483000; margin: 0; box-shadow: 0 8px 28px rgba(0,0,0,.25); }
    .head { display: flex; align-items: center; gap: 12px; }
    .score { font-size: 30px; font-weight: 800; color: var(--band); min-width: 48px; text-align: center; line-height: 1; }
    .titles { flex: 1; min-width: 0; }
    .eyebrow { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    .band { font-size: 15px; font-weight: 700; color: var(--band); }
    .iconbtn { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 16px; padding: 4px 6px; border-radius: 6px; }
    .iconbtn:hover { background: var(--chip); color: var(--fg); }
    .meter { position: relative; height: 6px; border-radius: 3px; margin: 10px 0 4px;
      background: linear-gradient(90deg, #1f9d55 0 35%, #d69e2e 35% 55%, #dd6b20 55% 75%, #c53030 75% 100%); opacity: .9; }
    .meter i { position: absolute; top: -3px; width: 4px; height: 12px; border-radius: 2px; background: var(--fg); transform: translateX(-2px); }
    ul { list-style: none; margin: 10px 0 0; padding: 0; }
    li { display: flex; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; }
    .pts { flex: 0 0 38px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
    .pts.bad { color: var(--bad); } .pts.good { color: var(--good); } .pts.neutral { color: var(--muted); }
    .sig b { font-weight: 600; } .sig span { color: var(--muted); }
    .more { margin-top: 4px; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 2px 0; font: inherit; text-decoration: underline; }
    .unknown { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button.btn { font: inherit; font-weight: 600; border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 16px; padding: 5px 12px; cursor: pointer; }
    button.btn:hover { background: var(--chip-hover); }
    button.btn.on { border-color: var(--band); color: var(--band); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .chips button { font: inherit; font-size: 12px; border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 14px; padding: 3px 10px; cursor: pointer; }
    .chips button:hover { background: var(--chip); }
    .chips button.sel { background: var(--band); border-color: var(--band); color: #fff; }
    .mine { margin-top: 8px; font-size: 12px; color: var(--muted); }
    .foot { margin-top: 10px; font-size: 11px; color: var(--muted); }
    .collapsed ul, .collapsed .unknown, .collapsed .actions, .collapsed .chips, .collapsed .mine, .collapsed .foot, .collapsed .more { display: none; }
  `;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function makeHost(tagName) {
    const host = document.createElement(tagName);
    host.setAttribute("data-gj", "1");
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", null, CSS));
    return { host, root };
  }

  function daysAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 86400000);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
  }

  function fmtPts(p) {
    return p > 0 ? `+${p}` : p < 0 ? `${p}` : "·";
  }

  /**
   * Create or update the detail card.
   * opts: { host?, floating, collapsed, report, onFlag(reason|null), onOutcome(key|null), onToggle(collapsed), onClose() }
   */
  function renderCard(result, opts) {
    let host = opts.host;
    let root;
    if (!host) {
      ({ host, root } = makeHost("gj-card"));
    } else {
      root = host.shadowRoot;
      while (root.childNodes.length > 1) root.lastChild.remove();
    }
    const state = (host._gjState = host._gjState || { panel: null, showAll: false });
    const report = opts.report || {};
    const band = result.band;
    const shown = state.showAll ? result.signals : result.signals.slice(0, 6);

    const card = h(
      "div",
      { class: `card${opts.floating ? " floating" : ""}${opts.collapsed ? " collapsed" : ""}`, style: `--band:${band.color}` },
      h(
        "div",
        { class: "head" },
        h("div", { class: "score", title: "Ghost-risk score (0–100)" }, String(result.score)),
        h("div", { class: "titles" }, h("div", { class: "eyebrow" }, "👻 Ghost Risk"), h("div", { class: "band" }, band.label)),
        h("button", { class: "iconbtn", title: opts.collapsed ? "Expand" : "Collapse", onclick: () => opts.onToggle(!opts.collapsed) }, opts.collapsed ? "▾" : "▴"),
        opts.floating ? h("button", { class: "iconbtn", title: "Hide for this listing", onclick: () => opts.onClose() }, "✕") : null
      ),
      h("div", { class: "meter" }, h("i", { style: `left:${result.score}%` })),
      h(
        "ul",
        null,
        shown.map((s) =>
          h("li", null, h("div", { class: `pts ${s.tone}` }, fmtPts(s.points)), h("div", { class: "sig" }, h("b", null, s.label), s.detail ? h("span", null, " — " + s.detail) : null))
        )
      ),
      result.signals.length > 6
        ? h("button", { class: "more", onclick: () => { state.showAll = !state.showAll; opts.rerender(); } }, state.showAll ? "Show fewer" : `Show all ${result.signals.length} signals`)
        : null,
      result.unknowns.length ? h("div", { class: "unknown" }, "Not shown on page (not counted): " + result.unknowns.join(", ") + ".") : null,
      h(
        "div",
        { class: "actions" },
        h("button", { class: `btn${report.flag ? " on" : ""}`, onclick: () => { state.panel = state.panel === "flag" ? null : "flag"; opts.rerender(); } }, report.flag ? "🚩 Flagged" : "🚩 Flag Ghost Job"),
        h("button", { class: `btn${report.outcome ? " on" : ""}`, onclick: () => { state.panel = state.panel === "outcome" ? null : "outcome"; opts.rerender(); } }, report.outcome ? "📝 Outcome saved" : "📝 Report Outcome")
      ),
      state.panel === "flag"
        ? h(
            "div",
            { class: "chips" },
            FLAG_REASONS.map(([k, label]) =>
              h("button", { class: report.flag === k ? "sel" : null, onclick: () => { state.panel = null; opts.onFlag(report.flag === k ? null : k); } }, label)
            )
          )
        : null,
      state.panel === "outcome"
        ? h(
            "div",
            { class: "chips" },
            OUTCOMES.map(([k, label]) =>
              h("button", { class: report.outcome === k ? "sel" : null, onclick: () => { state.panel = null; opts.onOutcome(report.outcome === k ? null : k); } }, label)
            )
          )
        : null,
      report.flag || report.outcome
        ? h("div", { class: "mine" }, "Your report: " + [report.flag && `flagged (${LABEL[report.flag]})`, report.outcome && LABEL[report.outcome]].filter(Boolean).join(" · ") + ". Click a choice again to undo.")
        : null,
      report.appliedAt && !report.outcome
        ? h("div", { class: "mine" }, `You clicked Apply ${daysAgo(report.appliedAt)}. Heard back? Use “Report Outcome”.`)
        : null,
      h("div", { class: "foot" }, "An estimate from what's on the page, not a verdict. Reports are stored only in this browser.")
    );
    root.append(card);
    return host;
  }

  globalThis.GJUI = { renderCard, FLAG_REASONS, OUTCOMES };
})();
