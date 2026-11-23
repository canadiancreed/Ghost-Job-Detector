/* Ghost-risk scoring. Pure functions, no DOM access.
 * Exposes globalThis.GJScoring.
 *
 * A listing object has these (all optional; null/undefined = "page didn't show it"):
 *   platform, id, title, company, location,
 *   ageDays, reposted, applicants, easyApply, externalApply,
 *   salaryListed, description, hiringContact, responsiveEmployer,
 *   activelyReviewing, urgentlyHiring, employerActiveDays,
 *   companyRating, workplace ("remote"|"hybrid"|"onsite"), closed, preview
 *
 * Missing information is never counted against a listing; it is reported in `unknowns`.
 */
(function () {
  "use strict";

  const BASE = 20;

  const BANDS = [
    { max: 34, key: "apply", label: "Worth Applying", color: "#1f9d55" },
    { max: 54, key: "caution", label: "Proceed with Caution", color: "#d69e2e" },
    { max: 74, key: "waste", label: "Likely a Waste of Time", color: "#dd6b20" },
    { max: 100, key: "skip", label: "Skip This Job", color: "#c53030" },
  ];

  const HIGH_TURNOVER_RE = new RegExp(
    [
      "barista", "cashier", "crew member", "team member", "warehouse", "picker", "packer",
      "package handler", "material handler", "forklift", "delivery driver", "truck driver",
      "\\bcdl\\b", "driver", "nursing assistant", "\\bcna\\b", "caregiver", "home health aide",
      "personal care aide", "\\bserver\\b", "bartender", "line cook", "prep cook", "\\bcook\\b",
      "dishwasher", "housekeep", "janitor", "custodian", "retail", "sales associate",
      "store associate", "stocker", "merchandiser", "customer service rep", "call center",
      "security officer", "security guard", "food service", "\\bhost(ess)?\\b", "lifeguard",
      "medical assistant", "phlebotom", "patient care tech", "registered nurse", "\\brn\\b",
      "\\blpn\\b", "\\bcrna\\b", "travel nurse", "dental assistant", "pharmacy tech",
      "teller", "receptionist", "front desk", "dock worker", "loader", "unloader",
      "assembler", "production worker", "machine operator", "general labor",
    ].join("|"),
    "i"
  );

  const STAFFING_NAME_RE = new RegExp(
    [
      "staffing", "recruit", "\\btalent\\b", "personnel", "workforce", "\\bsearch\\b",
      "headhunt", "placement", "employment agency", "\\bhiring\\b", "\\bjobs\\b", "careers?\\b",
      "robert half", "randstad", "adecco", "kforce", "teksystems", "insight global", "aerotek",
      "manpower", "kelly services", "apex systems", "cybercoders", "jobot", "dice\\b",
      "motion recruitment", "hays\\b", "michael page", "beacon hill", "actalent", "allegis",
      "express employment", "spherion", "volt\\b", "addison group", "vaco\\b", "creative circle",
      "lucas group", "korn ferry", "hirequest", "peoplelink", "tandym", "experis",
      "\\bcrossover\\b", "dataannotation", "outlier\\b", "mercor\\b", "turing\\b", "toptal",
      "jooble", "lensa", "talentify", "jobgether", "recruitics", "clickjobs", "\\bhireology\\b",
    ].join("|"),
    "i"
  );

  const AGENCY_DESC_RE =
    /\b(our client|on behalf of (our|a) client|confidential client|client company|for a client|our (fortune|leading) .{0,30} client|we are (a|an) (staffing|recruiting) (firm|agency))\b/i;

  const VAGUE_PHRASES = [
    "fast-paced environment", "fast paced environment", "rockstar", "rock star", "ninja",
    "guru", "self-starter", "self starter", "wear many hats", "other duties as assigned",
    "various duties", "competitive salary", "competitive pay", "competitive compensation",
    "dynamic team", "dynamic environment", "work hard play hard", "synergy", "go-getter",
    "passionate individual", "exciting opportunity", "great opportunity", "family environment",
    "like a family", "unlimited earning", "unlimited income", "be your own boss",
    "make a difference", "hit the ground running", "detail-oriented", "team player",
    "growing company", "immediate start", "no experience necessary",
  ];

  const PLACEHOLDER_RE =
    /(\[(company|company name|insert|job title|location|salary|city|name)[^\]]*\]|\{\{[^}]*\}\}|<\s*insert|lorem ipsum|\bxxx+\b|\bTBD\b|\bTBA\b|\[\s*\]|%[A-Z_]{3,}%)/i;

  const JUNIOR_TITLE_RE =
    /(\b(entry[- ]level|junior|jr|new grad|graduate|intern|trainee|apprentice|level 1)\b|\s(I|1)$)/i;
  const SENIOR_REQ_RE = /\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)\b[^.]{0,40}\b(experience|exp)\b/gi;

  function bandFor(score) {
    return BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];
  }

  function normalize(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9+#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function employerKey(company) {
    return normalize(company)
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|the|group|holdings)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isKnown(v) {
    return v !== null && v !== undefined;
  }

  function fmtAge(days) {
    if (days < 1) return "today";
    if (days < 14) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  }

  /**
   * @param {object} L listing
   * @param {object} ctx { history: {listings:[...]}, flags: {...}, listingFlags: {...} }
   */
  function score(L, ctx) {
    ctx = ctx || {};
    const signals = [];
    const unknowns = [];
    const add = (id, label, detail, points) => {
      signals.push({ id, label, detail, points, tone: points > 0 ? "bad" : points < 0 ? "good" : "neutral" });
    };
    const unknown = (label) => unknowns.push(label);

    const title = L.title || "";
    const desc = typeof L.description === "string" ? L.description : null;
    const highTurnover = HIGH_TURNOVER_RE.test(title);
    const turnoverMult = highTurnover ? 0.5 : 1;
    let floor = 0;

    if (highTurnover) {
      add("turnover", "High-turnover role", "Frequent reposting is normal here, so age and repost signals count less.", 0);
    }

    // --- Posting age -------------------------------------------------------
    if (isKnown(L.ageDays)) {
      const d = L.ageDays;
      let pts;
      if (d <= 3) pts = -8;
      else if (d <= 7) pts = -4;
      else if (d <= 14) pts = 0;
      else if (d <= 30) pts = 8;
      else if (d <= 60) pts = 18;
      else if (d <= 90) pts = 26;
      else pts = 32;
      pts = pts > 0 ? Math.round(pts * turnoverMult) : pts;
      add("age", "Posting age", `Posted ${fmtAge(d)}${L.ageApprox ? " (approximate)" : ""}.`, pts);

      if (!highTurnover) {
        if (d >= 120) floor = Math.max(floor, 75);
        else if (d >= 90) floor = Math.max(floor, 55);
        else if (d >= 60) floor = Math.max(floor, 40);
      } else if (d >= 120) {
        floor = Math.max(floor, 40);
      }
    } else {
      unknown("Posting age");
    }

    // --- Reposts -------------------------------------------------------------
    if (L.reposted === true) {
      add("repost", "Reposted listing", "The platform marks this listing as reposted.", Math.round(14 * turnoverMult));
    }
    const hist = ctx.history;
    if (hist && Array.isArray(hist.listings) && L.title) {
      const t = normalize(L.title);
      const loc = normalize(L.location);
      const dupes = new Set(
        hist.listings
          .filter((x) => x.id !== L.id && x.platform === L.platform && x.normTitle === t && (x.normLoc || "") === loc)
          .map((x) => x.id)
      );
      if (dupes.size > 0) {
        const pts = Math.round(Math.min(14, dupes.size * 7) * turnoverMult);
        add(
          "recycled",
          "Recycled listing",
          `You've seen ${dupes.size} other listing${dupes.size === 1 ? "" : "s"} from this employer with the same title and location.`,
          pts
        );
      }
    }

    // --- Applicant volume / Easy Apply on old listings -------------------------
    if (isKnown(L.applicants)) {
      if (L.applicants >= 100 && isKnown(L.ageDays) && L.ageDays >= 21) {
        add("applicants", "Heavy applicant volume", `${L.applicantsText || L.applicants + "+ applicants"} on a listing that's still open after ${Math.round(L.ageDays)} days.`, 8);
      } else if (L.applicants >= 100) {
        add("applicants", "Applicant volume", L.applicantsText || `${L.applicants}+ applicants`, 0);
      }
    }
    if (L.easyApply === true && isKnown(L.ageDays) && L.ageDays >= 30) {
      add("easyapply-old", "Easy Apply on an old listing", "One-click applications on a month-old posting often pile up unread.", 5);
    }

    // --- Salary ------------------------------------------------------------
    if (L.salaryListed === true) {
      add("salary", "Salary listed", L.salaryText ? L.salaryText : "Pay range is disclosed.", -6);
    } else if (L.salaryListed === false) {
      add("salary", "No salary listed", "No pay information on the listing.", 6);
    } else {
      unknown("Salary");
    }

    // --- Staffing agencies / job boards ---------------------------------------
    const agencyByName = L.company && STAFFING_NAME_RE.test(L.company);
    const agencyByDesc = desc && AGENCY_DESC_RE.test(desc);
    if (agencyByName || agencyByDesc) {
      add(
        "agency",
        "Posted by a staffing agency or job board",
        agencyByDesc ? "The description says it is hiring for a client." : `"${L.company}" looks like a recruiter or aggregator.`,
        12
      );
    }

    // --- Description quality ----------------------------------------------------
    if (desc !== null) {
      const text = desc.replace(/\s+/g, " ").trim();
      const len = text.length;
      // Structured postings (Job Bank's bullet lists) are naturally terser than free text.
      const [veryShort, short] = L.descStructured ? [150, 350] : [400, 900];
      if (len < veryShort) add("desc-short", "Very short description", `Only ${len} characters.`, 12);
      else if (len < short) add("desc-short", "Short description", `${len} characters.`, 5);

      if (PLACEHOLDER_RE.test(text)) {
        const m = text.match(PLACEHOLDER_RE);
        add("placeholder", "Template placeholder left in", `Found "${m[0].slice(0, 40)}".`, 15);
      }

      const lower = text.toLowerCase();
      const vague = VAGUE_PHRASES.filter((p) => lower.includes(p));
      if (vague.length >= 4) {
        add("vague", "Vague, generic wording", `Phrases like "${vague.slice(0, 3).join('", "')}".`, 6);
      }

      // Seniority mismatch
      if (JUNIOR_TITLE_RE.test(title)) {
        let maxYears = 0;
        let m;
        SENIOR_REQ_RE.lastIndex = 0;
        while ((m = SENIOR_REQ_RE.exec(text))) maxYears = Math.max(maxYears, parseInt(m[1], 10));
        if (maxYears >= 5 || /\bsenior[- ]level\b/i.test(text)) {
          add("seniority", "Seniority mismatch", `Junior-sounding title but asks for ${maxYears >= 5 ? maxYears + "+ years" : "senior-level"} experience.`, 10);
        }
      }

      // Work arrangement contradiction
      if (L.workplace === "remote" && /\b(on[- ]site|in[- ]office|in the office)\b[^.]{0,40}\b(\d|five|four|required|daily|days)\b|\bmust (live|reside) within\b|\bcommuting distance\b|\brelocat(e|ion) (to|is) required\b/i.test(text)) {
        add("workplace", "Remote vs. on-site contradiction", "Listed as remote, but the description asks for office presence.", 6);
      } else if (L.workplace === "onsite" && /\b(100%|fully|completely) remote\b/i.test(text)) {
        add("workplace", "On-site vs. remote contradiction", "Listed as on-site, but the description says fully remote.", 6);
      }
    } else if (!L.preview) {
      unknown("Description");
    }

    // --- Contact / responsiveness -------------------------------------------------
    if (L.hiringContact === true) add("contact", "Hiring contact shown", "A named recruiter or hiring manager is attached.", -6);
    if (L.responsiveEmployer === true) add("responsive", "Responsive employer", L.responsiveText || "The platform reports this employer responds to applicants.", -6);
    if (isKnown(L.employerActiveDays)) {
      const d = L.employerActiveDays;
      if (d <= 3) add("employer-active", "Employer recently active", `Employer active ${fmtAge(d)}.`, -4);
      else if (d >= 30) add("employer-active", "Employer inactive", `Employer last active ${fmtAge(d)}.`, 8);
    }

    // --- Engagement ---------------------------------------------------------------
    if (L.activelyReviewing === true) add("engagement", "Actively reviewing applicants", "The platform says the employer is actively reviewing.", -6);
    if (L.urgentlyHiring === true) add("urgent", "Urgently hiring", "Marked as urgently hiring.", -2);

    // --- Off-platform apply ------------------------------------------------------
    if (L.externalApply === true) add("offsite", "Apply redirects off-platform", "You'll be sent to an external site to apply.", 4);

    // --- Company rating (Indeed) ---------------------------------------------------
    if (isKnown(L.companyRating)) {
      const where = `${L.companyRating.toFixed(1)} / 5 on ${L.ratingSource || "Indeed"}.`;
      if (L.companyRating < 3.0) add("rating", "Low company rating", where, 6);
      else if (L.companyRating >= 4.0) add("rating", "Good company rating", where, -3);
      else add("rating", "Company rating", where, 0);
    }

    if (L.partnerSource) {
      add("partner", "Copied from another job site", `Job Bank is showing a summary of a ${L.partnerSource} posting.`, 0);
    }

    // --- Closed --------------------------------------------------------------------
    if (L.closed === true) add("closed", "No longer accepting applications", "This listing is closed.", 0);

    // --- Raw listing score ------------------------------------------------------
    let raw = BASE + signals.reduce((s, x) => s + x.points, 0);
    raw = Math.max(0, Math.min(100, raw));
    if (raw < floor) {
      add("floor", "Age floor applied", `Listings this old score at least ${floor}.`, floor - raw);
      raw = floor;
    }

    // --- Employer history (blend) ----------------------------------------------
    let final = raw;
    if (hist && Array.isArray(hist.listings)) {
      const others = hist.listings.filter((x) => x.id !== L.id && typeof x.score === "number");
      if (others.length >= 2) {
        const avg = others.reduce((s, x) => s + x.score, 0) / others.length;
        const weight = Math.min(others.length, 10) / 20; // thin records weigh little (max 0.5)
        let delta = (avg - raw) * weight;
        if (delta < 0) delta /= 3; // history raises more easily than it lowers
        delta = Math.round(delta);
        if (delta !== 0) {
          add(
            "employer-history",
            "Employer's other listings",
            `Average ${Math.round(avg)} across ${others.length} other listing${others.length === 1 ? "" : "s"} you've viewed.`,
            delta
          );
          final += delta;
        }
      }
    }

    // --- Your reports ---------------------------------------------------------------
    const f = ctx.flags || {};
    const ghost = f.ghost || 0;
    const noResp = f.noResponse || 0;
    const positive = f.positive || 0;
    if (ghost || noResp || positive) {
      const delta = Math.min(18, ghost * 6) + Math.min(12, noResp * 4) - Math.min(8, positive * 4);
      if (delta !== 0) {
        const parts = [];
        if (ghost) parts.push(`${ghost} ghost flag${ghost === 1 ? "" : "s"}`);
        if (noResp) parts.push(`${noResp} no-response outcome${noResp === 1 ? "" : "s"}`);
        if (positive) parts.push(`${positive} positive outcome${positive === 1 ? "" : "s"}`);
        add("reports", "Your reports on this employer", parts.join(", ") + ".", delta);
        final += delta;
      }
    }

    final = Math.max(0, Math.min(100, Math.round(final)));
    signals.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

    return {
      score: final,
      band: bandFor(final),
      signals,
      unknowns,
      highTurnover,
    };
  }

  globalThis.GJScoring = { score, bandFor, BANDS, normalize, employerKey };
})();
