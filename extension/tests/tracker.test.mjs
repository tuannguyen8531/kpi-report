import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test, beforeEach} from 'node:test';
import ExcelJS from 'exceljs';
import {SYNC_MINUTES, today, periods, parseDay, normalizeLogs, makeSnapshot, validateConfig, validateLeave, exportCsv} from '../src/core.js';
import {
  processProjectData,
  processOffData,
  enrichTasks,
  buildProjectData,
  generateExcelWorkbook,
  formatMonthDayYear,
  parseMonthDayYear,
  formatExcelFilename,
} from '../src/excel_generator.js';

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
  if (payload.query.includes('workItems')) {
    return {
      ok: true,
      async json() {
        return {
          data: {
            project: {
              workItems: {
                nodes: [{
                  closedAt: '2026-10-05T12:00:00Z',
                  widgets: [
                    { startDate: '2026-10-01', dueDate: '2026-10-10' },
                    { timeEstimate: 16200 },
                  ],
                }],
              },
            },
          },
        };
      },
    };
  }
  if (payload.query.includes('mergeRequests')) {
    return {
      ok: true,
      async json() {
        return {
          data: {
            project: {
              mergeRequests: {
                nodes: [{ timeEstimate: 7200 }],
              },
            },
          },
        };
      },
    };
  }
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

test('date formatters and parsers convert correctly between ISO and MM/DD/YYYY', () => {
  assert.equal(formatMonthDayYear('2026-10-01'), '10/01/2026');
  assert.equal(formatMonthDayYear(new Date(Date.UTC(2026, 9, 5))), '10/05/2026');
  assert.equal(formatMonthDayYear(''), '');
  assert.equal(formatMonthDayYear(null), '');

  const parsed = parseMonthDayYear('10/01/2026');
  assert.equal(parsed.getUTCFullYear(), 2026);
  assert.equal(parsed.getUTCMonth(), 9);
  assert.equal(parsed.getUTCDate(), 1);
  assert.equal(parseMonthDayYear(''), null);
  assert.equal(parseMonthDayYear('invalid'), null);
});

test('processProjectData groups by project/task/type, sums hours and finds earliest date', () => {
  const sampleLogs = [
    { project: 'Project A', task: '12', type: 'TASK', hours: 2.5, date: '2026-10-05' },
    { project: 'Project A', task: '12', type: 'TASK', hours: 1.5, date: '2026-10-01' },
    { project: 'Project A', task: '15', type: 'MR', hours: 4.0, date: '2026-10-02' },
    { project: 'OFF', task: 'Leave', type: 'OFF', hours: 8, date: '2026-10-03' },
  ];
  const grouped = processProjectData(sampleLogs);
  assert.equal(grouped.length, 2);
  const task12 = grouped.find((g) => g.Task === '12');
  assert.equal(task12.Spent, 4);
  assert.equal(task12.Start_date, '10/01/2026');

  const leaves = [{ day: '2026-10-03', hours: 8, reason: 'Vacation' }];
  const off = processOffData(leaves);
  assert.equal(off.length, 1);
  assert.equal(off[0].Task, 'Vacation');
  assert.equal(off[0].Start_date, '10/03/2026');
  assert.equal(off[0].Spent, 8);
});

test('pure JS Excel report matches template formulas, dimensions, hyperlinks and OFF placement', async () => {
  const templatePath = path.resolve('assets/templates/work_report.xlsx');
  const templateBuffer = fs.readFileSync(templatePath);

  const reportData = {
    month: 10,
    year: 2026,
    projectBlocks: [
      {
        project: 'Project A',
        tasks: [
          {
            Url: 'https://gitlab.example.com/group/a/-/work_items/12',
            'Start date': '10/01/2026',
            'Due date': '10/10/2026',
            'Closed date': '10/05/2026',
            Estimate: '4.50',
            Spent: 4.0,
            'Reopen count': 0,
            'Task Type': 'Kế hoạch',
            Progress: 'Đúng hạn',
          },
          {
            Url: 'https://gitlab.example.com/group/a/-/merge_requests/15',
            'Start date': '10/02/2026',
            'Due date': '10/02/2026',
            'Closed date': '10/02/2026',
            Estimate: '2.00',
            Spent: 2.0,
            'Reopen count': 0,
            'Task Type': 'Phát sinh',
            Progress: 'Đúng hạn',
          },
        ],
      },
    ],
    offEntries: [
      {
        Task: 'Nghỉ phép',
        Start_date: '10/03/2026',
        Spent: 8.0,
      },
    ],
  };

  const buffer = await generateExcelWorkbook(templateBuffer, reportData, ExcelJS);
  assert.ok(buffer && buffer.byteLength > 0);

  // Read back generated workbook with ExcelJS to verify formulas & cells
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet('Báo cáo công việc');
  assert.ok(sheet);

  assert.equal(sheet.getCell('B2').value, 'Tháng 01/10/2026 - 31/10/2026');
  assert.equal(sheet.getCell('M5').value?.formula, 'M6+M7');
  assert.equal(sheet.getCell('M6').value?.formula, 'COUNTIF(I6:I8,"Kế hoạch")');
  assert.equal(sheet.getCell('M7').value?.formula, 'COUNTIF(I6:I8,"Phát sinh")');
  assert.equal(sheet.getCell('M9').value?.formula, 'SUM(F6:F8)');
  assert.equal(sheet.getCell('M10').value?.formula, 'SUM(G6:G8)');
  assert.equal(sheet.getCell('M11').value?.formula, 'M10-M12');
  assert.equal(sheet.getCell('M12').value?.formula, 'SUMIF(I6:I8,"Phát sinh",G6:G8)');

  // Formula wrap IFERROR verification
  for (const r of [25, 26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 39]) {
    const f = sheet.getCell(`M${r}`).value?.formula;
    assert.ok(f && f.startsWith('IFERROR(') && f.endsWith(',0)'), `Row ${r} formula: ${f}`);
  }

  // Hyperlink and task row verification
  const linkCell = sheet.getCell('B6');
  assert.equal(linkCell.value?.hyperlink, 'https://gitlab.example.com/group/a/-/work_items/12');
  assert.equal(sheet.getCell('F6').value, 4.5);
  assert.equal(sheet.getCell('G6').value, 4.0);

  // OFF row verification (placed at row >= 8, outside task formula range)
  let offFoundRow = -1;
  sheet.eachRow((row, rowNumber) => {
    if (row.getCell(2).value === 'OFF') offFoundRow = rowNumber;
  });
  assert.ok(offFoundRow >= 8, `OFF row should be >= 8, got ${offFoundRow}`);
  assert.equal(sheet.getRow(offFoundRow + 2).getCell(2).value, 'Nghỉ phép');
  assert.equal(sheet.getRow(offFoundRow + 2).getCell(7).value, 8.0);
});

test('formatExcelFilename replaces MM and YYYY and guarantees .xlsx extension', () => {
  assert.equal(formatExcelFilename('report_MM_YYYY.xlsx', 10, 2026), 'report_10_2026.xlsx');
  assert.equal(formatExcelFilename('Bao_cao_KPI_MM_YYYY', 2, 2024), 'Bao_cao_KPI_02_2024.xlsx');
  assert.equal(formatExcelFilename('kpi_YYYY_MM.xlsx', 1, 2025), 'kpi_2025_01.xlsx');
  assert.equal(formatExcelFilename('', 5, 2026), 'report_05_2026.xlsx');
  assert.equal(formatExcelFilename(null, 5, 2026), 'report_05_2026.xlsx');
});

test('handleMessage export_excel_data integrates background enrichment and returns structured data with custom filename pattern', async () => {
  await connect();
  local.config.excelPattern = 'Bao_cao_KPI_MM_YYYY';
  replyPages.push(page([log('one', '2026-10-01T01:00:00Z', 3600)]));
  const data = await handleMessage({type: 'export_excel_data', day});
  assert.equal(data.month, 10);
  assert.equal(data.year, 2026);
  assert.equal(data.filename, 'Bao_cao_KPI_10_2026.xlsx');
  assert.equal(data.projectBlocks.length, 1);
  assert.equal(data.projectBlocks[0].project, 'Project A');
  assert.equal(data.projectBlocks[0].tasks.length, 1);
  assert.equal(data.projectBlocks[0].tasks[0].Estimate, '4.50');
  assert.equal(data.projectBlocks[0].tasks[0]['Due date'], '10/10/2026');
});
