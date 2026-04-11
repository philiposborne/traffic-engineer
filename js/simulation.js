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

    this.state    = 'moving'; // 'moving' | 'waiting' | 'done'
    this.waitTime = 0;
    this.travelTime = 0;

    this.color = CONFIG.C.CARS[id % CONFIG.C.CARS.length];
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

    // Demand spawn timers
    this._spawnTimers = demands.map(() => Math.random()); // stagger initial spawns

    // Stats window
    this._completedLog = []; // [{completionTime, waitTime}]
  }

  reset() {
    this.cars     = [];
    this.simTime  = 0;
    this._nextId  = 0;
    this._spawnTimers = this.demands.map(() => Math.random());
    this._completedLog = [];
    // Reset all node timers
    this.network.nodes.forEach(n => {
      n.signalTimer = 0; n.signalPhase = 0; n.signalState = 'green';
      n.basicTimer  = 0; n.basicPhase  = 0;
      n.transitQueue = [];
      n.lastExitTime = {};
    });
  }

  update(dt) {
    this.simTime += dt;

    // Update intersection timers
    this.network.nodes.forEach(n => n.update(dt));

    // Update cars
    for (const car of this.cars) {
      if (car.state === 'done') continue;
      car.travelTime += dt;
      if (car.state === 'waiting') car.waitTime += dt;
      this._updateCar(car, dt);
    }

    // Spawn new cars
    this._spawnCars(dt);

    // Prune done cars older than a moment
    this.cars = this.cars.filter(c => c.state !== 'done');
  }

  _updateCar(car, dt) {
    const edge = this.network.edges.get(car.edgeId);
    if (!edge) { car.state = 'done'; return; }

    const STOP_AT = 0.97; // progress at which car waits for intersection

    if (car.state === 'moving') {
      // Find nearest car ahead on same edge+direction
      let minGap = Infinity;
      const myDist = car.progress * edge.length;

      for (const other of this.cars) {
        if (other === car || other.state === 'done') continue;
        if (other.edgeId !== car.edgeId || other.fwd !== car.fwd) continue;
        const otherDist = other.progress * edge.length;
        const gap = (other.fwd ? otherDist - myDist : myDist - otherDist);
        if (gap > 0 && gap < minGap) minGap = gap;
      }

      // Speed based on gap
      let desired = CONFIG.MAX_SPEED;
      if (minGap < CONFIG.FOLLOW_DISTANCE) {
        desired = CONFIG.MAX_SPEED * Math.max(0, (minGap - CONFIG.MIN_GAP) / (CONFIG.FOLLOW_DISTANCE - CONFIG.MIN_GAP));
      }
      car.speed = desired;
      car.progress += (car.speed * dt) / edge.length;

      if (car.progress >= STOP_AT) {
        car.progress = STOP_AT;
        car.state = 'waiting';
      }

    } else if (car.state === 'waiting') {
      // Check if we've reached a terminal (just arrived — advance immediately)
      const destNode = car.fwd ? edge.to : edge.from;

      if (destNode.type === 'terminal') {
        this._advanceCar(car, edge, destNode);
        return;
      }

      // Check intersection permission
      if (this._hasPermission(car, edge, destNode)) {
        this._grantPermission(car, edge, destNode);
        this._advanceCar(car, edge, destNode);
      }
    }
  }

  _hasPermission(car, edge, node) {
    const key = `${car.edgeId}_${car.fwd}`;
    const slotFree = this.simTime >= (node.lastExitTime[key] || 0);
    if (!slotFree) return false;

    // Check next edge has room at its start
    if (car.routeIdx + 1 < car.route.length) {
      const nextStep = car.route[car.routeIdx + 1];
      const nextEdge = this.network.edges.get(nextStep.id);
      if (!nextEdge) return false;
      // Check no car parked right at the start of next edge
      for (const other of this.cars) {
        if (other === car || other.state === 'done') continue;
        if (other.edgeId === nextStep.id && other.fwd === nextStep.fwd && other.progress < 0.06) return false;
      }
    }

    const phase = approachPhase(edge, car.fwd);

    if (node.type === 'basic') {
      return node.basicPhase === phase;
    }

    if (node.type === 'signal') {
      if (node.signalState !== 'green') return false;
      return node.signalPhase === phase;
    }

    if (node.type === 'roundabout') {
      return node.transitQueue.length < CONFIG.ROUNDABOUT_CAPACITY;
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
    if (node.type === 'roundabout') {
      node.transitQueue.push({ timeLeft: transitTime * 2 });
    }
  }

  _advanceCar(car, edge, destNode) {
    if (car.routeIdx + 1 >= car.route.length) {
      // Reached destination
      this._completedLog.push({ t: this.simTime, wait: car.waitTime });
      car.state = 'done';
      return;
    }
    car.routeIdx++;
    car.progress = 0.0;
    car.state    = 'moving';

    // Assign lane
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
        if (this.cars.length < MAX_CARS) {
          this._spawnOne(demand);
        }
      }
    });
  }

  _spawnOne(demand) {
    // Check first edge isn't jammed at origin
    const firstStep = demand.route[0];
    const edge = this.network.edges.get(firstStep.id);
    if (!edge) return;
    for (const c of this.cars) {
      if (c.edgeId === firstStep.id && c.fwd === firstStep.fwd && c.progress < 0.05) return;
    }

    const car = new Car(this._nextId++, demand.route.map(s => ({ ...s })));
    // Assign initial lane
    const lanes = firstStep.fwd ? edge.lanesForward : edge.lanesBackward;
    car.lane = car.id % Math.max(1, lanes);
    this.cars.push(car);
  }

  // --- Stats ---
  getStats() {
    const now = this.simTime;
    const window = 60; // sim-seconds

    // Throughput: completions in last 60 sim-seconds
    const recent = this._completedLog.filter(e => now - e.t < window);
    const throughput = recent.length; // per window

    // Average wait time (recent completions)
    const avgWait = recent.length > 0
      ? recent.reduce((s, e) => s + e.wait, 0) / recent.length
      : 0;

    // Congestion: fraction of active cars currently waiting
    const active  = this.cars.filter(c => c.state !== 'done').length;
    const waiting = this.cars.filter(c => c.state === 'waiting').length;
    const congestion = active > 0 ? waiting / active : 0;

    // Score 0-100
    const score = this._calcScore(throughput, avgWait, congestion);

    return { throughput, avgWait, congestion, score, carCount: active };
  }

  _calcScore(throughput, avgWait, congestion) {
    // Normalise: target throughput ≥ 60, avgWait ≤ 5s, congestion ≤ 0.1
    const tScore = Math.min(100, (throughput / 60) * 100);
    const wScore = Math.max(0, 100 - (avgWait / 0.5)); // 0.5 sim-sec = fine
    const cScore = Math.max(0, 100 - congestion * 150);
    return Math.round((tScore * 0.4 + wScore * 0.35 + cScore * 0.25));
  }

  // Per-edge congestion 0→1 for rendering
  edgeCongestion(edgeId) {
    const e = this.network.edges.get(edgeId);
    if (!e) return 0;
    const cars = this.cars.filter(c => c.edgeId === edgeId).length;
    const cap   = (e.lanesForward + e.lanesBackward) * 4;
    return Math.min(1, cars / cap);
  }
}
