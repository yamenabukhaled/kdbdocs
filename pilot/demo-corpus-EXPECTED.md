# Demo corpus: expected organization

23 synthetic files. Every name, number and contact detail in them is made up. They are safe to send to the cloud model, apart from the CV, which is meant to be caught by the sensitivity screen.

The scenario is an engineering student who also has a summer internship, a hobby coding project and a personal life.

**How to use it:** import the `demo-corpus` folder with "Organize after import" on. Then record what the plan did in the table below.

## Expected placements

"Either" means both answers are acceptable. **Ask** means a good plan should ask about the file rather than guess.

| File | Expected | Notes |
| --- | --- | --- |
| Uni/STAT2010/week3-regression-notes.md | Coursework | |
| Uni/STAT2010/assignment2-brief.md | Coursework | |
| Uni/STAT2010/lab4.R | Coursework | Code, but it's for a class: the purpose isn't "Code" |
| Uni/MFG3100/lean-manufacturing-lecture.md | Coursework | |
| Uni/MFG3100/group-project-plan.md | Coursework | |
| Downloads/attention-is-all-you-need-notes.md | Research | Says "curious", read for fun |
| Downloads/graph-theory-survey.md | Research / Coursework | **Ask**: nothing says why it was downloaded |
| Downloads/invoice-2026-10.md | Personal (or Finance) | |
| Downloads/sourdough-recipe.md | Personal | |
| Downloads/flight-itinerary-winter.md | Personal | |
| Downloads/lecture-attendance-template.md | Coursework / Work | **Ask** or low confidence |
| Work/internship-standup-notes.md | Work | |
| Work/onboarding-checklist.md | Work | |
| Work/q3-report-draft.md | Work | |
| Projects/price-tracker/README.md | Projects | Hobby, not Work or Coursework |
| Projects/price-tracker/tracker.py | Projects | |
| Desktop/cv-2026.md | Personal / Work (career) | **Must stay on device** (email + phone). Placed by the device model. |
| Desktop/cover-letter-draft.md | Work / Personal (career) | Either |
| Desktop/reading-list.md | Research | "for fun / own interest" |
| Desktop/thesis-ideas.md | Coursework / Research | **Ask**: final-year project, could go either way |
| Desktop/gym-plan.md | Personal | |
| Desktop/society-meeting-minutes.md | Personal | Club, not a class |
| notes.txt | Unfiled / Personal | Mixed to-do list; unfiled is fine |

Collection names may differ (for example "Uni" instead of "Coursework", or "Side projects" instead of "Projects"). What matters is that the grouping is by purpose.

**Bad signs:**
- collections named after a subject or format, such as Statistics, Manufacturing, Python or "Code";
- a CV forced into Coursework.

## What to record per run

| Measure | Run 1 | Run 2 |
| --- | --- | --- |
| Date / model (cloud, device) | 15 Nov 2026 · gemini-3.5-flash-lite · Chrome built-in (3.8-flash gave 503 twice) | 15 Nov 2026 · gemini-3.5-flash-lite · Chrome built-in · prompts v2 (no names, fewer questions) |
| Collections proposed (names) | Coursework, Research, Projects, Work, Personal | Coursework, Research, Work, Personal (no Projects: price-tracker went to Personal) |
| Files placed as expected (including "either") | 22–23 / 23 | 23 / 23 (price-tracker in Personal accepted as "hobby") |
| Clearly wrong placements (list) | None. Debatable: reading-list.md → Personal (key says Research; the file says "for fun") | None |
| Questions asked (count) and were they the ambiguous files? | 2: thesis-ideas (good), society minutes (unneeded). Didn't ask about graph-theory-survey (put it in Research) | 2: graph-theory-survey (good), notes.txt (reasonable: mixed errands + course to-dos). Society question gone |
| Files kept on device (should include the CV) | 1: cv-2026.md, placed in Work by the device model | 1: cv-2026.md, placed in Work by the device model |
| Files that failed to summarize | 0 | 0 |
| Time from import to plan screen | not measured | not measured |
| Clicks needed to reach an acceptable result | 2 question answers + Apply | 0 changes needed; Apply (questions default to a sensible answer) |

Do not paste model output that contains real personal data here. This corpus has none.
