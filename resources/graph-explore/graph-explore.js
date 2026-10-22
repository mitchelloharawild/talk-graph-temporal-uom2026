// Interactive graph explorer: drill down from the top series one
// disaggregation at a time (see _dev/GRAPH-EXPLORE.md).
//
// The data comes from graph_explore() in R/graph-explore.R. Clicking a node
// opens a menu of its dimension-graph node's out-edges; choosing one draws
// that group of children. Right-clicking a node collapses its children.
// render() is a pure function of the state, and handlers only change the
// state, so CSS transitions animate every change, as in graph-walk.js.
//
// Each scripted click is a .graph-explore-step fragment. The state survives
// leaving and returning to the slide.
(function () {
  'use strict';

  // Depth palette shared with every graph in the talk (level_colours), and
  // one edge colour per chain of the structure (constraint_colours)
  var LEVEL = ['#B3B3B3', '#084887', '#8093F1', '#FBB13C', '#B388EB'];
  var CHAIN = ['#1B998B', '#C33C8A', '#5E5E5E'];
  var BAND = 100, STRIP = 144, SVGNS = 'http://www.w3.org/2000/svg';
  // Groups wider than this show their first CAP children and a "+k more" chip
  var CAP = 12;

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, parent, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }
  function css(e, s) { for (var k in s) e.style[k] = s[k]; return e; }
  function px(x) { return x.toFixed(1) + 'px'; }
  function level(d) { return LEVEL[Math.min(d, LEVEL.length - 1)]; }
  function esc(t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // A line from (x1, y1) to (x2, y2), drawn as a rotated box so it can be animated
  function lineStyle(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    return { left: px(x1), top: px(y1), width: px(len), transform: 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)' };
  }

  // ---- Time plots ------------------------------------------------------------
  // Free scales: each plot has its own y-axis over its data's range

  function spark(y, x0, w, h, r) {
    return y.map(function (v, i) {
      return (x0 + i * w / (y.length - 1)).toFixed(1) + ',' + (h - (v - r[0]) / (r[1] - r[0]) * h).toFixed(1);
    }).join(' ');
  }
  // The data's range, padded a little so the line clears the edges
  function range(y) {
    var lo = Math.min.apply(null, y), hi = Math.max.apply(null, y), pad = (hi - lo) * 0.06 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }
  // The widest 1, 2, 5 step that still puts at least n ticks inside the range
  function niceStep(r, n) {
    var count = function (s) { return Math.floor(r[1] / s) - Math.ceil(r[0] / s) + 1; };
    for (var e = Math.ceil(Math.log10(r[1] - r[0])); ; e--) {
      var m = Math.pow(10, e);
      for (var f = 0; f < 3; f++) { var s = [5, 2, 1][f] * m; if (count(s) >= n) return s; }
    }
  }
  function tickLabel(v) {
    var r = function (x) { return String(+x.toFixed(1)); };
    return v >= 1e6 ? r(v / 1e6) + 'M' : v >= 1e3 ? r(v / 1e3) + 'k' : r(v);
  }
  function yAxis(g, r, x0, w, h, n) {
    var step = niceStep(r, n);
    for (var v = Math.ceil(r[0] / step) * step; v <= r[1]; v += step) {
      var y = h - (v - r[0]) / (r[1] - r[0]) * h;
      svgEl('line', g, { class: 'gx-tick-line', x1: x0, x2: x0 + w, y1: y, y2: y });
      svgEl('text', g, { class: 'gx-tick', x: x0 - 4, y: y + 3.5, 'text-anchor': 'end' }).textContent = tickLabel(v);
    }
  }

  // ---- Explorer ----------------------------------------------------------------

  function Explorer(root) {
    this.root = root;
    this.spec = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    this.section = root.closest('section');
  }

  Explorer.prototype.data = function () {
    var self = this, spec = this.spec, keys = spec.keys;
    this.labels = spec.labels || {};
    this.varCol = {};
    spec.chains.forEach(function (vars, i) { vars.forEach(function (v) { self.varCol[v] = CHAIN[i % CHAIN.length]; }); });
    this.series = spec.series.map(function (r) {
      var s = { y: r[keys.length] };
      keys.forEach(function (k, i) { s[k] = r[i]; });
      s.id = keys.map(function (k) { return s[k] == null ? 'NA' : s[k]; }).join('|');
      s.depth = keys.filter(function (k) { return s[k] != null; }).length;
      return s;
    });
    this.byId = {};
    this.series.forEach(function (s) { self.byId[s.id] = s; });
    this.ROOT = this.series.filter(function (s) { return s.depth === 0; })[0].id;
    this.maxDepth = Math.max.apply(null, this.series.map(function (s) { return s.depth; }));
    this.dims = {};
    spec.dims.nodes.forEach(function (d) { d.key = d.levels.join(','); self.dims[d.key] = d; });
  };

  Explorer.prototype.show = function (k, v) { return this.labels[v] || v; };
  // Full name: every fixed key, leaving out keys implied by a deeper key of the same chain
  Explorer.prototype.fullLabel = function (s) {
    var self = this;
    if (!s.depth) return 'Total';
    var out = [];
    this.spec.chains.forEach(function (vars) {
      var fixed = vars.filter(function (k) { return s[k] != null; });
      if (fixed.length) out.push(self.show(fixed[fixed.length - 1], s[fixed[fixed.length - 1]]));
    });
    return out.join(' · ');
  };
  // Children of s by v: the same keys, plus a value for v (cf. walk_children())
  Explorer.prototype.children = function (s, v) {
    var keys = this.spec.keys;
    return this.series.filter(function (c) {
      return keys.every(function (k) { return k === v ? c[k] != null : c[k] === s[k]; });
    }).sort(function (a, b) { return a[v] < b[v] ? -1 : 1; });
  };
  // Variables the series can still be split by (cf. next_dims())
  Explorer.prototype.nextDims = function (s) {
    return this.spec.chains.map(function (vars) { return vars.filter(function (k) { return s[k] == null; })[0]; })
      .filter(Boolean);
  };
  Explorer.prototype.dimOf = function (s) {
    return this.dims[this.spec.chains.map(function (vars) { return vars.filter(function (k) { return s[k] != null; }).length; }).join(',')];
  };

  // ---- State -----------------------------------------------------------------

  Explorer.prototype.initial = function () {
    return { focus: this.ROOT, groups: [], menu: null, last: null, showAll: {}, note: null, collapseTo: null };
  };
  Explorer.prototype.findGroup = function (key) {
    return this.state.groups.filter(function (g) { return g.key === key; })[0];
  };
  Explorer.prototype.visibleKids = function (g) {
    return this.state.showAll[g.key] || g.kids.length <= CAP + 1 ? g.kids : g.kids.slice(0, CAP);
  };
  Explorer.prototype.visibleSet = function () {
    var self = this, vis = {};
    vis[this.ROOT] = true;
    this.state.groups.forEach(function (g) { self.visibleKids(g).forEach(function (id) { vis[id] = true; }); });
    return vis;
  };

  Explorer.prototype.choose = function (id, v) {
    var st = this.state, key = id + '~' + v, g = this.findGroup(key);
    if (!g) {
      var before = this.visibleSet();
      var kids = this.children(this.byId[id], v).map(function (c) { return c.id; });
      g = { key: key, parent: id, v: v, kids: kids, shared: kids.filter(function (k) { return before[k]; }), fresh: true };
      st.groups.push(g);
    } else {
      g.fresh = false;
    }
    st.focus = id;
    st.last = key;
    st.menu = null;
    st.note = null;
    this.render();
  };

  // Drop the node's groups, then any group whose parent is no longer drawn.
  // Shared descendants survive while another path still reaches them.
  Explorer.prototype.collapse = function (id) {
    var self = this, st = this.state;
    var had = Object.keys(this.visibleSet()).length;
    st.collapseTo = id;
    st.groups = st.groups.filter(function (g) { return g.parent !== id; });
    for (var n = -1; n !== st.groups.length;) {
      var vis = this.visibleSet();
      n = st.groups.length;
      st.groups = st.groups.filter(function (g) { return vis[g.parent]; });
    }
    if (!this.visibleSet()[st.focus]) st.focus = id;
    if (st.last && !this.findGroup(st.last)) {
      var mine = st.groups.filter(function (g) { return g.parent === st.focus; });
      st.last = mine.length ? mine[mine.length - 1].key : null;
    }
    st.menu = null;
    var gone = had - Object.keys(this.visibleSet()).length;
    st.note = '<b>' + esc(self.fullLabel(this.byId[id])) + '</b> collapsed' + (gone ? ': ' + gone + ' series removed.' : '. It had no children drawn.');
    this.render();
  };

  // ---- Build -----------------------------------------------------------------

  Explorer.prototype.build = function () {
    var self = this, spec = this.spec;
    this.data();
    this.state = this.initial();
    var W = this.root.offsetWidth || 1280, H = this.root.offsetHeight || 720;
    this.SP = Math.round(W * 0.375);
    this.GW = W - this.SP;
    this.PH = H - BAND;
    this.LH = this.PH - STRIP;
    this.IW = this.SP - 56;
    this.rowGap = Math.min(124, (this.LH - 160) / Math.max(1, this.maxDepth));

    var stage = this.stage = el('div', 'gx-stage', this.root);
    var band = el('div', 'gx-band', stage);
    this.terms = {};
    spec.structure.split(/([A-Za-z_.][A-Za-z0-9_.]*)/).forEach(function (t) {
      if (!t) return;
      var span = el('span', null, band, t);
      if (spec.keys.indexOf(t) > -1) { span.className = 'gx-term'; self.terms[t] = span; }
    });

    // Series pane: the focus drawn full width, with its children as small multiples
    var pane = css(el('div', 'gx-series', stage), { top: BAND + 'px', width: this.SP + 'px', height: this.PH + 'px' });
    var head = el('div', 'gx-head', pane);
    this.headSwatch = el('span', 'gx-swatch', head);
    this.headLabel = el('span', 'gx-head-label', head);
    this.headSub = el('span', 'gx-head-sub', head);
    this.PHT = 90;
    var parSvg = svgEl('svg', pane, { width: this.IW, height: this.PHT + 16 });
    this.parGrid = svgEl('g', parSvg);
    this.parLine = svgEl('polyline', parSvg, { class: 'gx-spark' });
    this.parAxis = svgEl('g', parSvg);
    this.sections = el('div', 'gx-sections', pane);
    this.banner = el('div', 'gx-banner', pane);

    // Graph pane, with the dimension graph and the path taken along the bottom
    var graph = css(el('div', 'gx-graph', stage), { left: this.SP + 'px', top: BAND + 'px', width: this.GW + 'px', height: this.PH + 'px' });
    this.layer = css(el('div', 'gx-layer', graph), { width: this.GW + 'px', height: this.LH + 'px' });
    var strip = css(el('div', 'gx-strip', graph), { height: STRIP + 'px' });
    var inset = el('div', 'gx-inset', strip);
    el('div', 'gx-caps', inset, 'Dimension graph');
    this.buildInset(inset);
    var side = el('div', 'gx-side', strip);
    var top = el('div', 'gx-side-top', side);
    el('div', 'gx-caps', top, 'Path taken');
    var tally = el('div', 'gx-tally', top);
    this.count = el('span', 'gx-count', tally);
    el('span', 'gx-count-sub', tally, 'of ' + this.series.length + ' series drawn');
    this.pathBox = el('div', 'gx-path', side);

    graph.addEventListener('click', function () {
      if (self.state.menu) { self.state.menu = null; self.render(); }
    });
    // Keep keys away from Reveal while a menu is open; Escape closes it
    document.addEventListener('keydown', function (ev) {
      if (!self.state.menu || Reveal.getCurrentSlide() !== self.section) return;
      ev.stopPropagation();
      if (ev.key === 'Escape') { self.state.menu = null; self.render(); }
    }, true);

    this.nodeEls = {};
    this.edgeEls = {};
    this.moreEls = {};
    this.menuEl = null;
    this.hover = null;
    this.built = true;
  };

  // The Hasse diagram from the dimension graph slides
  Explorer.prototype.buildInset = function (inset) {
    var self = this, U = 84, V = 24, nodes = this.spec.dims.nodes;
    var maxY = Math.max.apply(null, nodes.map(function (d) { return d.y; }));
    // Labels sit beside each node, out of the way of its edges
    var lab = function (d) {
      if (d.x < 0) return [-10, 0, 'end'];
      if (d.y === maxY) return [12, 12, 'start'];
      if (d.x === 0 && d.y > 0) return [-12, 14, 'end'];
      return [10, 0, 'start'];
    };
    var x0 = 0, x1 = 0;
    nodes.forEach(function (d) {
      var l = lab(d), w = (d.name.length + String(d.n).length + 1) * 6.8, x = d.x * U + l[0];
      x0 = Math.min(x0, l[2] === 'end' ? x - w : x);
      x1 = Math.max(x1, l[2] === 'end' ? x : x + w);
    });
    var h = maxY * V + 26;
    var svg = svgEl('svg', inset, { width: Math.ceil(x1 - x0 + 8), height: h + 10, viewBox: [x0 - 4, -10, x1 - x0 + 8, h + 10].join(' ') });
    this.dEdgeEls = this.spec.dims.edges.map(function (e) {
      var a = nodes[e.from], b = nodes[e.to];
      return svgEl('line', svg, { class: 'gx-de', x1: a.x * U, y1: a.y * V, x2: b.x * U, y2: b.y * V, stroke: self.varCol[e.var] });
    });
    this.dNodeEls = nodes.map(function (d) {
      var g = svgEl('g', svg, { class: 'gx-dn' }), l = lab(d);
      svgEl('circle', g, { cx: d.x * U, cy: d.y * V, r: 6 });
      var t = svgEl('text', g, { x: d.x * U + l[0], y: d.y * V + l[1] + 4, 'text-anchor': l[2] });
      t.appendChild(document.createTextNode(d.name + ' '));
      svgEl('tspan', t, { class: 'gx-dn-n' }).textContent = d.n;
      return g;
    });
  };

  Explorer.prototype.makeNode = function (id) {
    var self = this, s = this.byId[id];
    var b = el('button', 'gx-node', this.layer);
    b.type = 'button';
    b.title = this.fullLabel(s);
    b.setAttribute('aria-label', this.fullLabel(s));
    var ring = el('div', 'gx-ring', b);
    el('div', 'gx-halo', ring);
    css(el('div', 'gx-dot', ring), { background: level(s.depth) });
    var label = el('div', 'gx-label', b);
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.state.menu = self.state.menu === id ? null : id;
      self.render();
    });
    b.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      self.collapse(id);
    });
    return { box: b, label: label };
  };

  // ---- Layout ----------------------------------------------------------------

  Explorer.prototype.rowY = function (d) { return 50 + d * this.rowGap; };

  // Layered layout: each group centres under its parent, then groups push apart.
  // A node is placed by the first group that reached it; later groups only add edges.
  // A node with a second parent moves to the end of its group nearest that
  // parent, and takes its full name, so the extra edge doesn't cross the group.
  Explorer.prototype.layout = function () {
    var self = this, st = this.state, byId = this.byId, GW = this.GW;
    var pos = {}, claimed = {}, tilt = {}, labelOf = {}, more = [];
    pos[this.ROOT] = { x: GW / 2, y: this.rowY(0) };
    claimed[this.ROOT] = true;
    labelOf[this.ROOT] = 'Total';
    var parents = {};
    st.groups.forEach(function (g) {
      self.visibleKids(g).forEach(function (id) { (parents[id] = parents[id] || []).push(g.parent); });
    });
    var placedBy = st.groups.map(function (g) {
      return self.visibleKids(g).filter(function (id) {
        if (claimed[id]) return false;
        claimed[id] = true;
        labelOf[id] = parents[id].length > 1 ? self.fullLabel(byId[id]) : self.show(g.v, byId[id][g.v]);
        return true;
      });
    });
    for (var d = 1; d <= this.maxDepth; d++) {
      var groups = [];
      st.groups.forEach(function (g, j) {
        if (byId[g.kids[0]].depth !== d) return;
        var px0 = pos[g.parent].x;
        var side = function (id) {
          var other = parents[id].filter(function (p) { return p !== g.parent; })[0];
          return other == null ? 0 : pos[other].x < px0 ? -1 : 1;
        };
        var items = placedBy[j].map(function (id, i) { return { id: id, i: i, side: side(id) }; })
          .sort(function (a, b) { return a.side - b.side || a.i - b.i; });
        var hidden = g.kids.length - self.visibleKids(g).length;
        if (hidden > 0) items.push({ more: g.key, n: hidden });
        if (items.length) groups.push({ j: j, items: items, cx: pos[g.parent].x });
      });
      if (!groups.length) continue;
      groups.sort(function (a, b) { return a.cx - b.cx || a.j - b.j; });
      var ML = 44, MR = 44, gap = 18, avail = GW - ML - MR - gap * (groups.length - 1);
      var nw = function (it) { return it.more ? 64 : Math.max(48, labelOf[it.id].length * 7.6 + 20); };
      var total = function () {
        return groups.reduce(function (t, g) { return t + g.items.reduce(function (u, it) { return u + nw(it); }, 0); }, 0);
      };
      var raw = total();
      // Too wide for upright labels: tilt the row and pack its nodes tightly
      if (raw > avail) {
        tilt[d] = true;
        nw = function (it) { return it.more ? 40 : 30; };
        raw = total();
      }
      var sc = Math.min(1, avail / raw), end = ML - gap;
      groups.forEach(function (g) {
        g.w = g.items.reduce(function (u, it) { return u + nw(it) * sc; }, 0);
        g.start = Math.max(g.cx - g.w / 2, end + gap);
        end = g.start + g.w;
      });
      var over = Math.max(0, end - (GW - MR));
      groups.forEach(function (g) {
        var x = g.start - over;
        g.items.forEach(function (it) {
          var w = nw(it) * sc, p = { x: x + w / 2, y: self.rowY(d) };
          if (it.more) more.push({ key: it.more, n: it.n, x: p.x, y: p.y });
          else pos[it.id] = p;
          x += w;
        });
      });
    }
    return { pos: pos, tilt: tilt, labelOf: labelOf, more: more };
  };

  // ---- Render ----------------------------------------------------------------

  Explorer.prototype.render = function () {
    if (!this.built) this.build();
    var self = this, st = this.state, byId = this.byId, layer = this.layer;
    var vis = this.visibleSet(), L = this.layout(), pos = L.pos;
    var lastG = st.last ? this.findGroup(st.last) : null;

    var parents = {};
    st.groups.forEach(function (g) {
      self.visibleKids(g).forEach(function (id) { (parents[id] = parents[id] || []).push(g); });
    });

    // New nodes grow out of their first parent; leaving ones are animated below
    var leaving = [], leavingEdges = [];
    Object.keys(vis).forEach(function (id) {
      if (self.nodeEls[id]) return;
      var e = self.nodeEls[id] = self.makeNode(id);
      var from = parents[id] ? pos[parents[id][0].parent] : pos[id];
      css(e.box, { left: px(from.x - 18), top: px(from.y - 18), opacity: 0, transform: 'scale(.2)' });
    });
    Object.keys(this.nodeEls).forEach(function (id) {
      if (vis[id]) return;
      leaving.push(self.nodeEls[id].box);
      delete self.nodeEls[id];
    });

    // Edges, one per (group, visible child)
    var want = {};
    st.groups.forEach(function (g) {
      self.visibleKids(g).forEach(function (id) { want[g.parent + '>' + id] = { g: g, child: id }; });
    });
    Object.keys(want).forEach(function (k) {
      if (self.edgeEls[k]) return;
      var w = want[k], a = pos[w.g.parent];
      var box = el('div', 'gx-edge', layer), line = el('div', 'gx-line', box);
      css(box, lineStyle(a.x, a.y + 30, a.x, a.y + 31));
      line.style.transform = 'scaleX(0)';
      self.edgeEls[k] = { box: box, line: line, parent: w.g.parent };
    });
    Object.keys(this.edgeEls).forEach(function (k) {
      if (want[k]) return;
      leavingEdges.push(self.edgeEls[k]);
      delete self.edgeEls[k];
    });

    void layer.offsetWidth;

    // Leaving nodes shrink into the collapsed node while their edges retract
    var to = pos[st.collapseTo] || pos[this.ROOT];
    leaving.forEach(function (box) {
      box.style.pointerEvents = 'none';
      box.tabIndex = -1;
      css(box, { left: px(to.x - 18), top: px(to.y - 18), opacity: 0, transform: 'scale(.2)' });
      setTimeout(function () { box.remove(); }, 750);
    });
    leavingEdges.forEach(function (e) {
      var a = pos[e.parent] || to;
      css(e.box, lineStyle(a.x, a.y + 36, to.x, to.y + 36));
      e.line.style.transform = 'scaleX(0)';
      e.box.style.opacity = 0;
      setTimeout(function () { e.box.remove(); }, 750);
    });
    st.collapseTo = null;

    Object.keys(this.nodeEls).forEach(function (id) {
      var e = self.nodeEls[id], p = pos[id];
      css(e.box, { left: px(p.x - 18), top: px(p.y - 18), opacity: 1, transform: 'scale(1)' });
      e.label.textContent = L.labelOf[id];
      e.box.classList.toggle('gx-tilt', !!L.tilt[byId[id].depth]);
      e.box.classList.toggle('gx-focus', id === st.focus);
      e.box.classList.toggle('gx-menu-on', id === st.menu);
      e.box.classList.toggle('gx-multi', (parents[id] || []).length > 1);
    });

    // Edges leave the parent below its label and arrive at the top of the child's dot
    Object.keys(this.edgeEls).forEach(function (k) {
      var e = self.edgeEls[k], w = want[k], a = pos[w.g.parent], b = pos[w.child];
      css(e.box, lineStyle(a.x, a.y + (L.tilt[byId[w.g.parent].depth] ? 16 : 36), b.x, b.y - 14));
      e.line.style.transform = 'scaleX(1)';
      e.line.style.borderTopColor = self.varCol[w.g.v];
      var second = (parents[w.child] || []).length > 1;
      e.box.classList.toggle('gx-second', second);
      e.box.classList.toggle('gx-new', second && w.g.key === st.last && w.g.fresh && w.g.shared.indexOf(w.child) > -1);
    });

    // "+k more" chips for wide groups
    var moreWant = {};
    L.more.forEach(function (m) { moreWant[m.key] = m; });
    Object.keys(this.moreEls).forEach(function (k) {
      if (moreWant[k]) return;
      var m = self.moreEls[k];
      css(m, { opacity: 0, pointerEvents: 'none' });
      setTimeout(function () { m.remove(); }, 450);
      delete self.moreEls[k];
    });
    L.more.forEach(function (m) {
      var e = self.moreEls[m.key];
      if (!e) {
        e = self.moreEls[m.key] = el('button', 'gx-more', layer);
        e.type = 'button';
        e.addEventListener('click', function (ev) { ev.stopPropagation(); st.showAll[m.key] = true; self.render(); });
      }
      e.textContent = '+' + m.n;
      e.title = 'Show ' + m.n + ' more';
      css(e, { left: px(m.x), top: px(m.y) });
    });

    this.renderMenu(pos, L);
    // Band: underline the variable last split by, in the colour of its new depth
    Object.keys(this.terms).forEach(function (t) {
      var on = lastG && lastG.v === t;
      self.terms[t].classList.toggle('gx-active', !!on);
      self.terms[t].style.textDecorationColor = on ? level(byId[lastG.kids[0]].depth) : 'transparent';
    });
    this.renderSeries(byId[st.focus], lastG);
    this.renderInset(vis);
    this.pathBox.textContent = '';
    if (!st.groups.length) el('span', 'gx-step gx-hint', this.pathBox, 'Nothing split yet. Each split adds a step here; right-clicking a node removes its steps.');
    st.groups.forEach(function (g) {
      el('span', 'gx-step' + (g === lastG ? ' gx-last' : ''), self.pathBox, self.fullLabel(byId[g.parent]) + ' → ' + g.v);
    });
    this.count.textContent = Object.keys(vis).length;
  };

  Explorer.prototype.renderMenu = function (pos, L) {
    var self = this, st = this.state;
    if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
    if (!st.menu) return;
    var s = this.byId[st.menu], p = pos[st.menu], dims = this.nextDims(s);
    var menu = this.menuEl = el('div', 'gx-menu', this.layer);
    if (!dims.length) el('span', 'gx-tag', menu, 'no further split');
    dims.forEach(function (v) {
      var done = !!self.findGroup(s.id + '~' + v);
      var c = el('button', 'gx-chip' + (done ? ' gx-done' : ''), menu);
      c.type = 'button';
      css(el('span', 'gx-key', c), { color: self.varCol[v] });
      el('span', null, c, v);
      el('span', 'gx-n', c, done ? '✓ shown' : String(self.children(s, v).length));
      c.addEventListener('click', function (ev) { ev.stopPropagation(); self.hover = null; self.choose(s.id, v); });
      var hot = function (on) { return function () { self.hover = on ? v : null; self.renderInset(self.visibleSet()); }; };
      c.addEventListener('mouseenter', hot(true));
      c.addEventListener('focus', hot(true));
      c.addEventListener('mouseleave', hot(false));
    });
    // Keep the chips inside the pane
    var w = menu.offsetWidth, top = p.y + (L.tilt[s.depth] ? 22 : 58);
    css(menu, { left: px(Math.min(Math.max(p.x, w / 2 + 10), this.GW - w / 2 - 10)), top: px(Math.min(top, this.LH - 40)) });
  };

  Explorer.prototype.renderSeries = function (s, lastG) {
    var self = this, st = this.state, IW = this.IW, PHT = this.PHT;
    this.headSwatch.style.background = level(s.depth);
    this.headLabel.textContent = this.fullLabel(s);
    this.headSub.textContent = s.depth ? this.dimOf(s).name : '';

    // The focus, full width, with a year grid
    var r = range(s.y), YG = 40, PW = IW - YG, n = s.y.length;
    this.parGrid.textContent = '';
    this.parAxis.textContent = '';
    yAxis(this.parGrid, r, YG, PW, PHT, 3);
    var y0 = this.spec.years[0], y1 = this.spec.years[1], per = (n - 1) / (y1 - y0);
    for (var yr = Math.ceil(y0 / 5) * 5; yr <= y1; yr += 5) {
      var x = YG + (yr - y0) * per * PW / (n - 1);
      svgEl('line', this.parGrid, { class: 'gx-grid', x1: x, x2: x, y1: 0, y2: PHT });
      svgEl('text', this.parAxis, { class: 'gx-axis', x: x, y: PHT + 14, 'text-anchor': 'middle' }).textContent = yr;
    }
    this.parLine.setAttribute('points', spark(s.y, YG, PW, PHT, r));

    // The children of the last group chosen at the focus
    var g = lastG && lastG.parent === s.id ? lastG : null;
    this.sections.textContent = '';
    if (!g) {
      el('div', 'gx-empty', this.sections, s.depth === this.maxDepth ? 'Every key is fixed. This series has no children.' : 'No children drawn yet. Click ' + this.fullLabel(s) + ' in the graph to split it.');
    } else {
      var cols = g.kids.length <= 4 ? 2 : g.kids.length <= 9 ? 3 : g.kids.length <= 16 ? 4 : 5;
      var rows = Math.ceil(g.kids.length / cols);
      var avail = this.PH - 44 - 26 - (PHT + 16) - 76 - 30 - 34;
      var sh = Math.max(18, Math.min(118, (avail - (rows - 1) * 8) / rows) - 22);
      var sec = el('div', null, this.sections);
      var hd = el('div', 'gx-section-head', sec);
      css(el('span', 'gx-vk', hd), { color: this.varCol[g.v] });
      el('span', null, hd, 'by ' + g.v + ' · ' + g.kids.length + ' series');
      var box = el('div', 'gx-cells', sec);
      box.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      var cw = (IW - (cols - 1) * 10) / cols, yg = 28;
      g.kids.forEach(function (id) {
        var k = self.byId[id];
        var c = el('div', 'gx-cell' + (g.shared.indexOf(id) > -1 ? ' gx-shared' : ''), box);
        var chd = el('div', 'gx-cell-head', c);
        css(el('span', 'gx-swatch', chd), { background: level(k.depth) });
        el('span', 'gx-cell-label', chd, self.show(g.v, k[g.v])).title = self.fullLabel(k);
        var sv = svgEl('svg', c, { width: cw.toFixed(0), height: sh.toFixed(0) });
        var kr = range(k.y);
        yAxis(svgEl('g', sv), kr, yg, cw - yg, sh, 2);
        svgEl('polyline', sv, { class: 'gx-spark', points: spark(k.y, yg, cw - yg, sh, kr) });
      });
    }
    this.banner.innerHTML = this.bannerText(s, lastG);
  };

  Explorer.prototype.bannerText = function (s, lastG) {
    var st = this.state, spec = this.spec;
    if (st.menu) {
      st.note = null;
      var m = this.byId[st.menu], dims = this.nextDims(m);
      if (!dims.length) return '<b>' + esc(this.fullLabel(m)) + '</b> has every key fixed, so its dimension node has no out-edges.';
      var chain = spec.chains.filter(function (vars) { return vars.length > 1; })[0];
      var nested = chain && dims.some(function (v) { var i = chain.indexOf(v); return i > 0 && m[chain[i - 1]] != null; }) ?
        ' Nested variables are only offered once the variable above them is fixed.' : '';
      return '<b>' + esc(this.fullLabel(m)) + '</b> sits at the <b>' + esc(this.dimOf(m).name) + '</b> node. Its menu is that node\'s ' +
        dims.length + ' out-' + (dims.length > 1 ? 'edges' : 'edge') + ' in the dimension graph.' + nested;
    }
    if (st.note) return st.note;
    if (!lastG && st.groups.length) return 'Click a node to split it. Right-click a node to collapse its children.';
    if (!lastG) return '<b>' + esc(spec.value) + '</b>, ' + esc(spec.times[0]) + ' to ' + esc(spec.times[1]) + '. Click <b>Total</b> to choose how to split it.';
    if (lastG.parent !== s.id) return 'Click any node to see its menu, or right-click it to collapse its children.';
    var txt = '<b>' + esc(this.fullLabel(s)) + '</b> by ' + lastG.v + ': ' + lastG.kids.length + ' series.';
    if (lastG.fresh && lastG.shared.length) {
      txt += ' ' + (lastG.shared.length === 1 ? esc(this.fullLabel(this.byId[lastG.shared[0]])) + ' was' : lastG.shared.length + ' of them were') +
        ' already drawn, so ' + (lastG.shared.length === 1 ? 'it gains' : 'they gain') + ' a second parent instead of a copy. The series graph is a DAG.';
    } else if (!lastG.fresh) {
      txt += ' Already expanded, so it is refocused.';
    }
    return txt;
  };

  // The focus (or open menu) fills its dimension node; its out-edges are the menu
  Explorer.prototype.renderInset = function (vis) {
    var self = this, nodes = this.spec.dims.nodes;
    var active = this.dimOf(this.byId[this.state.menu || this.state.focus]);
    var seen = {};
    Object.keys(vis).forEach(function (id) { seen[self.dimOf(self.byId[id]).key] = true; });
    nodes.forEach(function (d, i) {
      self.dNodeEls[i].setAttribute('class', 'gx-dn' + (seen[d.key] ? ' gx-seen' : '') + (d === active ? ' gx-on' : ''));
    });
    this.spec.dims.edges.forEach(function (e, i) {
      var out = nodes[e.from] === active;
      self.dEdgeEls[i].setAttribute('class', 'gx-de' + (out ? ' gx-out' : '') + (out && self.hover === e.var ? ' gx-hot' : ''));
    });
  };

  // ---- Scripted clicks ---------------------------------------------------------

  // Show the step's menu, then choose; skipped steps are applied at once
  Explorer.prototype.goTo = function (step) {
    var self = this, script = this.spec.script || [];
    step = Math.min(step, script.length);
    if (step === this.step) return;
    clearTimeout(this.timer);
    var next = script[step - 1];
    if (step === this.step + 1 && this.visibleSet()[next.parent]) {
      this.state.menu = next.parent;
      this.render();
      this.hover = next.term;
      this.renderInset(this.visibleSet());
      this.timer = setTimeout(function () { self.hover = null; self.choose(next.parent, next.term); }, 900);
    } else {
      this.state = this.initial();
      this.state.collapseTo = this.ROOT;
      script.slice(0, step).forEach(function (c) {
        var key = c.parent + '~' + c.term;
        if (!self.findGroup(key)) {
          var before = self.visibleSet();
          var kids = self.children(self.byId[c.parent], c.term).map(function (k) { return k.id; });
          self.state.groups.push({ key: key, parent: c.parent, v: c.term, kids: kids, shared: kids.filter(function (k) { return before[k]; }), fresh: true });
        }
        self.state.focus = c.parent;
        self.state.last = key;
      });
      this.render();
    }
    this.step = step;
  };

  // ---- Reveal integration ------------------------------------------------------

  function init() {
    var explorers = [].map.call(document.querySelectorAll('.graph-explore'), function (r) { return new Explorer(r); });
    var update = function () {
      var current = Reveal.getCurrentSlide();
      explorers.forEach(function (x) {
        if (x.section !== current) return;
        if (!x.built) { x.render(); x.step = 0; }
        x.goTo(current.querySelectorAll('.graph-explore-step.visible').length);
      });
    };
    Reveal.on('fragmentshown', update);
    Reveal.on('fragmenthidden', update);
    Reveal.on('slidechanged', update);
    update();
  }

  window.addEventListener('load', function () {
    if (!window.Reveal) return;
    if (Reveal.isReady()) init(); else Reveal.on('ready', init);
  });
})();
