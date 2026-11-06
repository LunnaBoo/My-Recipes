import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LETTER_ID_RE,
  MAILBOX_ADDRESS_RE,
  MAILBOX_SECRET_RE,
  MAX_CONTACT_NAME_LENGTH,
  buildMailboxIdentity,
  isUnread,
  isValidLetterId,
  isValidMailboxAddress,
  isValidMailboxSecret,
  normalizeContactName,
  normalizeLetter,
  normalizeLetters,
  normalizeMailboxSecret,
  parseMailboxAddress,
  planReadStateMerge,
  shouldPruneLetters,
  unreadCount,
  validateContact,
  type MailboxLetter,
} from '../src/lib/mailbox';

const ADDRESS = 'k7m2x9q4p8r3';
const SECRET = 'a'.repeat(64);
const LETTER_ID = 'k8m2x9q4pabc';
const SHARE_ID = 'f8k2m9x4qabc';

function letter(overrides: Partial<MailboxLetter> = {}): MailboxLetter {
  return {
    id: LETTER_ID,
    shareId: SHARE_ID,
    sentAt: 1_762_300_000_000,
    title: 'GUIA: COMO PREPARAR FEIJÃO',
    stepCount: 12,
    senderName: 'Lucas',
    senderSeal: '{"kind":"sigil","id":"cat"}',
    available: true,
    ...overrides,
  };
}

function rawLetter(overrides: Record<string, unknown> = {}) {
  return {
    id: LETTER_ID,
    shareId: SHARE_ID,
    sentAt: 1_762_300_000_000,
    title: 'GUIA: COMO PREPARAR FEIJÃO',
    stepCount: 12,
    sender: 'Lucas',
    senderSeal: { kind: 'sigil', id: 'cat' },
    available: true,
    ...overrides,
  };
}

test('mailbox address format is 12 chars from the share alphabet', () => {
  assert.equal(isValidMailboxAddress(ADDRESS), true);
  assert.equal(MAILBOX_ADDRESS_RE.test(ADDRESS), true);

  const bad = [
    '',
    'k7m2x9q4p8r',
    'k7m2x9q4p8r33',
    'K7M2X9Q4P8R3',
    'i7m2x9q4p8r3',
    'l7m2x9q4p8r3',
    'o7m2x9q4p8r3',
    '07m2x9q4p8r3',
    '17m2x9q4p8r3',
    'k7m2x9q4p8r!',
    ' k7m2x9q4p8r3',
    'https://r.lunna.boo/m/k7m2x9q4p8r3',
  ];

  for (const value of bad) {
    assert.equal(isValidMailboxAddress(value), false, value);
  }

  assert.equal(isValidMailboxAddress(42), false);
  assert.equal(isValidMailboxAddress(null), false);
});

test('parseMailboxAddress trims and lowercases only', () => {
  assert.equal(parseMailboxAddress('  K7M2X9Q4P8R3  '), ADDRESS);
  assert.equal(parseMailboxAddress('\tk7m2x9q4p8r3\n'), ADDRESS);
  assert.equal(parseMailboxAddress(''), null);
  assert.equal(parseMailboxAddress('k7m2 x9q4p8r3'), null);
  assert.equal(parseMailboxAddress('@k7m2x9q4p8r3'), null);
  assert.equal(parseMailboxAddress('k7m2x9q4p8r3@x'), null);
});

test('mailbox secret is 64 lowercase hex chars', () => {
  assert.equal(isValidMailboxSecret(SECRET), true);
  assert.equal(MAILBOX_SECRET_RE.test(SECRET), true);

  for (const bad of [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
    `${'a'.repeat(63)} `,
  ]) {
    assert.equal(isValidMailboxSecret(bad), false, bad);
  }

  assert.equal(isValidMailboxSecret(undefined), false);
});

test('normalizeMailboxSecret trims and lowercases a pasted secret', () => {
  assert.equal(normalizeMailboxSecret(`  ${'A'.repeat(64)}  `), SECRET);
  assert.equal(normalizeMailboxSecret('abc'), null);
  assert.equal(normalizeMailboxSecret(''), null);
});

test('letter ids use the 12-char server alphabet', () => {
  assert.equal(isValidLetterId(LETTER_ID), true);
  assert.equal(LETTER_ID_RE.test(LETTER_ID), true);
  assert.equal(isValidLetterId('l8k2m9x1q4'), false);
  assert.equal(isValidLetterId('L8K2M9X4QABC'), false);
  assert.equal(isValidLetterId(12), false);

  // The server alphabet excludes i/l/o/0/1.
  for (const bad of [
    'i8k2m9x4qabc',
    'l8k2m9x4qabc',
    'o8k2m9x4qabc',
    '08k2m9x4qabc',
    '18k2m9x4qabc',
  ]) {
    assert.equal(isValidLetterId(bad), false, bad);
  }
});

test('normalizeLetter keeps the display fields and canonicalizes the seal', () => {
  assert.deepEqual(normalizeLetter(rawLetter()), letter());
});

test('normalizeLetter accepts an unavailable letter and drops stale display data', () => {
  assert.deepEqual(normalizeLetter(rawLetter({ available: false })), {
    id: LETTER_ID,
    shareId: SHARE_ID,
    sentAt: 1_762_300_000_000,
    title: null,
    stepCount: null,
    senderName: null,
    senderSeal: null,
    available: false,
  });
});

test('normalizeLetter accepts an unavailable letter with no display data', () => {
  const raw = {
    id: LETTER_ID,
    shareId: SHARE_ID,
    sentAt: 1_762_300_000_000,
    available: false,
  };

  assert.deepEqual(normalizeLetter(raw), {
    id: LETTER_ID,
    shareId: SHARE_ID,
    sentAt: 1_762_300_000_000,
    title: null,
    stepCount: null,
    senderName: null,
    senderSeal: null,
    available: false,
  });

  const normalized = normalizeLetters([raw]);
  assert.equal(normalized?.length, 1);
  assert.equal(normalized?.[0]?.id, LETTER_ID);
  assert.equal(normalized?.[0]?.available, false);
});

test('normalizeLetter tolerates missing or decorative fields', () => {
  const noSeal = normalizeLetter(rawLetter({ senderSeal: { kind: 'nope' } }));
  assert.equal(noSeal?.senderSeal, null);
  assert.equal(noSeal?.senderName, 'Lucas');

  const noTitle = normalizeLetter(rawLetter({ title: null, stepCount: null }));
  assert.equal(noTitle?.title, null);
  assert.equal(noTitle?.stepCount, null);

  const legacySender = normalizeLetter(rawLetter({ sender: undefined, senderName: 'Ana' }));
  assert.equal(legacySender?.senderName, 'Ana');

  const blankSender = normalizeLetter(rawLetter({ sender: '   ' }));
  assert.equal(blankSender?.senderName, null);
});

test('normalizeLetter rejects structural problems', () => {
  const bad: unknown[] = [
    null,
    'letter',
    [],
    rawLetter({ id: 'l8k2m9x1q4' }),
    rawLetter({ id: 42 }),
    rawLetter({ shareId: 'f8k2m9x1q4' }),
    rawLetter({ shareId: undefined }),
    rawLetter({ sentAt: '1762300000000' }),
    rawLetter({ sentAt: -1 }),
    rawLetter({ sentAt: 1.5 }),
    rawLetter({ available: 'yes' }),
    rawLetter({ available: undefined }),
    rawLetter({ stepCount: -1 }),
    rawLetter({ stepCount: 1.5 }),
    rawLetter({ title: 'x'.repeat(121) }),
  ];

  for (const value of bad) {
    assert.equal(normalizeLetter(value), null, JSON.stringify(value));
  }
});

test('normalizeLetters drops malformed and duplicated rows', () => {
  assert.equal(normalizeLetters(null), null);
  assert.equal(normalizeLetters({ letters: [] }), null);

  const other = rawLetter({ id: 'm8k2m9x4qabc' });
  const normalized = normalizeLetters([rawLetter(), rawLetter(), { id: 'bad' }, other]);

  assert.deepEqual(normalized, [letter(), letter({ id: 'm8k2m9x4qabc' })]);
  assert.deepEqual(normalizeLetters([]), []);
});

test('unreadCount understands both wire and row shapes', () => {
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount([{ readAt: null }, { readAt: 1 }, { readAt: null }]), 2);
  assert.equal(unreadCount([{ read_at: null }, { read_at: 5 }]), 1);
  assert.equal(unreadCount([{ read_at: null }, { read_at: null }]), 2);

  assert.equal(isUnread({ readAt: null }), true);
  assert.equal(isUnread({ readAt: 1 }), false);
  assert.equal(isUnread({ read_at: null }), true);
  assert.equal(isUnread({}), true);
});

test('contact names are 1-40 chars with collapsed whitespace', () => {
  assert.equal(normalizeContactName('  Ana   Maria '), 'Ana Maria');
  assert.equal(normalizeContactName('Ana\nMaria'), 'Ana Maria');
  assert.equal(normalizeContactName('A'.repeat(MAX_CONTACT_NAME_LENGTH)), 'A'.repeat(40));
  assert.equal(normalizeContactName('A'.repeat(MAX_CONTACT_NAME_LENGTH + 1)), null);
  assert.equal(normalizeContactName('   '), null);
  assert.equal(normalizeContactName(''), null);
});

test('validateContact normalizes the address and the name', () => {
  assert.deepEqual(validateContact({ address: ` ${ADDRESS.toUpperCase()} `, displayName: ' Ana ' }), {
    ok: true,
    contact: { address: ADDRESS, displayName: 'Ana' },
  });

  assert.deepEqual(validateContact({ address: 'nope', displayName: 'Ana' }), {
    ok: false,
    error: 'invalid_address',
  });
  assert.deepEqual(validateContact({ address: ADDRESS, displayName: ' ' }), {
    ok: false,
    error: 'invalid_name',
  });
  assert.deepEqual(validateContact({ address: ADDRESS, displayName: 'A'.repeat(41) }), {
    ok: false,
    error: 'invalid_name',
  });
});

test('planReadStateMerge applies cached ids and keeps the rest pending', () => {
  const plan = planReadStateMerge(
    [
      { letter_id: LETTER_ID, read_at: null },
      { letter_id: 'm8k2m9x4qabc', read_at: 1_700_000_000_000 },
    ],
    [LETTER_ID, 'm8k2m9x4qabc', 'n8k2m9x4qabc', 'n8k2m9x4qabc', 'not-an-id'],
  );

  assert.deepEqual(plan, {
    apply: [LETTER_ID],
    pending: ['n8k2m9x4qabc'],
  });
});

test('planReadStateMerge ignores an empty local cache', () => {
  assert.deepEqual(planReadStateMerge([], []), { apply: [], pending: [] });
  assert.deepEqual(planReadStateMerge([], [LETTER_ID]), {
    apply: [],
    pending: [LETTER_ID],
  });
});

test('only a complete refresh may prune cached letters', () => {
  assert.equal(shouldPruneLetters(true), true);
  assert.equal(shouldPruneLetters(false), false);
});

test('buildMailboxIdentity is deterministic and uses the expected formats', () => {
  const identity = buildMailboxIdentity((length) => new Uint8Array(length).fill(1));

  assert.equal(identity.address, 'b'.repeat(12));
  assert.equal(identity.secret, '01'.repeat(32));
  assert.match(identity.address, MAILBOX_ADDRESS_RE);
  assert.match(identity.secret, MAILBOX_SECRET_RE);
  assert.equal(identity.secret.length, 64);
});

test('buildMailboxIdentity rejects biased bytes via rejection sampling', () => {
  let call = 0;
  const identity = buildMailboxIdentity((length) => {
    call += 1;
    // Every byte in the first batch is above the usable limit; the second
    // batch is accepted, so the address must come entirely from it.
    return new Uint8Array(length).fill(call === 1 ? 255 : 2);
  });

  assert.equal(identity.address, 'c'.repeat(12));
  assert.equal(identity.secret, '02'.repeat(32));
  assert.equal(call >= 3, true);
});

