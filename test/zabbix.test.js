import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createZabbixClient, matchesTagFilter } from '../zabbix.js';

const BASE_CONFIG = {
  apiUrl: 'https://zabbix.example.com/zabbix/api_jsonrpc.php',
  zabbixToken: 'abc123',
  groupIds: [],
  hostIds: [],
  minSeverity: 0,
  knowledgesComments: false,
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

// Responde conforme o método JSON-RPC chamado (para fluxos com várias chamadas).
function fakeFetchByMethod(resultsByMethod) {
  const calls = [];
  const fetchFn = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', result: resultsByMethod[body.method], id: body.id }),
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

  test('never sends tags to trigger.get — the tag filter is applied client-side', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(
      { ...BASE_CONFIG, tags: [{ tag: 'scope', value: 'availability', exclude: false }] },
      { fetch: fetchFn }
    );

    await client.getActiveTriggers();

    const body = lastRequestBody(fetchFn);
    assert.ok(!('tags' in body.params));
    assert.ok(!('evaltype' in body.params));
  });
});

describe('getProblems', () => {
  test('builds params without selectAcknowledges when knowledgesComments is false', async () => {
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

  test('includes selectAcknowledges when knowledgesComments is true', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient({ ...BASE_CONFIG, knowledgesComments: true }, { fetch: fetchFn });

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

  test('never sends tags to problem.get — incidents follow the filtered triggers', async () => {
    const fetchFn = fakeFetch([]);
    const client = createZabbixClient(
      { ...BASE_CONFIG, tags: [{ tag: 'scope', value: 'availability', exclude: false }] },
      { fetch: fetchFn }
    );

    await client.getProblems();

    const body = lastRequestBody(fetchFn);
    assert.ok(!('tags' in body.params));
  });
});

describe('matchesTagFilter', () => {
  const inc = (tag, value = null) => ({ tag, value, exclude: false });
  const exc = (tag, value = null) => ({ tag, value, exclude: true });
  const tags = [
    { tag: 'Application', value: 'CPU' },
    { tag: 'environment', value: 'production' },
  ];

  test('no filters matches everything', () => {
    assert.equal(matchesTagFilter(tags, []), true);
  });

  test('inclusions are OR-ed: any one matching is enough', () => {
    assert.equal(matchesTagFilter(tags, [inc('Application', 'Memory'), inc('environment', 'production')]), true);
    assert.equal(matchesTagFilter(tags, [inc('Application', 'Memory'), inc('team')]), false);
  });

  test('value-less filter matches the tag with any value', () => {
    assert.equal(matchesTagFilter(tags, [inc('Application')]), true);
  });

  test('an exclusion wins over a matching inclusion', () => {
    assert.equal(matchesTagFilter(tags, [inc('environment', 'production'), exc('Application', 'CPU')]), false);
  });

  test('only exclusions: everything passes except what matches them', () => {
    assert.equal(matchesTagFilter(tags, [exc('Application', 'Services')]), true);
    assert.equal(matchesTagFilter(tags, [exc('Application')]), false);
  });
});

describe('getTagScope', () => {
  test('returns null and does not query Zabbix when no tags are configured', async () => {
    const fetchFn = fakeFetchByMethod({});
    const client = createZabbixClient(BASE_CONFIG, { fetch: fetchFn });

    assert.equal(await client.getTagScope(), null);
    assert.equal(fetchFn.calls.length, 0);
  });

  test('matches against trigger, item, host and template (inherited) tags', async () => {
    const fetchFn = fakeFetchByMethod({
      'trigger.get': [
        { triggerid: 't-own', tags: [{ tag: 'status', value: 'publico' }], items: [{ itemid: 'i1' }], hosts: [{ hostid: 'h1' }] },
        { triggerid: 't-item', tags: [], items: [{ itemid: 'i2' }], hosts: [{ hostid: 'h1' }] },
        { triggerid: 't-host', tags: [], items: [{ itemid: 'i3' }], hosts: [{ hostid: 'h2' }] },
        { triggerid: 't-tpl', tags: [], items: [{ itemid: 'i4' }], hosts: [{ hostid: 'h3' }] },
        { triggerid: 't-none', tags: [], items: [{ itemid: 'i5' }], hosts: [{ hostid: 'h4' }] },
      ],
      'item.get': [
        { itemid: 'i1', tags: [] },
        { itemid: 'i2', tags: [{ tag: 'Application', value: 'CPU' }] },
        { itemid: 'i3', tags: [] },
        { itemid: 'i4', tags: [] },
        { itemid: 'i5', tags: [{ tag: 'Application', value: 'Services' }] },
      ],
      'host.get': [
        { hostid: 'h1', tags: [], inheritedTags: [] },
        { hostid: 'h2', tags: [{ tag: 'environment', value: 'production' }], inheritedTags: [] },
        { hostid: 'h3', tags: [], inheritedTags: [{ tag: 'class', value: 'web' }] },
        { hostid: 'h4', tags: [], inheritedTags: [] },
      ],
    });
    const client = createZabbixClient(
      {
        ...BASE_CONFIG,
        tags: [
          { tag: 'status', value: 'publico', exclude: false },
          { tag: 'Application', value: 'CPU', exclude: false },
          { tag: 'environment', value: 'production', exclude: false },
          { tag: 'class', value: null, exclude: false },
        ],
      },
      { fetch: fetchFn }
    );

    const scope = await client.getTagScope();

    assert.deepEqual(scope.triggerIds.sort(), ['t-host', 't-item', 't-own', 't-tpl']);
    assert.deepEqual(scope.hostIds.sort(), ['h1', 'h2', 'h3']);
  });

  test('exclusion removes a trigger even when an inclusion matches', async () => {
    const fetchFn = fakeFetchByMethod({
      'trigger.get': [
        { triggerid: 't-cpu', tags: [], items: [{ itemid: 'i1' }], hosts: [{ hostid: 'h1' }] },
        { triggerid: 't-svc', tags: [], items: [{ itemid: 'i2' }], hosts: [{ hostid: 'h1' }] },
      ],
      'item.get': [
        { itemid: 'i1', tags: [{ tag: 'Application', value: 'CPU' }] },
        { itemid: 'i2', tags: [{ tag: 'Application', value: 'Services' }] },
      ],
      'host.get': [{ hostid: 'h1', tags: [{ tag: 'environment', value: 'production' }], inheritedTags: [] }],
    });
    const client = createZabbixClient(
      {
        ...BASE_CONFIG,
        tags: [
          { tag: 'environment', value: 'production', exclude: false },
          { tag: 'Application', value: 'Services', exclude: true },
        ],
      },
      { fetch: fetchFn }
    );

    const scope = await client.getTagScope();

    assert.deepEqual(scope.triggerIds, ['t-cpu']);
    assert.deepEqual(scope.hostIds, ['h1']);
  });

  test('queries all monitored triggers (no only_true), items incl. web items, and host tags', async () => {
    const fetchFn = fakeFetchByMethod({
      'trigger.get': [{ triggerid: 't1', tags: [], items: [{ itemid: 'i1' }], hosts: [{ hostid: 'h1' }] }],
      'item.get': [{ itemid: 'i1', tags: [] }],
      'host.get': [{ hostid: 'h1', tags: [], inheritedTags: [] }],
    });
    const client = createZabbixClient(
      { ...BASE_CONFIG, groupIds: ['32'], tags: [{ tag: 'x', value: null, exclude: false }] },
      { fetch: fetchFn }
    );

    await client.getTagScope();

    const byMethod = Object.fromEntries(fetchFn.calls.map((c) => [c.method, c.params]));
    assert.ok(!('only_true' in byMethod['trigger.get']));
    assert.ok(!('tags' in byMethod['trigger.get']));
    assert.deepEqual(byMethod['trigger.get'].groupids, ['32']);
    assert.deepEqual(byMethod['item.get'].itemids, ['i1']);
    assert.equal(byMethod['item.get'].webitems, true);
    assert.deepEqual(byMethod['host.get'].hostids, ['h1']);
    assert.equal(byMethod['host.get'].selectInheritedTags, 'extend');
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
