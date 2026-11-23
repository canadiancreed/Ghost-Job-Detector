/* Job Bank (Government of Canada, jobbank.gc.ca).
 * Posting pages carry schema.org microdata (property="datePosted", "hiringOrganization",
 * "baseSalary", "validThrough"), which is far more stable than class names.
 * Job Bank also republishes postings from partner sites (Indeed, CareerBeacon, Talent.com...);
 * those show only a summary and link out, so their description is "not shown".
 */
(function () {
  "use strict";
  const { q, qa, text, blockText, findSalary, detectWorkplace, describe, selectorReport, headings, daysSince, textNoHidden } = globalThis.GJX;
  let lastDebug = null;

  function matches(loc) {
    return /(^|\.)jobbank\.gc\.ca$/.test(loc.hostname);
  }

  function currentJobId() {
    const m = location.pathname.match(/\/jobposting\/(\d+)/);
    return m ? m[1] : null;
  }

  /** Value of a labelled item in the "Job details" brief list, e.g. "Source", "Work location". */
  function briefItem(label) {
    for (const li of qa(document, [".job-posting-brief li"])) {
      const lab = text(li.querySelector(".wb-inv"));
      if (lab && lab.toLowerCase() === label.toLowerCase()) return textNoHidden(li);
    }
    return "";
  }

  function extractDetail() {
    const id = currentJobId();
    if (!id) return null;
    const titleEl = q(document, ['[property="title"]', "h1.title", "main h1"]);
    const title = text(titleEl);
    const orgEl = q(document, ['[property="hiringOrganization"] [property="name"]', '[property="hiringOrganization"]', ".business"]);
    const company = textNoHidden(orgEl);
    if (!title || !company) return null;

    const root = q(document, [".job-posting-details-body", ".job-posting-content", "main"]) || document.body;
    const rootText = text(root);

    const city = text(q(document, ['[property="joblocation"] [property="addressLocality"]']));
    const region = text(q(document, ['[property="joblocation"] [property="addressRegion"]']));
    const location = city ? [city, region].filter(Boolean).join(", ") : textNoHidden(q(document, ['[property="joblocation"]']));
    const posted = q(document, ['[property="datePosted"]']);
    const ageDays = daysSince(text(posted));
    const validThrough = text(q(document, ['[property="validThrough"]']));
    const expired = validThrough && Date.parse(validThrough) && Date.parse(validThrough) + 86400000 < Date.now();

    const salaryEl = q(document, ['[property="baseSalary"]']);
    const salaryText = salaryEl ? textNoHidden(salaryEl).replace(/\s*\/\s*$/, "") : findSalary(rootText);

    const source = briefItem("Source") || text(q(document, [".source"]));
    const native = /job ?bank/i.test(source) || /posted directly by the employer on job bank/i.test(rootText);
    const partner = !native && source ? source.replace(/#\s*\d+.*$/, "").trim() : null;

    // Job Bank's own postings are structured lists (Overview, Responsibilities, Experience...).
    let description = null;
    if (native) {
      const parts = qa(document, [".job-posting-detail-requirements"]).map((el) => blockText(el)).filter(Boolean);
      const joined = parts.join("\n\n").trim();
      if (joined.length >= 30) description = joined;
    }

    const workplace = detectWorkplace(briefItem("Work location")) || detectWorkplace(text(q(document, [".job-posting-brief"])));

    const brief = q(document, [".job-posting-brief"]);
    const anchor = brief ? { el: brief, where: "afterend" } : titleEl ? { el: titleEl, where: "afterend" } : null;

    lastDebug = { root: describe(root), titleEl: describe(titleEl), source, native, descLength: description ? description.length : 0, ageDays };

    return {
      listing: {
        platform: "jobbank",
        id,
        url: `https://www.jobbank.gc.ca/jobsearch/jobposting/${id}`,
        title,
        company,
        location,
        ageDays,
        ageApprox: false,
        reposted: null,
        salaryListed: salaryText ? true : salaryEl === null && native ? false : null,
        salaryText: salaryText || null,
        description,
        descStructured: true,
        externalApply: partner ? true : null,
        partnerSource: partner,
        workplace,
        closed: !!expired,
      },
      anchor,
    };
  }

  function findCards() {
    const out = [];
    for (const el of qa(document, ['article[id^="article-"]'])) {
      const m = el.id.match(/article-(\d+)/);
      if (!m) continue;
      const titleEl = q(el, [".noctitle", "h3.title"]);
      if (!titleEl) continue;
      const salary = text(q(el, [".salary"]));
      out.push({
        el,
        id: m[1],
        listing: {
          platform: "jobbank",
          id: m[1],
          preview: true,
          title: text(titleEl),
          company: text(q(el, [".business"])),
          location: textNoHidden(q(el, [".location"])),
          ageDays: daysSince(text(q(el, [".date"]))),
          salaryListed: salary ? true : null,
          salaryText: salary ? salary.replace(/^salary\s*/i, "") : null,
        },
      });
    }
    return out;
  }

  function debug() {
    return {
      lastExtraction: lastDebug,
      documentTitle: document.title,
      selectorsMatched: selectorReport(document, {
        microdata: ['[property="title"]', '[property="hiringOrganization"]', '[property="datePosted"]', '[property="baseSalary"]', '[property="validThrough"]'],
        layout: [".job-posting-brief", ".job-posting-details-body", ".job-posting-detail-requirements"],
        cards: ['article[id^="article-"]'],
      }),
      headingsInPane: headings(document.querySelector("main")),
    };
  }

  globalThis.GJExtractors = globalThis.GJExtractors || {};
  globalThis.GJExtractors.jobbank = { name: "Job Bank", matches, currentJobId, extractDetail, findCards, debug };
})();
