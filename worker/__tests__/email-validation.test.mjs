// Email regex tightening (malformed-dot rejection) — issue: enquiry email
// validation accepted leading-dot / trailing-dot / consecutive-dot shapes.
//
// validateBody (worker/src/validation.js) is the authoritative server-side
// copy — the Worker never trusts the client. This test drives the regex
// change: it builds a body that is valid in EVERY field except email, then
// varies only email, asserting invalid.includes('email') matches expectation.
//
// The valid set must keep passing (no regression toward rejecting valid-but-
// implausible addresses like 1@1.com — that is a confirmation-email concern,
// out of scope). The malformed set must now be flagged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody } from '../src/validation.js';

// A body valid in every field but email. Dates are far-future so they stay
// valid regardless of when the suite runs (checkin today-or-later, checkout
// strictly after). adults in the 1..4 allowlist; consent/honeypot untouched
// here because validateBody only validates the fields above.
function bodyWithEmail(email) {
  return {
    name: 'Valid Name',
    email,
    phone: '+359 88 888 8888',
    checkin: '2099-06-01',
    checkout: '2099-06-08',
    adults: '2',
    children: '0',
    infants: '0',
    pets: '0',
    message: '',
  };
}

// validateBody returns { ok:true, cleaned } when everything is valid, or
// { ok:false, invalidFields:[...] } otherwise. Email is flagged when the
// result is not ok AND 'email' is among the invalid fields. (Every other
// field in bodyWithEmail is valid, so 'email' is the only thing that can
// flip ok to false here.)
const emailFlagged = (email) => {
  const res = validateBody(bodyWithEmail(email));
  return res.ok === false && res.invalidFields.includes('email');
};

const MUST_PASS = [
  'john@example.com',
  "o'brien@example.com",
  'user+tag@example.co.uk',
  'a.b.c@d.e.f.com',
  '1@1.com',
  'x@y.co',
];

const MUST_FLAG = [
  '.x@y.com',
  'x.@y.com',
  'x@y..com',
  'x..y@z.com',
  'x@.y.com',
  'x@y.com.',
  'a@b',
  '',
  'a',
  '1',
  'a'.repeat(250) + '@b.com', // over MAX_EMAIL_LEN (254)
];

for (const email of MUST_PASS) {
  test(`valid email is not flagged: ${JSON.stringify(email)}`, () => {
    assert.equal(emailFlagged(email), false, `${JSON.stringify(email)} should be accepted`);
  });
}

for (const email of MUST_FLAG) {
  test(`malformed email is flagged: ${JSON.stringify(email)}`, () => {
    assert.equal(emailFlagged(email), true, `${JSON.stringify(email)} should be rejected`);
  });
}
