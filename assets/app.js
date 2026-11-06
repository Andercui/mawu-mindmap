/* 渲染引擎：tidy tree 布局 + 跨分支关系线 + 子图下钻 */
(function () {
  'use strict';

  const KIND = {
    decide:{ name:'决定',      color:'#dc2626', dash:'' },
    react: { name:'反作用',    color:'#f59e0b', dash:'6 4' },
    prog:  { name:'递进',      color:'#7c3aed', dash:'2 4' },
    method:{ name:'方法论映射', color:'#0891b2', dash:'11 3 2 3' },
    unity: { name:'对立统一',   color:'#db2777', dash:'' },
    bridge:{ name:'接口 / 延伸', color:'#64748b', dash:'4 4' }
  };
  const MOD = {
    root:{ name:'总纲',              color:'#111827' },
    d:   { name:'导论',              color:'#475569' },
    c1:  { name:'第一章 辩证唯物论',  color:'#2563eb' },
    c2:  { name:'第二章 唯物辩证法',  color:'#ea580c' },
    c3:  { name:'第三章 认识论',      color:'#059669' },
    ext: { name:'往下衔接',          color:'#94a3b8' }
  };

  const NODE_H = 30, V_GAP = 10, H_GAP = 66, PAD_X = 14, FS = 13;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const svg = document.getElementById('svg');
  const vpG = document.getElementById('vp');
  const stageEl = document.getElementById('stage');

  const mctx = document.createElement('canvas').getContext('2d');
  mctx.font = FS + 'px "Microsoft YaHei","PingFang SC",system-ui,sans-serif';

  /* ---------- 预处理每张图 ---------- */
  Object.keys(MAPS).forEach(key => {
    const m = MAPS[key];
    m.byId = {};
    m.nodes.forEach(n => { m.byId[n.id] = n; n.kids = []; });
    m.nodes.forEach(n => { if (n.p && m.byId[n.p]) m.byId[n.p].kids.push(n); });
    (function depth(n, d) { n.depth = d; n.kids.forEach(k => depth(k, d + 1)); })(m.byId[m.root], 0);
    m.nodes.forEach(n => {
      const tw = mctx.measureText(n.t).width;
      n.w = Math.max(54, Math.ceil(tw) + PAD_X * 2 + (n.kids.length || n.sub ? 18 : 0));
    });
    m.defaultCollapsed = () => {
      const s = new Set();
      m.nodes.forEach(n => { if (n.depth >= 2 && n.kids.length) s.add(n.id); });
      return s;
    };
  });

  /* ---------- 状态 ---------- */
  const st = {
    map: 'main',
    collapsed: new Set(),
    selected: null,
    hits: new Set(),
    vp: { x: 0, y: 0, k: 1 }
  };
  const linkVisible = {};
  Object.keys(KIND).forEach(k => linkVisible[k] = true);

  let currentLayout = null;
  let fitPending = true;

  const cur = () => MAPS[st.map];

  /* ---------- 布局 ---------- */
  function layout() {
    const m = cur();
    let cursor = 0;
    const levelW = [];
    const vis = [];
    (function walk(n, d) {
      n.d = d;
      levelW[d] = Math.max(levelW[d] || 0, n.w);
      const kids = st.collapsed.has(n.id) ? [] : n.kids;
      let y;
      if (!kids.length) { y = cursor + NODE_H / 2; cursor += NODE_H + (m.vgap || V_GAP); }
      else {
        const ys = kids.map(k => walk(k, d + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      n.y = y; vis.push(n);
      return y;
    })(m.byId[m.root], 0);

    const levelX = [];
    let x = 0;
    for (let i = 0; i < levelW.length; i++) { levelX[i] = x; x += levelW[i] + H_GAP; }
    vis.forEach(n => n.x = levelX[n.d]);

    return { vis, width: x - H_GAP, height: Math.max(cursor, NODE_H) };
  }

  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    return e;
  };

  /* ---------- 绘制 ---------- */
  function render() {
    const m = cur();
    currentLayout = layout();
    const { vis, width, height } = currentLayout;

    vpG.textContent = '';
    const gEdge = el('g'), gLink = el('g'), gNode = el('g');
    vpG.append(gEdge, gLink, gNode);

    vis.forEach(n => {
      if (st.collapsed.has(n.id)) return;
      n.kids.forEach(k => {
        const x1 = n.x + n.w, y1 = n.y, x2 = k.x, y2 = k.y, mx = (x1 + x2) / 2;
        gEdge.appendChild(el('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, 'edge'));
      });
    });

    /* 先算出每条关系的几何，再按跨度分配“轨道”，避免同列弧线互相压线 */
    const drawn = [];
    m.links.forEach(L => {
      const s = m.byId[L.a], t = m.byId[L.b];
      if (!s || !t) return;
      if (vis.indexOf(s) < 0 || vis.indexOf(t) < 0) return;
      const sameCol = Math.abs(s.x - t.x) < 1;
      drawn.push({ L, s, t, sameCol, span: Math.abs(s.y - t.y) });
    });

    const same = drawn.filter(o => o.sameCol).sort((p, q) => p.span - q.span);
    same.forEach((o, i) => { o.bulge = 44 + i * 20 + Math.min(90, o.span * 0.18); });

    let railRight = 0;
    drawn.forEach(o => {
      const kind = KIND[o.L.k] || KIND.prog;
      let d, lx, ly;
      if (o.sameCol) {
        const x1 = o.s.x + o.s.w, y1 = o.s.y, x2 = o.t.x + o.t.w, y2 = o.t.y;
        const b = o.bulge;
        d = `M${x1},${y1} C${x1 + b},${y1} ${x2 + b},${y2} ${x2},${y2}`;
        lx = Math.max(x1, x2) + b * 0.72 + 6;
        ly = (y1 + y2) / 2 + 3;
        railRight = Math.max(railRight, lx + 90);
      } else {
        const x1 = o.s.x + o.s.w, y1 = o.s.y, x2 = o.t.x, y2 = o.t.y;
        const dx = Math.max(60, Math.abs(x2 - x1) * 0.42);
        d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        lx = (x1 + x2) / 2;
        ly = (y1 + y2) / 2 - 5;
      }
      const p = el('path', {
        d,
        stroke: kind.color,
        'stroke-dasharray': kind.dash,
        'marker-end': 'url(#arw-' + o.L.k + ')'
      }, 'clink' + (linkVisible[o.L.k] ? '' : ' off'));
      const ttl = el('title'); ttl.textContent = o.L.l; p.appendChild(ttl);
      gLink.appendChild(p);

      if (o.span > 88) {
        const tx = el('text', {
          x: lx, y: ly, 'text-anchor': o.sameCol ? 'start' : 'middle', fill: kind.color
        }, 'clabel' + (linkVisible[o.L.k] ? '' : ' off'));
        tx.textContent = o.L.l;
        gLink.appendChild(tx);
      }
    });
    if (railRight > currentLayout.width) currentLayout.width = railRight;

    vis.forEach(n => {
      const mod = MOD[n.m] || MOD.d;
      const g = el('g', { transform: `translate(${n.x},${n.y - NODE_H / 2})` },
        'node' + (st.selected === n.id ? ' sel' : '') + (n.m === 'ext' ? ' ext' : '') + (st.hits.has(n.id) ? ' hit' : ''));
      g.dataset.id = n.id;

      const isDark = st.selected === n.id || n.m === 'root';
      g.appendChild(el('rect', {
        x: 0, y: 0, width: n.w, height: NODE_H, rx: 9,
        stroke: mod.color,
        fill: st.selected === n.id ? mod.color : (n.m === 'root' ? mod.color : '#fff')
      }, 'box'));

      const tx = el('text', { x: PAD_X, y: NODE_H / 2, fill: isDark ? '#fff' : '#1f2937' }, 'lbl');
      tx.textContent = n.t;
      g.appendChild(tx);

      /* 折叠 / 下钻开关：单个字符，无边框圆圈 */
      const expandable = n.kids.length > 0;
      const drill = !expandable && !!n.sub;
      if (expandable || drill) {
        const tog = el('g', { transform: `translate(${n.w - 10},${NODE_H / 2})` }, 'tog' + (drill ? ' sub' : ''));
        tog.appendChild(el('rect', { x: -11, y: -13, width: 22, height: 26 }));  /* 扩大触摸区 */
        const glyph = el('text');
        glyph.textContent = drill ? '›' : (st.collapsed.has(n.id) ? '+' : '−');
        tog.appendChild(glyph);
        const ttl = el('title');
        ttl.textContent = drill ? '打开子图：' + MAPS[n.sub].title : (st.collapsed.has(n.id) ? '展开' : '收起');
        tog.appendChild(ttl);
        tog.addEventListener('click', ev => {
          ev.stopPropagation();
          if (moved) return;
          if (drill) { openMap(n.sub); return; }
          const oldY = n.y;
          if (st.collapsed.has(n.id)) st.collapsed.delete(n.id); else st.collapsed.add(n.id);
          render();
          st.vp.y += (oldY - n.y) * st.vp.k;   /* 被点的节点留在原位 */
          applyVp();
        });
        g.appendChild(tog);
      }

      g.addEventListener('click', ev => {
        ev.stopPropagation();
        if (moved) return;
        select(n.id);
      });
      gNode.appendChild(g);
    });

    updateStat();
    if (fitPending) { fit(); fitPending = false; }
  }

  function updateStat() {
    const m = cur();
    const shown = currentLayout ? currentLayout.vis.length : m.nodes.length;
    document.getElementById('stat').textContent =
      `${m.nodes.length} 节点 / ${m.links.length} 关系 · 可见 ${shown}`;
  }

  /* ---------- 详情卡 ---------- */
  function select(id) {
    st.selected = id;
    const m = cur();
    const n = m.byId[id];
    if (!n) return;

    const path = [];
    let c = n;
    while (c) { path.unshift(c.t); c = c.p ? m.byId[c.p] : null; }

    document.getElementById('pTitle').textContent = n.t;
    document.getElementById('crumb').textContent =
      (st.map === 'main' ? '' : MAPS[st.map].title + ' · ') +
      (path.length > 1 ? path.slice(0, -1).join(' › ') : '顶层');

    const mod = MOD[n.m] || MOD.d;
    document.getElementById('chips').innerHTML =
      `<span class="chip mod" style="background:${mod.color}">${mod.name}</span>` +
      (n.no ? `<span class="chip">考点 ${n.no}</span>` : '') +
      (n.tag ? `<span class="chip">${n.tag}</span>` : '') +
      (n.pg ? `<span class="chip">书 p.${n.pg}</span>` : '');

    let html = '';
    if (n.sub) {
      html += `<div class="sec"><button class="goto" data-sub="${n.sub}">打开子图：${MAPS[n.sub].title} →</button></div>`;
    }
    if (n.pr) html += `<div class="sec"><h4>一句话原理</h4><p>${n.pr}</p></div>`;
    if (n.pts && n.pts.length)
      html += `<div class="sec"><h4>要点</h4><ul>${n.pts.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
    if (n.trap) html += `<div class="sec"><div class="trap"><b>易错 / 命题角度：</b>${n.trap}</div></div>`;
    if (n.pg)
      html += `<div class="src">出处：徐涛《2027考研政治核心考案》书页 ${n.pg}，PDF 第 ${parseInt(n.pg, 10) + 8} 页</div>`;

    const body = document.getElementById('pBody');
    body.innerHTML = html;
    const btn = body.querySelector('[data-sub]');
    if (btn) btn.addEventListener('click', () => openMap(btn.dataset.sub));

    render();
  }

  /* ---------- 子图导航（带视图记忆） ---------- */
  const viewCache = {};
  function openMap(id) {
    if (!MAPS[id]) return;
    viewCache[st.map] = {
      collapsed: new Set(st.collapsed),
      selected: st.selected,
      vp: { x: st.vp.x, y: st.vp.y, k: st.vp.k }
    };

    st.map = id;
    st.hits.clear();
    document.getElementById('q').value = '';
    renderCrumbs();

    const cache = viewCache[id];
    if (cache) {
      st.collapsed = new Set(cache.collapsed);
      st.selected = cache.selected;
      st.vp = { x: cache.vp.x, y: cache.vp.y, k: cache.vp.k };
      select(st.selected);
      applyVp();
      return;
    }

    /* 子图默认全展开（它本身就是“细节图”），主图默认折叠到小节层 */
    st.collapsed = id === 'main' ? MAPS[id].defaultCollapsed() : new Set();
    st.selected = MAPS[id].root;
    fitPending = true;
    select(st.selected);
  }

  function renderCrumbs() {
    const box = document.getElementById('crumbs');
    if (st.map === 'main') {
      box.innerHTML = '<span class="cur">主图</span>';
    } else {
      const m = MAPS[st.map];
      box.innerHTML = '<button class="ghost" id="btnBack">← 主图</button>' +
        '<span class="sep">›</span><span class="cur">' + m.title + '</span>';
      document.getElementById('btnBack').addEventListener('click', () => openMap(m.parent || 'main'));
    }
  }

  /* ---------- 视图变换 ---------- */
  function applyVp() {
    vpG.setAttribute('transform', `translate(${st.vp.x},${st.vp.y}) scale(${st.vp.k})`);
  }
  function fit() {
    if (!currentLayout) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const padTop = 70, pad = 40;
    const k = Math.min(
      (r.width - pad * 2) / currentLayout.width,
      (r.height - padTop - pad) / currentLayout.height,
      1.15
    );
    st.vp.k = Math.max(0.16, k);
    st.vp.x = Math.max(pad, (r.width - currentLayout.width * st.vp.k) / 2);
    st.vp.y = Math.max(padTop, (r.height - currentLayout.height * st.vp.k) / 2 + 14);
    applyVp();
  }
  function centerOn(node) {
    if (!node) return;
    const r = svg.getBoundingClientRect();
    st.vp.k = Math.max(st.vp.k, 0.72);
    st.vp.x = r.width * 0.42 - node.x * st.vp.k;
    st.vp.y = r.height * 0.5 - node.y * st.vp.k;
    applyVp();
  }
  function zoomAt(mx, my, k2) {
    k2 = Math.min(3, Math.max(0.1, k2));
    st.vp.x = mx - (mx - st.vp.x) * (k2 / st.vp.k);
    st.vp.y = my - (my - st.vp.y) * (k2 / st.vp.k);
    st.vp.k = k2;
    applyVp();
  }

  /* ---------- 鼠标 / 触摸手势 ---------- */
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, st.vp.k * (e.deltaY < 0 ? 1.12 : 0.893));
  }, { passive: false });

  const pointers = new Map();
  let gesture = null, moved = false;

  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) {
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: st.vp.x, vy: st.vp.y };
      stageEl.classList.add('dragging');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = svg.getBoundingClientRect();
      gesture = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2 - r.left,
        cy: (a.y + b.y) / 2 - r.top,
        k0: st.vp.k, vx: st.vp.x, vy: st.vp.y
      };
    }
  });

  window.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === 'pan' && pointers.size === 1) {
      const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      st.vp.x = gesture.vx + dx;
      st.vp.y = gesture.vy + dy;
      applyVp();
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      moved = true;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k = Math.min(3, Math.max(0.1, gesture.k0 * d / gesture.d0));
      st.vp.k = k;
      st.vp.x = gesture.cx - (gesture.cx - gesture.vx) * (k / gesture.k0);
      st.vp.y = gesture.cy - (gesture.cy - gesture.vy) * (k / gesture.k0);
      applyVp();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { gesture = null; stageEl.classList.remove('dragging'); }
    else if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      gesture = { type: 'pan', sx: p.x, sy: p.y, vx: st.vp.x, vy: st.vp.y };
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  /* ---------- 搜索 ---------- */
  document.getElementById('q').addEventListener('input', e => {
    const q = e.target.value.trim();
    const m = cur();
    st.hits = new Set();
    if (!q) { render(); return; }
    m.nodes.forEach(n => {
      if (n.t.indexOf(q) >= 0 || (n.pr && n.pr.indexOf(q) >= 0)) {
        st.hits.add(n.id);
        let c = n;
        while (c && c.p) { st.collapsed.delete(c.p); c = m.byId[c.p]; }
      }
    });
    render();
    const first = m.nodes.find(n => st.hits.has(n.id));
    if (first) centerOn(first);
  });

  /* ---------- 按钮 ---------- */
  document.getElementById('btnFit').onclick = () => fit();
  document.getElementById('btnL2').onclick = () => {
    const m = cur();
    st.collapsed = new Set();
    m.nodes.forEach(n => { if (n.depth >= 2 && n.kids.length) st.collapsed.add(n.id); });
    render(); fit();
  };
  document.getElementById('btnAll').onclick = () => { st.collapsed.clear(); render(); fit(); };
  document.getElementById('btnZoomIn').onclick = () => {
    const r = svg.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, st.vp.k * 1.25);
  };
  document.getElementById('btnZoomOut').onclick = () => {
    const r = svg.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, st.vp.k / 1.25);
  };

  /* ---------- 图例 ---------- */
  (function buildLegend() {
    const box = document.getElementById('lgRows');
    Object.keys(KIND).forEach(k => {
      const kd = KIND[k];
      const row = document.createElement('label');
      row.className = 'lg-row';
      row.innerHTML = '<input type="checkbox" checked>' +
        `<span class="lg-sw" style="border-top-color:${kd.color};border-top-style:${kd.dash ? 'dashed' : 'solid'}"></span>` +
        `<span class="lg-name">${kd.name}</span>`;
      row.querySelector('input').addEventListener('change', ev => {
        linkVisible[k] = ev.target.checked;
        render();
      });
      box.appendChild(row);
    });
  })();

  /* ---------- 箭头 ---------- */
  (function markers() {
    const defs = el('defs');
    Object.keys(KIND).forEach(k => {
      const mk = el('marker', {
        id: 'arw-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      });
      mk.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: KIND[k].color }));
      defs.appendChild(mk);
    });
    svg.appendChild(defs);
  })();

  /* ---------- 启动 ---------- */
  st.collapsed = MAPS.main.defaultCollapsed();
  st.selected = 'root';
  renderCrumbs();
  render();
  applyVp();
  requestAnimationFrame(() => fit());

  let lastW = 0, lastH = 0, rzTimer = null;
  new ResizeObserver(entries => {
    const r = entries[0].contentRect;
    if (Math.abs(r.width - lastW) < 24 && Math.abs(r.height - lastH) < 24) return;
    lastW = r.width; lastH = r.height;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { fit(); applyVp(); }, 80);
  }).observe(stageEl);

  select('root');
})();
