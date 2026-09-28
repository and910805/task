import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatServerDateTime,
  localDateTimeInputToIso,
  parseServerUtcDate,
  toLocalDateTimeInput,
} from '../src/utils/datetime.js';

test('naive API timestamps are UTC and render in the local timezone', () => {
  process.env.TZ = 'Asia/Taipei';
  const value = '2026-09-29T02:00:00';

  assert.equal(parseServerUtcDate(value).toISOString(), '2026-09-29T02:00:00.000Z');
  assert.equal(toLocalDateTimeInput(value), '2026-09-29T10:00');
  assert.match(formatServerDateTime(value), /10:00/);
  assert.equal(localDateTimeInputToIso(toLocalDateTimeInput(value)), '2026-09-29T02:00:00.000Z');
});

test('timestamps with an explicit timezone keep their represented instant', () => {
  assert.equal(parseServerUtcDate('2026-09-29T10:00:00+08:00').toISOString(), '2026-09-29T02:00:00.000Z');
  assert.equal(parseServerUtcDate('not a date'), null);
  assert.equal(toLocalDateTimeInput('not a date'), '');
});
