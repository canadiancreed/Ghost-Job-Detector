"use strict";

const ORIGINS = browser.runtime.getManifest().host_permissions;
const Store = globalThis.GJStore;
const $ = (id) => document.getElementById(id);
const BOOLS = ["showCard", "toolbarBadge", "startCollapsed"];

async function loadSettings() {
  const s = await Store.getSettings();
  for (const k of BOOLS) $(k).checked = !!s[k];
  $("cardPlacement").value = s.cardPlacement;
  showWeights(s.weights);
}

// ---------------------------------------------------------------- scoring values
const Scoring = globalThis.GJScoring;
const inputs = {}; // key -> { param, input, row }

function fmtNum(v) {
  return String(Math.round(v * 10) / 10);
}

function buildParams() {
  const groups = new Map();
  for (const p of Scoring.PARAMS) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  const root = $("params");
  for (const [name, params] of groups) {
    const det = document.createElement("details");
    det.className = "group";
    const sum = document.createElement("summary");
    sum.append(name);
    const count = document.createElement("span");
    count.className = "count";
    sum.append(count);
    det.append(sum);
    for (const p of params) {
      const row = document.createElement("div");
      row.className = "param";
      const id = "w-" + p.key;
      const label = document.createElement("label");
      label.className = "name";
      label.htmlFor = id;
      label.style.display = "block";
      label.append(p.label);
      const def = document.createElement("span");
      def.className = "def";
      def.textContent = `Default ${fmtNum(p.def)}`;
      label.append(def);
      const input = document.createElement("input");
      input.type = "number";
      input.id = id;
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.required = true;
      const unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = p.unit;
      const reset = document.createElement("button");
      reset.className = "reset";
      reset.type = "button";
      reset.textContent = "Reset";
      reset.title = `Back to ${fmtNum(p.def)}`;
      reset.addEventListener("click", () => {
        input.value = fmtNum(p.def);
        saveWeights();
      });
      input.addEventListener("change", saveWeights);
      row.append(label, input, unit, reset);
      det.append(row);
      inputs[p.key] = { param: p, input, row, group: det, count };
    }
    root.append(det);
  }
}

function showWeights(saved) {
  const w = Scoring.weightsFrom(saved);
  for (const { param, input } of Object.values(inputs)) {
    if (document.activeElement !== input) input.value = fmtNum(w[param.key]);
  }
  markChanged();
  showBands(saved);
}

function markChanged() {
  const perGroup = new Map();
  let total = 0;
  for (const { param, input, row, count } of Object.values(inputs)) {
    const changed = input.value !== "" && Number(input.value) !== param.def;
    row.classList.toggle("changed", changed);
    if (!perGroup.has(count)) perGroup.set(count, 0);
    if (changed) {
      perGroup.set(count, perGroup.get(count) + 1);
      total++;
    }
  }
  for (const [count, n] of perGroup) count.textContent = n ? `${n} changed` : "";
  $("changedCount").textContent = total
    ? `${total} value${total === 1 ? "" : "s"} changed from the defaults.`
    : "All values are at their defaults.";
  $("resetWeights").disabled = total === 0;
}

function showBands(saved) {
  const ul = $("bands");
  ul.replaceChildren();
  Scoring.bandsFor(saved).forEach((b, i, arr) => {
    const li = document.createElement("li");
    const s = document.createElement("b");
    s.style.color = b.color;
    s.textContent = `${i === 0 ? 0 : arr[i - 1].max + 1}–${b.max}`;
    li.append(s, " " + b.label);
    ul.append(li);
  });
}

let weightsTimer;
async function saveWeights() {
  // Keep only valid values that differ from the defaults; weightsFrom() clamps the rest.
  const raw = {};
  for (const { param, input } of Object.values(inputs)) {
    if (input.value === "") continue;
    const v = Number(input.value);
    if (Number.isFinite(v) && v !== param.def) raw[param.key] = v;
  }
  const w = Scoring.weightsFrom(raw);
  const weights = {};
  for (const p of Scoring.PARAMS) if (w[p.key] !== p.def) weights[p.key] = w[p.key];
  await Store.setSettings({ weights });
  // Show what was actually saved (out-of-range values clamped, bands kept in order).
  for (const { param, input } of Object.values(inputs)) {
    const shown = fmtNum(w[param.key]);
    if (input.value !== shown) input.value = shown;
  }
  markChanged();
  showBands(weights);
  $("weightsSaved").textContent = "Saved. Open listings are re-scored.";
  clearTimeout(weightsTimer);
  weightsTimer = setTimeout(() => ($("weightsSaved").textContent = ""), 2000);
}

$("resetWeights").addEventListener("click", async () => {
  if (!confirm("Put every scoring value back to its default?")) return;
  for (const { param, input } of Object.values(inputs)) input.value = fmtNum(param.def);
  await saveWeights();
});

buildParams();

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
