'use strict';

/* ============================================================
   靶式看板 v2 — app.js
   ============================================================ */

const APP_VERSION = '1.0.0';
const SW_CACHE_NAME = 'tbk-v1';
const SCHEMA_VERSION = 2;
const LS_KEY = 'tbk_state_v2';
const LS_KEYS_V1 = { tasks: 'tbk_tasks', users: 'tbk_users', hist: 'tbk_hist' };

const ZONE_LABELS = { urgent: '紧急', todo: '需要做', should: '应做' };
const ZONE_COLORS = { urgent: '#d75e4e', todo: '#d88a3a', should: '#b8b5ad' };
const RING_CLASS = { urgent: 'r-urgent', todo: 'r-todo', should: 'r-should' };
const SECTION_TITLES = { add: '添加任务', filter: '筛选', users: '用户管理', stats: '圈层统计', history: '历史记录', settings: '设置' };

const state = {
  tasks: [],
  users: [],
  history: [],
  filters: { users: ['all'], zone: 'all' },
  ui: { formColor: '#ffffff', editingId: null, activeSection: null, pendingNewTask: null },
};

/* ----- Utilities ----- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomUserColor() {
  const h = Math.floor(Math.random() * 360);
  return hslToHex(h, 55, 55);
}

function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function ddlStatus(ddl) {
  if (!ddl) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseLocalDate(ddl);
  if (!d) return null;
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'soon';
  return 'ok';
}

function ddlBadgeText(status) {
  return status === 'overdue' ? '已逾期' : status === 'soon' ? '即将到期' : '';
}

/* ----- Persistence + migration ----- */

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      version: SCHEMA_VERSION,
      tasks: state.tasks,
      users: state.users,
      history: state.history,
    }));
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

function load() {
  // Try v2 first
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.users = Array.isArray(data.users) ? data.users : [];
      state.history = Array.isArray(data.history) ? data.history : [];
    }
  } catch (e) {
    console.warn('load v2 failed:', e);
  }
  // Migrate v1 if v2 absent
  if (!state.tasks.length && !state.users.length && !state.history.length) {
    migrateV1();
  }
  // Seed default users
  if (!state.users.length) {
    state.users = [
      { id: 'u1', name: 'User A', color: hslToHex(260, 55, 55) },
      { id: 'u2', name: 'User B', color: hslToHex(140, 55, 50) },
      { id: 'u3', name: 'User C', color: hslToHex(340, 55, 55) },
    ];
  }
}

function migrateV1() {
  try {
    const oldTasks = JSON.parse(localStorage.getItem(LS_KEYS_V1.tasks) || '[]');
    const oldUsers = JSON.parse(localStorage.getItem(LS_KEYS_V1.users) || '[]');
    const oldHist = JSON.parse(localStorage.getItem(LS_KEYS_V1.hist) || '[]');
    if (!oldTasks.length && !oldUsers.length && !oldHist.length) return;

    const g = canvasGeom();
    state.users = oldUsers;
    state.history = oldHist;
    state.tasks = oldTasks.map(t => {
      if (typeof t.angle === 'number' && typeof t.distRatio === 'number') return t;
      if (typeof t.x === 'number' && typeof t.y === 'number' && g.r3 > 0) {
        const { angle, distRatio } = xyToPolar(t.x, t.y, g);
        return { ...t, angle, distRatio };
      }
      return { ...t, angle: Math.random() * Math.PI * 2, distRatio: 0.5 };
    });
    save();
    toast('已迁移旧版数据', 'ok');
  } catch (e) {
    console.warn('migrate v1 failed:', e);
  }
}

/* ----- Geometry ----- */

function canvasGeom() {
  const wrap = document.getElementById('canvas-wrap');
  const W = wrap ? wrap.clientWidth : 0;
  const H = wrap ? wrap.clientHeight : 0;
  const cx = W / 2;
  const cy = H / 2;
  const r3 = Math.min(W, H) * 0.46;
  const r2 = r3 * 0.65;
  const r1 = r3 * 0.33;
  return { wrap, W, H, cx, cy, r3, r2, r1 };
}

function zoneFromDist(dist, g) {
  if (dist < g.r1) return 'urgent';
  if (dist < g.r2) return 'todo';
  return 'should';
}

function polarToXY(angle, distRatio, g) {
  const d = Math.max(0, Math.min(1, distRatio)) * g.r3;
  return { x: g.cx + Math.cos(angle) * d, y: g.cy + Math.sin(angle) * d };
}

function xyToPolar(x, y, g) {
  const dx = x - g.cx, dy = y - g.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  return { angle: Math.atan2(dy, dx), distRatio: g.r3 > 0 ? d / g.r3 : 0 };
}

function getUser(id) {
  return state.users.find(u => u.id === id) || { name: '?', color: '#cccccc' };
}

/* ----- Toast ----- */

function toast(msg, kind = '') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeout');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 1800);
}

/* ----- Render: target ----- */

function buildTarget() {
  const wrap = document.getElementById('canvas-wrap');
  const g = canvasGeom();

  let svg = wrap.querySelector('svg.canvas-svg');
  if (svg) svg.remove();

  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'canvas-svg');
  svg.setAttribute('width', g.W);
  svg.setAttribute('height', g.H);

  const ring = (cls, r, fill, stroke) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', g.cx);
    c.setAttribute('cy', g.cy);
    c.setAttribute('r', r);
    c.setAttribute('fill', fill);
    c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-width', '1.5');
    return c;
  };
  svg.appendChild(ring('r-should', g.r3, '#ececea', '#b8b5ad'));
  svg.appendChild(ring('r-todo', g.r2, '#fde2bf', '#d88a3a'));
  svg.appendChild(ring('r-urgent', g.r1, '#fbcfc4', '#d75e4e'));

  const label = (text, y, color) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', g.cx);
    t.setAttribute('y', y);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '10');
    t.setAttribute('font-family', 'sans-serif');
    t.setAttribute('fill', color);
    t.setAttribute('letter-spacing', '.08em');
    t.textContent = text;
    return t;
  };
  if (g.r3 > 30) {
    svg.appendChild(label('应做', g.cy - g.r3 + 14, '#767570'));
    svg.appendChild(label('需要做', g.cy - g.r2 + 14, '#b0641c'));
    svg.appendChild(label('紧急', g.cy - g.r1 + 14, '#b04438'));
  }

  wrap.insertBefore(svg, wrap.firstChild);
}

function highlightRing(zone) {
  document.querySelectorAll('.canvas-svg circle').forEach(c => c.classList.remove('ring-active'));
  if (zone) {
    const c = document.querySelector('.canvas-svg .' + RING_CLASS[zone]);
    if (c) c.classList.add('ring-active');
  }
}

/* ----- Render: cards ----- */

function visibleTasks() {
  return state.tasks.filter(t => {
    if (t.completed) return false;
    const uOk = state.filters.users.includes('all') || state.filters.users.includes(t.userId);
    const zOk = state.filters.zone === 'all' || state.filters.zone === t.zone;
    return uOk && zOk;
  });
}

function renderCards() {
  const area = document.getElementById('canvas-area');
  area.innerHTML = '';
  const g = canvasGeom();
  if (g.r3 <= 0) return;

  visibleTasks().forEach(t => {
    const u = getUser(t.userId);
    const { x, y } = polarToXY(t.angle ?? 0, t.distRatio ?? 0.5, g);
    const status = ddlStatus(t.ddl);

    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = t.id;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.background = t.color || '#ffffff';
    card.style.fontSize = '12px';
    if (t.desc) card.title = t.desc.length > 80 ? t.desc.slice(0, 80) + '…' : t.desc;

    let badge = '';
    if (status === 'overdue') badge = `<span class="badge badge-overdue">${ddlBadgeText(status)}</span>`;
    else if (status === 'soon') badge = `<span class="badge badge-soon">${ddlBadgeText(status)}</span>`;
    const ddlText = t.ddl ? `<span>DDL ${esc(t.ddl)}</span>` : '';

    card.innerHTML = `
      <div class="card-bar" style="background:${esc(u.color)}"></div>
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-meta">
        <span class="user-dot" style="background:${esc(u.color)}" title="${esc(u.name)}"></span>
        ${badge}${ddlText}
      </div>
      <button class="card-done-btn" type="button" data-action="done" title="完成">✓</button>`;

    attachCardEvents(card, t.id);
    area.appendChild(card);
  });
}

/* ----- Render: panels ----- */

function renderUserList() {
  const el = document.getElementById('user-list');
  el.innerHTML = '';
  state.users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'user-item';
    row.innerHTML = `
      <div class="user-avatar" style="background:${esc(u.color)}">${esc(initialOf(u.name))}</div>
      <input class="user-name-input" type="text" value="${esc(u.name)}" data-uid="${esc(u.id)}" data-action="rename-user">
      <input class="user-color-input" type="color" value="${esc(u.color)}" data-uid="${esc(u.id)}" data-action="recolor-user">
      ${state.users.length > 1 ? `<button class="btn-sm btn-danger" data-uid="${esc(u.id)}" data-action="remove-user" title="删除用户">×</button>` : ''}
    `;
    el.appendChild(row);
  });
}

function renderUserFilters() {
  const el = document.getElementById('user-filters');
  const chips = [`<div class="filter-chip ${state.filters.users.includes('all') ? 'active' : ''}" data-uid="all" data-action="filter-user">全部</div>`];
  state.users.forEach(u => {
    const active = state.filters.users.includes(u.id);
    const style = active ? `background:${esc(u.color)};color:#fff;border-color:${esc(u.color)}` : '';
    chips.push(`<div class="filter-chip ${active ? 'active' : ''}" data-uid="${esc(u.id)}" data-action="filter-user" style="${style}">${esc(u.name)}</div>`);
  });
  el.innerHTML = chips.join('');
}

function renderZoneCounts() {
  const counts = { urgent: 0, todo: 0, should: 0 };
  state.tasks.forEach(t => { if (!t.completed && counts[t.zone] !== undefined) counts[t.zone]++; });
  const el = document.getElementById('zone-counts');
  el.innerHTML = Object.entries(counts).map(([z, n]) => `
    <div class="zone-count-row">
      <div class="zone-dot" style="background:${ZONE_COLORS[z]}"></div>
      <div class="count-label">${ZONE_LABELS[z]}</div>
      <div class="count-num">${n}</div>
    </div>`).join('');
}

function renderHistoryPanel() {
  const el = document.getElementById('history-list');
  if (!el) return;
  if (!state.history.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0">暂无历史记录</div>';
    return;
  }
  el.innerHTML = state.history.slice(0, 30).map(h => `
    <div class="history-item">
      <div style="display:flex;align-items:center;gap:6px">
        <div class="user-dot" style="background:${esc(h.userColor)}"></div>
        <div class="h-title">${esc(h.title)}</div>
      </div>
      <div class="h-meta">
        ${esc(h.userName)} · ${esc(ZONE_LABELS[h.zone] || h.zone || '')}<br>
        ${h.ddl ? 'DDL ' + esc(h.ddl) + ' · ' : ''}完成于 ${esc(h.completedAt)}
      </div>
    </div>`).join('');
}

function populateUserSelects(only, selected) {
  const ids = only ? [only] : ['f-user', 'e-user'];
  ids.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = selected || sel.value || state.users[0]?.id;
    sel.innerHTML = state.users.map(u =>
      `<option value="${esc(u.id)}" ${u.id === cur ? 'selected' : ''}>${esc(u.name)}</option>`
    ).join('');
  });
}

function render() {
  buildTarget();
  renderCards();
  renderUserList();
  renderUserFilters();
  renderZoneCounts();
  renderHistoryPanel();
  populateUserSelects();
}

/* ----- Drag (Pointer Events) ----- */

function attachCardEvents(card, taskId) {
  card.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      // Let action handlers process this
      return;
    }
    startDrag(card, taskId, e);
  });
}

function startDrag(card, taskId, e) {
  e.preventDefault();
  const wrap = document.getElementById('canvas-wrap');
  const trash = document.getElementById('trash-zone');
  const g = canvasGeom();
  const wrapRect = wrap.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cardCenterX = cardRect.left + cardRect.width / 2 - wrapRect.left;
  const cardCenterY = cardRect.top + cardRect.height / 2 - wrapRect.top;
  const offX = e.clientX - wrapRect.left - cardCenterX;
  const offY = e.clientY - wrapRect.top - cardCenterY;
  const startX = e.clientX, startY = e.clientY;
  const THRESHOLD = 5;

  let didDrag = false;
  let captured = false;
  let label = null;
  let overTrash = false;

  const beginActualDrag = () => {
    didDrag = true;
    card.classList.add('dragging');
    wrap.classList.add('show-trash');
    try { card.setPointerCapture(e.pointerId); captured = true; } catch (_) {}
    label = document.createElement('div');
    label.className = 'drag-label';
    document.body.appendChild(label);
  };

  const checkOverTrash = (clientX, clientY) => {
    if (!trash) return false;
    const tr = trash.getBoundingClientRect();
    return clientX >= tr.left && clientX <= tr.right && clientY >= tr.top && clientY <= tr.bottom;
  };

  const onMove = (ev) => {
    if (!didDrag) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      beginActualDrag();
    }
    const px = ev.clientX - wrapRect.left - offX;
    const py = ev.clientY - wrapRect.top - offY;
    card.style.left = px + 'px';
    card.style.top = py + 'px';

    overTrash = checkOverTrash(ev.clientX, ev.clientY);
    trash.classList.toggle('over', overTrash);

    if (overTrash) {
      highlightRing(null);
      label.textContent = '丢弃';
    } else {
      const dx = px - g.cx, dy = py - g.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const zone = zoneFromDist(dist, g);
      highlightRing(zone);
      label.textContent = '→ ' + ZONE_LABELS[zone];
    }
    label.style.left = ev.clientX + 'px';
    label.style.top = ev.clientY + 'px';
  };

  const cleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    if (label) label.remove();
    highlightRing(null);
    wrap.classList.remove('show-trash');
    if (trash) trash.classList.remove('over');
    if (captured) {
      try { card.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };

  const onUp = (ev) => {
    cleanup();
    if (!didDrag) {
      openEdit(taskId);
      return;
    }
    card.classList.remove('dragging');

    // Dropped on trash → delete
    if (overTrash) {
      const t = state.tasks.find(x => x.id === taskId);
      const title = t ? t.title : '';
      state.tasks = state.tasks.filter(x => x.id !== taskId);
      save();
      render();
      toast('已删除：' + title);
      return;
    }

    const px = ev.clientX - wrapRect.left - offX;
    const py = ev.clientY - wrapRect.top - offY;
    const cardHalf = Math.max(cardRect.width, cardRect.height) / 2;
    const maxR = Math.max(0, g.r3 - cardHalf * 0.4);
    const dx = px - g.cx, dy = py - g.cy;
    let dist = Math.sqrt(dx * dx + dy * dy);
    let fx = px, fy = py;
    if (dist > maxR && dist > 0) {
      fx = g.cx + dx * maxR / dist;
      fy = g.cy + dy * maxR / dist;
      dist = maxR;
    }
    const t = state.tasks.find(x => x.id === taskId);
    if (t) {
      t.angle = Math.atan2(fy - g.cy, fx - g.cx);
      t.distRatio = g.r3 > 0 ? dist / g.r3 : 0;
      t.zone = zoneFromDist(dist, g);
    }
    save();
    render();
  };

  const onCancel = () => {
    cleanup();
    card.classList.remove('dragging');
    render();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

/* ----- Actions: tasks ----- */

function addTask() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { toast('请填写任务标题', 'error'); return; }
  const zone = document.getElementById('f-zone').value;
  // Random position inside the chosen zone
  const ratios = { urgent: [0.05, 0.27], todo: [0.40, 0.60], should: [0.75, 0.93] };
  const [rmin, rmax] = ratios[zone] || ratios.should;
  const distRatio = rmin + Math.random() * (rmax - rmin);
  const angle = Math.random() * Math.PI * 2;

  state.tasks.push({
    id: uid(),
    title,
    desc: document.getElementById('f-desc').value,
    ddl: document.getElementById('f-ddl').value,
    userId: document.getElementById('f-user').value,
    zone,
    color: state.ui.formColor,
    fontSize: 12,
    angle,
    distRatio,
    completed: false,
    createdAt: new Date().toISOString(),
  });

  document.getElementById('f-title').value = '';
  document.getElementById('f-desc').value = '';
  save();
  render();
  toast('已添加：' + title, 'ok');
}

function completeTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const card = document.querySelector(`.task-card[data-task-id="${CSS.escape(id)}"]`);
  if (card) card.classList.add('removing');
  const finish = () => {
    const u = getUser(t.userId);
    state.history.unshift({
      id: uid(),
      title: t.title,
      userName: u.name,
      userColor: u.color,
      zone: t.zone,
      ddl: t.ddl || '',
      completedAt: new Date().toISOString().slice(0, 10),
    });
    state.tasks = state.tasks.filter(x => x.id !== id);
    save();
    render();
  };
  if (card) setTimeout(finish, 180); else finish();
  toast('已完成：' + t.title, 'ok');
}

function deleteTask(id) {
  const t = state.tasks.find(x => x.id === id);
  state.tasks = state.tasks.filter(x => x.id !== id);
  closeModal();
  save();
  render();
  if (t) toast('已删除：' + t.title);
}

/* ----- Edit modal ----- */

function openEdit(id) {
  state.ui.editingId = id;
  state.ui.pendingNewTask = null;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  document.querySelector('#modal h3').textContent = '编辑任务';
  document.querySelector('#modal [data-action="delete-task"]').style.display = '';
  document.getElementById('e-title').value = t.title;
  document.getElementById('e-desc').value = t.desc || '';
  document.getElementById('e-ddl').value = t.ddl || '';
  document.getElementById('e-color').value = t.color || '#ffffff';
  document.getElementById('e-zone').value = t.zone;
  populateUserSelects('e-user', t.userId);
  document.getElementById('modal').style.display = 'flex';
  setTimeout(() => document.getElementById('e-title').focus(), 50);
}

function openCreateModal(drop) {
  state.ui.editingId = null;
  state.ui.pendingNewTask = drop;
  document.querySelector('#modal h3').textContent = '新建任务';
  document.querySelector('#modal [data-action="delete-task"]').style.display = 'none';
  document.getElementById('e-title').value = '';
  document.getElementById('e-desc').value = '';
  document.getElementById('e-ddl').value = '';
  document.getElementById('e-color').value = '#ffffff';
  document.getElementById('e-zone').value = drop.zone;
  populateUserSelects('e-user', state.users[0]?.id);
  document.getElementById('modal').style.display = 'flex';
  setTimeout(() => document.getElementById('e-title').focus(), 60);
}

function saveEdit() {
  const newTitle = document.getElementById('e-title').value.trim();
  if (!newTitle) { toast('标题不能为空', 'error'); return; }

  // Create mode (dropped from + button)
  if (state.ui.pendingNewTask) {
    const drop = state.ui.pendingNewTask;
    const t = {
      id: uid(),
      title: newTitle,
      desc: document.getElementById('e-desc').value,
      ddl: document.getElementById('e-ddl').value,
      userId: document.getElementById('e-user').value,
      zone: document.getElementById('e-zone').value || drop.zone,
      color: document.getElementById('e-color').value,
      fontSize: 12,
      angle: drop.angle,
      distRatio: drop.distRatio,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    state.tasks.push(t);
    closeModal();
    save();
    render();
    toast('已添加：' + newTitle, 'ok');
    return;
  }

  // Edit mode
  const t = state.tasks.find(x => x.id === state.ui.editingId);
  if (!t) { closeModal(); return; }
  t.title = newTitle;
  t.desc = document.getElementById('e-desc').value;
  t.ddl = document.getElementById('e-ddl').value;
  t.color = document.getElementById('e-color').value;
  t.userId = document.getElementById('e-user').value;
  const newZone = document.getElementById('e-zone').value;
  if (newZone !== t.zone) {
    t.zone = newZone;
    const ratios = { urgent: [0.05, 0.27], todo: [0.40, 0.60], should: [0.75, 0.93] };
    const [rmin, rmax] = ratios[newZone];
    t.distRatio = rmin + Math.random() * (rmax - rmin);
    t.angle = Math.random() * Math.PI * 2;
  }
  closeModal();
  save();
  render();
  toast('已保存');
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  state.ui.editingId = null;
  state.ui.pendingNewTask = null;
  // Reset modal UI for next opening
  document.querySelector('#modal h3').textContent = '编辑任务';
  document.querySelector('#modal [data-action="delete-task"]').style.display = '';
}

/* ----- Users ----- */

function addUser() {
  const name = prompt('用户名称：');
  if (!name) return;
  state.users.push({ id: uid(), name: name.trim() || '用户', color: randomUserColor() });
  save();
  render();
}

function renameUser(id, name) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  u.name = name.trim() || u.name;
  save();
  render();
}

function recolorUser(id, color) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  u.color = color;
  save();
  render();
}

function removeUser(id) {
  if (state.users.length <= 1) { toast('至少保留一个用户', 'error'); return; }
  if (!confirm('确认删除此用户？相关任务将保留。')) return;
  state.users = state.users.filter(x => x.id !== id);
  save();
  render();
}

/* ----- Filters ----- */

function toggleUserFilter(uid) {
  if (uid === 'all') { state.filters.users = ['all']; }
  else {
    state.filters.users = state.filters.users.filter(x => x !== 'all');
    if (state.filters.users.includes(uid)) state.filters.users = state.filters.users.filter(x => x !== uid);
    else state.filters.users.push(uid);
    if (!state.filters.users.length) state.filters.users = ['all'];
  }
  renderUserFilters();
  renderCards();
}

function toggleZoneFilter(zone) {
  state.filters.zone = zone;
  document.querySelectorAll('.filter-chip[data-zone]').forEach(c => c.classList.toggle('active', c.dataset.zone === zone));
  renderCards();
}

/* ----- Drag from + rail button to create task ----- */

function setupAddDrag(btn) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const wrap = document.getElementById('canvas-wrap');
    const startX = e.clientX, startY = e.clientY;
    const THRESHOLD = 6;
    let didDrag = false;
    let captured = false;
    let ghost = null;
    let label = null;

    const beginDrag = () => {
      didDrag = true;
      btn.classList.add('dragging');
      try { btn.setPointerCapture(e.pointerId); captured = true; } catch (_) {}
      ghost = document.createElement('div');
      ghost.className = 'add-ghost';
      ghost.textContent = '新任务';
      document.body.appendChild(ghost);
      label = document.createElement('div');
      label.className = 'drag-label';
      document.body.appendChild(label);
    };

    const onMove = (ev) => {
      if (!didDrag) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
        beginDrag();
      }
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
      const wr = wrap.getBoundingClientRect();
      const inside = ev.clientX >= wr.left && ev.clientX <= wr.right && ev.clientY >= wr.top && ev.clientY <= wr.bottom;
      if (inside) {
        const g = canvasGeom();
        const wx = ev.clientX - wr.left;
        const wy = ev.clientY - wr.top;
        const dist = Math.sqrt((wx - g.cx) ** 2 + (wy - g.cy) ** 2);
        const zone = zoneFromDist(dist, g);
        highlightRing(zone);
        label.textContent = '放到 ' + ZONE_LABELS[zone];
        label.style.display = '';
        label.style.left = ev.clientX + 'px';
        label.style.top = ev.clientY + 'px';
      } else {
        highlightRing(null);
        label.style.display = 'none';
      }
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (ghost) ghost.remove();
      if (label) label.remove();
      highlightRing(null);
      btn.classList.remove('dragging');
      if (captured) { try { btn.releasePointerCapture(e.pointerId); } catch (_) {} }
    };

    const onUp = (ev) => {
      cleanup();
      if (!didDrag) {
        togglePanel('add');
        return;
      }
      const wr = wrap.getBoundingClientRect();
      const inside = ev.clientX >= wr.left && ev.clientX <= wr.right && ev.clientY >= wr.top && ev.clientY <= wr.bottom;
      if (!inside) return;
      const g = canvasGeom();
      const wx = ev.clientX - wr.left;
      const wy = ev.clientY - wr.top;
      const cardHalf = 60;
      const maxR = Math.max(0, g.r3 - cardHalf * 0.4);
      const dx = wx - g.cx, dy = wy - g.cy;
      let dist = Math.sqrt(dx * dx + dy * dy);
      let fx = wx, fy = wy;
      if (dist > maxR && dist > 0) {
        fx = g.cx + dx * maxR / dist;
        fy = g.cy + dy * maxR / dist;
        dist = maxR;
      }
      const angle = Math.atan2(fy - g.cy, fx - g.cx);
      const distRatio = g.r3 > 0 ? dist / g.r3 : 0;
      const zone = zoneFromDist(dist, g);
      // Close panel if open so the modal isn't behind it
      closePanel();
      openCreateModal({ angle, distRatio, zone });
    };

    const onCancel = () => cleanup();

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

/* ----- Settings ----- */

async function renderSettings() {
  const setV = document.getElementById('set-version');
  const setS = document.getElementById('set-storage');
  const setC = document.getElementById('set-cache');
  if (!setV || !setS || !setC) return;

  setV.textContent = '靶式看板 v' + APP_VERSION;

  const raw = localStorage.getItem(LS_KEY) || '';
  const sizeKB = (new Blob([raw]).size / 1024).toFixed(1);
  setS.innerHTML =
    `任务 <b>${state.tasks.length}</b> · 用户 <b>${state.users.length}</b> · 历史 <b>${state.history.length}</b>` +
    `<div style="font-size:11px;color:var(--muted);margin-top:3px">存储占用 ${sizeKB} KB</div>`;

  setC.textContent = '检测中…';
  if ('caches' in window) {
    try {
      const cache = await caches.open(SW_CACHE_NAME);
      const keys = await cache.keys();
      const swActive = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration())?.active;
      setC.innerHTML =
        `${swActive ? '✓ 已启用' : '○ 未激活'}` +
        `<div style="font-size:11px;color:var(--muted);margin-top:3px">缓存版本 ${esc(SW_CACHE_NAME)} · ${keys.length} 个文件</div>`;
    } catch (e) {
      setC.textContent = '不可用：' + e.message;
    }
  } else {
    setC.textContent = '当前浏览器不支持';
  }
}

function clearAllData() {
  if (!confirm('确认清空所有本地数据？任务、用户、历史都会被删除（不可恢复）。')) return;
  localStorage.removeItem(LS_KEY);
  state.tasks = [];
  state.users = [
    { id: 'u1', name: 'User A', color: hslToHex(260, 55, 55) },
    { id: 'u2', name: 'User B', color: hslToHex(140, 55, 50) },
    { id: 'u3', name: 'User C', color: hslToHex(340, 55, 55) },
  ];
  state.history = [];
  state.filters = { users: ['all'], zone: 'all' };
  save();
  render();
  if (state.ui.activeSection === 'settings') renderSettings();
  toast('已清空所有本地数据', 'ok');
}

async function refreshCache() {
  if (!confirm('清空离线缓存并刷新页面？这会让 App 重新下载最新代码。')) return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn('refresh cache failed:', e);
  }
  location.reload();
}

/* ----- Floating panel ----- */

function togglePanel(section) {
  if (state.ui.activeSection === section) closePanel();
  else openPanel(section);
}

function openPanel(section) {
  state.ui.activeSection = section;
  const panel = document.getElementById('float-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('float-panel-title').textContent = SECTION_TITLES[section] || '';
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.section === section));
  document.querySelectorAll('.ps').forEach(s => s.classList.toggle('active', s.dataset.content === section));
  if (section === 'stats') renderZoneCounts();
  if (section === 'history') renderHistoryPanel();
  if (section === 'settings') renderSettings();
  if (section === 'add') setTimeout(() => document.getElementById('f-title').focus(), 60);
}

function closePanel() {
  state.ui.activeSection = null;
  const panel = document.getElementById('float-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
}

/* ----- Wiring ----- */

function wireEvents() {
  // Add task
  document.getElementById('btn-add').addEventListener('click', addTask);
  document.getElementById('f-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addTask(); }
  });

  // Color swatches
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      state.ui.formColor = s.dataset.color;
      document.getElementById('f-color-custom').value = s.dataset.color;
    });
  });
  document.getElementById('f-color-custom').addEventListener('input', e => {
    document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
    state.ui.formColor = e.target.value;
  });

  // Zone filter chips
  document.querySelectorAll('.filter-chip[data-zone]').forEach(c => {
    c.addEventListener('click', () => toggleZoneFilter(c.dataset.zone));
  });

  // Rail buttons (+ has drag-to-create, others toggle their panel on click)
  document.querySelectorAll('.rail-btn').forEach(b => {
    if (b.dataset.section === 'add') {
      setupAddDrag(b);
    } else {
      b.addEventListener('click', () => togglePanel(b.dataset.section));
    }
  });

  // Event delegation for data-action elements
  document.body.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const taskCard = el.closest('.task-card');

    if (action === 'filter-user') toggleUserFilter(el.dataset.uid);
    else if (action === 'remove-user') removeUser(el.dataset.uid);
    else if (action === 'add-user') addUser();
    else if (action === 'clear-data') clearAllData();
    else if (action === 'refresh-cache') refreshCache();
    else if (action === 'close-panel') closePanel();
    else if (action === 'done' && taskCard) {
      e.stopPropagation();
      completeTask(taskCard.dataset.taskId);
    } else if (action === 'delete-task') deleteTask(state.ui.editingId);
    else if (action === 'save-edit') saveEdit();
    else if (action === 'close-modal') closeModal();
  });

  document.body.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'rename-user') renameUser(el.dataset.uid, el.value);
    else if (el.dataset.action === 'recolor-user') recolorUser(el.dataset.uid, el.value);
  });

  // Modal overlay click closes
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
  });

  // Global keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('modal').style.display === 'flex') { e.preventDefault(); closeModal(); }
      else if (state.ui.activeSection) { e.preventDefault(); closePanel(); }
      return;
    }
    if (e.key === 'Enter' && document.getElementById('modal').style.display === 'flex') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') {
        e.preventDefault();
        saveEdit();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPanel('add');
    }
  });

  // Window resize: re-render (positions are polar, so they reflow)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 50);
  });
}

/* ----- Init ----- */

function init() {
  // Need canvas to exist for migration geometry
  load();
  wireEvents();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* ----- Service worker registration (PWA) ----- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
