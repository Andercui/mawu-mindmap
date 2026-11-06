/* 渲染引擎：tidy tree 布局 + 跨分支关系线 + 右侧内嵌二维子图 */
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
  const SUB_PAD = 16, SUB_TITLE_H = 26, SUB_GAP_X = 54, SUB_VGAP = 16, SUB_HGAP = 48;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const svg = document.getElementById('svg');
  const vpG = document.getElementById('vp');
  const stageEl = document.getElementById('stage');

  const mctx = document.createElement('canvas').getContext('2d');
  mctx.font = FS + 'px "Microsoft YaHei","PingFang SC",system-ui,sans-serif';

  /* ---------- 预处理 ---------- */
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
    collapsed: null,
    openSubs: new Set(),
    selected: { map: 'main', id: null },
    hits: new Set(),
    vp: { x: 0, y: 0, k: 1 }
  };
  const linkVisible = {};
  Object.keys(KIND).forEach(k => linkVisible[k] = true);

  const mainMap = MAPS.main;
  let currentLayout = null;
  let subLayouts = {};
  let fitPending = true;

  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    return e;
  };

  /* ---------- 布局：子图按“块”占位，宿主节点预留整块高度 ---------- */
  function layoutMap(map, collapsedSet, vgap, hgap, subs, skipRoot) {
    const pos = {}, vis = [], levelW = [];
    let cursor = 0;
    const start = skipRoot ? map.byId[map.root].kids : [map.byId[map.root]];
    const baseDepth = skipRoot ? 0 : 0;
    start.forEach(top => {
      (function walk(n, d) {
      levelW[d] = Math.max(levelW[d] || 0, n.w);
      const kids = collapsedSet.has(n.id) ? [] : n.kids;
      let y;
      if (!kids.length) {
        const box = subs && subs[n.id];
        const bh = box ? Math.max(NODE_H, box.boxH) : NODE_H;
        y = cursor + bh / 2;
        cursor += bh + vgap;
      } else {
        const ys = kids.map(k => walk(k, d + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      pos[n.id] = { x: 0, y, d };
      vis.push(n);
      return y;
      })(top, baseDepth);
    });

    const levelX = [];
    let x = 0;
    for (let i = 0; i < levelW.length; i++) { levelX[i] = x; x += levelW[i] + hgap; }
    vis.forEach(n => { pos[n.id].x = levelX[pos[n.id].d]; });

    return { vis, pos, width: x - hgap, height: Math.max(cursor, NODE_H) };
  }

  /* 关系线：同列走右侧“轨道弧”，按跨度分配轨道；反向关系标签上下错开 */
  function laneify(map, layout) {
    const items = [];
    map.links.forEach(L => {
      const s = map.byId[L.a], t = map.byId[L.b];
      if (!s || !t) return;
      const ps = layout.pos[s.id], pt = layout.pos[t.id];
      if (!ps || !pt) return;
      items.push({
        L, s, t, ps, pt,
        sameCol: Math.abs(ps.x - pt.x) < 1,
        span: Math.abs(ps.y - pt.y)
      });
    });
    const same = items.filter(o => o.sameCol).sort((p, q) => p.span - q.span);
    same.forEach((o, i) => { o.bulge = 40 + i * 20 + Math.min(80, o.span * 0.16); });

    const byPair = {};
    items.forEach(o => {
      const key = [o.L.a, o.L.b].sort().join('|');
      (byPair[key] = byPair[key] || []).push(o);
    });
    Object.keys(byPair).forEach(k => {
      const arr = byPair[k];
      if (arr.length < 2) return;
      /* 反向关系：两者方向相反，取同一 t 会自然落在弧的两端 */
      arr.forEach(o => { o.tPos = 0.32; });
    });
    return items;
  }

  function bezPoint(P, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * P[0].x + 3 * mt * mt * t * P[1].x + 3 * mt * t * t * P[2].x + t * t * t * P[3].x,
      y: mt * mt * mt * P[0].y + 3 * mt * mt * t * P[1].y + 3 * mt * t * t * P[2].y + t * t * t * P[3].y
    };
  }

  function linkGeo(o, ox, oy) {
    let P, anchor = 'middle';
    if (o.sameCol) {
      const x1 = ox + o.ps.x + o.s.w, y1 = oy + o.ps.y;
      const x2 = ox + o.pt.x + o.t.w, y2 = oy + o.pt.y;
      const b = o.bulge;
      P = [{ x: x1, y: y1 }, { x: x1 + b, y: y1 }, { x: x2 + b, y: y2 }, { x: x2, y: y2 }];
      anchor = 'start';
    } else {
      const x1 = ox + o.ps.x + o.s.w, y1 = oy + o.ps.y;
      const x2 = ox + o.pt.x, y2 = oy + o.pt.y;
      const dx = Math.max(60, Math.abs(x2 - x1) * 0.42);
      P = [{ x: x1, y: y1 }, { x: x1 + dx, y: y1 }, { x: x2 - dx, y: y2 }, { x: x2, y: y2 }];
    }
    const L = bezPoint(P, o.tPos || 0.5);
    return {
      P, anchor,
      lx: L.x + (anchor === 'start' ? 7 : 0),
      ly: L.y + (anchor === 'start' ? 3 : -5),
      d: `M${P[0].x},${P[0].y} C${P[1].x},${P[1].y} ${P[2].x},${P[2].y} ${P[3].x},${P[3].y}`
    };
  }

  function drawLinks(g, items, ox, oy) {
    const pending = [];
    items.forEach(o => {
      const kind = KIND[o.L.k] || KIND.prog;
      const geo = linkGeo(o, ox, oy);
      const p = el('path', {
        d: geo.d,
        stroke: kind.color,
        'stroke-dasharray': kind.dash,
        'marker-end': 'url(#arw-' + o.L.k + ')'
      }, 'clink' + (linkVisible[o.L.k] ? '' : ' off'));
      const ttl = el('title'); ttl.textContent = o.L.l; p.appendChild(ttl);
      g.appendChild(p);

      if (o.span > 70) {
        pending.push({
          text: o.L.l, color: kind.color, anchor: geo.anchor,
          x: geo.lx, y: geo.ly, w: mctx.measureText(o.L.l).width,
          kind: o.L.k
        });
      }
    });

    /* 标签防重叠：按 y 排序，若与已放置标签相交就右移 */
    pending.sort((a, b) => a.y - b.y);
    const placed = [];
    let railRight = 0;
    pending.forEach(L => {
      let x = L.x;
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find(P =>
          x < P.x + P.w + 8 && P.x < x + L.w + 8 &&
          L.y - 12 < P.y + 8 && P.y < L.y + 12);
        if (!hit) break;
        x = hit.x + hit.w + 12;
      }
      const rect = { x, y: L.y, w: L.w };
      placed.push(rect);
      railRight = Math.max(railRight, x + L.w + 10);

      const tx = el('text', {
        x, y: L.y, 'text-anchor': L.anchor, fill: L.color
      }, 'clabel' + (linkVisible[L.kind] ? '' : ' off'));
      tx.textContent = L.text;
      g.appendChild(tx);
    });
    return railRight;
  }

  function buildSubLayouts() {
    subLayouts = {};
    mainMap.nodes.forEach(n => {
      if (!n.sub || !st.openSubs.has(n.id)) return;
      const sm = MAPS[n.sub];
      if (!sm) return;
      const lay = layoutMap(sm, new Set(), SUB_VGAP, SUB_HGAP, null, true);
      const items = laneify(sm, lay);
      const railW = drawLinks(el('g'), items, 0, 0);   /* 只测量不显示 */
      subLayouts[n.id] = {
        map: sm, layout: lay, items,
        boxW: Math.max(lay.width, railW) + SUB_PAD * 2,
        boxH: lay.height + SUB_PAD * 2 + SUB_TITLE_H
      };
    });
  }

  /* ---------- 绘制 ---------- */
  function render() {
    buildSubLayouts();
    currentLayout = layoutMap(mainMap, st.collapsed, V_GAP, H_GAP, subLayouts);
    const { vis, pos } = currentLayout;

    vpG.textContent = '';
    const gEdge = el('g'), gLink = el('g'), gSub = el('g'), gNode = el('g');
    vpG.append(gEdge, gLink, gSub, gNode);

    vis.forEach(n => {
      const p = pos[n.id];
      if (st.collapsed.has(n.id)) return;
      n.kids.forEach(k => {
        const pk = pos[k.id];
        if (!pk) return;
        const x1 = p.x + n.w, y1 = p.y, x2 = pk.x, y2 = pk.y, mx = (x1 + x2) / 2;
        gEdge.appendChild(el('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, 'edge'));
      });
    });

    const railRight = drawLinks(gLink, laneify(mainMap, currentLayout), 0, 0);
    if (railRight > currentLayout.width) currentLayout.width = railRight;

    /* 右侧内嵌二维子图 */
    let subRight = 0;
    vis.forEach(n => {
      const box = subLayouts[n.id];
      if (!box) return;
      const p = pos[n.id];
      const bx = p.x + n.w + SUB_GAP_X;
      const by = p.y - box.boxH / 2;
      subRight = Math.max(subRight, bx + box.boxW);

      const g = el('g');
      g.appendChild(el('rect', {
        x: bx, y: by, width: box.boxW, height: box.boxH, rx: 14,
        fill: '#f8fafc', stroke: '#cbd5e1', 'stroke-dasharray': '6 5'
      }));
      g.appendChild(el('path', {
        d: `M${p.x + n.w},${p.y} L${bx},${p.y}`,
        stroke: '#cbd5e1', 'stroke-width': 1.4
      }));

      const title = el('text', {
        x: bx + SUB_PAD, y: by + 20, fill: '#475569',
        'font-size': 12, 'font-weight': 700
      });
      title.textContent = '子图 · ' + box.map.title;
      g.appendChild(title);

      const ox = bx + SUB_PAD, oy = by + SUB_TITLE_H + SUB_PAD;
      box.layout.vis.forEach(sn => {
        const sp = box.layout.pos[sn.id];
        if (st.collapsed.has(sn.id)) return;
        sn.kids.forEach(k => {
          const kp = box.layout.pos[k.id];
          if (!kp) return;
          const x1 = ox + sp.x + sn.w, y1 = oy + sp.y;
          const x2 = ox + kp.x, y2 = oy + kp.y, mx = (x1 + x2) / 2;
          g.appendChild(el('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, 'edge'));
        });
      });
      const subRail = drawLinks(g, box.items, ox, oy);
      if (subRail) subRight = Math.max(subRight, ox + subRail);
      gSub.appendChild(g);

      box.layout.vis.forEach(sn => {
        const sp = box.layout.pos[sn.id];
        gNode.appendChild(makeNode(sn, ox + sp.x, oy + sp.y, box.map.id));
      });
    });
    if (subRight > currentLayout.width) currentLayout.width = subRight;

    vis.forEach(n => {
      const p = pos[n.id];
      gNode.appendChild(makeNode(n, p.x, p.y, 'main'));
    });

    updateStat();
    if (fitPending) { fit(); fitPending = false; }
  }

  function makeNode(n, x, y, mapId) {
    const mod = MOD[n.m] || MOD.d;
    const isSel = st.selected.map === mapId && st.selected.id === n.id;
    const g = el('g', { transform: `translate(${x},${y - NODE_H / 2})` },
      'node' + (isSel ? ' sel' : '') + (n.m === 'ext' ? ' ext' : '') + (st.hits.has(n.id) ? ' hit' : ''));
    g.dataset.id = n.id;

    const isDark = isSel || n.m === 'root';
    g.appendChild(el('rect', {
      x: 0, y: 0, width: n.w, height: NODE_H, rx: 9,
      stroke: mod.color,
      fill: isSel ? mod.color : (n.m === 'root' ? mod.color : '#fff')
    }, 'box'));

    const tx = el('text', { x: PAD_X, y: NODE_H / 2, fill: isDark ? '#fff' : '#1f2937' }, 'lbl');
    tx.textContent = n.t;
    g.appendChild(tx);

    const expandable = n.kids.length > 0;
    const drill = !!n.sub;
    if (expandable || drill) {
      const isOpen = drill ? st.openSubs.has(n.id) : !st.collapsed.has(n.id);
      const tog = el('g', { transform: `translate(${n.w - 10},${NODE_H / 2})` },
        'tog' + (drill && !isOpen ? ' sub' : ''));
      tog.appendChild(el('rect', { x: -11, y: -13, width: 22, height: 26 }));
      const glyph = el('text');
      glyph.textContent = isOpen ? '−' : (drill ? '›' : '+');
      tog.appendChild(glyph);
      const ttl = el('title');
      ttl.textContent = drill
        ? (isOpen ? '收起子图' : '在右侧展开二维子图')
        : (isOpen ? '收起' : '展开');
      tog.appendChild(ttl);

      tog.addEventListener('click', ev => {
        ev.stopPropagation();
        if (moved) return;
        if (drill) {
          const willOpen = !st.openSubs.has(n.id);
          if (willOpen) st.openSubs.add(n.id); else st.openSubs.delete(n.id);
          render();
          if (willOpen) revealSub(n.id); else fit();
          return;
        }
        const oldY = y;
        if (st.collapsed.has(n.id)) st.collapsed.delete(n.id); else st.collapsed.add(n.id);
        render();
        const np = currentLayout.pos[n.id];
        if (np) { st.vp.y += (oldY - np.y) * st.vp.k; applyVp(); }
      });
      g.appendChild(tog);
    }

    g.addEventListener('click', ev => {
      ev.stopPropagation();
      if (moved) return;
      select(mapId, n.id);
    });
    return g;
  }

  function updateStat() {
    const shown = currentLayout ? currentLayout.vis.length : mainMap.nodes.length;
    const subs = st.openSubs.size;
    document.getElementById('stat').textContent =
      `${mainMap.nodes.length} 节点 / ${mainMap.links.length} 关系 · 可见 ${shown}` +
      (subs ? ` · 子图 ${subs}` : '');
  }

  /* ---------- 详情卡 ---------- */
  function select(mapId, id) {
    st.selected = { map: mapId, id };
    const m = MAPS[mapId];
    const n = m && m.byId[id];
    if (!n) return;

    const path = [];
    let c = n;
    while (c) { path.unshift(c.t); c = c.p ? m.byId[c.p] : null; }
    let prefix = '';
    if (mapId !== 'main') {
      const host = mainMap.nodes.find(x => x.sub === mapId);
      prefix = (host ? host.t : MAPS[mapId].title) + ' › ';
    }

    document.getElementById('pTitle').textContent = n.t;
    document.getElementById('crumb').textContent =
      prefix + (path.length > 1 ? path.slice(0, -1).join(' › ') : '顶层');

    const mod = MOD[n.m] || MOD.d;
    document.getElementById('chips').innerHTML =
      `<span class="chip mod" style="background:${mod.color}">${mod.name}</span>` +
      (n.no ? `<span class="chip">考点 ${n.no}</span>` : '') +
      (n.tag ? `<span class="chip">${n.tag}</span>` : '') +
      (n.pg ? `<span class="chip">书 p.${n.pg}</span>` : '');

    let html = '';
    if (n.sub) {
      const open = st.openSubs.has(n.id);
      html += `<div class="sec"><button class="goto" data-toggle-sub="${n.id}">` +
        (open ? '收起右侧子图' : '在右侧展开子图：' + MAPS[n.sub].title) + '</button></div>';
    }
    if (n.pr) html += `<div class="sec"><h4>一句话原理</h4><p>${n.pr}</p></div>`;
    if (n.pts && n.pts.length)
      html += `<div class="sec"><h4>要点</h4><ul>${n.pts.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
    if (n.trap) html += `<div class="sec"><div class="trap"><b>易错 / 命题角度：</b>${n.trap}</div></div>`;
    if (n.pg)
      html += `<div class="src">出处：徐涛《2027考研政治核心考案》书页 ${n.pg}，PDF 第 ${parseInt(n.pg, 10) + 8} 页</div>`;

    const body = document.getElementById('pBody');
    body.innerHTML = html;
    const btn = body.querySelector('[data-toggle-sub]');
    if (btn) btn.addEventListener('click', () => {
      const pid = btn.dataset.toggleSub;
      const willOpen = !st.openSubs.has(pid);
      if (willOpen) st.openSubs.add(pid); else st.openSubs.delete(pid);
      render();
      if (willOpen) revealSub(pid); else fit();
    });

    render();
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
    st.vp.k = Math.max(0.14, k);
    st.vp.x = Math.max(pad, (r.width - currentLayout.width * st.vp.k) / 2);
    st.vp.y = Math.max(padTop, (r.height - currentLayout.height * st.vp.k) / 2 + 14);
    applyVp();
  }
  function centerAt(x, y) {
    const r = svg.getBoundingClientRect();
    st.vp.k = Math.max(st.vp.k, 0.72);
    st.vp.x = r.width * 0.42 - x * st.vp.k;
    st.vp.y = r.height * 0.5 - y * st.vp.k;
    applyVp();
  }
  function ensureVisible(x1, y1, x2, y2) {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const padTop = 70, padR = 18, padB = 18, padL = 18;
    const sx1 = st.vp.x + x1 * st.vp.k, sx2 = st.vp.x + x2 * st.vp.k;
    const sy1 = st.vp.y + y1 * st.vp.k, sy2 = st.vp.y + y2 * st.vp.k;
    let dx = 0, dy = 0;
    if (sx2 > r.width - padR) dx = r.width - padR - sx2;
    if (sx1 + dx < padL) dx = Math.max(0, r.width - padR - sx2);
    if (sy2 > r.height - padB) dy = r.height - padB - sy2;
    if (sy1 + dy < padTop) dy = Math.max(padTop - sy1, r.height - padB - sy2);
    st.vp.x += dx;
    st.vp.y += dy;
    applyVp();
  }

  function revealSub(hostId) {
    const box = subLayouts[hostId];
    const p = currentLayout && currentLayout.pos[hostId];
    if (!box || !p) { fit(); return; }
    const bx = p.x + mainMap.byId[hostId].w + SUB_GAP_X;
    ensureVisible(bx, p.y - box.boxH / 2, bx + box.boxW, p.y + box.boxH / 2);
  }

  function zoomAt(mx, my, k2) {
    k2 = Math.min(3, Math.max(0.1, k2));
    st.vp.x = mx - (mx - st.vp.x) * (k2 / st.vp.k);
    st.vp.y = my - (my - st.vp.y) * (k2 / st.vp.k);
    st.vp.k = k2;
    applyVp();
  }

  /* ---------- 手势 ---------- */
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
    st.hits = new Set();
    if (!q) { render(); return; }

    let target = null, targetMap = null;
    mainMap.nodes.forEach(n => {
      if (n.t.indexOf(q) >= 0 || (n.pr && n.pr.indexOf(q) >= 0)) {
        st.hits.add(n.id);
        let c = n;
        while (c && c.p) { st.collapsed.delete(c.p); c = mainMap.byId[c.p]; }
        if (!target) { target = n; targetMap = 'main'; }
      }
    });
    mainMap.nodes.forEach(host => {
      if (!host.sub || !MAPS[host.sub]) return;
      MAPS[host.sub].nodes.forEach(n => {
        if (n.t.indexOf(q) >= 0 || (n.pr && n.pr.indexOf(q) >= 0)) {
          st.hits.add(n.id);
          st.openSubs.add(host.id);
          if (!target) { target = n; targetMap = host.sub; }
        }
      });
    });

    render();
    if (target) {
      let x = 0, y = 0;
      if (targetMap === 'main') {
        const p = currentLayout.pos[target.id];
        if (p) { x = p.x; y = p.y; }
      } else {
        const host = mainMap.nodes.find(h => h.sub === targetMap);
        const hp = host && currentLayout.pos[host.id];
        const box = host && subLayouts[host.id];
        if (hp && box && box.layout.pos[target.id]) {
          x = hp.x + host.w + SUB_GAP_X + SUB_PAD + box.layout.pos[target.id].x;
          y = hp.y - box.boxH / 2 + SUB_TITLE_H + SUB_PAD + box.layout.pos[target.id].y;
        }
      }
      centerAt(x, y);
      select(targetMap, target.id);
    }
  });

  /* ---------- 按钮 ---------- */
  document.getElementById('btnFit').onclick = () => fit();
  document.getElementById('btnL2').onclick = () => { st.collapsed = mainMap.defaultCollapsed(); render(); fit(); };
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
  st.collapsed = mainMap.defaultCollapsed();
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

  select('main', 'root');
})();
