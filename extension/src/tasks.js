import {addDays, parseDay} from './core.js';
export const PERSONAL_TASKS_QUERY = `query PersonalTasks($username: String!, $after: String) {
  issues(assigneeUsernames: [$username], state: opened, types: [TASK], first: 100, after: $after) {
    nodes { id iid title webUrl type state dueDate timeEstimate reference(full: true) }
    pageInfo { hasNextPage endCursor }
  }
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
