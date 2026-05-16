// Canvas renderer — Mini Motorways-inspired clean 2D style

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
  }

  draw(network, simulation, gameMode, selection) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background — warm light terrain
    ctx.fillStyle = CONFIG.C.BG;
    ctx.fillRect(0, 0, W, H);

    this._drawGrid(W, H);

    // Edges — ground first, then bridges on top
    const edges = [...network.edges.values()];
    const groundEdges = edges.filter(e => e.elevation === 0);
    const bridgeEdges = edges.filter(e => e.elevation === 1);

    groundEdges.forEach(e => this._drawEdge(ctx, e, simulation, selection));

    bridgeEdges.forEach(e => this._drawBridgeShadow(ctx, e));
    bridgeEdges.forEach(e => this._drawEdge(ctx, e, simulation, selection, true));

    // Non-terminal nodes (intersections) — drawn on top of roads
    network.nodes.forEach(n => {
      if (n.type !== 'terminal') this._drawNode(ctx, n, network, selection);
    });

    // Terminal destination markers
    network.nodes.forEach(n => {
      if (n.type === 'terminal') this._drawTerminalMarker(ctx, n);
    });

    // Cars — sorted so bridge cars render above ground cars
    if (simulation) {
      const sorted = [...simulation.cars].sort((a, b) => {
        const ea = network.edges.get(a.edgeId);
        const eb = network.edges.get(b.edgeId);
        return (ea ? ea.elevation : 0) - (eb ? eb.elevation : 0);
      });
      sorted.forEach(car => this._drawCar(ctx, car, network));
    }

    // Selection overlay
    if (selection) this._drawSelection(ctx, selection, network);

    // Mode badge
    this._drawModeBadge(ctx, gameMode, W);

    // Destination arc gauges — drawn last so always on top
    this._drawAllDestGauges(ctx, network, simulation, W, H);
  }

  _drawGrid(W, H) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x <= W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  _drawEdge(ctx, edge, sim, selection, isBridge = false) {
    const { from, angle, length, lanesForward, lanesBackward } = edge;
    const totalLanes = lanesForward + lanesBackward;
    const roadWidth  = totalLanes * CONFIG.LANE_WIDTH;
    const fullWidth  = roadWidth + CONFIG.SHOULDER_WIDTH * 2;

    ctx.save();
    ctx.translate(from.x, from.y);
    ctx.rotate(angle);

    // Road surface
    ctx.fillStyle = isBridge ? CONFIG.C.BRIDGE_SURFACE : CONFIG.C.ROAD;
    this._roundRect(ctx, 0, -fullWidth / 2, length, fullWidth, isBridge ? 3 : 0);
    ctx.fill();

    // Congestion overlay
    if (sim) {
      const cong = sim.edgeCongestion(edge.id);
      if (cong > 0.3) {
        ctx.fillStyle = CONFIG.C.CONGESTION;
        ctx.globalAlpha = Math.min(1, (cong - 0.3) / 0.7);
        ctx.fillRect(0, -fullWidth / 2, length, fullWidth);
        ctx.globalAlpha = 1;
      }
    }

    // Outer edge lines
    const lineColor = isBridge ? CONFIG.C.BRIDGE_RAIL : CONFIG.C.EDGE_LINE;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -fullWidth / 2); ctx.lineTo(length, -fullWidth / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,  fullWidth / 2); ctx.lineTo(length,  fullWidth / 2); ctx.stroke();

    // Centre line (yellow dashed)
    ctx.strokeStyle = CONFIG.C.CENTER_LINE;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([18, 12]);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Internal lane lines — direction depends on drive side
    // keep-right: forward lanes at +Y; keep-left: forward lanes at −Y
    const fwdSign = CONFIG.DRIVE_SIDE === 'right' ? 1 : -1;
    ctx.strokeStyle = CONFIG.C.LANE_LINE;
    ctx.lineWidth   = 1;
    ctx.setLineDash([12, 16]);
    for (let i = 1; i < lanesForward; i++) {
      const y = fwdSign * i * CONFIG.LANE_WIDTH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(length, y); ctx.stroke();
    }
    for (let i = 1; i < lanesBackward; i++) {
      const y = -fwdSign * i * CONFIG.LANE_WIDTH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(length, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.restore();
  }

  _drawBridgeShadow(ctx, edge) {
    const { from, angle, length } = edge;
    const fullWidth = edge.totalLanes * CONFIG.LANE_WIDTH + CONFIG.SHOULDER_WIDTH * 2;

    ctx.save();
    ctx.translate(from.x + 4, from.y + 5);
    ctx.rotate(angle);
    ctx.fillStyle = CONFIG.C.BRIDGE_SHADOW;
    ctx.fillRect(-2, -fullWidth / 2 - 2, length + 4, fullWidth + 4);
    ctx.restore();
  }

  _drawNode(ctx, node, network, selection) {
    if (node.type === 'roundabout') {
      this._drawRoundabout(ctx, node);
    } else {
      this._drawIntersectionBlank(ctx, node, network);
    }
    if (node.type === 'signal') {
      this._drawSignals(ctx, node, network);
    }
  }

  _drawIntersectionBlank(ctx, node, network) {
    const connectedEdges = node.edges;
    if (connectedEdges.length < 2) return;

    let maxHalf = 0;
    connectedEdges.forEach(e => { if (e.halfWidth > maxHalf) maxHalf = e.halfWidth; });

    ctx.fillStyle = CONFIG.C.ROAD;
    ctx.beginPath();
    ctx.arc(node.x, node.y, maxHalf, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawRoundabout(ctx, node) {
    const r = 32;
    const roadW = 12;

    ctx.fillStyle = CONFIG.C.RA_RING;
    ctx.beginPath(); ctx.arc(node.x, node.y, r + roadW, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = CONFIG.C.RA_CENTER;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = CONFIG.C.RA_MARKING;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(node.x, node.y, r,        0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(node.x, node.y, r + roadW, 0, Math.PI * 2); ctx.stroke();

    node.edges.forEach(edge => {
      const toNode   = edge.to === node;
      const angle    = toNode ? edge.angle + Math.PI : edge.angle;
      const gapStart = r + roadW + 4;
      const gapEnd   = gapStart + 10;
      ctx.strokeStyle = CONFIG.C.RA_MARKING;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(node.x + Math.cos(angle) * gapStart, node.y + Math.sin(angle) * gapStart);
      ctx.lineTo(node.x + Math.cos(angle) * gapEnd,   node.y + Math.sin(angle) * gapEnd);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  _drawSignals(ctx, node, network) {
    node.edges.forEach(edge => {
      const isTo     = edge.to === node;
      const arrAngle  = isTo ? edge.angle + Math.PI : edge.angle;
      const perpAngle = arrAngle + Math.PI / 2;

      const dist = 28;
      const hx = node.x + Math.cos(arrAngle) * dist;
      const hy = node.y + Math.sin(arrAngle) * dist;
      const side = 10;
      const sx = hx + Math.cos(perpAngle) * side;
      const sy = hy + Math.sin(perpAngle) * side;

      const phase   = approachPhase(edge, !isTo);
      const isGreen  = node.signalPhase === phase && node.signalState === 'green';
      const isYellow = node.signalState === 'yellow';

      const r = 5;
      ctx.fillStyle = CONFIG.C.SIG_HOUSING;
      this._roundRect(ctx, sx - r - 2, sy - r * 3 - 4, r * 2 + 4, r * 6 + 8, 3);
      ctx.fill();

      ctx.fillStyle = (!isGreen && !isYellow) ? CONFIG.C.SIG_RED : CONFIG.C.SIG_OFF;
      ctx.beginPath(); ctx.arc(sx, sy - r - 2, r - 1, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = isYellow ? CONFIG.C.SIG_YELLOW : CONFIG.C.SIG_OFF;
      ctx.beginPath(); ctx.arc(sx, sy, r - 1, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = isGreen ? CONFIG.C.SIG_GREEN : CONFIG.C.SIG_OFF;
      ctx.beginPath(); ctx.arc(sx, sy + r + 2, r - 1, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Coloured circle at each terminal — destination identity marker on the road
  _drawTerminalMarker(ctx, node) {
    if (!node.color) return;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  _drawCar(ctx, car, network) {
    if (car.state === 'done') return;

    let pos;
    if (car.raTransit) {
      const frac = car.raTransit.duration > 0
        ? Math.min(1, car.raTransit.t / car.raTransit.duration) : 1;
      const a = car.raTransit.startA + car.raTransit.sweep * frac;
      // Spiral: radius interpolates from stop position (startR) to lane exit (endR)
      const r = car.raTransit.startR + frac * (car.raTransit.endR - car.raTransit.startR);
      pos = {
        x: car.raTransit.cx + r * Math.cos(a),
        y: car.raTransit.cy + r * Math.sin(a),
        angle: a + (car.raTransit.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2),
      };
    } else {
      const edge = network.edges.get(car.edgeId);
      if (!edge) return;
      const lanes = car.fwd ? edge.lanesForward : edge.lanesBackward;
      const lane  = Math.min(car.lane, Math.max(0, lanes - 1));
      pos = edge.carPosition(car.progress, car.fwd, lane);
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(pos.angle);

    const L = CONFIG.CAR_LENGTH;
    const W = CONFIG.CAR_WIDTH;
    const r = 2;

    ctx.fillStyle = car.state === 'waiting' && car.waitTime > 2
      ? this._darken(car.color, 0.6)
      : car.color;
    this._roundRect(ctx, -L / 2, -W / 2, L, W, r);
    ctx.fill();

    // Windscreen glint
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this._roundRect(ctx, L / 2 - 4, -W / 2 + 1.5, 3, W - 3, 1);
    ctx.fill();

    ctx.restore();
  }

  _drawSelection(ctx, selection, network) {
    if (selection.type === 'edge') {
      const edge = network.edges.get(selection.id);
      if (!edge) return;
      const fullWidth = edge.totalLanes * CONFIG.LANE_WIDTH + CONFIG.SHOULDER_WIDTH * 2;

      ctx.save();
      ctx.translate(edge.from.x, edge.from.y);
      ctx.rotate(edge.angle);
      ctx.strokeStyle = CONFIG.C.SELECTION_STROKE;
      ctx.lineWidth   = 3;
      ctx.strokeRect(-2, -fullWidth / 2 - 2, edge.length + 4, fullWidth + 4);
      ctx.restore();

    } else if (selection.type === 'node') {
      const node = network.nodes.get(selection.id);
      if (!node) return;
      ctx.strokeStyle = CONFIG.C.SELECTION_STROKE;
      ctx.fillStyle   = CONFIG.C.SELECTION_FILL;
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawModeBadge(ctx, mode, W) {
    const label   = mode === 'simulate' ? '▶  SIMULATING' : '✏   EDIT MODE';
    const bgColor = mode === 'simulate' ? 'rgba(0,184,148,0.85)' : 'rgba(116,185,255,0.85)';
    ctx.font = 'bold 12px system-ui, sans-serif';
    const tw  = ctx.measureText(label).width;
    const pad = 10;
    const bx  = W - tw - pad * 2 - 12;
    const by  = 12;
    ctx.fillStyle = bgColor;
    this._roundRect(ctx, bx, by, tw + pad * 2, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + pad, by + 17);
  }

  // ── Destination arc gauges ────────────────────────────────────────────────
  // Small arc gauge near each terminal, outside the road network.
  // Arc: 7 o'clock (0%) → clockwise → 5 o'clock (100%) = 300° sweep.
  _drawAllDestGauges(ctx, network, simulation, W, H) {
    const R   = 15;  // radius to stroke centre
    const LW  = 5;   // stroke width
    const PAD = R + LW + 2;

    const START = 2 * Math.PI / 3;  // 120° = 7 o'clock
    const SWEEP = 5 * Math.PI / 3;  // 300°

    const MAX_COUNT = 20; // cars at this count = full arc

    network.nodes.forEach(n => {
      if (n.type !== 'terminal' || !n.color) return;

      // Direction outward from the network (opposite of the connected edge)
      const edge = n.edges[0];
      if (!edge) return;
      const intoX = (edge.to === n ? edge.from.x : edge.to.x) - n.x;
      const intoY = (edge.to === n ? edge.from.y : edge.to.y) - n.y;
      const ilen  = Math.hypot(intoX, intoY) || 1;
      const outX  = -intoX / ilen;
      const outY  = -intoY / ilen;

      // Gauge centre — offset outward from terminal, clamped inside canvas
      const OFFSET = R + LW + 10;
      const gx = Math.round(Math.max(PAD, Math.min(W - PAD, n.x + outX * OFFSET)));
      const gy = Math.round(Math.max(PAD, Math.min(H - PAD, n.y + outY * OFFSET)));

      // Active car count for this destination
      const count = simulation
        ? simulation.cars.filter(c => c.destNodeId === n.id && c.state !== 'done').length
        : 0;
      const value = Math.min(1, count / MAX_COUNT);

      // Background disc — makes count text readable over anything
      ctx.beginPath();
      ctx.arc(gx, gy, R - LW / 2 + 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(229,223,215,0.93)';
      ctx.fill();

      // Track arc (full 300°, muted)
      ctx.beginPath();
      ctx.arc(gx, gy, R, START, START + SWEEP, false);
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth   = LW;
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Value arc (destination colour)
      if (value > 0.01) {
        ctx.beginPath();
        ctx.arc(gx, gy, R, START, START + SWEEP * value, false);
        ctx.strokeStyle = n.color;
        ctx.lineWidth   = LW;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }

      // Centre count label
      ctx.fillStyle    = 'rgba(0,0,0,0.72)';
      ctx.font         = 'bold 9px system-ui, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), gx, gy);
    });

    // Restore defaults
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  _roundRect(ctx, x, y, w, h, r) {
    if (r === 0) { ctx.rect(x, y, w, h); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _darken(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8)  & 255) * factor);
    const b = Math.round(( n        & 255) * factor);
    return `rgb(${r},${g},${b})`;
  }

  // Hit testing helpers (world coords)
  hitTestEdge(x, y, network) {
    let best = null, bestDist = CONFIG.EDGE_HIT_DIST;
    network.edges.forEach(edge => {
      const d = this._pointToSegmentDist(x, y,
        edge.from.x, edge.from.y, edge.to.x, edge.to.y);
      if (d < bestDist) { bestDist = d; best = edge; }
    });
    return best;
  }

  hitTestNode(x, y, network) {
    let best = null, bestDist = CONFIG.NODE_HIT_RADIUS;
    network.nodes.forEach(node => {
      if (node.type === 'terminal') return;
      const d = Math.hypot(x - node.x, y - node.y);
      if (d < bestDist) { bestDist = d; best = node; }
    });
    return best;
  }

  _pointToSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
}
