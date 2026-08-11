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
  if (locale) config.locale = locale;
  if (onChange) config.onChange = onChange;
  if (onDayCreate) config.onDayCreate = onDayCreate;

  return flatpickr(input, config);
}
