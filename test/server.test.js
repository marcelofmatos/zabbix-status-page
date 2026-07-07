import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createPoller } from '../server.js';

const baseConfig = {
  pageTitle: 'Status — Teste',
  pollIntervalSeconds: 45,
  knowledges: true,
  knowledgesComments: true,
  statusByGroups: false,
  tz: 'America/Puerto_Rico',
};

function populatedSnapshot() {
  return {
    generatedAt: '2026-07-06T12:00:00.000Z',
    overall: { state: 'operational', label: 'Operacional' },
    byGroups: false,
    groups: [],
    components: [
      {
        key: '1001',
        hostid: '1001',
        name: 'API <script>alerta</script>',
        state: 'operational',
        label: 'Operacional',
        activeTriggers: [],
      },
    ],
    incidents: [
      {
        eventid: '5001',
        name: 'Falha <b>crítica</b> no link',
        severity: 4,
        state: 'major',
        clock: 1751803200,
        host: { hostid: '1001', name: 'Roteador de borda' },
        acknowledges: [
          {
            clock: 1751803800,
            message: 'Equipe acionada & investigando',
            action: 6,
            userid: '7',
          },
        ],
      },
    ],
  };
}

function fakeHistory() {
  return {
    load: async () => {},
    update: async () => {},
    getSeries: () => [
      { date: '2026-07-05', state: 'operational' },
      { date: '2026-07-06', state: null },
    ],
  };
}

function makeState(overrides = {}) {
  return {
    snapshot: null,
    stale: false,
    lastError: null,
    lastUpdatedAt: null,
    ...overrides,
  };
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createApp', () => {
  test('GET /healthz returns 200 and body "ok"', async () => {
    const app = createApp({ config: baseConfig, getState: () => makeState(), history: fakeHistory() });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/healthz`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'ok');
    });
  });

  test('GET /api/status echoes the injected state plus refreshSeconds', async () => {
    const state = makeState({
      snapshot: populatedSnapshot(),
      stale: true,
      lastError: 'timeout',
      lastUpdatedAt: '2026-07-06T12:00:00.000Z',
    });
    const app = createApp({ config: baseConfig, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/status`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.stale, true);
      assert.equal(body.lastError, 'timeout');
      assert.equal(body.lastUpdatedAt, '2026-07-06T12:00:00.000Z');
      assert.equal(body.refreshSeconds, 45);
      assert.equal(body.snapshot.overall.state, 'operational');
    });
  });

  test('GET / with a populated snapshot renders banner, component and uptime segments, escaping data', async () => {
    const state = makeState({ snapshot: populatedSnapshot(), lastUpdatedAt: '2026-07-06T12:00:00.000Z' });
    const app = createApp({ config: baseConfig, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /^<!DOCTYPE html>/i);
      assert.match(html, /<html lang="pt-BR">/);
      assert.match(html, /Todos os sistemas operacionais/);
      // component name present but HTML-escaped (no raw injection)
      assert.match(html, /API &lt;script&gt;/);
      assert.doesNotMatch(html, /<script>alerta<\/script>/);
      // incident with escaped markup
      assert.match(html, /Falha &lt;b&gt;cr/);
      // acknowledge message present, escaped (no raw injection)
      assert.match(html, /Equipe acionada &amp; investigando/);
      // at least one uptime segment
      assert.match(html, /class="uptime-day/);
      // favicon dinâmico reflete o estado geral (operational -> verde)
      const fav = html.match(/rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,([^"]+)"/);
      assert.ok(fav, 'favicon <link> presente');
      assert.match(Buffer.from(fav[1], 'base64').toString('utf8'), /#34d399/);
    });
  });

  test('GET / renders Open Graph tags with an absolute image from PUBLIC_URL', async () => {
    const config = {
      ...baseConfig,
      pageTitle: 'Status Example',
      siteName: 'Example Org',
      pageDescription: 'Disponibilidade dos serviços em tempo real',
      ogImage: '/og-image.png',
      publicUrl: 'https://status.example.com',
    };
    const state = makeState({ snapshot: populatedSnapshot(), lastUpdatedAt: '2026-07-06T12:00:00.000Z' });
    const app = createApp({ config, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<meta property="og:title" content="Status Example">/);
      assert.match(html, /<meta property="og:site_name" content="Example Org">/);
      assert.match(html, /<meta property="og:description" content="Disponibilidade dos serviços em tempo real">/);
      assert.match(html, /<meta property="og:url" content="https:\/\/status\.example\.com\/">/);
      assert.match(html, /<meta property="og:image" content="https:\/\/status\.example\.com\/og-image\.png">/);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
      assert.match(html, /<meta name="description" content="Disponibilidade dos serviços em tempo real">/);
    });
  });

  test('GET / without PUBLIC_URL omits og:url and a relative OG_IMAGE (no Host reflection)', async () => {
    const config = { ...baseConfig, ogImage: '/og-image.png' };
    const state = makeState({ snapshot: populatedSnapshot(), lastUpdatedAt: '2026-07-06T12:00:00.000Z' });
    const app = createApp({ config, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      // sem PUBLIC_URL confiável, não refletimos o Host: og:url e og:image relativo são omitidos
      assert.doesNotMatch(html, /property="og:url"/);
      assert.doesNotMatch(html, /property="og:image"/);
      const host = base.replace(/^http:\/\//, '');
      assert.doesNotMatch(html, new RegExp(host.replace(/\./g, '\\.')));
    });
  });

  test('GET / without PUBLIC_URL keeps an absolute OG_IMAGE but still omits og:url', async () => {
    const config = { ...baseConfig, ogImage: 'https://cdn.example.com/x.png' };
    const state = makeState({ snapshot: populatedSnapshot(), lastUpdatedAt: '2026-07-06T12:00:00.000Z' });
    const app = createApp({ config, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.example\.com\/x\.png">/);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
      assert.doesNotMatch(html, /property="og:url"/);
    });
  });

  test('GET / without OG_IMAGE uses twitter:card summary and emits no og:image', async () => {
    const config = { ...baseConfig, pageDescription: 'sem imagem' };
    const state = makeState({ snapshot: populatedSnapshot(), lastUpdatedAt: '2026-07-06T12:00:00.000Z' });
    const app = createApp({ config, getState: () => state, history: fakeHistory() });
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<meta name="twitter:card" content="summary">/);
      assert.doesNotMatch(html, /property="og:image"/);
    });
  });

  test('GET / with snapshot null returns 200 (not 500) and the Zabbix failure message', async () => {
    const app = createApp({
      config: baseConfig,
      getState: () => makeState({ stale: true, lastError: 'boom' }),
      history: fakeHistory(),
    });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Não foi possível consultar o Zabbix/);
      // favicon cinza quando não há dados
      const fav = html.match(/rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,([^"]+)"/);
      assert.ok(fav, 'favicon presente');
      assert.match(Buffer.from(fav[1], 'base64').toString('utf8'), /#9ca3af/);
    });
  });
});

describe('createPoller', () => {
  const fixture = {
    hostGroups: [{ groupid: '2', name: 'Rede' }],
    hosts: [{ hostid: '1001', name: 'Host A', hostgroups: [{ groupid: '2', name: 'Rede' }] }],
    triggers: [],
    problems: [],
  };

  function okClient() {
    return {
      getHostGroups: async () => fixture.hostGroups,
      getHosts: async () => fixture.hosts,
      getActiveTriggers: async () => fixture.triggers,
      getProblems: async () => fixture.problems,
    };
  }

  let originalError;
  beforeEach(() => {
    originalError = console.error;
    console.error = () => {};
  });
  afterEach(() => {
    console.error = originalError;
  });

  test('tick() with a healthy client sets a fresh snapshot', async () => {
    let state = makeState();
    const setState = (next) => {
      state = typeof next === 'function' ? next(state) : next;
    };
    const poller = createPoller({
      config: baseConfig,
      client: okClient(),
      history: fakeHistory(),
      setState,
      now: () => new Date('2026-07-06T12:00:00.000Z'),
    });
    await poller.tick();
    assert.equal(state.stale, false);
    assert.equal(state.lastError, null);
    assert.equal(state.lastUpdatedAt, '2026-07-06T12:00:00.000Z');
    assert.ok(state.snapshot);
    assert.equal(state.snapshot.components[0].name, 'Host A');
  });

  test('tick() with a failing client keeps previous snapshot and marks stale without throwing', async () => {
    const previous = populatedSnapshot();
    let state = makeState({ snapshot: previous, stale: false, lastError: null });
    const setState = (next) => {
      state = typeof next === 'function' ? next(state) : next;
    };
    const failingClient = {
      getHostGroups: async () => {
        throw new Error('conexão recusada');
      },
      getHosts: async () => [],
      getActiveTriggers: async () => [],
      getProblems: async () => [],
    };
    const poller = createPoller({
      config: baseConfig,
      client: failingClient,
      history: fakeHistory(),
      setState,
    });
    await assert.doesNotReject(() => poller.tick());
    assert.equal(state.snapshot, previous);
    assert.equal(state.stale, true);
    assert.match(state.lastError, /conexão recusada/);
  });
});
