(() => {
  // src/apps/web/camera.ts
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  var ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  class Camera {
    world;
    x = 0;
    y = 0;
    s = 0.3;
    width = 800;
    height = 600;
    insetRight = 0;
    insetBottom = 0;
    insetTop = 56;
    minS = 0.05;
    maxS = 3.2;
    onChange = () => {};
    anim = null;
    constructor(world) {
      this.world = world;
    }
    get animating() {
      return this.anim !== null;
    }
    cx() {
      return (this.width - this.insetRight) / 2;
    }
    cy() {
      return (this.insetTop + this.height - this.insetBottom) / 2;
    }
    toScreen(wx, wy) {
      return [(wx - this.x) * this.s + this.cx(), (wy - this.y) * this.s + this.cy()];
    }
    toWorld(sx, sy) {
      return [(sx - this.cx()) / this.s + this.x, (sy - this.cy()) / this.s + this.y];
    }
    fitScale() {
      const availW = this.width - this.insetRight;
      const availH = this.height - this.insetTop - this.insetBottom;
      return Math.min(availW / this.world.width, availH / this.world.height) * 0.96;
    }
    setInsets(right, bottom) {
      const oldCx = this.cx();
      const oldCy = this.cy();
      this.insetRight = right;
      this.insetBottom = bottom;
      this.x += (this.cx() - oldCx) / this.s;
      this.y += (this.cy() - oldCy) / this.s;
      if (this.anim) {
        this.anim.from.x += (this.cx() - oldCx) / this.s;
        this.anim.from.y += (this.cy() - oldCy) / this.s;
      }
      this.minS = this.fitScale() * 0.85;
      this.onChange();
    }
    zoomToward(sx, sy, factor, ms = 300) {
      const [wx, wy] = this.toWorld(sx, sy);
      const s = clamp(this.s * factor, this.minS, this.maxS);
      this.flyTo({ x: wx - (sx - this.cx()) / s, y: wy - (sy - this.cy()) / s, s }, ms);
    }
    homeView() {
      const fit = this.fitScale();
      const portrait = this.width < this.height;
      const s = portrait ? Math.max(fit, this.height * 0.7 / this.world.height) : fit;
      return { x: this.world.width / 2, y: this.world.height / 2, s };
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      this.minS = this.fitScale() * 0.85;
      this.clamp();
      this.onChange();
    }
    clamp() {
      this.s = clamp(this.s, this.minS, this.maxS);
      const mx = this.world.width * 0.1;
      const my = this.world.height * 0.1;
      this.x = clamp(this.x, -mx, this.world.width + mx);
      this.y = clamp(this.y, -my, this.world.height + my);
    }
    panBy(dxScreen, dyScreen) {
      this.anim = null;
      this.x -= dxScreen / this.s;
      this.y -= dyScreen / this.s;
      this.clamp();
      this.onChange();
    }
    zoomAt(sx, sy, factor) {
      this.anim = null;
      const [wx, wy] = this.toWorld(sx, sy);
      this.s = clamp(this.s * factor, this.minS, this.maxS);
      this.x = wx - (sx - this.cx()) / this.s;
      this.y = wy - (sy - this.cy()) / this.s;
      this.clamp();
      this.onChange();
    }
    zoomCentre(factor) {
      this.flyTo({ x: this.x, y: this.y, s: clamp(this.s * factor, this.minS, this.maxS) }, 260);
    }
    flyTo(view, ms = 900) {
      const to = { x: view.x, y: view.y, s: clamp(view.s, this.minS, this.maxS) };
      if (ms <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.anim = null;
        Object.assign(this, to);
        this.clamp();
        this.onChange();
        return;
      }
      this.anim = { from: { x: this.x, y: this.y, s: this.s }, to, start: performance.now(), ms };
      this.onChange();
    }
    fitBounds(b, padding = 60, ms = 900, maxS = this.maxS) {
      const availW = this.width - this.insetRight - padding * 2;
      const availH = this.height - this.insetTop - this.insetBottom - padding * 2;
      const s = Math.min(availW / (b.maxX - b.minX), availH / (b.maxY - b.minY), maxS);
      this.flyTo({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, s }, ms);
    }
    tick(now) {
      if (!this.anim)
        return;
      const { from, to, start, ms } = this.anim;
      const t = clamp((now - start) / ms, 0, 1);
      const e = ease(t);
      const dist = Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.s, to.s);
      const dip = Math.min(0.9, 0.55 * dist / Math.min(this.width, this.height)) * Math.sin(Math.PI * t);
      this.x = from.x + (to.x - from.x) * e;
      this.y = from.y + (to.y - from.y) * e;
      this.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e - dip);
      if (t >= 1) {
        this.anim = null;
        Object.assign(this, to);
      }
      this.clamp();
    }
  }

  // src/apps/web/input.ts
  function attachInput(canvas, camera, handlers) {
    const pointers = new Map;
    let moved = 0;
    let downAt = 0;
    let pinchDist = 0;
    let lastTap = 0;
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        moved = 0;
        downAt = performance.now();
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        handlers.onHover(p.x, p.y);
        return;
      }
      if (pointers.size === 1) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6) {
          canvas.classList.add("is-dragging");
          camera.panBy(dx, dy);
        }
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, p);
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0)
          camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist);
        pinchDist = dist;
        moved = 99;
      }
      pointers.set(e.pointerId, p);
    });
    const end = (e) => {
      const p = local(e);
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      canvas.classList.remove("is-dragging");
      if (pointers.size < 2)
        pinchDist = 0;
      if (wasSingle && moved <= 6 && performance.now() - downAt < 500 && e.type === "pointerup") {
        const now = performance.now();
        if (now - lastTap < 320) {
          lastTap = 0;
          handlers.onDoubleTap(p.x, p.y);
        } else {
          lastTap = now;
          handlers.onTap(p.x, p.y);
        }
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => handlers.onHover(-1, null));
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : 1;
      camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0016)));
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName))
        return;
      const step = 80;
      if (e.key === "ArrowLeft")
        camera.panBy(step, 0);
      else if (e.key === "ArrowRight")
        camera.panBy(-step, 0);
      else if (e.key === "ArrowUp")
        camera.panBy(0, step);
      else if (e.key === "ArrowDown")
        camera.panBy(0, -step);
      else if (e.key === "+" || e.key === "=")
        camera.zoomCentre(1.5);
      else if (e.key === "-")
        camera.zoomCentre(1 / 1.5);
    });
  }

  // src/domain/geometry.ts
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1;i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }
  function polygonBounds(poly) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  // src/apps/web/bridges.ts
  var MIN_LINKS = 2;
  var MAX_BRIDGES = 14;
  var MAX_PER_REALM_PAIR = 2;
  var MAX_GULF_BRIDGES = 4;
  var MAX_SEA_SPAN = 1000;
  var MAX_GULF_SPAN = 520;
  var MIN_SPAN = 40;
  var LAND_OVERLAP = 12;
  function bridgePoint(b, t) {
    const u = 1 - t;
    return {
      x: u * u * b.p0.x + 2 * u * t * b.c.x + t * t * b.p1.x,
      y: u * u * b.p0.y + 2 * u * t * b.c.y + t * t * b.p1.y
    };
  }
  var kindFor = (count) => count >= 6 ? "stone" : count >= 3 ? "rope" : "stones";
  function bow(id) {
    let h = 0;
    for (let i = 0;i < id.length; i++)
      h = h * 31 + id.charCodeAt(i) | 0;
    return (h & 1 ? 1 : -1) * 0.07;
  }
  function findSpan(ra, rb, realms) {
    const A = ra.center;
    const B = rb.center;
    const len = distance(A, B);
    const n = Math.max(2, Math.ceil(len / 6));
    const at = (i) => ({ x: A.x + (B.x - A.x) * i / n, y: A.y + (B.y - A.y) * i / n });
    const realmA = realms.get(ra.realmId);
    const realmB = realms.get(rb.realmId);
    if (ra.realmId !== rb.realmId) {
      let i = 0;
      while (i <= n && pointInPolygon(at(i), realmA.coast))
        i++;
      let j = n;
      while (j >= 0 && pointInPolygon(at(j), realmB.coast))
        j--;
      if (i > j)
        return null;
      for (let k = i;k <= j; k++) {
        for (const other of realms.values()) {
          if (other !== realmA && other !== realmB && pointInPolygon(at(k), other.coast))
            return null;
        }
      }
      return { p0: at(i), p1: at(j), sea: true };
    }
    let i = 0;
    while (i <= n && pointInPolygon(at(i), realmA.coast))
      i++;
    if (i > n)
      return null;
    let k = i;
    while (k <= n && !pointInPolygon(at(k), realmA.coast))
      k++;
    if (k > n)
      return null;
    return { p0: at(i), p1: at(k), sea: false };
  }
  function computeBridges(notes, regions, realms) {
    const groups = new Map;
    for (const note of notes.values()) {
      for (const target of note.links) {
        const other = notes.get(target);
        if (!other || other.regionId === note.regionId)
          continue;
        const [a, b] = [note.regionId, other.regionId].sort();
        const id = `${a}|${b}`;
        const g = groups.get(id) ?? { a, b, links: [] };
        g.links.push({ from: note.id, to: other.id });
        groups.set(id, g);
      }
    }
    const candidates = [];
    for (const [id, g] of groups) {
      if (g.links.length < MIN_LINKS)
        continue;
      const ra = regions.get(g.a);
      const rb = regions.get(g.b);
      if (!ra || !rb)
        continue;
      const span = findSpan(ra, rb, realms);
      if (!span)
        continue;
      const spanLen = distance(span.p0, span.p1);
      if (spanLen < MIN_SPAN || spanLen > (span.sea ? MAX_SEA_SPAN : MAX_GULF_SPAN))
        continue;
      const dx = (span.p1.x - span.p0.x) / spanLen;
      const dy = (span.p1.y - span.p0.y) / spanLen;
      const p0 = { x: span.p0.x - dx * LAND_OVERLAP, y: span.p0.y - dy * LAND_OVERLAP };
      const p1 = { x: span.p1.x + dx * LAND_OVERLAP, y: span.p1.y + dy * LAND_OVERLAP };
      const length = spanLen + LAND_OVERLAP * 2;
      const k = bow(id) * length;
      const c = { x: (p0.x + p1.x) / 2 - dy * k, y: (p0.y + p1.y) / 2 + dx * k };
      candidates.push({
        id,
        a: g.a,
        b: g.b,
        count: g.links.length,
        links: g.links,
        crossRealm: ra.realmId !== rb.realmId,
        p0,
        p1,
        c,
        length,
        kind: kindFor(g.links.length)
      });
    }
    candidates.sort((x, y) => y.count - x.count || x.length - y.length);
    const chosen = [];
    const perPair = new Map;
    let gulfs = 0;
    for (const cand of candidates) {
      if (chosen.length >= MAX_BRIDGES)
        break;
      const mid = bridgePoint(cand, 0.5);
      if (chosen.some((o) => distance(bridgePoint(o, 0.5), mid) < 130))
        continue;
      if (cand.crossRealm) {
        const key = [regions.get(cand.a).realmId, regions.get(cand.b).realmId].sort().join("|");
        if ((perPair.get(key) ?? 0) >= MAX_PER_REALM_PAIR)
          continue;
        perPair.set(key, (perPair.get(key) ?? 0) + 1);
      } else {
        if (gulfs >= MAX_GULF_BRIDGES)
          continue;
        gulfs++;
      }
      chosen.push(cand);
    }
    return chosen;
  }

  // src/apps/web/model.ts
  class AtlasModel {
    atlas;
    notes = new Map;
    regions = new Map;
    realms = new Map;
    roads = new Map;
    frontiers = new Map;
    roadsByNote = new Map;
    regionBridges = new Map;
    lanes = [];
    bridges;
    bridgesById = new Map;
    stems;
    constructor(atlas) {
      this.atlas = atlas;
      for (const n of atlas.notes)
        this.notes.set(n.id, n);
      for (const r of atlas.regions)
        this.regions.set(r.id, r);
      for (const r of atlas.realms)
        this.realms.set(r.id, r);
      for (const r of atlas.roads)
        this.roads.set(r.id, r);
      for (const f of atlas.frontiers)
        this.frontiers.set(f.id, f);
      this.stems = atlas.notes.map((n) => n.id);
      for (const road of atlas.roads) {
        road.steps.forEach((id, step) => {
          const list = this.roadsByNote.get(id) ?? [];
          list.push({ road, step });
          this.roadsByNote.set(id, list);
        });
      }
      const laneCounts = new Map;
      for (const note of atlas.notes) {
        for (const target of note.links) {
          const other = this.notes.get(target);
          if (!other)
            continue;
          if (other.regionId !== note.regionId)
            this.bridge(note.regionId, other.regionId);
          if (other.realmId !== note.realmId) {
            const key = [note.realmId, other.realmId].sort().join("|");
            laneCounts.set(key, (laneCounts.get(key) ?? 0) + 1);
          }
        }
      }
      for (const [key, count] of laneCounts) {
        const [a, b] = key.split("|");
        this.lanes.push({ a, b, count });
      }
      this.bridges = computeBridges(this.notes, this.regions, this.realms);
      for (const b of this.bridges)
        this.bridgesById.set(b.id, b);
    }
    bridge(a, b) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const row = this.regionBridges.get(x) ?? new Map;
        row.set(y, (row.get(y) ?? 0) + 1);
        this.regionBridges.set(x, row);
      }
    }
    resolveTarget(target) {
      const t = target.trim().normalize("NFC");
      if (this.notes.has(t))
        return t;
      const lower = t.toLowerCase();
      const matches = this.stems.filter((s) => s.toLowerCase().startsWith(lower));
      return matches.length === 1 ? matches[0] : null;
    }
    regionBounds(region) {
      return polygonBounds(region.cell);
    }
    realmBounds(realm) {
      return polygonBounds(realm.coast);
    }
    strongestNeighbours(regionId, limit) {
      const row = this.regionBridges.get(regionId);
      if (!row)
        return [];
      return [...row.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, count]) => ({ region: this.regions.get(id), count }));
    }
  }

  // src/apps/web/render/theme.ts
  var theme = {
    table: "#b9a173",
    paperLight: "#f4ead0",
    paper: "#eadcb6",
    paperDark: "#cdb986",
    land: "#f1e6c6",
    ink: "#3f2b1a",
    inkSoft: "#6f5236",
    wax: "#8c2f2b",
    gold: "#c79a35",
    halo: "rgba(244, 234, 208, 0.92)",
    display: '"Cinzel", "Trajan Pro", Georgia, serif',
    body: '"IM Fell English", "Iowan Old Style", Georgia, serif',
    emoji: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
  };
  var clamp01 = (v) => Math.max(0, Math.min(1, v));
  function smooth(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  function lod(s) {
    return {
      realmLabel: 1 - smooth(0.34, 0.62, s),
      seal: smooth(0.2, 0.34, s),
      regionLabel: smooth(0.26, 0.4, s) * (1 - smooth(1.5, 2.2, s)),
      noteLabel: smooth(0.7, 1, s),
      lanes: 1 - smooth(0.45, 0.9, s),
      glyph: 1 - 0.68 * smooth(0.7, 1.4, s)
    };
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function hash01(text) {
    let h = 2166136261;
    for (let i = 0;i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 1e4 / 1e4;
  }

  // src/apps/web/render/bridgeArt.ts
  function sample(b, count) {
    const pts = Array.from({ length: count + 1 }, (_, i) => bridgePoint(b, i / count));
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(count, i + 1)];
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const tx = (c.x - a.x) / len;
      const ty = (c.y - a.y) / len;
      return { x: p.x, y: p.y, tx, ty, nx: -ty, ny: tx };
    });
  }
  function pathThrough(points) {
    const path = new Path2D;
    points.forEach((p, i) => i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y));
    return path;
  }
  function drawBridge(ctx, b, m, emphasis) {
    const steps = Math.max(8, Math.round(b.length / 10));
    const pts = sample(b, steps);
    const path = pathThrough(pts);
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    if (emphasis !== "none") {
      ctx.strokeStyle = theme.gold;
      ctx.globalAlpha = emphasis === "selected" ? 0.55 : 0.35;
      ctx.lineWidth = 30 * m;
      ctx.lineCap = "round";
      ctx.stroke(path);
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }
    if (b.kind === "stone") {
      ctx.save();
      ctx.translate(3 * m, 5 * m);
      ctx.strokeStyle = "rgba(40, 25, 8, 0.24)";
      ctx.lineWidth = 17 * m;
      ctx.stroke(path);
      ctx.restore();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.4;
      for (let i = 2;i < pts.length - 1; i += 3) {
        const p = pts[i];
        const cx = p.x + p.nx * 9 * m;
        const cy = p.y + p.ny * 9 * m;
        const start = Math.atan2(p.ny, p.nx) - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7 * m, start, start + Math.PI);
        ctx.stroke();
      }
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 15 * m;
      ctx.stroke(path);
      ctx.strokeStyle = theme.land;
      ctx.lineWidth = 10.5 * m;
      ctx.stroke(path);
      ctx.strokeStyle = theme.inkSoft;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (let i = 1;i < pts.length - 1; i += 2) {
        const p = pts[i];
        ctx.moveTo(p.x - p.nx * 4.5 * m, p.y - p.ny * 4.5 * m);
        ctx.lineTo(p.x + p.nx * 4.5 * m, p.y + p.ny * 4.5 * m);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.ink;
      for (const p of [pts[0], pts[pts.length - 1]]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5 * m, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b.kind === "rope") {
      ctx.save();
      ctx.translate(2.5 * m, 4.5 * m);
      ctx.strokeStyle = "rgba(40, 25, 8, 0.2)";
      ctx.lineWidth = 9 * m;
      ctx.stroke(path);
      ctx.restore();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 8 * m;
      ctx.stroke(path);
      ctx.strokeStyle = "#d9bf86";
      ctx.lineWidth = 5.5 * m;
      ctx.stroke(path);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 1;i < pts.length - 1; i++) {
        const p = pts[i];
        ctx.moveTo(p.x - p.nx * 5 * m, p.y - p.ny * 5 * m);
        ctx.lineTo(p.x + p.nx * 5 * m, p.y + p.ny * 5 * m);
      }
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = 0.7;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = p.x + side * p.nx * 6.5 * m;
          const y = p.y + side * p.ny * 6.5 * m;
          if (i === 0)
            ctx.moveTo(x, y);
          else
            ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.ink;
      for (let i = 0;i < pts.length; i += 6) {
        const p = pts[i];
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(p.x + side * p.nx * 6.5 * m, p.y + side * p.ny * 6.5 * m, 2.4 * m, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (const p of [pts[0], pts[pts.length - 1]]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5 * m, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.5;
      for (let i = 1;i < pts.length - 1; i += 2) {
        const p = pts[i];
        const wobble = 0.8 + 0.4 * (i * 7919 % 10) / 10;
        ctx.save();
        ctx.translate(p.x + p.nx * (i % 3 - 1) * 2 * m, p.y + p.ny * (i % 3 - 1) * 2 * m);
        ctx.rotate(Math.atan2(p.ty, p.tx));
        ctx.fillStyle = "rgba(40, 25, 8, 0.2)";
        ctx.beginPath();
        ctx.ellipse(2 * m, 3 * m, 6.5 * m * wobble, 4.4 * m, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = theme.land;
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5 * m * wobble, 4.4 * m, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // src/apps/web/render/glyphs.ts
  function drawGlyph(ctx, d) {
    const s = d.size;
    const flip = d.seed > 0.5 ? 1 : -1;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = theme.ink;
    switch (d.kind) {
      case "mountain": {
        const p1 = [-s * 0.25, -s * 0.7];
        const notch = [s * 0.12, -s * 0.05];
        const p2 = [s * 0.45, -s * 0.45];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-s * 0.95, s * 0.5);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(notch[0], notch[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(s * 1, s * 0.5);
        ctx.closePath();
        ctx.fillStyle = theme.land;
        ctx.fill();
        ctx.fillStyle = "rgba(63, 43, 26, 0.2)";
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(notch[0], notch[1]);
        ctx.lineTo(-s * 0.02, s * 0.5);
        ctx.lineTo(-s * 0.3, s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p2[0], p2[1]);
        ctx.lineTo(s * 1, s * 0.5);
        ctx.lineTo(s * 0.4, s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = theme.paperLight;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(-s * 0.43, -s * 0.38);
        ctx.lineTo(-s * 0.35, -s * 0.31);
        ctx.lineTo(-s * 0.29, -s * 0.4);
        ctx.lineTo(-s * 0.21, -s * 0.3);
        ctx.lineTo(-s * 0.14, -s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 0.9;
        ctx.globalAlpha *= 0.65;
        ctx.beginPath();
        for (let i = 1;i <= 5; i++) {
          const t = i / 6;
          ctx.moveTo(p1[0] + s * 0.37 * t * 0.6, p1[1] + s * 0.65 * t + s * 0.1);
          ctx.lineTo(p1[0] + s * 0.37 * t * 0.6 + s * 0.14, p1[1] + s * 0.65 * t + s * 0.42);
        }
        ctx.moveTo(p2[0] + s * 0.08, p2[1] + s * 0.4);
        ctx.lineTo(p2[0] + s * 0.2, p2[1] + s * 0.85);
        ctx.moveTo(p2[0] + s * 0.18, p2[1] + s * 0.3);
        ctx.lineTo(p2[0] + s * 0.32, p2[1] + s * 0.72);
        ctx.stroke();
        ctx.globalAlpha *= 0.9;
        ctx.beginPath();
        ctx.arc(-s * 0.62, s * 0.5, s * 0.22, Math.PI, 0);
        ctx.stroke();
        break;
      }
      case "hill": {
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, s * 0.35, s * 0.85, Math.PI * 1.12, Math.PI * 1.88);
        ctx.lineTo(s * 0.52, s * 0.35);
        ctx.lineTo(-s * 0.52, s * 0.35);
        ctx.closePath();
        ctx.fillStyle = "rgba(154, 128, 72, 0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, s * 0.35, s * 0.85, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
        ctx.globalAlpha *= 0.7;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(flip * s * 0.1, s * 0.55, s * 0.5, Math.PI * 1.15, Math.PI * 1.7);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [tx, ty] of [[-0.3, 0.2], [0.25, 0.1], [0.05, 0.38]]) {
          ctx.moveTo(s * tx, s * ty);
          ctx.lineTo(s * tx - s * 0.07, s * ty - s * 0.16);
          ctx.moveTo(s * tx, s * ty);
          ctx.lineTo(s * tx, s * ty - s * 0.2);
          ctx.moveTo(s * tx, s * ty);
          ctx.lineTo(s * tx + s * 0.07, s * ty - s * 0.16);
        }
        ctx.stroke();
        break;
      }
      case "tree": {
        const green = `rgba(${Math.round(70 + d.seed * 36)}, ${Math.round(104 + d.seed * 34)}, 58, 0.52)`;
        const pine = (x, w, h) => {
          ctx.beginPath();
          ctx.moveTo(x, s * 0.55);
          ctx.lineTo(x, s * 0.25);
          ctx.stroke();
          for (let tier = 0;tier < 3; tier++) {
            const top = -h + tier * h * 0.36;
            const spread = w * (0.5 + tier * 0.3);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x - spread, top + h * 0.5);
            ctx.lineTo(x + spread, top + h * 0.5);
            ctx.closePath();
            ctx.fillStyle = green;
            ctx.fill();
            ctx.stroke();
          }
        };
        ctx.lineWidth = 1.2;
        if (d.seed < 0.4) {
          pine(0, s * 0.42, s * 0.8);
        } else if (d.seed < 0.75) {
          ctx.beginPath();
          ctx.moveTo(0, s * 0.55);
          ctx.quadraticCurveTo(-s * 0.04, s * 0.2, 0, s * 0.05);
          ctx.stroke();
          for (const [cx, cy, cr] of [[-0.28, -0.12, 0.34], [0.28, -0.12, 0.34], [0, -0.4, 0.4], [0, -0.02, 0.36]]) {
            ctx.beginPath();
            ctx.arc(s * cx, s * cy, s * cr, 0, Math.PI * 2);
            ctx.fillStyle = green;
            ctx.fill();
            ctx.stroke();
          }
        } else {
          ctx.save();
          ctx.translate(-s * 0.3, s * 0.1);
          pine(0, s * 0.3, s * 0.62);
          ctx.restore();
          ctx.save();
          ctx.translate(s * 0.3, -s * 0.05);
          pine(0, s * 0.34, s * 0.72);
          ctx.restore();
        }
        break;
      }
      case "wave": {
        ctx.lineWidth = 1.3;
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.quadraticCurveTo(-s * 0.5, -s * 0.55 * flip, 0, 0);
        ctx.quadraticCurveTo(s * 0.5, s * 0.55 * flip, s, 0);
        ctx.stroke();
        ctx.globalAlpha *= 0.7;
        ctx.beginPath();
        ctx.moveTo(-s * 0.55, s * 0.5);
        ctx.quadraticCurveTo(-s * 0.2, s * 0.2 * flip + s * 0.5, s * 0.15, s * 0.5);
        ctx.quadraticCurveTo(s * 0.35, s * 0.5 - s * 0.2 * flip, s * 0.6, s * 0.5);
        ctx.stroke();
        break;
      }
      case "ship": {
        ctx.scale(flip, 1);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.62, -s * 0.02);
        ctx.quadraticCurveTo(-s * 0.5, s * 0.34, -s * 0.26, s * 0.34);
        ctx.lineTo(s * 0.3, s * 0.34);
        ctx.quadraticCurveTo(s * 0.52, s * 0.3, s * 0.66, -s * 0.12);
        ctx.lineTo(s * 0.5, -s * 0.02);
        ctx.closePath();
        ctx.fillStyle = theme.land;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(140, 47, 43, 0.55)";
        ctx.beginPath();
        ctx.moveTo(-s * 0.58, s * 0.08);
        ctx.lineTo(s * 0.55, s * 0.08);
        ctx.lineTo(s * 0.46, s * 0.17);
        ctx.lineTo(-s * 0.5, s * 0.17);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-s * 0.18, 0);
        ctx.lineTo(-s * 0.18, -s * 0.95);
        ctx.moveTo(s * 0.22, 0);
        ctx.lineTo(s * 0.22, -s * 0.75);
        ctx.stroke();
        for (const [mx, top, w, bottom] of [[-0.18, -0.9, 0.5, -0.1], [0.22, -0.7, 0.36, -0.08]]) {
          ctx.beginPath();
          ctx.moveTo(s * mx, s * top);
          ctx.quadraticCurveTo(s * (mx + w), s * (top + (bottom - top) * 0.4), s * (mx + w * 0.78), s * bottom);
          ctx.lineTo(s * mx, s * bottom);
          ctx.closePath();
          ctx.fillStyle = theme.paperLight;
          ctx.fill();
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-s * 0.18, -s * 0.95);
        ctx.lineTo(-s * 0.46, -s * 0.85);
        ctx.lineTo(-s * 0.18, -s * 0.75);
        ctx.fillStyle = theme.wax;
        ctx.fill();
        ctx.lineWidth = 1.1;
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, s * 0.5);
        ctx.quadraticCurveTo(-s * 0.4, s * 0.38, -s * 0.1, s * 0.5);
        ctx.quadraticCurveTo(s * 0.2, s * 0.62, s * 0.5, s * 0.5);
        ctx.stroke();
        break;
      }
      case "serpent": {
        ctx.scale(flip, 1);
        ctx.lineWidth = 3.2;
        ctx.globalAlpha *= 0.8;
        const r = s * 0.2;
        ctx.beginPath();
        for (let k = 0;k < 3; k++) {
          const cx = k * r * 2.2;
          ctx.moveTo(cx - r, 0);
          ctx.arc(cx, 0, r, Math.PI, 0, false);
        }
        ctx.stroke();
        const hx = -r * 1.1;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(hx - r * 0.4, -r * 1.6, hx - r * 1.5, -r * 1.5);
        ctx.stroke();
        ctx.fillStyle = theme.ink;
        ctx.beginPath();
        ctx.arc(hx - r * 1.5, -r * 1.5, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(hx - r * 1.78, -r * 1.5);
        ctx.lineTo(hx - r * 2.3, -r * 1.65);
        ctx.moveTo(hx - r * 1.78, -r * 1.5);
        ctx.lineTo(hx - r * 2.3, -r * 1.35);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
  function drawCompass(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineJoin = "round";
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0;i < 8; i++) {
      const angle = i * Math.PI / 4 - Math.PI / 2;
      const long = i % 2 === 0;
      const len = long ? r : r * 0.62;
      const half = Math.PI / 8;
      const inner = r * 0.16;
      const tip = { x: Math.cos(angle) * len, y: Math.sin(angle) * len };
      const left = { x: Math.cos(angle - half) * inner, y: Math.sin(angle - half) * inner };
      const right = { x: Math.cos(angle + half) * inner, y: Math.sin(angle + half) * inner };
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fillStyle = theme.ink;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fillStyle = theme.paperLight;
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = theme.ink;
    ctx.font = `700 ${r * 0.28}px ${theme.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("N", 0, -r * 1.08);
    ctx.restore();
  }

  // src/domain/rng.ts
  function hashString(text) {
    let h = 2166136261;
    for (let i = 0;i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function createRng(seed) {
    let a = hashString(seed);
    return () => {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // src/apps/web/render/paper.ts
  var PAPER_TILE = 256;
  function makePaperTile() {
    const rng = createRng("paper");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PAPER_TILE;
    const g = canvas.getContext("2d");
    const img = g.createImageData(PAPER_TILE, PAPER_TILE);
    for (let i = 0;i < PAPER_TILE * PAPER_TILE; i++) {
      const v = 110 + rng() * 140;
      img.data[i * 4] = v * 0.85;
      img.data[i * 4 + 1] = v * 0.68;
      img.data[i * 4 + 2] = v * 0.4;
      img.data[i * 4 + 3] = 14 + rng() * 26;
    }
    g.putImageData(img, 0, 0);
    g.lineCap = "round";
    for (let i = 0;i < 70; i++) {
      const x = rng() * PAPER_TILE;
      const y = rng() * PAPER_TILE;
      const a = rng() * Math.PI * 2;
      const len = 6 + rng() * 22;
      g.strokeStyle = `rgba(95, 62, 28, ${0.03 + rng() * 0.05})`;
      g.lineWidth = 0.6 + rng() * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 1) * len * 0.5, y + Math.sin(a + 1) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    for (let i = 0;i < 5; i++) {
      const x = rng() * PAPER_TILE;
      const y = rng() * PAPER_TILE;
      const r = 30 + rng() * 60;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(130, 90, 40, 0.05)");
      grad.addColorStop(1, "rgba(130, 90, 40, 0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return canvas;
  }

  // src/apps/web/render/scene.ts
  var emptyState = () => ({
    selectedNote: null,
    hoverNote: null,
    selectedRegion: null,
    hoverRegion: null,
    selectedRealm: null,
    road: null,
    frontier: null,
    hoverFrontier: null,
    selectedBridge: null,
    hoverBridge: null
  });
  var clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function distanceToSegment(px, py, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : clamp2(((px - a[0]) * dx + (py - a[1]) * dy) / lengthSq, 0, 1);
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function pathOf(points) {
    const p = new Path2D;
    points.forEach((pt, i) => i === 0 ? p.moveTo(pt.x, pt.y) : p.lineTo(pt.x, pt.y));
    p.closePath();
    return p;
  }
  function shorten(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  }

  class Scene {
    canvas;
    model;
    camera;
    state = emptyState();
    touch = false;
    ctx;
    dpr = 1;
    paper;
    coastPaths = new Map;
    cellPaths = new Map;
    isletPaths;
    widths = new Map;
    constructor(canvas, model, camera) {
      this.canvas = canvas;
      this.model = model;
      this.camera = camera;
      this.ctx = canvas.getContext("2d");
      this.paper = this.ctx.createPattern(makePaperTile(), "repeat");
      for (const r of model.atlas.realms)
        this.coastPaths.set(r.id, pathOf(r.coast));
      for (const r of model.atlas.regions)
        this.cellPaths.set(r.id, pathOf(r.cell));
      this.isletPaths = model.atlas.islets.map(pathOf);
    }
    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const { clientWidth: w, clientHeight: h } = this.canvas;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.camera.resize(w, h);
      this.widths.clear();
    }
    dotRadius() {
      return clamp2(1.8 + this.camera.s * 5, 2.3, 6);
    }
    sealRadius() {
      return clamp2(11 + this.camera.s * 9, 13, 21);
    }
    hitTest(sx, sy) {
      const cam = this.camera;
      const L = lod(cam.s);
      for (const f of this.model.atlas.frontiers) {
        const [x, y] = cam.toScreen(f.x, f.y);
        if (Math.hypot(x - sx, y - sy) <= (this.touch ? 28 : 20))
          return { kind: "frontier", id: f.id };
      }
      if (L.seal > 0.4) {
        const r = this.sealRadius() + (this.touch ? 10 : 4);
        for (const region of this.model.atlas.regions) {
          const [x, y] = cam.toScreen(region.center.x, region.center.y);
          if (Math.hypot(x - sx, y - sy) <= r)
            return { kind: "seal", id: region.id };
        }
      }
      let best = null;
      let bestD = this.dotRadius() + (this.touch ? 14 : 6);
      for (const n of this.model.atlas.notes) {
        const [x, y] = cam.toScreen(n.x, n.y);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best)
        return { kind: "note", id: best.id };
      const bridge = this.bridgeAt(sx, sy);
      if (bridge)
        return { kind: "bridge", id: bridge };
      const [wx, wy] = cam.toWorld(sx, sy);
      const p = { x: wx, y: wy };
      if (L.seal > 0.4) {
        for (const region of this.model.atlas.regions) {
          if (pointInPolygon(p, region.cell))
            return { kind: "region", id: region.id };
        }
      }
      for (const realm of this.model.atlas.realms) {
        if (pointInPolygon(p, realm.coast))
          return { kind: "realm", id: realm.id };
      }
      return null;
    }
    bridgeThickness() {
      return clamp2(0.55 / this.camera.s, 1, 2.2);
    }
    bridgeAt(sx, sy) {
      const cam = this.camera;
      let best = null;
      let bestD = (this.touch ? 20 : 12) + this.bridgeThickness() * 3;
      for (const b of this.model.bridges) {
        const [mx, my] = cam.toScreen(...Object.values(bridgePoint(b, 0.5)));
        if (Math.hypot(mx - sx, my - sy) <= (this.touch ? 24 : 15))
          return b.id;
        let prev = null;
        for (let i = 0;i <= 24; i++) {
          const p = bridgePoint(b, i / 24);
          const cur = cam.toScreen(p.x, p.y);
          if (prev) {
            const d = distanceToSegment(sx, sy, prev, cur);
            if (d < bestD) {
              bestD = d;
              best = b.id;
            }
          }
          prev = cur;
        }
      }
      return best;
    }
    draw() {
      const { ctx, camera: cam, model } = this;
      const { atlas } = model;
      const s = cam.s;
      const dpr = this.dpr;
      const L = lod(s);
      const W = atlas.world.width;
      const H = atlas.world.height;
      const [ox, oy] = cam.toScreen(0, 0);
      const [vx0, vy0] = cam.toWorld(-80, -80);
      const [vx1, vy1] = cam.toWorld(cam.width + 80, cam.height + 80);
      const visible = (x, y, pad = 0) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.table;
      ctx.fillRect(0, 0, cam.width, cam.height);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      ctx.save();
      ctx.shadowColor = "rgba(40, 25, 8, 0.5)";
      ctx.shadowBlur = 26 * dpr;
      ctx.shadowOffsetY = 6 * dpr;
      ctx.fillStyle = theme.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      const sheet = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      sheet.addColorStop(0, theme.paperLight);
      sheet.addColorStop(0.65, theme.paper);
      sheet.addColorStop(1, theme.paperDark);
      ctx.fillStyle = sheet;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(92, 140, 150, 0.2)";
      ctx.fillRect(0, 0, W, H);
      const deep = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) / 2);
      deep.addColorStop(0, "rgba(60, 110, 130, 0)");
      deep.addColorStop(1, "rgba(60, 110, 130, 0.22)");
      ctx.fillStyle = deep;
      ctx.fillRect(0, 0, W, H);
      this.drawRhumbs(W, H, atlas.furniture.compass);
      this.drawFrame(W, H);
      this.drawLanes(L.lanes);
      ctx.globalAlpha = L.glyph;
      for (const d of atlas.decor) {
        if ((d.kind === "wave" || d.kind === "ship" || d.kind === "serpent") && visible(d.x, d.y, 100))
          drawGlyph(ctx, d);
      }
      ctx.globalAlpha = 1;
      this.drawIslets();
      for (const realm of atlas.realms)
        this.drawRealmLand(realm, L.glyph, visible);
      this.drawBridges(visible);
      this.drawFog();
      const { cartouche: c, compass } = atlas.furniture;
      drawCompass(ctx, compass.x, compass.y, compass.r);
      this.drawCartouche(c, atlas.title, atlas.subtitle);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.rect(ox, oy, W * s, H * s);
      ctx.clip();
      if (this.paper) {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.95;
        ctx.translate((ox % PAPER_TILE + PAPER_TILE) % PAPER_TILE - PAPER_TILE, (oy % PAPER_TILE + PAPER_TILE) % PAPER_TILE - PAPER_TILE);
        ctx.fillStyle = this.paper;
        ctx.fillRect(0, 0, cam.width + PAPER_TILE * 2, cam.height + PAPER_TILE * 2);
      }
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawNoteLinks();
      this.drawRoad();
      this.drawDots(0.55 + 0.45 * smooth(0.2, 0.5, s));
      this.drawRealmLabels(L.realmLabel);
      this.drawSeals(L);
      this.drawBridgeBadges();
      this.drawNoteLabels(L.noteLabel);
      this.drawFrontiers(L);
    }
    drawRhumbs(W, H, compass) {
      const { ctx } = this;
      ctx.save();
      ctx.beginPath();
      ctx.rect(62, 62, W - 124, H - 124);
      ctx.clip();
      ctx.strokeStyle = theme.inkSoft;
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.09;
      const hubs = [compass, { x: W * 0.5, y: H * 0.5 }, { x: W * 0.18, y: H * 0.82 }];
      for (const hub of hubs) {
        for (let i = 0;i < 32; i++) {
          const angle = i / 32 * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(hub.x, hub.y);
          ctx.lineTo(hub.x + Math.cos(angle) * 6000, hub.y + Math.sin(angle) * 6000);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    drawFrame(W, H) {
      const { ctx } = this;
      const band = 16;
      ctx.fillStyle = theme.ink;
      for (let i = 0, x = 46;x < W - 46; i++, x += band) {
        if (i % 2 === 0) {
          const w = Math.min(band, W - 46 - x);
          ctx.fillRect(x, 46, w, band);
          ctx.fillRect(x, H - 46 - band, w, band);
        }
      }
      for (let i = 0, y = 46 + band;y < H - 46 - band; i++, y += band) {
        if (i % 2 === 1) {
          const h = Math.min(band, H - 46 - band - y);
          ctx.fillRect(46, y, band, h);
          ctx.fillRect(W - 46 - band, y, band, h);
        }
      }
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      ctx.strokeRect(46, 46, W - 92, H - 92);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(62, 62, W - 124, H - 124);
      ctx.lineWidth = 1;
      ctx.strokeRect(38, 38, W - 76, H - 76);
    }
    drawLanes(alpha) {
      if (alpha < 0.02)
        return;
      const { ctx, model } = this;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = theme.inkSoft;
      ctx.globalAlpha = 0.32 * alpha;
      for (const lane of model.lanes) {
        const a = model.realms.get(lane.a).center;
        const b = model.realms.get(lane.b).center;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        ctx.lineWidth = 3 + lane.count * 0.14;
        ctx.setLineDash([2, 18]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx + nx * len * 0.1, my + ny * len * 0.1, b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }
    shallows(path) {
      const { ctx } = this;
      ctx.save();
      ctx.lineJoin = "round";
      for (const [w, a] of [[96, 0.07], [64, 0.1], [36, 0.13], [16, 0.16]]) {
        ctx.strokeStyle = `rgba(170, 214, 206, ${a})`;
        ctx.lineWidth = w;
        ctx.stroke(path);
      }
      ctx.restore();
    }
    drawIslets() {
      const { ctx } = this;
      ctx.lineJoin = "round";
      for (const path of this.isletPaths)
        this.shallows(path);
      for (const path of this.isletPaths) {
        ctx.save();
        ctx.translate(4, 5);
        ctx.fillStyle = "rgba(40, 25, 8, 0.22)";
        ctx.fill(path);
        ctx.restore();
        ctx.fillStyle = theme.land;
        ctx.fill(path);
        ctx.save();
        ctx.clip(path);
        ctx.strokeStyle = "rgba(63, 43, 26, 0.14)";
        ctx.lineWidth = 12;
        ctx.stroke(path);
        ctx.restore();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.8;
        ctx.stroke(path);
      }
    }
    drawRealmLand(realm, glyphAlpha, visible) {
      const { ctx, model, state } = this;
      const coast = this.coastPaths.get(realm.id);
      const c = realm.center;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      this.shallows(coast);
      ctx.strokeStyle = theme.inkSoft;
      [[1.05, 0.34], [1.1, 0.22], [1.16, 0.12]].forEach(([k, a], i) => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(k, k);
        ctx.translate(-c.x, -c.y);
        ctx.globalAlpha = a;
        ctx.lineWidth = (i === 0 ? 1.6 : 1.2) / k;
        ctx.setLineDash(i === 0 ? [] : [14, 10]);
        ctx.stroke(coast);
        ctx.restore();
      });
      ctx.save();
      ctx.strokeStyle = "rgba(111, 82, 54, 0.07)";
      ctx.lineWidth = 40;
      ctx.stroke(coast);
      ctx.restore();
      ctx.save();
      ctx.translate(6, 8);
      ctx.fillStyle = "rgba(40, 25, 8, 0.24)";
      ctx.fill(coast);
      ctx.restore();
      const b = model.realmBounds(realm);
      const reach = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
      const paint = ctx.createRadialGradient(c.x, c.y, reach * 0.1, c.x, c.y, reach);
      paint.addColorStop(0, theme.paperLight);
      paint.addColorStop(0.6, theme.land);
      paint.addColorStop(1, "#e2cf9c");
      ctx.fillStyle = paint;
      ctx.fill(coast);
      for (const id of realm.regionIds) {
        const region = model.regions.get(id);
        const cell = this.cellPaths.get(id);
        ctx.fillStyle = rgba(realm.tint, 0.2 + hash01(id) * 0.15);
        ctx.fill(cell);
        if (state.selectedRegion === id || state.hoverRegion === id) {
          ctx.fillStyle = rgba(theme.gold, state.selectedRegion === id ? 0.26 : 0.16);
          ctx.fill(cell);
        }
      }
      ctx.save();
      ctx.clip(coast);
      ctx.strokeStyle = "rgba(63, 43, 26, 0.12)";
      ctx.lineWidth = 22;
      ctx.stroke(coast);
      ctx.strokeStyle = theme.inkSoft;
      [[0.93, 0.2], [0.86, 0.14], [0.79, 0.1]].forEach(([k, a]) => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(k, k);
        ctx.translate(-c.x, -c.y);
        ctx.globalAlpha = a;
        ctx.lineWidth = 1.2 / k;
        ctx.setLineDash([10, 7]);
        ctx.stroke(coast);
        ctx.restore();
      });
      ctx.restore();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([16, 6, 3, 6]);
      for (const id of realm.regionIds)
        ctx.stroke(this.cellPaths.get(id));
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const id of realm.regionIds) {
        if (state.selectedRegion === id) {
          ctx.strokeStyle = theme.gold;
          ctx.lineWidth = 4;
          ctx.stroke(this.cellPaths.get(id));
        }
      }
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = state.selectedRealm === realm.id ? 4.2 : 2.4;
      ctx.stroke(coast);
      ctx.globalAlpha = glyphAlpha;
      for (const d of model.atlas.decor) {
        if ((d.kind === "mountain" || d.kind === "hill" || d.kind === "tree") && visible(d.x, d.y, 40)) {
          if (pointInPolygon(d, realm.coast))
            drawGlyph(ctx, d);
        }
      }
      ctx.globalAlpha = 1;
    }
    drawBridges(visible) {
      const { ctx, model, state } = this;
      const m = this.bridgeThickness();
      for (const b of model.bridges) {
        const mid = bridgePoint(b, 0.5);
        if (!visible(mid.x, mid.y, b.length))
          continue;
        const emphasis = state.selectedBridge === b.id ? "selected" : state.hoverBridge === b.id ? "hover" : "none";
        drawBridge(ctx, b, m, emphasis);
      }
    }
    drawBridgeBadges() {
      const { ctx, camera: cam, model, state } = this;
      for (const b of model.bridges) {
        const mid = bridgePoint(b, 0.5);
        const [x, y] = cam.toScreen(mid.x, mid.y);
        if (x < -30 || y < -30 || x > cam.width + 30 || y > cam.height + 30)
          continue;
        const hot = state.selectedBridge === b.id || state.hoverBridge === b.id;
        const r = hot ? 12 : 10.5;
        ctx.save();
        ctx.shadowColor = "rgba(40, 25, 8, 0.4)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = theme.paperLight;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 2;
        ctx.strokeStyle = hot ? theme.gold : theme.ink;
        ctx.stroke();
        ctx.fillStyle = theme.ink;
        ctx.font = `700 ${r * 1.05}px ${theme.display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(b.count), x, y + 0.5);
        ctx.restore();
      }
    }
    drawFog() {
      const { ctx, model } = this;
      for (const f of model.atlas.frontiers) {
        const grad = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, 110);
        grad.addColorStop(0, "rgba(120, 105, 80, 0.28)");
        grad.addColorStop(1, "rgba(120, 105, 80, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 110, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawCartouche(r, title, subtitle) {
      const { ctx } = this;
      ctx.save();
      ctx.fillStyle = "rgba(246, 237, 211, 0.9)";
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20, 8);
      ctx.stroke();
      ctx.fillStyle = theme.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${r.h * 0.27}px ${theme.display}`;
      ctx.fillText(title.toUpperCase(), r.x + r.w / 2, r.y + r.h * 0.42);
      ctx.font = `italic ${r.h * 0.15}px ${theme.body}`;
      ctx.fillStyle = theme.inkSoft;
      ctx.fillText(subtitle, r.x + r.w / 2, r.y + r.h * 0.72);
      ctx.restore();
    }
    text(text, x, y, font, color, opts = {}) {
      const { ctx } = this;
      ctx.save();
      ctx.font = font;
      ctx.textAlign = opts.align ?? "left";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = opts.alpha ?? 1;
      if ("letterSpacing" in ctx && opts.spacing)
        ctx.letterSpacing = opts.spacing;
      ctx.lineJoin = "round";
      ctx.strokeStyle = theme.halo;
      ctx.lineWidth = opts.halo ?? 4;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.restore();
    }
    measure(text, font) {
      const key = `${font}|${text}`;
      let w = this.widths.get(key);
      if (w === undefined) {
        this.ctx.save();
        this.ctx.font = font;
        w = this.ctx.measureText(text).width;
        this.ctx.restore();
        this.widths.set(key, w);
      }
      return w;
    }
    wrap(text, font, maxWidth, maxLines = 3) {
      const words = text.split(/\s+/);
      const lines = [];
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && this.measure(next, font) > maxWidth) {
          lines.push(line);
          line = word;
        } else
          line = next;
      }
      if (line)
        lines.push(line);
      if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
        return kept;
      }
      return lines;
    }
    drawRealmLabels(alpha) {
      if (alpha < 0.03)
        return;
      const { camera: cam, model } = this;
      const s = cam.s;
      for (const realm of model.atlas.realms) {
        const b = model.realmBounds(realm);
        const [x, y] = cam.toScreen(realm.center.x, realm.center.y);
        const size = clamp2(s * 62, 12, 40);
        const font = `700 ${size}px ${theme.display}`;
        const maxWidth = (b.maxX - b.minX) * s * 0.85;
        const lines = this.wrap(realm.fantasyName.toUpperCase(), font, Math.max(maxWidth, 90), 3);
        const lineH = size * 1.15;
        const subSize = Math.max(11, size * 0.42);
        const total = lines.length * lineH + subSize * 1.4;
        let cy = y - total / 2 + lineH / 2;
        for (const line of lines) {
          this.text(line, x, cy, font, theme.ink, { align: "center", halo: 8, alpha: 0.92 * alpha, spacing: `${size * 0.07}px` });
          cy += lineH;
        }
        this.text(realm.name, x, cy + subSize * 0.2, `italic ${subSize}px ${theme.body}`, theme.inkSoft, {
          align: "center",
          halo: 4,
          alpha: 0.9 * alpha
        });
      }
    }
    neighbourIds() {
      const set = new Set;
      const focus = this.state.selectedNote ?? this.state.hoverNote;
      const note = focus ? this.model.notes.get(focus) : null;
      if (note) {
        for (const id of note.links)
          set.add(id);
        for (const id of note.backlinks)
          set.add(id);
      }
      return set;
    }
    curve(a, b, bow = 0.14) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      return { c: [mx - dy * bow, my + dx * bow] };
    }
    drawNoteLinks() {
      const { ctx, camera: cam, model, state } = this;
      const id = state.selectedNote ?? state.hoverNote;
      const note = id ? model.notes.get(id) : null;
      if (!note)
        return;
      const from = cam.toScreen(note.x, note.y);
      const emphasis = state.selectedNote === id ? 1 : 0.55;
      ctx.save();
      ctx.lineCap = "round";
      const draw = (target, outgoing) => {
        const to = cam.toScreen(target.x, target.y);
        const { c } = this.curve(outgoing ? from : to, outgoing ? to : from);
        ctx.beginPath();
        ctx.moveTo(outgoing ? from[0] : to[0], outgoing ? from[1] : to[1]);
        ctx.quadraticCurveTo(c[0], c[1], outgoing ? to[0] : from[0], outgoing ? to[1] : from[1]);
        ctx.stroke();
      };
      ctx.strokeStyle = theme.wax;
      ctx.globalAlpha = 0.8 * emphasis;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      for (const t of note.links)
        draw(model.notes.get(t), true);
      ctx.strokeStyle = theme.inkSoft;
      ctx.globalAlpha = 0.65 * emphasis;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([1, 5]);
      for (const t of note.backlinks)
        draw(model.notes.get(t), false);
      ctx.restore();
    }
    drawRoad() {
      const { ctx, camera: cam, model, state } = this;
      if (!state.road)
        return;
      const road = model.roads.get(state.road.id);
      if (!road)
        return;
      const pts = road.steps.map((id) => {
        const n = model.notes.get(id);
        return cam.toScreen(n.x, n.y);
      });
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = theme.wax;
      ctx.fillStyle = theme.wax;
      for (let i = 0;i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const { c } = this.curve(a, b, 0.12);
        ctx.globalAlpha = i < state.road.step ? 0.9 : 0.55;
        ctx.lineWidth = 3.4;
        ctx.setLineDash([0.1, 8]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]);
        ctx.stroke();
        const t = 0.55;
        const px = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0];
        const py = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1];
        const tx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
        const ty = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
        const ang = Math.atan2(ty, tx);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(ang) * 8, py + Math.sin(ang) * 8);
        ctx.lineTo(px + Math.cos(ang + 2.5) * 7, py + Math.sin(ang + 2.5) * 7);
        ctx.lineTo(px + Math.cos(ang - 2.5) * 7, py + Math.sin(ang - 2.5) * 7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      pts.forEach(([x, y], i) => {
        const current = i === state.road.step;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, current ? 14 : 11, 0, Math.PI * 2);
        ctx.fillStyle = current ? theme.gold : theme.wax;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme.paperLight;
        ctx.stroke();
        ctx.fillStyle = "#fbf3dc";
        ctx.font = `700 ${current ? 14 : 12}px ${theme.display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), x, y + 0.5);
        ctx.restore();
      });
    }
    drawDots(alpha = 1) {
      const { ctx, camera: cam, model, state } = this;
      ctx.save();
      ctx.globalAlpha = alpha;
      const r = this.dotRadius();
      const neighbours = this.neighbourIds();
      const roadSteps = new Set(state.road ? model.roads.get(state.road.id)?.steps ?? [] : []);
      for (const n of model.atlas.notes) {
        const [x, y] = cam.toScreen(n.x, n.y);
        if (x < -20 || y < -20 || x > cam.width + 20 || y > cam.height + 20)
          continue;
        const selected = n.id === state.selectedNote;
        const hover = n.id === state.hoverNote;
        const hot = neighbours.has(n.id);
        const onRoad = roadSteps.has(n.id);
        if (onRoad)
          continue;
        ctx.beginPath();
        ctx.arc(x, y, selected ? r + 2 : hover ? r + 1.5 : r, 0, Math.PI * 2);
        ctx.fillStyle = selected ? theme.wax : theme.paperLight;
        ctx.fill();
        ctx.lineWidth = selected ? 2.2 : 1.4;
        ctx.strokeStyle = theme.ink;
        ctx.stroke();
        if (!selected) {
          ctx.beginPath();
          ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
          ctx.fillStyle = theme.ink;
          ctx.fill();
        }
        if (selected || hot) {
          ctx.beginPath();
          ctx.arc(x, y, r + (selected ? 6 : 4.5), 0, Math.PI * 2);
          ctx.strokeStyle = selected ? theme.gold : theme.wax;
          ctx.lineWidth = selected ? 3 : 1.6;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    drawSeals(L) {
      if (L.seal < 0.02)
        return;
      const { ctx, camera: cam, model, state } = this;
      const baseR = this.sealRadius();
      for (const region of model.atlas.regions) {
        const [x, y] = cam.toScreen(region.center.x, region.center.y);
        if (x < -120 || y < -120 || x > cam.width + 120 || y > cam.height + 120)
          continue;
        const hot = state.hoverRegion === region.id || state.selectedRegion === region.id;
        const r = hot ? baseR * 1.12 : baseR;
        ctx.save();
        ctx.globalAlpha = L.seal;
        ctx.shadowColor = "rgba(40, 25, 8, 0.4)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = theme.paperLight;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = hot ? theme.gold : theme.ink;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r - 4, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.wax;
        ctx.stroke();
        ctx.font = `${Math.round(r * 1.05)}px ${theme.emoji}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = theme.ink;
        ctx.fillText(region.sigil, x, y + r * 0.06);
        ctx.restore();
        if (L.regionLabel > 0.03) {
          const size = clamp2(10 + cam.s * 4, 11, 14);
          const font = `500 ${size}px ${theme.display}`;
          const lines = this.wrap(region.name.toUpperCase(), font, 150, 3);
          lines.forEach((line, i) => {
            this.text(line, x, y + r + 11 + i * (size + 2), font, theme.ink, {
              align: "center",
              halo: 4,
              alpha: L.regionLabel,
              spacing: "0.6px"
            });
          });
        }
      }
    }
    drawNoteLabels(alpha) {
      const { camera: cam, model, state } = this;
      const r = this.dotRadius();
      const neighbours = this.neighbourIds();
      const roadSteps = new Set(state.road ? model.roads.get(state.road.id)?.steps ?? [] : []);
      const size = clamp2(11 + cam.s * 2.2, 12, 14.5);
      const font = `${size}px ${theme.body}`;
      const placed = [];
      const seals = lod(cam.s).seal > 0.4 ? model.atlas.regions.map((rg) => cam.toScreen(rg.center.x, rg.center.y)) : [];
      const sealR = this.sealRadius();
      const tryPlace = (n, force, a, strong = false) => {
        const [x, y] = cam.toScreen(n.x, n.y);
        if (x < -200 || y < -50 || x > cam.width + 200 || y > cam.height + 50)
          return;
        const label = shorten(n.title, force ? 60 : 38);
        const w = this.measure(label, font);
        const rightSide = x + r + 5 + w < cam.width - 8;
        const x0 = rightSide ? x + r + 5 : x - r - 5 - w;
        const box = { x0, y0: y - size * 0.7, x1: x0 + w, y1: y + size * 0.7 };
        if (!force) {
          if (placed.some((p) => box.x0 < p.x1 + 3 && box.x1 > p.x0 - 3 && box.y0 < p.y1 && box.y1 > p.y0))
            return;
          if (seals.some((p) => box.x0 < p[0] + 80 && box.x1 > p[0] - 80 && box.y0 < p[1] + sealR + 52 && box.y1 > p[1] - sealR - 4))
            return;
        }
        placed.push(box);
        this.text(label, x0, y + 0.5, `${strong ? "italic " : ""}${font}`, strong ? theme.wax : theme.ink, {
          halo: 4,
          alpha: a
        });
      };
      const focus = state.selectedNote ?? state.hoverNote;
      if (state.selectedNote)
        tryPlace(model.notes.get(state.selectedNote), true, 1, true);
      if (state.hoverNote && state.hoverNote !== state.selectedNote)
        tryPlace(model.notes.get(state.hoverNote), true, 1, true);
      if (focus && cam.s > 0.4)
        for (const id of neighbours)
          tryPlace(model.notes.get(id), false, 1, true);
      if (state.road && state.road.step >= 0) {
        const current = model.roads.get(state.road.id)?.steps[state.road.step];
        if (current && current !== state.selectedNote)
          tryPlace(model.notes.get(current), true, 1, true);
      }
      for (const id of roadSteps)
        if (cam.s > 0.4)
          tryPlace(model.notes.get(id), false, 1);
      if (alpha > 0.04)
        for (const n of model.atlas.notes)
          tryPlace(n, false, alpha);
    }
    drawFrontiers(L) {
      const { ctx, camera: cam, model, state } = this;
      const labelAlpha = smooth(0.2, 0.34, cam.s);
      for (const f of model.atlas.frontiers) {
        const [x, y] = cam.toScreen(f.x, f.y);
        if (x < -200 || y < -50 || x > cam.width + 200 || y > cam.height + 50)
          continue;
        const hot = state.frontier === f.id || state.hoverFrontier === f.id;
        const r = hot ? 17 : 15;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(244, 234, 208, 0.92)";
        ctx.fill();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = state.frontier === f.id ? theme.wax : theme.ink;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.wax;
        ctx.font = `700 ${r * 1.2}px ${theme.display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x, y + 1);
        ctx.restore();
        if (labelAlpha > 0.03) {
          this.text(shorten(f.title, 34), x + r + 6, y, `italic 14px ${theme.body}`, theme.inkSoft, { halo: 4, alpha: labelAlpha });
        }
      }
    }
    regionOf(id) {
      return this.model.regions.get(id);
    }
  }

  // src/apps/web/ui/install.ts
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  function initInstall(button) {
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      button.hidden = isStandalone();
    });
    button.addEventListener("click", async () => {
      if (!deferred)
        return;
      await deferred.prompt();
      deferred = null;
      button.hidden = true;
    });
    window.addEventListener("appinstalled", () => {
      deferred = null;
      button.hidden = true;
    });
  }
  function installHint() {
    if (isStandalone())
      return null;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (ios)
      return "Install as an app: tap Share, then Add to Home Screen.";
    const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
    if (safari)
      return "Install as an app: choose File, then Add to Dock.";
    return null;
  }

  // src/domain/dailyTopic.ts
  function dayNumber(year, month, day) {
    return Math.floor(Date.UTC(year, month, day) / 86400000);
  }
  function pickDailyTopic(noteIds, day) {
    const ids = [...noteIds].sort();
    const total = ids.length;
    if (total === 0)
      throw new Error("dailyTopic: there are no notes to pick from");
    const cycle = Math.floor(day / total);
    const position = (day % total + total) % total;
    const rng = createRng(`daily/${cycle}`);
    for (let i = total - 1;i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return { id: ids[position], position, total, cycle };
  }

  // src/apps/web/ui/dom.ts
  function h(tag, attrs = null, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === false)
          continue;
        if (value === true)
          el.setAttribute(key, "");
        else
          el.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (child === null || child === false || child === undefined)
        continue;
      el.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return el;
  }
  function html(markup) {
    const t = document.createElement("template");
    t.innerHTML = markup;
    return t.content;
  }

  // src/apps/web/ui/markdown.ts
  var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  var unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  function renderInline(text, resolve) {
    let s = esc(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(`<code>${c}</code>`);
      return `\x00${codes.length - 1}\x00`;
    });
    s = s.replace(/!\[\[[^\]]*\]\]/g, "");
    s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, alias) => {
      const id = resolve(unesc(target));
      const label = alias ?? target.trim().replace(/^\d+\s*-\s*/, "");
      return id ? `<a class="link" href="#note/${encodeURIComponent(id)}" data-act="note" data-id="${esc(id)}">${label}</a>` : `<span class="link link--dead" title="No note of that name on the map">${label}</span>`;
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    s = s.replace(/==(.+?)==/g, "<mark>$1</mark>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  }
  var LIST = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
  var HEADING = /^(#{1,6})\s+(.*)$/;
  var TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  function isBlockStart(line) {
    return !line.trim() || HEADING.test(line) || LIST.test(line) || /^\s*>/.test(line) || /^\s*```/.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim()) || line.trim().startsWith("|");
  }
  function cells(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  }
  function renderMarkdown(source, resolve) {
    const lines = source.replace(/\t/g, "    ").split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (/^\s*```/.test(line)) {
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i]))
          body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join(`
`))}</code></pre>`);
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const tag = heading[1].length <= 2 ? "h3" : "h4";
        out.push(`<${tag}>${renderInline(heading[2], resolve)}</${tag}>`);
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        out.push("<hr>");
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i]))
          body.push(lines[i++].replace(/^\s*>\s?/, "").replace(/^\[![^\]]+\][+-]?\s*/, ""));
        out.push(`<blockquote>${body.map((b) => renderInline(b, resolve)).join("<br>")}</blockquote>`);
        continue;
      }
      if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|"))
          rows.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map((c) => `<th>${renderInline(c, resolve)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, resolve)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }
      if (LIST.test(line)) {
        const stack = [];
        let html = "";
        while (i < lines.length) {
          const m = LIST.exec(lines[i]);
          if (!m)
            break;
          const indent = m[1].length;
          const tag = /\d/.test(m[2]) ? "ol" : "ul";
          while (stack.length && indent < stack[stack.length - 1].indent)
            html += `</li></${stack.pop().tag}>`;
          if (!stack.length || indent > stack[stack.length - 1].indent) {
            stack.push({ tag, indent });
            html += `<${tag}><li>`;
          } else
            html += "</li><li>";
          html += renderInline(m[3], resolve);
          i++;
        }
        while (stack.length)
          html += `</li></${stack.pop().tag}>`;
        out.push(html);
        continue;
      }
      const para = [line.trim()];
      i++;
      while (i < lines.length && !isBlockStart(lines[i]))
        para.push(lines[i++].trim());
      out.push(`<p>${renderInline(para.join(" "), resolve)}</p>`);
    }
    return out.join(`
`);
  }

  // src/apps/web/ui/panel.ts
  var plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  class Panel {
    root;
    model;
    handlers;
    scroll;
    bar;
    grip;
    constructor(root, model, handlers) {
      this.root = root;
      this.model = model;
      this.handlers = handlers;
      this.grip = h("div", { class: "panel__grip", role: "button", "aria-label": "Drag to resize the panel", tabindex: "-1" });
      this.bar = h("div", { class: "panel__bar" });
      this.scroll = h("div", { class: "panel__scroll" });
      root.append(this.grip, this.bar, this.scroll);
      root.addEventListener("click", (e) => this.onClick(e));
    }
    onClick(e) {
      const el = e.target.closest("[data-act]");
      if (!el)
        return;
      if (el.tagName === "A")
        e.preventDefault();
      const { act, id = "", step = "" } = el.dataset;
      switch (act) {
        case "note":
        case "region":
        case "realm":
        case "frontier":
        case "bridge":
          this.handlers.go({ kind: act, id });
          break;
        case "road":
          this.handlers.go({ kind: "road", id, step: step === "" ? -1 : Number(step) });
          break;
        case "tab":
          this.handlers.go({ kind: "home", tab: id });
          break;
        case "back":
          this.handlers.back();
          break;
        case "close":
          this.handlers.close();
          break;
      }
    }
    render(view) {
      this.bar.replaceChildren();
      this.scroll.replaceChildren();
      switch (view.kind) {
        case "home":
          return this.renderHome(view.tab);
        case "note":
          return this.renderNote(view.id);
        case "region":
          return this.renderRegion(view.id);
        case "realm":
          return this.renderRealm(view.id);
        case "road":
          return this.renderRoad(view.id, view.step);
        case "frontier":
          return this.renderFrontier(view.id);
        case "bridge":
          return this.renderBridge(view.id);
      }
    }
    setBar(crumb) {
      const back = this.handlers.canGoBack() ? h("button", { class: "panel__icon", type: "button", "data-act": "back", "aria-label": "Back" }, "←") : null;
      this.bar.append(...back ? [back] : [], h("div", { class: "panel__crumb" }, crumb), h("button", { class: "panel__icon", type: "button", "data-act": "close", "aria-label": "Close panel" }, "×"));
    }
    put(...children) {
      this.scroll.append(...children.filter((c) => c !== null));
    }
    linkBtn(act, id, label) {
      return h("button", { type: "button", "data-act": act, "data-id": id }, label);
    }
    row(act, id, title, sub, lead, count, step) {
      return h("button", { type: "button", class: "row", "data-act": act, "data-id": id, "data-step": step === undefined ? undefined : String(step) }, lead ? h("span", { class: "row__sigil" }, lead) : null, h("span", { class: "row__text" }, title, sub ? h("span", { class: "row__sub" }, sub) : null), count ? h("span", { class: "row__count" }, count) : null);
    }
    noteRow(n, withBlurb = false) {
      const region = this.model.regions.get(n.regionId);
      return this.row("note", n.id, n.title, withBlurb && n.blurb ? n.blurb : region.name, region.sigil);
    }
    list(items) {
      return h("ul", { class: "list" }, ...items.map((i) => h("li", null, i)));
    }
    regionRow(region) {
      return this.row("region", region.id, region.name, `${region.npc.name}, ${region.npc.epithet}`, region.sigil, String(region.noteIds.length));
    }
    renderHome(tab) {
      const { atlas } = this.model;
      this.setBar("Atlas");
      const tabs = h("div", { class: "tabs", role: "tablist" }, ...[
        ["lands", "Lands"],
        ["roads", "Roads"],
        ["unmapped", "Unmapped"]
      ].map(([id, label]) => h("button", { class: "tab", type: "button", role: "tab", "aria-selected": String(tab === id), "data-act": "tab", "data-id": id }, label)));
      const intro = h("p", { class: "lede" }, `${atlas.notes.length} notes across ${atlas.realms.length} realms. Tap a seal to meet the keeper of a region, follow a road to read across realms, and look for the ? marks at the edge of the sea: they are the questions not yet written.`);
      const hint = this.handlers.installHint();
      this.put(h("h2", null, atlas.title), intro, this.todayCard(), hint ? h("p", { class: "install-hint" }, `\uD83D\uDCF2 ${hint}`) : null, tabs);
      if (tab === "lands") {
        for (const realm of atlas.realms) {
          this.put(h("h3", null, this.linkBtn("realm", realm.id, realm.fantasyName)), h("p", { class: "lede" }, `${realm.name}. ${realm.epithet[0].toUpperCase()}${realm.epithet.slice(1)}.`), this.list(realm.regionIds.map((id) => this.regionRow(this.model.regions.get(id)))));
        }
      } else if (tab === "roads") {
        this.put(h("p", { class: "lede" }, "Reading paths that each follow one question across the realms."), this.list(atlas.roads.map((r) => this.row("road", r.id, r.title, r.subtitle ?? undefined, `${r.number}.`, plural(r.steps.length, "stop")))));
      } else {
        this.put(h("p", { class: "lede" }, "Threads the notes point toward but do not yet hold. Questions, not tasks."), this.list(atlas.frontiers.map((f) => this.row("frontier", f.id, f.title, undefined, "?"))));
      }
    }
    todayCard() {
      const now = new Date;
      const ids = this.model.atlas.notes.map((n) => n.id);
      if (!ids.length)
        return null;
      const pick = pickDailyTopic(ids, dayNumber(now.getFullYear(), now.getMonth(), now.getDate()));
      const note = this.model.notes.get(pick.id);
      if (!note)
        return null;
      const region = this.model.regions.get(note.regionId);
      return h("div", { class: "today" }, h("p", { class: "today__label" }, "Today's topic"), this.row("note", note.id, note.title, `${region.name}${note.blurb ? ` · ${note.blurb}` : ""}`, "\uD83E\uDDED"));
    }
    renderNote(id) {
      const note = this.model.notes.get(id);
      if (!note)
        return this.renderMissing();
      const region = this.model.regions.get(note.regionId);
      const realm = this.model.realms.get(note.realmId);
      this.setBar(h("span", null, this.linkBtn("realm", realm.id, realm.fantasyName), " › ", this.linkBtn("region", region.id, region.name)));
      const onRoads = this.model.roadsByNote.get(id) ?? [];
      this.put(h("h2", null, note.title), note.blurb ? h("p", { class: "lede" }, note.blurb) : null, note.group ? h("p", { class: "row__sub" }, `Within ${region.name}: ${note.group}`) : null, note.tags.length ? h("div", { class: "chips" }, ...note.tags.map((t) => h("span", { class: "chip" }, t))) : null, onRoads.length ? h("div", { class: "chips" }, ...onRoads.map(({ road, step }) => h("button", { class: "chip", type: "button", "data-act": "road", "data-id": road.id, "data-step": String(step) }, `Road ${road.number}, stop ${step + 1}`))) : null);
      const body = h("div", { class: "note-body" });
      if (note.locked)
        body.append(h("p", { class: "lede" }, "The full text of this note is kept private. Its place on the map and its connections are shown here."));
      else
        body.append(html(renderMarkdown(note.body, (t) => this.model.resolveTarget(t))));
      this.put(body);
      if (note.links.length) {
        this.put(h("h3", null, `Leads to (${note.links.length})`), this.list(note.links.map((t) => this.noteRow(this.model.notes.get(t)))));
      }
      if (note.backlinks.length) {
        this.put(h("h3", null, `Referenced by (${note.backlinks.length})`), this.list(note.backlinks.map((t) => this.noteRow(this.model.notes.get(t)))));
      }
      this.scroll.scrollTop = 0;
    }
    renderRegion(id) {
      const region = this.model.regions.get(id);
      if (!region)
        return this.renderMissing();
      const realm = this.model.realms.get(region.realmId);
      this.setBar(h("span", null, this.linkBtn("realm", realm.id, realm.fantasyName), " › ", region.name));
      this.put(h("div", { class: "npc" }, h("div", { class: "npc__seal", "aria-hidden": "true" }, region.sigil), h("div", null, h("h2", { class: "npc__name" }, region.npc.name), h("p", { class: "npc__epithet" }, region.npc.epithet))), h("div", { class: "speech" }, `“${region.npc.greeting}”`), h("p", { class: "row__sub" }, `Keeper of ${region.name}: ${plural(region.noteIds.length, "topic")}.`));
      const byGroup = new Map;
      for (const nid of region.noteIds) {
        const n = this.model.notes.get(nid);
        byGroup.set(n.group, [...byGroup.get(n.group) ?? [], n]);
      }
      for (const [group, notes] of byGroup) {
        this.put(h("h3", null, group ?? "Topics"), this.list(notes.map((n) => this.row("note", n.id, n.title, n.blurb || undefined))));
      }
      const neighbours = this.model.strongestNeighbours(id, 4);
      if (neighbours.length) {
        this.put(h("h3", null, "Whispers from neighbouring lands"), this.list(neighbours.map(({ region: r, count }) => this.row("region", r.id, r.name, `${r.npc.name}. ${plural(count, "link")} between our topics`, r.sigil))));
      }
      this.scroll.scrollTop = 0;
    }
    renderBridge(id) {
      const bridge = this.model.bridgesById.get(id);
      if (!bridge)
        return this.renderMissing();
      const a = this.model.regions.get(bridge.a);
      const b = this.model.regions.get(bridge.b);
      this.setBar("Bridge");
      const style = { stone: "A stone bridge: a strong, well-worn tie.", rope: "A plank-and-rope bridge: a steady tie.", stones: "Stepping stones: a light tie." }[bridge.kind];
      this.put(h("h2", null, `${a.name} ↔ ${b.name}`), h("p", { class: "lede" }, `${style} ${plural(bridge.count, "note link")} cross here, each one a place where the notes on one shore lean on the other.`), this.list([this.regionRow(a), this.regionRow(b)]), h("h3", null, `The links (${bridge.count})`), h("div", null, ...bridge.links.map(({ from, to }) => {
        const f = this.model.notes.get(from);
        const t = this.model.notes.get(to);
        const chip = (n) => h("button", { class: "chip", type: "button", "data-act": "note", "data-id": n.id }, n.title);
        return h("div", { class: "bridge-link" }, chip(f), h("span", { class: "bridge-link__arrow", "aria-hidden": "true" }, "→"), chip(t));
      })));
      const bridges = this.model.bridges.filter((br) => br.a === id || br.b === id);
      if (bridges.length) {
        this.put(h("h3", null, "Bridges"), this.list(bridges.map((br) => {
          const other = this.model.regions.get(br.a === id ? br.b : br.a);
          return this.row("bridge", br.id, `To ${other.name}`, `${plural(br.count, "link")} cross this bridge`, "\uD83C\uDF09");
        })));
      }
      this.scroll.scrollTop = 0;
    }
    renderRealm(id) {
      const realm = this.model.realms.get(id);
      if (!realm)
        return this.renderMissing();
      this.setBar(`Realm ${realm.id}`);
      const count = realm.regionIds.reduce((s, r) => s + this.model.regions.get(r).noteIds.length, 0);
      this.put(h("h2", null, realm.fantasyName), h("p", { class: "lede" }, `${realm.name}. ${realm.epithet[0].toUpperCase()}${realm.epithet.slice(1)}.`), h("p", { class: "row__sub" }, `${plural(realm.regionIds.length, "region")}, ${plural(count, "note")}.`), this.list(realm.regionIds.map((r) => this.regionRow(this.model.regions.get(r)))));
      const lanes = this.model.lanes.filter((l) => l.a === id || l.b === id).sort((a, b) => b.count - a.count);
      if (lanes.length) {
        this.put(h("h3", null, "Sea lanes"), this.list(lanes.map((l) => {
          const other = this.model.realms.get(l.a === id ? l.b : l.a);
          return this.row("realm", other.id, other.fantasyName, `${plural(l.count, "link")} cross the water`, "⛵");
        })));
      }
      this.scroll.scrollTop = 0;
    }
    renderRoad(id, step) {
      const road = this.model.roads.get(id);
      if (!road)
        return this.renderMissing();
      this.setBar(`Road ${road.number}`);
      const last = road.steps.length - 1;
      const stepBtn = (label, target, disabled, ghost = false) => h("button", { class: `btn${ghost ? " btn--ghost" : ""}`, type: "button", "data-act": "road", "data-id": id, "data-step": String(target), disabled }, label);
      this.put(h("h2", null, road.title), road.subtitle ? h("p", { class: "lede" }, road.subtitle) : null, h("div", { class: "stepper" }, step < 0 ? stepBtn("Begin the journey", 0, !road.steps.length) : stepBtn("← Previous", step - 1, step <= 0, true), step >= 0 ? stepBtn(step >= last ? "Journey's end" : "Next stop →", Math.min(step + 1, last), step >= last) : null), h("ol", { class: "list" }, ...road.steps.map((nid, i) => {
        const n = this.model.notes.get(nid);
        const region = this.model.regions.get(n.regionId);
        return h("li", { class: "step", "aria-current": i === step ? "step" : undefined }, h("span", { class: "step__n" }, String(i + 1)), h("div", { style: "flex:1;min-width:0" }, this.row("road", id, n.title, region.name, undefined, undefined, i)));
      })));
      if (step >= 0) {
        const n = this.model.notes.get(road.steps[step]);
        this.put(h("h3", null, "This stop"), this.row("note", n.id, n.title, n.blurb || undefined, "\uD83D\uDCD6"));
      }
    }
    renderFrontier(id) {
      const f = this.model.frontiers.get(id);
      if (!f)
        return this.renderMissing();
      this.setBar("Unmapped waters");
      const body = h("div", { class: "note-body" });
      body.append(html(`<p>${renderInline(f.markdown, (t) => this.model.resolveTarget(t))}</p>`));
      this.put(h("h2", null, f.title), h("p", { class: "lede" }, "Here the notes point beyond themselves. Nothing is written yet."), body);
      if (f.noteIds.length) {
        this.put(h("h3", null, "Notes that point here"), this.list(f.noteIds.map((n) => this.noteRow(this.model.notes.get(n)))));
      }
    }
    renderMissing() {
      this.setBar("Atlas");
      this.put(h("h2", null, "Off the map"), h("p", null, "That place is not on this chart."));
    }
  }

  // src/apps/web/ui/refresh.ts
  async function refreshApp(button) {
    button?.classList.add("is-spinning");
    button?.setAttribute("disabled", "");
    const attempt = async (work) => {
      try {
        await work();
      } catch {}
    };
    await attempt(async () => {
      const regs = await navigator.serviceWorker?.getRegistrations() ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
    });
    await attempt(async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    });
    await attempt(async () => {
      const urls = new Set(["./", "main.js", "atlas-data.js", "sw.js", "manifest.webmanifest"]);
      document.querySelectorAll('link[rel="stylesheet"][href], link[rel="manifest"][href], link[rel~="icon"][href]').forEach((l) => {
        if (new URL(l.href).origin === location.origin)
          urls.add(l.getAttribute("href"));
      });
      document.querySelectorAll("script[src]").forEach((s) => {
        if (new URL(s.src).origin === location.origin)
          urls.add(s.getAttribute("src"));
      });
      await Promise.all([...urls].map((u) => fetch(u, { cache: "reload" })));
    });
    const next = new URL(location.href);
    next.searchParams.set("r", String(Date.now()));
    location.replace(next.toString());
  }
  function cleanRefreshParam() {
    const url = new URL(location.href);
    if (!url.searchParams.has("r"))
      return;
    url.searchParams.delete("r");
    try {
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
  }

  // src/apps/web/ui/search.ts
  class Search {
    input;
    list;
    model;
    onPick;
    results = [];
    active = 0;
    constructor(input, list, model, onPick) {
      this.input = input;
      this.list = list;
      this.model = model;
      this.onPick = onPick;
      input.addEventListener("input", () => this.update());
      input.addEventListener("focus", () => this.update());
      input.addEventListener("keydown", (e) => this.onKey(e));
      list.addEventListener("pointerdown", (e) => {
        const li = e.target.closest("li");
        if (!li)
          return;
        e.preventDefault();
        this.pick(Number(li.dataset.i));
      });
      document.addEventListener("pointerdown", (e) => {
        if (!e.target.closest(".search"))
          this.hide();
      });
      window.addEventListener("keydown", (e) => {
        const t = e.target;
        if (e.key === "/" && t && !/^(INPUT|TEXTAREA)$/.test(t.tagName)) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      });
    }
    hide() {
      this.list.hidden = true;
    }
    isOpen() {
      return !this.list.hidden;
    }
    score(q, ...fields) {
      let best = 0;
      fields.forEach((f, i) => {
        if (!f)
          return;
        const text = f.toLowerCase();
        const at = text.indexOf(q);
        if (at < 0)
          return;
        const weight = 4 - Math.min(i, 3);
        best = Math.max(best, weight * 10 + (at === 0 ? 8 : text[at - 1] === " " ? 4 : 0));
      });
      return best;
    }
    update() {
      const q = this.input.value.trim().toLowerCase();
      if (q.length < 2)
        return this.hide();
      const { atlas } = this.model;
      const found = [];
      for (const n of atlas.notes) {
        const s = this.score(q, n.title, n.tags.join(" "), n.blurb);
        if (s)
          found.push({ kind: "Note", label: n.title, sub: this.model.regions.get(n.regionId).name, view: { kind: "note", id: n.id }, score: s });
      }
      for (const r of atlas.regions) {
        const s = this.score(q, r.name, r.npc.name, r.npc.epithet);
        if (s)
          found.push({ kind: "Keeper", label: r.npc.name, sub: `${r.npc.epithet}, ${r.name}`, view: { kind: "region", id: r.id }, score: s + 2 });
      }
      for (const r of atlas.realms) {
        const s = this.score(q, r.fantasyName, r.name);
        if (s)
          found.push({ kind: "Realm", label: r.fantasyName, sub: r.name, view: { kind: "realm", id: r.id }, score: s + 4 });
      }
      for (const r of atlas.roads) {
        const s = this.score(q, r.title, r.subtitle ?? undefined);
        if (s)
          found.push({ kind: "Road", label: r.title, sub: `Road ${r.number}`, view: { kind: "road", id: r.id, step: -1 }, score: s });
      }
      for (const f of atlas.frontiers) {
        const s = this.score(q, f.title);
        if (s)
          found.push({ kind: "Unmapped", label: f.title, sub: "Open thread", view: { kind: "frontier", id: f.id }, score: s });
      }
      this.results = found.sort((a, b) => b.score - a.score).slice(0, 9);
      this.active = 0;
      this.renderList();
    }
    renderList() {
      this.list.replaceChildren(...this.results.length ? this.results.map((r, i) => h("li", { "data-i": String(i), role: "option", "aria-selected": String(i === this.active) }, h("span", { class: "search__kind" }, r.kind), h("span", null, r.label, h("span", { class: "search__sub" }, r.sub)))) : [h("li", null, h("em", null, "Nothing on the map by that name"))]);
      this.list.hidden = false;
    }
    onKey(e) {
      if (e.key === "Escape") {
        this.hide();
        this.input.blur();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!this.results.length)
          return;
        e.preventDefault();
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length;
        this.renderList();
      } else if (e.key === "Enter") {
        this.pick(this.active);
      }
    }
    pick(i) {
      const r = this.results[i];
      if (!r)
        return;
      this.hide();
      this.input.blur();
      this.onPick(r.view);
    }
  }

  // src/apps/web/ui/sheet.ts
  function attachSheet(grip, panel, opts) {
    let dragging = false;
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let moved = 0;
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = lastY = e.clientY;
      lastT = performance.now();
      startH = opts.get();
      moved = 0;
      velocity = 0;
      grip.setPointerCapture(e.pointerId);
      panel.classList.add("is-dragging-sheet");
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging)
        return;
      const now = performance.now();
      if (now > lastT)
        velocity = (lastY - e.clientY) / (now - lastT);
      lastY = e.clientY;
      lastT = now;
      moved = Math.max(moved, Math.abs(e.clientY - startY));
      const snaps = opts.snaps();
      const lo = Math.min(...snaps);
      const hi = Math.max(...snaps);
      opts.set(Math.max(lo, Math.min(hi, startH + (startY - e.clientY))), false);
    });
    const end = () => {
      if (!dragging)
        return;
      dragging = false;
      panel.classList.remove("is-dragging-sheet");
      const snaps = [...opts.snaps()].sort((a, b) => a - b);
      const current = opts.get();
      if (moved < 6) {
        const taller = snaps.find((s) => s > current + 8);
        opts.set(taller ?? snaps[0], true);
        return;
      }
      const projected = current + velocity * 180;
      const target = snaps.reduce((best, s) => Math.abs(s - projected) < Math.abs(best - projected) ? s : best, snaps[0]);
      opts.set(target, true);
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  // src/apps/web/ui/view.ts
  function sameView(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function viewToHash(v) {
    switch (v.kind) {
      case "home":
        return "";
      case "road":
        return `#road/${encodeURIComponent(v.id)}/${v.step}`;
      default:
        return `#${v.kind}/${encodeURIComponent(v.id)}`;
    }
  }
  function hashToView(hash) {
    const m = /^#(note|region|realm|frontier|road|bridge)\/([^/]+)(?:\/(-?\d+))?$/.exec(hash);
    if (!m)
      return null;
    const id = decodeURIComponent(m[2]);
    if (m[1] === "road")
      return { kind: "road", id, step: m[3] ? Number(m[3]) : -1 };
    return { kind: m[1], id };
  }

  // src/apps/web/main.ts
  cleanRefreshParam();
  var atlas = window.__ATLAS__;
  var model = new AtlasModel(atlas);
  var canvas = document.getElementById("map");
  var panelEl = document.getElementById("panel");
  var tooltip = document.getElementById("tooltip");
  document.title = atlas.title;
  var heading = document.querySelector(".topbar__title");
  if (heading)
    heading.textContent = atlas.title;
  var camera = new Camera(atlas.world);
  var scene = new Scene(canvas, model, camera);
  scene.touch = window.matchMedia("(pointer: coarse)").matches;
  var isPhone = () => window.matchMedia("(max-width: 760px)").matches;
  var dirty = true;
  camera.onChange = () => dirty = true;
  var view = { kind: "home", tab: "lands" };
  var stack = [];
  var panelOpen = false;
  var panel = new Panel(panelEl, model, {
    go: (v) => go(v),
    back: () => back(),
    close: () => closePanel(),
    canGoBack: () => stack.length > 0,
    installHint
  });
  var SHEET_NAMES = ["peek", "half", "full"];
  var sheetName = "half";
  var sheetDrag = null;
  function sheetSnaps() {
    const top = document.querySelector(".topbar")?.offsetHeight ?? 56;
    return [112, Math.round(window.innerHeight * 0.52), Math.max(240, window.innerHeight - top - 16)];
  }
  var sheetHeight = () => sheetDrag ?? sheetSnaps()[SHEET_NAMES.indexOf(sheetName)];
  function paintSheet() {
    document.documentElement.style.setProperty("--sheet-h", `${sheetHeight()}px`);
  }
  function setSheet(name) {
    sheetName = name;
    sheetDrag = null;
    updateInsets();
  }
  function updateInsets() {
    if (!panelOpen)
      return camera.setInsets(0, 0);
    if (isPhone()) {
      paintSheet();
      camera.setInsets(0, sheetHeight() + 8);
    } else {
      camera.setInsets(Math.round(panelEl.getBoundingClientRect().width) + 28, 0);
    }
    dirty = true;
  }
  attachSheet(panel.grip, panelEl, {
    snaps: sheetSnaps,
    get: sheetHeight,
    set(height, settle) {
      if (!settle) {
        sheetDrag = height;
        paintSheet();
        return;
      }
      const snaps = sheetSnaps();
      const nearest = snaps.reduce((best, h, i) => Math.abs(h - height) < Math.abs(snaps[best] - height) ? i : best, 0);
      setSheet(SHEET_NAMES[nearest]);
    }
  });
  var sentinel = false;
  var ignorePops = 0;
  function pushSentinel() {
    if (sentinel || !isPhone())
      return;
    try {
      history.pushState({ atlasPanel: true }, "", location.href);
      sentinel = true;
    } catch {}
  }
  function dropSentinel() {
    if (!sentinel)
      return;
    sentinel = false;
    ignorePops++;
    try {
      history.back();
    } catch {
      ignorePops--;
    }
  }
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    sentinel = false;
    if (!panelOpen)
      return;
    if (stack.length) {
      back();
      pushSentinel();
    } else
      closePanel();
  });
  function setPanelOpen(open) {
    panelOpen = open;
    document.body.classList.toggle("panel-open", open);
    updateInsets();
    if (open)
      pushSentinel();
  }
  function applyView(v, fly) {
    const st = scene.state;
    st.selectedNote = v.kind === "note" ? v.id : null;
    st.selectedRegion = v.kind === "region" ? v.id : null;
    st.selectedRealm = v.kind === "realm" ? v.id : null;
    st.frontier = v.kind === "frontier" ? v.id : null;
    st.selectedBridge = v.kind === "bridge" ? v.id : null;
    st.road = v.kind === "road" ? { id: v.id, step: v.step } : null;
    panel.render(v);
    try {
      history.replaceState(null, "", viewToHash(v) || location.pathname + location.search);
    } catch {}
    dirty = true;
    if (!fly)
      return;
    const phoneZoom = isPhone() ? 1 : 1.25;
    switch (v.kind) {
      case "note": {
        const n = model.notes.get(v.id);
        if (n)
          camera.flyTo({ x: n.x, y: n.y, s: Math.max(camera.s, phoneZoom) });
        break;
      }
      case "region": {
        const r = model.regions.get(v.id);
        if (r)
          camera.fitBounds(model.regionBounds(r), 50, 900, 1.5);
        break;
      }
      case "realm": {
        const r = model.realms.get(v.id);
        if (r)
          camera.fitBounds(model.realmBounds(r), 40, 900);
        break;
      }
      case "frontier": {
        const f = model.frontiers.get(v.id);
        if (f)
          camera.flyTo({ x: f.x, y: f.y, s: Math.max(camera.s, 0.55) });
        break;
      }
      case "bridge": {
        const b = model.bridgesById.get(v.id);
        if (!b)
          break;
        camera.fitBounds({
          minX: Math.min(b.p0.x, b.p1.x, b.c.x),
          maxX: Math.max(b.p0.x, b.p1.x, b.c.x),
          minY: Math.min(b.p0.y, b.p1.y, b.c.y),
          maxY: Math.max(b.p0.y, b.p1.y, b.c.y)
        }, 140, 900, 1.1);
        break;
      }
      case "road": {
        const road = model.roads.get(v.id);
        if (!road)
          break;
        if (v.step >= 0) {
          const n = model.notes.get(road.steps[v.step]);
          if (n)
            camera.flyTo({ x: n.x, y: n.y, s: Math.max(camera.s, 0.9) });
        } else {
          const pts = road.steps.map((id) => model.notes.get(id));
          camera.fitBounds({
            minX: Math.min(...pts.map((p) => p.x)),
            maxX: Math.max(...pts.map((p) => p.x)),
            minY: Math.min(...pts.map((p) => p.y)),
            maxY: Math.max(...pts.map((p) => p.y))
          }, 90, 1000, 1.1);
        }
        break;
      }
      case "home":
        break;
    }
  }
  function go(next, opts = {}) {
    if (!panelOpen)
      setPanelOpen(true);
    else if (isPhone() && sheetName === "peek" && next.kind !== "home")
      setSheet("half");
    if (!sameView(view, next)) {
      const sameRoad = view.kind === "road" && next.kind === "road" && view.id === next.id;
      const bothHome = view.kind === "home" && next.kind === "home";
      if (opts.push !== false && !sameRoad && !bothHome)
        stack.push(view);
      if (stack.length > 40)
        stack.shift();
    }
    view = next;
    applyView(view, opts.fly !== false);
  }
  function back() {
    const prev = stack.pop();
    if (!prev)
      return;
    view = prev;
    applyView(view, true);
  }
  function closePanel() {
    stack.length = 0;
    view = { kind: "home", tab: "lands" };
    applyView(view, false);
    setPanelOpen(false);
    dropSentinel();
  }
  var lastHit = null;
  function onHover(sx, sy) {
    const st = scene.state;
    const hit = sy === null ? null : scene.hitTest(sx, sy);
    const key = hit ? `${hit.kind}:${hit.id}` : null;
    if (key !== lastHit) {
      lastHit = key;
      st.hoverNote = hit?.kind === "note" ? hit.id : null;
      st.hoverRegion = hit?.kind === "seal" || hit?.kind === "region" ? hit.id : null;
      st.hoverFrontier = hit?.kind === "frontier" ? hit.id : null;
      st.hoverBridge = hit?.kind === "bridge" ? hit.id : null;
      canvas.classList.toggle("is-pointing", hit !== null);
      dirty = true;
    }
    if (!hit || sy === null || isPhone()) {
      tooltip.hidden = true;
      return;
    }
    const lines = describe(hit);
    tooltip.replaceChildren(lines.title, ...lines.sub ? [Object.assign(document.createElement("small"), { textContent: lines.sub })] : []);
    tooltip.hidden = false;
    const x = Math.min(sx + 16, window.innerWidth - 300);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${Math.min(sy + 18, window.innerHeight - 70)}px`;
  }
  function describe(hit) {
    switch (hit.kind) {
      case "note": {
        const n = model.notes.get(hit.id);
        return { title: n.title, sub: model.regions.get(n.regionId).name };
      }
      case "seal":
      case "region": {
        const r = model.regions.get(hit.id);
        return { title: r.name, sub: `${r.npc.name}, ${r.npc.epithet}` };
      }
      case "realm": {
        const r = model.realms.get(hit.id);
        return { title: r.fantasyName, sub: r.name };
      }
      case "frontier":
        return { title: model.frontiers.get(hit.id).title, sub: "Unmapped waters" };
      case "bridge": {
        const b = model.bridgesById.get(hit.id);
        const n = (id) => model.regions.get(id).name;
        return { title: `${n(b.a)} ↔ ${n(b.b)}`, sub: `Bridge · ${b.count} links cross here` };
      }
    }
  }
  function onTap(sx, sy) {
    const hit = scene.hitTest(sx, sy);
    if (!hit) {
      if (panelOpen && view.kind !== "home")
        go({ kind: "home", tab: "lands" }, { fly: false, push: false });
      return;
    }
    if (hit.kind === "note")
      go({ kind: "note", id: hit.id });
    else if (hit.kind === "seal" || hit.kind === "region")
      go({ kind: "region", id: hit.id });
    else if (hit.kind === "realm")
      go({ kind: "realm", id: hit.id });
    else if (hit.kind === "bridge")
      go({ kind: "bridge", id: hit.id });
    else
      go({ kind: "frontier", id: hit.id });
  }
  attachInput(canvas, camera, {
    onTap,
    onHover,
    onDoubleTap: (sx, sy) => camera.zoomToward(sx, sy, 2.2)
  });
  document.getElementById("zoom-in").addEventListener("click", () => camera.zoomCentre(1.6));
  document.getElementById("zoom-out").addEventListener("click", () => camera.zoomCentre(1 / 1.6));
  document.getElementById("refresh").addEventListener("click", (e) => void refreshApp(e.currentTarget));
  document.getElementById("zoom-home").addEventListener("click", () => camera.flyTo(camera.homeView(), 900));
  document.getElementById("menu").addEventListener("click", () => panelOpen ? closePanel() : go({ kind: "home", tab: "lands" }, { fly: false }));
  var searchInput = document.getElementById("search");
  var search = new Search(searchInput, document.getElementById("results"), model, (v) => go(v));
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape")
      return;
    if (search.isOpen())
      return search.hide();
    if (panelOpen && stack.length)
      return back();
    if (panelOpen)
      closePanel();
  });
  window.addEventListener("resize", () => {
    syncTopInset();
    scene.resize();
    updateInsets();
  });
  initInstall(document.getElementById("install"));
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  var topbar = document.querySelector(".topbar");
  var syncTopInset = () => camera.insetTop = topbar.offsetHeight;
  syncTopInset();
  scene.resize();
  var start = hashToView(location.hash);
  if (start) {
    go(start, { push: false, fly: false });
    applyView(start, true);
    camera.tick(performance.now() + 5000);
  } else {
    if (!isPhone())
      go({ kind: "home", tab: "lands" }, { fly: false, push: false });
    camera.flyTo(camera.homeView(), 0);
  }
  var redraw = () => dirty = true;
  document.fonts?.ready.then(redraw);
  document.fonts?.load('700 20px "Cinzel"').then(redraw);
  document.fonts?.load('16px "IM Fell English"').then(redraw);
  function frame(now) {
    if (camera.animating) {
      camera.tick(now);
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      scene.draw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.atlas = { model, camera, scene };
})();
