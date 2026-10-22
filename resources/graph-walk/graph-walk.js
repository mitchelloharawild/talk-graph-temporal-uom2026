// Animated graph walks for explaining graph pruning.
//
// The data comes from graph_walk() and graph_recap() in R/graph-walk.R, which
// decide everything shown. This file only lays it out and animates it:
//
// * .graph-walk steps with the slide's .graph-walk-step fragments. Each step
//   is drawn from scratch by render(step), and CSS transitions animate the
//   change, so stepping backwards works too.
// * .graph-recap plays a depth-first replay with CSS animation delays each
//   time its slide is shown.
(function () {
  'use strict';

  // Depth palette shared with every graph in the talk (level_colours)
  var LEVEL = ['#B3B3B3', '#084887', '#8093F1', '#FBB13C', '#B388EB'];
  var PASS = '#1A1A1A', FAIL = '#5E5E5E';
  var BAND = 100;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    if (text != null) e.textContent = text;
    return e;
  }

  function svgEl(tag, parent, cls) {
    var e = document.createElementNS(SVGNS, tag);
    if (cls) e.setAttribute('class', cls);
    parent.appendChild(e);
    return e;
  }

  function css(e, styles) {
    for (var k in styles) e.style[k] = styles[k];
    return e;
  }

  function px(x) { return x.toFixed(1) + 'px'; }
  function ms(x) { return Math.round(x) + 'ms'; }
  function level(d) { return LEVEL[Math.min(d, LEVEL.length - 1)]; }
  function max(xs) { return Math.max.apply(null, xs); }
  function min(xs) { return Math.min.apply(null, xs); }
  function fmt(v) { return v >= 100 ? String(Math.round(v)) : v.toFixed(1); }

  function spark(y, w, h, ymax) {
    return y.map(function (v, i) {
      return (i * w / (y.length - 1)).toFixed(1) + ',' + (h - v / ymax * h).toFixed(1);
    }).join(' ');
  }

  // A line from (x1, y1) to (x2, y2), drawn as a rotated box so it can be animated
  function lineStyle(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    return {
      left: px(x1), top: px(y1), width: px(len),
      transform: 'rotate(' + (len < 1 ? 90 : Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)'
    };
  }

  function tick(parent, pass) {
    var s = svgEl('svg', parent, 'gw-icon');
    svgEl('path', s).setAttribute('d', pass ? 'M1.5 5.4 L4 7.8 L8.6 2.4' : 'M2 2 L8 8 M8 2 L2 8');
    return s;
  }

  // The structure and pruning rule along the top; returns the span of each key variable
  function buildBand(stage, spec) {
    var band = el('div', 'gw-band', stage);
    var formula = el('div', 'gw-formula', band);
    var terms = {};
    spec.structure.split(/([A-Za-z_.][A-Za-z0-9_.]*)/).forEach(function (txt) {
      if (!txt) return;
      var span = el('span', null, formula, txt);
      if (spec.keys.indexOf(txt) > -1) {
        span.className = 'gw-term';
        terms[txt] = span;
      }
    });
    if (spec.rule) el('div', 'gw-rule', band, spec.rule);
    return terms;
  }

  // ---- Stepped walk ---------------------------------------------------------

  function Walk(root) {
    this.root = root;
    this.spec = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    this.section = root.closest('section');
  }

  Walk.prototype.build = function () {
    var self = this, spec = this.spec;
    var W = this.root.offsetWidth || 1440, H = this.root.offsetHeight || 800;
    this.SP = Math.round(W * 0.39);
    this.GW = W - this.SP;
    this.PH = H - BAND;
    this.IW = this.SP - 56;
    this.prune = !!spec.rule;
    this.byId = {};
    spec.nodes.forEach(function (n) { self.byId[n.id] = n; });

    var stage = el('div', 'gw-stage', this.root);
    this.terms = buildBand(stage, spec);

    // Series panel: the node being expanded, with its children as small multiples
    var sp = css(el('div', 'gw-series', stage), { top: BAND + 'px', width: this.SP + 'px', height: this.PH + 'px' });
    var head = el('div', 'gw-head', sp);
    this.headSwatch = el('span', 'gw-swatch', head);
    this.headLabel = el('span', 'gw-head-label', head);
    this.headSub = el('span', 'gw-head-sub', head);
    this.parSvg = svgEl('svg', sp, 'gw-spark-box');
    this.parSvg.setAttribute('width', this.IW);
    this.parSvg.setAttribute('height', 90);
    this.parLine = svgEl('polyline', this.parSvg, 'gw-spark');
    this.cellBox = el('div', 'gw-cells', sp);
    this.cells = [];
    var most = max(spec.splits.map(function (s) { return s.kids.length; }));
    for (var i = 0; i < most; i++) {
      var c = el('div', 'gw-cell', this.cellBox);
      var ch = el('div', 'gw-cell-head', c);
      var cell = { box: c, swatch: el('span', 'gw-swatch', ch), label: el('span', 'gw-cell-label', ch), value: el('span', 'gw-cell-value', ch) };
      cell.svg = svgEl('svg', c, 'gw-spark-box');
      cell.thr = svgEl('line', cell.svg, 'gw-thr');
      cell.line = svgEl('polyline', cell.svg, 'gw-spark');
      this.cells.push(cell);
    }
    this.banner = el('div', 'gw-banner', sp);

    // Graph panel, back to front: group outlines, edges, cuts, nodes, then the strip
    var gp = css(el('div', 'gw-graph', stage), { left: this.SP + 'px', top: BAND + 'px', width: this.GW + 'px', height: this.PH + 'px' });
    this.hulls = spec.splits.map(function (s) {
      var h = el('div', 'gw-hull', gp);
      var chip = el('div', 'gw-chip', h);
      var segs = el('span', 'gw-segs', null);
      var out = { box: h, txt: el('span', null, chip), segs: segs, verdict: null };
      chip.appendChild(segs);
      s.kids.forEach(function (id) { el('span', 'gw-seg' + (self.byId[id].pass ? '' : ' gw-fail'), segs); });
      out.verdict = el('span', 'gw-verdict', chip);
      return out;
    });
    this.edges = {};
    spec.nodes.forEach(function (n) {
      if (n.parent == null) return;
      var e = el('div', 'gw-edge', gp);
      self.edges[n.id] = { box: e, line: el('div', 'gw-line', e) };
    });
    this.cuts = spec.splits.map(function () { return el('div', 'gw-cut', gp); });
    this.nodeEls = {};
    spec.nodes.forEach(function (n) {
      var box = el('div', 'gw-node', gp);
      var ring = el('div', 'gw-ring', box);
      var node = { box: box, halo: el('div', 'gw-halo', ring), dot: el('div', 'gw-dot', ring) };
      node.label = el('div', 'gw-label' + (n.depth >= 3 ? ' gw-small' : ''), box, n.label);
      if (self.prune) {
        node.badge = el('div', 'gw-badge' + (n.pass ? '' : ' gw-fail'), box);
        tick(node.badge, n.pass);
        n.features.forEach(function (f, i) {
          if (i) el('span', 'gw-sep', node.badge, '·');
          el('span', f.pass ? null : 'gw-bad', node.badge, f.text);
        });
      }
      node.tag = el('div', 'gw-tag', box);
      self.nodeEls[n.id] = node;
    });
    if (this.prune) {
      var strip = el('div', 'gw-strip', gp);
      var left = el('div', 'gw-strip-left', strip);
      el('div', 'gw-caps', left, 'Frontier');
      this.chips = el('div', 'gw-chips', left);
      var right = el('div', 'gw-tally', strip);
      el('div', 'gw-caps', right, 'Series kept / tested');
      this.count = el('div', 'gw-count', right);
    }
    this.built = true;
  };

  Walk.prototype.render = function (step) {
    if (!this.built) this.build();
    var self = this, spec = this.spec, byId = this.byId, prune = this.prune;
    var GW = this.GW, ML = 56, MR = 56;
    var rowY = function (d) { return 64 + d * 112; };
    var splits = spec.splits.map(function (s, j) {
      var kids = s.kids.map(function (id) { return byId[id]; });
      var pass = kids.filter(function (k) { return k.pass; }).length;
      return { j: j, parent: s.parent, term: s.term, kids: kids, n: kids.length, pass: pass, kept: s.kept };
    });

    // Fragments: the root, then each split (tested, then resolved, when pruning)
    var frags = [{ k: -1, phase: 'root' }];
    splits.forEach(function (s, j) {
      if (prune) frags.push({ k: j, phase: 'vote' }, { k: j, phase: 'resolve' });
      else frags.push({ k: j, phase: 'grow' });
    });
    step = Math.min(step, frags.length - 1);
    var F = frags[step];
    var status = splits.map(function (s, j) {
      if (!prune) return j <= F.k ? 'shown' : 'hidden';
      if (j < F.k) return s.kept ? 'kept' : 'pruned';
      if (j === F.k) return F.phase === 'vote' ? 'vote' : (s.kept ? 'keptNow' : 'prunedNow');
      return 'hidden';
    });
    var splitOf = {};
    splits.forEach(function (s) { s.kids.forEach(function (k) { splitOf[k.id] = s.j; }); });
    spec.nodes.forEach(function (n) {
      if (n.parent == null) { n.st = 'on'; n.tested = prune; return; }
      var s = splitOf[n.id] === undefined ? 'hidden' : status[splitOf[n.id]];
      // A split pruned on this fragment is cut: its nodes stay put while they drop away
      n.st = s === 'hidden' ? 'hidden' : s === 'prunedNow' ? 'cut' : s === 'pruned' ? 'collapsed' : 'on';
      n.tested = prune && s !== 'hidden';
    });

    // Layered layout; each group centres under its parent, then groups push apart
    var root = spec.nodes[0];
    var pos = {};
    pos[root.id] = { x: GW / 2, y: rowY(0) };
    var depths = max(spec.nodes.map(function (n) { return n.depth; }));
    for (var d = 1; d <= depths; d++) {
      var groups = [];
      splits.forEach(function (s) {
        var placed = s.kids.filter(function (k) { return k.depth === d && (k.st === 'on' || k.st === 'cut'); });
        if (placed.length) groups.push({ s: s, placed: placed, cx: pos[s.parent].x });
      });
      if (!groups.length) continue;
      groups.sort(function (a, b) { return a.cx - b.cx || a.s.j - b.s.j; });
      // Room for each label, so long names don't collide
      var nw = function (k) { return Math.max(84, k.label.length * (k.depth >= 3 ? 7 : 8.2) + 18); };
      var gap = 16, gaps = gap * (groups.length - 1);
      var raw = groups.reduce(function (t, g) { return t + g.placed.reduce(function (u, k) { return u + nw(k); }, 0); }, 0);
      var sc = Math.min(1, (GW - ML - MR - gaps) / raw);
      var end = ML - gap;
      groups.forEach(function (g) {
        g.w = g.placed.reduce(function (u, k) { return u + nw(k) * sc; }, 0);
        g.start = Math.max(g.cx - g.w / 2, end + gap);
        end = g.start + g.w;
      });
      var over = Math.max(0, end - (GW - MR));
      groups.forEach(function (g) {
        var x = g.start - over;
        g.placed.forEach(function (k) { var w = nw(k) * sc; pos[k.id] = { x: x + w / 2, y: rowY(d) }; x += w; });
      });
    }
    var P = function (n) { return pos[n.id] || P(byId[n.parent]); };

    var focus = F.k >= 0 ? splits[F.k] : null;
    var expanding = focus ? focus.parent : root.id;
    var prunedOf = function (id) {
      return splits.filter(function (s, j) { return s.parent === id && (status[j] === 'pruned' || status[j] === 'prunedNow'); });
    };
    var liveOf = function (id) {
      return splits.filter(function (s, j) { return s.parent === id && ['vote', 'keptNow', 'kept', 'shown'].indexOf(status[j]) > -1; });
    };

    // Band: underline the variable being split, in the colour of its new depth
    Object.keys(this.terms).forEach(function (t) {
      var on = focus && focus.term === t;
      self.terms[t].classList.toggle('gw-active', !!on);
      self.terms[t].style.textDecorationColor = on ? level(focus.kids[0].depth) : 'transparent';
    });

    // Nodes
    spec.nodes.forEach(function (n) {
      var e = self.nodeEls[n.id], p = P(n), on = n.st === 'on';
      css(e.box, { left: px(p.x - 60), top: px(p.y - 13) });
      if (n.st === 'cut') css(e.box, { opacity: 0, transform: 'translateY(16px) scale(.5)', transitionDelay: '450ms' });
      else css(e.box, { opacity: on ? 1 : 0, transform: 'scale(' + (on ? 1 : 0.2) + ')', transitionDelay: '0ms' });
      var col = level(n.depth);
      if (n.tested && n.pass) css(e.dot, { background: col, border: '3px solid ' + PASS });
      else if (n.tested) css(e.dot, { background: col + '66', border: '3px dashed ' + FAIL });
      else css(e.dot, { background: col, border: '2px solid #ffffff' });
      var pr = on && prune ? prunedOf(n.id) : [];
      var leaf = pr.length > 0 && liveOf(n.id).length === 0;
      e.dot.style.boxShadow = leaf ? '0 0 0 3px #E5E5E5, 0 0 0 5px ' + PASS : 'none';
      e.halo.style.display = n.id === expanding ? 'block' : 'none';
      e.label.classList.toggle('gw-faded', !!(n.tested && !n.pass));
      if (e.badge) e.badge.style.display = on && (n.parent == null ? F.phase === 'root' : splitOf[n.id] === F.k) ? 'flex' : 'none';
      e.tag.textContent = pr.length ? 'no ' + pr.map(function (s) { return s.term; }).join(', ') + ' split' : '';
      e.tag.style.display = pr.length ? 'block' : 'none';
    });

    // Edges; cut edges retract toward the child, detaching it from the parent
    spec.nodes.forEach(function (n) {
      if (n.parent == null) return;
      var e = self.edges[n.id], a = P(byId[n.parent]), b = P(n), cut = n.st === 'cut';
      css(e.box, lineStyle(a.x, a.y, b.x, b.y));
      e.box.style.opacity = n.st === 'on' || cut ? 1 : 0;
      css(e.line, { transform: 'scaleX(' + (n.st === 'on' ? 1 : 0) + ')', transitionDelay: cut ? '150ms' : '0ms' });
    });

    // Group outlines and the snip across a group's edges when it is pruned
    splits.forEach(function (s, j) {
      var h = self.hulls[j], sj = status[j], pp = P(byId[s.parent]);
      var show = prune && (sj === 'vote' || sj === 'keptNow' || sj === 'prunedNow');
      var box = { l: pp.x - 22, t: pp.y - 22, w: 44, h: 44 };
      if (sj !== 'hidden' && sj !== 'pruned') {
        var xs = s.kids.map(function (k) { return P(k).x; }), y = rowY(s.kids[0].depth);
        var l = Math.max(6, min(xs) - 46), r = Math.min(GW - 6, max(xs) + 46);
        box = { l: l, t: y - 30, w: r - l, h: 100 };
      }
      css(h.box, { left: px(box.l), top: px(box.t), width: px(box.w), height: box.h + 'px', opacity: show ? 1 : 0 });
      h.box.className = 'gw-hull gw-' + sj;
      h.txt.textContent = s.term + ': ' + s.pass + ' / ' + s.n + ' pass';
      h.verdict.textContent = sj === 'vote' ? 'needs > 50%' : sj === 'keptNow' ? 'kept' : 'pruned';

      // Low enough to clear the parent's label and tag
      var now = sj === 'prunedNow', f = 0.55, cy = pp.y + (rowY(s.kids[0].depth) - pp.y) * f;
      var cx = s.kids.map(function (k) { return pp.x + (P(k).x - pp.x) * f; });
      var cl = min(cx) - 14;
      css(self.cuts[j], {
        left: px(cl), top: px(cy), width: px(Math.max(30, max(cx) + 14 - cl)),
        opacity: now ? 1 : 0, transform: 'rotate(-12deg) scaleX(' + (now ? 1 : 0) + ')'
      });
    });

    this.renderSeries(focus, focus ? status[F.k] : null, root);
    if (prune) this.renderStrip(frags, step, splits, status, root);
  };

  Walk.prototype.renderSeries = function (focus, sj, root) {
    var self = this, spec = this.spec, prune = this.prune, IW = this.IW;
    var par = focus ? this.byId[focus.parent] : root;
    var kids = focus ? focus.kids : [];
    this.headSwatch.style.background = level(par.depth);
    this.headLabel.textContent = par.label;
    this.headSub.textContent = focus ? 'by ' + focus.term : '';
    this.parLine.setAttribute('points', spark(par.series, IW, 90, max(par.series) * 1.08 || 1));

    var cols = kids.length === 4 ? 2 : 3;
    var rows = Math.max(1, Math.ceil(kids.length / cols));
    var cw = (IW - (cols - 1) * 12) / cols;
    var chh = Math.min(140, (this.PH - 300 - (rows - 1) * 12) / rows);
    var sh = chh - 30;
    this.cellBox.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    var thr = spec.threshold;
    this.cells.forEach(function (c, i) {
      var k = kids[i];
      c.box.style.display = k ? 'flex' : 'none';
      if (!k) return;
      var ymax = Math.max(max(k.series), prune && thr != null ? thr * 1.2 : 0.5) * 1.08;
      c.swatch.style.background = level(k.depth);
      c.label.textContent = k.label;
      c.value.textContent = prune ? k.features.map(function (f) { return f.text; }).join(' · ') : fmt(k.mean);
      c.box.style.opacity = prune ? (sj === 'prunedNow' ? 0.3 : k.pass ? 1 : 0.45) : 1;
      c.svg.setAttribute('width', cw.toFixed(0));
      c.svg.setAttribute('height', sh.toFixed(0));
      var ty = thr != null ? (sh - thr / ymax * sh).toFixed(1) : -10;
      c.thr.setAttribute('x1', 0);
      c.thr.setAttribute('x2', cw.toFixed(0));
      c.thr.setAttribute('y1', ty);
      c.thr.setAttribute('y2', ty);
      c.thr.style.display = prune && thr != null ? '' : 'none';
      c.line.setAttribute('points', spark(k.series, cw, sh, ymax));
      c.line.classList.toggle('gw-fail', prune && !k.pass);
    });

    var txt = '';
    if (!focus) txt = prune ? 'Total passes the predicate, so it can be disaggregated.' : 'The top series: ' + spec.value + ' in total.';
    else if (sj === 'vote') txt = focus.pass + ' of ' + focus.n + ' pass the predicate.' + (thr != null ? ' Dashed lines mark the threshold of ' + thr + '.' : '') + ' Faded series fail.';
    else if (sj === 'keptNow') txt = focus.pass + '/' + focus.n + ' pass, more than half, so the ' + focus.term + ' split is kept' + (focus.pass < focus.n ? ', failing series included.' : '.');
    else if (sj === 'prunedNow') txt = (focus.pass * 2 === focus.n ? 'Exactly half pass, but .keep needs more than half' : 'Only ' + focus.pass + '/' + focus.n + ' pass') + ', so the ' + focus.term + ' split is pruned. ' + par.label + ' is still forecast, just not split by ' + focus.term + '.';
    else txt = focus.n + ' series, one per ' + focus.term + '.';
    this.banner.textContent = txt;
  };

  // Frontier of (node, variable) pairs waiting to be expanded, and the running tally
  Walk.prototype.renderStrip = function (frags, step, splits, status, root) {
    var byId = this.byId;
    var queue = root.dims.map(function (v) { return root.label + ' · ' + v; });
    var current = null;
    for (var i = 1; i <= step; i++) {
      var s = splits[frags[i].k];
      if (frags[i].phase === 'vote') {
        current = byId[s.parent].label + ' · ' + s.term;
        queue = queue.filter(function (q) { return q !== current; });
      } else {
        current = null;
        if (s.kept) s.kids.forEach(function (k) {
          if (k.pass) k.dims.forEach(function (v) { queue.push(k.label + ' · ' + v); });
        });
      }
    }
    this.chips.textContent = '';
    if (current) el('span', 'gw-chip-item gw-current', this.chips, current);
    var room = current ? 3 : 4;
    var chips = this.chips;
    queue.slice(0, room).forEach(function (q) { el('span', 'gw-chip-item', chips, q); });
    if (queue.length > room) el('span', 'gw-chip-item gw-more', chips, '+' + (queue.length - room) + ' more');

    var tested = 1, kept = 1;
    splits.forEach(function (s, j) {
      if (status[j] !== 'hidden') tested += s.n;
      if (status[j] === 'kept' || status[j] === 'keptNow') kept += s.n;
    });
    this.count.textContent = kept + ' / ' + tested;
  };

  // ---- Recap ----------------------------------------------------------------

  function Recap(root) {
    this.root = root;
    this.spec = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    this.section = root.closest('section');
  }

  Recap.prototype.stop = function () {
    if (this.stage) this.stage.remove();
    this.stage = null;
  };

  Recap.prototype.play = function () {
    this.stop();
    var spec = this.spec;
    var W = this.root.offsetWidth || 1440, H = this.root.offsetHeight || 800, PH = H - BAND;
    var stage = this.stage = el('div', 'gw-stage', this.root);
    var terms = buildBand(stage, spec);
    var area = css(el('div', 'gw-area', stage), { top: BAND + 'px', width: W + 'px', height: PH + 'px' });
    var legend = el('div', 'gw-legend', area);
    legend.innerHTML = '<span><i class="gw-key gw-key-pass"></i>pass <i class="gw-key gw-key-fail"></i>fail</span>' +
      '<span><i class="gw-bar-key"></i>split kept <i class="gw-bar-key gw-bar-pruned"></i>split pruned</span>';

    var t0 = 400, end = 0, summary = [];
    var cardW = 340, s = (cardW - 24) / (W - 96);
    var cardH = Math.round(36 + (PH - 40) * s);
    spec.paths.forEach(function (path, pi) {
      var vars = path.vars, D = vars.length;
      var rows = [];
      for (var d = 0; d <= D; d++) rows.push(64 + d * (PH - 160) / D);
      var rc = layoutTree(path.nodes, rows, D, W);
      var sched = schedule(rc, t0, D);
      if (pi > 0) rc[0].t = t0 - 900;
      var layer = el('div', 'gw-layer', area);
      drawTree(layer, rc, sched.groups, D);
      // Underline the variable being split while its group is visited
      sched.groups.forEach(function (g) {
        var term = terms[vars[g.kids[0].depth - 1]];
        if (term) css(el('span', 'gw-ul', term), { animation: 'gw-fade .12s linear ' + ms(g.start) + ' both, gw-out .12s linear ' + ms(g.end) + ' forwards' });
      });
      var kept = sched.groups.filter(function (g) { return g.kept; }).length;
      var label = vars[0] + ' first · ' + kept + ' of ' + sched.groups.length + ' splits kept';
      summary.push(label);
      end = sched.end;
      if (pi === spec.paths.length - 1) return;

      // Shrink the resolved walk into a card, then walk the next path from the top
      var shrinkAt = sched.end + 600;
      var card = { x: 16, y: 16 + pi * (cardH + 12) };
      var c = css(el('div', 'gw-card', area), { left: card.x + 'px', top: card.y + 'px', width: cardW + 'px', height: cardH + 'px', animation: 'gw-fade .25s ease ' + ms(shrinkAt + 500) + ' both' });
      el('span', null, c, label);
      css(el('div', 'gw-connector', area), Object.assign(lineStyle(W / 2, rows[0], card.x + cardW, card.y + cardH / 2), { animation: 'gw-fade .25s ease ' + ms(shrinkAt + 700) + ' both' }));
      layer.style.transition = 'transform .9s cubic-bezier(.4,0,.2,1) ' + ms(shrinkAt);
      void layer.offsetWidth;
      layer.style.transform = 'translate(' + px(card.x + 12 - 48 * s) + ', ' + px(card.y + 28 - 40 * s) + ') scale(' + s.toFixed(4) + ')';
      t0 = shrinkAt + 1100;
    });
    css(el('div', 'gw-summary', area, summary.join('  ·  ')), { animation: 'gw-fade .25s ease ' + ms(end) + ' both' });
  };

  // Tidy tree: each node is centred over the span of its subtree's leaves
  function layoutTree(raw, rows, D, W) {
    var rc = raw.map(function (r) { return { parent: r[0], depth: r[1], pass: !!r[2], label: r[3], kids: [] }; });
    rc.forEach(function (n) { if (n.parent >= 0) rc[n.parent].kids.push(n); });
    var span = function (n) {
      n.wd = n.kids.length ? n.kids.reduce(function (t, k) { return t + span(k); }, 0) : (n.depth === D ? 9 : 26);
      return n.wd;
    };
    span(rc[0]);
    var sc = (W - 96) / rc[0].wd;
    var place = function (n, x0) {
      n.x = x0 + n.wd * sc / 2;
      n.y = rows[n.depth];
      var x = x0;
      n.kids.forEach(function (k) { place(k, x); x += k.wd * sc; });
    };
    place(rc[0], 48);
    return rc;
  }

  // Visit groups in order: children pop in one at a time, then the group vote resolves
  function schedule(rc, t0, D) {
    var t = t0, groups = [];
    rc[0].t = 0;
    for (var i = 1; i < rc.length;) {
      var p = rc[i].parent, g = { p: rc[p], kids: [], start: t };
      while (i < rc.length && rc[i].parent === p) {
        rc[i].t = t;
        t += rc[i].depth === D ? 22 : 70;
        g.kids.push(rc[i]);
        i++;
      }
      g.kept = g.kids.filter(function (k) { return k.pass; }).length / g.kids.length > 0.5;
      g.verdict = t + 80;
      // A pruned group is cut: snip at the verdict, edges retract, then the nodes drop away
      g.cut = g.kept ? null : g.verdict + 120;
      g.gone = g.kept ? null : g.verdict + 380;
      g.kids.forEach(function (k) { k.cut = g.cut; k.gone = g.gone; });
      t = g.verdict + (g.kept ? 160 : 300);
      g.end = t;
      groups.push(g);
    }
    return { groups: groups, end: t };
  }

  function drawTree(layer, rc, groups, D) {
    var fade = function (t, gone) {
      return 'gw-fade .25s ease ' + ms(t) + ' both' + (gone ? ', gw-out .45s ease ' + ms(gone) + ' forwards' : '');
    };
    rc.slice(1).forEach(function (n) {
      var a = rc[n.parent];
      var e = css(el('div', 'gw-edge', layer), lineStyle(a.x, a.y, n.x, n.y));
      css(el('div', 'gw-line' + (n.depth === D ? ' gw-thin' : ''), e), {
        animation: 'gw-fade .25s ease ' + ms(n.t) + ' both' + (n.cut ? ', gw-retract .3s ease-in ' + ms(n.cut) + ' forwards' : '')
      });
    });
    groups.forEach(function (g) {
      var xs = g.kids.map(function (k) { return k.x; }), d = g.kids[0].depth;
      var l = min(xs) - 8;
      css(el('div', 'gw-group-bar' + (g.kept ? '' : ' gw-bar-pruned'), layer), {
        left: px(l), width: px(max(xs) + 8 - l), top: px(g.kids[0].y + (d === 1 ? 36 : d === D ? 9 : 14)),
        animation: fade(g.verdict, g.gone)
      });
      if (!g.kept) {
        var f = 0.35, y = g.p.y + (g.kids[0].y - g.p.y) * f;
        var cx = g.kids.map(function (k) { return g.p.x + (k.x - g.p.x) * f; });
        var cl = min(cx) - 12;
        css(el('div', 'gw-snip', layer), {
          left: px(cl), top: px(y), width: px(Math.max(28, max(cx) + 12 - cl)),
          animation: 'gw-snip .16s ease-out ' + ms(g.verdict) + ' both, gw-out .3s ease ' + ms(g.gone + 200) + ' forwards'
        });
      }
      css(el('div', 'gw-flash', layer), { left: px(g.p.x - 20), top: px(g.p.y - 20), animation: 'gw-flash .7s ease-out ' + ms(g.start) + ' both' });
    });
    rc.forEach(function (n) {
      var size = n.depth === 0 ? 26 : n.depth === 1 ? 20 : n.depth === D ? 6 : 15;
      var e = css(el('div', 'gw-rnode', layer), {
        left: px(n.x - size / 2), top: px(n.y - size / 2), width: size + 'px', height: size + 'px',
        animation: 'gw-pop .28s cubic-bezier(.2,.8,.3,1.25) ' + ms(n.t) + ' both' + (n.gone ? ', gw-drop .45s ease-in ' + ms(n.gone) + ' forwards' : '')
      });
      var thin = n.depth === D ? '1.5px ' : '2.5px ';
      css(el('div', 'gw-rdot', e), {
        background: level(n.depth) + (n.pass ? '' : '66'),
        border: thin + (n.pass ? 'solid ' + PASS : 'dashed ' + FAIL)
      });
      if (n.depth === 1) tick(el('span', 'gw-mark' + (n.pass ? '' : ' gw-fail'), e), n.pass);
      if (n.label) css(el('span', 'gw-rlabel', e, n.label), { top: (size + 4) + 'px' });
    });
  }

  // ---- Reveal integration ---------------------------------------------------

  function init() {
    var walks = [].map.call(document.querySelectorAll('.graph-walk'), function (r) { return new Walk(r); });
    var recaps = [].map.call(document.querySelectorAll('.graph-recap'), function (r) { return new Recap(r); });
    var update = function () {
      var current = Reveal.getCurrentSlide();
      walks.forEach(function (w) {
        if (w.section === current) w.render(current.querySelectorAll('.graph-walk-step.visible').length);
      });
    };
    Reveal.on('fragmentshown', update);
    Reveal.on('fragmenthidden', update);
    var changed = function () {
      update();
      recaps.forEach(function (r) {
        if (r.section === Reveal.getCurrentSlide()) r.play(); else r.stop();
      });
    };
    Reveal.on('slidechanged', changed);
    changed();
  }

  window.addEventListener('load', function () {
    if (!window.Reveal) return;
    if (Reveal.isReady()) init(); else Reveal.on('ready', init);
  });
})();
