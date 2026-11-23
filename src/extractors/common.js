/* Shared DOM/text helpers for site extractors. Exposes globalThis.GJX. */
(function () {
  "use strict";

  /** First element matching any selector in the list. */
  function q(root, selectors) {
    if (!root) return null;
    for (const s of selectors) {
      try {
        const el = root.querySelector(s);
        if (el) return el;
      } catch (_) {
        /* invalid selector in this engine; skip */
      }
    }
    return null;
  }

  function qa(root, selectors) {
    const out = [];
    if (!root) return out;
    for (const s of selectors) {
      try {
        root.querySelectorAll(s).forEach((el) => out.push(el));
      } catch (_) {}
    }
    return out;
  }

  function text(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** Visible text with line breaks preserved (better for descriptions). */
  function blockText(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  const UNIT_DAYS = { minute: 1 / 1440, min: 1 / 1440, hour: 1 / 24, hr: 1 / 24, day: 1, week: 7, wk: 7, month: 30, mo: 30, year: 365, yr: 365 };

  /**
   * Parse posting age from text like "Reposted 3 weeks ago", "2 days ago",
   * "Posted 30+ days ago", "Just posted", "Today", "Active 5 days ago".
   * Returns { days, approx, reposted } or null.
   */
  function parseAge(str) {
    if (!str) return null;
    const s = String(str).toLowerCase();
    const reposted = /\breposted\b/.test(s);
    if (/\b(just posted|just now|today|moments ago)\b/.test(s)) return { days: 0, approx: false, reposted };
    if (/\byesterday\b/.test(s)) return { days: 1, approx: false, reposted };
    const m = s.match(/(\d+)\s*(\+)?\s*(minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\b\s*ago/);
    if (m) {
      const n = parseInt(m[1], 10);
      return { days: n * (UNIT_DAYS[m[3]] || 1), approx: !!m[2], reposted };
    }
    return reposted ? { days: null, approx: false, reposted } : null;
  }

  /** "Over 100 applicants", "47 applicants", "200+ applicants", "Be among the first 25 applicants" */
  function parseApplicants(str) {
    if (!str) return null;
    const s = String(str).toLowerCase();
    let m = s.match(/be among the first (\d+) applicants/);
    if (m) return { count: Math.max(0, parseInt(m[1], 10) - 1), text: `Fewer than ${m[1]} applicants` };
    m = s.match(/over ([\d,]+) (applicants|people clicked apply)/);
    if (m) return { count: parseInt(m[1].replace(/,/g, ""), 10), text: `Over ${m[1]} applicants` };
    m = s.match(/([\d,]+)\+? (applicants|people clicked apply)/);
    if (m) return { count: parseInt(m[1].replace(/,/g, ""), 10), text: `${m[1]} applicants` };
    return null;
  }

  const SALARY_RE =
    /((?:[$£€]|\bUSD\s?)\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|—|to)\s*(?:[$£€]|USD\s?)?\s?\d[\d,.]*\s?[kK]?)?\s*(?:\/|per|an?|\s)\s*(?:yr|year|hr|hour|annum|month|mo|week|wk)\b)|((?:[$£€])\s?\d{2,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*(?:[$£€])\s?\d{2,3}(?:,\d{3})+)?)|((?:[$£€])\s?\d{2,3}\s?[kK]\s*(?:-|–|—|to)\s*(?:[$£€])?\s?\d{2,3}\s?[kK])/;

  function findSalary(str) {
    if (!str) return null;
    const m = String(str).match(SALARY_RE);
    return m ? m[0].trim() : null;
  }

  function detectWorkplace(str) {
    if (!str) return null;
    const s = String(str);
    // No trailing \b: LinkedIn often renders adjacent pills with no space ("RemoteFull-time").
    if (/\bhybrid/i.test(s)) return "hybrid";
    if (/\bremote/i.test(s)) return "remote";
    if (/\b(on-site|onsite|on site|in-person|in person)/i.test(s)) return "onsite";
    return null;
  }

  function parseRating(str) {
    if (!str) return null;
    const m = String(str).match(/(\d(?:\.\d)?)\s*(?:out of 5|\/\s*5|stars?)/i) || String(str).match(/^\s*(\d\.\d)\b/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return v >= 0 && v <= 5 ? v : null;
  }

  const DESC_HEADING_RE = /^(about the job|about this job|about the role|job description|full job description|description|job details|role description|job summary|the role|overview)\s*:?$/i;
  const SHOW_MORE_RE = /\s*(…|\.\.\.)?\s*(see|show) (more|less)\s*$/i;

  /**
   * Find the job description. Tries the known selectors first; if none match (or the
   * match is nearly empty), looks for a heading such as "About the job" by its text
   * and climbs to the nearest ancestor that holds a real block of text. Class names
   * don't matter for the fallback, so it survives obfuscated/hashed markup.
   * Returns { el, text, source } or null.
   */
  function findDescription(root, selectors) {
    root = root || document.body;
    const bySel = q(root, selectors);
    const selText = blockText(bySel);
    if (bySel && selText.length >= 100) return { el: bySel, text: selText, source: "selector" };

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.length > 60) return NodeFilter.FILTER_REJECT;
        return DESC_HEADING_RE.test(v.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let best = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const head = n.parentElement;
      if (!head || head.closest("[data-gj], nav, header, footer, [role='navigation']")) continue;
      const headText = n.nodeValue.trim();
      let node = head;
      for (let i = 0; i < 7 && node.parentElement && node !== root; i++) {
        node = node.parentElement;
        const txt = blockText(node);
        if (txt.length >= headText.length + 150) {
          const body = txt.replace(new RegExp("^[\\s\\S]{0,40}?" + headText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:?\\s*", "i"), "").replace(SHOW_MORE_RE, "").trim();
          // Prefer "About the job" style headings over generic ones like "Overview".
          const rank = /about the job|job description|full job description/i.test(headText) ? 0 : 1;
          if (!best || rank < best.rank) best = { el: node, text: body, source: "heading:" + headText, rank };
          break;
        }
      }
      if (best && best.rank === 0) break;
    }
    if (best) return { el: best.el, text: best.text, source: best.source };
    if (bySel && selText.length >= 30) return { el: bySel, text: selText, source: "selector" };
    return null;
  }

  /** Short description of an element for diagnostics (no text content). */
  function describe(el) {
    if (!el) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += "." + cls.join(".");
    const tid = el.getAttribute("data-testid") || el.getAttribute("data-view-name");
    if (tid) s += `[${tid}]`;
    return s;
  }

  /** Diagnostics: how many elements each selector matches, plus short headings on the page. */
  function selectorReport(root, groups) {
    const out = {};
    for (const [name, sels] of Object.entries(groups)) {
      out[name] = {};
      for (const s of sels) {
        try {
          const n = root.querySelectorAll(s).length;
          if (n) out[name][s] = n;
        } catch (_) {}
      }
    }
    return out;
  }

  function headings(root) {
    return Array.from((root || document).querySelectorAll("h1, h2, h3"))
      .map((h) => text(h).slice(0, 60) + "  <" + describe(h) + ">")
      .filter((t) => t.trim())
      .slice(0, 30);
  }

  /** Compact age stamps: "12d", "30+d", "3h", "2w", "Today", "Just posted", "New". */
  function parseShortAge(str) {
    if (!str) return null;
    const s = String(str).trim().toLowerCase();
    if (/^(just posted|today|new|now)$/.test(s)) return { days: 0, approx: false, reposted: false };
    const m = s.match(/^(\d+)\s*(\+)?\s*(m|h|d|w|mo|y)\b/);
    if (!m) return parseAge(s);
    const unit = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 30, y: 365 }[m[3]];
    return { days: parseInt(m[1], 10) * unit, approx: !!m[2], reposted: false };
  }

  /** Days since an absolute date string ("2026-10-06T05:00:00Z", "November 05, 2026"). */
  function daysSince(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).replace(/^\s*posted on\s*/i, "").trim();
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    const days = Math.max(0, (Date.now() - t) / 86400000);
    // Date-only values ("November 05, 2026", "2026-11-05") count whole calendar days.
    return /\d:\d/.test(s) ? days : Math.floor(days);
  }

  /** Text of an element without screen-reader-only helper spans (".wb-inv", ".sr-only", ...). */
  function textNoHidden(el) {
    if (!el) return "";
    const c = el.cloneNode(true);
    c.querySelectorAll(".wb-inv, .sr-only, .visually-hidden, .hidden, [aria-hidden='true']").forEach((n) => n.remove());
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** Convert an HTML string to plain text without executing anything. */
  function htmlToText(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    doc.querySelectorAll("br, p, li, div, h1, h2, h3, h4, tr").forEach((n) => n.append("\n"));
    return (doc.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  }

  /**
   * Read the schema.org JobPosting that many job sites embed for search engines.
   * If `expectedTitle` is given, only a posting with a matching title is returned
   * (single-page apps often keep the JSON-LD of the first job you opened).
   */
  function readJobPostingLD(expectedTitle) {
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch (_) {
        continue;
      }
      const items = [].concat(data, data && data["@graph"] ? data["@graph"] : []).flat();
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const type = [].concat(it["@type"] || []);
        if (!type.includes("JobPosting")) continue;
        if (expectedTitle && norm(it.title) && norm(it.title) !== norm(expectedTitle)) continue;
        const org = it.hiringOrganization;
        const sal = it.baseSalary;
        let salaryText = null;
        if (sal && typeof sal === "object") {
          const v = sal.value && typeof sal.value === "object" ? sal.value : sal;
          const cur = sal.currency === "CAD" ? "C$" : sal.currency === "GBP" ? "£" : sal.currency === "EUR" ? "€" : "$";
          const fmt = (n) => cur + Number(n).toLocaleString("en-US");
          const lo = v.minValue ?? v.value;
          const hi = v.maxValue;
          if (lo != null && !isNaN(lo)) salaryText = fmt(lo) + (hi != null && hi !== lo ? `–${fmt(hi)}` : "") + (v.unitText ? ` / ${String(v.unitText).toLowerCase()}` : "");
        }
        const locType = [].concat(it.jobLocationType || []).join(" ");
        return {
          title: it.title || null,
          company: (org && (org.name || (typeof org === "string" ? org : null))) || null,
          datePosted: it.datePosted || null,
          validThrough: it.validThrough || null,
          salaryText,
          description: it.description ? htmlToText(it.description) : null,
          remote: /TELECOMMUTE/i.test(locType),
          directApply: it.directApply === true ? true : it.directApply === false ? false : null,
        };
      }
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  globalThis.GJX = {
    q, qa, text, blockText, parseAge, parseApplicants, findSalary, detectWorkplace, parseRating, isVisible,
    findDescription, describe, selectorReport, headings,
    parseShortAge, daysSince, textNoHidden, htmlToText, readJobPostingLD,
  };
})();
