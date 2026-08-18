const CONFIG = {
  DRIVE_SIDE: 'right', // 'right' = keep right | 'left' = keep left

  LANE_WIDTH: 14,
  SHOULDER_WIDTH: 3,

  CAR_LENGTH: 11,
  CAR_WIDTH: 7.5,

  MAX_SPEED: 90,
  FOLLOW_DISTANCE: 32,
  MIN_GAP: 15,

  SIM_SPEED: 2.5,

  // Intersection transit times (sim-seconds between cars leaving same approach)
  BASIC_TRANSIT: 1.4,
  SIGNAL_TRANSIT: 0.65,
  ROUNDABOUT_TRANSIT: 0.38,

  // Phase durations (sim-seconds)
  BASIC_PHASE: 10,
  SIGNAL_GREEN: 25,
  SIGNAL_YELLOW: 3,

  ROUNDABOUT_CAPACITY: 5,
  RA_RING_RADIUS: 38,   // midpoint radius of roundabout ring (for car arc)
  RA_OUTER_STOP: 44,    // stop distance from roundabout centre (= outer ring edge)

  // Budget
  STARTING_BUDGET: 100,
  COST_ADD_LANE: 15,
  COST_SIGNAL: 10,
  COST_ROUNDABOUT: 20,

  // Hit testing
  EDGE_HIT_DIST: 18,
  NODE_HIT_RADIUS: 26,

  C: {
    BG: '#e5dfd7',
    ROAD: '#2f3336',
    EDGE_LINE: '#c5c0b8',
    CENTER_LINE: '#e8c84a',
    LANE_LINE: '#9a9590',

    RA_CENTER: '#3d4450',
    RA_RING: '#2f3336',
    RA_MARKING: '#c5c0b8',

    SIG_HOUSING: '#1a1f26',
    SIG_RED: '#e84118',
    SIG_YELLOW: '#f5a623',
    SIG_GREEN: '#44bd32',
    SIG_OFF: '#2a2a2a',

    CARS: ['#0984e3', '#d63031', '#00b894', '#e17055', '#6c5ce7', '#00cec9',
           '#fdcb6e', '#a29bfe', '#55efc4', '#fd79a8'],

    // Destination colours — one per terminal node in each scenario
    DEST: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
           '#e67e22', '#e91e63'],

    CONGESTION: 'rgba(220,50,50,0.20)',
    SELECTION_FILL: 'rgba(74,144,217,0.25)',
    SELECTION_STROKE: '#4a90d9',

    BRIDGE_SHADOW: 'rgba(0,0,0,0.30)',
    BRIDGE_SURFACE: '#3f4850',
    BRIDGE_RAIL: '#9eb3c2',
  }
};
