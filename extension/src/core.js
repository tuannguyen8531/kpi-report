// Pure date, timelog and export operations, shared by the worker and tests.
export const SYNC_MINUTES = 30;
export const TIMELOG_QUERY = `query($username: String!, $start: Time!, $end: Time!, $after: String) {
  timelogs(username: $username, startTime: $start, endTime: $end, first: 100, after: $after) {
    nodes {
      id spentAt timeSpent summary user { username }
      project { fullPath }
      issue { iid title webUrl }
      mergeRequest { iid title webUrl }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function today(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Ngày không hợp lệ.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Ngày không hợp lệ.');
  }
  return parsed;
}

export function addDays(value, count) {
  const day = parseDay(value);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}

export function periods(value) {
  const day = parseDay(value);
  const weekStart = addDays(value, -((day.getUTCDay() + 6) % 7));
  const monthStart = `${value.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const weekEnd = addDays(weekStart, 7);
  return {
    dayStart: value, dayEnd: addDays(value, 1), weekStart, weekEnd, monthStart, monthEnd,
    start: weekStart < monthStart ? weekStart : monthStart,
    end: weekEnd > monthEnd ? weekEnd : monthEnd,
  };
}

export function formatExcelFilename(pattern, month, year) {
  const p = String(pattern || '').trim() || 'report_MM_YYYY.xlsx';
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);
  let filename = p.replaceAll('YYYY', yyyy).replaceAll('MM', mm);
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    filename += '.xlsx';
  }
  return filename;
}

export function validateConfig(input) {
  const parsed = new URL(String(input.url).trim());
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
    throw new Error('Dùng địa chỉ GitLab HTTPS, hoặc HTTP trên localhost.');
  }
  const projects = typeof input.projects === 'string' ? JSON.parse(input.projects) : input.projects;
  if (!Array.isArray(projects)) throw new Error('Danh sách dự án phải là mảng JSON như projects.json.');
  const names = new Set(), paths = new Set();
  if (projects.some((row) => !row || typeof row !== 'object')) throw new Error('Mỗi dự án cần có project và url.');
  const clean = projects.filter((row) => row.project !== 'OFF').map((row) => {
    const project = String(row.project || '').trim(), url = String(row.url || '').trim();
    if (!project || !url || url.startsWith('/') || url.includes('://') || names.has(project) || paths.has(url)) {
      throw new Error('Tên và đường dẫn dự án cần đầy đủ, không trùng nhau.');
    }
    names.add(project); paths.add(url);
    return {project, url};
  });
  if (!clean.length) throw new Error('Cần ít nhất một dự án để theo dõi.');
  const excelPattern = String(input.excelPattern || '').trim() || 'report_MM_YYYY.xlsx';
  return {url: parsed.href.replace(/\/$/, ''), projects: clean, rememberToken: Boolean(input.rememberToken), excelPattern};
}

export function normalizeLogs(logs, config, username, start, end) {
  const projects = new Map(config.projects.map((row) => [row.url, row.project]));
  const result = new Map();
  for (const log of logs) {
    const project = projects.get(log.project?.fullPath);
    if (!project || log.user?.username !== username) continue;
    if (typeof log.spentAt !== 'string') throw new Error('GitLab trả về timelog thiếu ngày làm việc.');
    const date = today(new Date(log.spentAt));
    if (date < start || date >= end) continue;
    const item = log.issue || log.mergeRequest;
    if (!item || !log.id || typeof log.timeSpent !== 'number' || !Number.isFinite(log.timeSpent)) {
      throw new Error('GitLab trả về timelog thiếu thông tin.');
    }
    const link = new URL(item.webUrl, config.url);
    const safeUrl = link.origin === new URL(config.url).origin && ['http:', 'https:'].includes(link.protocol) ? link.href : null;
    result.set(log.id, {
      id: log.id, date, project, task: String(item.iid), type: log.issue ? 'TASK' : 'MR',
      hours: log.timeSpent / 3600, title: String(item.title), url: safeUrl, summary: String(log.summary || ''),
    });
  }
  return [...result.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function validateLeave(input) {
  parseDay(input.day);
  const hours = Number(input.hours), reason = String(input.reason || '').trim();
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Số giờ nghỉ phải lớn hơn 0 và không quá 24.');
  if (!reason || reason.length > 500) throw new Error('Lý do nghỉ cần từ 1 đến 500 ký tự.');
  return {day: input.day, hours, reason};
}

export function makeSnapshot(day, cache, leaves) {
  const range = periods(day), rows = cache?.logs || [];
  const total = (start, end) => ({
    hours: cache ? rows.filter((row) => row.date >= start && row.date < end).reduce((sum, row) => sum + row.hours, 0) : null,
    leaveHours: leaves.filter((row) => row.day >= start && row.day < end).reduce((sum, row) => sum + row.hours, 0),
  });
  const days = [];
  for (let cursor = range.monthStart; cursor < range.monthEnd; cursor = addDays(cursor, 1)) {
    days.push({date: cursor, ...total(cursor, addDays(cursor, 1))});
  }
  const weekStartInMonth = range.weekStart < range.monthStart ? range.monthStart : range.weekStart;
  const weekEndInMonth = range.weekEnd > range.monthEnd ? range.monthEnd : range.weekEnd;
  const weekTotal = total(weekStartInMonth, weekEndInMonth);
  return {
    date: day, today: today(), range: {...range, weekStartInMonth, weekEndInMonth},
    day: total(day, range.dayEnd),
    week: {...weekTotal, start: weekStartInMonth, end: weekEndInMonth},
    month: total(range.monthStart, range.monthEnd),
    days, logs: rows.filter((row) => row.date >= range.monthStart && row.date < range.monthEnd),
    leaves: leaves.filter((row) => row.day >= range.monthStart && row.day < range.monthEnd).sort((a, b) => b.day.localeCompare(a.day)),
    syncedAt: cache?.syncedAt || null, error: cache?.error || null,
  };
}

export function exportCsv(snapshot) {
  if (!snapshot.syncedAt || snapshot.error) throw new Error('Hãy đồng bộ thành công trước khi xuất dữ liệu tháng.');
  const english = (day) => parseDay(day).toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'});
  const rows = [
    ['Project', 'Task', 'Type', 'Time', 'Date'],
    ...snapshot.logs.map((row) => [row.project, row.task, row.type, Number(row.hours.toFixed(8)), english(row.date)]),
    ...snapshot.leaves.map((row) => ['OFF', row.reason, 'OFF', row.hours, english(row.day)]),
  ];
  return '\uFEFF' + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
