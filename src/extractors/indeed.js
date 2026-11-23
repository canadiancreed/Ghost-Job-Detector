/* Indeed extractor: /viewjob pages and the search results right-hand pane. */
(function () {
  "use strict";
  const { q, qa, text, parseAge, findSalary, detectWorkplace, parseRating, findDescription, describe, selectorReport, headings } = globalThis.GJX;
  const DESC_SEL = ["#jobDescriptionText", '[data-testid="jobsearch-JobComponent-description"]', ".jobsearch-JobComponent-description", ".jobsearch-jobDescriptionText"];
  const ROOT_SEL = [".jobsearch-JobComponent", ".jobsearch-ViewJobLayout-jobDisplay", "#jobsearch-ViewjobPaneWrapper", ".jobsearch-RightPane", "#viewJobSSRRoot"];
  let lastDebug = null;

  function matches(loc) {
    return /(^|\.)indeed\.com$/.test(loc.hostname) || /(^|\.)indeed\.[a-z.]+$/.test(loc.hostname);
  }

  function currentJobId() {
    const u = new URL(location.href);
    return u.searchParams.get("vjk") || u.searchParams.get("jk") || null;
  }

  /** Parse Indeed's "Posted 30+ days ago" / "Active 3 days ago" / "Just posted" style labels. */
  function parseIndeedDates(str) {
    const out = { age: null, employerActiveDays: null };
    if (!str) return out;
    const active = str.match(/(?:employer\s+)?active\s+(today|\d+\+?\s*days?\s+ago)/i);
    if (active) {
      const a = /today/i.test(active[1]) ? { days: 0 } : parseAge(active[1]);
      if (a) out.employerActiveDays = a.days;
    }
    const posted = str.match(/(posted\s+(?:today|just now|\d+\+?\s*\w+\s+ago)|just posted)/i);
    if (posted) out.age = parseAge(posted[1].replace(/^posted\s+/i, ""));
    return out;
  }

  function extractDetail() {
    const descEl = q(document, DESC_SEL);
    const root = (descEl && descEl.closest(ROOT_SEL.join(", "))) || q(document, ROOT_SEL) || document.querySelector("main");
    if (!root) return null;

    let id = currentJobId();
    if (!id) {
      const el = root.hasAttribute("data-jk") ? root : q(root, ["[data-jk]"]);
      id = el ? el.getAttribute("data-jk") : null;
    }
    if (!id) return null;

    const titleEl = q(root, ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1.jobsearch-JobInfoHeader-title", ".jobsearch-JobInfoHeader-title", "h2.jobsearch-JobInfoHeader-title", "h1"]);
    const title = text(titleEl).replace(/\s*-\s*job post\s*$/i, "").trim();
    const company = text(q(root, ['[data-testid="inlineHeader-companyName"] a', '[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', ".jobsearch-CompanyInfoContainer a", ".jobsearch-InlineCompanyRating > div:first-child"]));
    if (!title || !company) return null;

    const location = text(q(root, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]', ".jobsearch-JobInfoHeader-subtitle > div:last-child"]));

    const found = findDescription(root, DESC_SEL);
    const description = found && found.text.length >= 30 ? found.text : null;
    lastDebug = { root: describe(root), titleEl: describe(titleEl), descEl: describe(found && found.el), descSource: found ? found.source : null, descLength: description ? description.length : 0 };

    const rootText = text(root);
    const header = q(root, [".jobsearch-JobInfoHeader-title-container", '[data-testid="jobsearch-JobInfoHeader"]', ".jobsearch-InfoHeaderContainer"]);

    // Rating
    const ratingEl = q(root, ['[data-testid="inlineHeader-companyReviewLink"]', ".jobsearch-CompanyReview--heading", '[aria-label*="out of 5 stars"]', '[aria-label*="out of 5"]']);
    const companyRating = ratingEl ? parseRating(ratingEl.getAttribute("aria-label") || text(ratingEl)) : null;

    // Salary
    const payEl = q(root, ["#salaryInfoAndJobType", '[data-testid="jobsearch-OtherJobDetailsContainer"]', "#jobDetailsSection", '[aria-label="Pay"]', '[data-testid="jobsearch-CollapsedEmbeddedJobDetails-salary"]']);
    let salaryText = findSalary(text(payEl));
    let salaryListed = null;
    if (salaryText) salaryListed = true;
    else if (description) {
      const inDesc = findSalary(description);
      if (inDesc) {
        salaryListed = true;
        salaryText = `${inDesc} (in description)`;
      } else salaryListed = false;
    }

    // Apply
    let easyApply = null;
    let externalApply = null;
    if (q(root, ["#indeedApplyButton", '[data-testid="indeedApplyButton-test"]', ".ia-IndeedApplyButton", ".indeed-apply-button"])) {
      easyApply = true;
      externalApply = false;
    } else {
      const ext = qa(root, ["#applyButtonLinkContainer a", "#applyButtonLinkContainer button", 'button[aria-label*="company site"]', 'a[aria-label*="company site"]']);
      if (ext.length || /apply on company site/i.test(rootText)) {
        easyApply = false;
        externalApply = true;
      }
    }

    const dates = parseIndeedDates(rootText);
    const responsive = rootText.match(/(responsive employer|(?:often|typically|usually) responds within [^.·]{1,20}|responded to \d+% of applications[^.·]{0,30})/i);

    const descAnchor = descEl || (found && found.el);
    const anchor = header ? { el: header, where: "afterend" } : descAnchor ? { el: descAnchor, where: "beforebegin" } : null;

    return {
      listing: {
        platform: "indeed",
        id,
        url: `https://www.indeed.com/viewjob?jk=${id}`,
        title,
        company,
        location,
        ageDays: dates.age && dates.age.days !== null ? dates.age.days : null,
        ageApprox: dates.age ? dates.age.approx : false,
        reposted: null,
        easyApply,
        externalApply,
        salaryListed,
        salaryText,
        description,
        responsiveEmployer: responsive ? true : null,
        responsiveText: responsive ? responsive[0] : null,
        employerActiveDays: dates.employerActiveDays,
        urgentlyHiring: /urgently hiring/i.test(rootText) ? true : null,
        companyRating,
        workplace: detectWorkplace(location) || detectWorkplace(text(payEl)),
        closed: /this job has expired|no longer accepting/i.test(rootText),
      },
      anchor,
    };
  }

  function findCards() {
    const out = [];
    const seen = new Set();
    for (const a of qa(document, ["a[data-jk]", "[data-jk]"])) {
      const id = a.getAttribute("data-jk");
      if (!id || seen.has(id)) continue;
      if (a.closest("#jobsearch-ViewjobPaneWrapper, .jobsearch-RightPane, .jobsearch-JobComponent, #viewJobSSRRoot")) continue;
      const el = a.closest(".cardOutline, .job_seen_beacon, li, .result");
      if (!el || el.querySelector("#jobDescriptionText")) continue;
      const titleEl = q(el, ["h2.jobTitle a", "h2.jobTitle", ".jcs-JobTitle", "a[data-jk]"]);
      if (!titleEl) continue;
      seen.add(id);
      const cardText = text(el);
      const dates = parseIndeedDates(text(q(el, ['[data-testid="myJobsStateDate"]', ".date"])) || cardText);
      const salaryText = findSalary(text(q(el, [".salary-snippet-container", '[data-testid="attribute_snippet_testid"]', ".estimated-salary", ".metadata"]))) || findSalary(cardText);
      const titleText = text(q(titleEl, ["span[title]"]) || titleEl);
      out.push({
        el,
        id,
        badgeAnchor: { el: titleEl.closest("a") || titleEl, where: "afterend" },
        listing: {
          platform: "indeed",
          id,
          preview: true,
          title: titleText.replace(/^new\s+/i, ""),
          company: text(q(el, ['[data-testid="company-name"]', ".companyName"])),
          location: text(q(el, ['[data-testid="text-location"]', ".companyLocation"])),
          ageDays: dates.age && dates.age.days !== null ? dates.age.days : null,
          ageApprox: dates.age ? dates.age.approx : false,
          employerActiveDays: dates.employerActiveDays,
          easyApply: /easily apply/i.test(cardText) ? true : null,
          salaryListed: salaryText ? true : null,
          salaryText,
          urgentlyHiring: /urgently hiring/i.test(cardText) ? true : null,
          responsiveEmployer: /responsive employer|often responds/i.test(cardText) ? true : null,
        },
      });
    }
    return out;
  }

  globalThis.GJExtractors = globalThis.GJExtractors || {};
  function debug() {
    const root = q(document, ROOT_SEL) || document.querySelector("main") || document.body;
    return {
      lastExtraction: lastDebug,
      documentTitle: document.title,
      selectorsMatched: selectorReport(document, { root: ROOT_SEL, description: DESC_SEL, cards: ["a[data-jk]", "[data-jk]", ".cardOutline", ".job_seen_beacon"] }),
      headingsInPane: headings(root),
    };
  }

  globalThis.GJExtractors.indeed = { name: "Indeed", matches, currentJobId, extractDetail, findCards, debug };
})();
