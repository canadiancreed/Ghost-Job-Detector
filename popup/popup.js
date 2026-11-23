"use strict";

const ORIGINS = browser.runtime.getManifest().host_permissions;
const SITES = "LinkedIn, Indeed, Monster or Job Bank";
const main = document.getElementById("main");

document.getElementById("opts").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function show(...nodes) {
  main.replaceChildren(...nodes);
}

function legend() {
  return h(
    "div",
    { class: "legend" },
    globalThis.GJScoring.BANDS.flatMap((b, i, arr) => [
      h("b", { style: `color:${b.color}` }, `${i === 0 ? 0 : arr[i - 1].max + 1}–${b.max}`),
      h("span", null, b.label),
    ])
  );
}

async function render() {
  const granted = await browser.permissions.contains({ origins: ORIGINS });
  if (!granted) {
    show(
      h("p", null, "Ghost Job Detector needs access to the supported job sites (" + SITES + ") to read job listings."),
      h("div", { class: "row" },
        h("button", {
          class: "primary",
          onclick: async () => {
            const ok = await browser.permissions.request({ origins: ORIGINS });
            if (ok) show(h("p", null, "Access granted. Reload any open job-site tabs."));
          },
        }, "Grant access")
      )
    );
    return;
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let state = null;
  try {
    state = await browser.tabs.sendMessage(tab.id, { type: "GJ_GET_STATE" });
  } catch (_) {
    state = null;
  }

  if (!state && (await siteAccess(tab)).supported) {
    // A supported job site, but the page script didn't answer.
    const access = await siteAccess(tab);
    show(
      h("p", null, h("b", null, "Ghost Job Detector isn't running on this page.")),
      access.granted
        ? h("p", null, "Reload this tab (F5). Pages that were already open before the extension was installed or reloaded don't have it yet.")
        : h("p", null, `Firefox hasn't given it access to ${access.host}. Click below, or use the Extensions button (puzzle piece) in the toolbar and allow Ghost Job Detector on this site, then reload the tab.`),
      access.granted ? null : h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => { if (await browser.permissions.request({ origins: [access.pattern] })) show(h("p", null, "Access granted. Reload this tab (F5).")); } }, "Allow on this site")),
      h("p", { class: "muted" }, "Still stuck? Click Copy diagnostics below and send the result.")
    );
    return;
  }

  if (!state || !state.site) {
    show(
      h("p", null, "Open a job listing on " + SITES + " to see its ghost-risk score."),
      h("p", { class: "muted" }, "The score appears on the listing itself and on the toolbar button."),
      legend()
    );
    return;
  }

  if (!state.result && state.pending) {
    // The listing is still loading; the score is shown once its details stop changing.
    show(h("p", null, `Reading this ${state.site} listing…`), legend());
    setTimeout(render, 700);
    return;
  }

  if (!state.result) {
    show(
      h("p", null, `On ${state.site}. Select a job to score it.`),
      h("div", { class: "row" }, h("button", { onclick: rescan }, "Rescan page")),
      legend()
    );
    return;
  }

  const r = state.result;
  const fmt = (p) => (p > 0 ? `+${p}` : p < 0 ? `${p}` : "·");
  show(
    h("div", { class: "job" }, h("div", { class: "t" }, state.listing.title), h("div", { class: "c" }, `${state.listing.company} · ${state.site}`)),
    h("div", { class: "head", style: `--band:${r.band.color}` },
      h("div", { class: "score" }, String(r.score)),
      h("div", null, h("div", { class: "muted" }, "Ghost Risk"), h("div", { class: "band" }, r.band.label))
    ),
    h("div", { class: "meter" }, h("i", { style: `left:${r.score}%` })),
    h("ul", null, r.signals.map((s) =>
      h("li", null, h("div", { class: `pts ${s.tone}` }, fmt(s.points)), h("div", { class: "sig" }, h("b", null, s.label), s.detail ? h("span", null, " — " + s.detail) : null))
    )),
    r.unknowns.length ? h("div", { class: "unknown" }, "Not shown on page (not counted): " + r.unknowns.join(", ") + ".") : null,
    h("div", { class: "row" },
      h("button", { onclick: rescan }, "Rescan"),
      h("button", { onclick: () => report({ flag: state.report && state.report.flag ? null : "other" }) }, state.report && state.report.flag ? "Remove flag" : "🚩 Flag ghost job")
    ),
    legend()
  );

  async function report(patch) {
    await browser.tabs.sendMessage(tab.id, { type: "GJ_REPORT", patch }).catch(() => {});
    render();
  }

  async function rescan() {
    await browser.tabs.sendMessage(tab.id, { type: "GJ_RESCAN" }).catch(() => {});
    render();
  }
}

/** Is the tab on a supported job site, and does Firefox let the extension run there? */
async function siteAccess(tab) {
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch (_) {}
  const pattern = ORIGINS.find((p) => {
    const base = p.replace(/^\*:\/\/\*\./, "").replace(/\/\*$/, "");
    return host === base || host.endsWith("." + base);
  });
  let granted = null;
  if (pattern) {
    try {
      granted = await browser.permissions.contains({ origins: [pattern] });
    } catch (_) {}
  }
  return { host, pattern: pattern || null, supported: !!pattern, granted };
}

async function rescan() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  await browser.tabs.sendMessage(tab.id, { type: "GJ_RESCAN" }).catch(() => {});
  render();
}

// Diagnostics: collects what the extension sees on the current page so it can be shared.
document.getElementById("diag").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let info;
  try {
    info = await browser.tabs.sendMessage(tab.id, { type: "GJ_DEBUG" });
  } catch (err) {
    info = { error: "The extension isn't running on this page: " + err.message };
  }
  // What Firefox reports about this tab and the extension's site access.
  const access = await siteAccess(tab);
  let allGranted = null;
  try {
    allGranted = (await browser.permissions.getAll()).origins;
  } catch (_) {}
  info = Object.assign({ popup: { version: browser.runtime.getManifest().version, tabHost: access.host || "(hidden)", supportedSite: access.supported, accessToThisSite: access.granted, grantedSites: allGranted, firefox: navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || navigator.userAgent } }, info || {});
  const json = JSON.stringify(info, null, 2);
  let copied = false;
  try {
    await navigator.clipboard.writeText(json);
    copied = true;
  } catch (_) {}
  const ta = h("textarea", { class: "diag", readonly: "readonly", rows: "12" });
  ta.value = json;
  main.append(h("p", { class: "muted" }, copied ? "Diagnostics copied to the clipboard." : "Select all and copy:"), ta);
  ta.focus();
  ta.select();
});

render().catch((err) => show(h("p", null, "Something went wrong: " + err.message)));
