var JIRA_DOMAIN = null;

function detectJiraDomain() {
  return chrome.cookies.getAll({ domain: '.atlassian.net' }).then(function(cookies) {
    var domains = {};
    cookies.forEach(function(c) {
      var d = c.domain.replace(/^\./, '');
      if (d.endsWith('.atlassian.net') && !d.startsWith('id.') && !d.startsWith('auth.') && !d.startsWith('api.')) {
        domains[d] = (domains[d] || 0) + 1;
      }
    });
    // Pick the domain with the most cookies (most likely the active Jira site)
    var best = null, bestCount = 0;
    Object.keys(domains).forEach(function(d) {
      if (domains[d] > bestCount) { best = d; bestCount = domains[d]; }
    });
    return best;
  });
}

function ticketLink(key) {
  if (!key || key === '?' || key === '—') return key || '—';
  if (!/^[A-Z]+-\d+$/.test(key)) return key;
  return '<a href="https://' + (JIRA_DOMAIN || 'driperium.atlassian.net') + '/browse/' + key + '" target="_blank" style="color:#e8734a;text-decoration:none;font-weight:600">' + key + '</a>';
}

/* ═══ Config ═══ */
var userCodeMap = {};
var userPatterns = [];
var defaultActivityId = 1;
var amplifyActivities = [];
var amplifyProjects = [];
var userProjectMap = {}; // e.g. { "VET": { project_id: 609, client_id: 52 } }
var userTaskMap = {}; // e.g. { "DSI-52": { project_id: 321, client_id: 52, activityId: 12 } }

var actNameFallback = { 1: 'Frontend Development', 2: 'Frontend Dev - Bug Fix', 3: 'Frontend Dev - New/Change', 5: 'Dev - Peer Review', 6: 'Dev - Tool Setup', 7: 'Hours Estimation', 8: 'Feasibility Test', 10: 'Investigation', 11: 'Meeting - Client', 12: 'Meeting - Internal', 15: 'Frontend QA', 17: 'Frontend Re-QA', 18: 'Support', 34: 'Frontend Dev - R&D', 113: 'Client Communication' };
function actName(id) {
  var a = amplifyActivities.find(function(x) { return x.id === id; });
  if (a) return a.name;
  return actNameFallback[id] || 'Activity ' + id;
}

function parseComment(c, pk) {
  if (!c) return { activityId: defaultActivityId, description: '' };
  c = c.trim();
  // Priority 1: numeric code at start
  var m = c.match(/^(\d{3,6})\s*(?:\(([^)]*)\))?(.*)$/s);
  if (m) {
    var code = m[1];
    var desc = (m[2] || m[3] || '').trim();
    var aid = userCodeMap[code];
    if (aid) return { activityId: aid, description: desc };
    // Code found but not mapped — try auto-match the text part, else default
    var autoFromDesc = autoMatchActivity(desc);
    return { activityId: autoFromDesc || defaultActivityId, description: desc };
  }
  // Priority 2: user-defined text patterns (first match wins)
  var lower = c.toLowerCase();
  for (var i = 0; i < userPatterns.length; i++) {
    var p = userPatterns[i];
    if (!p.pattern) continue;
    try {
      if (lower.match(new RegExp(p.pattern, 'i'))) return { activityId: p.activityId, description: c };
    } catch (e) {
      if (lower.indexOf(p.pattern.toLowerCase()) !== -1) return { activityId: p.activityId, description: c };
    }
  }
  // Priority 3: auto-match description against Amplify activity names
  var autoId = autoMatchActivity(c);
  if (autoId) return { activityId: autoId, description: c };
  // Priority 4: default
  return { activityId: defaultActivityId, description: c };
}

function autoMatchActivity(text) {
  if (!text || amplifyActivities.length === 0) {
    // Fallback keywords when activities aren't loaded yet
    var kw = { 'meeting': 12, 'investigation': 10, 'feasibility': 8, 'peer review': 5, 'bug fix': 2, 'qa': 15, 'documentation': 102, 'support': 18, 'training': 20, 'devops': 49 };
    var tl = text.toLowerCase();
    for (var k in kw) { if (tl.indexOf(k) !== -1) return kw[k]; }
    return null;
  }
  var tl = text.toLowerCase();
  var bestMatch = null, bestLen = 0;
  amplifyActivities.forEach(function(a) {
    var name = a.name.toLowerCase();
    // Check if activity name appears in description or description keyword appears in activity name
    if (tl.indexOf(name) !== -1 || name.indexOf(tl.split(' ')[0]) !== -1) {
      if (name.length > bestLen) { bestMatch = a.id; bestLen = name.length; }
    }
    // Also check individual significant words (3+ chars)
    name.split(/[\s\-\/]+/).forEach(function(word) {
      if (word.length >= 4 && tl.indexOf(word) !== -1 && word.length > bestLen) {
        bestMatch = a.id; bestLen = word.length;
      }
    });
  });
  return bestMatch;
}
function fmt12(h, m) { var a = h >= 12 ? 'PM' : 'AM'; return (h === 0 ? 12 : h > 12 ? h - 12 : h) + ':' + String(m).padStart(2, '0') + ' ' + a; }
function toAmpTime(iso, secs) {
  var date = iso.split('T')[0];
  var dh = Math.floor(secs / 3600), dm = Math.round((secs % 3600) / 60);
  return { start_date: date, start_time: '', end_time: '', duration: dh + ':' + String(dm).padStart(2, '0') };
}
function assignSequentialTimes(worklogs) {
  var byDate = {};
  worklogs.forEach(function(wl) {
    var date = wl.started.split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(wl);
  });
  Object.keys(byDate).forEach(function(date) {
    var dayWls = byDate[date].sort(function(a, b) { return new Date(a.started) - new Date(b.started); });
    var cursor = 14 * 60; // 2:00 PM
    dayWls.forEach(function(wl) {
      var durMins = Math.round(wl.timeSpentSeconds / 60);
      var sH = Math.floor(cursor / 60), sM = cursor % 60;
      var endCursor = cursor + durMins;
      var eH = Math.floor(endCursor / 60) % 24, eM = endCursor % 60;
      var dh = Math.floor(wl.timeSpentSeconds / 3600), dm = Math.round((wl.timeSpentSeconds % 3600) / 60);
      wl._amp = { start_date: date, start_time: fmt12(sH, sM), end_time: fmt12(eH, eM), duration: dh + ':' + String(dm).padStart(2, '0') };
      cursor = endCursor;
    });
  });
}
function fd(secs) { var h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); return h === 0 ? m + 'm' : m === 0 ? h + 'h' : h + 'h ' + m + 'm'; }
function phm(d) { if (!d) return 0; var p = d.split(':'); return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0); }
function today() { var n = new Date(); return new Date(n.getTime() + (360 + n.getTimezoneOffset()) * 60000).toISOString().split('T')[0]; }

/* ═══ Jira ═══ */
function Jira(domain) { this.base = 'https://' + domain; this.uid = null; }
Jira.prototype._r = function(method, path, body) {
  var o = { method: method, credentials: 'include', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } };
  if (body) o.body = JSON.stringify(body);
  var base = this.base;
  return fetch(base + path, o).then(function(r) { if (r.status === 401) throw new Error('Not logged into Jira. Log in first.'); return r.json().then(function(b) { return { status: r.status, body: b }; }); });
};
Jira.prototype.init = function() { var self = this; return this._r('GET', '/rest/api/3/myself').then(function(r) { self.uid = r.body.accountId; }); };
Jira.prototype.worklogs = function(sd, ed) {
  var self = this;
  function go() {
    var jql = 'worklogAuthor=currentUser() AND worklogDate >= "' + sd + '" AND worklogDate <= "' + ed + '" ORDER BY key ASC';
    var issues = [], npt;
    function page() {
      var p = { jql: jql, maxResults: 50, fields: ['key', 'summary', 'project', 'worklog'] };
      if (npt) p.nextPageToken = npt;
      return self._r('POST', '/rest/api/3/search/jql', p).then(function(r) {
        if (r.status !== 200) throw new Error('Jira search failed');
        var iss = r.body.issues || []; issues = issues.concat(iss); npt = r.body.nextPageToken;
        if (npt && iss.length >= 50) return page();
        return issues;
      });
    }
    return page().then(function(issues) {
      var out = [], chain = Promise.resolve();
      issues.forEach(function(iss) {
        chain = chain.then(function() {
          var wls = iss.fields && iss.fields.worklog ? iss.fields.worklog.worklogs || [] : [];
          var prom = (iss.fields && iss.fields.worklog && iss.fields.worklog.total > iss.fields.worklog.maxResults)
            ? self._r('GET', '/rest/api/3/issue/' + iss.key + '/worklog').then(function(r) { return r.body.worklogs || []; })
            : Promise.resolve(wls);
          return prom.then(function(wls) {
            wls.forEach(function(w) {
              if (!w.author || w.author.accountId !== self.uid) return;
              var d = new Date(w.started).toISOString().split('T')[0];
              if (d < sd || d > ed) return;
              var c = typeof w.comment === 'string' ? w.comment : (w.comment && w.comment.content ? w.comment.content.map(function(b) { return b.content ? b.content.map(function(t) { return t.text; }).join('') : ''; }).join('\n') : '');
              out.push({ issueKey: iss.key, summary: iss.fields.summary, project: iss.fields.project.name, projectKey: iss.fields.project.key, started: w.started, timeSpentSeconds: w.timeSpentSeconds, comment: c });
            });
          });
        });
      });
      return chain.then(function() { return out.sort(function(a, b) { return new Date(a.started) - new Date(b.started); }); });
    });
  }
  return (self.uid ? Promise.resolve() : self.init()).then(go);
};
Jira.prototype.myTickets = function() {
  var self = this;
  var initP = self.uid ? Promise.resolve() : self.init();
  return initP.then(function() { return self._r('GET', '/rest/api/3/field'); }).then(function(fr) {
    if (!fr || !fr.body || !Array.isArray(fr.body)) throw new Error('Failed to fetch Jira fields');
    var fields = fr.body;
    var roleFields = ['developer', 'developers', 'designer', 'designers', 'qa engineer', 'qa engineers', 'e-com manager', 'e-com managers', 'ecom manager', 'ecom managers'];
    var matchedFields = fields.filter(function(f) { return roleFields.indexOf(f.name.toLowerCase()) !== -1; });
    if (!matchedFields.length) throw new Error('No role fields (Developer/Designer/QA/E-com) found');
    var sdF = fields.find(function(f) { return f.name === 'Start date (test)'; });
    var jqlParts = matchedFields.map(function(f) { return '"' + f.name + '" = currentUser()'; });
    var jql = '(' + jqlParts.join(' OR ') + ') AND status NOT IN (Done, "Won\'t Do", "Selected for Setup Validation", "Setup Validation in Progress", "Ready to Launch")';
    var ff = ['key', 'summary', 'status', 'priority', 'duedate', 'project', 'labels', 'issuetype', 'customfield_10021'];
    matchedFields.forEach(function(f) { ff.push(f.id); });
    if (sdF) ff.push(sdF.id);
    // Fetch swimlanes per role — auto-detect boards (paginated)
    var boardsP = (function fetchAllBoards(startAt, all) {
      return self._r('GET', '/rest/agile/1.0/board?type=kanban&maxResults=50&startAt=' + startAt).then(function(br) {
        var vals = br.body.values || [];
        all = all.concat(vals);
        if (vals.length >= 50 && all.length < (br.body.total || 999)) return fetchAllBoards(startAt + 50, all);
        return all;
      });
    })(0, []).then(function(boards) {
      function findBoard(keyword) {
        var b = boards.find(function(b) { return b.name.toLowerCase().indexOf(keyword) !== -1; });
        return b ? b.id : null;
      }
      var ids = { developer: findBoard('development pipeline'), qa: findBoard('quality assurance'), designer: findBoard('design master') };
      var uniqueIds = [];
      Object.values(ids).forEach(function(id) { if (id && uniqueIds.indexOf(id) === -1) uniqueIds.push(id); });
      if (!uniqueIds.length) return { boardIds: ids, laneMap: {}, colWeightMap: {} };
      return Promise.all(uniqueIds.map(function(id) {
        return Promise.all([
          self._r('GET', '/rest/greenhopper/1.0/swimlanes/' + id).then(function(sr) {
            return (sr.body.swimlaneEntries || []).sort(function(a, b) { return a.position - b.position; });
          }).catch(function() { return []; }),
          self._r('GET', '/rest/agile/1.0/board/' + id + '/configuration').then(function(cr) {
            var cols = (cr.body.columnConfig || {}).columns || [];
            var weights = {}, n = cols.length;
            cols.forEach(function(col, idx) {
              var w = n > 1 ? Math.round(25 * idx / (n - 1)) : 0;
              (col.statuses || []).forEach(function(s) { weights[s.id] = w; });
            });
            return weights;
          }).catch(function() { return {}; })
        ]).then(function(r) { return { id: id, lanes: r[0], colWeights: r[1] }; });
      })).then(function(results) {
        var laneMap = {}, colWeightMap = {};
        results.forEach(function(r) { laneMap[r.id] = r.lanes; colWeightMap[r.id] = r.colWeights; });
        return { boardIds: ids, laneMap: laneMap, colWeightMap: colWeightMap };
      });
    }).catch(function() { return { boardIds: {}, laneMap: {}, colWeightMap: {} }; });

    return Promise.all([
      self._r('POST', '/rest/api/3/search/jql', { jql: jql, maxResults: 50, fields: ff }),
      boardsP
    ]).then(function(results) {
      var r = results[0], boardData = results[1];
      if (r.status !== 200) throw new Error('Search failed');

      // Helper: get lane scores for a set of swimlanes
      function getLaneScores(lanes) {
        return lanes.map(function(s, idx) {
          return Math.max(2, Math.round(30 - (idx * 28 / Math.max(1, lanes.length - 1))));
        });
      }

      // Pipeline weight is now dynamic from board column position (see colWeightMap)
      var PRIO = { highest: 15, high: 12, medium: 8, low: 3, lowest: 0 };

      var issues = r.body.issues || [];
      var issueKeys = issues.map(function(i) { return i.key; });
      if (!issueKeys.length) return [];

      // Determine each ticket's role first (needed for board selection)
      var roleByTicket = {};
      issues.forEach(function(i) {
        var role = '';
        matchedFields.forEach(function(f) {
          var val = i.fields[f.id];
          if (!val) return;
          var users = Array.isArray(val) ? val : [val];
          if (users.some(function(u) { return u && u.accountId === self.uid; })) { if (!role) role = f.name; }
        });
        roleByTicket[i.key] = role;
      });

      // Group tickets by board based on role
      var ticketsByBoard = {};
      issueKeys.forEach(function(key) {
        var rl = (roleByTicket[key] || '').toLowerCase();
        var bid = null;
        if (rl.indexOf('developer') !== -1) bid = boardData.boardIds.developer;
        else if (rl.indexOf('qa') !== -1) bid = boardData.boardIds.qa;
        else if (rl.indexOf('designer') !== -1 || rl.indexOf('e-com') !== -1 || rl.indexOf('ecom') !== -1) bid = boardData.boardIds.designer;
        else bid = boardData.boardIds.developer;
        if (bid) {
          if (!ticketsByBoard[bid]) ticketsByBoard[bid] = [];
          ticketsByBoard[bid].push(key);
        }
      });

      var boardByTicket = {};
      Object.keys(ticketsByBoard).forEach(function(bid) {
        ticketsByBoard[bid].forEach(function(key) { boardByTicket[key] = bid; });
      });

      // For each board, run each swimlane's JQL scoped to our tickets to find matches
      var laneByTicket = {};
      var laneChain = Promise.resolve();
      Object.keys(ticketsByBoard).forEach(function(bid) {
        var lanes = boardData.laneMap[bid] || [];
        var scores = getLaneScores(lanes);
        var keys = ticketsByBoard[bid];
        var keyFilter = 'key in (' + keys.join(',') + ')';
        lanes.forEach(function(lane, idx) {
          if (lane.isDefault) return;
          var q = (lane.query || '').trim();
          if (!q) return;
          laneChain = laneChain.then(function() {
            var fullJql = '(' + q + ') AND ' + keyFilter;
            return self._r('POST', '/rest/api/3/search/jql', { jql: fullJql, maxResults: 100, fields: ['key'] }).then(function(sr) {
              (sr.body.issues || []).forEach(function(mi) {
                if (!laneByTicket[mi.key]) laneByTicket[mi.key] = { lane: lane, score: scores[idx] || 2 };
              });
            }).catch(function() {}); // skip if JQL fails for this lane
          });
        });
      });

      return laneChain.then(function() {
      // New formula: Lane(0-30) + Pipeline stage(0-25) + Deadline(0-50) + Jira priority(0-15) = max ~120
      return issues.map(function(i) {
        var st = i.fields.status ? i.fields.status.name : '', pr = i.fields.priority ? i.fields.priority.name : 'Medium';
        var sd2 = sdF ? i.fields[sdF.id] : null, dd = i.fields.duedate, dl = dd;
        if (sd2) { var dt = new Date(sd2); dt.setDate(dt.getDate() - 1); dl = dt.toISOString().split('T')[0]; }

        // Deadline score (0-50)
        var ds = 0;
        if (dl) {
          var now = new Date(); now.setHours(0,0,0,0);
          var du = new Date(dl); du.setHours(0,0,0,0);
          var days = Math.ceil((du - now) / 86400000);
          if (days <= -30) ds = 50;
          else if (days <= -14) ds = 45;
          else if (days < 0) ds = 35 + Math.min(10, Math.round(Math.abs(days) * 1.4));
          else if (days === 0) ds = 35;
          else if (days === 1) ds = 30;
          else if (days <= 3) ds = 25;
          else if (days <= 5) ds = 18;
          else if (days <= 7) ds = 12;
          else if (days <= 14) ds = 6;
          else ds = 0;
        }

        // Swimlane score — lookup from pre-resolved map
        var lane = null, laneScore = 2;
        var ticketLane = laneByTicket[i.key];
        if (ticketLane) { lane = ticketLane.lane; laneScore = ticketLane.score; }

        var statusId = i.fields.status ? i.fields.status.id : '';
        var bid = boardByTicket[i.key];
        var colWeights = boardData.colWeightMap[bid] || {};
        var pw = colWeights[statusId] !== undefined ? colWeights[statusId] : 3;
        var prw = PRIO[(pr || '').toLowerCase()] || 8;
        var dLeft = dl ? Math.ceil((new Date(dl) - new Date(today())) / 86400000) : null;
        var role = roleByTicket[i.key] || '';

        return { ticket: i.key, summary: i.fields.summary || '', project: i.fields.project ? i.fields.project.name : '', status: st, priority: pr, deadline: dl, daysLeft: dLeft, score: laneScore + pw + ds + prw, lane: lane ? lane.name : 'Other', role: role };
      }).filter(function(t) { return t !== null; }).sort(function(a, b) { return b.score - a.score; });
      });
    });
  });
};

/* ═══ Amplify ═══ */
function Amp(base) { this.base = base || 'https://amplify.echologyx.com'; this.xsrf = null; this.tc = {}; }
Amp.prototype._x = function() { var self = this; return chrome.cookies.get({ url: self.base, name: 'XSRF-TOKEN' }).then(function(c) { if (c) self.xsrf = decodeURIComponent(c.value); }); };
Amp.prototype._df = function(iso) { var p = iso.split('-'); return p[1] + '/' + p[2] + '/' + p[0]; };
Amp.prototype.login = function(email, pw) {
  var self = this;
  return fetch(self.base + '/login', { credentials: 'include' }).then(function(r) { return r.text(); }).then(function(html) {
    return self._x().then(function() {
      var tok = html.match(/name="_token"\s+value="([^"]+)"/);
      if (!tok) throw new Error('CSRF not found');
      return fetch(self.base + '/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _token: tok[1], email: email, password: pw }).toString(), redirect: 'follow' });
    });
  }).then(function(r) { return self._x().then(function() { if (r.url.includes('/login')) throw new Error('Amplify login failed'); }); });
};
Amp.prototype.isLoggedIn = function() { return fetch(this.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' }, redirect: 'follow' }).then(function(r) { return r.ok && !r.url.includes('/login'); }).catch(function() { return false; }); };
Amp.prototype.getTS = function(sd, ed, start, len) {
  var self = this;
  var q = new URLSearchParams({ draw: '1', start: String(start || 0), length: String(len || 100), 'order[0][column]': '1', 'order[0][dir]': 'desc', 'order[1][column]': '2', 'order[1][dir]': 'desc', 'columns[0][data]': 'DT_RowIndex', 'columns[0][name]': 'DT_RowIndex', 'columns[1][data]': 'date', 'columns[1][name]': 'date', 'columns[2][data]': 'start_time', 'columns[2][name]': 'start_time', 'columns[3][data]': 'end_time', 'columns[3][name]': 'end_time', 'columns[4][data]': 'duration', 'columns[4][name]': 'duration', 'columns[5][data]': 'client', 'columns[5][name]': 'client', 'columns[6][data]': 'project', 'columns[6][name]': 'project', 'columns[7][data]': 'task', 'columns[7][name]': 'task', 'columns[8][data]': 'activity', 'columns[8][name]': 'activity', 'columns[9][data]': 'action', 'columns[9][name]': 'action', date_filter_type: 'custom', start_date: self._df(sd), end_date: self._df(ed) });
  return self._x().then(function() {
    var h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (self.xsrf) h['X-XSRF-TOKEN'] = self.xsrf;
    return fetch(self.base + '/timesheets?' + q, { credentials: 'include', headers: h });
  }).then(function(r) {
    if (!r.ok) throw new Error('Timesheets fetch failed: ' + r.status);
    var ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { data: [] };
    return r.json();
  });
};
Amp.prototype.allTS = function(sd, ed) {
  var self = this, all = [];
  function pg(s) { return self.getTS(sd, ed, s, 100).then(function(r) { var d = r.data || []; all = all.concat(d); if (d.length < 100 || all.length >= r.recordsFiltered) return all; return pg(s + 100); }); }
  return pg(0);
};
Amp.prototype._tok = function() {
  var self = this;
  return self._x().then(function() {
    return fetch(self.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' } });
  }).then(function(r) {
    if (!r.ok || r.url.includes('/login')) throw new Error('Not logged into Amplify');
    return r.text();
  }).then(function(html) {
    return self._x().then(function() {
      var csrf = (html.match(/name="_token"\s+value="([^"]+)"/) || [])[1];
      var userId = (html.match(/name="user_id"[^>]*value="([^"]*)"/) || [])[1];
      if (!csrf) throw new Error('CSRF token not found — Amplify session may have expired');
      return { csrf: csrf, userId: userId };
    });
  });
};
Amp.prototype.create = function(data) {
  var self = this;
  return self._tok().then(function(t) {
    var p = { _token: t.csrf, user_id: t.userId, client_id: String(data.client_id), project_id: String(data.project_id), time_activity_id: String(data.time_activity_id), start_date: data.start_date, start_time: data.start_time, end_time: data.end_time, duration: data.duration, description: data.description || '' };
    if (data.task_id) p.task_id = String(data.task_id);
    if (data.task_name) { p.task_name = data.task_name; p.task_status_id = ''; }
    return self._x().then(function() {
      var h = { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: self.base + '/timesheets' };
      if (self.xsrf) h['X-XSRF-TOKEN'] = self.xsrf;
      return fetch(self.base + '/timesheets', { method: 'POST', credentials: 'include', headers: h, body: new URLSearchParams(p).toString() });
    }).then(function(r) {
      if (!r || !r.ok) throw new Error('Create failed: ' + (r ? r.status : 'no response'));
      return self._x();
    });
  });
};
Amp.prototype.lookupProj = function(prefix) {
  var self = this, now = new Date(), end = now.toISOString().split('T')[0]; var s = new Date(now); s.setDate(s.getDate() - 90);
  return self.getTS(s.toISOString().split('T')[0], end, 0, 200).then(function(r) {
    var data = (r && r.data) || [];
    for (var i = 0; i < data.length; i++) { var e = data[i], k = self.tk(e.task); if (k && k.indexOf(prefix + '-') === 0) return { project_id: e.project_id, project_name: e.project, client_id: e.client_id }; }
    return null;
  }).catch(function() { return null; });
};
Amp.prototype.lookupTask = function(pid, key) {
  var self = this, ck = String(pid);
  var prom = self.tc[ck] ? Promise.resolve(self.tc[ck]) : self._x().then(function() {
    var h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }; if (self.xsrf) h['X-XSRF-TOKEN'] = self.xsrf;
    return fetch(self.base + '/tasks/projects?project_id=' + pid, { credentials: 'include', headers: h }).then(function(r) { return r.ok ? r.json() : {}; }).then(function(d) { self.tc[ck] = d; return d; });
  });
  return prom.then(function(tasks) {
    for (var id in tasks) { var n = tasks[id]; if (n === key || n.indexOf(key + ' ') === 0 || n.indexOf(key + '|') === 0) return parseInt(id); }
    return null;
  });
};
Amp.prototype.tk = function(html) { if (!html) return null; var m = html.match(/<p[^>]*class="task-wrap"[^>]*>(.*?)<\/p>/); var raw = m ? m[1].trim() : html.trim(); var k = raw.match(/^([A-Z]+-\d+)/); return k ? k[1] : null; };
Amp.prototype.fetchAllProjects = function() {
  var self = this;
  return fetch(self.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' } })
    .then(function(r) { return r.text(); }).then(function(html) {
      var cidx = html.indexOf('id="create_client_id"');
      var cend = html.indexOf('</select>', cidx);
      var cblock = html.substring(cidx, cend);
      var cre = /value="(\d+)"[^>]*>\n\s*(.+)/g;
      var cm, clients = [];
      while ((cm = cre.exec(cblock)) !== null) clients.push({ id: parseInt(cm[1]), name: cm[2].trim() });
      var allProjects = [], chain = Promise.resolve();
      clients.forEach(function(client) {
        chain = chain.then(function() {
          return self._x().then(function() {
            var h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
            if (self.xsrf) h['X-XSRF-TOKEN'] = self.xsrf;
            return fetch(self.base + '/projects/clients?client_id=' + client.id, { credentials: 'include', headers: h });
          }).then(function(r) { return r.json(); }).then(function(body) {
            Object.entries(body).forEach(function(e) {
              var pid = parseInt(e[0]);
              if (!allProjects.some(function(p) { return p.id === pid; })) {
                allProjects.push({ id: pid, name: e[1], client_id: client.id });
              }
            });
          });
        });
      });
      return chain.then(function() {
        allProjects.sort(function(a, b) { return a.name.localeCompare(b.name); });
        return allProjects;
      });
    });
};
Amp.prototype.fetchAllActivities = function() {
  var self = this;
  return fetch(self.base + '/timesheets', { credentials: 'include', headers: { Accept: 'text/html' } })
    .then(function(r) { return r.text(); }).then(function(html) {
      var createIdx = html.indexOf('id="create_project_id"');
      var idx = html.indexOf('name="time_activity_id"', createIdx > -1 ? createIdx : 0);
      var end = html.indexOf('</select>', idx);
      var block = html.substring(idx, end);
      var re = /value="(\d+)"[^>]*>\n\s*(.+)/g;
      var m, acts = [];
      while ((m = re.exec(block)) !== null) {
        var name = m[2].trim().replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        if (name) acts.push({ id: parseInt(m[1]), name: name });
      }
      return acts;
    });
};

/* ═══ UI ═══ */
var jira, amp, settings;
var calMonth, calYear, calStart = null, calEnd = null, calPicking = 'start';

function showView(name) {
  document.querySelectorAll('.view').forEach(function(v) { v.style.display = 'none'; });
  document.querySelectorAll('.tab').forEach(function(b) { b.classList.toggle('active', b.dataset.view === name); });
  var el = document.getElementById(name + '-view');
  if (el) el.style.display = 'block';
  if (name === 'sync' && jira) { if (!calStart) applyPreset('today'); }
  if (name === 'priority' && jira) runPriority();
  if (name === 'actmap') initActMap();
  if (name === 'projmap') initProjMap();
  if (name === 'taskmap') initTaskMap();
  if (name === 'stats') { if (!statStart) applyStatPreset('week'); }
}

function sts(id, type, msg) { var el = document.getElementById(id); el.className = 'status-box ' + type; el.innerHTML = msg; el.style.display = 'block'; }
function clr(id) { document.getElementById(id).style.display = 'none'; }

function ensureAmp() { return amp.isLoggedIn().then(function(ok) { if (!ok) return amp.login(settings.amplifyEmail, settings.amplifyPassword); }); }

/* ── Calendar ── */
function isoStr(d) { return d.toISOString().split('T')[0]; }

function renderCal() {
  var title = document.getElementById('cal-title');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  title.textContent = months[calMonth] + ' ' + calYear;
  var container = document.getElementById('cal-days');
  container.innerHTML = '';
  var first = new Date(calYear, calMonth, 1);
  var dow = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  var prevDays = new Date(calYear, calMonth, 0).getDate();
  var todayStr = today();

  for (var i = dow - 1; i >= 0; i--) {
    var d = document.createElement('div');
    d.className = 'cal-day other';
    d.textContent = prevDays - i;
    container.appendChild(d);
  }
  for (var day = 1; day <= daysInMonth; day++) {
    var d = document.createElement('div');
    d.className = 'cal-day';
    d.textContent = day;
    var dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    d.dataset.date = dateStr;
    if (dateStr === todayStr) d.classList.add('today');
    if (calStart && calEnd) {
      if (dateStr === calStart && dateStr === calEnd) d.classList.add('sel-start', 'sel-end');
      else if (dateStr === calStart) d.classList.add('sel-start');
      else if (dateStr === calEnd) d.classList.add('sel-end');
      else if (calStart && calEnd && dateStr > calStart && dateStr < calEnd) d.classList.add('in-range');
    } else if (calStart && dateStr === calStart) {
      d.classList.add('sel-start', 'sel-end');
    }
    d.addEventListener('click', onCalDayClick);
    container.appendChild(d);
  }
  var total = dow + daysInMonth;
  var remaining = (7 - total % 7) % 7;
  for (var i = 1; i <= remaining; i++) {
    var d = document.createElement('div');
    d.className = 'cal-day other';
    d.textContent = i;
    container.appendChild(d);
  }
  updateRangeDisplay();
}

function onCalDayClick(e) {
  var date = e.target.dataset.date;
  if (!date) return;
  document.querySelectorAll('.preset').forEach(function(b) { b.classList.remove('active'); });
  if (calPicking === 'start') {
    calStart = date; calEnd = null; calPicking = 'end';
  } else {
    if (date < calStart) { calEnd = calStart; calStart = date; }
    else { calEnd = date; }
    calPicking = 'start';
    runSync(calStart, calEnd);
  }
  renderCal();
}

function updateRangeDisplay() {
  var el = document.getElementById('cal-range-display');
  if (calStart && calEnd) el.textContent = calStart + '  →  ' + calEnd;
  else if (calStart) el.textContent = calStart + '  →  click end date';
  else el.textContent = 'Click a start date';
}

function applyPreset(mode) {
  var t = today();
  if (mode === 'today') { calStart = t; calEnd = t; }
  else if (mode === 'yesterday') { var d = new Date(t); d.setDate(d.getDate() - 1); calStart = isoStr(d); calEnd = calStart; }
  else if (mode === 'week') { var d = new Date(t); d.setDate(d.getDate() - 6); calStart = isoStr(d); calEnd = t; }
  else if (mode === '2weeks') { var d = new Date(t); d.setDate(d.getDate() - 13); calStart = isoStr(d); calEnd = t; }
  else if (mode === 'month') { var d = new Date(t); d.setDate(d.getDate() - 29); calStart = isoStr(d); calEnd = t; }
  else if (mode === 'thismonth') { var parts = t.split('-'); calStart = parts[0] + '-' + parts[1] + '-01'; calEnd = t; }
  calPicking = 'start';
  var sd = new Date(calStart);
  calMonth = sd.getMonth(); calYear = sd.getFullYear();
  renderCal();
  runSync(calStart, calEnd);
}

/* ── Sync ── */
function runSync(startDate, endDate) {
  var r = { s: startDate, e: endDate }, box = 'sync-status', out = document.getElementById('sync-results');
  out.innerHTML = '';
  document.getElementById('sync-summary').innerHTML = '';
  sts(box, 'loading', '<span class="spinner"></span>Checking Jira...');
  jira.init().then(function() {
    sts(box, 'loading', '<span class="spinner"></span>Logging into Amplify...');
    return ensureAmp();
  }).then(function() {
    // Fetch projects & activities for dropdowns and display names
    if (amplifyProjects.length === 0) fetchAmplifyProjects();
    if (amplifyActivities.length === 0) fetchAmplifyActivities();
    sts(box, 'loading', '<span class="spinner"></span>Fetching worklogs...');
    return jira.worklogs(r.s, r.e);
  }).then(function(jw) {
    assignSequentialTimes(jw);
    sts(box, 'loading', '<span class="spinner"></span>Fetching Amplify...');
    return amp.allTS(r.s, r.e).then(function(ae) { return { jw: jw, ae: ae }; });
  }).then(function(d) {
    sts(box, 'loading', '<span class="spinner"></span>Analyzing...');
    var ae = d.ae, jw = d.jw; d._jw = jw; d._ae = ae; var pc = {}, tkc = {};
    ae.forEach(function(e) { var k = amp.tk(e.task); if (k) { var pfx = k.split('-')[0]; if (!pc[pfx]) pc[pfx] = { project_id: e.project_id, project_name: e.project, client_id: e.client_id }; if (e.task_id) tkc[k] = e.task_id; } });
    var toCreate = [], conflicts = [], synced = [], unmapped = [];
    var chain = Promise.resolve();
    jw.forEach(function(wl) {
      chain = chain.then(function() {
        var t = wl._amp, cm = parseComment(wl.comment, wl.projectKey);
        // Task Map override — highest priority
        var tm = userTaskMap[wl.issueKey];
        if (tm) {
          if (tm.activityId) cm.activityId = tm.activityId;
          if (tm.project_id) {
            pc[wl.projectKey] = { project_id: tm.project_id, project_name: tm.project_name || wl.projectKey, client_id: tm.client_id || 0 };
          }
        }
        var matches = ae.filter(function(e) { return amp.tk(e.task) === wl.issueKey && e.start_date === t.start_date; });
        if (matches.length > 0) {
          var matchedEntry = matches.find(function(e) { return Math.abs(phm(e.duration_in_time) - Math.round(wl.timeSpentSeconds / 60)) <= 5; });
          if (matchedEntry)
            synced.push({ ticket: wl.issueKey, summary: wl.summary, duration: fd(wl.timeSpentSeconds), date: t.start_date, jiraComment: wl.comment || '', ampActivity: matchedEntry.activity || '' });
          else conflicts.push({ ticket: wl.issueKey, summary: wl.summary, date: t.start_date, jd: fd(wl.timeSpentSeconds), ad: matches[0].duration_in_time });
          return;
        }
        var proj = pc[wl.projectKey];
        if (!proj && userProjectMap[wl.projectKey]) {
          var um = userProjectMap[wl.projectKey];
          proj = { project_id: um.project_id, project_name: um.project_name || wl.projectKey, client_id: um.client_id };
          pc[wl.projectKey] = proj;
        }
        var pp = proj ? Promise.resolve(proj) : amp.lookupProj(wl.projectKey).then(function(p) { if (p) pc[wl.projectKey] = p; return p; });
        return pp.then(function(proj) {
          if (!proj) { unmapped.push({ ticket: wl.issueKey, summary: wl.summary, date: t.start_date, duration: fd(wl.timeSpentSeconds), reason: 'Project "' + wl.projectKey + '" not found' }); return; }

          // E-com mode: fetch parent ticket and use parent-based task name
          var ecomP = settings.ecomMode ? jira._r('GET', '/rest/api/3/issue/' + wl.issueKey + '?fields=parent').then(function(r) {
            var parent = r.body && r.body.fields && r.body.fields.parent;
            return parent ? parent.key : null;
          }).catch(function() { return null; }) : Promise.resolve(null);

          return ecomP.then(function(parentKey) {
            var ampTaskName, ampDesc;
            if (parentKey) {
              var label = parentKey + ' Validate ' + wl.issueKey;
              ampTaskName = label;
              ampDesc = label;
            } else {
              ampTaskName = wl.issueKey + ' | ' + wl.summary;
              ampDesc = cm.description;
            }

            var lookupName = parentKey ? parentKey + ' Validate ' + wl.issueKey : wl.issueKey;
            var tid = tkc[lookupName];
            var tp = tid ? Promise.resolve(tid) : amp.lookupTask(proj.project_id, lookupName).then(function(id) { if (id) tkc[lookupName] = id; return id; });
            return tp.then(function(taskId) {
              toCreate.push({ ticket: wl.issueKey, summary: wl.summary, project: proj.project_name, date: t.start_date, startTime: t.start_time, endTime: t.end_time, duration: t.duration, dd: fd(wl.timeSpentSeconds), activityId: cm.activityId, description: ampDesc, jiraComment: wl.comment || '', projectId: proj.project_id, clientId: proj.client_id, taskId: taskId, taskName: ampTaskName, parentKey: parentKey || null });
            });
          });
        });
      });
    });
    return chain.then(function() { return { toCreate: toCreate, conflicts: conflicts, synced: synced, unmapped: unmapped, jw: jw, ae: ae, projCache: pc, taskCache: tkc }; });
  }).then(function(a) {
    clr(box);

    // Daily summary: compute per-day totals for Jira and Amplify
    var jiraDayMins = {}, ampDayMins = {};
    a.jw.forEach(function(wl) {
      var t = toAmpTime(wl.started, wl.timeSpentSeconds);
      jiraDayMins[t.start_date] = (jiraDayMins[t.start_date] || 0) + Math.round(wl.timeSpentSeconds / 60);
    });
    a.ae.forEach(function(e) {
      ampDayMins[e.start_date] = (ampDayMins[e.start_date] || 0) + phm(e.duration_in_time);
    });
    var allDates = {};
    Object.keys(jiraDayMins).forEach(function(d) { allDates[d] = true; });
    Object.keys(ampDayMins).forEach(function(d) { allDates[d] = true; });
    var jiraTotal = 0, ampTotal = 0, mismatchDays = [], underDays = [];
    Object.keys(allDates).sort().forEach(function(d) {
      var dow = new Date(d).getDay();
      if (dow === 0 || dow === 6) return; // skip weekends
      var jm = jiraDayMins[d] || 0, am = ampDayMins[d] || 0;
      jiraTotal += jm; ampTotal += am;
      if (Math.abs(jm - am) > 5) mismatchDays.push({ date: d, jira: fd(jm * 60), amp: fd(am * 60) });
      if (jm < 445 || am < 445) underDays.push({ date: d, jira: fd(jm * 60), amp: fd(am * 60) });
    });

    var sumHtml = '<div class="summary-row">';
    var jCls = jiraTotal < 445 && startDate === endDate ? 'warn' : 'ok';
    var aCls = ampTotal < 445 && startDate === endDate ? 'warn' : 'ok';
    sumHtml += '<div class="summary-card ' + jCls + '"><div class="summary-label">Jira</div><div class="summary-val">' + fd(jiraTotal * 60) + '</div></div>';
    sumHtml += '<div class="summary-card ' + aCls + '"><div class="summary-label">Amplify</div><div class="summary-val">' + fd(ampTotal * 60) + '</div></div>';
    if (startDate === endDate) {
      var exp = 450, deficit = exp - Math.max(jiraTotal, ampTotal);
      sumHtml += '<div class="summary-card ' + (deficit > 15 ? 'bad' : 'ok') + '"><div class="summary-label">Target</div><div class="summary-val">7h 30m</div><div class="summary-sub">' + (deficit > 0 ? fd(deficit * 60) + ' short' : 'Met') + '</div></div>';
    } else {
      var workdays = Object.keys(allDates).filter(function(d) { var dow = new Date(d).getDay(); return dow !== 0 && dow !== 6; }).length;
      var exp = workdays * 450;
      sumHtml += '<div class="summary-card"><div class="summary-label">' + workdays + ' workdays</div><div class="summary-val">' + fd(exp * 60) + '</div><div class="summary-sub">expected</div></div>';
    }
    sumHtml += '</div>';

    // Build per-ticket breakdown for each day
    var jiraTicketsByDay = {}, ampTicketsByDay = {};
    a.jw.forEach(function(wl) {
      var t = toAmpTime(wl.started, wl.timeSpentSeconds);
      if (!jiraTicketsByDay[t.start_date]) jiraTicketsByDay[t.start_date] = [];
      jiraTicketsByDay[t.start_date].push({ ticket: wl.issueKey, dur: fd(wl.timeSpentSeconds) });
    });
    a.ae.forEach(function(e) {
      var k = amp.tk(e.task);
      var desc = '';
      if (!k && e.task) {
        var m = e.task.match(/<p[^>]*>(.*?)<\/p>/);
        desc = m ? m[1].trim() : e.task.replace(/<[^>]+>/g, '').trim();
      }
      if (!ampTicketsByDay[e.start_date]) ampTicketsByDay[e.start_date] = [];
      ampTicketsByDay[e.start_date].push({ ticket: k || '?', dur: e.duration_in_time, activity: e.activity || '', desc: desc });
    });

    // Combine issues into one table
    var issueDays = {};
    mismatchDays.forEach(function(d) { issueDays[d.date] = issueDays[d.date] || { date: d.date, jira: d.jira, amp: d.amp, issues: [] }; issueDays[d.date].issues.push('Mismatch'); });
    underDays.forEach(function(d) { if (!issueDays[d.date]) issueDays[d.date] = { date: d.date, jira: d.jira, amp: d.amp, issues: [] }; issueDays[d.date].issues.push('Under 7h 30m'); });
    var issueList = Object.values(issueDays).sort(function(a, b) { return a.date.localeCompare(b.date); });

    if (issueList.length > 0) {
      issueList.forEach(function(d) {
        var tags = d.issues.map(function(i) { return i === 'Mismatch' ? '<span class="badge badge-yellow">' + i + '</span>' : '<span class="badge badge-red">' + i + '</span>'; }).join(' ');
        sumHtml += '<div style="border:1px solid #e8d8cc;border-radius:8px;margin-bottom:10px;overflow:hidden">';
        sumHtml += '<table style="margin:0"><tr><th>Date</th><th>Jira</th><th>Amplify</th><th>Issue</th></tr>';
        sumHtml += '<tr><td>' + d.date + '</td><td>' + d.jira + '</td><td>' + d.amp + '</td><td>' + tags + '</td></tr></table>';
        if (d.issues.indexOf('Mismatch') !== -1) {
          var jt = jiraTicketsByDay[d.date] || [], at = ampTicketsByDay[d.date] || [];
          var ampUsed = {};
          var rows = [];
          jt.forEach(function(je) {
            var match = null;
            at.forEach(function(ae, idx) {
              if (!ampUsed[idx] && ae.ticket === je.ticket) { match = ae; ampUsed[idx] = true; }
            });
            var same = match && match.dur === je.dur;
            rows.push({ jTicket: je.ticket, jDur: je.dur, aTicket: match ? match.ticket : '', aDur: match ? match.dur : '', aAct: match ? match.activity : '', matched: !!match, same: same });
          });
          at.forEach(function(ae, idx) {
            if (!ampUsed[idx]) {
              var label = ae.ticket !== '?' ? ae.ticket : (ae.desc || '(' + ae.activity + ')');
              rows.push({ jTicket: '', jDur: '', aTicket: label, aDur: ae.dur, aAct: ae.activity, matched: false, same: false });
            }
          });
          sumHtml += '<table style="margin:0;font-size:10px"><tr><th colspan="2" style="background:#fef0e8;color:#c25a30">Jira</th><th colspan="3" style="background:#fef0e8;color:#c25a30">Amplify</th></tr>';
          sumHtml += '<tr><th>Ticket</th><th>Duration</th><th>Ticket</th><th>Duration</th><th>Activity</th></tr>';
          rows.forEach(function(r) {
            var bg = r.same ? 'background:#e8fce8' : (r.jTicket && r.aTicket ? 'background:#fff7e6' : 'background:#ffebe6');
            sumHtml += '<tr style="' + bg + '"><td>' + (r.jTicket ? ticketLink(r.jTicket) : '<span style="color:#c1c7d0">—</span>') + '</td><td>' + (r.jDur || '—') + '</td><td>' + (r.aTicket ? ticketLink(r.aTicket) : '<span style="color:#c1c7d0">—</span>') + '</td><td>' + (r.aDur || '—') + '</td><td style="color:#8c7b6b">' + (r.aAct || '—') + '</td></tr>';
          });
          sumHtml += '</table>';
        }
        sumHtml += '</div>';
      });
    }
    if (issueList.length === 0 && Object.keys(allDates).length > 0) {
      sumHtml += '<div class="summary-alert good">All days match and meet the 7h 30m target.</div>';
    }
    document.getElementById('sync-summary').innerHTML = sumHtml;

    var h = '';
    var createDrops = [];
    if (a.toCreate.length) {
      h += '<div class="section-title">To Create <span class="badge badge-blue">' + a.toCreate.length + '</span></div>';
      h += '<div id="to-create-rows"></div>';
      h += '<button class="btn-primary" id="do-sync">Sync ' + a.toCreate.length + ' entries</button>';
    }
    if (a.conflicts.length) {
      h += '<div class="section-title">Conflicts <span class="badge badge-yellow">' + a.conflicts.length + '</span></div><table><tr><th>Ticket</th><th>Date</th><th>Amp</th><th>Jira</th></tr>';
      a.conflicts.forEach(function(c) { h += '<tr><td><b>' + c.ticket + '</b></td><td>' + c.date + '</td><td>' + c.ad + '</td><td>' + c.jd + '</td></tr>'; });
      h += '</table>';
    }
    if (a.synced.length) {
      h += '<div class="section-title">Already Synced <span class="badge badge-green">' + a.synced.length + '</span></div><table><tr><th>Ticket</th><th>Jira Description</th><th>Amplify Activity</th><th>Date</th><th>Dur</th></tr>';
      a.synced.forEach(function(e) { h += '<tr><td>' + ticketLink(e.ticket) + '</td><td>' + (e.jiraComment || '—') + '</td><td><span class="badge badge-blue">' + (e.ampActivity || '—') + '</span></td><td>' + e.date + '</td><td>' + e.duration + '</td></tr>'; });
      h += '</table>';
    }
    if (a.unmapped.length) {
      h += '<div class="section-title">Unmapped <span class="badge badge-red">' + a.unmapped.length + '</span></div>';
      h += '<div id="unmapped-rows"></div>';
      h += '<button class="btn-primary" id="resolve-unmapped" disabled style="margin-top:8px">Sync assigned entries</button>';
    }
    if (!a.toCreate.length && !a.conflicts.length && !a.unmapped.length) sts(box, 'success', a.synced.length === 1 ? '1 entry is synced.' : 'All ' + a.synced.length + ' entries are synced.');
    out.innerHTML = h;

    // Build To Create rows with editable project + activity dropdowns
    var createContainer = document.getElementById('to-create-rows');
    if (createContainer) {
      var actOpts = amplifyActivities.map(function(x) { return { id: x.id, name: x.name }; });
      var projOpts2 = amplifyProjects.map(function(p) { return { id: p.id, name: p.name, client_id: p.client_id }; });
      var tbl = '<table><tr><th>Ticket</th><th>Project</th><th>Jira Description</th><th>Activity</th><th>Date</th><th>Dur</th></tr>';
      createContainer.innerHTML = tbl;
      var table = createContainer.querySelector('table');
      a.toCreate.forEach(function(e, i) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + ticketLink(e.ticket) + '</td><td class="proj-cell"></td><td>' + (e.jiraComment || '—') + '</td><td class="act-cell"></td><td>' + e.date + '</td><td>' + e.dd + '</td>';
        var projCell = tr.querySelector('.proj-cell');
        var projDrop = createSearchDrop(projOpts2, e.projectId, '— Project —');
        projDrop.style.minWidth = '130px';
        projDrop.addEventListener('change', function() {
          var pd = projDrop._extraData || {};
          a.toCreate[i].projectId = parseInt(projDrop.value);
          a.toCreate[i].clientId = pd.client_id ? parseInt(pd.client_id) : a.toCreate[i].clientId;
        });
        projCell.appendChild(projDrop);
        var actCell = tr.querySelector('.act-cell');
        var actDrop = createSearchDrop(actOpts, e.activityId, '— Activity —');
        actDrop.style.minWidth = '140px';
        actDrop.addEventListener('change', function() { a.toCreate[i].activityId = parseInt(actDrop.value); });
        createDrops.push(actDrop);
        actCell.appendChild(actDrop);
        table.appendChild(tr);
      });
      createContainer.innerHTML = '';
      createContainer.appendChild(table);
    }

    // Build unmapped rows with searchable dropdowns
    var unmapContainer = document.getElementById('unmapped-rows');
    var unmapDrops = [];
    if (unmapContainer) {
      var projOpts = amplifyProjects.map(function(p) { return { id: p.id, name: p.name, client_id: p.client_id }; });
      a.unmapped.forEach(function(e, i) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f4f5f7;font-size:11px';
        var info = document.createElement('div');
        info.style.cssText = 'min-width:120px';
        info.innerHTML = ticketLink(e.ticket) + ' <span style="color:#6b778c">' + e.duration + ' · ' + e.date + '</span>';
        var drop = createSearchDrop(projOpts, '', '— Assign Project —');
        drop.dataset.idx = i;
        drop.addEventListener('change', function() {
          var any = false;
          unmapDrops.forEach(function(d) { if (d.value) any = true; });
          document.getElementById('resolve-unmapped').disabled = !any;
        });
        unmapDrops.push(drop);
        row.appendChild(info); row.appendChild(drop);
        unmapContainer.appendChild(row);
      });
    }

    var resBtn = document.getElementById('resolve-unmapped');
    if (resBtn) {
      resBtn.addEventListener('click', function() {
        resBtn.disabled = true; resBtn.textContent = 'Syncing...';
        var entries = [];
        unmapDrops.forEach(function(drop) {
          if (!drop.value) return;
          var idx = parseInt(drop.dataset.idx);
          var um = a.unmapped[idx];
          var data = drop._extraData || {};
          entries.push({
            ticket: um.ticket, summary: um.summary, date: um.date,
            projectId: parseInt(drop.value), clientId: data.client_id ? parseInt(data.client_id) : 0,
            projectName: data.name || ''
          });
        });
        var ok2 = 0, fail2 = 0, ch2 = Promise.resolve();
        entries.forEach(function(ent) {
          ch2 = ch2.then(function() {
            // Lookup task for this ticket in the assigned project
            var wl = a.jw.find(function(w) {
              return w.issueKey === ent.ticket && w._amp && w._amp.start_date === ent.date;
            });
            if (!wl) throw new Error('Worklog not found');
            var ecomP2 = settings.ecomMode ? jira._r('GET', '/rest/api/3/issue/' + ent.ticket + '?fields=parent').then(function(r) {
              var parent = r.body && r.body.fields && r.body.fields.parent;
              return parent ? parent.key : null;
            }).catch(function() { return null; }) : Promise.resolve(null);
            return ecomP2.then(function(parentKey) {
              var lookupName = parentKey ? parentKey + ' Validate ' + ent.ticket : ent.ticket;
              return amp.lookupTask(ent.projectId, lookupName).then(function(taskId) {
                var t = wl._amp;
                var cm = parseComment(wl.comment, wl.projectKey);
                var desc = parentKey ? parentKey + ' Validate ' + ent.ticket : cm.description;
                var p = { project_id: ent.projectId, client_id: ent.clientId, start_date: t.start_date, start_time: t.start_time, end_time: t.end_time, duration: t.duration, time_activity_id: cm.activityId, description: desc };
                if (taskId) p.task_id = taskId; else p.task_name = parentKey ? parentKey + ' Validate ' + ent.ticket : ent.ticket + ' | ' + ent.summary;
                return amp.create(p);
              });
            });
            }).then(function() { ok2++; }).catch(function() { fail2++; });
          });
        });
        ch2.then(function() {
          sts(box, fail2 ? 'error' : 'success', fail2 ? ok2 + ' created, ' + fail2 + ' failed.' : 'Synced ' + ok2 + ' unmapped entries!');
          resBtn.textContent = 'Done';
          setTimeout(function() { runSync(startDate, endDate); }, 1500);
        });
      });
    }

    var btn = document.getElementById('do-sync');
    if (btn) btn.addEventListener('click', function() {
      btn.disabled = true; btn.textContent = 'Syncing...';
      var ok = 0, fail = 0, ch = Promise.resolve();
      a.toCreate.forEach(function(e) {
        ch = ch.then(function() {
          var p = { project_id: e.projectId, client_id: e.clientId, start_date: e.date, start_time: e.startTime, end_time: e.endTime, duration: e.duration, time_activity_id: e.activityId, description: e.description };
          if (e.taskId) p.task_id = e.taskId; else p.task_name = e.taskName;
          return amp.create(p).then(function() { ok++; }).catch(function() { fail++; });
        });
      });
      ch.then(function() {
        sts(box, fail ? 'error' : 'success', fail ? ok + ' created, ' + fail + ' failed.' : 'Synced ' + ok + ' entries!');
        btn.textContent = 'Done';
        setTimeout(function() { runSync(startDate, endDate); }, 1500);
      });
    });
  }).catch(function(err) { sts(box, 'error', err.message); });
}

/* ── Priority ── */
function runPriority() {
  var box = 'priority-status', out = document.getElementById('priority-results'); out.innerHTML = '';
  sts(box, 'loading', '<span class="spinner"></span>Loading priorities...');
  jira.myTickets().then(function(tickets) {
    clr(box);
    if (!tickets.length) { sts(box, 'success', 'No tickets in active pipeline.'); return; }
    var sm = { 'development in progress': '🔨 In Dev', 'selected for development': '📋 Sel Dev', 'stabilization in progress': '🧪 Stabilizing', 'selected for stabilization': '📋 Sel Stab', 'selected for po review': '👁 PO Review', 'ac review': '✓ AC Review', 'selected for ac review': '✓ Sel AC Review' };
    var dl = function(d) { if (d === null) return '—'; if (d < 0) return '<span class="badge badge-red">' + Math.abs(d) + 'd over</span>'; if (d === 0) return '<span class="badge badge-red">Today</span>'; if (d <= 3) return '<span class="badge badge-yellow">in ' + d + 'd</span>'; if (d <= 7) return '<span class="badge badge-yellow">in ' + d + 'd</span>'; return '<span class="badge badge-green">in ' + d + 'd</span>'; };
    var h = '<table><tr><th>#</th><th>Score</th><th>Ticket</th><th>Project</th><th>Lane</th><th>Status</th><th>Deadline</th></tr>';
    tickets.forEach(function(t, i) {
      var laneColor = { 'High Priority Unit': '#de350b', 'Hard Deadline': '#e8734a', 'Bug': '#ff5630', 'CRO Request': '#8c6bb7', 'Production': '#57a773', 'ASMC Rework': '#d4a017' };
      var lc = laneColor[t.lane] || '#8c7b6b';
      h += '<tr><td>' + (i + 1) + '</td><td><b>' + t.score + '</b></td><td>' + ticketLink(t.ticket) + '</td><td>' + t.project + '</td><td><span style="color:' + lc + ';font-weight:600;font-size:10px">' + t.lane + '</span></td><td>' + (sm[(t.status || '').toLowerCase()] || t.status || '—') + '</td><td>' + dl(t.daysLeft) + '</td></tr>';
    });
    h += '</table>';
    h += '<p style="margin-top:8px;color:#8c7b6b;font-size:10px"><b>Score:</b> Lane (0–30) + Stage (0–25) + Deadline (0–50) + Priority (0–15)</p>';
    out.innerHTML = h;
  }).catch(function(err) { sts(box, 'error', err.message); });
}

/* ── Remind ── */

/* ── Activity Map ── */

/* ── Searchable Dropdown ── */
function createSearchDrop(options, selectedVal, placeholder, extraData) {
  // options: [{id, name, ...}], selectedVal: string/number, placeholder: string
  var wrap = document.createElement('div');
  wrap.className = 'sdrop';
  var display = document.createElement('div');
  display.className = 'sdrop-display placeholder';
  display.textContent = placeholder || '— Select —';
  var panel = document.createElement('div');
  panel.className = 'sdrop-panel';
  var search = document.createElement('input');
  search.className = 'sdrop-search';
  search.placeholder = 'Type to search...';
  var list = document.createElement('div');
  list.className = 'sdrop-list';
  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(display);
  wrap.appendChild(panel);

  wrap._value = '';
  wrap._extraData = {};

  function render(filter) {
    list.innerHTML = '';
    var q = (filter || '').toLowerCase();
    var found = false;
    options.forEach(function(opt) {
      if (q && opt.name.toLowerCase().indexOf(q) === -1) return;
      found = true;
      var item = document.createElement('div');
      item.className = 'sdrop-item';
      if (String(opt.id) === String(wrap._value)) item.classList.add('selected');
      item.textContent = opt.name;
      item.dataset.id = opt.id;
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        wrap._value = String(opt.id);
        wrap._extraData = opt;
        display.textContent = opt.name;
        display.classList.remove('placeholder');
        panel.classList.remove('open');
        wrap.dispatchEvent(new Event('change'));
      });
      list.appendChild(item);
    });
    if (!found) {
      var empty = document.createElement('div');
      empty.className = 'sdrop-empty';
      empty.textContent = 'No matches';
      list.appendChild(empty);
    }
  }

  display.addEventListener('click', function(e) {
    e.stopPropagation();
    // Close all other open panels first
    document.querySelectorAll('.sdrop-panel.open').forEach(function(p) { if (p !== panel) p.classList.remove('open'); });
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) { search.value = ''; render(''); search.focus(); }
  });

  search.addEventListener('input', function() { render(search.value); highlightIdx = 0; updateHighlight(); });
  search.addEventListener('click', function(e) { e.stopPropagation(); });

  var highlightIdx = -1;
  function getVisibleItems() { return list.querySelectorAll('.sdrop-item'); }
  function updateHighlight() {
    var items = getVisibleItems();
    items.forEach(function(el, j) { el.classList.toggle('highlighted', j === highlightIdx); });
    if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' });
  }

  search.addEventListener('keydown', function(e) {
    var items = getVisibleItems();
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIdx = Math.min(highlightIdx + 1, items.length - 1); updateHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIdx = Math.max(highlightIdx - 1, 0); updateHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[highlightIdx]) items[highlightIdx].click(); }
    else if (e.key === 'Escape') { panel.classList.remove('open'); }
  });

  // Set initial value
  if (selectedVal) {
    var match = options.find(function(o) { return String(o.id) === String(selectedVal); });
    if (match) { wrap._value = String(match.id); wrap._extraData = match; display.textContent = match.name; display.classList.remove('placeholder'); }
  }

  // Getter
  Object.defineProperty(wrap, 'value', { get: function() { return wrap._value; } });

  return wrap;
}

// Close all dropdowns on outside click
document.addEventListener('click', function() {
  document.querySelectorAll('.sdrop-panel.open').forEach(function(p) { p.classList.remove('open'); });
});

function actSelectHtml(selectedId, idPrefix) {
  // Legacy — kept for default dropdown only
  var h = '<select class="map-select" id="' + idPrefix + '">';
  h += '<option value="">— Select Activity —</option>';
  amplifyActivities.forEach(function(a) {
    h += '<option value="' + a.id + '"' + (a.id == selectedId ? ' selected' : '') + '>' + a.name + ' (' + a.id + ')</option>';
  });
  h += '</select>';
  return h;
}

function addCodeRow(code, actId) {
  var div = document.createElement('div');
  div.className = 'map-row';
  var input = document.createElement('input');
  input.className = 'map-input'; input.type = 'text'; input.placeholder = '201000'; input.value = code || '';
  var arrow = document.createElement('span'); arrow.className = 'map-arrow'; arrow.textContent = '→';
  var actOpts = amplifyActivities.map(function(a) { return { id: a.id, name: a.name + ' (' + a.id + ')' }; });
  var drop = createSearchDrop(actOpts, actId, '— Select Activity —');
  var removeBtn = document.createElement('button'); removeBtn.className = 'map-remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function() { div.remove(); });
  div.appendChild(input); div.appendChild(arrow); div.appendChild(drop); div.appendChild(removeBtn);
  document.getElementById('code-mappings').appendChild(div);
}

function addPatternRow(pattern, actId) {
  var div = document.createElement('div');
  div.className = 'map-row';
  var input = document.createElement('input');
  input.className = 'map-input'; input.type = 'text'; input.placeholder = 'meeting|standup'; input.style.width = '140px';
  input.value = pattern || '';
  var arrow = document.createElement('span'); arrow.className = 'map-arrow'; arrow.textContent = '→';
  var actOpts = amplifyActivities.map(function(a) { return { id: a.id, name: a.name + ' (' + a.id + ')' }; });
  var drop = createSearchDrop(actOpts, actId, '— Select Activity —');
  var removeBtn = document.createElement('button'); removeBtn.className = 'map-remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function() { div.remove(); });
  div.appendChild(input); div.appendChild(arrow); div.appendChild(drop); div.appendChild(removeBtn);
  document.getElementById('pattern-mappings').appendChild(div);
}

function collectMappings() {
  var codes = {};
  document.querySelectorAll('#code-mappings .map-row').forEach(function(row) {
    var code = row.querySelector('.map-input').value.trim();
    var drop = row.querySelector('.sdrop');
    var act = drop ? drop.value : '';
    if (code && act) codes[code] = parseInt(act);
  });
  var patterns = [];
  document.querySelectorAll('#pattern-mappings .map-row').forEach(function(row) {
    var pat = row.querySelector('.map-input').value.trim();
    var drop = row.querySelector('.sdrop');
    var act = drop ? drop.value : '';
    if (pat && act) patterns.push({ pattern: pat, activityId: parseInt(act) });
  });
  var def = document.getElementById('default-activity').value;
  return { codes: codes, patterns: patterns, defaultId: def ? parseInt(def) : 1 };
}

function applyMappings(data) {
  userCodeMap = data.codes || {};
  userPatterns = data.patterns || [];
  defaultActivityId = data.defaultId || 1;
}

function fetchAmplifyActivities(statusId) {
  if (amplifyActivities.length > 0) return Promise.resolve(amplifyActivities);
  return chrome.storage.local.get(['amplifyActivities']).then(function(s) {
    if (s.amplifyActivities && s.amplifyActivities.length > 0) {
      amplifyActivities = s.amplifyActivities;
      return amplifyActivities;
    }
    if (!amp) return [];
    if (statusId) sts(statusId, 'loading', '<span class="spinner"></span>Fetching activities from Amplify...');
    return ensureAmp().then(function() { return amp.fetchAllActivities(); }).then(function(acts) {
      amplifyActivities = acts;
      chrome.storage.local.set({ amplifyActivities: acts });
      if (statusId) clr(statusId);
      return acts;
    }).catch(function(err) {
      if (statusId) sts(statusId, 'error', 'Failed to fetch activities: ' + err.message);
      return [];
    });
  });
}

function fetchAmplifyProjects(statusId) {
  if (amplifyProjects.length > 0) return Promise.resolve(amplifyProjects);
  return chrome.storage.local.get(['amplifyProjects']).then(function(s) {
    if (s.amplifyProjects && s.amplifyProjects.length > 0 && !s.amplifyProjects.some(function(p, i) { return s.amplifyProjects.findIndex(function(q) { return q.id === p.id; }) !== i; })) {
      amplifyProjects = s.amplifyProjects;
      return amplifyProjects;
    }
    if (!amp) return [];
    if (statusId) sts(statusId, 'loading', '<span class="spinner"></span>Fetching projects from Amplify...');
    return ensureAmp().then(function() { return amp.fetchAllProjects(); }).then(function(projs) {
      amplifyProjects = projs;
      chrome.storage.local.set({ amplifyProjects: projs });
      if (statusId) clr(statusId);
      return projs;
    }).catch(function(err) {
      if (statusId) sts(statusId, 'error', 'Failed to fetch projects: ' + err.message);
      return [];
    });
  });
}

function initActMap() {
  fetchAmplifyActivities('actmap-status').then(function() {
    chrome.storage.local.get(['activityMap']).then(function(s) {
      var defaults = { codes: { '201000': 1, '202010': 2, '203000': 10, '203020': 3, '204000': 5, '203010': 11 }, patterns: [], defaultId: 1 };
      var data = s.activityMap || defaults;
      // Ensure 203010 exists in saved map
      if (data.codes && !data.codes['203010']) data.codes['203010'] = 11;
      applyMappings(data);

      // Populate default dropdown
      var defSel = document.getElementById('default-activity');
      defSel.innerHTML = '<option value="">— Select —</option>';
      amplifyActivities.forEach(function(a) {
        var opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.name + ' (' + a.id + ')';
        if (a.id === data.defaultId) opt.selected = true;
        defSel.appendChild(opt);
      });

      // Populate code rows
      document.getElementById('code-mappings').innerHTML = '';
      Object.keys(data.codes).forEach(function(code) { addCodeRow(code, data.codes[code]); });

      // Populate pattern rows
      document.getElementById('pattern-mappings').innerHTML = '';
      data.patterns.forEach(function(p) { addPatternRow(p.pattern, p.activityId); });
    });
  });
}

/* ── Project Map ── */

function addProjRow(prefix, projId) {
  var div = document.createElement('div');
  div.className = 'map-row';
  var input = document.createElement('input');
  input.className = 'map-input'; input.type = 'text'; input.placeholder = 'VET';
  input.style.width = '80px'; input.style.textTransform = 'uppercase'; input.value = prefix || '';
  var arrow = document.createElement('span'); arrow.className = 'map-arrow'; arrow.textContent = '→';
  var projOpts = amplifyProjects.map(function(p) { return { id: p.id, name: p.name, client_id: p.client_id }; });
  var drop = createSearchDrop(projOpts, projId, '— Select Project —');
  var removeBtn = document.createElement('button'); removeBtn.className = 'map-remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function() { div.remove(); });
  div.appendChild(input); div.appendChild(arrow); div.appendChild(drop); div.appendChild(removeBtn);
  document.getElementById('proj-mappings').appendChild(div);
}

function collectProjMappings() {
  var map = {};
  document.querySelectorAll('#proj-mappings .map-row').forEach(function(row) {
    var prefix = row.querySelector('.map-input').value.trim().toUpperCase();
    var drop = row.querySelector('.sdrop');
    if (prefix && drop && drop.value) {
      var data = drop._extraData || {};
      map[prefix] = { project_id: parseInt(drop.value), client_id: data.client_id ? parseInt(data.client_id) : 0, project_name: data.name || '' };
    }
  });
  return map;
}

function initProjMap() {
  fetchAmplifyProjects('projmap-status').then(function() {
    chrome.storage.local.get(['projectMap']).then(function(s) {
      var data = s.projectMap || {};
      userProjectMap = data;

      document.getElementById('proj-mappings').innerHTML = '';
      Object.keys(data).forEach(function(prefix) { addProjRow(prefix, data[prefix].project_id); });
    });
  });
}

/* ── Task Map ── */

function createTicketSearchDrop(selectedKey) {
  var wrap = document.createElement('div');
  wrap.className = 'sdrop';
  wrap.style.minWidth = '160px';
  var display = document.createElement('div');
  display.className = 'sdrop-display' + (selectedKey ? '' : ' placeholder');
  display.textContent = selectedKey || '— Search Ticket —';
  var panel = document.createElement('div');
  panel.className = 'sdrop-panel';
  var search = document.createElement('input');
  search.className = 'sdrop-search';
  search.placeholder = 'Type ticket key or summary...';
  var list = document.createElement('div');
  list.className = 'sdrop-list';
  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(display);
  wrap.appendChild(panel);
  wrap._value = selectedKey || '';

  var debounce = null;
  var highlightIdx = -1;

  function renderResults(items) {
    list.innerHTML = '';
    highlightIdx = 0;
    if (!items.length) { var e = document.createElement('div'); e.className = 'sdrop-empty'; e.textContent = 'No results'; list.appendChild(e); return; }
    items.forEach(function(it, idx) {
      var item = document.createElement('div');
      item.className = 'sdrop-item';
      if (it.key === wrap._value) item.classList.add('selected');
      item.textContent = it.key + ' — ' + it.summary;
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        wrap._value = it.key;
        display.textContent = it.key;
        display.classList.remove('placeholder');
        panel.classList.remove('open');
        wrap.dispatchEvent(new Event('change'));
      });
      list.appendChild(item);
    });
  }

  function doSearch(q) {
    if (!q || q.length < 2) { list.innerHTML = ''; return; }
    list.innerHTML = '<div class="sdrop-empty">Searching...</div>';
    var jql = 'text ~ "' + q.replace(/"/g, '') + '" OR key = "' + q.toUpperCase().replace(/"/g, '') + '" ORDER BY updated DESC';
    var j = jira || new Jira(JIRA_DOMAIN);
    j._r('POST', '/rest/api/3/search/jql', { jql: jql, maxResults: 10, fields: ['key', 'summary'] }).then(function(r) {
      var items = (r.body.issues || []).map(function(i) { return { key: i.key, summary: i.fields.summary || '' }; });
      renderResults(items);
    }).catch(function() { list.innerHTML = '<div class="sdrop-empty">Search failed</div>'; });
  }

  search.addEventListener('input', function() {
    clearTimeout(debounce);
    debounce = setTimeout(function() { doSearch(search.value.trim()); }, 300);
  });
  search.addEventListener('click', function(e) { e.stopPropagation(); });
  search.addEventListener('keydown', function(e) {
    var items = list.querySelectorAll('.sdrop-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIdx = Math.min(highlightIdx + 1, items.length - 1); items.forEach(function(el, j) { el.classList.toggle('highlighted', j === highlightIdx); }); if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIdx = Math.max(highlightIdx - 1, 0); items.forEach(function(el, j) { el.classList.toggle('highlighted', j === highlightIdx); }); if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[highlightIdx]) items[highlightIdx].click(); }
    else if (e.key === 'Escape') { panel.classList.remove('open'); }
  });

  display.addEventListener('click', function(e) {
    e.stopPropagation();
    document.querySelectorAll('.sdrop-panel.open').forEach(function(p) { if (p !== panel) p.classList.remove('open'); });
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) { search.value = ''; list.innerHTML = ''; search.focus(); }
  });

  if (selectedKey) { wrap._value = selectedKey; display.textContent = selectedKey; display.classList.remove('placeholder'); }
  Object.defineProperty(wrap, 'value', { get: function() { return wrap._value; } });
  return wrap;
}

function addTaskRow(ticket, projId, actId) {
  var div = document.createElement('div');
  div.className = 'map-row';
  div.style.flexWrap = 'wrap';
  var ticketDrop = createTicketSearchDrop(ticket);
  var arrow = document.createElement('span'); arrow.className = 'map-arrow'; arrow.textContent = '→';

  var projOpts = amplifyProjects.map(function(p) { return { id: p.id, name: p.name, client_id: p.client_id }; });
  var projDrop = createSearchDrop(projOpts, projId, '— Project —');
  projDrop.style.maxWidth = '180px';

  var actOpts = amplifyActivities.map(function(a) { return { id: a.id, name: a.name }; });
  var actDrop = createSearchDrop(actOpts, actId, '— Activity —');
  actDrop.style.maxWidth = '180px';

  var removeBtn = document.createElement('button'); removeBtn.className = 'map-remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function() { div.remove(); });

  div.appendChild(ticketDrop); div.appendChild(arrow); div.appendChild(projDrop); div.appendChild(actDrop); div.appendChild(removeBtn);
  document.getElementById('task-mappings').appendChild(div);
}

function collectTaskMappings() {
  var map = {};
  document.querySelectorAll('#task-mappings .map-row').forEach(function(row) {
    var drops = row.querySelectorAll('.sdrop');
    var ticketDrop = drops[0], projDrop = drops[1], actDrop = drops[2];
    var ticket = ticketDrop ? ticketDrop.value.trim().toUpperCase() : '';
    if (!ticket) return;
    var entry = {};
    if (projDrop && projDrop.value) {
      var pd = projDrop._extraData || {};
      entry.project_id = parseInt(projDrop.value);
      entry.client_id = pd.client_id ? parseInt(pd.client_id) : 0;
      entry.project_name = pd.name || '';
    }
    if (actDrop && actDrop.value) {
      entry.activityId = parseInt(actDrop.value);
    }
    if (entry.project_id || entry.activityId) map[ticket] = entry;
  });
  return map;
}

function initTaskMap() {
  Promise.all([fetchAmplifyProjects('taskmap-status'), fetchAmplifyActivities('taskmap-status')]).then(function() {
    chrome.storage.local.get(['taskMap']).then(function(s) {
      var data = s.taskMap || {};
      userTaskMap = data;
      document.getElementById('task-mappings').innerHTML = '';
      Object.keys(data).forEach(function(ticket) {
        addTaskRow(ticket, data[ticket].project_id, data[ticket].activityId);
      });
      clr('taskmap-status');
    });
  });
}

/* ── Profile ── */
function loadProfile() {
  var card = document.getElementById('profile-card');
  card.innerHTML = '<div class="profile-card">' +
    '<div class="skeleton skel-avatar"></div>' +
    '<div class="profile-info">' +
      '<div class="skeleton skel-line w60"></div>' +
      '<div class="skeleton skel-line w80"></div>' +
      '<div class="skeleton skel-line w40"></div>' +
    '</div>' +
    '<div class="profile-right"><div class="skeleton skel-badge"></div></div>' +
  '</div>';
  var j = new Jira(JIRA_DOMAIN);
  j._r('GET', '/rest/api/3/myself?expand=groups,applicationRoles').then(function(r) {
    var u = r.body;
    var avatar = u.avatarUrls ? (u.avatarUrls['48x48'] || u.avatarUrls['32x32']) : '';
    var name = u.displayName || 'Unknown';
    var email = u.emailAddress || '';
    var tz = u.timeZone || '';
    // timezone no longer used — times are placed sequentially 2 PM–10 PM
    var org = '';
    if (u.groups && u.groups.items) {
      var g = u.groups.items.find(function(x) { return x.name !== 'jira-software-users' && !x.name.startsWith('jira-') && !x.name.startsWith('system-'); });
      if (g) org = g.name;
    }

    // Fetch extended profile — try cache first, then Atlassian GraphQL
    return chrome.storage.local.get(['cachedProfile']).then(function(cached) {
      var cp = cached.cachedProfile;
      if (cp && cp.accountId === u.accountId && cp.title && cp.department !== undefined) return cp;

      // Step 1: Get cloudId from Jira
      return fetch('https://' + JIRA_DOMAIN + '/_edge/tenant_info', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(function(r) { return r.json(); }).then(function(info) {
        var cloudId = info.cloudId;
        // Step 2: Get orgId by fetching home.atlassian.com (it redirects with orgId in URL)
        return fetch('https://home.atlassian.com', { credentials: 'include', redirect: 'follow' }).then(function(hr) {
          var orgMatch = hr.url.match(/\/o\/([a-f0-9-]{36})/);
          var orgId = orgMatch ? orgMatch[1] : '';
          return { cloudId: cloudId, orgId: orgId };
        });
      }).then(function(ids) {
        var vars = { userId: u.accountId, orgId: 'ari:cloud:platform::org/' + ids.orgId, cloudId: ids.cloudId, containerId: 'ari:cloud:townsquare::site/' + ids.cloudId, currentGoalsQuery: '', currentProjectsQuery: '' };
        var profilePageUrl = 'https://home.atlassian.com/o/' + ids.orgId + '/people/' + u.accountId + '?cloudId=' + ids.cloudId;

        // Step 3: Find persisted query hash from Atlassian's bundle
        return fetch(profilePageUrl, { credentials: 'include' })
      .then(function(pg) { return pg.text(); })
      .then(function(html) {
        // Find the UserProfilePage bundle URL
        var scripts = html.match(/assets\/[a-zA-Z0-9._-]+\.js/g) || [];
        var mainBundle = html.match(/assets\/main\.[a-f0-9]+\.js/);
        // Fetch main bundle to find chunk mapping for UserProfilePage
        if (!mainBundle) throw new Error('no main bundle');
        return fetch('https://home.atlassian.com/' + mainBundle[0]).then(function(r) { return r.text(); });
      }).then(function(mainJs) {
        // Find UserProfilePage chunk filename
        var m = mainJs.match(/UserProfilePage[^"]*?"([^"]+\.js)"/);
        if (!m) throw new Error('no UserProfilePage chunk');
        return fetch('https://home.atlassian.com/assets/' + m[1]).then(function(r) { return r.text(); });
      }).then(function(bundleJs) {
        // Extract the persisted query hash (64 char hex near userProfileQuery)
        var m = bundleJs.match(/id:"([a-f0-9]{64})"[^}]*name:"userProfileQuery"/);
        if (!m) {
          // Try alternate pattern
          var idx = bundleJs.indexOf('userProfileQuery');
          if (idx > -1) {
            var region = bundleJs.substring(Math.max(0, idx - 200), idx);
            var hm = region.match(/id:"([a-f0-9]{64})"/);
            if (hm) return hm[1];
          }
          throw new Error('hash not found');
        }
        return m[1];
      }).then(function(hash) {
        var gqlUrl = 'https://home.atlassian.com/gateway/api/graphql/pq/' + hash + '?operation=userProfileQuery&variables=' + encodeURIComponent(JSON.stringify(vars));
        return fetch(gqlUrl, { credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
      }).then(function(r2) { return r2.ok ? r2.json() : null; }).then(function(gql) {
        if (gql && gql.data && gql.data.user && gql.data.user.extendedProfile) {
          var ep = gql.data.user.extendedProfile;
          var profile = { accountId: u.accountId, title: ep.jobTitle || '', department: ep.department || '', location: ep.location || '' };
          chrome.storage.local.set({ cachedProfile: profile });
          return profile;
        }
        return cp || { title: '', location: '' };
      }).catch(function() { return cp || { title: '', location: '' }; });
      });
    }).then(function(profile) {
      var designation = profile.title || org || 'Team Member';
      var dept = profile.department || '';
      var loc = profile.location || tz;

      // Fetch role from priority tickets
      var j2 = new Jira(JIRA_DOMAIN);
      return j2.myTickets().then(function(tickets) {
        var roles = {};
        tickets.forEach(function(t) { if (t.role) roles[t.role] = true; });
        var roleList = Object.keys(roles);
        return roleList.length ? roleList : ['Team Member'];
      }).catch(function() { return ['Team Member']; }).then(function(roleList) {
        var rightHtml = roleList.map(function(r) { return '<span class="profile-role-badge">' + r + '</span>'; }).join(' ');
        card.innerHTML = '<div class="profile-card">' +
          (avatar ? '<img class="profile-avatar" src="' + avatar + '">' : '') +
          '<div class="profile-info">' +
            '<div class="profile-name">' + name + '</div>' +
            '<div class="profile-title">' + designation + '</div>' +
            '<div class="profile-email">' + email + '</div>' +
            (loc ? '<div class="profile-email">' + loc + '</div>' : '') +
          '</div>' +
          '<div class="profile-right">' + rightHtml + '</div>' +
        '</div>';
      });
    }).catch(function() {
      card.innerHTML = '<div class="profile-card">' +
        (avatar ? '<img class="profile-avatar" src="' + avatar + '">' : '') +
        '<div class="profile-info">' +
          '<div class="profile-name">' + name + '</div>' +
          '<div class="profile-title">' + (org || 'Team Member') + '</div>' +
          '<div class="profile-email">' + email + '</div>' +
          (tz ? '<div class="profile-email">' + tz + '</div>' : '') +
        '</div></div>';
    });
  }).catch(function() {
    card.innerHTML = '<p style="color:#6b778c;font-size:11px">Could not load profile. Log in to Jira first.</p>';
  });
}

/* ── Stats ── */
var statCalMonth, statCalYear, statStart = null, statEnd = null, statCalPicking = 'start';

function renderStatCal() {
  var title = document.getElementById('stat-cal-title');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  title.textContent = months[statCalMonth] + ' ' + statCalYear;
  var container = document.getElementById('stat-cal-days');
  container.innerHTML = '';
  var first = new Date(statCalYear, statCalMonth, 1);
  var dow = (first.getDay() + 6) % 7;
  var dim = new Date(statCalYear, statCalMonth + 1, 0).getDate();
  var prevDays = new Date(statCalYear, statCalMonth, 0).getDate();
  var todayStr = today();
  for (var i = dow - 1; i >= 0; i--) { var d = document.createElement('div'); d.className = 'cal-day other'; d.textContent = prevDays - i; container.appendChild(d); }
  for (var day = 1; day <= dim; day++) {
    var d = document.createElement('div'); d.className = 'cal-day'; d.textContent = day;
    var ds = statCalYear + '-' + String(statCalMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    d.dataset.date = ds;
    if (ds === todayStr) d.classList.add('today');
    if (statStart && statEnd) {
      if (ds === statStart && ds === statEnd) d.classList.add('sel-start', 'sel-end');
      else if (ds === statStart) d.classList.add('sel-start');
      else if (ds === statEnd) d.classList.add('sel-end');
      else if (ds > statStart && ds < statEnd) d.classList.add('in-range');
    } else if (statStart && ds === statStart) d.classList.add('sel-start', 'sel-end');
    d.addEventListener('click', onStatCalClick);
    container.appendChild(d);
  }
  var rem = (7 - (dow + dim) % 7) % 7;
  for (var i = 1; i <= rem; i++) { var d = document.createElement('div'); d.className = 'cal-day other'; d.textContent = i; container.appendChild(d); }
  var rangeEl = document.getElementById('stat-cal-range');
  if (statStart && statEnd) rangeEl.textContent = statStart + '  —  ' + statEnd;
  else if (statStart) rangeEl.textContent = statStart + '  —  click end date';
  else rangeEl.textContent = 'Click a start date';
}

function onStatCalClick(e) {
  var date = e.target.dataset.date; if (!date) return;
  document.querySelectorAll('.stat-preset').forEach(function(b) { b.classList.remove('active'); });
  if (statCalPicking === 'start') { statStart = date; statEnd = null; statCalPicking = 'end'; }
  else { if (date < statStart) { statEnd = statStart; statStart = date; } else statEnd = date; statCalPicking = 'start'; runStats(); }
  renderStatCal();
}

function applyStatPreset(mode) {
  var t = today();
  if (mode === 'week') { var d = new Date(t); d.setDate(d.getDate() - 6); statStart = isoStr(d); statEnd = t; }
  else if (mode === '2weeks') { var d = new Date(t); d.setDate(d.getDate() - 13); statStart = isoStr(d); statEnd = t; }
  else if (mode === 'month') { var d = new Date(t); d.setDate(d.getDate() - 29); statStart = isoStr(d); statEnd = t; }
  else if (mode === '60days') { var d = new Date(t); d.setDate(d.getDate() - 59); statStart = isoStr(d); statEnd = t; }
  else if (mode === '90days') { var d = new Date(t); d.setDate(d.getDate() - 89); statStart = isoStr(d); statEnd = t; }
  else if (mode === 'thismonth') { var parts = t.split('-'); statStart = parts[0] + '-' + parts[1] + '-01'; statEnd = t; }
  statCalPicking = 'start';
  var sd = new Date(statStart); statCalMonth = sd.getMonth(); statCalYear = sd.getFullYear();
  renderStatCal();
  runStats();
}

function runStats() {
  if (!statStart || !statEnd) return;
  var box = 'stats-status', out = document.getElementById('stats-results');
  out.innerHTML = '';
  sts(box, 'loading', '<span class="spinner"></span>Crunching your stats...');
  var j = jira || new Jira(JIRA_DOMAIN);
  var initP = j.uid ? Promise.resolve() : j.init();
  var td = statEnd, startDate = statStart;

  initP.then(function() {
    return Promise.all([
      j._r('GET', '/rest/api/3/field'),
      j.worklogs(startDate, td)
    ]);
  }).then(function(res) {
    var fields = res[0].body, wls = res[1];
    var roleFields = ['developer', 'developers', 'designer', 'designers', 'qa engineer', 'qa engineers', 'e-com manager', 'e-com managers', 'ecom manager', 'ecom managers'];
    var matched = fields.filter(function(f) { return roleFields.indexOf(f.name.toLowerCase()) !== -1; });
    var parts = matched.map(function(f) { return '"' + f.name + '" = currentUser()'; });
    if (!parts.length) parts = ['assignee = currentUser()'];
    var jql = '(' + parts.join(' OR ') + ') AND status NOT IN (Done, "Won\'t Do", "Selected for Setup Validation", "Setup Validation in Progress", "Ready to Launch")';
    return j._r('POST', '/rest/api/3/search/jql', { jql: jql, maxResults: 100, fields: ['key', 'summary', 'status', 'priority', 'issuetype', 'labels'] }).then(function(r) {
      return { issues: (r.body.issues || []), wls: wls };
    });
  }).then(function(d) {
    clr(box);
    var issues = d.issues, wls = d.wls;

    // Ticket counts
    var statusCounts = {}, priorityCounts = {}, typeCounts = {}, experimentCount = 0;
    issues.forEach(function(i) {
      var st = i.fields.status ? i.fields.status.name : 'Unknown';
      var pr = i.fields.priority ? i.fields.priority.name : 'Medium';
      var tp = i.fields.issuetype ? i.fields.issuetype.name : 'Task';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      priorityCounts[pr] = (priorityCounts[pr] || 0) + 1;
      typeCounts[tp] = (typeCounts[tp] || 0) + 1;
      var sum = (i.fields.summary || '').toLowerCase();
      var labels = (i.fields.labels || []).join(' ').toLowerCase();
      if (sum.indexOf('experiment') !== -1 || sum.indexOf('a/b') !== -1 || sum.indexOf('feasibility') !== -1 || labels.indexOf('experiment') !== -1) experimentCount++;
    });

    // Worklog stats
    var totalSecs = 0, actTime = {}, projTime = {}, dailyMins = {};
    wls.forEach(function(wl) {
      totalSecs += wl.timeSpentSeconds;
      var cm = parseComment(wl.comment, wl.projectKey);
      var aname = actName(cm.activityId);
      actTime[aname] = (actTime[aname] || 0) + wl.timeSpentSeconds;
      projTime[wl.project] = (projTime[wl.project] || 0) + wl.timeSpentSeconds;
      var t = toAmpTime(wl.started, wl.timeSpentSeconds);
      dailyMins[t.start_date] = (dailyMins[t.start_date] || 0) + Math.round(wl.timeSpentSeconds / 60);
    });

    // Workdays in range
    var workdays = 0, cursor = new Date(startDate);
    while (cursor <= new Date(td)) { var dow = cursor.getDay(); if (dow !== 0 && dow !== 6) workdays++; cursor.setDate(cursor.getDate() + 1); }
    var avgDaily = workdays > 0 ? Math.round(totalSecs / workdays) : 0;
    var highPrio = (priorityCounts['Highest'] || 0) + (priorityCounts['High'] || 0);

    // Count unique tickets from worklogs in this range
    var workedTickets = {};
    wls.forEach(function(wl) { workedTickets[wl.issueKey] = true; });
    var workedCount = Object.keys(workedTickets).length;

    var h = '';

    // Stats cards - single row
    h += '<div class="stat-grid stat-grid-6">';
    h += '<div class="stat-card"><div class="stat-val">' + workedCount + '</div><div class="stat-label">Tickets</div></div>';
    h += '<div class="stat-card"><div class="stat-val">' + highPrio + '</div><div class="stat-label">High Prio</div></div>';
    h += '<div class="stat-card"><div class="stat-val">' + experimentCount + '</div><div class="stat-label">Experiments</div></div>';
    h += '<div class="stat-card"><div class="stat-val">' + fd(totalSecs) + '</div><div class="stat-label">Logged</div></div>';
    h += '<div class="stat-card"><div class="stat-val">' + fd(avgDaily) + '</div><div class="stat-label">Avg/Day</div></div>';
    h += '<div class="stat-card"><div class="stat-val">' + wls.length + '</div><div class="stat-label">Worklogs</div></div>';
    h += '</div>';

    // Time by Activity
    var actEntries = Object.entries(actTime).sort(function(a, b) { return b[1] - a[1]; });
    if (actEntries.length) {
      var maxAct = actEntries[0][1];
      h += '<div class="stat-section"><div class="stat-section-title">Time by Activity</div>';
      actEntries.forEach(function(e) {
        var pct = Math.round(e[1] / maxAct * 100);
        h += '<div class="stat-bar-row"><div class="stat-bar-label">' + e[0] + '</div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div><div class="stat-bar-val">' + fd(e[1]) + '</div></div>';
      });
      h += '</div>';
    }

    // Time by Project
    var projEntries = Object.entries(projTime).sort(function(a, b) { return b[1] - a[1]; });
    if (projEntries.length) {
      var maxProj = projEntries[0][1];
      h += '<div class="stat-section"><div class="stat-section-title">Time by Project</div>';
      projEntries.forEach(function(e) {
        var pct = Math.round(e[1] / maxProj * 100);
        h += '<div class="stat-bar-row"><div class="stat-bar-label">' + e[0] + '</div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div><div class="stat-bar-val">' + fd(e[1]) + '</div></div>';
      });
      h += '</div>';
    }

    // By Status
    var maxSt = Math.max.apply(null, Object.values(statusCounts).concat([1]));
    h += '<div class="stat-section"><div class="stat-section-title">Tickets by Status</div>';
    Object.keys(statusCounts).sort(function(a, b) { return statusCounts[b] - statusCounts[a]; }).forEach(function(k) {
      var pct = Math.round(statusCounts[k] / maxSt * 100);
      h += '<div class="stat-bar-row"><div class="stat-bar-label">' + k + '</div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div><div class="stat-bar-val">' + statusCounts[k] + '</div></div>';
    });
    h += '</div>';


    // Tickets Worked On (from worklogs)
    var ticketTime = {};
    wls.forEach(function(wl) {
      var cm = parseComment(wl.comment, wl.projectKey);
      var aname = actName(cm.activityId);
      if (!ticketTime[wl.issueKey]) ticketTime[wl.issueKey] = { ticket: wl.issueKey, project: wl.project, secs: 0, activities: {} };
      ticketTime[wl.issueKey].secs += wl.timeSpentSeconds;
      ticketTime[wl.issueKey].activities[aname] = (ticketTime[wl.issueKey].activities[aname] || 0) + wl.timeSpentSeconds;
    });
    var ticketList = Object.values(ticketTime).sort(function(a, b) { return b.secs - a.secs; });
    if (ticketList.length) {
      h += '<div class="stat-section"><div class="stat-section-title">Tickets Worked On</div>';
      h += '<table><tr><th>Ticket</th><th>Project</th><th>Activity</th><th>Time Spent</th></tr>';
      ticketList.forEach(function(t) {
        var acts = Object.entries(t.activities).sort(function(a, b) { return b[1] - a[1]; }).map(function(a) { return '<span class="badge badge-blue">' + a[0] + '</span>'; }).join(' ');
        h += '<tr><td>' + ticketLink(t.ticket) + '</td><td>' + t.project + '</td><td>' + acts + '</td><td>' + fd(t.secs) + '</td></tr>';
      });
      h += '</table></div>';
    }

    out.innerHTML = h;
  }).catch(function(err) { sts(box, 'error', err.message); });
}

/* ═══ Init ═══ */
document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['amplifyEmail', 'amplifyPassword', 'activityMap', 'projectMap', 'taskMap', 'ecomMode']).then(function(s) {
    settings = s;

    // Load activity mappings from saved config
    if (s.activityMap) applyMappings(s.activityMap);
    if (s.projectMap) userProjectMap = s.projectMap;
    if (s.taskMap) userTaskMap = s.taskMap;

    document.querySelectorAll('.tab').forEach(function(b) { b.addEventListener('click', function() { showView(b.dataset.view); }); });

    // Calendar
    var now = new Date(today());
    calMonth = now.getMonth(); calYear = now.getFullYear();
    document.getElementById('cal-prev').addEventListener('click', function() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCal(); });
    document.getElementById('cal-next').addEventListener('click', function() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCal(); });
    document.querySelectorAll('.preset').forEach(function(b) { b.addEventListener('click', function() { document.querySelectorAll('.preset').forEach(function(x) { x.classList.remove('active'); }); b.classList.add('active'); applyPreset(b.dataset.mode); }); });
    renderCal();

    // Settings
    if (s.amplifyEmail) document.getElementById('amplify-email').value = s.amplifyEmail;
    if (s.amplifyPassword) document.getElementById('amplify-password').value = s.amplifyPassword;
    if (s.ecomMode) document.getElementById('ecom-mode').checked = true;

    document.getElementById('save-settings').addEventListener('click', function() {
      var ae = document.getElementById('amplify-email').value.trim();
      var ap = document.getElementById('amplify-password').value;
      var ec = document.getElementById('ecom-mode').checked;
      if (!ae || !ap) return;
      chrome.storage.local.set({ amplifyEmail: ae, amplifyPassword: ap, ecomMode: ec }).then(function() {
        settings = { amplifyEmail: ae, amplifyPassword: ap };
        amp = new Amp();
        detectJiraDomain().then(function(domain) {
          if (domain) { JIRA_DOMAIN = domain; jira = new Jira(JIRA_DOMAIN); loadProfile(); }
        });
        var msg = document.getElementById('save-msg'); msg.style.display = 'inline'; setTimeout(function() { msg.style.display = 'none'; }, 2000);
      });
    });

    // Activity Map buttons
    document.getElementById('add-code').addEventListener('click', function() { addCodeRow('', ''); });
    document.getElementById('save-actmap').addEventListener('click', function() {
      var data = collectMappings();
      chrome.storage.local.set({ activityMap: data }).then(function() {
        applyMappings(data);
        var msg = document.getElementById('actmap-save-msg');
        msg.style.display = 'inline';
        setTimeout(function() { msg.style.display = 'none'; }, 2000);
      });
    });

    // Project Map buttons
    document.getElementById('add-proj').addEventListener('click', function() { addProjRow('', ''); });
    document.getElementById('save-projmap').addEventListener('click', function() {
      var data = collectProjMappings();
      chrome.storage.local.set({ projectMap: data }).then(function() {
        userProjectMap = data;
        var msg = document.getElementById('projmap-save-msg');
        msg.style.display = 'inline';
        setTimeout(function() { msg.style.display = 'none'; }, 2000);
      });
    });

    // Task Map buttons
    document.getElementById('add-task').addEventListener('click', function() { addTaskRow('', '', ''); });
    document.getElementById('save-taskmap').addEventListener('click', function() {
      var data = collectTaskMappings();
      chrome.storage.local.set({ taskMap: data }).then(function() {
        userTaskMap = data;
        var msg = document.getElementById('taskmap-save-msg');
        msg.style.display = 'inline';
        setTimeout(function() { msg.style.display = 'none'; }, 2000);
      });
    });

    // Stats calendar
    var sNow = new Date(today());
    statCalMonth = sNow.getMonth(); statCalYear = sNow.getFullYear();
    document.getElementById('stat-cal-prev').addEventListener('click', function() { statCalMonth--; if (statCalMonth < 0) { statCalMonth = 11; statCalYear--; } renderStatCal(); });
    document.getElementById('stat-cal-next').addEventListener('click', function() { statCalMonth++; if (statCalMonth > 11) { statCalMonth = 0; statCalYear++; } renderStatCal(); });
    document.querySelectorAll('.stat-preset').forEach(function(b) { b.addEventListener('click', function() { document.querySelectorAll('.stat-preset').forEach(function(x) { x.classList.remove('active'); }); b.classList.add('active'); applyStatPreset(b.dataset.mode); }); });
    renderStatCal();

    if (!s.amplifyEmail || !s.amplifyPassword) { showView('settings'); return; }

    detectJiraDomain().then(function(domain) {
      if (!domain) { sts('sync-status', 'error', 'Could not detect Jira domain. Log in to Jira in your browser first.'); return; }
      JIRA_DOMAIN = domain;
      jira = new Jira(JIRA_DOMAIN); amp = new Amp();
      loadProfile();
      showView('sync');
    });

  });
});
