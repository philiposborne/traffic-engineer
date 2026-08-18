// Entry point and game loop

let game;

window.addEventListener('DOMContentLoaded', () => {
  game = new Game();
  game.init();
});

class Game {
  init() {
    const canvas = document.getElementById('game-canvas');
    canvas.width  = 800;
    canvas.height = 580;

    const { net, demands } = buildScenario();
    this.network    = net;
    this.demands    = demands;
    this.snapshot   = net.snapshot(); // for reset

    this.simulation = new TrafficSimulation(net, demands);
    this.renderer   = new Renderer(canvas);
    this.tools      = new ToolManager(canvas, this);

    this.mode       = 'edit';
    this.budget     = CONFIG.STARTING_BUDGET;
    this.selection  = null;
    this._lastTs    = null;
    this._msgTimer  = 0;

    this._initUI();
    this._updateBudgetDisplay();
    this._loop(0);
  }

  _loop(ts) {
    requestAnimationFrame(t => this._loop(t));

    const dt = this._lastTs !== null ? Math.min((ts - this._lastTs) / 1000, 0.1) : 0;
    this._lastTs = ts;

    if (this.mode === 'simulate') {
      this.simulation.update(dt * CONFIG.SIM_SPEED);
      this._updateStats();
    }

    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this._hideMessage();
    }

    this.renderer.draw(this.network, this.simulation, this.mode, this.selection);
    this._updateSelectionPanel();
  }

  setSelection(sel) {
    this.selection = sel;
  }

  spendBudget(amount) {
    if (this.budget - amount < 0) return false;
    this.budget -= amount;
    this._updateBudgetDisplay();
    return true;
  }

  showMessage(text) {
    const el = document.getElementById('msg-bar');
    el.textContent = text;
    el.style.display = 'block';
    this._msgTimer = 3;
  }

  _hideMessage() {
    document.getElementById('msg-bar').style.display = 'none';
  }

  _initUI() {
    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.tools.setTool(btn.dataset.tool));
    });

    // Mode buttons
    document.getElementById('btn-simulate').addEventListener('click', () => this._startSimulate());
    document.getElementById('btn-edit').addEventListener('click',     () => this._stopSimulate());
    document.getElementById('btn-reset').addEventListener('click',    () => this._reset());

    // Drive side toggle
    const btnDrive = document.getElementById('btn-drive-side');
    this._updateDriveSideBtn(btnDrive);
    btnDrive.addEventListener('click', () => this._toggleDriveSide());
  }

  _toggleDriveSide() {
    CONFIG.DRIVE_SIDE = CONFIG.DRIVE_SIDE === 'right' ? 'left' : 'right';
    this._updateDriveSideBtn(document.getElementById('btn-drive-side'));
    // Stop simulation and clear cars; road edits are preserved
    this._stopSimulate();
    this.simulation = new TrafficSimulation(this.network, this.demands);
    this.selection  = null;
    this._clearStats();
  }

  _updateDriveSideBtn(btn) {
    btn.textContent = CONFIG.DRIVE_SIDE === 'right' ? '▶ Drive Right' : '◀ Drive Left';
  }

  _startSimulate() {
    this.mode = 'simulate';
    this.simulation.reset();
    document.getElementById('btn-simulate').style.display = 'none';
    document.getElementById('btn-edit').style.display     = 'inline-block';
    document.getElementById('mode-label').textContent     = 'SIMULATING';
    document.getElementById('mode-label').className       = 'mode-sim';
  }

  _stopSimulate() {
    this.mode = 'edit';
    document.getElementById('btn-simulate').style.display = 'inline-block';
    document.getElementById('btn-edit').style.display     = 'none';
    document.getElementById('mode-label').textContent     = 'EDIT MODE';
    document.getElementById('mode-label').className       = 'mode-edit';
  }

  _reset() {
    this._stopSimulate();
    this.network.restoreSnapshot(this.snapshot);
    this.simulation = new TrafficSimulation(this.network, this.demands);
    this.budget     = CONFIG.STARTING_BUDGET;
    this.selection  = null;
    this._updateBudgetDisplay();
    this._clearStats();
  }

  _updateBudgetDisplay() {
    document.getElementById('budget-value').textContent = this.budget;
    document.getElementById('budget-bar-fill').style.width =
      Math.max(0, Math.min(100, (this.budget / CONFIG.STARTING_BUDGET) * 100)) + '%';
  }

  _updateStats() {
    const s = this.simulation.getStats();
    document.getElementById('stat-throughput').textContent = s.throughput + ' /min';
    document.getElementById('stat-wait').textContent       = s.avgWait.toFixed(1) + 's';
    document.getElementById('stat-congestion').textContent = Math.round(s.congestion * 100) + '%';
    document.getElementById('stat-cars').textContent       = s.carCount;
    document.getElementById('score-value').textContent     = s.score;
    document.getElementById('score-fill').style.width      = s.score + '%';
    document.getElementById('score-fill').style.background =
      s.score >= 70 ? '#00b894' : s.score >= 45 ? '#f5a623' : '#d63031';
  }

  _clearStats() {
    ['stat-throughput','stat-wait','stat-congestion','stat-cars'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
    document.getElementById('score-value').textContent = '--';
    document.getElementById('score-fill').style.width  = '0%';
  }

  _updateSelectionPanel() {
    const panel = document.getElementById('selection-info');
    if (!this.selection) {
      panel.innerHTML = '<span class="hint">Click a road or junction</span>';
      return;
    }
    if (this.selection.type === 'edge') {
      const e = this.network.edges.get(this.selection.id);
      if (!e) return;
      panel.innerHTML =
        `<b>Road Segment</b><br>` +
        `Lanes: ${e.lanesForward}↑ / ${e.lanesBackward}↓<br>` +
        `Length: ${Math.round(e.length)}m<br>` +
        `${e.elevation ? '<em>Bridge</em>' : ''}`;
    } else if (this.selection.type === 'node') {
      const n = this.network.nodes.get(this.selection.id);
      if (!n) return;
      const typeLabel = { basic: 'Junction', signal: 'Signalised', roundabout: 'Roundabout' };
      panel.innerHTML =
        `<b>${typeLabel[n.type] || n.type}</b><br>` +
        `${n.edges.length} connected roads`;
    }
  }
}
