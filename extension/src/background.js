import {SYNC_MINUTES, TIMELOG_QUERY, today, periods, validateConfig, normalizeLogs, validateLeave, makeSnapshot, exportCsv} from './core.js';
import {processProjectData, processOffData, enrichTasks, buildProjectData, formatExcelFilename} from './excel_generator.js';

const ALARM = 'gitlab-sync';
let pending = Promise.resolve();
// ponytail: serialize one user's storage mutations; use per-profile queues if this becomes a shared app.
function serial(action) {
  const task = pending.then(action);
  pending = task.catch(() => {});
  return task;
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm || alarm.periodInMinutes !== SYNC_MINUTES) {
    await chrome.alarms.create(ALARM, {delayInMinutes: SYNC_MINUTES, periodInMinutes: SYNC_MINUTES});
  }
}

async function request(config, token, query, variables = {}) {
  const response = await fetch(`${config.url}/api/graphql`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) throw new Error(`GitLab trả về HTTP ${response.status}. Kiểm tra token và quyền read_api.`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(`GitLab: ${data.errors.map((error) => error.message).join('; ')}`);
  if (!data.data) throw new Error('GitLab không trả về dữ liệu.');
  return data.data;
}

async function getToken() {
  const session = await chrome.storage.session.get('token');
  if (session.token) return session.token;
  return (await chrome.storage.local.get('token')).token;
}

async function synchronize(day, force = false) {
  const stored = await chrome.storage.local.get(['config', 'profiles']);
  const config = stored.config;
  if (!config?.profile) return {configured: false};
  const profiles = stored.profiles || {};
  const profile = profiles[config.profile] || {leaves: [], caches: {}};
  const range = periods(day), key = `${range.start}/${range.end}`;
  let cache = profile.caches[key];
  const token = await getToken();
  if (force || !cache || Date.now() - Date.parse(cache.attemptedAt || cache.syncedAt || '') >= SYNC_MINUTES * 60000) {
    try {
      if (!token) throw new Error('Nhập lại token để tiếp tục đồng bộ GitLab.');
      const logs = [], seen = new Set();
      let after = null;
      while (true) {
        const data = await request(config, token, TIMELOG_QUERY, {
          username: config.username, start: `${range.start}T00:00:00+07:00`,
          end: `${range.end}T00:00:00+07:00`, after,
        });
        const connection = data.timelogs;
        if (!Array.isArray(connection?.nodes) || !connection.pageInfo) throw new Error('GitLab không trả về danh sách timelog đầy đủ.');
        logs.push(...connection.nodes);
        if (!connection.pageInfo.hasNextPage) break;
        after = connection.pageInfo.endCursor;
        if (!after || seen.has(after)) throw new Error('GitLab trả về cursor phân trang không hợp lệ.');
        seen.add(after);
      }
      cache = {logs: normalizeLogs(logs, config, config.username, range.start, range.end), syncedAt: new Date().toISOString(), error: null};
    } catch (error) {
      cache = {...cache, error: error instanceof Error ? error.message : 'Không kết nối được GitLab.'};
    }
    cache.attemptedAt = new Date().toISOString();
    profile.caches[key] = cache;
    // Keep four recent windows; GitLab remains the source of older work logs.
    const recent = Object.entries(profile.caches).sort((a, b) =>
      String(b[1].attemptedAt || b[1].syncedAt || '').localeCompare(String(a[1].attemptedAt || a[1].syncedAt || '')),
    ).slice(0, 4);
    profile.caches = Object.fromEntries(recent);
    profiles[config.profile] = profile;
    await chrome.storage.local.set({profiles});
  }
  // A failed first fetch is unknown, not zero hours.
  const snapshot = makeSnapshot(day, cache?.syncedAt ? cache : null, profile.leaves);
  snapshot.error = cache?.error || null;
  return {...snapshot, configured: true, username: config.username, needsToken: !token};
}

export async function handleMessage(message) {
  switch (message.type) {
    case 'settings': {
      const {config} = await chrome.storage.local.get('config');
      return {config: config ? {url: config.url, projects: config.projects, username: config.username, rememberToken: config.rememberToken, excelPattern: config.excelPattern || 'report_MM_YYYY.xlsx'} : null, hasToken: Boolean(await getToken())};
    }
    case 'connect': {
      const config = validateConfig(message.config);
      const existing = (await chrome.storage.local.get('config')).config;
      const token = String(message.token || (existing?.url === config.url ? await getToken() : '') || '').trim();
      if (!token) throw new Error('Cần nhập token GitLab có quyền read_api.');
      const user = (await request(config, token, 'query { currentUser { username } }')).currentUser;
      if (!user?.username) throw new Error('GitLab không xác định được tài khoản của token.');
      config.username = user.username;
      config.profile = `${config.url}|${user.username}`;
      const {profiles = {}} = await chrome.storage.local.get('profiles');
      for (const profile of Object.values(profiles)) profile.caches = {};
      profiles[config.profile] ||= {leaves: [], caches: {}};
      await chrome.storage.local.set({config, profiles});
      if (config.rememberToken) {
        await chrome.storage.local.set({token});
        await chrome.storage.session.remove('token');
      } else {
        await chrome.storage.session.set({token});
        await chrome.storage.local.remove('token');
      }
      return synchronize(message.day || today(), true);
    }
    case 'snapshot': return synchronize(message.day || today(), Boolean(message.force));
    case 'leave.save': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      if (!config?.profile) throw new Error('Kết nối GitLab trước khi ghi lịch nghỉ.');
      const profile = profiles[config.profile], entry = {...validateLeave(message.entry), id: message.id || crypto.randomUUID()};
      if (message.id && !profile.leaves.some((row) => row.id === message.id)) throw new Error('Không tìm thấy mục nghỉ cần sửa.');
      if (profile.leaves.some((row) => row.day === entry.day && row.id !== entry.id)) throw new Error('Ngày này đã có lịch nghỉ. Hãy sửa mục đã lưu.');
      profile.leaves = [...profile.leaves.filter((row) => row.id !== entry.id), entry];
      await chrome.storage.local.set({profiles});
      return {saved: true};
    }
    case 'leave.delete': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      const profile = profiles[config?.profile];
      if (!profile?.leaves.some((row) => row.id === message.id)) throw new Error('Không tìm thấy mục nghỉ cần xóa.');
      profile.leaves = profile.leaves.filter((row) => row.id !== message.id);
      await chrome.storage.local.set({profiles});
      return {deleted: true};
    }
    case 'backup': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      if (!config?.profile) throw new Error('Chưa có tài khoản để sao lưu.');
      return {version: 1, profile: config.profile, leaves: profiles[config.profile].leaves};
    }
    case 'restore': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      const backup = message.backup;
      if (!config?.profile || backup?.version !== 1 || backup.profile !== config.profile || !Array.isArray(backup.leaves)) {
        throw new Error('Bản sao lưu không hợp lệ hoặc thuộc tài khoản GitLab khác.');
      }
      const byDay = new Map(profiles[config.profile].leaves.map((row) => [row.day, row]));
      let added = 0;
      for (const input of backup.leaves) {
        const entry = validateLeave(input), old = byDay.get(entry.day);
        if (old && (old.hours !== entry.hours || old.reason !== entry.reason)) throw new Error(`Ngày ${entry.day} đã có lịch nghỉ khác. Không ghi đè dữ liệu.`);
        if (!old) {byDay.set(entry.day, {...entry, id: crypto.randomUUID()}); added++;}
      }
      profiles[config.profile].leaves = [...byDay.values()];
      await chrome.storage.local.set({profiles});
      return {added};
    }
    case 'export': {
      const snapshot = await synchronize(message.day || today(), true);
      if (!snapshot.configured) throw new Error('Kết nối GitLab trước khi xuất dữ liệu.');
      return {csv: exportCsv(snapshot), filename: `tasks_${snapshot.date.slice(5, 7)}_${snapshot.date.slice(0, 4)}.csv`};
    }
    case 'export_excel_data': {
      const snapshot = await synchronize(message.day || today(), true);
      if (!snapshot.configured) throw new Error('Kết nối GitLab trước khi xuất dữ liệu.');
      const {config} = await chrome.storage.local.get('config');
      const token = await getToken();
      if (!token) throw new Error('Cần token GitLab để truy vấn thông tin công việc.');

      const groupedTasks = processProjectData(snapshot.logs);
      const offEntries = processOffData(snapshot.leaves);

      const enrichmentMap = await enrichTasks(request, config, token, groupedTasks);
      const { projectBlocks, stats } = buildProjectData(groupedTasks, enrichmentMap, config);

      const day = message.day || today();
      const year = Number(day.slice(0, 4));
      const month = Number(day.slice(5, 7));
      const filename = formatExcelFilename(config?.excelPattern, month, year);

      return {
        month,
        year,
        projectBlocks,
        offEntries,
        stats,
        filename,
      };
    }
    case 'disconnect': {
      await chrome.storage.local.remove(['config', 'token']);
      await chrome.storage.session.remove('token');
      return {disconnected: true};
    }
    default: throw new Error('Thao tác không được hỗ trợ.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  serial(() => handleMessage(message)).then((data) => reply({ok: true, data}),
    (error) => reply({ok: false, error: error instanceof Error ? error.message : 'Thao tác chưa thành công.'}));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void serial(() => synchronize(today(), true)).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => void initialize());
chrome.runtime.onStartup.addListener(() => void initialize());
void initialize();
