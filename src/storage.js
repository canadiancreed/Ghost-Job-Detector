/* Local persistence: settings, employer history, and your own reports.
 * Nothing leaves the browser. Exposes globalThis.GJStore.
 */
(function () {
  "use strict";

  const api = globalThis.browser;
  const MAX_LISTINGS_PER_EMPLOYER = 60;
  const MAX_EMPLOYERS = 3000;

  const DEFAULT_SETTINGS = {
    showCard: true,
    toolbarBadge: true,
    cardPlacement: "inline", // "inline" | "floating"
    startCollapsed: false,
    weights: {}, // scoring values you've changed: { key: value } (see GJScoring.PARAMS)
  };

  // Storage layout (browser.storage.local):
  //   settings: {...}
  //   emp:<platform>:<employerKey> : { name, updated, listings: [{id, platform, title, normTitle, normLoc, score, firstSeen, lastSeen}] }
  //   reports : { "<platform>:<id>": { employer, employerKey, title, flag?: reason, outcome?: key, ts } }

  async function getSettings() {
    const { settings } = await api.storage.local.get("settings");
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }

  async function setSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign(cur, patch);
    await api.storage.local.set({ settings: next });
    return next;
  }

  function empStorageKey(platform, company) {
    const k = globalThis.GJScoring.employerKey(company);
    return k ? `emp:${platform}:${k}` : null;
  }

  async function getEmployer(platform, company) {
    const key = empStorageKey(platform, company);
    if (!key) return null;
    const res = await api.storage.local.get(key);
    return res[key] || { name: company, listings: [] };
  }

  // Serialize read-modify-write operations so concurrent calls don't clobber each other.
  let chain = Promise.resolve();
  function serial(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  /** Record (or update) a listing under its employer. `score` may be null for search-card sightings. */
  function recordListing(L, score) {
    return serial(() => recordListingNow(L, score));
  }

  async function recordListingNow(L, score) {
    const key = empStorageKey(L.platform, L.company);
    if (!key || !L.id) return;
    const res = await api.storage.local.get(key);
    const emp = res[key] || { name: L.company, listings: [] };
    const now = Date.now();
    const N = globalThis.GJScoring.normalize;
    let entry = emp.listings.find((x) => x.id === L.id);
    if (!entry) {
      entry = { id: L.id, platform: L.platform, firstSeen: now };
      emp.listings.push(entry);
    }
    if (L.title) {
      entry.title = L.title;
      entry.normTitle = N(L.title);
    }
    if (L.location) entry.normLoc = N(L.location);
    if (typeof score === "number") entry.score = score;
    entry.lastSeen = now;
    emp.name = L.company;
    emp.updated = now;
    if (emp.listings.length > MAX_LISTINGS_PER_EMPLOYER) {
      emp.listings.sort((a, b) => b.lastSeen - a.lastSeen);
      emp.listings.length = MAX_LISTINGS_PER_EMPLOYER;
    }
    await api.storage.local.set({ [key]: emp });
  }

  async function getReports() {
    const { reports } = await api.storage.local.get("reports");
    return reports || {};
  }

  function saveReport(L, patch) {
    return serial(() => saveReportNow(L, patch));
  }

  async function saveReportNow(L, patch) {
    const reports = await getReports();
    const k = `${L.platform}:${L.id}`;
    const cur = reports[k] || {};
    reports[k] = Object.assign(cur, {
      employer: L.company,
      employerKey: globalThis.GJScoring.employerKey(L.company),
      platform: L.platform,
      title: L.title,
      url: L.url,
      ts: Date.now(),
    }, patch);
    if (!reports[k].flag && !reports[k].outcome && !reports[k].appliedAt) delete reports[k];
    await api.storage.local.set({ reports });
    return reports[k] || null;
  }

  const POSITIVE_OUTCOMES = new Set(["interview", "offer"]);
  const NO_RESPONSE_OUTCOMES = new Set(["no_response", "ghosted_after_interview"]);

  /** Tally your reports for one employer (across platforms). */
  function employerFlags(reports, company) {
    const key = globalThis.GJScoring.employerKey(company);
    const out = { ghost: 0, noResponse: 0, positive: 0 };
    if (!key) return out;
    for (const r of Object.values(reports)) {
      if (r.employerKey !== key) continue;
      if (r.flag) out.ghost++;
      if (NO_RESPONSE_OUTCOMES.has(r.outcome)) out.noResponse++;
      if (POSITIVE_OUTCOMES.has(r.outcome)) out.positive++;
    }
    return out;
  }

  /** Keep the number of employer records bounded. */
  async function prune() {
    const all = await api.storage.local.get(null);
    const emps = Object.keys(all).filter((k) => k.startsWith("emp:"));
    if (emps.length <= MAX_EMPLOYERS) return;
    emps.sort((a, b) => (all[a].updated || 0) - (all[b].updated || 0));
    await api.storage.local.remove(emps.slice(0, emps.length - MAX_EMPLOYERS));
  }

  globalThis.GJStore = {
    DEFAULT_SETTINGS,
    getSettings,
    setSettings,
    getEmployer,
    recordListing,
    getReports,
    saveReport,
    employerFlags,
    prune,
  };
})();
