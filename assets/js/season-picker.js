// Shared flatpickr "season picker" factory.
//
// The booking widget (both the live per-bungalow path and the /stay/ top
// enquiry-link bar) and the enquiry form all build essentially the same
// flatpickr instance: past dates blocked (`minDate`), the year capped
// (`maxDate: seasonMaxDate()`), Oct–Mar greyed out (`disable: [isOffSeason]`),
// the year <input> swapped for a <select> (`onReady: attachYearDropdown`), and
// the calendar grid forced on mobile. This factory centralises that config so
// a change to the season contract happens in ONE place instead of three.
//
// Per-caller specifics are passed in: the `dateFormat` (EN `M j, Y` vs the
// enquiry form's `d/m/Y`), the `locale`, any EXTRA disable predicates/dates
// (the live widget's booked-day list), and the `onChange` / `onDayCreate`
// hooks. `isOffSeason` is always prepended to the disable list, so callers
// only pass their own additions.

import flatpickr from 'flatpickr';
import { isOffSeason, seasonMaxDate, attachYearDropdown } from './season.js';

/**
 * Build a season-constrained flatpickr on `input`.
 *
 * @param {HTMLElement} input
 * @param {object} opts
 * @param {string|Date} [opts.minDate='today']
 * @param {Date}   [opts.maxDate=seasonMaxDate()]
 * @param {string} opts.dateFormat            — caller's flatpickr dateFormat
 * @param {object} [opts.locale]              — flatpickr locale object/code
 * @param {Array}  [opts.disable=[]]          — EXTRA disable entries; isOffSeason is prepended
 * @param {boolean}[opts.disableMobile=false]
 * @param {Function}[opts.onReady=attachYearDropdown]
 * @param {Function}[opts.onChange]
 * @param {Function}[opts.onDayCreate]
 * @returns {import('flatpickr/dist/types/instance').Instance}
 */
export function makeSeasonPicker(input, opts = {}) {
  const {
    minDate = 'today',
    maxDate = seasonMaxDate(),
    dateFormat,
    locale,
    disable = [],
    disableMobile = false,
    onReady = attachYearDropdown,
    onChange,
    onDayCreate,
  } = opts;

  const config = {
    minDate,
    maxDate,
    dateFormat,
    // isOffSeason first so the season block survives any later
    // `.set('disable', ...)` that re-uses this same "predicate + extras" shape.
    disable: [isOffSeason, ...disable],
    disableMobile,
    onReady,
  };
  // Start every week on Monday (EU convention; matches the site's audience and
  // the /stay/ availability grid). flatpickr reads firstDayOfWeek from the
  // resolved l10n, NOT from a top-level config key — setupLocale() builds
  // self.l10n = {...default, ...locale} and the grid uses self.l10n.
  // firstDayOfWeek (flatpickr 4.6.13). So we must inject firstDayOfWeek into the
  // LOCALE object: EN 'default' starts Sunday (0), BG already Monday (1) — merge
  // firstDayOfWeek:1 onto whichever locale is passed so both are Monday-first.
  // `locale: 'default'` (a string) isn't spreadable, so an empty-object base
  // (spread onto flatpickr's default English l10n) suffices for EN.
  const baseLocale = locale && typeof locale === 'object' ? locale : {};
  config.locale = { ...baseLocale, firstDayOfWeek: 1 };
  if (onChange) config.onChange = onChange;
  if (onDayCreate) config.onDayCreate = onDayCreate;

  return flatpickr(input, config);
}
