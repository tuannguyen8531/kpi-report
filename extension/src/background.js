import {SYNC_MINUTES, TIMELOG_QUERY, today, addDays, parseDay, periods, validateConfig, normalizeLogs, validateLeave, makeSnapshot, exportCsv} from './core.js';
import {processProjectData, processOffData, enrichTasks, buildProjectData, formatExcelFilename} from './excel_generator.js';
import {validateOdooConfig, readAttendance, attendanceReminder, attendanceWindow, nextAttendanceReminder} from './odoo.js';

const ALARM = 'gitlab-sync';
const NOTE_ALARM = 'daily-note';
const ODOO_ALARM = 'odoo-attendance';
const ODOO_REMINDER_ALARM = 'odoo-reminder';
let pending = Promise.resolve();
// ponytail: serialize one user's storage mutations; use per-profile queues if this becomes a shared app.
function serial(action) {
  const task = pending.then(action);
  pending = task.catch(() => {});
  return task;
}

// Called through the shared queue so simultaneous wakeups cannot notify twice.
export async function remindDailyNote(now = new Date()) {
  const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
  if (!config?.profile || config.reminderEnabled === false) {
    await chrome.alarms.clear(NOTE_ALARM);
    return;
  }
  const day = today(now);
  const time = config.reminderTime || '10:00';
  const due = Date.parse(`${day}T${time}:00+07:00`);
  const next = now.getTime() < due ? due : Date.parse(`${addDays(day, 1)}T${time}:00+07:00`);
  await chrome.alarms.create(NOTE_ALARM, {when: next});
  const profile = profiles[config.profile];
  const note = profile?.notes?.[day];
  if (now.getTime() < due || !note?.trim() || profile.lastNoteReminder === day) return;
  if (await chrome.notifications.getPermissionLevel() !== 'granted') return;
  const id = `daily-note:${encodeURIComponent(config.profile)}:${day}`;
  await chrome.notifications.create(id, {
    type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon.png'),
    title: `Daily note · ${day}`, message: note,
  });
  profile.lastNoteReminder = day;
  await chrome.storage.local.set({profiles});
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm || alarm.periodInMinutes !== SYNC_MINUTES) {
    await chrome.alarms.create(ALARM, {delayInMinutes: SYNC_MINUTES, periodInMinutes: SYNC_MINUTES});
  }
  await remindDailyNote();
  const {odooConfig} = await chrome.storage.local.get('odooConfig');
  if (odooConfig?.enabled) {
    const odooAlarm = await chrome.alarms.get(ODOO_ALARM);
    if (!odooAlarm || odooAlarm.periodInMinutes !== SYNC_MINUTES) {
      await chrome.alarms.create(ODOO_ALARM, {periodInMinutes: SYNC_MINUTES});
    }
    await refreshOdoo();
  }
}

export async function refreshOdoo(now = new Date()) {
  const {odooConfig, odooNotified, language} = await chrome.storage.local.get(['odooConfig', 'odooNotified', 'language']);
  if (!odooConfig?.enabled) return {config: odooConfig || null, data: null};
  let data;
  try {
    if (!await chrome.permissions.contains({origins: [`${odooConfig.url}/*`]})) throw new Error('permission_required');
    data = await readAttendance(odooConfig, now);
  } catch (error) {
    const code = ['login_required', 'no_employee', 'permission_required'].includes(error.message) ? error.message : 'unavailable';
    data = {state: 'unknown', error: code, checkedAt: now.toISOString()};
  }
  await chrome.storage.local.set({odooData: data});
  const day = today(now);
  const notified = odooNotified?.day === day ? odooNotified : {day, keys: []};
  notified.completed ||= [];
  const keyFor = (slot) => `${odooConfig.url}|${data.employeeId}|${slot}|${odooConfig.times[slot]}`;
  const slot = attendanceReminder(odooConfig, data, now);
  const window = attendanceWindow(odooConfig, now);
  if (window !== null && !data.error && data.employeeId && slot === null && !notified.completed.includes(keyFor(window))) {
    notified.completed.push(keyFor(window));
    await chrome.storage.local.set({odooNotified: notified});
  }
  if (slot !== null && !notified.completed.includes(keyFor(slot)) && await chrome.notifications.getPermissionLevel() === 'granted') {
    const start = Date.parse(`${day}T${odooConfig.times[slot]}:00+07:00`);
    const tick = Math.floor((now.getTime() - start) / (10 * 60000));
    const key = `${keyFor(slot)}|${tick}`;
    if (!notified.keys.includes(key)) {
      const checkIn = slot % 2 === 0;
      await chrome.notifications.create(`odoo-attendance:${slot}:${tick}`, {
        type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon.png'),
        title: `Odoo · ${checkIn ? 'Check-in' : 'Check-out'} · ${odooConfig.times[slot]}`,
        message: language === 'en'
          ? checkIn ? 'No check-in recorded for this shift. Open Odoo to review your attendance.' : 'You are still checked in. Open Odoo to review your check-out.'
          : checkIn ? 'Chưa có check-in cho ca này. Mở Odoo để kiểm tra chấm công.' : 'Bạn vẫn đang check-in. Mở Odoo để kiểm tra check-out.',
      });
      notified.keys.push(key);
      await chrome.storage.local.set({odooNotified: notified});
    }
  }
  const completedSlots = odooConfig.times.map((_, i) => i).filter((i) => notified.completed.includes(keyFor(i)));
  const nextReminder = nextAttendanceReminder(odooConfig, now, completedSlots);
  if (nextReminder !== null) await chrome.alarms.create(ODOO_REMINDER_ALARM, {when: nextReminder});
  else await chrome.alarms.clear(ODOO_REMINDER_ALARM);
  return {config: odooConfig, data};
}

async function request(config, token, query, variables = {}) {
  const response = await fetch(`${config.url}/api/graphql`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) throw new Error(`GitLab returned HTTP ${response.status}. Check your token and its read_api scope.`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(`GitLab: ${data.errors.map((error) => error.message).join('; ')}`);
  if (!data.data) throw new Error('GitLab returned no data.');
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
      if (!token) throw new Error('Re-enter your token to resume GitLab sync.');
      const logs = [], seen = new Set();
      let after = null;
      while (true) {
        const data = await request(config, token, TIMELOG_QUERY, {
          username: config.username, start: `${range.start}T00:00:00+07:00`,
          end: `${range.end}T00:00:00+07:00`, after,
        });
        const connection = data.timelogs;
        if (!Array.isArray(connection?.nodes) || !connection.pageInfo) throw new Error('GitLab returned an incomplete timelog list.');
        logs.push(...connection.nodes);
        if (!connection.pageInfo.hasNextPage) break;
        after = connection.pageInfo.endCursor;
        if (!after || seen.has(after)) throw new Error('GitLab returned an invalid pagination cursor.');
        seen.add(after);
      }
      cache = {logs: normalizeLogs(logs, config, config.username, range.start, range.end), syncedAt: new Date().toISOString(), error: null};
    } catch (error) {
      cache = {...cache, error: error instanceof Error ? error.message : 'Unable to connect to GitLab.'};
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
  const notes = Object.fromEntries(Object.entries(profile.notes || {}).filter(([date]) => date >= range.monthStart && date < range.monthEnd));
  return {...snapshot, notes, profile: config.profile, configured: true, username: config.username, needsToken: !token};
}

export async function handleMessage(message) {
  switch (message.type) {
    case 'odoo.settings': {
      const {odooConfig, odooData} = await chrome.storage.local.get(['odooConfig', 'odooData']);
      return {config: odooConfig || null, data: odooData || null};
    }
    case 'odoo.connect': {
      const config = validateOdooConfig(message.config);
      if (!await chrome.permissions.contains({origins: [`${config.url}/*`]})) throw new Error('Allow access to your Odoo server first.');
      await chrome.storage.local.set({odooConfig: config});
      await chrome.alarms.create(ODOO_ALARM, {periodInMinutes: SYNC_MINUTES});
      return refreshOdoo();
    }
    case 'odoo.refresh': return refreshOdoo();
    case 'odoo.disconnect': {
      await chrome.storage.local.remove(['odooConfig', 'odooData']);
      await chrome.alarms.clear(ODOO_ALARM);
      await chrome.alarms.clear(ODOO_REMINDER_ALARM);
      return {config: null, data: null};
    }
    case 'settings': {
      const {config} = await chrome.storage.local.get('config');
      return {config: config ? {url: config.url, projects: config.projects, username: config.username, rememberToken: config.rememberToken, excelPattern: config.excelPattern || 'report_MM_YYYY.xlsx', reminderEnabled: config.reminderEnabled !== false, reminderTime: config.reminderTime || '10:00'} : null, hasToken: Boolean(await getToken())};
    }
    case 'connect': {
      const config = validateConfig(message.config);
      const existing = (await chrome.storage.local.get('config')).config;
      const token = String(message.token || (existing?.url === config.url ? await getToken() : '') || '').trim();
      if (!token) throw new Error('Enter a GitLab token with the read_api scope.');
      const user = (await request(config, token, 'query { currentUser { username } }')).currentUser;
      if (!user?.username) throw new Error('GitLab could not identify the account for this token.');
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
      await remindDailyNote();
      return synchronize(message.day || today(), true);
    }
    case 'snapshot': return synchronize(message.day || today(), Boolean(message.force));
    case 'note.save': {
      parseDay(message.day);
      if (typeof message.text !== 'string' || message.text.length > 5000) throw new Error('Notes must be 5,000 characters or fewer.');
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      if (!config?.profile) throw new Error('Connect to GitLab before adding notes.');
      if (message.profile !== config.profile) throw new Error('Your account has changed. Reopen the day to edit its note.');
      const profile = profiles[config.profile];
      profile.notes ||= {};
      if (message.text.trim()) profile.notes[message.day] = message.text;
      else delete profile.notes[message.day];
      await chrome.storage.local.set({profiles});
      await remindDailyNote();
      return {saved: true};
    }
    case 'leave.save': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      if (!config?.profile) throw new Error('Connect to GitLab before adding leave.');
      const profile = profiles[config.profile], entry = {...validateLeave(message.entry), id: message.id || crypto.randomUUID()};
      if (message.id && !profile.leaves.some((row) => row.id === message.id)) throw new Error('The leave entry to edit was not found.');
      if (profile.leaves.some((row) => row.day === entry.day && row.id !== entry.id)) throw new Error('This day already has a leave entry. Edit the existing entry.');
      profile.leaves = [...profile.leaves.filter((row) => row.id !== entry.id), entry];
      await chrome.storage.local.set({profiles});
      return {saved: true};
    }
    case 'leave.delete': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      const profile = profiles[config?.profile];
      if (!profile?.leaves.some((row) => row.id === message.id)) throw new Error('The leave entry to delete was not found.');
      profile.leaves = profile.leaves.filter((row) => row.id !== message.id);
      await chrome.storage.local.set({profiles});
      return {deleted: true};
    }
    case 'backup': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      if (!config?.profile) throw new Error('Connect an account before creating a backup.');
      return {version: 1, profile: config.profile, leaves: profiles[config.profile].leaves};
    }
    case 'restore': {
      const {config, profiles = {}} = await chrome.storage.local.get(['config', 'profiles']);
      const backup = message.backup;
      if (!config?.profile || backup?.version !== 1 || backup.profile !== config.profile || !Array.isArray(backup.leaves)) {
        throw new Error('This backup is invalid or belongs to another GitLab account.');
      }
      const byDay = new Map(profiles[config.profile].leaves.map((row) => [row.day, row]));
      let added = 0;
      for (const input of backup.leaves) {
        const entry = validateLeave(input), old = byDay.get(entry.day);
        if (old && (old.hours !== entry.hours || old.reason !== entry.reason)) throw new Error(`A different leave entry already exists for ${entry.day}. No data was overwritten.`);
        if (!old) {byDay.set(entry.day, {...entry, id: crypto.randomUUID()}); added++;}
      }
      profiles[config.profile].leaves = [...byDay.values()];
      await chrome.storage.local.set({profiles});
      return {added};
    }
    case 'export': {
      const snapshot = await synchronize(message.day || today(), true);
      if (!snapshot.configured) throw new Error('Connect to GitLab before exporting data.');
      return {csv: exportCsv(snapshot), filename: `tasks_${snapshot.date.slice(5, 7)}_${snapshot.date.slice(0, 4)}.csv`};
    }
    case 'export_excel_data': {
      const snapshot = await synchronize(message.day || today(), true);
      if (!snapshot.configured) throw new Error('Connect to GitLab before exporting data.');
      const {config} = await chrome.storage.local.get('config');
      const token = await getToken();
      if (!token) throw new Error('A GitLab token is required to fetch task details.');

      const groupedTasks = processProjectData(snapshot.logs);
      const offEntries = processOffData(snapshot.leaves);

      // Reuse the report generator's project mapping, discovered from this month's logs.
      const reportConfig = {...config, projects: config.projects?.length ? config.projects :
        [...new Map(snapshot.logs.map((log) => [log.projectPath, {project: log.project, url: log.projectPath}])).values()]
          .sort((a, b) => a.url.localeCompare(b.url))};
      const enrichmentMap = await enrichTasks(request, reportConfig, token, groupedTasks);
      const { projectBlocks, stats } = buildProjectData(groupedTasks, enrichmentMap, reportConfig);

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
      await chrome.alarms.clear(NOTE_ALARM);
      return {disconnected: true};
    }
    default: throw new Error('This action is not supported.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  serial(() => handleMessage(message)).then((data) => reply({ok: true, data}),
    (error) => reply({ok: false, error: error instanceof Error ? error.message : 'The action failed.'}));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ODOO_ALARM || alarm.name === ODOO_REMINDER_ALARM) {
    void serial(() => refreshOdoo()).catch(console.error);
    return;
  }
  if (alarm.name === NOTE_ALARM || alarm.name === ALARM) {
    void serial(async () => {
      await remindDailyNote();
      if (alarm.name === ALARM) await synchronize(today(), true);
    }).catch(console.error);
  }
});
chrome.notifications.onClicked.addListener((id) => {
  void serial(async () => {
    if (/^odoo-attendance:[0-3](?::[0-2])?$/.test(id)) {
      const {odooConfig} = await chrome.storage.local.get('odooConfig');
      if (odooConfig?.enabled) await chrome.tabs.create({url: `${odooConfig.url}/web`});
      await chrome.notifications.clear(id);
      return;
    }
    const match = /^daily-note:(.+):(\d{4}-\d{2}-\d{2})$/.exec(id);
    if (!match) return;
    const {config} = await chrome.storage.local.get('config');
    if (encodeURIComponent(config?.profile) !== match[1]) return;
    await chrome.tabs.create({url: chrome.runtime.getURL(`src/popup.html?note=${match[2]}`)});
    await chrome.notifications.clear(id);
  }).catch(console.error);
});
const start = () => void serial(initialize).catch(console.error);
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
start();
