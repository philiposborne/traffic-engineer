// Traffic simulation: agent-based cars moving through the road network

const MAX_CARS = 120;

class Car {
  constructor(id, route) {
    this.id    = id;
    this.route = route;       // [{id: edgeId, fwd: bool}]
    this.routeIdx = 0;

    this.progress = 0.0;      // 0→1 along current edge
    this.speed    = 0;
    this.lane     = 0;        // lane index within direction

    this.state    = 'moving'; // 'moving' | 'waiting' | 'roundabout' | 'done'
    this.waitTime = 0;
    this.travelTime = 0;

    this.destNodeId = null;
    this.color = CONFIG.C.CARS[id % CONFIG.C.CARS.length];

    // Set while car arcs around a roundabout ring
    this.raTransit = null; // {cx, cy, r, startA, sweep, t, duration}
  }

  get step()  { return this.route[this.routeIdx]; }
  get edgeId(){ return this.step.id; }
  get fwd()   { return this.step.fwd; }
}

class TrafficSimulation {
  constructor(network, demands) {
    this.network  = network;
    this.demands  = demands;
    this.cars     = [];
    this.simTime  = 0;
    this._nextId  = 0;

    this._spawnTimers = demands.map(() => Math.random());
    this._completedLog = []; // [{t, wait}]
  }

  reset() {
    this.cars     = [];
    this.simTime  = 0;
    this._nextId  = 0;
    this._spawnTimers = this.demands.map(() => Math.random());
    this._completedLog = [];
    this.network.nodes.forEach(n => {
      n.signalTimer = 0; n.signalPhase = 0; n.signalState = 'green';
      n.basicTimer  = 0; n.basicPhase  = 0;
      n.transitQueue = [];
      n.lastExitTime = {};
    });
  }

  update(dt) {
    this.simTime += dt;

    this.network.nodes.forEach(n => n.update(dt));

    for (const car of this.cars) {
      if (car.state === 'done') continue;
      car.travelTime += dt;
      if (car.state === 'waiting') car.waitTime += dt;
      this._updateCar(car, dt);
    }

    this._spawnCars(dt);
    this.cars = this.cars.filter(c => c.state !== 'done');
  }

  _updateCar(car, dt) {
    // Roundabout ring transit — car arcs around the ring visually
    if (car.state === 'roundabout') {
      if (car.raTransit.t < car.raTransit.duration) car.raTransit.t += dt;

      if (car.raTransit.t >= car.raTransit.duration) {
        // Arc complete — try to step onto the exit road.
        // If the exit is jammed, freeze at the ring exit point (still counted
        // as onRing) so pressure backs up onto the approach roads.
        const edge = this.network.edges.get(car.edgeId);
        if (!edge) { car.raTransit = null; car.state = 'done'; return; }

        const exitP  = Math.min(0.4, CONFIG.RA_RING_RADIUS / edge.length);
        const blockP = exitP + (CONFIG.MIN_GAP + CONFIG.CAR_LENGTH) / edge.length;
        let hasRoom  = true;
        for (const other of this.cars) {
          if (other === car || other.state === 'done' || other.raTransit) continue;
          if (other.edgeId === edge.id && other.fwd === car.fwd && other.progress < blockP) {
            hasRoom = false; break;
          }
        }
        if (hasRoom) {
          const lanes = car.fwd ? edge.lanesForward : edge.lanesBackward;
          car.lane = car.id % Math.max(1, lanes);
          car.progress = exitP;
          car.raTransit = null;
          car.state = 'moving';
        }
        // else: stay frozen at arc endpoint; onRing count keeps new cars out
      }
      return;
    }

    const edge = this.network.edges.get(car.edgeId);
    if (!edge) { car.state = 'done'; return; }

    const stopAt = this._getStopProgress(edge, car.fwd);

    if (car.state === 'moving') {
      let minGap = Infinity;
      const myDist = car.progress * edge.length;

      for (const other of this.cars) {
        if (other === car || other.state === 'done' || other.raTransit) continue;
        if (other.edgeId !== car.edgeId || other.fwd !== car.fwd) continue;
        const otherDist = other.progress * edge.length;
        const gap = (other.fwd ? otherDist - myDist : myDist - otherDist);
        if (gap > 0 && gap < minGap) minGap = gap;
      }

      let desired = CONFIG.MAX_SPEED;
      if (minGap < CONFIG.FOLLOW_DISTANCE) {
        desired = CONFIG.MAX_SPEED * Math.max(0, (minGap - CONFIG.MIN_GAP) / (CONFIG.FOLLOW_DISTANCE - CONFIG.MIN_GAP));
      }
      car.speed = desired;
      car.progress += (car.speed * dt) / edge.length;

      if (car.progress >= stopAt) {
        car.progress = stopAt;
        car.state = 'waiting';
      }

    } else if (car.state === 'waiting') {
      const destNode = car.fwd ? edge.to : edge.from;

      if (destNode.type === 'terminal') {
        this._advanceCar(car, edge, destNode);
        return;
      }

      if (this._hasPermission(car, edge, destNode)) {
        this._grantPermission(car, edge, destNode);
        if (destNode.type === 'roundabout') {
          this._startRoundaboutTransit(car, destNode, edge, car.fwd);
        } else {
          this._advanceCar(car, edge, destNode);
        }
      }
    }
  }

  // Progress value at which a car stops to wait for its destination node
  _getStopProgress(edge, forward) {
    const destNode = forward ? edge.to : edge.from;
    if (destNode.type === 'terminal') return 1.0;

    if (destNode.type === 'roundabout') {
      const stopDist = CONFIG.RA_OUTER_STOP;
      return Math.max(0.5, Math.min(0.97, (edge.length - stopDist) / edge.length));
    }

    let maxHalf = 0;
    destNode.edges.forEach(e => { if (e.halfWidth > maxHalf) maxHalf = e.halfWidth; });
    // Car front = centre − CAR_LENGTH/2.  Add half-car-length so the front
    // sits at the stop line rather than past it.
    // Signal nodes: stop line is just behind the signal head (drawn at 28 px).
    const stopDist = destNode.type === 'signal'
      ? Math.max(maxHalf + 2, 36)
      : maxHalf + 8;

    return Math.max(0.5, Math.min(0.97, (edge.length - stopDist) / edge.length));
  }

  // Begin arcing a car around the roundabout ring from its entry point to its exit point
  _startRoundaboutTransit(car, roundaboutNode, currentEdge, currentFwd) {
    if (car.routeIdx + 1 >= car.route.length) {
      this._completedLog.push({ t: this.simTime, wait: car.waitTime });
      car.state = 'done';
      return;
    }

    const RA_R = CONFIG.RA_RING_RADIUS;

    // Outward angle from roundabout centre toward the approach road
    const entryAngle = currentFwd
      ? currentEdge.angle + Math.PI   // edge.to = roundabout
      : currentEdge.angle;             // edge.from = roundabout

    // Advance to the exit edge
    car.routeIdx++;
    car.progress = 0.0;

    const nextStep = car.route[car.routeIdx];
    const nextEdge = this.network.edges.get(nextStep.id);
    if (!nextEdge) { car.state = 'done'; return; }

    // Outward angle from roundabout centre toward the exit road
    const exitAngle = nextStep.fwd
      ? nextEdge.angle                 // nextEdge.from = roundabout
      : nextEdge.angle + Math.PI;      // nextEdge.to = roundabout

    // Canvas Y-down: clockwise on screen = increasing angle (positive sweep).
    // LHD (UK) roundabouts circulate clockwise on screen.
    // RHD (US/EU) roundabouts circulate counterclockwise on screen.
    const cwCanvas = CONFIG.DRIVE_SIDE === 'left';
    let sweep;
    if (cwCanvas) {
      sweep = ((exitAngle - entryAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep < 0.01) sweep += 2 * Math.PI;
    } else {
      sweep = -(((entryAngle - exitAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
      if (Math.abs(sweep) < 0.01) sweep -= 2 * Math.PI;
    }

    const arcLen  = Math.abs(sweep) * RA_R;
    const duration = arcLen / (CONFIG.MAX_SPEED * 0.55);

    car.raTransit = {
      cx: roundaboutNode.x,
      cy: roundaboutNode.y,
      r:  RA_R,
      startA: entryAngle,
      sweep,
      t:  0,
      duration,
    };
    car.state = 'roundabout';
  }

  _hasPermission(car, edge, node) {
    const key = `${car.edgeId}_${car.fwd}`;
    const slotFree = this.simTime >= (node.lastExitTime[key] || 0);
    if (!slotFree) return false;

    // Check next edge has room; skip cars currently on a roundabout ring.
    // Roundabout exits land cars at RA_RING_RADIUS from the node, so the
    // blocking zone must extend to cover that landing position.
    if (car.routeIdx + 1 < car.route.length) {
      const nextStep = car.route[car.routeIdx + 1];
      const nextEdge = this.network.edges.get(nextStep.id);
      if (!nextEdge) return false;
      const entryDist = node.type === 'roundabout' ? CONFIG.RA_RING_RADIUS : 0;
      const blockProg = (entryDist + CONFIG.MIN_GAP + CONFIG.CAR_LENGTH) / nextEdge.length;
      for (const other of this.cars) {
        if (other === car || other.state === 'done' || other.raTransit) continue;
        if (other.edgeId === nextStep.id && other.fwd === nextStep.fwd && other.progress < blockProg) return false;
      }
    }

    const phase = approachPhase(edge, car.fwd);

    if (node.type === 'basic')  return node.basicPhase === phase;
    if (node.type === 'signal') {
      if (node.signalState !== 'green') return false;
      return node.signalPhase === phase;
    }
    if (node.type === 'roundabout') {
      const onRing = this.cars.filter(c =>
        c.raTransit && c.raTransit.cx === node.x && c.raTransit.cy === node.y
      ).length;
      return onRing < CONFIG.ROUNDABOUT_CAPACITY;
    }

    return true;
  }

  _grantPermission(car, edge, node) {
    const key = `${car.edgeId}_${car.fwd}`;
    let transitTime;
    switch (node.type) {
      case 'signal':     transitTime = CONFIG.SIGNAL_TRANSIT;     break;
      case 'roundabout': transitTime = CONFIG.ROUNDABOUT_TRANSIT; break;
      default:           transitTime = CONFIG.BASIC_TRANSIT;
    }
    node.lastExitTime[key] = this.simTime + transitTime;
    // Roundabout capacity now tracked via car.raTransit; transitQueue no longer used
  }

  _advanceCar(car, edge, destNode) {
    if (car.routeIdx + 1 >= car.route.length) {
      this._completedLog.push({ t: this.simTime, wait: car.waitTime });
      car.state = 'done';
      return;
    }
    car.routeIdx++;
    car.progress = 0.0;
    car.state    = 'moving';

    const nextEdge = this.network.edges.get(car.edgeId);
    if (nextEdge) {
      const lanes = car.fwd ? nextEdge.lanesForward : nextEdge.lanesBackward;
      car.lane = car.id % Math.max(1, lanes);
    }
  }

  _spawnCars(dt) {
    if (this.cars.length >= MAX_CARS) return;

    this.demands.forEach((demand, i) => {
      this._spawnTimers[i] -= dt;
      if (this._spawnTimers[i] <= 0) {
        this._spawnTimers[i] += 1 / demand.rate;
        if (this.cars.length < MAX_CARS) this._spawnOne(demand);
      }
    });
  }

  _spawnOne(demand) {
    const firstStep = demand.route[0];
    const edge = this.network.edges.get(firstStep.id);
    if (!edge) return;

    // Don't spawn if origin is jammed (skip cars in roundabout transit)
    for (const c of this.cars) {
      if (c.edgeId === firstStep.id && c.fwd === firstStep.fwd && c.progress < 0.05 && !c.raTransit) return;
    }

    const car = new Car(this._nextId++, demand.route.map(s => ({ ...s })));

    const lanes = firstStep.fwd ? edge.lanesForward : edge.lanesBackward;
    car.lane = car.id % Math.max(1, lanes);

    const lastStep = demand.route[demand.route.length - 1];
    const lastEdge = this.network.edges.get(lastStep.id);
    if (lastEdge) {
      const destNode = lastStep.fwd ? lastEdge.to : lastEdge.from;
      car.destNodeId = destNode.id;
      car.color = destNode.color || CONFIG.C.CARS[car.id % CONFIG.C.CARS.length];
    }

    this.cars.push(car);
  }

  // --- Stats ---
  getStats() {
    const now = this.simTime;
    const window = 60;

    const recent = this._completedLog.filter(e => now - e.t < window);
    const throughput = recent.length;

    const avgWait = recent.length > 0
      ? recent.reduce((s, e) => s + e.wait, 0) / recent.length
      : 0;

    const active  = this.cars.filter(c => c.state !== 'done').length;
    const waiting = this.cars.filter(c => c.state === 'waiting').length;
    const congestion = active > 0 ? waiting / active : 0;

    const score = this._calcScore(throughput, avgWait, congestion);

    const destCounts = {};
    this.cars.forEach(c => {
      if (c.state !== 'done' && c.destNodeId !== null) {
        destCounts[c.destNodeId] = (destCounts[c.destNodeId] || 0) + 1;
      }
    });

    return { throughput, avgWait, congestion, score, carCount: active, destCounts };
  }

  _calcScore(throughput, avgWait, congestion) {
    const tScore = Math.min(100, (throughput / 60) * 100);
    const wScore = Math.max(0, 100 - (avgWait / 0.5));
    const cScore = Math.max(0, 100 - congestion * 150);
    return Math.round((tScore * 0.4 + wScore * 0.35 + cScore * 0.25));
  }

  // Per-edge congestion 0→1 for rendering (excludes cars on roundabout ring)
  edgeCongestion(edgeId) {
    const e = this.network.edges.get(edgeId);
    if (!e) return 0;
    const cars = this.cars.filter(c => c.edgeId === edgeId && !c.raTransit).length;
    const cap  = (e.lanesForward + e.lanesBackward) * 4;
    return Math.min(1, cars / cap);
  }
}
