# Ghost Job Detector for Firefox

**Version 1.0.0**

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

## Install

### Temporary install (no signing needed)

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder (or the packaged `.zip` file from `dist/`).

A temporary add-on is removed when Firefox restarts, so you'll need to load it again each session.

### Permanent install

Firefox only keeps add-ons that Mozilla has signed. To keep it permanently, upload the packaged `.zip` (see [Build a package](#build-a-package)) to [addons.mozilla.org](https://addons.mozilla.org/developers/) for signing. Choose **On your own** distribution if you don't want a public listing, then install the signed file it gives you.

### Site access

Firefox may ask you to allow the extension on the job sites. If the toolbar popup shows **Grant access**, click it, then reload any job-site tabs that were already open.

## How to use it

1. **Open a job listing** on a supported site. In a search, click a job so it opens in the side panel.
2. **Wait a moment.** Job sites load a listing in stages, so the extension waits until the details stop changing (usually 1–2 seconds) before scoring. You'll see one score per listing; it doesn't jump around while the page loads.
3. **Read the Ghost Risk card.** It appears under the job's header and shows:
   - the score and its band:

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

### Settings

Click the **⚙** (Settings) button in the popup, or open the extension's options from `about:addons`, to:

- show or hide the card and the toolbar score
- place the card inline under the job header, or floating in the bottom-right corner
- start the card collapsed
- grant access to the job sites
- export, import, or clear your data (employer history and your reports)

### If something doesn't look right

- **No card appears:** reload the tab (pages opened before the extension was loaded or updated don't have it yet), and check the popup for **Grant access**.
- **A detail looks wrong:** job sites change their layouts often. Click **Copy diagnostics** in the popup to get a summary of what the extension read from the page, which helps when fixing its page-reading code in `src/extractors/`.

## How scoring works

Each listing starts at 20 points and moves up or down based on what the page shows:

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
- Your employer history, flags and outcome reports are stored only in Firefox's local extension storage on your computer.
- Nothing is sent to any server. The extension declares that it collects no data (`data_collection_permissions: none`).
- You can export or delete your data at any time from Settings.

## For developers

### Build a package

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

This writes `dist/ghost-job-detector-<version>.zip`, ready to upload to addons.mozilla.org.

### Run the tests

Serve the project folder over HTTP, for example:

```powershell
python -m http.server 8765
```

Then open:

- `http://localhost:8765/test/harness.html`: the page readers, scoring and card against sample pages
- `http://localhost:8765/test/flicker.html`: the full extension against a simulated job site that loads in stages, checking that each listing only ever shows one score and one card

### Project layout

| Path | Contents |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `src/scoring.js` | Scoring rules |
| `src/extractors/` | One page reader per job site, plus shared helpers |
| `src/content.js` | Watches the page, scores listings and draws the card |
| `src/ui.js` | The Ghost Risk card |
| `src/storage.js` | Local storage for settings, employer history and reports |
| `src/background.js` | Toolbar score |
| `popup/`, `options/` | Toolbar popup and settings page |
| `test/` | Test pages |

## No support, warranty or guarantee

This software is provided **as is**, without support of any kind. No warranty or guarantee is offered, express or implied, including any warranty of merchantability, fitness for a particular purpose, accuracy, or non-infringement.

Scores are automated estimates and may be wrong. They aren't a statement of fact about any employer or job listing, and shouldn't be your only basis for deciding whether to apply. Job sites change often and the extension may stop working on any of them at any time. You use it at your own risk; the authors aren't liable for any decision, loss, or damage arising from its use.
