// Pure JavaScript implementation of KPI Excel report generation.
// Equivalent to Python's kpi_report (processor.py, gitlab.py, report.py).

export const OUTPUT_COLUMNS = [
  'Url', 'Start date', 'Due date', 'Closed date', 'Estimate',
  'Spent', 'Reopen count', 'Task Type', 'Progress',
];

export const DEFAULT_TASK_TYPE = 'Kế hoạch';
export const DEFAULT_PROGRESS = 'Đúng hạn';

export const QUERY_WORK_ITEM = `
query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    workItems(iid: $iid) {
      nodes {
        closedAt
        widgets {
          ... on WorkItemWidgetStartAndDueDate {
            startDate
            dueDate
          }
          ... on WorkItemWidgetTimeTracking {
            timeEstimate
          }
        }
      }
    }
  }
}
`;

export const QUERY_MERGE_REQUEST = `
query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequests(iids: [$iid]) {
      nodes {
        timeEstimate
      }
    }
  }
}
`;

/**
 * Format Excel filename using pattern with MM and YYYY.
 */
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

/**
 * Format Date or ISO date string into MM/DD/YYYY format.
 */
export function formatMonthDayYear(dateInput) {
  if (!dateInput) return '';
  let dateObj;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
      const [y, m, d] = dateInput.slice(0, 10).split('-').map(Number);
      dateObj = new Date(Date.UTC(y, m - 1, d));
    } else {
      dateObj = new Date(dateInput);
    }
  } else {
    return '';
  }
  if (!Number.isFinite(dateObj.getTime())) return '';
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');
  const yyyy = dateObj.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Parse MM/DD/YYYY string into a UTC Date object.
 */
export function parseMonthDayYear(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts.map(Number);
  if (!mm || !dd || !yyyy) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

/**
 * Group timelogs by (project, task, type).
 * Aggregates spent hours and finds earliest date.
 */
export function processProjectData(logs) {
  const groups = new Map();

  for (const log of logs) {
    if (log.project === 'OFF') continue;
    const key = `${log.project}:::${log.task}:::${log.type}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        Project: log.project,
        Task: String(log.task),
        Type: log.type,
        minDate: log.date,
        Spent: Number(log.hours) || 0,
      });
    } else {
      existing.Spent += Number(log.hours) || 0;
      if (log.date < existing.minDate) {
        existing.minDate = log.date;
      }
    }
  }

  const result = [];
  for (const item of groups.values()) {
    result.push({
      Project: item.Project,
      Task: item.Task,
      Type: item.Type,
      Start_date: formatMonthDayYear(item.minDate),
      Spent: Number(item.Spent.toFixed(4)),
    });
  }

  return result;
}

/**
 * Process OFF (time off) entries.
 */
export function processOffData(leaves) {
  const result = [];
  for (const leaf of leaves) {
    result.push({
      Project: 'OFF',
      Task: leaf.reason || 'OFF',
      Type: 'OFF',
      Start_date: formatMonthDayYear(leaf.day),
      Spent: Number(leaf.hours) || 0,
    });
  }
  return result.sort((a, b) => a.Start_date.localeCompare(b.Start_date));
}

/**
 * Parse GraphQL work item response into standardized date/estimate dict.
 */
export function parseWorkItemResponse(data) {
  const info = {
    start_date: '',
    due_date: '',
    closed_date: '',
    estimate: '',
  };

  try {
    const nodes = data?.project?.workItems?.nodes || [];
    if (!nodes.length) return info;
    const workItem = nodes[0];

    if (workItem.closedAt) {
      info.closed_date = formatMonthDayYear(workItem.closedAt);
    }

    const widgets = workItem.widgets || [];
    for (const widget of widgets) {
      if (widget.startDate) {
        info.start_date = formatMonthDayYear(widget.startDate);
      }
      if (widget.dueDate) {
        info.due_date = formatMonthDayYear(widget.dueDate);
      }
      if (widget.timeEstimate) {
        info.estimate = (widget.timeEstimate / 3600).toFixed(2);
      }
    }
  } catch (err) {
    console.warn('Error parsing work item response:', err);
  }

  return info;
}

/**
 * Parse GraphQL merge request response into estimate.
 */
export function parseMergeRequestResponse(data) {
  const info = { estimate: '' };
  try {
    const nodes = data?.project?.mergeRequests?.nodes || [];
    if (!nodes.length) return info;
    const mr = nodes[0];
    if (mr.timeEstimate) {
      info.estimate = (mr.timeEstimate / 3600).toFixed(2);
    }
  } catch (err) {
    console.warn('Error parsing merge request response:', err);
  }
  return info;
}

/**
 * Enrich tasks with GitLab dates and estimates.
 * Handles concurrency and errors gracefully.
 */
export async function enrichTasks(requestFn, config, token, tasks, onProgress = null) {
  const urlMap = new Map((config.projects || []).map((p) => [p.project, p.url]));
  const enrichmentMap = new Map();
  const uniqueItems = new Map();

  for (const t of tasks) {
    const key = `${t.Project}:::${t.Task}:::${t.Type}`;
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, t);
    }
  }

  const items = [...uniqueItems.values()];
  let completed = 0;

  // Process in small batches of concurrent requests to prevent rate limiting
  const CONCURRENCY = 6;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      const key = `${item.Project}:::${item.Task}:::${item.Type}`;
      const projectPath = urlMap.get(item.Project);

      if (!projectPath || item.Project === 'OFF') {
        enrichmentMap.set(key, { start_date: '', due_date: '', closed_date: '', estimate: '' });
        return;
      }

      try {
        if (item.Type === 'TASK') {
          const data = await requestFn(config, token, QUERY_WORK_ITEM, {
            fullPath: projectPath,
            iid: String(item.Task),
          });
          enrichmentMap.set(key, parseWorkItemResponse(data));
        } else if (item.Type === 'MR') {
          const data = await requestFn(config, token, QUERY_MERGE_REQUEST, {
            fullPath: projectPath,
            iid: String(item.Task),
          });
          const mrInfo = parseMergeRequestResponse(data);
          enrichmentMap.set(key, {
            start_date: '',
            due_date: '',
            closed_date: '',
            estimate: mrInfo.estimate,
          });
        } else {
          enrichmentMap.set(key, { start_date: '', due_date: '', closed_date: '', estimate: '' });
        }
      } catch (err) {
        console.warn(`GitLab enrichment failed for ${item.Project} ${item.Type} #${item.Task}:`, err);
        enrichmentMap.set(key, { start_date: '', due_date: '', closed_date: '', estimate: '' });
      } finally {
        completed++;
        if (typeof onProgress === 'function') {
          onProgress(completed, items.length);
        }
      }
    }));
  }

  return enrichmentMap;
}

/**
 * Build structured project DataFrames and stats ready for Excel export.
 */
export function buildProjectData(groupedProjects, enrichmentMap, config) {
  const urlMap = new Map((config.projects || []).map((p) => [p.project, p.url]));
  const projectOrder = (config.projects || []).map((p) => p.project).filter((p) => p !== 'OFF');

  let totalTasks = 0;
  let totalSpent = 0.0;
  let totalEstimate = 0.0;

  const projectBlocks = [];

  for (const project of projectOrder) {
    const tasksInProject = groupedProjects
      .filter((t) => t.Project === project)
      .sort((a, b) => a.Start_date.localeCompare(b.Start_date));

    if (!tasksInProject.length) continue;

    const projectPath = urlMap.get(project) || '';
    const taskRows = [];

    for (const row of tasksInProject) {
      const key = `${row.Project}:::${row.Task}:::${row.Type}`;
      const enriched = enrichmentMap.get(key) || {
        start_date: '',
        due_date: '',
        closed_date: '',
        estimate: '',
      };

      let url = '';
      if (projectPath) {
        const base = `${config.url}/${projectPath}/-/`;
        if (row.Type === 'TASK') {
          url = `${base}work_items/${row.Task}`;
        } else if (row.Type === 'MR') {
          url = `${base}merge_requests/${row.Task}`;
        }
      }

      let finalStart = '';
      let finalDue = '';
      let finalClosed = '';

      if (row.Type === 'MR') {
        finalStart = row.Start_date;
        finalDue = row.Start_date;
        finalClosed = row.Start_date;
      } else {
        finalStart = enriched.start_date || row.Start_date;
        finalDue = enriched.due_date;
        finalClosed = enriched.closed_date;
      }

      const finalEstimate = enriched.estimate;
      const spentNum = Number(row.Spent) || 0;

      totalTasks++;
      totalSpent += spentNum;
      if (finalEstimate) {
        const estNum = parseFloat(finalEstimate);
        if (Number.isFinite(estNum)) totalEstimate += estNum;
      }

      taskRows.push({
        Url: url,
        'Start date': finalStart,
        'Due date': finalDue,
        'Closed date': finalClosed,
        Estimate: finalEstimate,
        Spent: spentNum,
        'Reopen count': 0,
        'Task Type': DEFAULT_TASK_TYPE,
        Progress: DEFAULT_PROGRESS,
      });
    }

    projectBlocks.push({
      project,
      tasks: taskRows,
    });
  }

  const stats = {
    totalTasks,
    totalSpent: Number(totalSpent.toFixed(4)),
    totalEstimate: Number(totalEstimate.toFixed(4)),
  };

  return { projectBlocks, stats };
}

/**
 * Fill the Excel template with data and formulas matching report.py.
 */
export async function generateExcelWorkbook(templateBuffer, reportData, ExcelJS) {
  const {
    month,
    year,
    projectBlocks = [],
    offEntries = [],
  } = reportData;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);

  const sheet = workbook.getWorksheet('Báo cáo công việc');
  if (!sheet) {
    throw new Error('Không tìm thấy sheet "Báo cáo công việc" trong file mẫu.');
  }

  // Calculate last day of month
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  sheet.getCell('B2').value = `Tháng 01/${mm}/${year} - ${dd}/${mm}/${year}`;

  // Extract template row styles (columns 2..10, B..J)
  const styles = {
    4: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => JSON.parse(JSON.stringify(sheet.getRow(4).getCell(c).style || {}))),
    5: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => JSON.parse(JSON.stringify(sheet.getRow(5).getCell(c).style || {}))),
    6: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => JSON.parse(JSON.stringify(sheet.getRow(6).getCell(c).style || {}))),
  };

  const headers = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => sheet.getRow(5).getCell(c).value);
  const rowHeights = {
    4: sheet.getRow(4).height,
    5: sheet.getRow(5).height,
    6: sheet.getRow(6).height,
  };

  // Clear template rows 4, 5, 6
  for (let r = 4; r <= 6; r++) {
    const row = sheet.getRow(r);
    for (let c = 2; c <= 10; c++) {
      row.getCell(c).value = null;
    }
  }

  let nextRow = 4;

  function writeRow(values, styleRow) {
    const row = sheet.getRow(nextRow);
    if (rowHeights[styleRow]) {
      row.height = rowHeights[styleRow];
    }
    for (let i = 0; i < values.length; i++) {
      const col = i + 2;
      const cell = row.getCell(col);
      cell.style = JSON.parse(JSON.stringify(styles[styleRow][i]));
      const val = values[i];

      if (styleRow === 6) {
        if ((col === 3 || col === 4 || col === 5) && val instanceof Date) {
          cell.value = val;
          cell.numFmt = 'dd/mm/yyyy';
        } else if (col === 2 && typeof val === 'string' && (val.startsWith('https://') || val.startsWith('http://'))) {
          cell.value = { text: val, hyperlink: val };
        } else {
          cell.value = val !== undefined ? val : null;
        }
      } else {
        cell.value = val !== undefined ? val : null;
      }
    }
    nextRow++;
  }

  function writeData(taskRows) {
    for (const item of taskRows) {
      const parseDate = (d) => (d ? parseMonthDayYear(d) : null);
      const parseNum = (n) => (n !== '' && n !== null && n !== undefined && !Number.isNaN(Number(n)) ? Number(n) : null);

      const values = [
        item.Url || null,
        parseDate(item['Start date']),
        parseDate(item['Due date']),
        parseDate(item['Closed date']),
        parseNum(item.Estimate),
        parseNum(item.Spent),
        parseNum(item['Reopen count']) ?? 0,
        item['Task Type'] || DEFAULT_TASK_TYPE,
        item.Progress || DEFAULT_PROGRESS,
      ];
      writeRow(values, 6);
    }
  }

  for (const block of projectBlocks) {
    if (!block.tasks.length) continue;
    // Project title row
    writeRow([block.project, null, null, null, null, null, null, null, null], 4);
    // Table header row
    writeRow(headers, 5);
    // Task data rows
    writeData(block.tasks);
    // Blank separator
    nextRow++;
  }

  // Calculate formula ranges for project tasks
  const lastTaskRow = Math.max(nextRow - 1, 6);
  const taskTypes = `I6:I${lastTaskRow}`;

  sheet.getCell('M6').value = { formula: `COUNTIF(${taskTypes},"Kế hoạch")` };
  sheet.getCell('M7').value = { formula: `COUNTIF(${taskTypes},"Phát sinh")` };
  sheet.getCell('M5').value = { formula: 'M6+M7' };
  sheet.getCell('M9').value = { formula: `SUM(F6:F${lastTaskRow})` };
  sheet.getCell('M10').value = { formula: `SUM(G6:G${lastTaskRow})` };
  sheet.getCell('M11').value = { formula: 'M10-M12' };
  sheet.getCell('M12').value = { formula: `SUMIF(${taskTypes},"Phát sinh",G6:G${lastTaskRow})` };

  const criteria = [
    [13, 'C', ''],
    [14, 'D', ''],
    [15, 'F', ''],
    [16, 'G', ''],
    [17, 'J', 'Đúng hạn'],
    [18, 'J', 'Trễ hạn'],
    [20, 'H', '0'],
    [21, 'H', '>0'],
  ];

  for (const [cellRow, col, crit] of criteria) {
    const valRange = `${col}6:${col}${lastTaskRow}`;
    const formulaStr = `COUNTIFS(${taskTypes},"Kế hoạch",${valRange},"${crit}")+COUNTIFS(${taskTypes},"Phát sinh",${valRange},"${crit}")`;
    sheet.getCell(cellRow, 13).value = { formula: formulaStr };
  }

  // Wrap KPI calculation formulas with IFERROR(..., 0)
  for (const r of [25, 26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 39]) {
    const cell = sheet.getCell(`M${r}`);
    const originalFormula = cell.value?.formula || cell.formula;
    if (originalFormula) {
      cell.value = { formula: `IFERROR(${originalFormula},0)` };
    }
  }

  // Append OFF rows outside task formula ranges
  if (offEntries && offEntries.length > 0) {
    nextRow = Math.max(nextRow, 8);
    writeRow(['OFF', null, null, null, null, null, null, null, null], 4);
    writeRow(headers, 5);

    const offTasks = offEntries.map((off) => ({
      Url: off.Task,
      'Start date': off.Start_date,
      'Due date': '',
      'Closed date': '',
      Estimate: '',
      Spent: off.Spent,
      'Reopen count': 0,
      'Task Type': DEFAULT_TASK_TYPE,
      Progress: DEFAULT_PROGRESS,
    }));
    writeData(offTasks);
  }

  workbook.calcProperties.fullCalcOnLoad = true;
  return await workbook.xlsx.writeBuffer();
}
