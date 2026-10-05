import assert from 'node:assert/strict';
import {test, beforeEach} from 'node:test';
import {SYNC_MINUTES, today, periods, parseDay, normalizeLogs, makeSnapshot, validateConfig, validateLeave, exportCsv} from '../src/core.js';

const config = {url: 'https://gitlab.example.com', projects: [{project: 'Project A', url: 'group/a'}], rememberToken: false};
const log = (id, spentAt, seconds = 3600, extra = {}) => ({
  id, spentAt, timeSpent: seconds, user: {username: 'me'}, project: {fullPath: 'group/a'},
  issue: {iid: 12, title: 'Work item', webUrl: 'https://gitlab.example.com/group/a/-/work_items/12'},
  mergeRequest: null, summary: '', ...extra,
});

test('Vietnam dates, Monday weeks, leap month and exclusive date boundaries', () => {
  assert.equal(today(new Date('2026-09-30T17:00:00Z')), '2026-10-01');
  assert.deepEqual(periods('2024-02-01'), {
    dayStart: '2024-02-01', dayEnd: '2024-02-02', weekStart: '2024-01-29', weekEnd: '2024-02-05',
    monthStart: '2024-02-01', monthEnd: '2024-03-01', start: '2024-01-29', end: '2024-03-01',
  });
  assert.throws(() => parseDay('2024-02-30'));
  const inputs = [
    log('before', '2026-09-30T16:59:59Z'), log('first', '2026-09-30T17:00:00Z'),
    log('fix', '2026-10-01T01:00:00Z', -1800), log('last', '2026-10-31T16:59:59Z', 7200),
    log('after', '2026-10-31T17:00:00Z'), log('someone', '2026-10-01T01:00:00Z', 3600, {user: {username: 'other'}}),
    log('outside', '2026-10-01T01:00:00Z', 3600, {project: {fullPath: 'outside/project'}}),
    log('first', '2026-09-30T17:00:00Z'),
  ];
  const rows = normalizeLogs(inputs, config, 'me', '2026-10-01', '2026-11-01');
  assert.equal(rows.length, 3);
  const snapshot = makeSnapshot('2026-10-01', {logs: rows, syncedAt: new Date().toISOString()}, [{day: '2026-10-01', hours: 4, reason: 'Leave'}]);
  assert.equal(snapshot.day.hours, 0.5);
  assert.equal(snapshot.week.hours, 0.5);
  assert.equal(snapshot.month.hours, 2.5);
  assert.equal(makeSnapshot('2026-10-01', null, []).month.hours, null);
  const crossWeekLogs = [
    {id: 'sep', date: '2026-09-29', project: 'Project A', task: '1', type: 'TASK', hours: 3, title: 'Sep task'},
    {id: 'oct', date: '2026-10-01', project: 'Project A', task: '2', type: 'TASK', hours: 2, title: 'Oct task'},
  ];
  const crossWeekLeaves = [
    {id: 'l-sep', day: '2026-09-28', hours: 8, reason: 'Sep leave'},
    {id: 'l-oct', day: '2026-10-02', hours: 4, reason: 'Oct leave'},
  ];
  const crossSnapshot = makeSnapshot('2026-10-01', {logs: crossWeekLogs, syncedAt: new Date().toISOString()}, crossWeekLeaves);
  assert.equal(crossSnapshot.week.hours, 2);
  assert.equal(crossSnapshot.week.leaveHours, 4);
  const csv = exportCsv(snapshot);
  assert.ok(csv.startsWith('\uFEFF"Project","Task","Type","Time","Date"'));
  assert.ok(csv.includes('"OFF","Leave","OFF","4","October 1, 2026"'));
  assert.ok(csv.includes('"Project A","12","TASK","-0.5","October 1, 2026"'));
  assert.throws(() => exportCsv({...snapshot, error: 'Offline'}));
});

test('configuration and leave validation; external task links do not become executable links', () => {
  assert.equal(validateConfig({...config, projects: JSON.stringify([...config.projects, {project: 'OFF', url: ''}])}).projects.length, 1);
  assert.throws(() => validateConfig({...config, url: 'http://remote.example.com'}));
  assert.throws(() => validateConfig({...config, projects: [...config.projects, ...config.projects]}));
  assert.throws(() => validateConfig({...config, projects: [null]}));
  for (const hours of [0, -1, NaN, Infinity, 25]) assert.throws(() => validateLeave({day: '2026-10-01', hours, reason: 'Off'}));
  assert.throws(() => validateLeave({day: '2026-10-01', hours: 8, reason: ''}));
  const rows = normalizeLogs([log('unsafe', '2026-10-01T01:00:00Z', 3600, {issue: {iid: 1, title: '<script>', webUrl: 'javascript:alert(1)'}})], config, 'me', '2026-10-01', '2026-11-01');
  assert.equal(rows[0].url, null);
});

let local = {}, session = {}, fetches = [], replyPages = [], alarm;
const events = {};
function area(getData) {
  return {
    async get(keys) {
      const data = getData(), result = {};
      for (const key of (Array.isArray(keys) ? keys : [keys])) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    },
    async set(data) {Object.assign(getData(), structuredClone(data));},
    async remove(key) {delete getData()[key];},
    async setAccessLevel() {},
  };
}
globalThis.chrome = {
  storage: {local: area(() => local), session: area(() => session)},
  alarms: {
    async get() {return alarm;}, async create(name, options) {alarm = {name, ...options};},
    onAlarm: {addListener(fn) {events.alarm = fn;}},
  },
  runtime: {id: 'test-extension', onMessage: {addListener(fn) {events.message = fn;}},
    onInstalled: {addListener(fn) {events.installed = fn;}}, onStartup: {addListener(fn) {events.startup = fn;}},
  },
};
globalThis.fetch = async (url, options) => {
  const payload = JSON.parse(options.body); fetches.push(payload);
  if (payload.query.includes('currentUser')) return {ok: true, async json() {return {data: {currentUser: {username: 'me'}}};}};
  const response = replyPages.shift();
  if (response instanceof Error) throw response;
  if (!response) throw new Error('Unexpected fetch');
  return {ok: true, async json() {return response;}};
};
const {handleMessage} = await import('../src/background.js');
const page = (nodes, hasNextPage = false, endCursor = null) => ({data: {timelogs: {nodes, pageInfo: {hasNextPage, endCursor}}}});
const day = '2026-10-01';
async function connect() {
  replyPages.push(page([log('one', '2026-10-01T01:00:00Z')]));
  return handleMessage({type: 'connect', config, token: 'test-token', day});
}
beforeEach(() => {local = {}; session = {}; fetches = []; replyPages = [];});

test('five-minute scheduling is recreated; refresh reads every page, caches, and handles deleted logs', async () => {
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(SYNC_MINUTES, 5);
  assert.equal(alarm.periodInMinutes, 5);
  await connect();
  assert.equal(local.token, undefined);
  assert.equal(session.token, 'test-token');
  const before = fetches.length;
  assert.equal((await handleMessage({type: 'snapshot', day})).month.hours, 1);
  assert.equal(fetches.length, before);
  replyPages.push(page([log('one', '2026-10-01T01:00:00Z')], true, 'next'), page([log('two', '2026-10-01T02:00:00Z', 7200)]));
  const snapshot = await handleMessage({type: 'snapshot', day, force: true});
  assert.equal(snapshot.month.hours, 3);
  assert.equal(fetches.at(-1).variables.after, 'next');
  replyPages.push(page([]));
  assert.equal((await handleMessage({type: 'snapshot', day, force: true})).month.hours, 0);
});

test('failed pagination preserves old data; a failed first load stays unknown; retry requires force or five minutes', async () => {
  await connect();
  replyPages.push(page([log('partial', '2026-10-01T02:00:00Z', 7200)], true, 'next'), new Error('Offline'));
  const stale = await handleMessage({type: 'snapshot', day, force: true});
  assert.equal(stale.month.hours, 1);
  assert.equal(stale.error, 'Offline');
  const before = fetches.length;
  assert.equal((await handleMessage({type: 'snapshot', day})).month.hours, 1);
  assert.equal(fetches.length, before);
  await assert.rejects(handleMessage({type: 'export', day}));
  local.profiles[local.config.profile].caches = {};
  replyPages.push(new Error('Offline'));
  assert.equal((await handleMessage({type: 'snapshot', day})).month.hours, null);
});

test('the scheduled alarm forces a refresh of the current period even with a fresh cache', async () => {
  await connect();
  const current = today();
  replyPages.push(page([log('current', `${current}T09:00:00+07:00`, 7200)]));
  const before = fetches.length;
  events.alarm({name: 'unrelated'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches.length, before);
  events.alarm({name: 'gitlab-sync'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches.length, before + 1);
  assert.equal((await handleMessage({type: 'snapshot', day: current})).day.hours, 2);
});

test('leave create/edit/delete, atomic restore, account isolation and token-free backups', async () => {
  await connect();
  await handleMessage({type: 'leave.save', entry: {day, hours: 4, reason: 'Vacation, "AM"'}});
  await assert.rejects(handleMessage({type: 'leave.save', entry: {day, hours: 8, reason: 'Duplicate'}}));
  const backup = await handleMessage({type: 'backup'}), id = backup.leaves[0].id;
  assert.equal(JSON.stringify(backup).includes('test-token'), false);
  await handleMessage({type: 'leave.save', id, entry: {day, hours: 8, reason: 'Full day'}});
  const snapshot = await handleMessage({type: 'snapshot', day});
  assert.equal(snapshot.day.hours, 1);
  assert.equal(snapshot.day.leaveHours, 8);
  await assert.rejects(handleMessage({type: 'restore', backup: {...backup, profile: 'other-account'}}));
  await assert.rejects(handleMessage({type: 'restore', backup: {...backup, leaves: [{day: '2026-10-02', hours: 8, reason: 'Valid'}, {day: 'bad', hours: 8, reason: 'Invalid'}]}}));
  assert.equal((await handleMessage({type: 'backup'})).leaves.length, 1);
  await handleMessage({type: 'leave.delete', id});
  assert.equal((await handleMessage({type: 'backup'})).leaves.length, 0);
  assert.equal((await handleMessage({type: 'restore', backup})).added, 1);
  assert.equal((await handleMessage({type: 'restore', backup})).added, 0);
  replyPages.push(page([log('one', '2026-10-01T01:00:00Z')]));
  const exported = await handleMessage({type: 'export', day});
  assert.equal(exported.filename, 'tasks_10_2026.csv');
  assert.ok(exported.csv.includes('"OFF","Vacation, ""AM""","OFF","4"'));
});

test('message router rejects other extensions and returns errors intentionally', async () => {
  assert.equal(events.message({type: 'settings'}, {id: 'other'}, () => {}), false);
  const result = await new Promise((resolve) => {
    assert.equal(events.message({type: 'unknown'}, {id: 'test-extension'}, resolve), true);
  });
  assert.equal(result.ok, false);
});
