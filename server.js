import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { loadConfig } from './config.js';
import { createZabbixClient } from './zabbix.js';
import { createHistoryStore } from './history.js';
import { buildSnapshot, STATES } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let currentState = { snapshot: null, stale: false, lastError: null, lastUpdatedAt: null };

function getState() {
  return currentState;
}

function setState(next) {
  currentState = typeof next === 'function' ? next(currentState) : next;
}

function resolveOg(config) {
  const base = (config.publicUrl || '').replace(/\/$/, '');
  let image = config.ogImage || '';
  if (image && !/^https?:\/\//i.test(image)) {
    // um caminho relativo só vira absoluto a partir de um PUBLIC_URL confiável
    image = base ? base + (image.startsWith('/') ? image : `/${image}`) : '';
  }
  return { url: base ? `${base}/` : '', image };
}

export function createApp({ config, getState: readState, history }) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.get('/healthz', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  app.get('/api/status', (_req, res) => {
    res.json({ ...readState(), refreshSeconds: config.pollIntervalSeconds });
  });

  app.get('/', (_req, res) => {
    const { snapshot, stale, lastError, lastUpdatedAt } = readState();
    const meta = { stale, lastError, lastUpdatedAt, refreshSeconds: config.pollIntervalSeconds };
    const og = resolveOg(config);

    if (!snapshot) {
      res.render('status', {
        config,
        overall: null,
        byGroups: false,
        groups: [],
        components: [],
        incidents: [],
        seriesByKey: {},
        meta,
        og,
        STATES,
      });
      return;
    }

    const seriesByKey = {};
    for (const component of snapshot.components) {
      seriesByKey[component.key] = history.getSeries(component.key);
    }

    res.render('status', {
      config,
      overall: snapshot.overall,
      byGroups: snapshot.byGroups,
      groups: snapshot.groups,
      components: snapshot.components,
      incidents: snapshot.incidents,
      seriesByKey,
      meta,
      og,
      STATES,
    });
  });

  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

export function createPoller({ config, client, history, setState: writeState, now = () => new Date() }) {
  async function tick() {
    try {
      const [hostGroups, hosts, triggers, problems] = await Promise.all([
        client.getHostGroups(),
        client.getHosts(),
        client.getActiveTriggers(),
        client.getProblems(),
      ]);
      const snapshot = buildSnapshot({ hostGroups, hosts, triggers, problems }, config, now());
      await history.update(snapshot, now());
      writeState({ snapshot, stale: false, lastError: null, lastUpdatedAt: now().toISOString() });
    } catch (err) {
      console.error('[poller] falha ao atualizar status:', err);
      writeState((prev) => ({ ...prev, stale: true, lastError: String(err.message || err) }));
    }
  }

  return { tick };
}

async function main() {
  const config = loadConfig();
  const client = createZabbixClient(config);
  const history = createHistoryStore({
    filePath: process.env.HISTORY_FILE ?? '/data/history.json',
    historyDays: config.historyDays,
    tz: config.tz,
  });
  await history.load();

  const poller = createPoller({ config, client, history, setState });
  await poller.tick();
  setInterval(() => poller.tick(), config.pollIntervalSeconds * 1000);

  const app = createApp({ config, getState, history });
  app.listen(config.port, () => {
    console.log(`Status page ouvindo em http://0.0.0.0:${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
