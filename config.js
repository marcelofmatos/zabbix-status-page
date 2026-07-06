const DEFAULTS = {
  port: 8080,
  pollIntervalSeconds: 60,
  historyDays: 90,
  pageTitle: 'Status',
  tz: 'UTC',
  minSeverity: 0,
};

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFlag(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'on' || normalized === 'true' || normalized === '1';
}

function parseInt10(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseSeverity(value) {
  const parsed = parseInt10(value, DEFAULTS.minSeverity);
  return Math.min(5, Math.max(0, parsed));
}

function buildApiUrl(baseUrl) {
  if (!baseUrl) return '';
  const trimmed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${trimmed}api_jsonrpc.php`;
}

export function loadConfig(env = process.env) {
  const zabbixUrl = env.ZABBIX_URL || '';

  const config = {
    zabbixUrl,
    zabbixToken: env.ZABBIX_TOKEN || '',
    apiUrl: buildApiUrl(zabbixUrl),
    groupIds: parseCsv(env.ZABBIX_GROUPS_IDS),
    hostIds: parseCsv(env.ZABBIX_HOSTS_IDS),
    statusByGroups: parseFlag(env.ZABBIX_STATUS_BY_GROUPS),
    knowleads: parseFlag(env.ZABBIX_KNOWLEADS),
    knowleadsComments: parseFlag(env.ZABBIX_KNOWLEADS_COMMENTS),
    port: parseInt10(env.PORT, DEFAULTS.port),
    pollIntervalSeconds: parseInt10(env.POLL_INTERVAL_SECONDS, DEFAULTS.pollIntervalSeconds),
    historyDays: parseInt10(env.HISTORY_DAYS, DEFAULTS.historyDays),
    pageTitle: env.PAGE_TITLE || DEFAULTS.pageTitle,
    tz: env.TZ || DEFAULTS.tz,
    minSeverity: parseSeverity(env.ZABBIX_MIN_SEVERITY),
  };

  return Object.freeze(config);
}
