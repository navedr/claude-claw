import http from 'http'
import { getJobsWithTasks, getUsageTotals, deleteJob } from './db.js'
import { logger } from './logger.js'
import type { Database } from 'better-sqlite3'

type SseClient = http.ServerResponse

let _db: Database | null = null
const sseClients = new Set<SseClient>()

export function pushEvent(type: string, data: unknown): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(payload)
  }
}

export function formatStatusText(): string {
  const jobs = getJobsWithTasks(20) as Array<{
    id: string; prompt: string; status: string; created_at: number;
    duration_ms?: number;
    tasks: Array<{ agent_label: string; status: string }>
  }>
  const running = jobs.filter(j => j.status === 'running')
  const done = jobs.filter(j => j.status !== 'running').slice(0, 3)
  const usage = getUsageTotals() as Array<{ api: string; metric: string; total: number }>

  const lines: string[] = []
  lines.push(`Running jobs: ${running.length}`)
  for (const j of running) {
    const elapsed = Math.floor((Date.now() - j.created_at) / 1000)
    lines.push(`  [${j.id.slice(0, 6)}] "${j.prompt.slice(0, 50)}" — ${elapsed}s, ${j.tasks.length} sub-agents`)
  }

  if (usage.length > 0) {
    lines.push('\nToday\'s usage:')
    const byApi: Record<string, Record<string, number>> = {}
    for (const u of usage) {
      byApi[u.api] = byApi[u.api] ?? {}
      byApi[u.api][u.metric] = u.total
    }
    for (const [api, metrics] of Object.entries(byApi)) {
      const parts = Object.entries(metrics).map(([k, v]) => `${v} ${k}`)
      lines.push(`  ${api}: ${parts.join(' / ')}`)
    }
  }

  if (done.length > 0) {
    lines.push(`\nLast ${done.length} completed:`)
    for (const j of done) {
      const dur = j['duration_ms'] ? `${Math.floor((j['duration_ms'] as number) / 1000)}s` : '?'
      lines.push(`  [${j.id.slice(0, 6)}] ${j.status === 'done' ? 'Done' : 'Failed'} in ${dur}`)
    }
  }

  return lines.join('\n')
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClaudeClaw Mission Control</title>
<style>
  :root {
    --bg1: #0d0d0d;
    --bg2: #1a1a1a;
    --bg3: #242424;
    --t1: #f0f0f0;
    --t2: #9a9a9a;
    --accent: #7c6aff;
    --green: #4ade80;
    --red: #f87171;
    --yellow: #fbbf24;
    --border: rgba(255,255,255,0.08);
  }
  [data-theme=light] {
    --bg1: #f5f5f5;
    --bg2: #ffffff;
    --bg3: #ebebeb;
    --t1: #1a1a1a;
    --t2: #666;
    --border: rgba(0,0,0,0.08);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg1); color: var(--t1); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 1px solid var(--border);
    background: var(--bg2); position: sticky; top: 0; z-index: 10;
  }
  header h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
  .header-right { display: flex; align-items: center; gap: 12px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; margin-right: 4px; }
  .live-dot.off { background: var(--t2); }
  .theme-btn { background: none; border: 1px solid var(--border); color: var(--t2); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .layout { display: grid; grid-template-columns: 1fr 280px; gap: 0; height: calc(100vh - 49px); overflow: hidden; }
  .main { overflow-y: auto; padding: 16px; }
  .sidebar { border-left: 1px solid var(--border); overflow-y: auto; padding: 16px; background: var(--bg2); }
  .section-title { font-size: 11px; font-weight: 600; color: var(--t2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .job-card {
    background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 12px; cursor: pointer;
    backdrop-filter: blur(4px); transition: border-color 0.15s;
  }
  .job-card:hover { border-color: var(--accent); }
  .job-card.expanded .job-body { display: block; }
  .job-header { padding: 12px 14px; display: flex; align-items: center; gap: 10px; }
  .job-id { font-size: 11px; color: var(--accent); font-weight: 700; min-width: 52px; }
  .job-prompt { flex: 1; color: var(--t1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .job-elapsed { color: var(--t2); font-size: 11px; min-width: 40px; text-align: right; }
  .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 600; }
  .status-running { background: rgba(124,106,255,0.2); color: var(--accent); }
  .status-done { background: rgba(74,222,128,0.15); color: var(--green); }
  .status-failed { background: rgba(248,113,113,0.15); color: var(--red); }
  .job-body { display: none; padding: 0 14px 14px; border-top: 1px solid var(--border); }
  .job-full-prompt { color: var(--t2); margin: 10px 0 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .task-list { display: flex; flex-direction: column; gap: 6px; }
  .task-row { display: flex; align-items: center; gap: 8px; }
  .agent-avatar {
    width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
  }
  .task-label { flex: 1; color: var(--t2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .task-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-running { background: var(--accent); }
  .dot-done { background: var(--green); }
  .dot-failed { background: var(--red); }
  .usage-block { margin-bottom: 16px; }
  .usage-api { font-weight: 600; color: var(--t1); margin-bottom: 4px; }
  .usage-row { display: flex; justify-content: space-between; color: var(--t2); font-size: 12px; margin-bottom: 2px; }
  .history-item {
    padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border);
    margin-bottom: 6px; cursor: pointer; position: relative; transition: border-color 0.15s;
  }
  .history-item:hover { border-color: var(--accent); }
  .history-item:hover .del-btn { display: block; }
  .history-id { font-size: 11px; color: var(--accent); font-weight: 700; }
  .history-prompt { color: var(--t2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .del-btn {
    display: none; position: absolute; top: 6px; right: 6px;
    background: var(--red); color: #fff; border: none; border-radius: 4px;
    font-size: 10px; padding: 2px 6px; cursor: pointer;
  }
  .back-btn {
    background: var(--bg3); border: 1px solid var(--border); color: var(--t2);
    padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
    margin-bottom: 12px; display: none;
  }
  .empty { color: var(--t2); font-size: 12px; padding: 16px 0; text-align: center; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
</style>
</head>
<body>
<header>
  <h1>ClaudeClaw Mission Control</h1>
  <div class="header-right">
    <span id="live-indicator"><span class="live-dot" id="live-dot"></span><span id="live-label">Connecting...</span></span>
    <button class="theme-btn" onclick="toggleTheme()">&#9728;</button>
  </div>
</header>
<div class="layout">
  <div class="main">
    <button class="back-btn" id="back-btn" onclick="goLive()">&#8592; Back to live</button>
    <div class="section-title" id="running-title">RUNNING (0)</div>
    <div id="running-jobs"></div>
    <hr class="divider">
    <div class="section-title">HISTORY</div>
    <div id="history-jobs"></div>
  </div>
  <div class="sidebar">
    <div class="section-title">TOKEN USAGE</div>
    <div id="usage-panel"><div class="empty">No usage yet today.</div></div>
  </div>
</div>
<script>
(function() {
  const COLORS = ['#7c6aff','#06b6d4','#f59e0b','#10b981','#f43f5e','#8b5cf6','#14b8a6','#fb923c'];
  let agentColors = {};
  let agentColorIdx = 0;
  function agentColor(label) {
    if (!agentColors[label]) agentColors[label] = COLORS[agentColorIdx++ % COLORS.length];
    return agentColors[label];
  }

  let currentMode = 'live';
  let state = { jobs: [], usage: [] };
  let elapsedTimers = {};

  function applyTheme() {
    const t = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  }
  window.toggleTheme = function() {
    const cur = localStorage.getItem('theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme();
  };
  applyTheme();

  function statusBadge(s) {
    return '<span class="status-badge status-' + s + '">' + s + '</span>';
  }

  function dotClass(s) {
    return s === 'running' ? 'dot-running' : s === 'done' ? 'dot-done' : 'dot-failed';
  }

  function elapsed(createdAt) {
    return Math.floor((Date.now() - createdAt) / 1000) + 's';
  }

  function renderTask(t) {
    const c = agentColor(t.agent_label);
    const initial = (t.agent_label || '?')[0].toUpperCase();
    return '<div class="task-row">' +
      '<div class="agent-avatar" style="background:' + c + '">' + initial + '</div>' +
      '<span class="task-label">' + escHtml(t.agent_label) + '</span>' +
      '<div class="task-dot ' + dotClass(t.status) + '"></div>' +
      '</div>';
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderJobCard(job, expanded) {
    const cls = 'job-card' + (expanded ? ' expanded' : '');
    const tasksHtml = job.tasks && job.tasks.length
      ? '<div class="task-list">' + job.tasks.map(renderTask).join('') + '</div>'
      : '<div style="color:var(--t2);font-size:12px;">(single agent)</div>';
    return '<div class="' + cls + '" data-id="' + job.id + '" onclick="toggleCard(this)">' +
      '<div class="job-header">' +
        '<span class="job-id">' + job.id.slice(0, 6) + '</span>' +
        '<span class="job-prompt">' + escHtml((job.prompt || '').slice(0, 60)) + '</span>' +
        '<span class="job-elapsed" data-created="' + job.created_at + '">' + elapsed(job.created_at) + '</span>' +
        statusBadge(job.status) +
      '</div>' +
      '<div class="job-body">' +
        '<div class="job-full-prompt">' + escHtml(job.prompt || '') + '</div>' +
        tasksHtml +
      '</div>' +
    '</div>';
  }

  window.toggleCard = function(el) {
    el.classList.toggle('expanded');
  };

  function renderHistory(jobs) {
    if (!jobs.length) return '<div class="empty">No completed jobs yet.</div>';
    return jobs.slice(0, 20).map(j => {
      const dur = j.duration_ms ? Math.floor(j.duration_ms / 1000) + 's' : '?';
      const label = j.status === 'done' ? 'Done' : 'Failed';
      return '<div class="history-item" data-id="' + j.id + '" onclick="showHistory(\\'' + j.id + '\\')">' +
        '<button class="del-btn" onclick="event.stopPropagation();deleteJob(\\'' + j.id + '\\')">Delete</button>' +
        '<div class="history-id">' + j.id.slice(0, 6) + '</div>' +
        '<div class="history-prompt">' + label + ' in ' + dur + ' — ' + escHtml((j.prompt || '').slice(0, 50)) + '</div>' +
      '</div>';
    }).join('');
  }

  window.showHistory = function(id) {
    if (currentMode !== 'live') return;
    currentMode = 'history';
    document.getElementById('back-btn').style.display = 'block';
    const job = state.jobs.find(j => j.id === id);
    if (!job) return;
    document.getElementById('running-title').textContent = 'JOB DETAIL';
    document.getElementById('running-jobs').innerHTML = renderJobCard(job, true);
  };

  window.goLive = function() {
    currentMode = 'live';
    document.getElementById('back-btn').style.display = 'none';
    render();
  };

  window.deleteJob = function(id) {
    fetch('/api/jobs/' + id, { method: 'DELETE' })
      .then(() => {
        state.jobs = state.jobs.filter(j => j.id !== id);
        render();
      });
  };

  function renderUsage(usageRows) {
    if (!usageRows || !usageRows.length) {
      document.getElementById('usage-panel').innerHTML = '<div class="empty">No usage yet today.</div>';
      return;
    }
    const byApi = {};
    for (const u of usageRows) {
      byApi[u.api] = byApi[u.api] || {};
      byApi[u.api][u.metric] = u.total;
    }
    let html = '';
    for (const [api, metrics] of Object.entries(byApi)) {
      html += '<div class="usage-block"><div class="usage-api">' + escHtml(api) + '</div>';
      for (const [metric, val] of Object.entries(metrics)) {
        html += '<div class="usage-row"><span>' + escHtml(metric) + '</span><span>' + Number(val).toLocaleString() + '</span></div>';
      }
      html += '</div>';
    }
    document.getElementById('usage-panel').innerHTML = html;
  }

  function render() {
    if (currentMode !== 'live') return;
    const running = state.jobs.filter(j => j.status === 'running');
    const history = state.jobs.filter(j => j.status !== 'running');
    document.getElementById('running-title').textContent = 'RUNNING (' + running.length + ')';
    document.getElementById('running-jobs').innerHTML = running.length
      ? running.map(j => renderJobCard(j, false)).join('')
      : '<div class="empty">No jobs running.</div>';
    document.getElementById('history-jobs').innerHTML = renderHistory(history);
    renderUsage(state.usage);
  }

  function startElapsedUpdater() {
    setInterval(() => {
      document.querySelectorAll('[data-created]').forEach(el => {
        const created = parseInt(el.getAttribute('data-created') || '0');
        el.textContent = elapsed(created);
      });
    }, 1000);
  }

  // SSE connection
  function connect() {
    const evtSrc = new EventSource('/api/events');
    document.getElementById('live-dot').className = 'live-dot off';
    document.getElementById('live-label').textContent = 'Connecting...';

    evtSrc.addEventListener('full_state', (e) => {
      const d = JSON.parse(e.data);
      state = d;
      document.getElementById('live-dot').className = 'live-dot';
      document.getElementById('live-label').textContent = 'Live';
      render();
    });

    evtSrc.addEventListener('job_created', (e) => {
      if (currentMode !== 'live') return;
      const job = JSON.parse(e.data);
      state.jobs.unshift(job);
      render();
    });

    evtSrc.addEventListener('job_updated', (e) => {
      if (currentMode !== 'live') return;
      const upd = JSON.parse(e.data);
      const idx = state.jobs.findIndex(j => j.id === upd.id);
      if (idx !== -1) Object.assign(state.jobs[idx], upd);
      render();
    });

    evtSrc.addEventListener('task_created', (e) => {
      if (currentMode !== 'live') return;
      const t = JSON.parse(e.data);
      const job = state.jobs.find(j => j.id === t.correlation_id);
      if (job) { job.tasks = job.tasks || []; if (!job.tasks.find(x => x.agent_label === t.agent_label)) job.tasks.push(t); }
      render();
    });

    evtSrc.addEventListener('task_updated', (e) => {
      if (currentMode !== 'live') return;
      const t = JSON.parse(e.data);
      const job = state.jobs.find(j => j.id === t.correlation_id);
      if (job) { const task = (job.tasks || []).find(x => x.agent_label === t.agent_label); if (task) Object.assign(task, t); }
      render();
    });

    evtSrc.onerror = () => {
      document.getElementById('live-dot').className = 'live-dot off';
      document.getElementById('live-label').textContent = 'Reconnecting...';
      evtSrc.close();
      setTimeout(connect, 3000);
    };
  }

  startElapsedUpdater();
  connect();
})();
</script>
</body>
</html>`
}

export function initDashboard(_db: Database): void {
  _db = _db

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/'

    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      })
      res.end(getHTML())
      return
    }

    if (req.method === 'GET' && url === '/api/state') {
      const data = { jobs: getJobsWithTasks(), usage: getUsageTotals() }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
      return
    }

    if (req.method === 'GET' && url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      sseClients.add(res)
      // Send full state on connect
      const data = { jobs: getJobsWithTasks(), usage: getUsageTotals() }
      res.write(`event: full_state\ndata: ${JSON.stringify(data)}\n\n`)
      req.on('close', () => sseClients.delete(res))
      return
    }

    if (req.method === 'DELETE' && url.startsWith('/api/jobs/')) {
      const id = url.slice('/api/jobs/'.length)
      if (id) deleteJob(id)
      res.writeHead(200)
      res.end()
      return
    }

    res.writeHead(404)
    res.end()
  })

  const bindHost = process.env.DASHBOARD_BIND ?? '0.0.0.0'
  server.listen(3847, bindHost, () => {
    logger.info('Dashboard running at http://localhost:3847')
  })

  // Poll for state changes every 2s and push SSE
  setInterval(() => {
    if (sseClients.size === 0) return
    const data = { jobs: getJobsWithTasks(), usage: getUsageTotals() }
    pushEvent('full_state', data)
  }, 2000)
}
