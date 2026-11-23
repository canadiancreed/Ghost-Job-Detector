/* LinkedIn extractor. Works on the logged-in two-pane search, /jobs/view/ pages,
 * and the logged-out (guest) job pages. LinkedIn's markup changes often, so every
 * field has several selector fallbacks plus text-pattern fallbacks.
 */
(function () {
  "use strict";
  const { q, qa, text, parseAge, parseApplicants, findSalary, detectWorkplace, findDescription, describe, selectorReport, headings } = globalThis.GJX;
  let lastDebug = null;

  const ROOT_SEL = [
    ".jobs-search__job-details--container",
    ".jobs-search__job-details",
    ".job-view-layout",
    ".jobs-details",
    ".scaffold-layout__detail",
    ".details-pane__content",
    ".decorated-job-posting__details",
    "main",
  ];
  const TOP_CARD_SEL = [
    ".job-details-jobs-unified-top-card__container--two-pane",
    ".job-details-jobs-unified-top-card__container",
    ".jobs-unified-top-card",
    ".jobs-details-top-card",
    ".top-card-layout",
  ];
  const TITLE_SEL = [
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    "h1.top-card-layout__title",
    ".topcard__title",
    "h1",
  ];
  const COMPANY_SEL = [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name",
    "a.topcard__org-name-link",
    ".topcard__flavor a",
    'a[href*="/company/"]',
  ];
  const META_SEL = [
    ".job-details-jobs-unified-top-card__tertiary-description-container",
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__subtitle-primary-grouping",
    ".topcard__flavor-row",
  ];
  const DESC_SEL = [
    "#job-details",
    ".jobs-description__content",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    ".description__text",
    ".show-more-less-html__markup",
  ];

  function matches(loc) {
    return /(^|\.)linkedin\.com$/.test(loc.hostname) && /^\/jobs/.test(loc.pathname);
  }

  function currentJobId() {
    const u = new URL(location.href);
    const p = u.searchParams.get("currentJobId");
    if (p) return p;
    const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
    return m ? m[1] : null;
  }

  function idFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/jobs\/view\/(?:[^/?]*?-)?(\d{6,})/) || href.match(/currentJobId=(\d{6,})/);
    return m ? m[1] : null;
  }

  function findRoot() {
    for (const s of ROOT_SEL) {
      const el = document.querySelector(s);
      if (el && q(el, DESC_SEL.concat(TITLE_SEL))) return el;
    }
    return document.body;
  }

  /** True when `root` is the whole page (or <main>), which on search pages also holds the job list. */
  function isPageLevel(root) {
    return root === document.body || root.tagName === "MAIN";
  }

  function commonAncestor(a, b) {
    const up = new Set();
    for (let p = a; p; p = p.parentElement) up.add(p);
    for (let p = b; p; p = p.parentElement) if (up.has(p)) return p;
    return null;
  }

  const APPLY_TEXT_RE = /^(easy apply|apply|apply now|apply on company website)$/i;
  const APPLY_LABEL_RE = /^(easy apply|apply) to\b/i;

  function findApplyButton(root) {
    for (const b of root.querySelectorAll("button, a")) {
      if (b.closest("[data-gj]")) continue;
      if (APPLY_TEXT_RE.test(text(b)) || APPLY_LABEL_RE.test(b.getAttribute("aria-label") || "")) return b;
    }
    return null;
  }

  /**
   * LinkedIn's newer layout has no stable class names, so <main> holds both the job list
   * and the open job. Find the open job's own panel: the smallest element holding both an
   * element showing the job's title and the description (or its Apply button). The same
   * title in the list sits much further away from the description, so it loses.
   * Returns { pane, titleEl } or null.
   */
  function findPane(root, title, descEl) {
    const target = descEl || findApplyButton(root);
    if (!target || !title) return null;
    const want = title.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.length > 300) return NodeFilter.FILTER_REJECT;
        const t = cleanTitle(v.replace(/\s+/g, " ")).toLowerCase();
        return t === want ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let best = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("[data-gj], title")) continue;
      const anc = commonAncestor(el, target);
      if (!anc) continue;
      const size = (anc.textContent || "").length;
      if (!best || size < best.size) best = { pane: anc, titleEl: el, size };
    }
    return best ? { pane: best.pane, titleEl: best.titleEl } : null;
  }

  /** "172K CAD/yr - 237K CAD/yr" (newer LinkedIn layout) as well as "$150K/yr - $230K/yr". */
  const CODE_SALARY_RE = /\d[\d,.]*\s?[kK]?\s?(?:CAD|USD|EUR|GBP)\s?\/\s?(?:yr|hr|year|hour|mo|month)(?:\s*(?:-|–|—|to)\s*\d[\d,.]*\s?[kK]?\s?(?:CAD|USD|EUR|GBP)\s?\/\s?(?:yr|hr|year|hour|mo|month))?/;
  function salaryIn(str) {
    if (!str) return null;
    const m = String(str).match(CODE_SALARY_RE);
    return findSalary(str) || (m ? m[0].trim() : null);
  }

  function cleanTitle(t) {
    return (t || "").replace(/\s+with verification\s*$/i, "").trim();
  }

  function extractDetail() {
    const id = currentJobId();
    if (!id) return null;
    const root = findRoot();
    const topCard = q(root, TOP_CARD_SEL);
    // When only <main>/<body> matched, it also contains the job list, so generic
    // selectors (h1, company links) could hit another job. Use the tab title instead.
    const unscoped = isPageLevel(root) && !topCard;
    let titleEl = unscoped ? null : q(topCard || root, TITLE_SEL);
    let title = cleanTitle(text(titleEl));
    let company = unscoped ? "" : text(q(topCard || root, COMPANY_SEL));

    if (!title || !company) {
      // Fallback to the document title: "Job Title | Company | LinkedIn"
      const parts = document.title.split(/\s+[|\-–]\s+/).map((s) => s.trim());
      if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) {
        title = title || cleanTitle(parts[0].replace(/^\(\d+\)\s*/, ""));
        company = company || parts[1];
      }
    }
    if (unscoped && (!title || !company)) {
      title = title || cleanTitle(text(q(root, TITLE_SEL)));
      company = company || text(q(root, COMPANY_SEL));
    }
    if (!title || !company) return null;

    // Stale-pane guard: in two-pane search the URL changes before the pane re-renders.
    const titleLink = titleEl && (titleEl.closest("a") || titleEl.querySelector("a"));
    const linkedId = titleLink && idFromHref(titleLink.getAttribute("href"));
    if (linkedId && linkedId !== id) return null;

    // Search the detail pane first; fall back to the whole page if the pane guess was wrong.
    const found = findDescription(root, DESC_SEL) || (root !== document.body ? findDescription(document.body, DESC_SEL) : null);
    const descEl = found ? found.el : null;
    const description = found && found.text.length >= 30 ? found.text : null;

    // Everything below is read from the open job's own panel, never the job list.
    let pane = root;
    if (unscoped) {
      const p = findPane(document.body, title, descEl);
      if (!p) return null; // can't yet tell this job's panel apart from the list; try again shortly
      pane = p.pane;
      titleEl = p.titleEl;
    } else if (isPageLevel(root)) {
      pane = (descEl && commonAncestor(topCard, descEl)) || topCard;
    }
    lastDebug = { root: describe(root), pane: describe(pane), topCard: describe(topCard), titleEl: describe(titleEl), descEl: describe(descEl), descSource: found ? found.source : null, descLength: description ? description.length : 0 };

    const metaText = text(q(topCard || pane, META_SEL));
    let topText = text(topCard);
    if (!topText) {
      const all = text(pane);
      let cut = all.search(/about the job/i);
      if (cut <= 0 && description) cut = all.indexOf(description.replace(/\s+/g, " ").trim().slice(0, 40));
      topText = cut > 0 ? all.slice(0, cut) : all.slice(0, 1500);
    }
    const headText = metaText + " · " + topText;

    // Posting age & reposts
    let age = parseAge(metaText) || parseAge(text(q(pane, [".posted-time-ago__text", ".topcard__flavor--metadata"]))) || parseAge(topText);
    const timeEl = q(topCard || pane, ["time[datetime]"]);
    if ((!age || age.days === null) && timeEl) {
      const t = Date.parse(timeEl.getAttribute("datetime"));
      if (!isNaN(t)) age = { days: Math.max(0, (Date.now() - t) / 86400000), approx: false, reposted: age ? age.reposted : false };
    }
    const reposted = /\breposted\b/i.test(headText) || (age && age.reposted) || false;

    // Applicants
    const appl = parseApplicants(headText) || parseApplicants(text(q(pane, [".num-applicants__caption"])));

    // Location: first "·"-separated piece of the meta line
    let location = text(q(topCard || pane, [".topcard__flavor--bullet", ".job-details-jobs-unified-top-card__bullet"]));
    if (!location && metaText) location = metaText.split("·")[0].trim();
    if (!location && unscoped) {
      // "...<title> Canada · Reposted 4 days ago · Over 100 people clicked apply"
      const i = topText.toLowerCase().lastIndexOf(title.toLowerCase());
      if (i >= 0 && topText.indexOf("·", i) > 0) {
        const loc = topText.slice(i + title.length, topText.indexOf("·", i)).trim();
        if (loc.length > 1 && loc.length <= 60) location = loc;
      }
    }

    // Salary: the pay shown in this job's own header, otherwise the description.
    const salaryEl = q(topCard || pane, [".job-details-fit-level-preferences", ".job-details-jobs-unified-top-card__job-insight", ".compensation__salary", ".salary"]);
    let salaryText = salaryIn(text(salaryEl)) || salaryIn(topText);
    let salaryListed = null;
    if (salaryText) salaryListed = true;
    else if (description) {
      const inDesc = salaryIn(description);
      if (inDesc) {
        salaryListed = true;
        salaryText = `${inDesc} (in description)`;
      } else salaryListed = false;
    }

    // Apply button
    const rootText = text(pane);
    const closed = /no longer accepting applications/i.test(rootText);
    let easyApply = null;
    let externalApply = null;
    const applyBtns = qa(pane, [".jobs-apply-button", ".jobs-s-apply button", "button.apply-button", "a.apply-button"]);
    if (!applyBtns.length) {
      const b = findApplyButton(pane);
      if (b) applyBtns.push(b);
    }
    const applyTxt = applyBtns.map((b) => text(b) + " " + (b.getAttribute("aria-label") || "")).join(" ");
    if (/easy apply/i.test(applyTxt)) {
      easyApply = true;
      externalApply = false;
    } else if (/\bapply\b/i.test(applyTxt)) {
      // On LinkedIn a plain "Apply" (not Easy Apply) always sends you to the employer's site.
      easyApply = false;
      externalApply = true;
    }

    const hiringContact =
      /meet the hiring team|job poster/i.test(rootText) || !!q(pane, [".hirer-card__hirer-information", ".job-details-people-who-can-help__section", ".hiring-team"])
        ? true
        : null;

    const activelyReviewing = /actively (reviewing|recruiting|hiring)/i.test(headText) ? true : null;

    // Pills can run together with no space ("237K CAD/yrRemote"), so split them first.
    const pills = (s) => s.replace(/([a-z0-9)])(Remote|Hybrid|On-site)/g, "$1 $2");
    const workplace = detectWorkplace(text(q(topCard || pane, [".job-details-preferences-and-skills", ".job-details-fit-level-preferences"])) || metaText || pills(topText));

    let anchor = null;
    if (topCard) anchor = { el: topCard, where: "afterend" };
    else if (descEl) anchor = { el: (unscoped ? null : descEl.closest(".jobs-description, .jobs-box, article, section")) || descEl, where: "beforebegin" };

    return {
      listing: {
        platform: "linkedin",
        id,
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        title,
        company,
        location,
        ageDays: age && age.days !== null ? age.days : null,
        ageApprox: age ? age.approx : false,
        reposted,
        applicants: appl ? appl.count : null,
        applicantsText: appl ? appl.text : null,
        easyApply,
        externalApply,
        salaryListed,
        salaryText,
        description,
        hiringContact,
        activelyReviewing,
        workplace,
        closed,
      },
      anchor,
    };
  }

  const CARD_SEL = [
    "li[data-occludable-job-id]",
    "div.job-card-container[data-job-id]",
    "[data-job-id]",
    'div.base-card[data-entity-urn*="jobPosting"]',
    'div[data-view-name="job-card"]',
    "li.jobs-search-results__list-item",
  ];

  function cardId(el) {
    const d = el.dataset || {};
    if (d.occludableJobId) return d.occludableJobId;
    if (d.jobId && /^\d+$/.test(d.jobId)) return d.jobId;
    const urn = el.getAttribute("data-entity-urn") || "";
    const m = urn.match(/jobPosting:(\d+)/);
    if (m) return m[1];
    const a = el.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
    return a ? idFromHref(a.getAttribute("href")) : null;
  }

  function findCards() {
    const cands = qa(document, CARD_SEL);
    const set = new Set(cands);
    const outer = cands.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
    const seen = new Set();
    const out = [];
    for (const el of outer) {
      const id = cardId(el);
      if (!id || seen.has(id)) continue;
      const titleEl = q(el, [
        ".job-card-list__title--link strong",
        ".job-card-list__title--link",
        ".job-card-list__title",
        "a.job-card-container__link strong",
        "a.job-card-container__link",
        ".base-search-card__title",
        ".artdeco-entity-lockup__title",
        'a[href*="/jobs/view/"]',
      ]);
      if (!titleEl) continue; // occluded / not rendered yet
      seen.add(id);
      const cardText = text(el);
      const company = text(q(el, [".artdeco-entity-lockup__subtitle", ".job-card-container__primary-description", ".job-card-container__company-name", ".base-search-card__subtitle", "h4"]));
      const location = text(q(el, [".job-card-container__metadata-item", ".artdeco-entity-lockup__caption", ".job-search-card__location"]));
      let age = parseAge(text(q(el, ["time"]))) || parseAge(cardText);
      const timeEl = el.querySelector("time[datetime]");
      if ((!age || age.days === null) && timeEl) {
        const t = Date.parse(timeEl.getAttribute("datetime"));
        if (!isNaN(t)) age = { days: Math.max(0, (Date.now() - t) / 86400000), approx: true, reposted: !!(age && age.reposted) };
      }
      // Only trust a salary from something the size of one job card, not a wrapper around several.
      const salaryText = cardText.length <= 800 ? salaryIn(cardText) : null;
      const linkEl = titleEl.closest("a") || titleEl;
      out.push({
        el,
        id,
        badgeAnchor: { el: linkEl, where: "afterend" },
        listing: {
          platform: "linkedin",
          id,
          preview: true,
          title: cleanTitle(text(titleEl)),
          company,
          location,
          ageDays: age && age.days !== null ? age.days : null,
          ageApprox: age ? age.approx : false,
          reposted: /\breposted\b/i.test(cardText) || null,
          easyApply: /easy apply/i.test(cardText) ? true : null,
          salaryListed: salaryText ? true : null,
          salaryText,
          activelyReviewing: /actively (reviewing|recruiting|hiring)/i.test(cardText) ? true : null,
          closed: /no longer accepting/i.test(cardText) || null,
        },
      });
    }
    return out;
  }

  globalThis.GJExtractors = globalThis.GJExtractors || {};
  function debug() {
    const root = findRoot();
    return {
      lastExtraction: lastDebug,
      documentTitle: document.title,
      selectorsMatched: selectorReport(document, { root: ROOT_SEL, topCard: TOP_CARD_SEL, title: TITLE_SEL, company: COMPANY_SEL, meta: META_SEL, description: DESC_SEL, cards: CARD_SEL }),
      headingsInPane: headings(root),
    };
  }

  globalThis.GJExtractors.linkedin = { name: "LinkedIn", matches, currentJobId, extractDetail, findCards, debug };
})();
