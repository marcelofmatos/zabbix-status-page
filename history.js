import fs from 'node:fs/promises';
import path from 'node:path';
import { worseState } from './model.js';

function dayKeyFor(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

function dayKeyToUtcMidnight(dayKey) {
  return new Date(`${dayKey}T00:00:00Z`);
}

function windowDayKeys(date, tz, historyDays) {
  const todayUtcMidnight = dayKeyToUtcMidnight(dayKeyFor(date, tz));
  const keys = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const d = new Date(todayUtcMidnight);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

export function createHistoryStore({ filePath, historyDays = 90, tz = 'UTC' }) {
  let data = {};

  function prune(date) {
    const keep = new Set(windowDayKeys(date, tz, historyDays));
    for (const componentKey of Object.keys(data)) {
      const days = data[componentKey];
      for (const dayKey of Object.keys(days)) {
        if (!keep.has(dayKey)) delete days[dayKey];
      }
      if (Object.keys(days).length === 0) delete data[componentKey];
    }
  }

  async function load() {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        data = {};
        return;
      }
      throw err;
    }
    try {
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
  }

  async function update(snapshot, date = new Date()) {
    const dayKey = dayKeyFor(date, tz);

    for (const component of snapshot.components) {
      const days = data[component.key] || (data[component.key] = {});
      days[dayKey] = days[dayKey] ? worseState(days[dayKey], component.state) : component.state;
    }

    prune(date);

    const tmpPath = `${filePath}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(data), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  function getSeries(componentKey, date = new Date()) {
    const days = data[componentKey] || {};
    return windowDayKeys(date, tz, historyDays).map((dayKeyValue) => ({
      date: dayKeyValue,
      state: days[dayKeyValue] ?? null,
    }));
  }

  return { load, update, getSeries };
}
