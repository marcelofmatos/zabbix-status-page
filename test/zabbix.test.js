import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createZabbixClient } from '../zabbix.js';

const BASE_CONFIG = {
  apiUrl: 'https://zabbix.example.com/zabbix/api_jsonrpc.php',
  zabbixToken: 'abc123',
  groupIds: [],
  hostIds: [],
  minSeverity: 0,
  knowleadsComments: false,
};

function fakeFetch(result) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', result, id: calls.length }),
    };
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function lastRequestBody(fetchFn) {
  return JSON.parse(fetchFn.calls[fetchFn.calls.length - 1].options.body);
}

describe('createZabbixClient transport', () => {
  test('POSTs to config.apiUrl with correct headers and no auth field in body', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await client.getHostGroups();

    assert.equal(fetchFn.calls.length, 1);
    const { url, options } = fetchFn.calls[0];
    assert.equal(url, BASE_CONFIG.apiUrl);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json-rpc');
    assert.equal(options.headers['Authorization'], 'Bearer abc123');

    const body = JSON.parse(options.body);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.method, 'hostgroup.get');
    assert.ok(!('auth' in body));
    assert.equal(typeof body.id, 'number');
  });

  test('increments id across calls', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await client.getHostGroups();
    await client.getHosts();

    const firstId = JSON.parse(fetchFn.calls[0].options.body).id;
    const secondId = JSON.parse(fetchFn.calls[1].options.body).id;
    assert.equal(secondId, firstId + 1);
  });

  test('returns .result on success', async () => {
    const expected = [{ groupid: '1', name: 'Group A' }];
    const fetchFn = fakeFetch(expected);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    const result = await client.getHostGroups();
    assert.deepEqual(result, expected);
  });

  test('throws on HTTP error status', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await assert.rejects(() => client.getHostGroups(), /500/);
  });

  test('throws on Zabbix .error in body', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Invalid params.', data: 'Session terminated.' },
        id: 1,
      }),
    });
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await assert.rejects(() => client.getHostGroups(), /Session terminated\./);
  });
});

describe('getHostGroups', () => {
  test('builds params without groupids when config.groupIds is empty', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await client.getHostGroups();

    const body = lastRequestBody(fetchFn);
    assert.equal(body.method, 'hostgroup.get');
    assert.deepEqual(body.params, {
      output: ['groupid', 'name'],
      with_monitored_hosts: true,
      sortfield: 'name',
    });
  });

  test('includes groupids when config.groupIds is non-empty', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient({ ...BASE_CONFIG, groupIds: ['7', '8'] }, { fetch: fetchFn });

    await client.getHostGroups();

    const body = lastRequestBody(fetchFn);
    assert.deepEqual(body.params.groupids, ['7', '8']);
  });
});

describe('getHosts', () => {
  test('builds params without groupids/hostids when config arrays are empty', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await client.getHosts();

    const body = lastRequestBody(fetchFn);
    assert.equal(body.method, 'host.get');
    assert.deepEqual(body.params, {
      output: ['hostid', 'name', 'status'],
      selectHostGroups: ['groupid', 'name'],
      monitored_hosts: true,
      sortfield: 'name',
    });
  });

  test('includes groupids and hostids when configured', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(
      { ...BASE_CONFIG, groupIds: ['7'], hostIds: ['101', '102'] },
      { fetch: fetchFn }
    );

    await client.getHosts();

    const body = lastRequestBody(fetchFn);
    assert.deepEqual(body.params.groupids, ['7']);
    assert.deepEqual(body.params.hostids, ['101', '102']);
  });
});

describe('getActiveTriggers', () => {
  test('builds params with min_severity and no groupids/hostids when empty', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient({ ...BASE_CONFIG, minSeverity: 3 }, { fetch: fetchFn });

    await client.getActiveTriggers();

    const body = lastRequestBody(fetchFn);
    assert.equal(body.method, 'trigger.get');
    assert.deepEqual(body.params, {
      output: ['triggerid', 'description', 'priority', 'value', 'lastchange'],
      selectHosts: ['hostid', 'name'],
      monitored: true,
      active: true,
      only_true: true,
      skipDependent: true,
      expandDescription: true,
      min_severity: 3,
      sortfield: 'priority',
      sortorder: 'DESC',
    });
  });

  test('includes groupids and hostids when configured', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(
      { ...BASE_CONFIG, groupIds: ['1'], hostIds: ['2'] },
      { fetch: fetchFn }
    );

    await client.getActiveTriggers();

    const body = lastRequestBody(fetchFn);
    assert.deepEqual(body.params.groupids, ['1']);
    assert.deepEqual(body.params.hostids, ['2']);
  });
});

describe('getProblems', () => {
  test('builds params without selectAcknowledges when knowleadsComments is false', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    await client.getProblems();

    const body = lastRequestBody(fetchFn);
    assert.equal(body.method, 'problem.get');
    assert.deepEqual(body.params, {
      output: ['eventid', 'name', 'severity', 'clock', 'objectid', 'acknowledged'],
      recent: false,
      sortfield: ['eventid'],
      sortorder: 'DESC',
      selectTags: 'extend',
    });
  });

  test('includes selectAcknowledges when knowleadsComments is true', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient({ ...BASE_CONFIG, knowleadsComments: true }, { fetch: fetchFn });

    await client.getProblems();

    const body = lastRequestBody(fetchFn);
    assert.deepEqual(body.params.selectAcknowledges, [
      'clock',
      'message',
      'action',
      'userid',
    ]);
  });

  test('includes groupids and hostids when configured', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(
      { ...BASE_CONFIG, groupIds: ['5'], hostIds: ['6'] },
      { fetch: fetchFn }
    );

    await client.getProblems();

    const body = lastRequestBody(fetchFn);
    assert.deepEqual(body.params.groupids, ['5']);
    assert.deepEqual(body.params.hostids, ['6']);
  });
});

describe('createZabbixClient TLS verification', () => {
  test('does not pass a dispatcher by default (certificate is verified)', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });
    await client.getHostGroups();
    assert.equal(fetchFn.calls[0].options.dispatcher, undefined);
  });

  test('passes an undici dispatcher when tlsInsecure is on', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient({ ...BASE_CONFIG, tlsInsecure: true }, { fetch: fetchFn });
    await client.getHostGroups();
    const { dispatcher } = fetchFn.calls[0].options;
    assert.ok(dispatcher, 'dispatcher deve estar definido quando tlsInsecure=on');
    assert.equal(typeof dispatcher.dispatch, 'function');
  });
});
