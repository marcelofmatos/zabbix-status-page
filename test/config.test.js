import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  test('parses required string fields as-is', () => {
    const config = loadConfig({
      ZABBIX_URL: 'https://zabbix.example.com/zabbix/',
      ZABBIX_TOKEN: 'abc123',
    });
    assert.equal(config.zabbixUrl, 'https://zabbix.example.com/zabbix/');
    assert.equal(config.zabbixToken, 'abc123');
  });

  test('missing ZABBIX_URL/ZABBIX_TOKEN default to empty string without throwing', () => {
    const config = loadConfig({});
    assert.equal(config.zabbixUrl, '');
    assert.equal(config.zabbixToken, '');
  });

  test('derives apiUrl appending api_jsonrpc.php when base has trailing slash', () => {
    const config = loadConfig({ ZABBIX_URL: 'https://zabbix.example.com/zabbix/' });
    assert.equal(config.apiUrl, 'https://zabbix.example.com/zabbix/api_jsonrpc.php');
  });

  test('derives apiUrl appending api_jsonrpc.php when base has no trailing slash', () => {
    const config = loadConfig({ ZABBIX_URL: 'https://zabbix.example.com/zabbix' });
    assert.equal(config.apiUrl, 'https://zabbix.example.com/zabbix/api_jsonrpc.php');
  });

  test('apiUrl is empty string when ZABBIX_URL is missing', () => {
    const config = loadConfig({});
    assert.equal(config.apiUrl, '');
  });

  describe('CSV parsing (ZABBIX_GROUPS_IDS / ZABBIX_HOSTS_IDS)', () => {
    test('empty string yields empty array', () => {
      const config = loadConfig({ ZABBIX_GROUPS_IDS: '', ZABBIX_HOSTS_IDS: '' });
      assert.deepEqual(config.groupIds, []);
      assert.deepEqual(config.hostIds, []);
    });

    test('missing var yields empty array', () => {
      const config = loadConfig({});
      assert.deepEqual(config.groupIds, []);
      assert.deepEqual(config.hostIds, []);
    });

    test('single id yields single-element array', () => {
      const config = loadConfig({ ZABBIX_GROUPS_IDS: '7' });
      assert.deepEqual(config.groupIds, ['7']);
    });

    test('multiple ids with surrounding spaces are trimmed', () => {
      const config = loadConfig({ ZABBIX_HOSTS_IDS: ' 1, 2 ,3 ' });
      assert.deepEqual(config.hostIds, ['1', '2', '3']);
    });

    test('empty segments between commas are dropped', () => {
      const config = loadConfig({ ZABBIX_GROUPS_IDS: '1,,2,' });
      assert.deepEqual(config.groupIds, ['1', '2']);
    });
  });

  describe('flag parsing', () => {
    test('"on" is true', () => {
      assert.equal(loadConfig({ ZABBIX_KNOWLEADS: 'on' }).knowleads, true);
    });

    test('"off" is false', () => {
      assert.equal(loadConfig({ ZABBIX_KNOWLEADS: 'off' }).knowleads, false);
    });

    test('"true"/"false" accepted case-insensitively', () => {
      assert.equal(loadConfig({ ZABBIX_KNOWLEADS: 'TRUE' }).knowleads, true);
      assert.equal(loadConfig({ ZABBIX_KNOWLEADS: 'False' }).knowleads, false);
    });

    test('"1"/"0" accepted', () => {
      assert.equal(loadConfig({ ZABBIX_STATUS_BY_GROUPS: '1' }).statusByGroups, true);
      assert.equal(loadConfig({ ZABBIX_STATUS_BY_GROUPS: '0' }).statusByGroups, false);
    });

    test('empty/missing value defaults to false', () => {
      assert.equal(loadConfig({}).statusByGroups, false);
      assert.equal(loadConfig({ ZABBIX_KNOWLEADS_COMMENTS: '' }).knowleadsComments, false);
    });
  });

  describe('defaults for optional vars', () => {
    test('applies documented defaults when env vars are missing', () => {
      const config = loadConfig({});
      assert.equal(config.port, 8080);
      assert.equal(config.pollIntervalSeconds, 60);
      assert.equal(config.historyDays, 90);
      assert.equal(config.pageTitle, 'Status');
      assert.equal(config.tz, 'UTC');
      assert.equal(config.minSeverity, 0);
    });

    test('uses provided values when present', () => {
      const config = loadConfig({
        PORT: '3000',
        POLL_INTERVAL_SECONDS: '30',
        HISTORY_DAYS: '7',
        PAGE_TITLE: 'Custom Title',
        TZ: 'America/Puerto_Rico',
      });
      assert.equal(config.port, 3000);
      assert.equal(config.pollIntervalSeconds, 30);
      assert.equal(config.historyDays, 7);
      assert.equal(config.pageTitle, 'Custom Title');
      assert.equal(config.tz, 'America/Puerto_Rico');
    });

    test('invalid ints fall back to default instead of throwing', () => {
      const config = loadConfig({ PORT: 'not-a-number', HISTORY_DAYS: '' });
      assert.equal(config.port, 8080);
      assert.equal(config.historyDays, 90);
    });
  });

  describe('ZABBIX_MIN_SEVERITY', () => {
    test('defaults to 0 when missing', () => {
      assert.equal(loadConfig({}).minSeverity, 0);
    });

    test('accepts values within 0..5', () => {
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: '3' }).minSeverity, 3);
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: '5' }).minSeverity, 5);
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: '0' }).minSeverity, 0);
    });

    test('clamps values above 5 down to 5', () => {
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: '9' }).minSeverity, 5);
    });

    test('clamps negative values up to 0', () => {
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: '-2' }).minSeverity, 0);
    });

    test('invalid (non-numeric) value falls back to default', () => {
      assert.equal(loadConfig({ ZABBIX_MIN_SEVERITY: 'nope' }).minSeverity, 0);
    });
  });

  test('returns a frozen object', () => {
    const config = loadConfig({});
    assert.ok(Object.isFrozen(config));
  });

  test('is pure: does not mutate the passed-in env object', () => {
    const env = { ZABBIX_GROUPS_IDS: '1,2' };
    const snapshot = { ...env };
    loadConfig(env);
    assert.deepEqual(env, snapshot);
  });

  test('defaults to process.env when no argument is given', () => {
    const config = loadConfig();
    assert.equal(typeof config.port, 'number');
  });
});
