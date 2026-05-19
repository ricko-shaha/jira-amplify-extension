/* ═══════ CONFIG ═══════ */

const ACTIVITY_CODE_MAP = { '201000': 1, '202010': 2, '203000': 10, '203020': 5, '204000': 5 };
const AMPLIFY_OFFSET_HOURS = 8;

function parseComment(comment, projectKey) {
  if (!comment) return { activityId: 1, description: '' };
  const m = comment.match(/^(\d{6})\s*(?:\(([^)]*)\))?(.*)$/s);
  if (m) return { activityId: ACTIVITY_CODE_MAP[m[1]] || 1, description: (m[2] || m[3] || '').trim() };
  if (comment.toLowerCase().includes('meeting')) return { activityId: projectKey === 'DSI' ? 12 : 11, description: comment };
  return { activityId: 1, description: comment };
}

function toAmplifyTime(jiraISO, secs) {
  const ms = new Date(jiraISO).getTime() + AMPLIFY_OFFSET_HOURS * 3600000;
  const s = new Date(ms), e = new Date(ms + secs * 1000);
  const f = (h, m) => { const a = h >= 12 ? 'PM' : 'AM'; return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${a}`; };
  const dh = Math.floor(secs / 3600), dm = Math.round((secs % 3600) / 60);
  return { start_date: s.toISOString().split('T')[0], start_time: f(s.getUTCHours(), s.getUTCMinutes()), end_time: f(e.getUTCHours(), e.getUTCMinutes()), duration: `${dh}:${String(dm).padStart(2, '0')}` };
}

function fmtDur(secs) {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseHHMM(d) { if (!d) return 0; const p = d.split(':'); return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0); }

function todayISO() {
  const n = new Date(), off = 6 * 60;
  return new Date(n.getTime() + (off + n.getTimezoneOffset()) * 60000).toISOString().split('T')[0];
}

/* ═══════ JIRA API ═══════ */

class JiraAPI {
  constructor(domain) { this.base = `https://${domain}`; this.uid = null; }

  async _req(method, path, body) {
    const o = { method, credentials: 'include', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } };
    if (body) o.body = JSON.stringify(body);
    const r = await fetch(this.base + path, o);
    if (r.status === 401) throw new Error('Not logged into Jira. Open Jira in a tab and log in first.');
    return { status: r.status, body: await r.json() };
  }

  async init() { const r = await this._req('GET', '/rest/api/3/myself'); this.uid = r.body.accountId; }

  async worklogs(startDate, endDate) {
    if (!this.uid) await this.init();
    const jql = `worklogAuthor=currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" ORDER BY key ASC`;
    let issues = [], npt;
    do {
      const p = { jql, maxResults: 50, fields: ['key', 'summary', 'project', 'worklog'] };
      if (npt) p.nextPageToken = npt;
      const r = await this._req('POST', '/rest/api/3/search/jql', p);
      if (r.status !== 200) throw new Error('Jira search failed: ' + r.status);
      issues.push(...(r.body.issues || []));
      npt = r.body.nextPageToken;
    } while (npt && issues.length % 50 === 0);

    const out = [];
    for (const iss of issues) {
      let wls = iss.fields?.worklog?.worklogs || [];
      if (iss.fields?.worklog?.total > iss.fields?.worklog?.maxResults) {
        const r = await this._req('GET', `/rest/api/3/issue/${iss.key}/worklog`);
        wls = r.body.worklogs || [];
      }
      for (const w of wls.filter(w => w.author?.accountId === this.uid)) {
        const d = new Date(w.started).toISOString().split('T')[0];
        if (d < startDate || d > endDate) continue;
        const c = typeof w.comment === 'string' ? w.comment : w.comment?.content?.map(b => b.content?.map(t => t.text).join('')).join('\n') || '';
        out.push({ issueKey: iss.key, summary: iss.fields?.summary, project: iss.fields?.project?.name, projectKey: iss.fields?.project?.key, started: w.started, timeSpentSeconds: w.timeSpentSeconds, comment: c });
      }
    }
    return out.sort((a, b) => new Date(a.started) - new Date(b.started));
  }

  async myTickets() {
    const fieldsRes = await this._req('GET', '/rest/api/3/field');
    const fields = fieldsRes.body;
    const devF = fields.find(f => f.name.toLowerCase() === 'developer' || f.name.toLowerCase() === 'developers');
    const sdF = fields.find(f => f.name === 'Start date (test)');
    if (!devF) throw new Error('Developer field not found in Jira');

    const statuses = ['Selected for Development', 'Development in Progress', 'Selected for Stabilization', 'Stabilization in progress'];
    const jql = `"${devF.name}" = currentUser() AND status in (${statuses.map(s => '"' + s + '"').join(', ')}) ORDER BY priority ASC, updated DESC`;
    const fetchFields = ['key', 'summary', 'status', 'priority', 'duedate', 'project', devF.id];
    if (sdF) fetchFields.push(sdF.id);

    let issues = [], npt;
    do {
      const p = { jql, maxResults: 50, fields: fetchFields };
      if (npt) p.nextPageToken = npt;
      const r = await this._req('POST', '/rest/api/3/search/jql', p);
      if (r.status !== 200) throw new Error('Jira search failed: ' + r.status);
      issues.push(...(r.body.issues || []));
      npt = r.body.nextPageToken;
    } while (npt);

    const PIPE = { 'stabilization in progress': 40, 'development in progress': 30, 'selected for stabilization': 20, 'selected for development': 10 };
    const PRIO = { highest: 20, high: 15, medium: 10, low: 5, lowest: 0 };

    return issues.map(i => {
      const status = i.fields?.status?.name || '';
      const prio = i.fields?.priority?.name || 'Medium';
      const sd = sdF ? i.fields?.[sdF.id] : null;
      const dd = i.fields?.duedate;
      let deadline = dd;
      if (sd) { const dt = new Date(sd); dt.setDate(dt.getDate() - 1); deadline = dt.toISOString().split('T')[0]; }

      let dlScore = 0;
      if (deadline) {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const du = new Date(deadline); du.setHours(0, 0, 0, 0);
        const days = Math.ceil((du - now) / 86400000);
        dlScore = days < 0 ? 40 : days === 0 ? 35 : days <= 3 ? 30 : days <= 7 ? 20 : days <= 14 ? 10 : 0;
      }

      const pipeW = PIPE[status.toLowerCase()] || 0;
      const prioW = PRIO[prio.toLowerCase()] || 10;
      const score = pipeW + dlScore + prioW;
      const daysLeft = deadline ? Math.ceil((new Date(deadline) - new Date(todayISO())) / 86400000) : null;

      return { ticket: i.key, summary: i.fields?.summary || '', project: i.fields?.project?.name || '', status, priority: prio, startDate: sd, deadline, daysLeft, score, breakdown: { pipeline: pipeW, deadline: dlScore, priority: prioW } };
    }).sort((a, b) => b.score - a.score);
  }
}

/* ═══════ AMPLIFY API ═══════ */

class AmplifyAPI {
  constructor(base) { this.base = base || 'https://amplify.echologyx.com'; this.xsrf = null; this.tcache = {}; }
  _df(iso) { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; }

  async _xsrf() {
    const c = await chrome.cookies.get({ url: this.base, name: 'XSRF-TOKEN' });
    if (c) this.xsrf = decodeURIComponent(c.value);
  }

  async login(email, pw) {
    const pg = await fetch(this.base + '/login', { credentials: 'include' });
    const html = await pg.text(); await this._xsrf();
    const tok = html.match(/name="_token"\s+value="([^"]+)"/);
    if (!tok) throw new Error('CSRF token not found on Amplify login page');
    const res = await fetch(this.base + '/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _token: tok[1], email, password: pw }).toString(), redirect: 'follow' });
    await this._xsrf();
    if (res.url.includes('/login')) throw new Error('Amplify login failed. Check email/password.');
  }

  async isLoggedIn() {
    try { const r = await fetch(this.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' }, redirect: 'follow' }); return r.ok && !r.url.includes('/login'); } catch { return false; }
  }

  async getTimesheets({ startDate, endDate, start = 0, length = 100 }) {
    const q = new URLSearchParams({ draw: '1', start: String(start), length: String(length), 'order[0][column]': '1', 'order[0][dir]': 'desc', 'order[1][column]': '2', 'order[1][dir]': 'desc', 'columns[0][data]': 'DT_RowIndex', 'columns[0][name]': 'DT_RowIndex', 'columns[1][data]': 'date', 'columns[1][name]': 'date', 'columns[2][data]': 'start_time', 'columns[2][name]': 'start_time', 'columns[3][data]': 'end_time', 'columns[3][name]': 'end_time', 'columns[4][data]': 'duration', 'columns[4][name]': 'duration', 'columns[5][data]': 'client', 'columns[5][name]': 'client', 'columns[6][data]': 'project', 'columns[6][name]': 'project', 'columns[7][data]': 'task', 'columns[7][name]': 'task', 'columns[8][data]': 'activity', 'columns[8][name]': 'activity', 'columns[9][data]': 'action', 'columns[9][name]': 'action', date_filter_type: 'custom', start_date: this._df(startDate), end_date: this._df(endDate) });
    await this._xsrf();
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (this.xsrf) h['X-XSRF-TOKEN'] = this.xsrf;
    const r = await fetch(this.base + '/timesheets?' + q, { credentials: 'include', headers: h });
    if (!r.ok) throw new Error('Amplify timesheets fetch failed: ' + r.status);
    return r.json();
  }

  async allTimesheets({ startDate, endDate }) {
    const all = []; let s = 0;
    while (true) { const r = await this.getTimesheets({ startDate, endDate, start: s, length: 100 }); const d = r.data || []; all.push(...d); if (d.length < 100 || all.length >= r.recordsFiltered) break; s += 100; }
    return all;
  }

  async _tokens() {
    await this._xsrf();
    const r = await fetch(this.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' } });
    const html = await r.text(); await this._xsrf();
    return { csrf: html.match(/name="_token"\s+value="([^"]+)"/)?.[1], userId: html.match(/name="user_id"[^>]*value="([^"]*)"/)?.[1] };
  }

  async createTimesheet(data) {
    const { csrf, userId } = await this._tokens();
    const p = { _token: csrf, user_id: userId, client_id: String(data.client_id), project_id: String(data.project_id), time_activity_id: String(data.time_activity_id), start_date: data.start_date, start_time: data.start_time, end_time: data.end_time, duration: data.duration, description: data.description || '' };
    if (data.task_id) p.task_id = String(data.task_id);
    if (data.task_name) { p.task_name = data.task_name; p.task_status_id = ''; }
    await this._xsrf();
    const h = { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: this.base + '/timesheets' };
    if (this.xsrf) h['X-XSRF-TOKEN'] = this.xsrf;
    const r = await fetch(this.base + '/timesheets', { method: 'POST', credentials: 'include', headers: h, body: new URLSearchParams(p).toString() });
    await this._xsrf();
    if (!r.ok) throw new Error('Create failed: ' + r.status);
  }

  async lookupProject(prefix) {
    const now = new Date(), end = now.toISOString().split('T')[0]; const s = new Date(now); s.setDate(s.getDate() - 90);
    const r = await this.getTimesheets({ startDate: s.toISOString().split('T')[0], endDate: end, start: 0, length: 200 });
    for (const e of (r.data || [])) { const k = this.taskKey(e.task); if (k && k.startsWith(prefix + '-')) return { project_id: e.project_id, project_name: e.project, client_id: e.client_id }; }
    return null;
  }

  async lookupTask(projId, key) {
    const ck = String(projId);
    if (!this.tcache[ck]) {
      await this._xsrf(); const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }; if (this.xsrf) h['X-XSRF-TOKEN'] = this.xsrf;
      const r = await fetch(this.base + '/tasks/projects?project_id=' + projId, { credentials: 'include', headers: h });
      this.tcache[ck] = r.ok ? await r.json() : {};
    }
    for (const [id, name] of Object.entries(this.tcache[ck])) { if (name === key || name.startsWith(key + ' ') || name.startsWith(key + '|')) return parseInt(id); }
    return null;
  }

  taskKey(html) { if (!html) return null; const m = html.match(/<p[^>]*class="task-wrap"[^>]*>(.*?)<\/p>/); const raw = m ? m[1].trim() : html.trim(); const k = raw.match(/^([A-Z]+-\d+)/); return k ? k[1] : null; }
}

/* ═══════ UI ═══════ */

let jira, amp, settings;

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById(name + '-view').style.display = 'block';
  if (name === 'sync' && jira) runSync(document.querySelector('.toolbar .btn.active')?.dataset.mode || 'today');
  if (name === 'priority' && jira) runPriority();
  if (name === 'remind' && jira) runRemind();
}

function status(id, type, msg) { const el = document.getElementById(id); el.className = 'status-box ' + type; el.innerHTML = msg; el.style.display = 'block'; }
function clearStatus(id) { document.getElementById(id).style.display = 'none'; }

function dateRange(mode) {
  const t = todayISO();
  if (mode === 'today') return { start: t, end: t };
  if (mode === 'yesterday') { const d = new Date(t); d.setDate(d.getDate() - 1); const s = d.toISOString().split('T')[0]; return { start: s, end: s }; }
  const d = new Date(t); d.setDate(d.getDate() - 6); return { start: d.toISOString().split('T')[0], end: t };
}

async function ensureAmplify() {
  if (!(await amp.isLoggedIn())) await amp.login(settings.amplifyEmail, settings.amplifyPassword);
}

/* ── Sync ── */

async function runSync(mode) {
  const { start, end } = dateRange(mode);
  const box = 'sync-status', out = document.getElementById('sync-results');
  out.innerHTML = '';
  try {
    status(box, 'loading', '<span class="spinner"></span>Checking Jira session...');
    await jira.init();
    status(box, 'loading', '<span class="spinner"></span>Logging into Amplify...');
    await ensureAmplify();
    status(box, 'loading', '<span class="spinner"></span>Fetching worklogs...');
    const jw = await jira.worklogs(start, end);
    status(box, 'loading', '<span class="spinner"></span>Fetching Amplify timesheets...');
    const ae = await amp.allTimesheets({ startDate: start, endDate: end });

    status(box, 'loading', '<span class="spinner"></span>Analyzing...');
    const projCache = {}, taskCacheLocal = {};
    const toCreate = [], conflicts = [], synced = [], unmapped = [];
    for (const e of ae) { const k = amp.taskKey(e.task); if (k) { const pfx = k.split('-')[0]; if (!projCache[pfx]) projCache[pfx] = { project_id: e.project_id, project_name: e.project, client_id: e.client_id }; if (e.task_id) taskCacheLocal[k] = e.task_id; } }

    for (const wl of jw) {
      const t = toAmplifyTime(wl.started, wl.timeSpentSeconds);
      const { activityId, description } = parseComment(wl.comment, wl.projectKey);
      const matches = ae.filter(e => amp.taskKey(e.task) === wl.issueKey && e.start_date === t.start_date);
      if (matches.length > 0) {
        if (matches.some(e => Math.abs(parseHHMM(e.duration_in_time) - Math.round(wl.timeSpentSeconds / 60)) <= 5)) { synced.push({ ticket: wl.issueKey, summary: wl.summary, duration: fmtDur(wl.timeSpentSeconds), date: t.start_date }); }
        else { conflicts.push({ ticket: wl.issueKey, summary: wl.summary, date: t.start_date, jiraDur: fmtDur(wl.timeSpentSeconds), ampDur: matches[0].duration_in_time }); }
        continue;
      }
      let proj = projCache[wl.projectKey] || await amp.lookupProject(wl.projectKey);
      if (proj) projCache[wl.projectKey] = proj;
      if (!proj) { unmapped.push({ ticket: wl.issueKey, summary: wl.summary, date: t.start_date, duration: fmtDur(wl.timeSpentSeconds), reason: `Project "${wl.projectKey}" not found` }); continue; }
      let taskId = taskCacheLocal[wl.issueKey] || await amp.lookupTask(proj.project_id, wl.issueKey);
      if (taskId) taskCacheLocal[wl.issueKey] = taskId;
      toCreate.push({ ticket: wl.issueKey, summary: wl.summary, project: proj.project_name, date: t.start_date, startTime: t.start_time, endTime: t.end_time, duration: t.duration, durationDisplay: fmtDur(wl.timeSpentSeconds), activityId, description, projectId: proj.project_id, clientId: proj.client_id, taskId, taskName: `${wl.issueKey} | ${wl.summary}` });
    }

    clearStatus(box);
    let html = '';
    if (toCreate.length) {
      html += `<div class="section-title">To Create <span class="badge badge-blue">${toCreate.length}</span></div><table><tr><th>Ticket</th><th>Project</th><th>Summary</th><th>Date</th><th>Duration</th></tr>`;
      toCreate.forEach(e => { html += `<tr><td><strong>${e.ticket}</strong></td><td>${e.project}</td><td>${e.summary}</td><td>${e.date}</td><td>${e.durationDisplay}</td></tr>`; });
      html += `</table><button class="btn btn-primary" id="do-sync">Sync ${toCreate.length} entries to Amplify</button>`;
    }
    if (conflicts.length) {
      html += `<div class="section-title">Conflicts <span class="badge badge-yellow">${conflicts.length}</span></div><table><tr><th>Ticket</th><th>Date</th><th>Amplify</th><th>Jira</th></tr>`;
      conflicts.forEach(c => { html += `<tr><td><strong>${c.ticket}</strong></td><td>${c.date}</td><td>${c.ampDur}</td><td>${c.jiraDur}</td></tr>`; });
      html += '</table>';
    }
    if (synced.length) {
      html += `<div class="section-title">Already Synced <span class="badge badge-green">${synced.length}</span></div><table><tr><th>Ticket</th><th>Summary</th><th>Date</th><th>Duration</th></tr>`;
      synced.forEach(e => { html += `<tr><td><strong>${e.ticket}</strong></td><td>${e.summary}</td><td>${e.date}</td><td>${e.duration}</td></tr>`; });
      html += '</table>';
    }
    if (unmapped.length) {
      html += `<div class="section-title">Unmapped <span class="badge badge-red">${unmapped.length}</span></div><table><tr><th>Ticket</th><th>Reason</th><th>Date</th><th>Duration</th></tr>`;
      unmapped.forEach(e => { html += `<tr><td><strong>${e.ticket}</strong></td><td>${e.reason}</td><td>${e.date}</td><td>${e.duration}</td></tr>`; });
      html += '</table>';
    }
    if (!toCreate.length && !conflicts.length && !unmapped.length) status(box, 'success', `All ${synced.length} entries are synced.`);
    out.innerHTML = html;

    if (document.getElementById('do-sync')) {
      document.getElementById('do-sync').addEventListener('click', async function () {
        this.disabled = true; this.textContent = 'Syncing...';
        let ok = 0, fail = 0;
        for (const e of toCreate) {
          try {
            const p = { project_id: e.projectId, client_id: e.clientId, start_date: e.date, start_time: e.startTime, end_time: e.endTime, duration: e.duration, time_activity_id: e.activityId, description: e.description };
            if (e.taskId) p.task_id = e.taskId; else p.task_name = e.taskName;
            await amp.createTimesheet(p); ok++;
          } catch { fail++; }
        }
        status(box, fail ? 'error' : 'success', fail ? `${ok} created, ${fail} failed.` : `Successfully synced ${ok} entries.`);
        this.textContent = 'Done'; setTimeout(() => runSync(mode), 1500);
      });
    }
  } catch (err) { status(box, 'error', err.message); }
}

/* ── Priority ── */

async function runPriority() {
  const box = 'priority-status', out = document.getElementById('priority-results');
  out.innerHTML = '';
  try {
    status(box, 'loading', '<span class="spinner"></span>Fetching priority data...');
    const tickets = await jira.myTickets();
    clearStatus(box);
    if (!tickets.length) { status(box, 'success', 'No tickets assigned to you in the active pipeline.'); return; }

    const statusMap = { 'Development in Progress': '🔨 Dev In Progress', 'Selected for Development': '📋 Selected for Dev', 'Stabilization in progress': '🧪 Stabilizing', 'Selected for Stabilization': '📋 Selected for Stab' };
    const dlLabel = (d) => { if (d === null) return '—'; if (d < 0) return `<span class="badge badge-red">${Math.abs(d)}d overdue</span>`; if (d === 0) return '<span class="badge badge-red">Today</span>'; if (d <= 3) return `<span class="badge badge-yellow">in ${d}d</span>`; if (d <= 7) return `<span class="badge badge-yellow">in ${d}d</span>`; return `<span class="badge badge-green">in ${d}d</span>`; };

    let html = `<table><tr><th>#</th><th>Score</th><th>Ticket</th><th>Project</th><th>Summary</th><th>Status</th><th>Deadline</th><th>Priority</th></tr>`;
    tickets.forEach((t, i) => {
      html += `<tr><td>${i + 1}</td><td><strong>${t.score}</strong><div style="margin-top:2px"><span class="score-bar" style="width:${t.score}px"></span></div></td><td><strong>${t.ticket}</strong></td><td>${t.project}</td><td>${t.summary}</td><td>${statusMap[t.status] || t.status}</td><td>${dlLabel(t.daysLeft)}</td><td>${t.priority}</td></tr>`;
    });
    html += '</table><p style="margin-top:12px;color:#6b778c;font-size:12px"><strong>Score:</strong> Pipeline (0-40) + Deadline (0-40) + Priority (0-20) = max 100</p>';
    out.innerHTML = html;
  } catch (err) { status(box, 'error', err.message); }
}

/* ── Remind ── */

async function runRemind() {
  const box = 'remind-status', out = document.getElementById('remind-results');
  out.innerHTML = '';
  const today = todayISO();
  try {
    status(box, 'loading', '<span class="spinner"></span>Checking timelog status...');
    await jira.init();
    await ensureAmplify();
    const jw = await jira.worklogs(today, today);
    const ae = await amp.allTimesheets({ startDate: today, endDate: today });

    clearStatus(box);
    const jiraByTicket = {}, ampByTicket = {};
    for (const w of jw) { const t = toAmplifyTime(w.started, w.timeSpentSeconds); if (t.start_date !== today) continue; if (!jiraByTicket[w.issueKey]) jiraByTicket[w.issueKey] = { summary: w.summary, secs: 0 }; jiraByTicket[w.issueKey].secs += w.timeSpentSeconds; }
    for (const e of ae) { if (e.start_date !== today) continue; const k = amp.taskKey(e.task); if (!k) continue; if (!ampByTicket[k]) ampByTicket[k] = { mins: 0 }; ampByTicket[k].mins += parseHHMM(e.duration_in_time); }

    const missing = [], mismatched = [], matched = [];
    for (const [k, v] of Object.entries(jiraByTicket)) {
      const a = ampByTicket[k]; const jm = Math.round(v.secs / 60);
      if (!a) missing.push({ ticket: k, summary: v.summary, dur: fmtDur(v.secs) });
      else if (Math.abs(jm - a.mins) > 5) mismatched.push({ ticket: k, summary: v.summary, jira: fmtDur(v.secs), amp: `${Math.floor(a.mins / 60)}h${a.mins % 60 > 0 ? ' ' + (a.mins % 60) + 'm' : ''}` });
      else matched.push({ ticket: k, summary: v.summary, dur: fmtDur(v.secs) });
    }
    const ampOnly = Object.keys(ampByTicket).filter(k => !jiraByTicket[k]);
    const jiraTotal = Object.values(jiraByTicket).reduce((s, v) => s + v.secs, 0);
    const ampTotal = Object.values(ampByTicket).reduce((s, v) => s + v.mins, 0);

    if (!Object.keys(jiraByTicket).length && !Object.keys(ampByTicket).length) { status(box, 'error', `No timelogs for today (${today}). Time to start logging!`); return; }
    if (!missing.length && !mismatched.length && !ampOnly.length) {
      const short = 450 - Math.round(jiraTotal / 60);
      if (short > 15) status(box, 'loading', `Underlogged: ${fmtDur(jiraTotal)} logged (expected 7h 30m). ${fmtDur(short * 60)} short. All entries match.`);
      else status(box, 'success', `Timelogs look good! ${fmtDur(jiraTotal)} logged. All ${matched.length} entries matched.`);
      return;
    }

    let html = `<p style="margin-bottom:16px"><strong>Jira:</strong> ${fmtDur(jiraTotal)} | <strong>Amplify:</strong> ${fmtDur(ampTotal * 60)} | <strong>Expected:</strong> 7h 30m</p>`;
    if (missing.length) {
      html += `<div class="section-title">Missing from Amplify <span class="badge badge-red">${missing.length}</span></div><table><tr><th>Ticket</th><th>Summary</th><th>Jira Duration</th></tr>`;
      missing.forEach(e => { html += `<tr><td><strong>${e.ticket}</strong></td><td>${e.summary}</td><td>${e.dur}</td></tr>`; });
      html += '</table>';
    }
    if (mismatched.length) {
      html += `<div class="section-title">Duration Mismatches <span class="badge badge-yellow">${mismatched.length}</span></div><table><tr><th>Ticket</th><th>Summary</th><th>Jira</th><th>Amplify</th></tr>`;
      mismatched.forEach(e => { html += `<tr><td><strong>${e.ticket}</strong></td><td>${e.summary}</td><td>${e.jira}</td><td>${e.amp}</td></tr>`; });
      html += '</table>';
    }
    status(box, 'error', `${missing.length + mismatched.length} issues found. Run Sync to fix.`);
    out.innerHTML = html;
  } catch (err) { status(box, 'error', err.message); }
}

/* ═══════ INIT ═══════ */

document.addEventListener('DOMContentLoaded', async () => {
  settings = await chrome.storage.local.get(['jiraDomain', 'amplifyEmail', 'amplifyPassword']);

  // Nav
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  // Settings
  if (settings.jiraDomain) document.getElementById('jira-domain').value = settings.jiraDomain;
  if (settings.amplifyEmail) document.getElementById('amplify-email').value = settings.amplifyEmail;
  if (settings.amplifyPassword) document.getElementById('amplify-password').value = settings.amplifyPassword;

  document.getElementById('save-settings').addEventListener('click', async () => {
    const jd = document.getElementById('jira-domain').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const ae = document.getElementById('amplify-email').value.trim();
    const ap = document.getElementById('amplify-password').value;
    if (!jd || !ae || !ap) { alert('Please fill all fields'); return; }
    await chrome.storage.local.set({ jiraDomain: jd, amplifyEmail: ae, amplifyPassword: ap });
    settings = { jiraDomain: jd, amplifyEmail: ae, amplifyPassword: ap };
    jira = new JiraAPI(jd); amp = new AmplifyAPI();
    const msg = document.getElementById('save-msg'); msg.style.display = 'inline'; setTimeout(() => msg.style.display = 'none', 2000);
  });

  // Toolbar
  document.querySelectorAll('.toolbar .btn').forEach(b => {
    b.addEventListener('click', () => { document.querySelectorAll('.toolbar .btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); runSync(b.dataset.mode); });
  });

  // Init
  if (!settings.jiraDomain || !settings.amplifyEmail || !settings.amplifyPassword) {
    showView('settings');
    return;
  }

  jira = new JiraAPI(settings.jiraDomain);
  amp = new AmplifyAPI();
  var hash = window.location.hash.replace('#', '');
  showView(['sync', 'priority', 'remind', 'settings'].includes(hash) ? hash : 'sync');
});
