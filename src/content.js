/* Content script entry point: watches the page, scores listings, renders UI,
 * and answers the toolbar popup.
 */
(async function () {
  "use strict";
  if (globalThis.__gjLoaded) return;
  globalThis.__gjLoaded = true;

  // Only one copy of this script may own the page. Firefox runs a fresh copy in
  // already-open tabs when the extension is reloaded or updated; the newest copy takes
  // over, clears any card a previous copy left behind, and older copies stand down.
  const INSTANCE = Math.random().toString(36).slice(2) + Date.now().toString(36);
  document.documentElement.setAttribute("data-gj-instance", INSTANCE);
  // Only stand down when a *newer copy* has written its own mark. React/Next.js sites
  // can rebuild <html> after loading and wipe the mark: then just put it back.
  const retired = () => {
    const html = document.documentElement;
    const mark = html && html.getAttribute("data-gj-instance");
    if (!mark) {
      if (html) html.setAttribute("data-gj-instance", INSTANCE);
      return false;
    }
    return mark !== INSTANCE;
  };
  const removeStrayCards = (keep) => {
    for (const n of document.querySelectorAll("gj-card[data-gj]")) if (n !== keep) n.remove();
  };
  removeStrayCards(null);

  const api = globalThis.browser;
  const { score: scoreListing } = globalThis.GJScoring;
  const Store = globalThis.GJStore;
  const UI = globalThis.GJUI;

  let settings = await Store.getSettings();
  let collapsed = settings.startCollapsed;
  const dismissed = new Set(); // floating cards closed by the user, per listing
  const cardCache = new Map(); // id -> preview listing from search results (fills gaps on the detail view)
  const recordedCards = new Set();

  let current = null; // { key, sig, listing, result, report, host }
  let lastToolbar = null;

  function pickExtractor() {
    for (const ex of Object.values(globalThis.GJExtractors || {})) {
      if (ex.matches(location)) return ex;
    }
    return null;
  }

  async function buildCtx(L, reportsCache, empCache) {
    const reports = reportsCache || (await Store.getReports());
    let history;
    const empKey = L.platform + "|" + L.company;
    if (empCache && empCache.has(empKey)) history = empCache.get(empKey);
    else {
      history = await Store.getEmployer(L.platform, L.company);
      if (empCache) empCache.set(empKey, history);
    }
    return {
      history,
      flags: Store.employerFlags(reports, L.company),
      report: reports[`${L.platform}:${L.id}`] || null,
      weights: settings.weights || null, // your changes to the scoring values, if any
    };
  }

  // ---------------------------------------------------------------- toolbar
  function setToolbar(result) {
    const payload = result && settings.toolbarBadge ? { type: "GJ_SCORE", score: result.score, color: result.band.color } : { type: "GJ_CLEAR" };
    const k = JSON.stringify(payload);
    if (k === lastToolbar) return;
    lastToolbar = k;
    api.runtime.sendMessage(payload).catch(() => {});
  }

  // ---------------------------------------------------------------- detail card
  function removeCard() {
    if (current && current.host) current.host.remove();
    current = null;
    setToolbar(null);
  }

  function placeCard(host, anchor) {
    const floating = settings.cardPlacement === "floating" || !anchor || !anchor.el || !anchor.el.isConnected;
    if (floating) {
      if (host.parentNode !== document.body) document.body.appendChild(host);
    } else {
      const ok = anchor.where === "afterend" ? anchor.el.nextElementSibling === host : anchor.el.previousElementSibling === host;
      if (!ok) anchor.el.insertAdjacentElement(anchor.where, host);
    }
    return floating;
  }

  function drawCard(anchor) {
    if (!current) return;
    const show = settings.showCard && !dismissed.has(current.key);
    if (!show) {
      if (current.host) current.host.remove();
      return;
    }
    const floating = settings.cardPlacement === "floating" || !anchor || !anchor.el || !anchor.el.isConnected;
    const rerender = () => drawCard(current.anchor);
    current.host = UI.renderCard(current.result, {
      host: current.host,
      floating,
      collapsed,
      report: current.report,
      rerender,
      onToggle: (c) => {
        collapsed = c;
        rerender();
      },
      onClose: () => {
        dismissed.add(current.key);
        current.host.remove();
      },
      onFlag: (reason) => saveReport({ flag: reason }),
      onOutcome: (outcome) => saveReport({ outcome }),
    });
    placeCard(current.host, anchor);
    removeStrayCards(current.host); // never more than one card on the page
  }

  async function saveReport(patch) {
    if (!current) return;
    await Store.saveReport(current.listing, patch);
    await rescoreCurrent();
  }

  async function rescoreCurrent() {
    if (!current) return;
    const ctx = await buildCtx(current.listing);
    if (current.history) ctx.history = current.history;
    current.result = scoreListing(current.listing, ctx);
    current.report = ctx.report;
    drawCard(current.anchor);
    setToolbar(current.result);
  }

  function signature(L) {
    return JSON.stringify([
      L.platform, L.id, L.title, L.company, L.location, L.ageDays && Math.round(L.ageDays), L.reposted,
      L.applicants, L.easyApply, L.externalApply, L.salaryListed, L.description ? L.description.length : -1,
      L.hiringContact, L.activelyReviewing, L.responsiveEmployer, L.employerActiveDays, L.companyRating, L.workplace, L.closed,
    ]);
  }

  // One score per listing. A listing is scored only once its details have stopped
  // changing (job sites fill the pane in stages), and that score is then kept for as
  // long as the listing stays open. Only your own flags and outcome reports change it.
  const SETTLE_MS = 1200; // details must be unchanged this long
  const WAIT_DESC_MS = 4000; // wait this long for a description to appear
  const MAX_WAIT_MS = 8000; // never wait longer than this
  const STALE_MS = 3000; // previous listing's content still showing under a new ID
  // Server-rendered one-listing-per-page sites: the page arrives complete, so score right away.
  const INSTANT_SITES = new Set(["Job Bank"]);
  let candidate = null; // { key, sig, since, first }
  let lastSeen = null; // { key, fp } content of the last listing read
  let staleFrom = null; // { key, t }
  let noIdSince = 0;

  function fingerprint(L) {
    return JSON.stringify([L.title, L.company, L.location, L.description ? L.description.slice(0, 300) : null]);
  }

  async function scanDetail(ex) {
    const id = ex.currentJobId();
    // A different listing is open: drop the old score immediately, never show it for the new one.
    // No listing at all: the pane may just be re-rendering, so give it a moment first.
    if (id === null) {
      if (!noIdSince) noIdSince = Date.now();
      if (current && Date.now() - noIdSince > 1500) removeCard();
      else if (current) schedule(500);
    } else {
      noIdSince = 0;
      if (current && current.listing.id !== id) removeCard();
    }
    if (candidate && candidate.id !== id) candidate = null;

    const d = ex.extractDetail();
    if (!d) return;
    const L = d.listing;
    if (L.id !== id) return;

    // Fill gaps from the search card we saw for this listing.
    const cached = cardCache.get(L.id);
    if (cached) {
      if (L.ageDays == null && cached.ageDays != null) {
        L.ageDays = cached.ageDays;
        L.ageApprox = cached.ageApprox;
      }
      if (L.salaryListed !== true && cached.salaryListed === true) {
        L.salaryListed = true;
        L.salaryText = cached.salaryText;
      }
      if (L.companyRating == null && cached.companyRating != null) L.companyRating = cached.companyRating;
      if (L.easyApply == null && cached.easyApply) {
        L.easyApply = true;
        L.externalApply = false;
      }
      if (!L.reposted && cached.reposted) L.reposted = true;
      if (L.employerActiveDays == null && cached.employerActiveDays != null) L.employerActiveDays = cached.employerActiveDays;
      if (L.responsiveEmployer == null && cached.responsiveEmployer) L.responsiveEmployer = true;
      if (L.urgentlyHiring == null && cached.urgentlyHiring) L.urgentlyHiring = true;
    }

    const key = `${L.platform}:${L.id}`;

    // Already scored: keep that score; just make sure the card is still on the page.
    if (current && current.key === key) {
      current.anchor = d.anchor;
      if (settings.showCard && !dismissed.has(key) && (!current.host || !current.host.isConnected)) drawCard(d.anchor);
      else if (current.host && current.host.isConnected) placeCard(current.host, d.anchor);
      return;
    }

    const now = Date.now();

    // Two-pane sites update the URL before the pane: if the pane still shows the
    // previous listing's content, wait for the new one.
    const fp = fingerprint(L);
    if (lastSeen && lastSeen.key !== key && lastSeen.fp === fp) {
      if (!staleFrom || staleFrom.key !== key) staleFrom = { key, t: now };
      if (now - staleFrom.t < STALE_MS) {
        schedule(400);
        return;
      }
    }
    staleFrom = null;
    lastSeen = { key, fp };

    const sig = signature(L);
    if (!candidate || candidate.key !== key) {
      candidate = { key, id: L.id, sig, since: now, first: now };
      if (!INSTANT_SITES.has(ex.name)) {
        schedule(400);
        return;
      }
    }
    if (candidate.sig !== sig) {
      candidate.sig = sig;
      candidate.since = now;
    }
    const waited = now - candidate.first;
    const steady = now - candidate.since >= SETTLE_MS;
    const ready = (steady && (L.description || waited >= WAIT_DESC_MS)) || waited >= MAX_WAIT_MS || INSTANT_SITES.has(ex.name);
    if (!ready) {
      schedule(400);
      return;
    }

    candidate = null;
    const ctx = await buildCtx(L);
    if (ex.currentJobId() !== L.id) return; // user moved on while we were scoring
    const result = scoreListing(L, ctx);
    // Keep the employer history used here so later re-scores (after your own reports)
    // change only because of the report.
    current = { key, listing: L, result, report: ctx.report, history: ctx.history, host: null, anchor: d.anchor };
    drawCard(d.anchor);
    setToolbar(result);
    Store.recordListing(L, result.score).catch(() => {});
  }

  // ---------------------------------------------------------------- search results
  // Nothing is drawn in the results list (only the listing itself gets a score).
  // The list cards are still read: they supply details the detail view sometimes
  // hides (e.g. Indeed's posting age) and record sightings for repost detection.
  function scanCards(ex) {
    for (const c of ex.findCards()) {
      const L = c.listing;
      cardCache.set(c.id, L);
      if (L.company && !recordedCards.has(c.id)) {
        recordedCards.add(c.id);
        Store.recordListing(L, null).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- apply clicks
  document.addEventListener(
    "click",
    (e) => {
      if (!current) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const btn = t.closest(".jobs-apply-button, .jobs-s-apply button, #indeedApplyButton, .ia-IndeedApplyButton, #applyButtonLinkContainer a, #applyButtonLinkContainer button");
      if (!btn) return;
      if (current.report && current.report.appliedAt) return;
      Store.saveReport(current.listing, { appliedAt: Date.now() }).then(rescoreCurrent).catch(() => {});
    },
    true
  );

  // ---------------------------------------------------------------- scan loop
  let scanning = false;
  let pending = false;
  function standDown() {
    observer.disconnect();
    clearInterval(hrefPoll);
    clearTimeout(timer);
    if (current && current.host) current.host.remove();
    current = null;
    candidate = null;
  }

  async function scan() {
    if (retired()) {
      standDown();
      return;
    }
    if (scanning) {
      pending = true;
      return;
    }
    scanning = true;
    try {
      const ex = pickExtractor();
      if (!ex) {
        removeCard();
        return;
      }
      scanCards(ex);
      await scanDetail(ex);
    } catch (err) {
      console.debug("[Ghost Job Detector]", err);
    } finally {
      scanning = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  // Debounced, but a page that never stops changing still gets scanned at least every ~1.5s.
  let timer = null;
  let firstRequest = 0;
  function schedule(delay = 500) {
    const now = Date.now();
    if (!timer) firstRequest = now;
    else if (now - firstRequest > 1500) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, delay);
  }

  // The moment a different listing is open, take the old score down, without
  // waiting for the debounced scan.
  function checkSwitch() {
    if (!current) return;
    const ex = pickExtractor();
    let id = null;
    try {
      id = ex ? ex.currentJobId() : null;
    } catch (_) {}
    if (id !== null && id !== current.listing.id) removeCard();
  }

  const observer = new MutationObserver(() => {
    if (retired()) return standDown();
    checkSwitch();
    schedule();
  });
  observer.observe(document, { childList: true, subtree: true }); // document, not <html>: survives <html> being replaced

  // Clicking a job in a list changes the URL without reloading; react right away.
  document.addEventListener("click", () => setTimeout(() => {
    if (retired()) return;
    checkSwitch();
    schedule(300);
  }, 50), true);

  let lastHref = location.href;
  const hrefPoll = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      checkSwitch();
      schedule(300);
    }
  }, 250);

  api.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || retired()) return;
    if (changes.settings) {
      const oldWeights = JSON.stringify(settings.weights || {});
      settings = Object.assign({}, Store.DEFAULT_SETTINGS, changes.settings.newValue || {});
      if (current) {
        // Redraw with the new settings. The score changes only if you changed the scoring values.
        if (current.host) current.host.remove();
        current.host = null;
      }
      lastToolbar = null;
      if (current && JSON.stringify(settings.weights || {}) !== oldWeights) await rescoreCurrent();
      schedule(50);
    } else if (changes.reports && current) {
      rescoreCurrent();
    }
  });

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object" || retired()) return undefined;
    if (msg.type === "GJ_GET_STATE") {
      const ex = pickExtractor();
      return Promise.resolve({
        site: ex ? ex.name : null,
        listing: current
          ? { title: current.listing.title, company: current.listing.company, platform: current.listing.platform, id: current.listing.id }
          : null,
        result: current ? current.result : null,
        report: current ? current.report : null,
        pending: !current && !!candidate,
      });
    }
    if (msg.type === "GJ_DEBUG") {
      const ex = pickExtractor();
      let fresh = null;
      try {
        const d = ex && ex.extractDetail();
        if (d) {
          const L = d.listing;
          fresh = Object.assign({}, L, { description: L.description ? `${L.description.length} chars: ${L.description.slice(0, 160)}…` : null });
        }
      } catch (err) {
        fresh = { error: String(err) };
      }
      return Promise.resolve({
        version: api.runtime.getManifest().version,
        site: ex ? ex.name : null,
        path: location.pathname,
        jobId: ex ? ex.currentJobId() : null,
        extracted: fresh,
        score: current ? current.result.score : null,
        unknowns: current ? current.result.unknowns : null,
        status: {
          cardOnPage: !!(current && current.host && current.host.isConnected),
          waitingToScore: candidate ? Math.round((Date.now() - candidate.first) / 100) / 10 + "s" : null,
          staleWait: !!staleFrom,
          cardsOnPage: document.querySelectorAll("gj-card[data-gj]").length,
        },
        details: ex && ex.debug ? ex.debug() : null,
      });
    }
    if (msg.type === "GJ_RESCAN") {
      // Explicit request: read the listing again from scratch.
      removeCard();
      candidate = null;
      lastSeen = null;
      dismissed.clear();
      return scan().then(() => ({ ok: true }));
    }
    if (msg.type === "GJ_REPORT" && current) {
      return saveReport(msg.patch || {}).then(() => ({ ok: true }));
    }
    return undefined;
  });

  schedule(200);
  Store.prune().catch(() => {});
})();
