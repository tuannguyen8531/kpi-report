import {today, parseDay, addDays, validateConfig} from './core.js';

// DOM selector helper
const $ = (id) => document.getElementById(id);

// Number and date formatters
const formatHours = (value) => value === null ? '—' : `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 2}).format(value)}h`;
const shortDay = (value) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const fullDayLabel = (dateStr) => {
  try {
    const d = parseDay(dateStr);
    const dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    return `${dayNames[d.getUTCDay()]}, ${shortDay(dateStr)}/${dateStr.slice(0, 4)}`;
  } catch {
    return dateStr;
  }
};

/**
 * Calculate total tracking time combining work hours and leave hours
 */
function getTracked(item) {
  const work = item?.hours ?? null;
  const leave = item?.leaveHours ?? 0;
  if (work === null && leave === 0) return { total: null, work: null, leave: 0 };
  const total = (work || 0) + leave;
  return { total, work: work || 0, leave };
}

// Application State
let snapshot = null;
let currentConfig = null;
let editingLeaveId = null;
let busy = false;
let activeTab = 'calendar';

// Initialize default date
const initialToday = today();
$('anchor').value = initialToday;
$('leave-day').value = initialToday;

/**
 * Toast Notification system
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = $('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

/**
 * Send message to Chrome extension runtime background
 */
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Extension chưa phản hồi. Vui lòng thử lại.');
  }
  return response.data;
}

/**
 * Wrap async UI actions with busy state and loading indicator
 */
async function act(action) {
  if (busy) return;
  busy = true;

  const syncBtn = $('btn-sync');
  if (syncBtn) syncBtn.classList.add('is-syncing');

  const interactiveElements = [
    'anchor', 'btn-today', 'btn-prev-day', 'btn-next-day',
    'btn-sync', 'export', 'btn-quick-export', 'connect',
    'leave-save', 'btn-onboarding-submit'
  ];
  for (const id of interactiveElements) {
    const el = $(id);
    if (el) el.disabled = true;
  }

  try {
    await action();
  } catch (error) {
    showToast(error.message, 'error', 4500);
  } finally {
    busy = false;
    if (syncBtn) syncBtn.classList.remove('is-syncing');

    const restoreElements = ['anchor', 'btn-today', 'btn-prev-day', 'btn-next-day', 'connect', 'btn-onboarding-submit'];
    for (const id of restoreElements) {
      const el = $(id);
      if (el) el.disabled = false;
    }

    const isConfigured = Boolean(snapshot?.configured);
    for (const id of ['btn-sync', 'export', 'btn-quick-export', 'leave-save']) {
      const el = $(id);
      if (el) el.disabled = !isConfigured;
    }
  }
}

/**
 * Switch active tab in popup mode
 */
function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.panel-tab-content').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });
}

/**
 * Select a calendar day
 */
function selectDay(dayStr) {
  if (busy) return;
  $('anchor').value = dayStr;
  if (!editingLeaveId) {
    $('leave-day').value = dayStr;
  }
  void act(() => reload());
}

/**
 * Reset leave form back to create mode
 */
function resetLeaveForm() {
  editingLeaveId = null;
  $('leave-day').value = $('anchor').value;
  $('leave-hours').value = 8;
  $('leave-reason').value = '';
  $('leave-form-title').textContent = 'Thêm ngày nghỉ mới';
  $('leave-save').querySelector('.btn-text').textContent = 'Lưu ngày nghỉ';
  $('leave-cancel').hidden = true;
  updatePresetChipsActive();
  if (snapshot) renderLeaves(snapshot);
}

/**
 * Trigger file download helper
 */
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Render the main Dashboard
 */
function render(data) {
  snapshot = data;

  // View state: Unconfigured vs Configured
  if (!data.configured) {
    $('view-dashboard').hidden = true;
    $('view-onboarding').hidden = false;
    return;
  }

  $('view-onboarding').hidden = true;
  $('view-dashboard').hidden = false;

  // User & Status header
  $('user-name').textContent = data.username ? `@${data.username}` : 'GitLab';
  const statusDot = $('status-dot');
  const statusText = $('status-text');

  if (data.error) {
    statusDot.className = 'status-dot error';
    statusText.textContent = data.error;
    statusText.title = data.error;
  } else {
    statusDot.className = 'status-dot live';
    const updatedTime = data.syncedAt ? new Date(data.syncedAt).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit'
    }) : 'Đã kết nối';
    statusText.textContent = `Đồng bộ lúc ${updatedTime}`;
    statusText.title = `Đồng bộ gần nhất: ${updatedTime}`;
  }

  // Selected Day info
  $('selected-day-text').textContent = fullDayLabel(data.date);

  // Top KPI Metrics (Combined Tracking Time: Work + Leave)
  // 1. Day Card
  const isToday = data.date === data.today;
  $('day-label').textContent = isToday ? 'Hôm nay' : `Ngày ${shortDay(data.date)}`;
  const dayStats = getTracked(data.day);
  $('day-hours').textContent = formatHours(dayStats.total);
  $('day-split-work').textContent = `Làm: ${formatHours(dayStats.work)}`;
  $('day-split-leave').textContent = `Nghỉ: ${formatHours(dayStats.leave)}`;
  const dayTotal = dayStats.total || 0;
  const dayWork = dayStats.work || 0;
  const dayLeave = dayStats.leave || 0;
  const dayWorkPct = Math.min(100, Math.round((dayWork / 8) * 100));
  const dayLeavePct = Math.min(100 - dayWorkPct, Math.round((dayLeave / 8) * 100));
  $('day-progress-work').style.width = `${dayWorkPct}%`;
  $('day-progress-leave').style.width = `${dayLeavePct}%`;
  const dayPercent = Math.min(100, Math.round((dayTotal / 8) * 100));
  $('day-progress-text').textContent = `Mục tiêu 8h · ${dayPercent}% (Làm ${formatHours(dayStats.work)} + Nghỉ ${formatHours(dayStats.leave)})`;
  $('day-leave').textContent = dayStats.leave > 0 ? `Bao gồm Nghỉ ${formatHours(dayStats.leave)}` : '100% Giờ làm việc';

  // Selected Day info in calendar bar
  $('selected-day-text').textContent = `${fullDayLabel(data.date)} · ${formatHours(dayStats.total)} (Làm: ${formatHours(dayStats.work)} · Nghỉ: ${formatHours(dayStats.leave)})`;

  // 2. Week Card (Calculated strictly within current month)
  const weekStartStr = data.week?.start || data.range.weekStart;
  const weekEndStr = data.week?.end || data.range.weekEnd;
  const isClamped = weekStartStr !== data.range.weekStart || weekEndStr !== data.range.weekEnd;
  $('week-range').textContent = `${shortDay(weekStartStr)} – ${shortDay(addDays(weekEndStr, -1))}${isClamped ? ' (trong tháng)' : ''}`;
  const weekStats = getTracked(data.week);
  $('week-hours').textContent = formatHours(weekStats.total);
  $('week-split-work').textContent = `Làm: ${formatHours(weekStats.work)}`;
  $('week-split-leave').textContent = `Nghỉ: ${formatHours(weekStats.leave)}`;
  const weekTotal = weekStats.total || 0;
  const weekWork = weekStats.work || 0;
  const weekLeave = weekStats.leave || 0;
  const weekWorkPct = Math.min(100, Math.round((weekWork / 40) * 100));
  const weekLeavePct = Math.min(100 - weekWorkPct, Math.round((weekLeave / 40) * 100));
  $('week-progress-work').style.width = `${weekWorkPct}%`;
  $('week-progress-leave').style.width = `${weekLeavePct}%`;
  const weekPercent = Math.min(100, Math.round((weekTotal / 40) * 100));
  $('week-progress-text').textContent = `Mục tiêu 40h · ${weekPercent}% (Làm ${formatHours(weekStats.work)} + Nghỉ ${formatHours(weekStats.leave)})`;
  $('week-leave').textContent = weekStats.leave > 0 ? `Bao gồm Nghỉ ${formatHours(weekStats.leave)}` : '100% Giờ làm việc';

  // 3. Month Card (Target: 192h standard)
  $('month-label').textContent = `Tháng ${data.date.slice(5, 7)}/${data.date.slice(0, 4)}`;
  const monthStats = getTracked(data.month);
  $('month-hours').textContent = formatHours(monthStats.total);
  $('month-split-work').textContent = `Làm: ${formatHours(monthStats.work)}`;
  $('month-split-leave').textContent = `Nghỉ: ${formatHours(monthStats.leave)}`;
  const monthTotal = monthStats.total || 0;
  const monthWork = monthStats.work || 0;
  const monthLeave = monthStats.leave || 0;
  const monthWorkPct = Math.min(100, Math.round((monthWork / 192) * 100));
  const monthLeavePct = Math.min(100 - monthWorkPct, Math.round((monthLeave / 192) * 100));
  $('month-progress-work').style.width = `${monthWorkPct}%`;
  $('month-progress-leave').style.width = `${monthLeavePct}%`;
  const monthPercent = Math.min(100, Math.round((monthTotal / 192) * 100));
  $('month-progress-text').textContent = `${monthPercent}% chỉ tiêu 192h (Làm ${formatHours(monthStats.work)} + Nghỉ ${formatHours(monthStats.leave)})`;
  $('month-leave').textContent = monthStats.leave > 0 ? `Tổng nghỉ ${formatHours(monthStats.leave)}` : 'Không có lịch nghỉ';

  // Report Overview Card in Report Panel
  $('report-month-title').textContent = `Tháng ${data.date.slice(5, 7)}/${data.date.slice(0, 4)}`;
  $('report-work-hours').textContent = formatHours(data.month.hours);
  $('report-leave-hours').textContent = formatHours(data.month.leaveHours);
  $('report-log-count').textContent = `${(data.logs || []).length} mục`;
  $('report-command-example').textContent = `uv run report -m ${parseInt(data.date.slice(5, 7), 10)} -y ${data.date.slice(0, 4)}`;

  // Render Calendar Grid
  renderCalendar(data);

  // Render Timelogs
  renderLogs();

  // Render Leave List
  renderLeaves(data);

  // Populate project filter dropdown
  updateProjectFilterOptions();
}

/**
 * Render Calendar Grid
 */
function renderCalendar(data) {
  const container = $('calendar');
  container.replaceChildren();

  // Offset empty cells for Monday start week (UTC Monday = 1)
  const firstDay = parseDay(data.range.monthStart);
  const offset = (firstDay.getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-blank';
    container.appendChild(blank);
  }

  // Days in month
  for (const day of data.days) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';

    const isSelected = day.date === data.date;
    const isCurrentToday = day.date === data.today;
    const isFuture = day.date > data.today;

    if (isSelected) cell.classList.add('is-selected');
    if (isCurrentToday) cell.classList.add('is-today');
    if (isFuture) cell.classList.add('is-future');

    const dayNum = parseInt(day.date.slice(8), 10);
    const numEl = document.createElement('span');
    numEl.className = 'cal-num';
    numEl.textContent = dayNum;
    cell.appendChild(numEl);

    const dayTracked = getTracked(day);
    if (dayTracked.total > 0) {
      if (day.hours > 0 && day.leaveHours > 0) {
        const totalChip = document.createElement('span');
        totalChip.className = 'cal-work-chip';
        totalChip.textContent = formatHours(dayTracked.total);
        cell.appendChild(totalChip);

        const leaveSub = document.createElement('span');
        leaveSub.className = 'cal-leave-chip';
        leaveSub.textContent = `Nghỉ ${formatHours(day.leaveHours)}`;
        cell.appendChild(leaveSub);
      } else if (day.hours > 0) {
        const workChip = document.createElement('span');
        workChip.className = 'cal-work-chip';
        workChip.textContent = formatHours(day.hours);
        cell.appendChild(workChip);
      } else if (day.leaveHours > 0) {
        const leaveChip = document.createElement('span');
        leaveChip.className = 'cal-leave-chip';
        leaveChip.textContent = `Nghỉ ${formatHours(day.leaveHours)}`;
        cell.appendChild(leaveChip);
      }
    }

    cell.title = `${day.date}: Tổng ${formatHours(dayTracked.total)} (Làm: ${formatHours(day.hours)}, Nghỉ: ${formatHours(day.leaveHours)})`;
    cell.addEventListener('click', () => selectDay(day.date));

    container.appendChild(cell);
  }
}

/**
 * Render Timelog list (includes both GitLab work logs and OFF leave records)
 */
function renderLogs() {
  const listEl = $('logs-list');
  const emptyEl = $('logs-empty');
  listEl.replaceChildren();

  const isDayOnly = $('day-only').checked;
  const selectedProject = $('logs-project-filter').value;
  const searchKeyword = $('logs-search').value.trim().toLowerCase();
  const targetDate = $('anchor').value;

  const rawLogs = snapshot?.logs || [];
  const rawLeaves = (snapshot?.leaves || []).map((entry) => ({
    id: `leave-${entry.id}`,
    leaveId: entry.id,
    date: entry.day,
    project: 'OFF',
    task: 'OFF',
    type: 'OFF',
    hours: entry.hours,
    title: entry.reason,
    url: null,
    summary: null,
    isLeave: true
  }));

  const allItems = [...rawLogs, ...rawLeaves].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const filtered = allItems.filter((item) => {
    if (isDayOnly && item.date !== targetDate) return false;
    if (selectedProject && item.project !== selectedProject) return false;
    if (searchKeyword) {
      const matchTitle = item.title?.toLowerCase().includes(searchKeyword);
      const matchProject = item.project?.toLowerCase().includes(searchKeyword);
      const matchTask = String(item.task)?.toLowerCase().includes(searchKeyword);
      const matchSummary = item.summary?.toLowerCase().includes(searchKeyword);
      if (!matchTitle && !matchProject && !matchTask && !matchSummary) return false;
    }
    return true;
  });

  // Update tab count badge
  const countBadge = $('badge-logs-count');
  countBadge.textContent = filtered.length;
  countBadge.hidden = filtered.length === 0;

  if (filtered.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const log of filtered) {
    const card = document.createElement('div');
    card.className = `log-card ${log.isLeave ? 'log-card-leave' : ''}`;

    const main = document.createElement('div');
    main.className = 'log-main';

    const tagsRow = document.createElement('div');
    tagsRow.className = 'log-tags';

    const projectTag = document.createElement('span');
    projectTag.className = `tag-project ${log.isLeave ? 'tag-project-off' : ''}`;
    projectTag.textContent = log.project;

    const typeTag = document.createElement('span');
    let typeClass = 'tag-task';
    let typeText = `#${log.task}`;
    if (log.type === 'MR') {
      typeClass = 'tag-mr';
      typeText = `MR !${log.task}`;
    } else if (log.type === 'OFF') {
      typeClass = 'tag-off';
      typeText = '🏖️ OFF';
    } else {
      typeText = `TASK #${log.task}`;
    }
    typeTag.className = `tag-type ${typeClass}`;
    typeTag.textContent = typeText;

    const dateTag = document.createElement('span');
    dateTag.className = 'tag-date';
    dateTag.textContent = shortDay(log.date);

    tagsRow.append(projectTag, typeTag, dateTag);

    const titleEl = document.createElement(log.url ? 'a' : 'div');
    titleEl.className = `log-title-link ${log.isLeave ? 'log-title-leave' : ''}`;
    titleEl.textContent = log.title || 'Không có tiêu đề';
    if (log.url) {
      titleEl.href = log.url;
      titleEl.target = '_blank';
      titleEl.rel = 'noopener noreferrer';
    }

    main.append(tagsRow, titleEl);

    if (log.summary && !log.isLeave) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'log-summary';
      summaryEl.textContent = `💬 ${log.summary}`;
      main.appendChild(summaryEl);
    }

    const hoursEl = document.createElement('div');
    let hoursClass = 'log-hours-pill';
    if (log.isLeave) {
      hoursClass += ' log-hours-off';
    } else if (log.hours < 0) {
      hoursClass += ' log-hours-negative';
    }
    hoursEl.className = hoursClass;
    hoursEl.textContent = (log.hours > 0 && !log.isLeave ? '+' : '') + formatHours(log.hours);

    card.append(main, hoursEl);
    listEl.appendChild(card);
  }
}

/**
 * Render Leaves list in month
 */
function renderLeaves(data) {
  const listEl = $('leave-list');
  const emptyEl = $('leave-empty');
  listEl.replaceChildren();

  const leaves = data.leaves || [];
  const totalLeaveHours = leaves.reduce((sum, l) => sum + (Number(l.hours) || 0), 0);

  // Update tab badge & summary badge
  $('badge-leave-count').textContent = leaves.length;
  $('badge-leave-count').hidden = leaves.length === 0;
  if ($('calendar-leave-badge')) {
    $('calendar-leave-badge').textContent = leaves.length;
    $('calendar-leave-badge').hidden = leaves.length === 0;
  }
  $('leave-summary-badge').textContent = `${leaves.length} ngày`;
  if ($('leave-toggle-badge')) {
    $('leave-toggle-badge').textContent = leaves.length;
  }
  if ($('leave-stat-days')) $('leave-stat-days').textContent = leaves.length;
  if ($('leave-stat-hours')) $('leave-stat-hours').textContent = formatHours(totalLeaveHours);
  if ($('leave-stat-kpi')) $('leave-stat-kpi').textContent = `+${formatHours(totalLeaveHours)}`;

  if (leaves.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const entry of leaves) {
    const isEditingThis = editingLeaveId === entry.id;
    const item = document.createElement('li');
    item.className = `leave-card-item ${isEditingThis ? 'is-editing' : ''}`;

    const main = document.createElement('div');
    main.className = 'leave-card-main';

    const header = document.createElement('div');
    header.className = 'leave-card-header';

    const dateBadge = document.createElement('span');
    dateBadge.className = 'leave-date-badge';
    dateBadge.textContent = fullDayLabel(entry.day);

    const hoursBadge = document.createElement('span');
    hoursBadge.className = 'leave-hours-badge';
    hoursBadge.textContent = `${entry.hours}h nghỉ`;

    header.append(dateBadge, hoursBadge);

    const reasonEl = document.createElement('div');
    reasonEl.className = 'leave-reason-text';
    reasonEl.textContent = entry.reason;

    main.append(header, reasonEl);

    if (isEditingThis) {
      const editTag = document.createElement('span');
      editTag.className = 'leave-editing-tag';
      editTag.textContent = '✏️ Đang chỉnh sửa tại form';
      main.appendChild(editTag);
    }

    const actions = document.createElement('div');
    actions.className = 'leave-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary btn-sm btn-icon-text';
    editBtn.title = 'Chỉnh sửa ngày nghỉ';
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-mini-icon"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg><span>Sửa</span>';
    editBtn.addEventListener('click', () => {
      editingLeaveId = entry.id;
      $('leave-day').value = entry.day;
      $('leave-hours').value = entry.hours;
      $('leave-reason').value = entry.reason;
      $('leave-form-title').textContent = `Sửa ngày nghỉ ${shortDay(entry.day)}`;
      $('leave-save').querySelector('.btn-text').textContent = 'Lưu thay đổi';
      $('leave-cancel').hidden = false;
      updatePresetChipsActive();
      setLeaveModalView('form');
      $('leave-day').focus();
      renderLeaves(snapshot);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger-outline btn-sm btn-icon-text';
    removeBtn.title = 'Xóa ngày nghỉ';
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-mini-icon"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Xóa</span>';
    removeBtn.addEventListener('click', () => act(async () => {
      if (!confirm(`Bạn có chắc chắn muốn xóa lịch nghỉ ngày ${shortDay(entry.day)}?`)) return;
      await send({type: 'leave.delete', id: entry.id});
      if (editingLeaveId === entry.id) resetLeaveForm();
      await reload();
      showToast('Đã xóa lịch nghỉ thành công.', 'success');
    }));

    actions.append(editBtn, removeBtn);
    item.append(main, actions);
    listEl.appendChild(item);
  }
}

/**
 * Update project filter dropdown choices
 */
function updateProjectFilterOptions() {
  const select = $('logs-project-filter');
  const currentVal = select.value;
  const projects = new Set((snapshot?.logs || []).map((l) => l.project).filter(Boolean));

  select.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Tất cả dự án';
  select.appendChild(defaultOpt);

  for (const p of [...projects].sort()) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }

  if ((snapshot?.leaves || []).length > 0) {
    const offOpt = document.createElement('option');
    offOpt.value = 'OFF';
    offOpt.textContent = '🏖️ OFF (Nghỉ phép)';
    select.appendChild(offOpt);
  }

  if (projects.has(currentVal) || currentVal === 'OFF') {
    select.value = currentVal;
  }
}

/**
 * Reload snapshot from background worker
 */
async function reload(force = false) {
  const targetDay = $('anchor').value;
  const data = await send({type: 'snapshot', day: targetDay, force});
  if ($('anchor').value === targetDay) {
    render(data);
  }
}

/* ============================================================
   EVENT HANDLERS & LISTENERS
   ============================================================ */

// 1. Date toolbar navigation
$('anchor').addEventListener('change', () => selectDay($('anchor').value));
$('btn-today').addEventListener('click', () => selectDay(today()));
$('btn-prev-day').addEventListener('click', () => {
  const current = $('anchor').value;
  selectDay(addDays(current, -1));
});
$('btn-next-day').addEventListener('click', () => {
  const current = $('anchor').value;
  selectDay(addDays(current, 1));
});

// 2. Refresh / Sync
$('btn-sync').addEventListener('click', () => act(async () => {
  await reload(true);
  if (!snapshot.error) {
    showToast('Đã đồng bộ dữ liệu mới nhất từ GitLab!', 'success');
  }
}));

// 3. Expand into tab
$('btn-expand').addEventListener('click', () => {
  chrome.tabs.create({url: chrome.runtime.getURL('src/popup.html')});
});

// 4. Quick Action from calendar to log leave
$('btn-quick-log-leave').addEventListener('click', () => {
  $('leave-day').value = $('anchor').value;
  openLeaveModal();
  $('leave-hours').focus();
});

// 5. Popup Tabs switching (Leave tab opens dedicated leave modal)
document.querySelectorAll('.tab-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'leave') {
      openLeaveModal();
    } else {
      switchTab(btn.dataset.tab);
    }
  });
});

// 6. Timelog filters
$('day-only').addEventListener('change', renderLogs);
$('logs-search').addEventListener('input', renderLogs);
$('logs-project-filter').addEventListener('change', renderLogs);

// 7. Leave Form & Modal Controls
function updatePresetChipsActive() {
  const currentHours = Number($('leave-hours').value);
  document.querySelectorAll('.preset-chip').forEach((chip) => {
    const chipHours = Number(chip.dataset.hours);
    chip.classList.toggle('active', chipHours === currentHours);
  });
}

function setLeaveModalView(view) {
  const formCol = document.querySelector('.leave-modal-form-col');
  const listCol = document.querySelector('.leave-modal-list-col');
  const btnForm = $('toggle-leave-form');
  const btnList = $('toggle-leave-list');
  if (!btnForm || !btnList || !formCol || !listCol) return;

  if (view === 'list') {
    formCol.classList.add('mobile-hidden');
    listCol.classList.remove('mobile-hidden');
    btnForm.classList.remove('active');
    btnList.classList.add('active');
  } else {
    formCol.classList.remove('mobile-hidden');
    listCol.classList.add('mobile-hidden');
    btnForm.classList.add('active');
    btnList.classList.remove('active');
  }
}

$('leave-cancel').addEventListener('click', resetLeaveForm);

document.querySelectorAll('.preset-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $('leave-hours').value = chip.dataset.hours;
    updatePresetChipsActive();
  });
});
$('leave-hours').addEventListener('input', updatePresetChipsActive);

document.querySelectorAll('.reason-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $('leave-reason').value = chip.dataset.reason;
    $('leave-reason').focus();
  });
});

$('toggle-leave-form')?.addEventListener('click', () => setLeaveModalView('form'));
$('toggle-leave-list')?.addEventListener('click', () => setLeaveModalView('list'));

$('leave-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void act(async () => {
    const entry = {
      day: $('leave-day').value,
      hours: Number($('leave-hours').value),
      reason: $('leave-reason').value
    };
    await send({type: 'leave.save', id: editingLeaveId, entry});
    $('anchor').value = entry.day;
    resetLeaveForm();
    await reload();
    showToast('Đã lưu thông tin ngày nghỉ!', 'success');
    setLeaveModalView('list');
  });
});

// 8. Leave Backup & Restore
$('backup').addEventListener('click', () => act(async () => {
  const backupData = await send({type: 'backup'});
  downloadFile(`kpi-ngay-nghi-${today()}.json`, JSON.stringify(backupData, null, 2), 'application/json');
  showToast('Đã xuất file sao lưu lịch nghỉ.', 'success');
}));
$('restore').addEventListener('change', (e) => act(async () => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const result = await send({type: 'restore', backup: json});
    e.target.value = '';
    await reload();
    showToast(`Đã khôi phục thành công ${result.added} ngày nghỉ.`, 'success');
  } catch (err) {
    showToast(`Khôi phục thất bại: ${err.message}`, 'error', 4500);
  }
}));

// 9. Export CSV
const handleExport = () => act(async () => {
  const result = await send({type: 'export', day: $('anchor').value});
  downloadFile(result.filename, result.csv, 'text/csv;charset=utf-8');
  await reload();
  showToast('Đã xuất file CSV thành công!', 'success');
});
$('export').addEventListener('click', handleExport);
$('btn-quick-export').addEventListener('click', handleExport);

/* ============================================================
   ONBOARDING / FIRST RUN SETUP
   ============================================================ */
// Toggle password visibility in onboarding
$('btn-toggle-onboarding-token').addEventListener('click', () => {
  const input = $('onboarding-token');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// Toggle raw JSON editor in onboarding
$('btn-toggle-onboarding-json').addEventListener('click', () => {
  const editor = $('onboarding-projects');
  const isHidden = editor.hidden;
  editor.hidden = !isHidden;
  $('btn-toggle-onboarding-json').querySelector('span').textContent = isHidden ? 'Thu gọn JSON' : 'Xem / sửa JSON thủ công';
});

// Dropzone file handling for onboarding
function handleProjectJsonText(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('File JSON phải chứa một mảng danh sách dự án.');
    const validCount = parsed.filter((p) => p && p.project && p.project !== 'OFF').length;
    $('onboarding-projects').value = JSON.stringify(parsed, null, 2);
    const statusBadge = $('onboarding-projects-status');
    statusBadge.hidden = false;
    statusBadge.textContent = `✓ Đã nạp thành công ${validCount} dự án từ file`;
  } catch (err) {
    showToast(`File JSON không hợp lệ: ${err.message}`, 'error');
  }
}

const dropzone = $('onboarding-dropzone');
const fileInput = $('onboarding-file');

$('btn-browse-onboarding').addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleProjectJsonText(await file.text());
});
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) handleProjectJsonText(await file.text());
});

// Onboarding submit
$('onboarding-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void act(async () => {
    const errorNotice = $('onboarding-notice');
    errorNotice.hidden = true;

    try {
      const config = validateConfig({
        url: $('onboarding-url').value,
        projects: $('onboarding-projects').value,
        rememberToken: $('onboarding-remember').checked
      });

      const parsedUrl = new URL(config.url);
      const pattern = `${parsedUrl.protocol}//${parsedUrl.hostname}/*`;
      const granted = await chrome.permissions.request({origins: [pattern]});
      if (!granted) throw new Error('Bạn cần cấp quyền truy cập máy chủ GitLab để tiếp tục.');

      const tokenVal = $('onboarding-token').value;
      const data = await send({
        type: 'connect',
        config,
        token: tokenVal,
        day: $('anchor').value
      });

      render(data);
      showToast(`Kết nối thành công tài khoản @${data.username}!`, 'success');
    } catch (err) {
      errorNotice.textContent = err.message;
      errorNotice.hidden = false;
      throw err;
    }
  });
});

/* ============================================================
   SETTINGS MODAL
   ============================================================ */
function openSettingsModal() {
  if (currentConfig) {
    $('gitlab-url').value = currentConfig.url || '';
    $('remember-token').checked = Boolean(currentConfig.rememberToken);
    $('projects').value = currentConfig.projects ? JSON.stringify(currentConfig.projects, null, 2) : '';
  }
  $('gitlab-token').value = '';
  $('modal-settings').hidden = false;
}

function closeSettingsModal() {
  $('modal-settings').hidden = true;
}

$('btn-settings').addEventListener('click', openSettingsModal);
$('btn-close-settings').addEventListener('click', closeSettingsModal);
$('btn-cancel-settings').addEventListener('click', closeSettingsModal);
$('modal-settings').addEventListener('click', (e) => {
  if (e.target.id === 'modal-settings') closeSettingsModal();
});

// Toggle password in settings
$('btn-toggle-settings-token').addEventListener('click', () => {
  const input = $('gitlab-token');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// File picker in settings
$('projects-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    $('projects').value = JSON.stringify(JSON.parse(text), null, 2);
    showToast('Đã đọc danh sách dự án. Bấm Lưu thay đổi để áp dụng.', 'info');
  } catch (err) {
    showToast('File JSON không hợp lệ.', 'error');
  }
});

// Save settings
$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void act(async () => {
    const config = validateConfig({
      url: $('gitlab-url').value,
      projects: $('projects').value,
      rememberToken: $('remember-token').checked
    });

    const parsedUrl = new URL(config.url);
    const pattern = `${parsedUrl.protocol}//${parsedUrl.hostname}/*`;
    const granted = await chrome.permissions.request({origins: [pattern]});
    if (!granted) throw new Error('Cần quyền kết nối máy chủ GitLab đã chọn.');

    const tokenVal = $('gitlab-token').value;
    const data = await send({
      type: 'connect',
      config,
      token: tokenVal,
      day: $('anchor').value
    });

    currentConfig = config;
    closeSettingsModal();
    render(data);
    showToast(data.error || `Đã cập nhật kết nối tài khoản @${data.username}!`, data.error ? 'error' : 'success');
  });
});

// Disconnect account
$('btn-disconnect').addEventListener('click', () => act(async () => {
  if (!confirm('Bạn có chắc muốn ngắt kết nối tài khoản GitLab này khỏi tiện ích?')) return;
  await send({type: 'disconnect'});
  currentConfig = null;
  snapshot = null;
  closeSettingsModal();
  $('onboarding-token').value = '';
  $('view-dashboard').hidden = true;
  $('view-onboarding').hidden = false;
  showToast('Đã ngắt kết nối thành công.', 'info');
}));

/* ============================================================
   TIME BREAKDOWN MODAL (Chi tiết phân bổ Làm / Nghỉ)
   ============================================================ */
function openBreakdownModal(scope = 'day') {
  if (!snapshot) return;

  let periodTitle = '';
  let periodBadge = '';
  let stats = null;
  let workItems = [];
  let leaveItems = [];
  let noteText = '';

  if (scope === 'day') {
    const isToday = snapshot.date === snapshot.today;
    periodBadge = isToday ? 'Hôm nay' : `Ngày ${shortDay(snapshot.date)}`;
    periodTitle = `Phân bổ thời gian: ${fullDayLabel(snapshot.date)}`;
    stats = getTracked(snapshot.day);
    noteText = `Chi tiết ngày ${shortDay(snapshot.date)}: Gồm giờ làm trên GitLab và giờ nghỉ phép đã lưu trên máy.`;

    workItems = (snapshot.logs || []).filter((log) => log.date === snapshot.date).map((log) => ({
      title: `${log.type === 'MR' ? 'MR !' : '#'}${log.task} · ${log.title}`,
      meta: log.project,
      hours: log.hours,
      url: log.url || null,
    }));

    leaveItems = (snapshot.leaves || []).filter((l) => l.day === snapshot.date).map((l) => ({
      title: l.reason,
      meta: fullDayLabel(l.day),
      hours: l.hours,
    }));
  } else if (scope === 'week') {
    const startStr = snapshot.week?.start || snapshot.range.weekStart;
    const endStr = snapshot.week?.end || snapshot.range.weekEnd;
    const endMinus1 = addDays(endStr, -1);
    periodBadge = 'Tuần';
    periodTitle = `Phân bổ tuần: ${shortDay(startStr)} – ${shortDay(endMinus1)}`;
    stats = getTracked(snapshot.week);
    noteText = `Thời gian tuần chỉ tính các ngày trong tháng ${snapshot.date.slice(5, 7)}/${snapshot.date.slice(0, 4)}, kể cả khi tuần bắt đầu từ tháng trước.`;

    workItems = (snapshot.logs || []).filter((log) => log.date >= startStr && log.date < endStr).map((log) => ({
      title: `${log.type === 'MR' ? 'MR !' : '#'}${log.task} · ${log.title}`,
      meta: `${shortDay(log.date)} · ${log.project}`,
      hours: log.hours,
      url: log.url || null,
    }));

    leaveItems = (snapshot.leaves || []).filter((l) => l.day >= startStr && l.day < endStr).map((l) => ({
      title: l.reason,
      meta: shortDay(l.day),
      hours: l.hours,
    }));
  } else if (scope === 'month') {
    const monthBadgeStr = `Tháng ${snapshot.date.slice(5, 7)}/${snapshot.date.slice(0, 4)}`;
    periodBadge = monthBadgeStr;
    periodTitle = `Phân bổ cả tháng: ${monthBadgeStr}`;
    stats = getTracked(snapshot.month);
    noteText = `Tổng thời gian tracking trong tháng ${snapshot.date.slice(5, 7)}/${snapshot.date.slice(0, 4)} so với chỉ tiêu 192 giờ.`;

    workItems = (snapshot.logs || []).map((log) => ({
      title: `${log.type === 'MR' ? 'MR !' : '#'}${log.task} · ${log.title}`,
      meta: `${shortDay(log.date)} · ${log.project}`,
      hours: log.hours,
      url: log.url || null,
    }));

    leaveItems = (snapshot.leaves || []).map((l) => ({
      title: l.reason,
      meta: shortDay(l.day),
      hours: l.hours,
    }));
  }

  $('breakdown-title').textContent = periodTitle;
  $('breakdown-period-badge').textContent = periodBadge;
  $('breakdown-note-text').textContent = noteText;

  const total = stats?.total || 0;
  const work = stats?.work || 0;
  const leave = stats?.leave || 0;

  $('breakdown-total-val').textContent = formatHours(stats?.total);
  $('breakdown-work-val').textContent = formatHours(stats?.work);
  $('breakdown-leave-val').textContent = formatHours(stats?.leave);

  const workPct = total > 0 ? Math.round((work / total) * 100) : 0;
  const leavePct = total > 0 ? (100 - workPct) : 0;

  $('breakdown-bar-work').style.width = `${workPct}%`;
  $('breakdown-bar-leave').style.width = `${leavePct}%`;
  $('breakdown-ratio-work').textContent = `${workPct}% (${formatHours(work)})`;
  $('breakdown-ratio-leave').textContent = `${leavePct}% (${formatHours(leave)})`;

  // Render work items list (clickable links to GitLab when url exists)
  const workListEl = $('breakdown-work-list');
  workListEl.replaceChildren();
  if (workItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-item-entry';
    empty.textContent = 'Chưa có giờ làm việc nào.';
    workListEl.appendChild(empty);
  } else {
    for (const item of workItems) {
      const isLink = Boolean(item.url);
      const row = document.createElement(isLink ? 'a' : 'div');
      row.className = `breakdown-item-entry ${isLink ? 'breakdown-item-link' : ''}`;
      if (isLink) {
        row.href = item.url;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
        row.title = `Mở trên GitLab: ${item.title}`;
      }
      const label = document.createElement('div');
      label.className = 'breakdown-item-text';

      const titleEl = document.createElement('strong');
      titleEl.textContent = item.title;

      const metaEl = document.createElement('div');
      metaEl.className = 'breakdown-item-meta';
      metaEl.textContent = item.meta;

      label.append(titleEl, metaEl);

      const hrs = document.createElement('span');
      hrs.className = 'breakdown-item-hrs';
      hrs.textContent = formatHours(item.hours);

      row.append(label, hrs);
      workListEl.appendChild(row);
    }
  }

  // Render leave items list
  const leaveListEl = $('breakdown-leave-list');
  leaveListEl.replaceChildren();
  if (leaveItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-item-entry';
    empty.textContent = 'Không có lịch nghỉ phép.';
    leaveListEl.appendChild(empty);
  } else {
    for (const item of leaveItems) {
      const row = document.createElement('div');
      row.className = 'breakdown-item-entry breakdown-item-leave';
      const label = document.createElement('div');
      label.className = 'breakdown-item-text';

      const titleEl = document.createElement('strong');
      titleEl.textContent = item.title;

      const metaEl = document.createElement('div');
      metaEl.className = 'breakdown-item-meta';
      metaEl.textContent = item.meta;

      label.append(titleEl, metaEl);

      const hrs = document.createElement('span');
      hrs.className = 'breakdown-item-hrs text-amber';
      hrs.textContent = formatHours(item.hours);

      row.append(label, hrs);
      leaveListEl.appendChild(row);
    }
  }

  $('modal-breakdown').hidden = false;
}

function closeBreakdownModal() {
  $('modal-breakdown').hidden = true;
}

// Open breakdown on metric card clicks
$('card-day').addEventListener('click', () => openBreakdownModal('day'));
$('card-week').addEventListener('click', () => openBreakdownModal('week'));
$('card-month').addEventListener('click', () => openBreakdownModal('month'));
$('btn-day-breakdown').addEventListener('click', () => openBreakdownModal('day'));

['card-day', 'card-week', 'card-month'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openBreakdownModal(id.replace('card-', ''));
    }
  });
});

$('btn-close-breakdown').addEventListener('click', closeBreakdownModal);
$('btn-done-breakdown').addEventListener('click', closeBreakdownModal);
$('modal-breakdown').addEventListener('click', (e) => {
  if (e.target.id === 'modal-breakdown') closeBreakdownModal();
});

/* ============================================================
   LEAVE MANAGEMENT MODAL
   ============================================================ */
function openLeaveModal() {
  if ($('anchor')?.value && !$('leave-day').value) {
    $('leave-day').value = $('anchor').value;
  }
  updatePresetChipsActive();
  setLeaveModalView('form');
  $('modal-leave').hidden = false;
}

function closeLeaveModal() {
  $('modal-leave').hidden = true;
}

if ($('btn-open-leave-modal')) {
  $('btn-open-leave-modal').addEventListener('click', openLeaveModal);
}
$('btn-close-leave').addEventListener('click', closeLeaveModal);
$('btn-done-leave').addEventListener('click', closeLeaveModal);
$('modal-leave').addEventListener('click', (e) => {
  if (e.target.id === 'modal-leave') closeLeaveModal();
});

/* ============================================================
   STORAGE CHANGE LISTENER & INITIAL LOAD
   ============================================================ */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.profiles && !busy) {
    void act(() => reload());
  }
});

// Initial boot
void act(async () => {
  const settings = await send({type: 'settings'});
  if (settings.config) {
    currentConfig = settings.config;
    $('onboarding-url').value = settings.config.url || '';
    $('onboarding-remember').checked = Boolean(settings.config.rememberToken);
    if (settings.config.projects) {
      $('onboarding-projects').value = JSON.stringify(settings.config.projects, null, 2);
      const validCount = settings.config.projects.length;
      const statusBadge = $('onboarding-projects-status');
      statusBadge.hidden = false;
      statusBadge.textContent = `✓ Đã có sẵn ${validCount} dự án đã lưu`;
    }
  }

  await reload();
});
