import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHistoryStore } from '../history.js';

async function tempFilePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zsp-hist-'));
  return path.join(dir, 'history.json');
}

function snapshotWith(componentStates) {
  return {
    components: Object.entries(componentStates).map(([key, state]) => ({
      key,
      hostid: key,
      name: `host-${key}`,
      state,
    })),
  };
}

describe('createHistoryStore', () => {
  test('update records today\'s state per component; getSeries returns it at the newest slot, nulls elsewhere', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await store.load();

    const date = new Date('2026-07-06T12:00:00Z');
    await store.update(snapshotWith({ h1: 'operational' }), date);

    const series = store.getSeries('h1', date);
    assert.equal(series.length, 5);
    assert.deepEqual(
      series.map((d) => d.date),
      ['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'],
    );
    assert.equal(series[4].state, 'operational');
    for (let i = 0; i < 4; i++) {
      assert.equal(series[i].state, null);
    }
  });

  test('worse-merge: second update same day with milder state keeps the worse one', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await store.load();

    const date = new Date('2026-07-06T12:00:00Z');
    await store.update(snapshotWith({ h1: 'major' }), date);
    await store.update(snapshotWith({ h1: 'operational' }), date);

    const series = store.getSeries('h1', date);
    assert.equal(series[series.length - 1].state, 'major');
  });

  test('worse-merge: a worse state upgrades the bucket', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await store.load();

    const date = new Date('2026-07-06T12:00:00Z');
    await store.update(snapshotWith({ h1: 'operational' }), date);
    await store.update(snapshotWith({ h1: 'partial' }), date);

    const series = store.getSeries('h1', date);
    assert.equal(series[series.length - 1].state, 'partial');
  });

  test('persistence: a second store on the same filePath after load() sees prior data', async () => {
    const filePath = await tempFilePath();
    const storeA = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await storeA.load();

    const date = new Date('2026-07-06T12:00:00Z');
    await storeA.update(snapshotWith({ h1: 'degraded' }), date);

    const storeB = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await storeB.load();

    const series = storeB.getSeries('h1', date);
    assert.equal(series[series.length - 1].state, 'degraded');
  });

  test('rolling window: a day older than historyDays is pruned after an update far in the future', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await store.load();

    const day1 = new Date('2026-07-06T12:00:00Z');
    await store.update(snapshotWith({ h1: 'major' }), day1);

    const futureDate = new Date('2026-07-20T12:00:00Z');
    await store.update(snapshotWith({ h1: 'operational' }), futureDate);

    const series = store.getSeries('h1', futureDate);
    assert.equal(series.length, 5);
    assert.ok(!series.some((d) => d.date === '2026-07-06'));
  });

  test('tz: a date near UTC midnight maps to the expected local day', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'America/Puerto_Rico' });
    await store.load();

    // America/Puerto_Rico is UTC-4. 2026-07-07T02:00:00Z is 2026-07-06 22:00 local.
    const date = new Date('2026-07-07T02:00:00Z');
    await store.update(snapshotWith({ h1: 'operational' }), date);

    const series = store.getSeries('h1', date);
    assert.equal(series[series.length - 1].date, '2026-07-06');
  });

  test('missing file: load() starts empty, getSeries all null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zsp-hist-'));
    const filePath = path.join(dir, 'does-not-exist.json');
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await store.load();

    const date = new Date('2026-07-06T12:00:00Z');
    const series = store.getSeries('h1', date);
    assert.equal(series.length, 5);
    assert.ok(series.every((d) => d.state === null));
  });

  test('corrupt file: load() starts empty instead of throwing', async () => {
    const filePath = await tempFilePath();
    await fs.writeFile(filePath, '{ not valid json', 'utf8');
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await assert.doesNotReject(store.load());

    const date = new Date('2026-07-06T12:00:00Z');
    const series = store.getSeries('h1', date);
    assert.ok(series.every((d) => d.state === null));
  });

  test('non-ENOENT fs error propagates instead of masking as empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zsp-hist-'));
    const filePath = path.join(dir, 'a-directory');
    await fs.mkdir(filePath);
    const store = createHistoryStore({ filePath, historyDays: 5, tz: 'UTC' });
    await assert.rejects(store.load());
  });

  test('default historyDays is 90', async () => {
    const filePath = await tempFilePath();
    const store = createHistoryStore({ filePath });
    await store.load();
    const series = store.getSeries('h1', new Date('2026-07-06T12:00:00Z'));
    assert.equal(series.length, 90);
  });
});
