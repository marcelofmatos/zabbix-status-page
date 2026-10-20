import { Agent } from 'undici';

const DEFAULT_TIMEOUT_MS = 15000;

// Filtro por tag: as inclusões são OU (basta uma casar; sem inclusões, tudo passa) e
// qualquer exclusão que case vence. Filtro com value null casa a tag com qualquer valor.
export function matchesTagFilter(tags, filters) {
  const matches = (filter) =>
    tags.some((t) => t.tag === filter.tag && (filter.value == null || t.value === filter.value));
  const includes = filters.filter((f) => !f.exclude);
  const excludes = filters.filter((f) => f.exclude);
  if (includes.length > 0 && !includes.some(matches)) return false;
  return !excludes.some(matches);
}

export function createZabbixClient(config, { fetch: fetchFn = fetch } = {}) {
  let nextId = 1;
  // Quando ZABBIX_TLS_INSECURE está ligado, desativa a verificação do certificado
  // APENAS nas chamadas ao Zabbix (via dispatcher undici) — não afeta o resto do processo.
  const dispatcher = config.tlsInsecure
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  async function call(method, params) {
    const id = nextId++;
    const response = await fetchFn(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json-rpc',
        Authorization: `Bearer ${config.zabbixToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
      signal: AbortSignal.timeout(config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
      dispatcher,
    });

    if (!response.ok) {
      throw new Error(`Zabbix API request failed with HTTP status ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
      throw new Error(`Zabbix API error: ${body.error.data || body.error.message}`);
    }

    return body.result;
  }

  function withFilters(params) {
    if (config.groupIds.length > 0) params.groupids = config.groupIds;
    if (config.hostIds.length > 0) params.hostids = config.hostIds;
    return params;
  }

  const tags = config.tags || [];

  async function getHostGroups() {
    const params = {
      output: ['groupid', 'name'],
      with_monitored_hosts: true,
      sortfield: 'name',
    };
    if (config.groupIds.length > 0) params.groupids = config.groupIds;
    return call('hostgroup.get', params);
  }

  async function getHosts() {
    const params = withFilters({
      output: ['hostid', 'name', 'status'],
      selectHostGroups: ['groupid', 'name'],
      monitored_hosts: true,
      sortfield: 'name',
    });
    return call('host.get', params);
  }

  async function getActiveTriggers() {
    const params = withFilters({
      output: ['triggerid', 'description', 'priority', 'value', 'lastchange'],
      selectHosts: ['hostid', 'name'],
      monitored: true,
      active: true,
      only_true: true,
      skipDependent: true,
      expandDescription: true,
      min_severity: config.minSeverity,
      sortfield: 'priority',
      sortorder: 'DESC',
    });
    return call('trigger.get', params);
  }

  // Escopo do filtro por tag: triggers (em qualquer estado) cujas tags efetivas casam com
  // o filtro, e os hosts deles. Tags efetivas = as do trigger + dos itens + do host + dos
  // templates do host — as mesmas que o Zabbix grava no problema. O trigger.get só filtra
  // pelas tags do próprio trigger, por isso o casamento é feito aqui. null = sem filtro.
  async function getTagScope() {
    if (tags.length === 0) return null;
    const triggers = await call('trigger.get', withFilters({
      output: ['triggerid'],
      selectTags: 'extend',
      selectItems: ['itemid'],
      selectHosts: ['hostid'],
      monitored: true,
    }));
    const itemIds = [...new Set(triggers.flatMap((t) => (t.items || []).map((i) => String(i.itemid))))];
    const hostIds = [...new Set(triggers.flatMap((t) => (t.hosts || []).map((h) => String(h.hostid))))];
    const [items, hosts] = await Promise.all([
      call('item.get', { itemids: itemIds, output: ['itemid'], selectTags: 'extend', webitems: true }),
      call('host.get', { hostids: hostIds, output: ['hostid'], selectTags: 'extend', selectInheritedTags: 'extend' }),
    ]);
    const itemTags = new Map(items.map((i) => [String(i.itemid), i.tags || []]));
    const hostTags = new Map(hosts.map((h) => [String(h.hostid), [...(h.tags || []), ...(h.inheritedTags || [])]]));

    const scope = { triggerIds: [], hostIds: new Set() };
    for (const trigger of triggers) {
      const effective = [
        ...(trigger.tags || []),
        ...(trigger.items || []).flatMap((i) => itemTags.get(String(i.itemid)) || []),
        ...(trigger.hosts || []).flatMap((h) => hostTags.get(String(h.hostid)) || []),
      ];
      if (!matchesTagFilter(effective, tags)) continue;
      scope.triggerIds.push(String(trigger.triggerid));
      for (const host of trigger.hosts || []) scope.hostIds.add(String(host.hostid));
    }
    return { triggerIds: scope.triggerIds, hostIds: [...scope.hostIds] };
  }

  async function getProblems() {
    const params = withFilters({
      output: ['eventid', 'name', 'severity', 'clock', 'objectid', 'acknowledged'],
      recent: false,
      sortfield: ['eventid'],
      sortorder: 'DESC',
      selectTags: 'extend',
    });
    if (config.knowledgesComments) {
      params.selectAcknowledges = ['clock', 'message', 'action', 'userid'];
    }
    return call('problem.get', params);
  }

  return { getHostGroups, getHosts, getActiveTriggers, getProblems, getTagScope };
}
