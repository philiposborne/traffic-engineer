// Tool manager: handles player interaction (click, hover, tool selection)

class ToolManager {
  constructor(canvas, game) {
    this.canvas    = canvas;
    this.game      = game;
    this.activeTool = 'select';
    this.hovered   = null;

    canvas.addEventListener('click',     e => this._onClick(e));
    canvas.addEventListener('mousemove', e => this._onHover(e));
    canvas.addEventListener('mouseleave',() => { this.hovered = null; });
  }

  setTool(name) {
    this.activeTool = name;
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
    this._updateCursor();
  }

  _updateCursor() {
    const cursors = {
      select: 'default',
      'add-lane': 'cell',
      'remove-lane': 'not-allowed',
      signal: 'crosshair',
      roundabout: 'crosshair',
    };
    this.canvas.style.cursor = cursors[this.activeTool] || 'default';
  }

  _canvasXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onClick(e) {
    if (this.game.mode !== 'edit') return;
    const { x, y } = this._canvasXY(e);
    const renderer  = this.game.renderer;
    const network   = this.game.network;

    // Try node first, then edge
    const node = renderer.hitTestNode(x, y, network);
    const edge = node ? null : renderer.hitTestEdge(x, y, network);

    if (this.activeTool === 'select') {
      if (node) {
        this.game.setSelection({ type: 'node', id: node.id });
      } else if (edge) {
        this.game.setSelection({ type: 'edge', id: edge.id });
      } else {
        this.game.setSelection(null);
      }
      return;
    }

    // Tool actions require a target
    if (node) {
      this._applyToNode(node);
    } else if (edge) {
      this._applyToEdge(edge);
    }
  }

  _onHover(e) {
    const { x, y } = this._canvasXY(e);
    const renderer = this.game.renderer;
    const network  = this.game.network;
    const node = renderer.hitTestNode(x, y, network);
    this.hovered = node || renderer.hitTestEdge(x, y, network);
  }

  _applyToEdge(edge) {
    const tool    = this.activeTool;
    const network = this.game.network;
    let cost      = 0;

    if (tool === 'add-lane') {
      // Add one lane in each direction
      if (edge.lanesForward < 4 && edge.lanesBackward < 4) {
        edge.lanesForward++;
        edge.lanesBackward++;
        cost = CONFIG.COST_ADD_LANE;
      } else {
        this.game.showMessage('Maximum lane count reached.');
        return;
      }

    } else if (tool === 'remove-lane') {
      if (edge.lanesForward > 1 || edge.lanesBackward > 1) {
        edge.lanesForward  = Math.max(1, edge.lanesForward  - 1);
        edge.lanesBackward = Math.max(1, edge.lanesBackward - 1);
        cost = -Math.floor(CONFIG.COST_ADD_LANE / 2); // refund half
      } else {
        this.game.showMessage('Road already at minimum width.');
        return;
      }

    } else if (tool === 'signal') {
      // Convert end nodes to signals if they're basic
      [edge.from, edge.to].forEach(n => {
        if (n.type === 'basic') {
          n.type = 'signal';
          cost += CONFIG.COST_SIGNAL;
        }
      });

    } else if (tool === 'roundabout') {
      // Convert end nodes
      [edge.from, edge.to].forEach(n => {
        if (n.type === 'basic' || n.type === 'signal') {
          n.type = 'roundabout';
          cost  += CONFIG.COST_ROUNDABOUT;
        }
      });
    }

    if (!this.game.spendBudget(cost)) {
      // Undo
      if (tool === 'add-lane') { edge.lanesForward--; edge.lanesBackward--; }
    } else {
      this.game.setSelection({ type: 'edge', id: edge.id });
    }
  }

  _applyToNode(node) {
    const tool = this.activeTool;
    let cost   = 0;

    if (tool === 'signal') {
      if (node.type === 'basic') {
        node.type = 'signal';
        cost = CONFIG.COST_SIGNAL;
      } else if (node.type === 'roundabout') {
        this.game.showMessage('Already a roundabout. Remove it first.');
        return;
      } else if (node.type === 'signal') {
        // Toggle back to basic (free)
        node.type = 'basic';
        cost = 0;
      }

    } else if (tool === 'roundabout') {
      if (node.type === 'basic' || node.type === 'signal') {
        node.type = 'roundabout';
        cost = CONFIG.COST_ROUNDABOUT;
      } else if (node.type === 'roundabout') {
        node.type = 'basic'; // revert for free
        cost = 0;
      }

    } else if (tool === 'add-lane') {
      // Add lane on all connected roads (one step)
      node.edges.forEach(edge => {
        if (edge.from === node && edge.lanesForward < 4)  { edge.lanesForward++;  cost += CONFIG.COST_ADD_LANE; }
        if (edge.to   === node && edge.lanesBackward < 4) { edge.lanesBackward++; cost += CONFIG.COST_ADD_LANE; }
      });

    } else if (tool === 'select') {
      this.game.setSelection({ type: 'node', id: node.id });
      return;
    }

    if (cost > 0 && !this.game.spendBudget(cost)) {
      this.game.showMessage('Not enough budget!');
      // Undo
      if (tool === 'roundabout') node.type = 'basic';
      if (tool === 'signal') node.type = 'basic';
      return;
    }

    this.game.setSelection({ type: 'node', id: node.id });
  }
}
