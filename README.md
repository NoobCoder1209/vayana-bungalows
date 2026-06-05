# Arapq Resort

A boutique island resort marketing site. Single static homepage built with hand-written HTML, CSS, and vanilla JS, served locally by Vite.

## Run locally

Prerequisites: [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/NoobCoder1209/arapq-website.git
cd arapq-website
npm install
npm run dev
```

Vite opens http://localhost:5173 automatically. First run needs internet
for `npm install` and the Google Fonts loaded by `index.html`.

## Stack

- HTML / CSS / vanilla JS — no framework
- [Vite](https://vitejs.dev) for the dev server (HMR)
- [flatpickr](https://flatpickr.js.org/) for the booking date range picker
- Google Fonts: Marcellus (headings) + Jost (body)

## Structure

```
index.html              # the only page
assets/
  css/                  # tokens, base, layout, sections
  js/                   # header, parallax, slider, booking, reveal
  img/                  # photography (Unsplash, license-clear)
```
