import {addDays, parseDay, projectName, workProjectKey} from './core.js';
export const PERSONAL_TASKS_QUERY = `query PersonalTasks($username: String!, $after: String) {
  issues(assigneeUsernames: [$username], state: opened, types: [TASK], first: 100, after: $after) {
    nodes { id iid title webUrl type state dueDate timeEstimate reference(full: true) }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const TASK_PROJECTS_QUERY = `query TaskProjects($paths: [String!]!) {
  projects(fullPaths: $paths, first: 50) { nodes { fullPath name } }
}`;
export function suggestedStart(dueDate, seconds) {
  if (!dueDate || !Number.isFinite(seconds) || seconds <= 0) return null;
  let date = dueDate;
  while ([0,6].includes(parseDay(date).getUTCDay())) date = addDays(date,-1);
  const days = Math.ceil(seconds / 28800)-1;
  date = addDays(date,-7*Math.floor(days/5));
  for (let remaining=days%5; remaining>0;) {
    date=addDays(date,-1);
    if (![0,6].includes(parseDay(date).getUTCDay())) remaining--;
  }
  return date;
}
export function taskStatus(task, day) {
  if (task.dueDate && task.dueDate < day) return 'overdue';
  if (!task.startDate) return 'missing';
  return task.startDate <= day ? 'ready' : 'upcoming';
}
export function selectPersonalTasks(items, day, {search='',project='',status=''}={}) {
  const ranks={overdue:0,ready:1,upcoming:2,missing:3}, term=search.trim().toLowerCase();
  return items.filter(t=>(!project || t.projectPath===project) && (!status || (status==='missing' ? !t.startDate : taskStatus(t,day)===status)) && `${t.iid} ${t.title} ${t.project} ${t.projectPath}`.toLowerCase().includes(term))
    .sort((a,b)=>ranks[taskStatus(a,day)]-ranks[taskStatus(b,day)] || (a.startDate||a.dueDate||'9999').localeCompare(b.startDate||b.dueDate||'9999') || a.title.localeCompare(b.title));
}
export function normalizePersonalTasks(items, config) {
  const projects=new Map((config.projects||[]).map(p=>[p.url,p.project])), result=new Map();
  for (const item of items) {
    if (item?.type!=='TASK' || item.state!=='opened') continue;
    const path=typeof item.reference === 'string' ? item.reference.replace(/#\d+$/, '') : null;
    if (!path || path === item.reference) throw new Error('GitLab returned a Task without a full project reference.');
    if (projects.size && !projects.has(path)) continue;
    if (!item.id || !item.iid || !path) throw new Error('Incomplete GitLab Task.');
    const dueDate=item.dueDate ? item.dueDate.slice(0,10) : null;
    if (dueDate) parseDay(dueDate);
    const estimateSeconds=Number.isFinite(item.timeEstimate)&&item.timeEstimate>0 ? item.timeEstimate:null;
    const url=new URL(item.webUrl,config.url);
    result.set(item.id,{id:item.id,iid:String(item.iid),title:String(item.title||''),project:projects.get(path)||path,projectPath:path,
      url:url.origin===new URL(config.url).origin && ['http:','https:'].includes(url.protocol)?url.href:null,
      dueDate,estimateSeconds,startDate:suggestedStart(dueDate,estimateSeconds)});
  }
  return [...result.values()];
}

// Percent complete is entered by the user; logged hours cannot establish progress.
export function dailyReport(snapshot, personalTasks = []) {
  parseDay(snapshot.date);
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const groups = new Map();
  for (const log of snapshot.logs || []) {
    if (log.date !== snapshot.date || log.type === 'OFF' || !Number.isFinite(log.hours)) continue;
    const projectKey = workProjectKey(log);
    if (!groups.has(projectKey)) groups.set(projectKey, {name: projectName(log.project), path: log.projectPath, tasks: new Map()});
    const group = groups.get(projectKey);
    const taskKey = JSON.stringify([log.type, log.task]);
    if (!group.tasks.has(taskKey)) group.tasks.set(taskKey, {title: clean(log.title || log.task), hours: 0, open: false, type: log.type});
    const task = group.tasks.get(taskKey);
    task.hours += log.hours;
    task.open ||= log.state === 'opened';
  }
  const completed = new Map(), planned = new Map();
  for (const [key, group] of groups) {
    const tasks = [...group.tasks].filter(([, task]) => task.hours > 0);
    if (!tasks.length) continue;
    completed.set(key, {...group, tasks: new Map(tasks.map(([id, task]) => [id, {...task, priority: '%'}]))});
    if (tasks.some(([, task]) => task.type === 'MR') && !tasks.some(([, task]) => task.title === 'Review code')) {
      completed.get(key).tasks.set('review', {title: 'Review code', priority: '%'});
    }
    const open = tasks.filter(([, task]) => task.open);
    if (open.length) planned.set(key, {...group, tasks: new Map(open.map(([id, task]) => [id, {...task, priority: 'HIGH'}]))});
  }
  for (const task of selectPersonalTasks(personalTasks, snapshot.date)) {
    const status = taskStatus(task, snapshot.date);
    const key = workProjectKey(task);
    if (!planned.has(key)) planned.set(key, {name: projectName(task.project), path: task.projectPath, tasks: new Map()});
    planned.get(key).tasks.set(JSON.stringify(['TASK', String(task.iid)]), {
      title: clean(task.title), priority: task.dueDate && task.dueDate <= addDays(snapshot.date, 1) ? 'MUST DONE' : status === 'ready' ? 'HIGH' : 'MEDIUM',
    });
  }
  const section = groups => {
    const rows = [...groups.values()];
    const lines = [];
    for (const group of rows) {
      const duplicate = rows.filter(row => row.name === group.name).length > 1;
      lines.push(`- ${clean(group.name)}${duplicate && group.path ? ` (${clean(group.path)})` : ''}`);
      for (const task of group.tasks.values()) lines.push(`  + ${task.title} [${task.priority}]`);
    }
    return lines.length ? lines.join('\n') : '- None';
  };
  const date = snapshot.date.split('-').reverse().join('/');
  return `Daily Report ${date}\n\n▼ What did I do today?\n${section(completed)}\n\n▼ What will I do Tomorrow?\n${section(planned)}\n\n▼ What problems are hindering my progress?\n- None`;
}
