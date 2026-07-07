export const STATES = {
  operational: { key: 'operational', rank: 0, label: 'Operacional' },
  degraded: { key: 'degraded', rank: 1, label: 'Degradado' },
  partial: { key: 'partial', rank: 2, label: 'Interrupção parcial' },
  major: { key: 'major', rank: 3, label: 'Interrupção grave' },
};

export function severityToState(severity) {
  const value = Number(severity);
  if (!Number.isInteger(value) || value < 0 || value > 5) return 'operational';
  if (value <= 1) return 'operational';
  if (value === 2) return 'degraded';
  if (value === 3) return 'partial';
  return 'major';
}

export function worseState(a, b) {
  return STATES[a].rank >= STATES[b].rank ? a : b;
}

export function worstState(states) {
  return states.reduce(worseState, 'operational');
}

function groupTriggersByHostId(triggers) {
  const map = new Map();
  for (const trigger of triggers) {
    for (const host of trigger.hosts) {
      const hostId = String(host.hostid);
      if (!map.has(hostId)) map.set(hostId, []);
      map.get(hostId).push(trigger);
    }
  }
  return map;
}

function buildComponent(host, hostTriggers) {
  const activeTriggers = hostTriggers
    .map((trigger) => ({
      triggerid: trigger.triggerid,
      description: trigger.description,
      priority: Number(trigger.priority),
      state: severityToState(trigger.priority),
      lastchange: Number(trigger.lastchange),
    }))
    .sort((a, b) => b.priority - a.priority);

  const state = worstState(activeTriggers.map((trigger) => trigger.state));

  return {
    key: String(host.hostid),
    hostid: host.hostid,
    name: host.name,
    state,
    label: STATES[state].label,
    activeTriggers,
  };
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function buildGroups(hostGroups, hosts, componentsByHostId) {
  return hostGroups.map((group) => {
    const components = hosts
      .filter((host) => (host.hostgroups || []).some((hg) => String(hg.groupid) === String(group.groupid)))
      .map((host) => componentsByHostId.get(String(host.hostid)))
      .sort(byName);

    const state = worstState(components.map((component) => component.state));

    return {
      groupid: group.groupid,
      name: group.name,
      state,
      label: STATES[state].label,
      components,
    };
  });
}

function buildIncidents(problems, config, triggerById) {
  return problems
    .map((problem) => {
      const trigger = triggerById.get(String(problem.objectid));
      const firstHost = trigger && trigger.hosts[0];
      const host = firstHost ? { hostid: firstHost.hostid, name: firstHost.name } : null;
      // Usa a priority ATUAL do trigger — o Zabbix não atualiza a severidade de
      // problemas já abertos quando a severidade do trigger muda. Fallback para a
      // severidade gravada no problema quando o trigger não é encontrado.
      const severity = trigger ? Number(trigger.priority) : Number(problem.severity);

      return {
        eventid: problem.eventid,
        name: problem.name,
        severity,
        state: severityToState(severity),
        clock: Number(problem.clock),
        host,
        acknowledges: config.knowledgesComments
          ? (problem.acknowledges || []).map((ack) => ({
              clock: Number(ack.clock),
              message: ack.message,
              action: Number(ack.action),
              userid: ack.userid,
            }))
          : [],
      };
    })
    .sort((a, b) => b.clock - a.clock);
}

export function buildSnapshot({ hostGroups = [], hosts = [], triggers = [], problems = [] }, config, now = new Date()) {
  const triggersByHostId = groupTriggersByHostId(triggers);

  const components = hosts
    .map((host) => buildComponent(host, triggersByHostId.get(String(host.hostid)) || []))
    .sort(byName);

  const componentsByHostId = new Map(components.map((component) => [component.key, component]));

  const groups = config.statusByGroups ? buildGroups(hostGroups, hosts, componentsByHostId) : [];

  const overallState = worstState(components.map((component) => component.state));

  const triggerById = new Map(triggers.map((trigger) => [String(trigger.triggerid), trigger]));
  const incidents = config.knowledges ? buildIncidents(problems, config, triggerById) : [];

  return {
    generatedAt: now.toISOString(),
    overall: { state: overallState, label: STATES[overallState].label },
    byGroups: Boolean(config.statusByGroups),
    groups,
    components,
    incidents,
  };
}
