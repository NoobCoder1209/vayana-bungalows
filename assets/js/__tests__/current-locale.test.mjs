// Tests for assets/js/util/current-locale.js — reads the emit-locale
// from <html lang>.
//
// The util is a browser module. Since it only touches document.documentElement,
// we shim a minimal document object with `getAttribute` on the html element.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UTIL_PATH = join(__dirname, '..', 'util', 'current-locale.js');
const UTIL_SRC = readFileSync(UTIL_PATH, 'utf8');

// Minimal "document" shim: only the surface currentLocale() reads.
function makeDoc(lang) {
  return {
    documentElement: {
      getAttribute(name) {
        if (name === 'lang') return lang;
        return null;
      },
    },
  };
}

// Load the util into an eval scope with our shim document. Strips
// `export` (same pattern as lang.test.mjs's harness — kept
// name-agnostic so a future added export doesn't crash tests).
function load(doc) {
  const src = UTIL_SRC.replace(/\bexport\s+/g, '');
  const factory = new Function(
    'document',
    `${src}
     return { currentLocale, isDefaultLocale };`,
  );
  return factory(doc);
}

test('currentLocale: returns "en" when <html lang="en">', () => {
  const { currentLocale } = load(makeDoc('en'));
  assert.equal(currentLocale(), 'en');
});

test('currentLocale: returns "bg" when <html lang="bg">', () => {
  const { currentLocale } = load(makeDoc('bg'));
  assert.equal(currentLocale(), 'bg');
});

test('currentLocale: falls back to default when lang attribute missing', () => {
  const { currentLocale } = load(makeDoc(null));
  assert.equal(currentLocale(), 'en', 'missing lang → default en');
});

test('currentLocale: falls back to default when lang is empty string', () => {
  const { currentLocale } = load(makeDoc(''));
  assert.equal(currentLocale(), 'en');
});

test('currentLocale: falls back to default on unknown locale (fr, de not yet onboarded)', () => {
  const { currentLocale } = load(makeDoc('fr'));
  assert.equal(currentLocale(), 'en', 'unknown locale must degrade to default');
});

test('currentLocale: trims whitespace around lang value', () => {
  const { currentLocale } = load(makeDoc('  bg  '));
  assert.equal(currentLocale(), 'bg', 'padded value must still resolve');
});

test('isDefaultLocale: true when EN', () => {
  const { isDefaultLocale } = load(makeDoc('en'));
  assert.equal(isDefaultLocale(), true);
});

test('isDefaultLocale: false when BG', () => {
  const { isDefaultLocale } = load(makeDoc('bg'));
  assert.equal(isDefaultLocale(), false);
});

test('isDefaultLocale: true when unknown (falls back to default first)', () => {
  const { isDefaultLocale } = load(makeDoc('xx'));
  assert.equal(isDefaultLocale(), true, 'unknown falls back to default which IS the default');
});
