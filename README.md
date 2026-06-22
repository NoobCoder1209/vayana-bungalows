# Vayana Bungalows

A boutique resort marketing site. Multi-page static site built with hand-written HTML, CSS, and vanilla JS, bundled by Vite.

## Run locally

Prerequisites: [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/NoobCoder1209/vayana-bungalows.git
cd vayana-bungalows
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
index.html                          # home
stay/                               # bungalows index
destination/                        # area guide + map
contacts/                           # contact details
enquiries/                          # enquiry form
premier-oceanview-villa/            # bungalow 1
deluxe-hilltop-residence/           # bungalow 2
premier-beachfront-suite/           # bungalow 3
assets/
  css/                  # tokens, base, layout, sections
  js/                   # header, parallax, slider, booking, reveal
  img/                  # photography (Unsplash, license-clear)
```
