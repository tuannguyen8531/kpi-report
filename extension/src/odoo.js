import {today, parseDay, addDays} from './core.js';

export const ODOO_TIMES = ['08:30', '12:00', '13:30', '18:00'];

export function validateOdooConfig(input) {
  const address = String(input.url || '').trim();
  if (!address) throw new Error('Enter your Odoo server URL.');
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', '/web', '/web/'].includes(url.pathname)) {
    throw new Error('Use the HTTPS Odoo server URL, without query parameters.');
  }
  const times = input.times || ODOO_TIMES;
  if (!Array.isArray(times) || times.length !== 4 || times.some((time, i) =>
    typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || (i > 0 && time <= times[i - 1]))) {
    throw new Error('Enter four attendance reminder times in chronological order.');
  }
  return {url: url.origin, enabled: true, reminders: input.reminders === true, times};
}

export function formatHoursMinutes(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return '—';
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function parseAttendance(data, now = new Date()) {
  if (!data?.id) throw new Error('no_employee');
  if (!['checked_in', 'checked_out'].includes(data.attendance_state)) throw new Error('unavailable');
  let lastCheckIn = null;
  if (data.last_check_in) {
    // Odoo serializes Datetime values in UTC, without a timezone suffix.
    const value = data.last_check_in;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) throw new Error('unavailable');
    parseDay(value.slice(0, 10));
    const parsed = new Date(value.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime()) throw new Error('unavailable');
    lastCheckIn = parsed.toISOString();
  }
  if (data.attendance_state === 'checked_in' && !lastCheckIn) throw new Error('unavailable');
  const workedToday = lastCheckIn && today(new Date(lastCheckIn)) === today(now);
  return {
    employeeId: data.id, lastCheckIn,
    hoursToday: typeof data.hours_today === 'number' && Number.isFinite(data.hours_today) && data.hours_today >= 0 ? data.hours_today : null,
    state: data.attendance_state === 'checked_in' ? 'checked_in' : workedToday ? 'checked_out' : 'not_today',
    checkedAt: now.toISOString(), error: null,
  };
}

export function nextAttendanceReminder(config, now = new Date(), completedSlots = []) {
  if (!config.enabled || !config.reminders) return null;
  for (let offset = 0; offset < 8; offset++) {
    const day = addDays(today(now), offset), weekday = parseDay(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const checks = config.times.flatMap((time, slot) => {
      if (offset === 0 && completedSlots.includes(slot)) return [];
      const start = Date.parse(`${day}T${time}:00+07:00`);
      return [0, 10, 20].map((minutes) => start + minutes * 60000);
    }).sort((a, b) => a - b);
    for (const when of checks) {
      if (when > now.getTime()) return when;
    }
  }
  return null;
}

export async function readAttendance(config, now = new Date(), request = fetch) {
  const response = await request(`${config.url}/hr_attendance/attendance_user_data`, {
    method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', method: 'call', params: {}, id: 1}),
  });
  if ([401, 403].includes(response.status)) throw new Error('login_required');
  if (!response.ok) throw new Error('unavailable');
  const payload = await response.json();
  if (payload.error) {
    const name = String(payload.error.data?.name || '');
    throw new Error(/SessionExpired|AccessDenied/.test(name) || payload.error.code === 100 ? 'login_required' : 'unavailable');
  }
  return parseAttendance(payload.result, now);
}

// Each milestone is active for 30 minutes; missed windows are never replayed.
export function attendanceWindow(config, now = new Date()) {
  if (!config.enabled || !config.reminders) return null;
  const day = today(now), weekday = parseDay(day).getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  const deadlines = config.times.map((time) => Date.parse(`${day}T${time}:00+07:00`));
  let slot = -1;
  deadlines.forEach((deadline, index) => {if (now.getTime() >= deadline) slot = index;});
  return slot < 0 || now.getTime() >= deadlines[slot] + 30 * 60000 ? null : slot;
}

export function attendanceReminder(config, data, now = new Date()) {
  if (data.error || !data.employeeId || today(new Date(data.checkedAt)) !== today(now)) return null;
  const slot = attendanceWindow(config, now);
  if (slot === null) return null;
  if (slot % 2 === 1) return data.state === 'checked_in' ? slot : null;
  const day = today(now);
  const windowStart = Date.parse(`${day}T${slot === 0 ? '00:00' : config.times[slot - 1]}:00+07:00`);
  return data.lastCheckIn && Date.parse(data.lastCheckIn) >= windowStart ? null : slot;
}
