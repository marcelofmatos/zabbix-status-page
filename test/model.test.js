import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, severityToState, worseState, worstState, buildSnapshot } from '../model.js';

const NOW = new Date('2026-07-06T00:00:00Z');

describe('STATES', () => {
  test('defines the 4 canonical states with rank and pt-BR label', () => {
    assert.equal(STATES.operational.rank, 0);
    assert.equal(STATES.operational.label, 'Operacional');
    assert.equal(STATES.degraded.rank, 1);
    assert.equal(STATES.degraded.label, 'Degradado');
    assert.equal(STATES.partial.rank, 2);
    assert.equal(STATES.partial.label, 'Interrupção parcial');
    assert.equal(STATES.major.rank, 3);
    assert.equal(STATES.major.label, 'Interrupção grave');
  });
});

describe('severityToState', () => {
  test('0 and 1 map to operational', () => {
    assert.equal(severityToState(0), 'operational');
    assert.equal(severityToState(1), 'operational');
  });

  test('2 maps to degraded', () => {
    assert.equal(severityToState(2), 'degraded');
  });

  test('3 maps to partial', () => {
    assert.equal(severityToState(3), 'partial');
  });

  test('4 and 5 map to major', () => {
    assert.equal(severityToState(4), 'major');
    assert.equal(severityToState(5), 'major');
  });

  test('accepts numeric strings', () => {
    assert.equal(severityToState('0'), 'operational');
    assert.equal(severityToState('2'), 'degraded');
    assert.equal(severityToState('3'), 'partial');
    assert.equal(severityToState('5'), 'major');
  });

  test('out-of-range values fall back to operational', () => {
    assert.equal(severityToState(-1), 'operational');
    assert.equal(severityToState(6), 'operational');
    assert.equal(severityToState(100), 'operational');
  });

  test('NaN/non-numeric falls back to operational', () => {
    assert.equal(severityToState('abc'), 'operational');
    assert.equal(severityToState(NaN), 'operational');
    assert.equal(severityToState(undefined), 'operational');
  });
});

describe('worseState / worstState', () => {
  test('worseState returns the higher-rank state', () => {
    assert.equal(worseState('operational', 'major'), 'major');
    assert.equal(worseState('partial', 'degraded'), 'partial');
    assert.equal(worseState('degraded', 'degraded'), 'degraded');
  });

  test('worstState reduces a list to the worst state', () => {
    assert.equal(worstState(['operational', 'degraded', 'partial']), 'partial');
    assert.equal(worstState(['major', 'operational']), 'major');
  });

  test('worstState of empty list is operational', () => {
    assert.equal(worstState([]), 'operational');
  });
});

describe('buildSnapshot', () => {
  const hostGroups = [
    { groupid: '1', name: 'Group A' },
    { groupid: '2', name: 'Group B' },
  ];

  const hosts = [
    { hostid: '101', name: 'Host B', status: '0', hostgroups: [{ groupid: '1', name: 'Group A' }] },
    {
      hostid: '102',
      name: 'Host A',
      status: '0',
      hostgroups: [
        { groupid: '1', name: 'Group A' },
        { groupid: '2', name: 'Group B' },
      ],
    },
    { hostid: '103', name: 'Host C', status: '0', hostgroups: [{ groupid: '2', name: 'Group B' }] },
  ];

  const triggers = [
    {
      triggerid: '201',
      description: 'High CPU',
      priority: '2',
      value: '1',
      lastchange: '1000',
      hosts: [{ hostid: '101', name: 'Host B' }],
    },
    {
      triggerid: '202',
      description: 'Host down',
      priority: '4',
      value: '1',
      lastchange: '2000',
      hosts: [{ hostid: '102', name: 'Host A' }],
    },
    {
      triggerid: '203',
      description: 'Minor blip',
      priority: '1',
      value: '1',
      lastchange: '1500',
      hosts: [{ hostid: '102', name: 'Host A' }],
    },
  ];

  const problems = [
    {
      eventid: '301',
      name: 'CPU issue',
      severity: '2',
      clock: '1000',
      objectid: '201',
      acknowledged: '0',
      acknowledges: [
        { message: 'looking into it', clock: '1050', userid: '5', action: '1' },
      ],
    },
    {
      eventid: '302',
      name: 'Host A down',
      severity: '4',
      clock: '2000',
      objectid: '202',
      acknowledged: '0',
    },
    {
      eventid: '303',
      name: 'Unmatched trigger event',
      severity: '3',
      clock: '1500',
      objectid: '999',
      acknowledged: '0',
    },
  ];

  const raw = { hostGroups, hosts, triggers, problems };

  function config(overrides = {}) {
    return { statusByGroups: false, knowledges: false, knowledgesComments: false, ...overrides };
  }

  test('component state is the worst of its active triggers, sorted by priority desc', () => {
    const snapshot = buildSnapshot(raw, config(), NOW);
    const hostA = snapshot.components.find((c) => c.hostid === '102');
    assert.equal(hostA.state, 'major');
    assert.equal(hostA.activeTriggers.length, 2);
    assert.equal(hostA.activeTriggers[0].triggerid, '202');
    assert.equal(hostA.activeTriggers[0].priority, 4);
    assert.equal(hostA.activeTriggers[1].triggerid, '203');
    assert.equal(hostA.activeTriggers[1].priority, 1);
  });

  test('host with no active triggers is operational', () => {
    const snapshot = buildSnapshot(raw, config(), NOW);
    const hostC = snapshot.components.find((c) => c.hostid === '103');
    assert.equal(hostC.state, 'operational');
    assert.deepEqual(hostC.activeTriggers, []);
  });

  test('flat components list is always present, sorted by name', () => {
    const snapshot = buildSnapshot(raw, config({ statusByGroups: true }), NOW);
    assert.deepEqual(
      snapshot.components.map((c) => c.name),
      ['Host A', 'Host B', 'Host C']
    );
  });

  test('overall state is the worst of all components', () => {
    const snapshot = buildSnapshot(raw, config(), NOW);
    assert.equal(snapshot.overall.state, 'major');
    assert.equal(snapshot.overall.label, 'Interrupção grave');
  });

  test('statusByGroups=false yields empty groups array', () => {
    const snapshot = buildSnapshot(raw, config({ statusByGroups: false }), NOW);
    assert.deepEqual(snapshot.groups, []);
    assert.equal(snapshot.byGroups, false);
  });

  test('byGroups is a strict boolean regardless of config truthiness', () => {
    const truthy = buildSnapshot(raw, config({ statusByGroups: 1 }), NOW);
    assert.strictEqual(truthy.byGroups, true);

    const falsyZero = buildSnapshot(raw, config({ statusByGroups: 0 }), NOW);
    assert.strictEqual(falsyZero.byGroups, false);

    const falsyUndefined = buildSnapshot(raw, config({ statusByGroups: undefined }), NOW);
    assert.strictEqual(falsyUndefined.byGroups, false);
  });

  test('statusByGroups=true builds groups, a host in 2 groups appears in both', () => {
    const snapshot = buildSnapshot(raw, config({ statusByGroups: true }), NOW);
    assert.equal(snapshot.byGroups, true);
    assert.equal(snapshot.groups.length, 2);

    const groupA = snapshot.groups.find((g) => g.groupid === '1');
    const groupB = snapshot.groups.find((g) => g.groupid === '2');

    assert.deepEqual(
      groupA.components.map((c) => c.hostid),
      ['102', '101']
    ); // sorted by name: Host A, Host B
    assert.deepEqual(
      groupB.components.map((c) => c.hostid),
      ['102', '103']
    ); // sorted by name: Host A, Host C

    // group state = worst of its components
    assert.equal(groupA.state, 'major'); // degraded (101) vs major (102)
    assert.equal(groupB.state, 'major'); // major (102) vs operational (103)
  });

  test('incidents is empty when knowledges is false', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: false }), NOW);
    assert.deepEqual(snapshot.incidents, []);
  });

  test('incidents resolve host via objectid -> trigger -> host', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true }), NOW);
    const incident = snapshot.incidents.find((i) => i.eventid === '301');
    assert.deepEqual(incident.host, { hostid: '101', name: 'Host B' });
  });

  test('incident host is null when objectid does not match any trigger', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true }), NOW);
    const incident = snapshot.incidents.find((i) => i.eventid === '303');
    assert.equal(incident.host, null);
  });

  test('incidents are sorted by clock desc', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true }), NOW);
    assert.deepEqual(
      snapshot.incidents.map((i) => i.eventid),
      ['302', '303', '301']
    );
  });

  test('incident severity/state coercion', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true }), NOW);
    const incident = snapshot.incidents.find((i) => i.eventid === '302');
    assert.equal(incident.severity, 4);
    assert.equal(incident.state, 'major');
    assert.equal(incident.clock, 2000);
  });

  test('acknowledges are empty unless knowledgesComments is true', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true, knowledgesComments: false }), NOW);
    const incident = snapshot.incidents.find((i) => i.eventid === '301');
    assert.deepEqual(incident.acknowledges, []);
  });

  test('acknowledges are mapped with numeric clock/action and no author fields when knowledgesComments is true', () => {
    const snapshot = buildSnapshot(raw, config({ knowledges: true, knowledgesComments: true }), NOW);
    const incident = snapshot.incidents.find((i) => i.eventid === '301');
    assert.deepEqual(incident.acknowledges, [
      { clock: 1050, message: 'looking into it', action: 1, userid: '5' },
    ]);
    assert.ok(!('username' in incident.acknowledges[0]));
    assert.ok(!('name' in incident.acknowledges[0]));
    assert.ok(!('surname' in incident.acknowledges[0]));
  });

  test('generatedAt reflects the passed-in now', () => {
    const snapshot = buildSnapshot(raw, config(), NOW);
    assert.equal(snapshot.generatedAt, NOW.toISOString());
  });

  test('is pure: does not mutate inputs', () => {
    const before = JSON.parse(JSON.stringify(raw));
    buildSnapshot(raw, config({ statusByGroups: true, knowledges: true, knowledgesComments: true }), NOW);
    assert.deepEqual(raw, before);
  });
});
