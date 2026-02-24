// Auto-generated admin panel HTML — edit the template string below.

export const ADMIN_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Party · 会话管理</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #09090b;
    --muted: #71717a;
    --border: #e4e4e7;
    --accent: #18181b;
    --badge-idle: #a1a1aa;
    --badge-active: #16a34a;
    --badge-cooldown: #eab308;
    --badge-closing: #f97316;
    --badge-closed: #ef4444;
    --card-bg: #fafafa;
    --hover: #f4f4f5;
    --radius: 8px;
    --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font); background: var(--bg); color: var(--fg); font-size: 14px; line-height: 1.6; }

  /* ── Layout ─────────────────────────── */
  .container { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 0; margin-bottom: 24px; border-bottom: 1px solid var(--border);
  }
  header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  header .meta { display: flex; align-items: center; gap: 16px; color: var(--muted); font-size: 13px; }

  .toolbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 20px;
  }
  .toolbar .left { display: flex; align-items: center; gap: 12px; }
  .toolbar .count { color: var(--muted); font-size: 13px; }

  /* ── Buttons ────────────────────────── */
  button {
    border: 1px solid var(--border); background: var(--bg); color: var(--fg);
    padding: 6px 14px; border-radius: var(--radius); font-size: 13px; font-family: var(--font);
    cursor: pointer; transition: all .15s;
  }
  button:hover { background: var(--hover); }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.primary:hover { opacity: .9; }
  button.danger { color: #ef4444; border-color: #fecaca; }
  button.danger:hover { background: #fef2f2; }
  button.sm { padding: 3px 10px; font-size: 12px; }

  /* ── Cards ──────────────────────────── */
  .card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px; cursor: pointer;
    box-shadow: var(--shadow); transition: all .15s;
  }
  .card:hover { border-color: #a1a1aa; transform: translateY(-1px); }
  .card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
  .card-header h3 { font-size: 14px; font-weight: 600; font-family: var(--mono); word-break: break-all; }

  .badge {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: 9999px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
  }
  .badge-idle { background: #f4f4f5; color: var(--badge-idle); }
  .badge-active { background: #f0fdf4; color: var(--badge-active); }
  .badge-cooldown { background: #fefce8; color: var(--badge-cooldown); }
  .badge-closing { background: #fff7ed; color: var(--badge-closing); }
  .badge-closed { background: #fef2f2; color: var(--badge-closed); }

  .card-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .stat { text-align: center; }
  .stat-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }

  .card-meta {
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    font-size: 12px; color: var(--muted);
  }
  .topic-tag {
    display: inline-block; max-width: 200px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
    background: #f4f4f5; padding: 2px 8px; border-radius: 4px; font-size: 12px;
  }

  /* ── Empty ──────────────────────────── */
  .empty {
    text-align: center; padding: 60px 20px; color: var(--muted);
  }
  .empty-icon { font-size: 48px; margin-bottom: 12px; opacity: .5; }
  .empty p { font-size: 15px; }

  /* ── Detail panel ───────────────────── */
  .detail-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.3);
    display: none; justify-content: flex-end; z-index: 100;
  }
  .detail-overlay.open { display: flex; }
  .detail-panel {
    width: 580px; max-width: 92vw; height: 100vh; background: var(--bg);
    border-left: 1px solid var(--border); overflow-y: auto; padding: 28px;
    box-shadow: -4px 0 24px rgba(0,0,0,.08);
  }
  .detail-close {
    position: absolute; top: 16px; right: 16px; background: none; border: none;
    font-size: 24px; cursor: pointer; color: var(--muted); padding: 4px 8px; line-height: 1;
  }
  .detail-close:hover { color: var(--fg); }

  .detail-panel h2 { font-size: 18px; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .detail-section { margin-bottom: 24px; }
  .detail-section h4 {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin-bottom: 8px;
  }

  .kv-table { width: 100%; border-collapse: collapse; }
  .kv-table td {
    padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top;
  }
  .kv-table td:first-child { width: 130px; color: var(--muted); font-weight: 500; }
  .kv-table td:last-child { font-family: var(--mono); font-size: 12px; word-break: break-all; }

  /* ── Queue table ────────────────────── */
  .q-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .q-table th {
    text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
    border-bottom: 2px solid var(--border);
  }
  .q-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-family: var(--mono); }
  .q-table tr:hover td { background: var(--hover); }

  .priority-high { color: #ef4444; font-weight: 600; }
  .priority-medium { color: #eab308; font-weight: 600; }
  .priority-low { color: #a1a1aa; }

  /* ── Event log ──────────────────────── */
  .log-list {
    max-height: 400px; overflow-y: auto;
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  .log-item {
    display: flex; gap: 10px; padding: 6px 12px; font-size: 12px; font-family: var(--mono);
    border-bottom: 1px solid var(--border); align-items: baseline;
  }
  .log-item:last-child { border-bottom: none; }
  .log-item:hover { background: var(--hover); }
  .log-time { color: var(--muted); white-space: nowrap; min-width: 80px; }
  .log-type { font-weight: 600; min-width: 130px; }
  .log-sender { color: var(--muted); }
  .log-expand {
    margin-left: auto; color: var(--muted); cursor: pointer;
    font-size: 11px; user-select: none; flex-shrink: 0;
  }
  .log-expand:hover { color: var(--fg); }
  .log-payload {
    display: none; padding: 6px 12px 10px 92px; font-size: 11px;
    color: var(--muted); font-family: var(--mono);
    border-bottom: 1px solid var(--border); background: #fafafa;
    white-space: pre-wrap; word-break: break-all;
  }
  .log-payload.open { display: block; }

  /* ── Token bar ──────────────────────── */
  .token-bar {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; border-radius: var(--radius);
  }
  .token-bar.has-token { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .token-bar.empty-token { background: #f4f4f5; border: 1px solid var(--border); color: var(--muted); }
  .token-holder { font-weight: 700; font-size: 14px; }
  .token-id { font-family: var(--mono); font-size: 11px; color: var(--muted); }

  /* ── Refresh indicator ──────────────── */
  .refresh-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #16a34a;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .3; }
  }

  /* ── Scrollbar ──────────────────────── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 3px; }
</style>
</head>
<body>

<div class="container">
  <header>
    <h1>AI Party · 会话管理</h1>
    <div class="meta">
      <div class="refresh-dot"></div>
      <span id="refreshInfo">自动刷新: 3秒</span>
      <span id="clock"></span>
    </div>
  </header>

  <div class="toolbar">
    <div class="left">
      <button class="primary" onclick="createSession()">+ 新建会话</button>
      <button onclick="refresh()">刷新</button>
      <span class="count" id="sessionCount">0 个会话</span>
    </div>
  </div>

  <div id="content">
    <div class="empty">
      <div class="empty-icon">...</div>
      <p>正在加载会话...</p>
    </div>
  </div>
</div>

<!-- detail slide-over -->
<div class="detail-overlay" id="detailOverlay" onclick="if(event.target===this)closeDetail()">
  <div class="detail-panel" style="position:relative;">
    <button class="detail-close" onclick="closeDetail()">&times;</button>
    <div id="detailContent"></div>
  </div>
</div>

<script>
const API = location.origin;
let sessions = [];
let activeDetail = null;

var stateLabel = { idle: '\u7a7a\u95f2', active: '\u8fdb\u884c\u4e2d', cooldown: '\u51b7\u5374\u4e2d', closing: '\u5173\u95ed\u4e2d', closed: '\u5df2\u5173\u95ed' };
function sl(s) { return stateLabel[s] || s; }
var priorityLabel = { high: '\u9ad8', medium: '\u4e2d', low: '\u4f4e' };
function pl(p) { return priorityLabel[p] || p; }

// ── Fetch ──────────────────────────────

async function fetchSessions() {
  const res = await fetch(API + '/sessions');
  return res.json();
}

async function fetchSessionDetail(id) {
  const res = await fetch(API + '/sessions/' + id);
  if (!res.ok) return null;
  return res.json();
}

async function fetchEvents(id) {
  const res = await fetch(API + '/admin/sessions/' + id + '/events');
  if (!res.ok) return [];
  return res.json();
}

async function createSession() {
  const res = await fetch(API + '/sessions', { method: 'POST' });
  if (res.ok) refresh();
}

async function deleteSession(id) {
  if (!confirm('确认删除会话 ' + id.slice(0, 8) + '... ?')) return;
  await fetch(API + '/sessions/' + id, { method: 'DELETE' });
  if (activeDetail === id) closeDetail();
  refresh();
}

// ── Render list ────────────────────────

async function refresh() {
  try { sessions = await fetchSessions(); } catch { sessions = []; }
  document.getElementById('sessionCount').textContent =
    sessions.length + ' 个会话';

  var content = document.getElementById('content');
  if (sessions.length === 0) {
    content.innerHTML =
      '<div class="empty"><div class="empty-icon">暂无数据</div>' +
      '<p>还没有会话，点击 <b>+ 新建会话</b> 创建一个。</p></div>';
    return;
  }

  content.innerHTML = '<div class="card-grid">' + sessions.map(renderCard).join('') + '</div>';
  if (activeDetail) showDetail(activeDetail);
}

function renderCard(s) {
  var created = new Date(s.created_at).toLocaleString('zh-CN', { hour12: false });
  var topicHtml = s.topic
    ? '<span class="topic-tag" title="' + esc(s.topic) + '">' + esc(s.topic) + '</span>'
    : '<span style="color:var(--muted)">--</span>';
  return '<div class="card" onclick="showDetail(\\'' + s.session_id + '\\')">' +
    '<div class="card-header">' +
      '<h3>' + s.session_id.slice(0, 8) + '...</h3>' +
      '<span class="badge badge-' + s.state + '">' + sl(s.state) + '</span>' +
    '</div>' +
    '<div class="card-stats">' +
      '<div class="stat"><div class="stat-value">' + (s.clients || 0) + '</div><div class="stat-label">连接数</div></div>' +
      '<div class="stat"><div class="stat-value">' + topicHtml + '</div><div class="stat-label">话题</div></div>' +
      '<div class="stat"><div class="stat-value">' + (s.state === 'active' ? '进行中' : '--') + '</div><div class="stat-label">状态</div></div>' +
    '</div>' +
    '<div class="card-meta">' +
      '<span>创建于: ' + created + '</span>' +
      '<button class="sm danger" onclick="event.stopPropagation();deleteSession(\\'' + s.session_id + '\\')">删除</button>' +
    '</div>' +
  '</div>';
}

// ── Detail panel ───────────────────────

async function showDetail(id) {
  activeDetail = id;
  var data = await fetchSessionDetail(id);
  if (!data) { closeDetail(); return; }

  document.getElementById('detailOverlay').classList.add('open');

  var created = new Date(data.created_at).toLocaleString('zh-CN', { hour12: false });

  // Token
  var tokenHtml;
  if (data.current_token) {
    tokenHtml = '<div class="token-bar has-token">' +
      '<span class="token-holder">' + esc(data.current_token.holder) + '</span>' +
      '<span class="token-id">' + data.current_token.token_id.slice(0, 8) + '... TTL ' + data.current_token.ttl_sec + 's</span>' +
    '</div>';
  } else {
    tokenHtml = '<div class="token-bar empty-token">暂无活跃令牌</div>';
  }

  // Queue
  var queueHtml;
  if (data.queue && data.queue.length > 0) {
    queueHtml = '<table class="q-table"><thead><tr>' +
      '<th>智能体</th><th>意图</th><th>优先级</th><th>原因</th><th>分数</th>' +
    '</tr></thead><tbody>';
    data.queue.forEach(function(q) {
      queueHtml += '<tr>' +
        '<td>' + esc(q.sender_id) + '</td>' +
        '<td>' + esc(q.intent) + '</td>' +
        '<td class=\"priority-' + q.priority + '\">' + pl(q.priority) + '</td>' +
        '<td>' + esc(q.reason_code) + '</td>' +
        '<td>' + q.score.toFixed(1) + '</td>' +
      '</tr>';
    });
    queueHtml += '</tbody></table>';
  } else {
    queueHtml = '<div style="color:var(--muted);font-size:13px;">队列为空</div>';
  }

  // Events
  var events = [];
  try { events = await fetchEvents(id); } catch {}

  var logHtml;
  if (events.length > 0) {
    var shown = events.slice(-200);
    logHtml = '<div class="log-list">';
    shown.forEach(function(ev, idx) {
      var time = new Date(ev.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
      var payloadStr = JSON.stringify(ev.payload, null, 2);
      logHtml += '<div class="log-item" onclick="togglePayload(' + idx + ')">' +
        '<span class="log-time">' + time + '</span>' +
        '<span class="log-type">' + esc(ev.event_type) + '</span>' +
        '<span class="log-sender">' + esc(ev.sender_id) + '</span>' +
        '<span class="log-expand">载荷</span>' +
      '</div>' +
      '<div class="log-payload" id="payload-' + idx + '">' + esc(payloadStr) + '</div>';
    });
    logHtml += '</div>';
  } else {
    logHtml = '<div style="color:var(--muted);font-size:13px;">暂无事件</div>';
  }

  document.getElementById('detailContent').innerHTML =
    '<h2>会话 <span style="font-family:var(--mono);font-size:14px;color:var(--muted)">' + id.slice(0, 12) + '...</span> ' +
      '<span class="badge badge-' + data.state + '">' + sl(data.state) + '</span></h2>' +

    '<div class="detail-section"><h4>概览</h4>' +
    '<table class="kv-table">' +
      '<tr><td>会话 ID</td><td>' + id + '</td></tr>' +
      '<tr><td>状态</td><td>' + sl(data.state) + '</td></tr>' +
      '<tr><td>话题</td><td>' + (data.topic ? esc(data.topic) : '--') + '</td></tr>' +
      '<tr><td>创建时间</td><td>' + created + '</td></tr>' +
      '<tr><td>连接数</td><td>' + (data.clients || 0) + '</td></tr>' +
      '<tr><td>事件日志</td><td>' + data.event_log_length + ' 条事件</td></tr>' +
    '</table></div>' +

    '<div class="detail-section"><h4>当前令牌</h4>' + tokenHtml + '</div>' +

    '<div class="detail-section"><h4>举手队列 (' + (data.queue ? data.queue.length : 0) + ')</h4>' + queueHtml + '</div>' +

    '<div class="detail-section"><h4>事件日志 (最近 200 条)</h4>' + logHtml + '</div>' +

    '<div style="margin-top:32px;display:flex;gap:10px;">' +
      '<button class="danger" onclick="deleteSession(\\'' + id + '\\')">' + '删除会话</button>' +
    '</div>';
}

function togglePayload(idx) {
  var el = document.getElementById('payload-' + idx);
  if (el) el.classList.toggle('open');
}

function closeDetail() {
  activeDetail = null;
  document.getElementById('detailOverlay').classList.remove('open');
}

// ── Helpers ────────────────────────────

function esc(str) {
  if (str == null) return '';
  var d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// ── Init ───────────────────────────────

refresh();
setInterval(refresh, 3000);
setInterval(updateClock, 1000);
updateClock();
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDetail(); });
</script>
</body>
</html>`
