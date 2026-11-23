"use strict";

const ORIGINS = browser.runtime.getManifest().host_permissions;
const Store = globalThis.GJStore;
const $ = (id) => document.getElementById(id);
const BOOLS = ["showCard", "toolbarBadge", "startCollapsed"];

async function loadSettings() {
  const s = await Store.getSettings();
  for (const k of BOOLS) $(k).checked = !!s[k];
  $("cardPlacement").value = s.cardPlacement;
}

let savedTimer;
async function save(patch) {
  await Store.setSettings(patch);
  $("saved").textContent = "Saved.";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

for (const k of BOOLS) $(k).addEventListener("change", (e) => save({ [k]: e.target.checked }));
$("cardPlacement").addEventListener("change", (e) => save({ cardPlacement: e.target.value }));

async function loadPerm() {
  const ok = await browser.permissions.contains({ origins: ORIGINS });
  $("perm").textContent = ok ? "Access to the supported job sites is granted." : "Access to the job sites hasn't been granted yet, so listings won't be scored.";
  $("grant").hidden = ok;
}
$("grant").addEventListener("click", async () => {
  await browser.permissions.request({ origins: ORIGINS });
  loadPerm();
});

async function loadStats() {
  const all = await browser.storage.local.get(null);
  const emps = Object.keys(all).filter((k) => k.startsWith("emp:"));
  const listings = emps.reduce((n, k) => n + (all[k].listings || []).length, 0);
  const reports = Object.values(all.reports || {});
  const flags = reports.filter((r) => r.flag).length;
  const outcomes = reports.filter((r) => r.outcome).length;
  $("stats").textContent = `${listings} listings from ${emps.length} employers in your history · ${flags} flags · ${outcomes} outcome reports.`;
}

$("export").addEventListener("click", async () => {
  const all = await browser.storage.local.get(null);
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ghost-job-detector-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Not a Ghost Job Detector export.");
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if ((k === "settings" || k === "reports" || k.startsWith("emp:")) && v && typeof v === "object") clean[k] = v;
    }
    if (!Object.keys(clean).length) throw new Error("No usable data in that file.");
    if (!confirm(`Import ${Object.keys(clean).length} records? Matching records will be replaced.`)) return;
    await browser.storage.local.set(clean);
    await Promise.all([loadSettings(), loadStats()]);
  } catch (err) {
    alert("Import failed: " + err.message);
  } finally {
    e.target.value = "";
  }
});

$("clearHistory").addEventListener("click", async () => {
  if (!confirm("Delete all employer history? Your flags and outcome reports are kept.")) return;
  const all = await browser.storage.local.get(null);
  await browser.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("emp:")));
  loadStats();
});

$("clearReports").addEventListener("click", async () => {
  if (!confirm("Delete all your flags, outcome reports and apply-click records? This can't be undone.")) return;
  await browser.storage.local.remove("reports");
  loadStats();
});

loadSettings();
loadPerm();
loadStats();
