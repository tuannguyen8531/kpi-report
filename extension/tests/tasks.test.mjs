import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {suggestedStart, normalizePersonalTasks, selectPersonalTasks, PERSONAL_TASKS_QUERY, dailyReport} from '../src/tasks.js';
test('planning includes deadline, skips weekends and handles missing estimates',()=>{
  assert.equal(suggestedStart('2026-11-09',57600),'2026-11-06');
  assert.equal(suggestedStart('2026-11-08',57600),'2026-11-05');
  assert.equal(suggestedStart('2024-03-01',57600),'2024-02-29');
  assert.equal(suggestedStart('2026-11-09',28801),'2026-11-06');
  assert.equal(suggestedStart('2026-11-09',0),null);
});
test('only open Tasks enter planning and unsafe links are removed',()=>{
  const item={id:'1',iid:'1',title:'Task',type:'TASK',state:'opened',reference:'g/p#1',webUrl:'javascript:alert(1)',dueDate:'2026-11-09',timeEstimate:57600};
  const tasks=normalizePersonalTasks([item,{...item,id:'2',type:'ISSUE'},{...item,id:'3',state:'closed'}],{url:'https://gitlab.example.com',projects:[]});
  assert.equal(tasks.length,1); assert.equal(tasks[0].url,null);
  assert.equal(selectPersonalTasks(tasks,'2026-11-06',{status:'ready'}).length,1);
});

test('Issue query uses supported full references for nested projects',()=>{
  assert.ok(!/project\s*\{/.test(PERSONAL_TASKS_QUERY));
  assert.ok(PERSONAL_TASKS_QUERY.includes('reference(full: true)'));
  const item={id:'1',iid:'5',type:'TASK',state:'opened',reference:'group/sub/project#5',webUrl:'https://gitlab.example.com/group/sub/project/-/work_items/5'};
  const config={url:'https://gitlab.example.com',projects:[{url:'group/sub/project',project:'Custom'}]};
  const [task]=normalizePersonalTasks([item],config);
  assert.equal(task.projectPath,'group/sub/project');
  assert.equal(task.project,'Custom');
  assert.deepEqual(normalizePersonalTasks([item],{...config,projects:[{url:'other/project',project:'Other'}]}),[]);
});

const day = '2026-11-06';
const log = (extra = {}) => ({date: day, project: 'D-System (group/d)', projectPath: 'group/d', task: '1', type: 'TASK', title: 'Hỗ trợ xử lý server', hours: 2, state: 'opened', ...extra});

test('daily template uses only net positive work for the selected day, with manual progress and open-work suggestions', () => {
  const text = dailyReport({date: day, username: 'Tuan', logs: [
    log(), log(), log({hours: -1}), log({date: '2026-11-05', title: 'Yesterday'}),
    log({task: '2', title: 'Cancelled', hours: 1}), log({task: '2', title: 'Cancelled', hours: -1}),
    log({task: '3', title: 'Negative correction', hours: -2}),
    log({type: 'MR', title: 'Merged change', state: 'merged'}),
    log({project: 'Nghiên cứu', projectPath: null, task: 'Reading', title: 'Reading', type: 'MANUAL', state: null}),
    log({type: 'OFF', title: 'Leave'}), log({hours: NaN, title: 'Invalid'}),
  ]});
  assert.equal(text, `Daily Report 06/11/2026

▼ What did I do today?
- D-System
  + Hỗ trợ xử lý server [%]
  + Merged change [%]
  + Review code [%]
- Nghiên cứu
  + Reading [%]

▼ What will I do Tomorrow?
- D-System
  + Hỗ trợ xử lý server [HIGH]

▼ What problems are hindering my progress?
- None`);
  assert.equal(dailyReport({date: day, logs: []}).match(/- None/g).length, 3);
  assert.throws(() => dailyReport({date: '2026-02-30'}));
  const duplicate = dailyReport({date: day, logs: [log(), log({projectPath: 'group/other', project: 'D-System (group/other)'})]});
  assert.ok(duplicate.includes('- D-System (group/d)'));
  assert.ok(duplicate.includes('- D-System (group/other)'));
  assert.ok(dailyReport({date: day, logs: [log({title: 'Title\n- injected section'})]}).includes('  + Title - injected section [%]'));
});

test('Review code appears once per project with net positive MR work', () => {
  const text = dailyReport({date: day, logs: [
    log({type: 'MR'}), log({type: 'MR', task: '2'}),
    log({type: 'MR', projectPath: 'other/project', project: 'Other'}),
    log({type: 'MR', projectPath: 'zero/project', project: 'Zero'}),
    log({type: 'MR', projectPath: 'zero/project', project: 'Zero', hours: -2}),
    log({type: 'MR', date: '2026-11-05', projectPath: 'old/project', project: 'Old'}),
  ]});
  const today = text.split('▼ What will I do Tomorrow?')[0];
  assert.equal(today.match(/Review code/g).length, 2);
  assert.ok(!today.includes('- Zero'));
  assert.ok(!today.includes('- Old'));
});

const task = (extra = {}) => ({iid: '1', title: 'Assigned work', project: 'D-System', projectPath: 'group/d', startDate: day, dueDate: '2026-11-10', ...extra});

test('plans include assigned tasks without timelogs, map schedule priorities, and merge by project/type/iid', () => {
  const text = dailyReport({date: day, username: 'gitlab_user', logs: [log()]}, [
    task({title: 'Hỗ trợ xử lý server'}),
    task({iid: '2', title: 'Upcoming', startDate: '2026-11-09'}),
    task({iid: '3', title: 'Overdue', startDate: null, dueDate: '2026-11-05'}),
    task({iid: '4', title: 'Missing schedule', startDate: null, dueDate: null}),
    task({project: 'Other', projectPath: 'other/project', title: 'No logs yet'}),
  ]);
  assert.ok(text.startsWith('Daily Report 06/11/2026'));
  const [completed, planned] = text.split('▼ What will I do Tomorrow?');
  assert.ok(!completed.includes('No logs yet'));
  assert.equal(planned.match(/Hỗ trợ xử lý server/g).length, 1);
  assert.ok(planned.includes('Hỗ trợ xử lý server [HIGH]'));
  assert.ok(planned.includes('Upcoming [MEDIUM]'));
  assert.ok(planned.includes('Overdue [MUST DONE]'));
  assert.ok(planned.includes('- Other\n  + No logs yet [HIGH]'));
  assert.ok(planned.includes('Missing schedule [MEDIUM]'));
  const updated = dailyReport({date: '2026-11-09', logs: []}, [task({startDate: '2026-11-09'})]);
  assert.ok(updated.includes('Assigned work [MUST DONE]'));
  const medium = dailyReport({date: day, logs: [log()]}, [task({title: 'Hỗ trợ xử lý server', startDate: '2026-11-09'})]);
  assert.equal(medium.match(/Hỗ trợ xử lý server \[MEDIUM\]/g).length, 1);
  assert.ok(!medium.includes('Hỗ trợ xử lý server [HIGH]'));
});

test('daily editor restores per-account/day drafts, preserves edits on sync, copies exact text and handles storage/clipboard failures', async () => {
  const source = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
  const fields = new Map(), saved = {}, toasts = [], copied = [];
  const $ = id => {
    if (!fields.has(id)) fields.set(id, {value: '', addEventListener(event, fn) {this[event] = fn;}, focus() {this.focused = true;}, select() {this.selected = true;}});
    return fields.get(id);
  };
  let failSave = false, failCopy = false, confirmReplace = false;
  const chrome = {storage: {local: {
    async get(key) {return key === null ? {...saved} : {[key]: saved[key]};},
    async remove(keys) {for (const key of keys) delete saved[key];},
    async set(values) {if (failSave) throw Error('Full'); Object.assign(saved, values);},
  }}};
  const navigator = {clipboard: {async writeText(value) {if (failCopy) throw Error('Denied'); copied.push(value);}}};
  let tasksData = {profile: 'a', syncedAt: 'now', items: [task({title: 'Assigned work'})]};
  const ui = new Function('$', 'chrome', 'navigator', 'dailyReport', 'showToast', 'confirm', 'send', `
    let dailyReportKey = null, dailyReportSave = Promise.resolve(), snapshot = null;
    const t = key => key, fullDayLabel = day => day;
    ${source.slice(source.indexOf('async function generateDailyReport('))}
    return {async render(data) {snapshot = data; await renderDailyReport(data);}, flush() {return dailyReportSave.catch(() => {});}};
  `)($, chrome, navigator, dailyReport, value => toasts.push(value), () => confirmReplace, async () => tasksData);
  const data = {configured: true, profile: 'a', date: day, username: 'Tuan', syncedAt: 'now', logs: [log()]};
  await ui.render(data);
  assert.ok($('daily-report-text').value.includes('Hỗ trợ xử lý server [%]'));
  assert.ok($('daily-report-text').value.includes('Assigned work [HIGH]'));
  const edited = 'Daily Report 06/11/2026\nEdited [30%]';
  $('daily-report-text').value = edited;
  $('daily-report-text').input();
  await ui.flush();
  assert.equal(saved[`daily-report:a:${day}`], edited);
  await ui.render({...data, error: 'Offline'});
  assert.equal($('daily-report-text').value, edited);
  assert.equal($('daily-report-warning').textContent, 'allocation.stale');
  await $('daily-report-copy').click();
  assert.deepEqual(copied, [edited]);
  failCopy = true;
  await $('daily-report-copy').click();
  assert.ok($('daily-report-text').selected);
  assert.equal(toasts.at(-1), 'daily.copy_failed');
  await ui.render({...data, profile: 'b'});
  assert.notEqual($('daily-report-text').value, edited);
  assert.ok(!$('daily-report-text').value.includes('Assigned work'));
  assert.equal($('daily-report-tasks-warning').textContent, 'daily.tasks_pending');
  await ui.render({...data, date: '2026-11-07'});
  assert.ok($('daily-report-text').value.includes('07/11/2026'));
  await ui.render(data);
  assert.equal($('daily-report-text').value, edited);
  await $('daily-report-generate').click();
  assert.equal($('daily-report-text').value, edited);
  confirmReplace = true;
  tasksData = {...tasksData, error: 'Offline', items: [task({title: 'Updated cached task'})]};
  await $('daily-report-generate').click();
  await ui.flush();
  assert.ok(saved[`daily-report:a:${day}`].includes('[%]'));
  assert.ok(saved[`daily-report:a:${day}`].includes('Updated cached task [HIGH]'));
  assert.equal($('daily-report-tasks-warning').textContent, 'daily.tasks_stale');
  for (let i = 1; i <= 35; i++) saved[`daily-report:old:2025-01-${String(i).padStart(2, '0')}`] = 'Old';
  saved.unrelated = 'Keep';
  $('daily-report-text').value = edited;
  $('daily-report-text').input();
  await ui.flush();
  assert.equal(Object.keys(saved).filter(key => key.startsWith('daily-report:')).length, 30);
  assert.equal(saved[`daily-report:a:${day}`], edited);
  assert.equal(saved['daily-report:old:2025-01-01'], undefined);
  assert.equal(saved.unrelated, 'Keep');
  assert.equal(saved.dailyReportOrder[0], `daily-report:a:${day}`);
  failSave = true;
  $('daily-report-text').value = edited;
  $('daily-report-text').input();
  await ui.flush();
  assert.equal($('daily-report-text').value, edited);
  assert.equal($('daily-report-status').textContent, 'daily.save_failed');
  await ui.render({configured: false});
  assert.equal($('daily-report-text').value, '');
  assert.ok($('daily-report-copy').disabled);
});

test('daily report heading contains only the title and date', () => {
  assert.ok(dailyReport({date: '2026-11-10', username: 'tuan.nguyen', logs: []}).startsWith('Daily Report 10/11/2026\n'));
  assert.ok(dailyReport({date: day, logs: []}).startsWith('Daily Report'));
});

test('plans mark deadlines through tomorrow as MUST DONE relative to the report date', () => {
  const text = dailyReport({date: '2026-11-30', logs: []}, [
    task({iid: '1', title: 'Today', dueDate: '2026-11-30'}),
    task({iid: '2', title: 'Tomorrow', dueDate: '2026-12-01'}),
    task({iid: '3', title: 'Later', dueDate: '2026-12-02'}),
    task({iid: '4', title: 'No deadline', dueDate: null, startDate: null}),
  ]);
  assert.ok(text.includes('Today [MUST DONE]'));
  assert.ok(text.includes('Tomorrow [MUST DONE]'));
  assert.ok(text.includes('Later [HIGH]'));
  assert.ok(text.includes('No deadline [MEDIUM]'));
});
