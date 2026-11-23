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

  // Every adjustable value, with its default. The Settings page builds its Scoring
  // section from this list; saved changes arrive as ctx.weights ({ key: value }, only
  // the changed ones). Points: positive raises the risk score, negative lowers it.
  const P = (group, key, label, def, unit, min, max, step) => ({ group, key, label, def, unit, min, max, step: step || 1 });
  const PTS = [-100, 100];
  const PARAMS = [
    P("General", "base", "Starting score for every listing", 20, "pts", 0, 100),
    P("General", "turnoverPct", "High-turnover roles: age and repost points count at", 50, "%", 0, 100),

    P("Score bands", "bandCaution", "Proceed with Caution starts at", 35, "score", 1, 98),
    P("Score bands", "bandWaste", "Likely a Waste of Time starts at", 55, "score", 2, 99),
    P("Score bands", "bandSkip", "Skip This Job starts at", 75, "score", 3, 100),

    P("Posting age", "age3", "Posted 0–3 days ago", -8, "pts", ...PTS),
    P("Posting age", "age7", "Posted 4–7 days ago", -4, "pts", ...PTS),
    P("Posting age", "age14", "Posted 8–14 days ago", 0, "pts", ...PTS),
    P("Posting age", "age30", "Posted 15–30 days ago", 8, "pts", ...PTS),
    P("Posting age", "age60", "Posted 31–60 days ago", 18, "pts", ...PTS),
    P("Posting age", "age90", "Posted 61–90 days ago", 26, "pts", ...PTS),
    P("Posting age", "ageOld", "Posted over 90 days ago", 32, "pts", ...PTS),
    P("Posting age", "floor60", "Minimum score at 60+ days old", 40, "score", 0, 100),
    P("Posting age", "floor90", "Minimum score at 90+ days old", 55, "score", 0, 100),
    P("Posting age", "floor120", "Minimum score at 120+ days old", 75, "score", 0, 100),
    P("Posting age", "floorTurnover120", "Minimum score at 120+ days old, high-turnover roles", 40, "score", 0, 100),

    P("Reposts and applications", "reposted", "Marked as reposted", 14, "pts", ...PTS),
    P("Reposts and applications", "recycled", "Recycled listing, per matching listing you've seen", 7, "pts", ...PTS),
    P("Reposts and applications", "recycledMax", "Recycled listing, most it can add", 14, "pts", 0, 100),
    P("Reposts and applications", "applicants", "Heavy applicant volume on an old listing", 8, "pts", ...PTS),
    P("Reposts and applications", "applicantsMin", "Heavy volume means at least", 100, "applicants", 1, 100000),
    P("Reposts and applications", "applicantsDays", "Old listing (for applicant volume) means at least", 21, "days", 0, 365),
    P("Reposts and applications", "easyApplyOld", "Easy Apply on an old listing", 5, "pts", ...PTS),
    P("Reposts and applications", "easyApplyDays", "Old listing (for Easy Apply) means at least", 30, "days", 0, 365),

    P("Salary and who's posting", "salaryListed", "Salary listed", -6, "pts", ...PTS),
    P("Salary and who's posting", "salaryMissing", "No salary listed", 6, "pts", ...PTS),
    P("Salary and who's posting", "agency", "Staffing agency or job board", 12, "pts", ...PTS),
    P("Salary and who's posting", "offsite", "Apply sends you to another site", 4, "pts", ...PTS),

    P("Description", "descVeryShort", "Very short description", 12, "pts", ...PTS),
    P("Description", "descShort", "Short description", 5, "pts", ...PTS),
    P("Description", "descVeryShortLen", "Very short means under", 400, "characters", 0, 20000),
    P("Description", "descShortLen", "Short means under", 900, "characters", 0, 20000),
    P("Description", "descVeryShortLenStructured", "Very short means under (Job Bank bullet-point postings)", 150, "characters", 0, 20000),
    P("Description", "descShortLenStructured", "Short means under (Job Bank bullet-point postings)", 350, "characters", 0, 20000),
    P("Description", "placeholder", "Template placeholder left in", 15, "pts", ...PTS),
    P("Description", "vague", "Vague, generic wording", 6, "pts", ...PTS),
    P("Description", "vagueMin", "Vague means at least", 4, "phrases", 1, 30),
    P("Description", "seniority", "Junior title asking for senior experience", 10, "pts", ...PTS),
    P("Description", "seniorityYears", "Senior experience means at least", 5, "years", 1, 30),
    P("Description", "workplace", "Remote vs. on-site contradiction", 6, "pts", ...PTS),

    P("Employer", "hiringContact", "Hiring contact shown", -6, "pts", ...PTS),
    P("Employer", "responsive", "Responsive employer", -6, "pts", ...PTS),
    P("Employer", "activelyReviewing", "Actively reviewing applicants", -6, "pts", ...PTS),
    P("Employer", "urgent", "Urgently hiring", -2, "pts", ...PTS),
    P("Employer", "employerActive", "Employer recently active", -4, "pts", ...PTS),
    P("Employer", "employerActiveDays", "Recently active means within", 3, "days", 0, 365),
    P("Employer", "employerInactive", "Employer inactive", 8, "pts", ...PTS),
    P("Employer", "employerInactiveDays", "Inactive means not active for", 30, "days", 1, 365),
    P("Employer", "lowRating", "Low company rating", 6, "pts", ...PTS),
    P("Employer", "lowRatingBelow", "Low rating means below", 3.0, "stars", 0, 5, 0.1),
    P("Employer", "goodRating", "Good company rating", -3, "pts", ...PTS),
    P("Employer", "goodRatingFrom", "Good rating means at least", 4.0, "stars", 0, 5, 0.1),

    P("Your history and reports", "historyMin", "Blend in employer history after", 2, "other listings", 1, 100),
    P("Your history and reports", "historyMaxWeight", "Employer history weight, at 10+ listings", 50, "%", 0, 100),
    P("Your history and reports", "historyDownPct", "Strength when history would lower a score", 33, "%", 0, 100),
    P("Your history and reports", "reportGhost", "Per ghost flag you've given the employer", 6, "pts", ...PTS),
    P("Your history and reports", "reportGhostMax", "Ghost flags, most they can add", 18, "pts", 0, 100),
    P("Your history and reports", "reportNoResp", "Per never-heard-back or ghosted outcome", 4, "pts", ...PTS),
    P("Your history and reports", "reportNoRespMax", "Those outcomes, most they can add", 12, "pts", 0, 100),
    P("Your history and reports", "reportPositive", "Per interview or offer outcome", -4, "pts", ...PTS),
    P("Your history and reports", "reportPositiveMax", "Interviews and offers, most they can lower", 8, "pts", 0, 100),
  ];
  const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.key, p.def]));

  /** Defaults with valid saved changes applied (out-of-range values are clamped). */
  function weightsFrom(saved) {
    const w = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === "object") {
      for (const p of PARAMS) {
        const v = Number(saved[p.key]);
        if (saved[p.key] === null || saved[p.key] === "" || !Number.isFinite(v)) continue;
        w[p.key] = Math.min(p.max, Math.max(p.min, v));
      }
    }
    // Bands must go up in order.
    w.bandWaste = Math.max(w.bandWaste, w.bandCaution + 1);
    w.bandSkip = Math.min(100, Math.max(w.bandSkip, w.bandWaste + 1));
    return w;
  }

  const BAND_STYLE = [
    { key: "apply", label: "Worth Applying", color: "#1f9d55" },
    { key: "caution", label: "Proceed with Caution", color: "#d69e2e" },
    { key: "waste", label: "Likely a Waste of Time", color: "#dd6b20" },
    { key: "skip", label: "Skip This Job", color: "#c53030" },
  ];

  /** The four bands, each with `max` (highest score in it), for the given saved weights. */
  function bandsFor(saved) {
    const w = weightsFrom(saved);
    const maxes = [w.bandCaution - 1, w.bandWaste - 1, w.bandSkip - 1, 100];
    return BAND_STYLE.map((b, i) => Object.assign({ max: maxes[i] }, b));
  }

  const BANDS = bandsFor(null);

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

  function bandFor(score, saved) {
    const bands = saved ? bandsFor(saved) : BANDS;
    return bands.find((b) => score <= b.max) || bands[bands.length - 1];
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
    const W = weightsFrom(ctx.weights);
    const highTurnover = HIGH_TURNOVER_RE.test(title);
    const turnoverMult = highTurnover ? W.turnoverPct / 100 : 1;
    let floor = 0;

    if (highTurnover) {
      add("turnover", "High-turnover role", "Frequent reposting is normal here, so age and repost signals count less.", 0);
    }

    // --- Posting age -------------------------------------------------------
    if (isKnown(L.ageDays)) {
      const d = L.ageDays;
      let pts;
      if (d <= 3) pts = W.age3;
      else if (d <= 7) pts = W.age7;
      else if (d <= 14) pts = W.age14;
      else if (d <= 30) pts = W.age30;
      else if (d <= 60) pts = W.age60;
      else if (d <= 90) pts = W.age90;
      else pts = W.ageOld;
      pts = pts > 0 ? Math.round(pts * turnoverMult) : pts;
      add("age", "Posting age", `Posted ${fmtAge(d)}${L.ageApprox ? " (approximate)" : ""}.`, pts);

      if (!highTurnover) {
        if (d >= 120) floor = Math.max(floor, W.floor120);
        else if (d >= 90) floor = Math.max(floor, W.floor90);
        else if (d >= 60) floor = Math.max(floor, W.floor60);
      } else if (d >= 120) {
        floor = Math.max(floor, W.floorTurnover120);
      }
    } else {
      unknown("Posting age");
    }

    // --- Reposts -------------------------------------------------------------
    if (L.reposted === true) {
      add("repost", "Reposted listing", "The platform marks this listing as reposted.", Math.round(W.reposted * (W.reposted > 0 ? turnoverMult : 1)));
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
        const pts = Math.round(Math.min(W.recycledMax, dupes.size * W.recycled) * turnoverMult);
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
      if (L.applicants >= W.applicantsMin && isKnown(L.ageDays) && L.ageDays >= W.applicantsDays) {
        add("applicants", "Heavy applicant volume", `${L.applicantsText || L.applicants + "+ applicants"} on a listing that's still open after ${Math.round(L.ageDays)} days.`, W.applicants);
      } else if (L.applicants >= W.applicantsMin) {
        add("applicants", "Applicant volume", L.applicantsText || `${L.applicants}+ applicants`, 0);
      }
    }
    if (L.easyApply === true && isKnown(L.ageDays) && L.ageDays >= W.easyApplyDays) {
      add("easyapply-old", "Easy Apply on an old listing", `One-click applications on a posting this old (${Math.round(L.ageDays)} days) often pile up unread.`, W.easyApplyOld);
    }

    // --- Salary ------------------------------------------------------------
    if (L.salaryListed === true) {
      add("salary", "Salary listed", L.salaryText ? L.salaryText : "Pay range is disclosed.", W.salaryListed);
    } else if (L.salaryListed === false) {
      add("salary", "No salary listed", "No pay information on the listing.", W.salaryMissing);
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
        W.agency
      );
    }

    // --- Description quality ----------------------------------------------------
    if (desc !== null) {
      const text = desc.replace(/\s+/g, " ").trim();
      const len = text.length;
      // Structured postings (Job Bank's bullet lists) are naturally terser than free text.
      const [veryShort, short] = L.descStructured
        ? [W.descVeryShortLenStructured, W.descShortLenStructured]
        : [W.descVeryShortLen, W.descShortLen];
      if (len < veryShort) add("desc-short", "Very short description", `Only ${len} characters.`, W.descVeryShort);
      else if (len < short) add("desc-short", "Short description", `${len} characters.`, W.descShort);

      if (PLACEHOLDER_RE.test(text)) {
        const m = text.match(PLACEHOLDER_RE);
        add("placeholder", "Template placeholder left in", `Found "${m[0].slice(0, 40)}".`, W.placeholder);
      }

      const lower = text.toLowerCase();
      const vague = VAGUE_PHRASES.filter((p) => lower.includes(p));
      if (vague.length >= W.vagueMin) {
        add("vague", "Vague, generic wording", `Phrases like "${vague.slice(0, 3).join('", "')}".`, W.vague);
      }

      // Seniority mismatch
      if (JUNIOR_TITLE_RE.test(title)) {
        let maxYears = 0;
        let m;
        SENIOR_REQ_RE.lastIndex = 0;
        while ((m = SENIOR_REQ_RE.exec(text))) maxYears = Math.max(maxYears, parseInt(m[1], 10));
        if (maxYears >= W.seniorityYears || /\bsenior[- ]level\b/i.test(text)) {
          add("seniority", "Seniority mismatch", `Junior-sounding title but asks for ${maxYears >= W.seniorityYears ? maxYears + "+ years" : "senior-level"} experience.`, W.seniority);
        }
      }

      // Work arrangement contradiction
      if (L.workplace === "remote" && /\b(on[- ]site|in[- ]office|in the office)\b[^.]{0,40}\b(\d|five|four|required|daily|days)\b|\bmust (live|reside) within\b|\bcommuting distance\b|\brelocat(e|ion) (to|is) required\b/i.test(text)) {
        add("workplace", "Remote vs. on-site contradiction", "Listed as remote, but the description asks for office presence.", W.workplace);
      } else if (L.workplace === "onsite" && /\b(100%|fully|completely) remote\b/i.test(text)) {
        add("workplace", "On-site vs. remote contradiction", "Listed as on-site, but the description says fully remote.", W.workplace);
      }
    } else if (!L.preview) {
      unknown("Description");
    }

    // --- Contact / responsiveness -------------------------------------------------
    if (L.hiringContact === true) add("contact", "Hiring contact shown", "A named recruiter or hiring manager is attached.", W.hiringContact);
    if (L.responsiveEmployer === true) add("responsive", "Responsive employer", L.responsiveText || "The platform reports this employer responds to applicants.", W.responsive);
    if (isKnown(L.employerActiveDays)) {
      const d = L.employerActiveDays;
      if (d <= W.employerActiveDays) add("employer-active", "Employer recently active", `Employer active ${fmtAge(d)}.`, W.employerActive);
      else if (d >= W.employerInactiveDays) add("employer-active", "Employer inactive", `Employer last active ${fmtAge(d)}.`, W.employerInactive);
    }

    // --- Engagement ---------------------------------------------------------------
    if (L.activelyReviewing === true) add("engagement", "Actively reviewing applicants", "The platform says the employer is actively reviewing.", W.activelyReviewing);
    if (L.urgentlyHiring === true) add("urgent", "Urgently hiring", "Marked as urgently hiring.", W.urgent);

    // --- Off-platform apply ------------------------------------------------------
    if (L.externalApply === true) add("offsite", "Apply redirects off-platform", "You'll be sent to an external site to apply.", W.offsite);

    // --- Company rating (Indeed) ---------------------------------------------------
    if (isKnown(L.companyRating)) {
      const where = `${L.companyRating.toFixed(1)} / 5 on ${L.ratingSource || "Indeed"}.`;
      if (L.companyRating < W.lowRatingBelow) add("rating", "Low company rating", where, W.lowRating);
      else if (L.companyRating >= W.goodRatingFrom) add("rating", "Good company rating", where, W.goodRating);
      else add("rating", "Company rating", where, 0);
    }

    if (L.partnerSource) {
      add("partner", "Copied from another job site", `Job Bank is showing a summary of a ${L.partnerSource} posting.`, 0);
    }

    // --- Closed --------------------------------------------------------------------
    if (L.closed === true) add("closed", "No longer accepting applications", "This listing is closed.", 0);

    // --- Raw listing score ------------------------------------------------------
    let raw = W.base + signals.reduce((s, x) => s + x.points, 0);
    raw = Math.max(0, Math.min(100, raw));
    if (raw < floor) {
      add("floor", "Age floor applied", `Listings this old score at least ${floor}.`, floor - raw);
      raw = floor;
    }

    // --- Employer history (blend) ----------------------------------------------
    let final = raw;
    if (hist && Array.isArray(hist.listings)) {
      const others = hist.listings.filter((x) => x.id !== L.id && typeof x.score === "number");
      if (others.length >= W.historyMin) {
        const avg = others.reduce((s, x) => s + x.score, 0) / others.length;
        // Thin records weigh little; full weight from 10 listings.
        const weight = (Math.min(others.length, 10) / 10) * (W.historyMaxWeight / 100);
        let delta = (avg - raw) * weight;
        // History raises more easily than it lowers (default: a third of the strength).
        if (delta < 0) delta *= W.historyDownPct === 33 ? 1 / 3 : W.historyDownPct / 100;
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
      const capped = (n, per, cap) => Math.max(-cap, Math.min(cap, n * per));
      const delta =
        capped(ghost, W.reportGhost, W.reportGhostMax) +
        capped(noResp, W.reportNoResp, W.reportNoRespMax) +
        capped(positive, W.reportPositive, W.reportPositiveMax);
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
      band: bandFor(final, ctx.weights),
      signals,
      unknowns,
      highTurnover,
    };
  }

  globalThis.GJScoring = { score, bandFor, bandsFor, weightsFrom, BANDS, PARAMS, DEFAULTS, normalize, employerKey };
})();
