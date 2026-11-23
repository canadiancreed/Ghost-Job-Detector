# Ghost Job Detector for Firefox

**Version 1.1.0**

Ghost Job Detector is a Firefox extension that rates job listings from 0 to 100 for "ghost job" risk. A ghost job is a listing that is old, recycled, or unlikely to lead to a hire. The extension shows a score on each listing you open, along with every reason behind it, so you can decide whether a job is worth your time before you apply.

Everything runs in your browser. Nothing is sent anywhere.

## Inspiration and credit

This project was inspired by **[Skip This Job — Ghost Job Detector](https://chromewebstore.google.com/detail/skip-this-job-%E2%80%94-ghost-job/nodldfdkjomniknohmejdimjlejfongd)**, a Chrome extension by Vibe Labs Marketing. Its idea of scoring listings for ghost-job risk and showing the signals behind each score is what this project is based on. Thank you to its creators.

Ghost Job Detector for Firefox is an independent project. No code was copied from the original, and it isn't affiliated with, endorsed by, or supported by Vibe Labs Marketing. The original uses an online service for crowd-sourced employer data; this version works entirely offline (see [Privacy](#privacy)).

## Supported sites

| Site | Pages |
|---|---|
| LinkedIn | Job search (two-pane view, classic and newer layouts), individual job pages, and logged-out job pages |
| Indeed | Job search pane and individual `/viewjob` pages |
| Job Bank (jobbank.gc.ca) | Job posting pages, both postings made directly on Job Bank and copies of postings from other sites. English pages only. |
| Monster (monster.com, monster.ca) | Job pages. Less tested than the others. |

## What's needed to install

The extension is made up of these files and folders only:

| Item | Contents |
|---|---|
| `manifest.json` | Tells Firefox what the extension is and which sites it runs on |
| `icons/` | Toolbar icon |
| `src/` | Scoring, the page readers for each job site, and the Ghost Risk card |
| `popup/` | The toolbar popup |
| `options/` | The Settings page |

## Install

### Temporary install (no signing needed)

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in the extension's folder.

A temporary add-on is removed when Firefox restarts, so you'll need to load it again each session.

### Permanent install

Firefox only keeps add-ons that Mozilla has signed.

1. Make a `.zip` of the five items listed above. Zip the items themselves, not the folder that holds them, so `manifest.json` sits at the top level of the zip.
2. Upload the zip to [addons.mozilla.org](https://addons.mozilla.org/developers/) for signing. Choose **On your own** distribution if you don't want a public listing.
3. Install the signed `.xpi` file it gives you (drag it into Firefox, or open it from `about:addons` → ⚙ → **Install Add-on From File…**).

### Site access

Firefox may ask you to allow the extension on the job sites. If the toolbar popup shows **Grant access**, click it, then reload any job-site tabs that were already open.

## How to use it

1. **Open a job listing** on a supported site. In a search, click a job so it opens in the side panel.
2. **Wait a moment.** Job sites load a listing in stages, so the extension waits until the details stop changing (usually 1–2 seconds) before scoring. You'll see one score per listing; it doesn't jump around while the page loads.
3. **Read the Ghost Risk card.** It appears under the job's header and shows:
   - the score and its band (default cut-offs; you can change them in [Settings](#scoring-editor)):

     | Score | Band |
     |---|---|
     | 0–34 | Worth Applying |
     | 35–54 | Proceed with Caution |
     | 55–74 | Likely a Waste of Time |
     | 75–100 | Skip This Job |

   - the signals that raised or lowered the score, each with its points (click **Show all** to see every signal)
   - anything the page didn't show, such as a missing posting date, listed as unknown. Unknowns are never counted against a listing.
4. **Check the toolbar button.** The extension's icon shows the current listing's score. Click it for a popup with the same score and signals, a **Rescan** button, and a quick flag button.
5. **Tell it what you think, if you like.** Your input only affects your own scores:
   - **🚩 Flag Ghost Job**: mark a listing as constantly reposted, seemingly already filled, lacking real details, fake or a scam, or other.
   - **📝 Report Outcome**: after applying, record whether you never heard back, were auto-rejected, were ghosted after an interview, got an interview, or got an offer.
   - When you click a site's **Apply** button, the card later reminds you to report how it went.

   Flags and bad outcomes raise future scores for that employer. Interviews and offers lower them.

### If something doesn't look right

- **No card appears:** reload the tab (pages opened before the extension was loaded or updated don't have it yet), and check the popup for **Grant access**.
- **A detail looks wrong:** job sites change their layouts often. Click **Copy diagnostics** in the popup to get a summary of what the extension read from the page.

## Settings

Open Settings with the **⚙** button in the toolbar popup, or from `about:addons`: click **⋯** next to Ghost Job Detector and choose **Options** (called **Preferences** in some Firefox versions). Every change is saved as soon as you make it; there's no Save button.

### Display

- **Show the Ghost Risk card on job listings**: turn the card off if you only want the toolbar score.
- **Show the score on the toolbar icon**
- **Start the card collapsed**: the card opens showing just the score and band; click ▾ on the card to see the signals.
- **Card placement**: inline under the job header, or floating in the bottom-right corner.

### Site access

Shows whether the extension is allowed on the job sites, with a button to grant access if it isn't.

### Your data

Shows how many listings, employers, flags and outcome reports are stored, and lets you:

- **Export JSON**: save everything (history, reports and settings, including your scoring changes) to a file.
- **Import JSON**: load a file you exported. Matching records are replaced.
- **Clear employer history**: forget the listings you've viewed. Your flags and reports are kept.
- **Clear your reports**: delete your flags, outcome reports and apply-click records. This can't be undone.

### Scoring editor

The **Scoring** section lets you change how listings are scored. It has about 60 values in groups. Click a group's name to open it.

Each row shows:

- what the value controls, with its **default** underneath
- a box for the value, and its unit (points, days, characters, %, stars and so on)
- a **Reset** button, which appears once you've changed the value

There are two kinds of value:

- **Points** decide how much a signal counts. Above zero raises the risk score, below zero lowers it. Set a signal to **0** to turn it off.
- **Thresholds** decide when a signal applies, for example how short a description must be to count as short.

How editing works:

- A change is saved when you leave the box (press Tab or click elsewhere). "Saved" appears at the bottom of the section.
- The listing that's open in your job-site tab is re-scored straight away, and so is every listing after it. The toolbar popup's band colours follow your band cut-offs.
- Values outside the allowed range are changed to the nearest allowed value, and the box shows what was saved.
- Band starting points are kept in order. For example, if you move **Proceed with Caution** above **Likely a Waste of Time**, the later bands are moved up to follow it.
- Changed values are shown in bold and outlined. Each group's heading shows how many of its values are changed, and the top of the section shows the total.
- **Reset all to defaults** puts every value back after asking you to confirm.

#### Values you can change

Points are shown as signed numbers: **+** raises the risk score, **−** lowers it.

**General**

| Value | Default |
|---|---|
| Starting score for every listing | 20 |
| High-turnover roles: age and repost points count at | 50% |

**Score bands**

| Value | Default |
|---|---|
| Proceed with Caution starts at | 35 |
| Likely a Waste of Time starts at | 55 |
| Skip This Job starts at | 75 |

**Posting age**

| Value | Default |
|---|---|
| Posted 0–3 days ago | −8 |
| Posted 4–7 days ago | −4 |
| Posted 8–14 days ago | 0 |
| Posted 15–30 days ago | +8 |
| Posted 31–60 days ago | +18 |
| Posted 61–90 days ago | +26 |
| Posted over 90 days ago | +32 |
| Minimum score at 60+ days old | 40 |
| Minimum score at 90+ days old | 55 |
| Minimum score at 120+ days old | 75 |
| Minimum score at 120+ days old, high-turnover roles | 40 |

**Reposts and applications**

| Value | Default |
|---|---|
| Marked as reposted | +14 |
| Recycled listing, per matching listing you've seen | +7 |
| Recycled listing, most it can add | 14 |
| Heavy applicant volume on an old listing | +8 |
| Heavy volume means at least | 100 applicants |
| Old listing (for applicant volume) means at least | 21 days |
| Easy Apply on an old listing | +5 |
| Old listing (for Easy Apply) means at least | 30 days |

**Salary and who's posting**

| Value | Default |
|---|---|
| Salary listed | −6 |
| No salary listed | +6 |
| Staffing agency or job board | +12 |
| Apply sends you to another site | +4 |

**Description**

| Value | Default |
|---|---|
| Very short description | +12 |
| Short description | +5 |
| Very short means under | 400 characters |
| Short means under | 900 characters |
| Very short means under (Job Bank bullet-point postings) | 150 characters |
| Short means under (Job Bank bullet-point postings) | 350 characters |
| Template placeholder left in | +15 |
| Vague, generic wording | +6 |
| Vague means at least | 4 phrases |
| Junior title asking for senior experience | +10 |
| Senior experience means at least | 5 years |
| Remote vs. on-site contradiction | +6 |

**Employer**

| Value | Default |
|---|---|
| Hiring contact shown | −6 |
| Responsive employer | −6 |
| Actively reviewing applicants | −6 |
| Urgently hiring | −2 |
| Employer recently active | −4 |
| Recently active means within | 3 days |
| Employer inactive | +8 |
| Inactive means not active for | 30 days |
| Low company rating | +6 |
| Low rating means below | 3.0 stars |
| Good company rating | −3 |
| Good rating means at least | 4.0 stars |

**Your history and reports**

| Value | Default |
|---|---|
| Blend in employer history after | 2 other listings |
| Employer history weight, at 10+ listings | 50% |
| Strength when history would lower a score | 33% |
| Per ghost flag you've given the employer | +6 |
| Ghost flags, most they can add | 18 |
| Per never-heard-back or ghosted outcome | +4 |
| Those outcomes, most they can add | 12 |
| Per interview or offer outcome | −4 |
| Interviews and offers, most they can lower | 8 |

The word lists the extension matches against (staffing agency names, vague phrases and high-turnover job titles) aren't in the editor. They can only be changed in `src/scoring.js`.

## How scoring works

With the default values, each listing starts at 20 points and moves up or down based on what the page shows:

- **Posting age**: fresh listings score lower; old ones higher, with minimum scores at 60, 90 and 120 days.
- **Reposts and recycling**: listings marked as reposted, and listings you've already seen from the same employer with the same title and location.
- **Applications**: very high applicant counts on listings that have been open for weeks, and one-click "Easy Apply" on month-old listings.
- **Salary**: whether pay is listed, in the header or in the description.
- **Who's posting**: staffing agencies and job boards ("our client is seeking…").
- **Description quality**: very short descriptions, vague boilerplate, leftover template placeholders like "[Company Name]", and junior titles that ask for senior experience.
- **Employer engagement**: named hiring contacts, "responsive employer" and "actively reviewing" labels, and how recently the employer was active.
- **Other**: company ratings (Indeed), apply buttons that send you to another site, and remote listings whose description asks for office attendance (or the reverse).

On top of that:

- **Your history**: the average score of other listings you've opened from the same employer is blended in. A few listings count for little, and history raises a score more easily than it lowers it.
- **Your reports**: your flags and outcomes for that employer.
- **High-turnover roles** (baristas, warehouse staff, nursing assistants and similar) are scored more leniently on age and reposts, since these jobs are posted continuously for good reasons.

Job Bank also notes when a posting is a copy from another site, and scores its structured bullet-point postings on a gentler length scale.

Scores are estimates based on patterns, not verdicts about any employer or listing.

## Privacy

- All scoring happens in your browser.
- Your employer history, flags, outcome reports and settings are stored only in Firefox's local extension storage on your computer.
- Nothing is sent to any server. The extension declares that it collects no data (`data_collection_permissions: none`).
- You can export or delete your data at any time from Settings.

## No support, warranty or guarantee

This software is provided **as is**, without support of any kind. No warranty or guarantee is offered, express or implied, including any warranty of merchantability, fitness for a particular purpose, accuracy, or non-infringement.

Scores are automated estimates and may be wrong. They aren't a statement of fact about any employer or job listing, and shouldn't be your only basis for deciding whether to apply. Job sites change often and the extension may stop working on any of them at any time. You use it at your own risk; the authors aren't liable for any decision, loss, or damage arising from its use.
