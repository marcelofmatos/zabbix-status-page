const DEFAULT_TIMEOUT_MS = 15000;

export function createZabbixClient(config, { fetch: fetchFn = fetch } = {}) {
  let nextId = 1;

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

  async function getProblems() {
    const params = withFilters({
      output: ['eventid', 'name', 'severity', 'clock', 'objectid', 'acknowledged'],
      recent: false,
      sortfield: ['eventid'],
      sortorder: 'DESC',
      selectTags: 'extend',
    });
    if (config.knowleadsComments) {
      params.selectAcknowledges = ['clock', 'message', 'action', 'userid'];
    }
    return call('problem.get', params);
  }

  return { getHostGroups, getHosts, getActiveTriggers, getProblems };
}
