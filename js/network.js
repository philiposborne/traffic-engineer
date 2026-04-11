// Road network: nodes (intersections) and edges (road segments)

class RoadNode {
  constructor(id, x, y, type = 'basic') {
    this.id = id;
    this.x = x;
    this.y = y;
    this.type = type; // 'basic' | 'signal' | 'roundabout' | 'terminal'

    // Signal state
    this.signalPhase = 0;      // 0 = phase-A green, 1 = phase-B green
    this.signalState = 'green'; // 'green' | 'yellow' | 'red'
    this.signalTimer = 0;

    // Basic intersection
    this.basicPhase = 0;
    this.basicTimer = 0;

    // Roundabout occupancy
    this.transitQueue = []; // [{timeLeft}] — entries decrement to 0 then remove

    // Per-approach last-exit timestamps for transit spacing
    // key: `${edgeId}_${forwardBool}` → simTime when approach slot is next free
    this.lastExitTime = {};

    this.edges = []; // connected RoadEdge refs
  }

  // Advance intersection timers
  update(dt) {
    // Roundabout transit queue
    this.transitQueue = this.transitQueue.filter(e => {
      e.timeLeft -= dt;
      return e.timeLeft > 0;
    });

    if (this.type === 'signal') {
      this.signalTimer += dt;
      if (this.signalState === 'green' && this.signalTimer >= CONFIG.SIGNAL_GREEN) {
        this.signalState = 'yellow';
        this.signalTimer = 0;
      } else if (this.signalState === 'yellow' && this.signalTimer >= CONFIG.SIGNAL_YELLOW) {
        this.signalState = 'green';
        this.signalPhase = 1 - this.signalPhase;
        this.signalTimer = 0;
      }
    }

    if (this.type === 'basic') {
      this.basicTimer += dt;
      if (this.basicTimer >= CONFIG.BASIC_PHASE) {
        this.basicPhase = 1 - this.basicPhase;
        this.basicTimer = 0;
      }
    }
  }
}

class RoadEdge {
  constructor(id, fromNode, toNode, lanesForward = 1, lanesBackward = 1, elevation = 0) {
    this.id = id;
    this.from = fromNode;
    this.to = toNode;
    this.lanesForward = lanesForward;
    this.lanesBackward = lanesBackward;
    this.elevation = elevation; // 0=ground, 1=bridge

    this.length = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y);
    this.angle  = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
  }

  get totalLanes() { return this.lanesForward + this.lanesBackward; }

  // Visual half-width
  get halfWidth() {
    return (this.totalLanes * CONFIG.LANE_WIDTH) / 2 + CONFIG.SHOULDER_WIDTH;
  }

  // World position of a car: progress 0→1 (from its start), direction, lane index
  carPosition(progress, forward, laneIndex) {
    // In local road coords (origin = this.from, x-axis = this.angle):
    // Forward cars travel from x=0 to x=length (localX = progress * length)
    // Backward cars travel from x=length to x=0  (localX = (1-progress) * length)
    const localX = forward ? progress * this.length : (1 - progress) * this.length;

    // Lateral offset from visual centre of road:
    // Forward lanes sit on the positive-y side (right of road, right-hand traffic)
    // Backward lanes sit on the negative-y side
    const laneCenter = (laneIndex + 0.5) * CONFIG.LANE_WIDTH;
    const localY = forward ? laneCenter : -laneCenter;

    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    return {
      x: this.from.x + localX * cosA - localY * sinA,
      y: this.from.y + localX * sinA + localY * cosA,
      angle: forward ? this.angle : this.angle + Math.PI,
    };
  }
}

class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this._nid = 0;
    this._eid = 0;
  }

  addNode(x, y, type = 'basic') {
    const n = new RoadNode(this._nid++, x, y, type);
    this.nodes.set(n.id, n);
    return n;
  }

  addEdge(fromId, toId, lanesForward = 1, lanesBackward = 1, elevation = 0) {
    const from = this.nodes.get(fromId);
    const to   = this.nodes.get(toId);
    if (!from || !to) throw new Error(`addEdge: bad node ids ${fromId} ${toId}`);
    const e = new RoadEdge(this._eid++, from, to, lanesForward, lanesBackward, elevation);
    this.edges.set(e.id, e);
    from.edges.push(e);
    to.edges.push(e);
    return e;
  }

  removeEdge(edgeId) {
    const e = this.edges.get(edgeId);
    if (!e) return;
    e.from.edges = e.from.edges.filter(x => x.id !== edgeId);
    e.to.edges   = e.to.edges.filter(x => x.id !== edgeId);
    this.edges.delete(edgeId);
  }

  // Serialize for reset
  snapshot() {
    const ns = [...this.nodes.values()].map(n => ({
      id: n.id, x: n.x, y: n.y, type: n.type
    }));
    const es = [...this.edges.values()].map(e => ({
      id: e.id, fromId: e.from.id, toId: e.to.id,
      lanesForward: e.lanesForward, lanesBackward: e.lanesBackward,
      elevation: e.elevation
    }));
    return { ns, es, nid: this._nid, eid: this._eid };
  }

  restoreSnapshot(snap) {
    this.nodes.clear();
    this.edges.clear();
    this._nid = snap.nid;
    this._eid = snap.eid;
    snap.ns.forEach(n => {
      const node = new RoadNode(n.id, n.x, n.y, n.type);
      this.nodes.set(n.id, node);
    });
    snap.es.forEach(e => {
      const from = this.nodes.get(e.fromId);
      const to   = this.nodes.get(e.toId);
      const edge = new RoadEdge(e.id, from, to, e.lanesForward, e.lanesBackward, e.elevation);
      this.edges.set(e.id, edge);
      from.edges.push(edge);
      to.edges.push(edge);
    });
  }
}

// Helper: determine if an approach to a node is "phase A" (roughly horizontal/EW)
// or "phase B" (roughly vertical/NS). Used by basic & signal intersections.
function approachPhase(edge, forward) {
  // Angle of travel when arriving at the destination node
  const arrivalAngle = forward ? edge.angle : edge.angle + Math.PI;
  // Project onto axes; horizontal approaches → phase 0, vertical → phase 1
  return Math.abs(Math.cos(arrivalAngle)) >= Math.abs(Math.sin(arrivalAngle)) ? 0 : 1;
}
