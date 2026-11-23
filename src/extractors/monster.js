/* Monster (monster.com, monster.ca, other monster.* sites).
 * Monster blocks automated browsers, so this extractor couldn't be checked against live
 * markup. It relies on the schema.org JobPosting JSON-LD that job pages publish for search
 * engines, then falls back to generic selectors, "About the job"-style headings, and text
 * patterns. Use the popup's "Copy diagnostics" if a field is missed.
 */
(function () {
  "use strict";
  const { q, qa, text, parseAge, findSalary, detectWorkplace, findDescription, describe, selectorReport, headings, daysSince, readJobPostingLD } = globalThis.GJX;

  const ROOT_SEL = [
    '[data-testid="svx_jobview-card"]', '[data-testid="JobViewContainer"]', '[data-testid*="jobview" i]', '[data-testid*="JobView"]',
    '[class*="jobview" i]', '[class*="JobView"]', '[class*="job-view" i]', '[class*="details-content" i]', "main",
  ];
  const TITLE_SEL = ['[data-testid="jobTitle"]', '[data-testid="svx_jobview-title"]', '[data-testid*="JobTitle" i]', 'h1[class*="title" i]', 'h2[class*="title" i]', "h1", "h2"];
  const COMPANY_SEL = ['[data-testid="company"]', '[data-testid="svx_jobview-company"]', '[data-testid*="company" i]', '[class*="company-name" i]', '[class*="companyName"]', '[class*="company" i] a', '[class*="company" i]'];
  const LOCATION_SEL = ['[data-testid="jobDetailLocation"]', '[data-testid="svx_jobview-location"]', '[data-testid*="location" i]', '[class*="location" i]'];
  const DESC_SEL = ['[data-testid="svx_jobview-description"]', '[data-testid*="description" i]', "#JobDescription", '[class*="jobDescription"]', '[class*="job-description" i]', '[class*="description" i]'];
  const CARD_SEL = ['[data-testid="svx_jobCard"]', '[data-testid*="JobCard" i]', 'article[data-job-id]', '[data-jobid]', '[data-job-id]'];
  const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let lastDebug = null;

  function matches(loc) {
    return /(^|\.)monster\.[a-z.]+$/.test(loc.hostname);
  }

  function currentJobId() {
    const u = new URL(location.href);
    for (const k of ["id", "jobid", "jobId", "job"]) {
      const v = u.searchParams.get(k);
      if (v) return v;
    }
    const m = u.pathname.match(UUID_RE) || u.pathname.match(/\/job-openings\/[^/]*?--([^/?#]+)/) || u.pathname.match(/\/job\/[^/]*?(\d{6,})/);
    return m ? m[1] : null;
  }

  function findRoot() {
    for (const s of ROOT_SEL) {
      let els;
      try {
        els = document.querySelectorAll(s);
      } catch (_) {
        continue;
      }
      for (const el of els) if (q(el, DESC_SEL) && q(el, TITLE_SEL)) return el;
    }
    return document.querySelector("main") || document.body;
  }

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return "h" + (h >>> 0).toString(36);
  }

  function extractDetail() {
    const root = findRoot();
    const titleEl = q(root, TITLE_SEL);
    const ld = readJobPostingLD(text(titleEl) || null) || readJobPostingLD(null);
    let title = text(titleEl) || (ld && ld.title) || "";
    // If the DOM title and the JSON-LD disagree, trust the DOM (the JSON-LD may be stale in split view).
    const ldMatches = ld && (!text(titleEl) || ld.title === text(titleEl));
    let company = text(q(root, COMPANY_SEL)) || (ldMatches && ld.company) || "";
    if (company.length > 80) company = company.slice(0, 80);
    if (!title || !company) return null;

    const id = currentJobId() || hashId(title + "|" + company);
    const location = text(q(root, LOCATION_SEL));

    const found = findDescription(root, DESC_SEL);
    let description = found && found.text.length >= 30 ? found.text : null;
    if (!description && ldMatches && ld.description) description = ld.description;

    const headEl = titleEl ? titleEl.closest("header, section, div") : null;
    const headText = text(headEl && headEl.parentElement ? headEl.parentElement : headEl);
    const rootText = text(root);

    let ageDays = ldMatches ? daysSince(ld.datePosted) : null;
    let ageApprox = false;
    let reposted = null;
    if (ageDays === null) {
      const a = parseAge((headText.match(/(posted|reposted|updated)?\s*(today|just posted|\d+\+?\s*\w+\s+ago)/i) || [])[0]);
      if (a) {
        ageDays = a.days;
        ageApprox = a.approx;
        reposted = a.reposted || null;
      }
    }

    let salaryText = (ldMatches && ld.salaryText) || findSalary(headText);
    let salaryListed = salaryText ? true : null;
    if (!salaryText && description) {
      const inDesc = findSalary(description);
      if (inDesc) {
        salaryListed = true;
        salaryText = `${inDesc} (in description)`;
      } else salaryListed = false;
    }

    const applyBtns = qa(root, ['[data-testid*="apply" i]', 'button[class*="apply" i]', 'a[class*="apply" i]']).filter((b) => /apply/i.test(text(b)));
    const applyTxt = applyBtns.map((b) => text(b)).join(" ");
    let easyApply = null;
    let externalApply = null;
    if (/quick apply|easy apply|1-click/i.test(applyTxt)) {
      easyApply = true;
      externalApply = false;
    } else if (/company site|external|apply on/i.test(applyTxt) || applyBtns.some((b) => b.tagName === "A" && /^https?:/i.test(b.getAttribute("href") || "") && !/monster\./i.test(b.getAttribute("href")))) {
      easyApply = false;
      externalApply = true;
    }

    const workplace = (ldMatches && ld.remote ? "remote" : null) || detectWorkplace(location) || detectWorkplace(headText);

    lastDebug = { root: describe(root), titleEl: describe(titleEl), descEl: describe(found && found.el), descSource: found ? found.source : description ? "json-ld" : null, descLength: description ? description.length : 0, ld: !!ld, ldMatches: !!ldMatches, id };

    return {
      listing: {
        platform: "monster",
        id,
        url: window.location.href.split("#")[0],
        title,
        company,
        location,
        ageDays,
        ageApprox,
        reposted,
        easyApply,
        externalApply,
        salaryListed,
        salaryText,
        description,
        urgentlyHiring: /urgently hiring/i.test(headText) ? true : null,
        workplace,
        closed: /no longer (available|accepting)|this job has expired/i.test(rootText),
      },
      anchor: titleEl ? { el: headEl || titleEl, where: "afterend" } : null,
    };
  }

  function findCards() {
    const out = [];
    const seen = new Set();
    for (const el of qa(document, CARD_SEL)) {
      const id = el.getAttribute("data-job-id") || el.getAttribute("data-jobid") || ((q(el, ["a[href]"]) || {}).getAttribute?.("href") || "").match(UUID_RE)?.[1];
      if (!id || seen.has(id)) continue;
      const titleEl = q(el, ['[data-testid*="title" i]', "h2", "h3", "a"]);
      if (!titleEl) continue;
      seen.add(id);
      const cardText = text(el);
      const a = parseAge((cardText.match(/(today|just posted|\d+\+?\s*\w+\s+ago)/i) || [])[0]);
      const salaryText = findSalary(cardText);
      out.push({
        el,
        id,
        listing: {
          platform: "monster",
          id,
          preview: true,
          title: text(titleEl),
          company: text(q(el, ['[data-testid*="company" i]', '[class*="company" i]'])),
          location: text(q(el, ['[data-testid*="location" i]', '[class*="location" i]'])),
          ageDays: a ? a.days : null,
          ageApprox: a ? a.approx : false,
          salaryListed: salaryText ? true : null,
          salaryText,
        },
      });
    }
    return out;
  }

  function debug() {
    const root = findRoot();
    return {
      lastExtraction: lastDebug,
      documentTitle: document.title,
      selectorsMatched: selectorReport(document, { root: ROOT_SEL, title: TITLE_SEL, company: COMPANY_SEL, location: LOCATION_SEL, description: DESC_SEL, cards: CARD_SEL, jsonld: ['script[type="application/ld+json"]'] }),
      testIds: Array.from(new Set(Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")))).slice(0, 80),
      headingsInPane: headings(root),
    };
  }

  globalThis.GJExtractors = globalThis.GJExtractors || {};
  globalThis.GJExtractors.monster = { name: "Monster", matches, currentJobId, extractDetail, findCards, debug };
})();
