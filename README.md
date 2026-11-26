# Torah World · עולם התורה

A non-commercial Torah-learning site: read Chumash, Mishnah and Gemara with their mefarshim, attach notes and questions to exact words, ask and answer (Stack-Overflow style), and find a chavrusa.

- Live: https://torah-world.yosefrosner39.workers.dev
- Stack: Cloudflare Worker + D1 (users, notes, votes, search/link indexes) + R2 (text and commentary files, planned).
- Docs for whoever continues this: `RUNBOOK.md` (how to run/deploy/restore) and `PROJECT_STATE.md` (decisions, status, next steps).

## Texts and licenses
Texts and commentary come from [Sefaria](https://www.sefaria.org) (official data), each under the license recorded for that specific text (public domain, CC0, CC-BY-SA, CC-BY-NC). The site must stay **non-commercial** and show attribution. Texts that are not freely licensed are not copied; they appear only as links. No data is stored in this repository.

## Third-party code
- [daf-renderer](https://github.com/TalmudLab/daf-renderer) (MIT) - Vilna-style daf layout, `public/daf-renderer.js`.
- Fonts: Frank Ruhl Libre and Noto Rashi Hebrew (SIL OFL, license texts in `public/fonts`).

## Our code license
PolyForm Noncommercial 1.0.0 (see `LICENSE`): the source is visible, but commercial use is not permitted. Content licenses are separate and listed per text; third-party licenses are in `NOTICE`.
