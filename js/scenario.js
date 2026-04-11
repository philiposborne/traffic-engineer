// Scenario: "Rush Hour Crossroads"
// A two-junction arterial road with heavy through-traffic
// conflicting with cross-town traffic.

function buildScenario() {
  const net = new RoadNetwork();

  // --- Nodes ---
  //
  //        N1(285,65)      N2(515,65)
  //             |                |
  //  W(40,290)--[A](285,290)--[B](515,290)--E(760,290)
  //             |                |
  //        S1(285,515)     S2(515,515)

  const W  = net.addNode( 40, 290, 'terminal'); // 0
  const A  = net.addNode(285, 290, 'basic');     // 1  ← player will fix this
  const B  = net.addNode(515, 290, 'basic');     // 2  ← player will fix this
  const E  = net.addNode(760, 290, 'terminal'); // 3
  const N1 = net.addNode(285,  65, 'terminal'); // 4
  const S1 = net.addNode(285, 515, 'terminal'); // 5
  const N2 = net.addNode(515,  65, 'terminal'); // 6
  const S2 = net.addNode(515, 515, 'terminal'); // 7

  // --- Edges ---
  // All 1 lane each direction initially
  const eWA  = net.addEdge(W.id,  A.id,  1, 1); // 0
  const eAB  = net.addEdge(A.id,  B.id,  1, 1); // 1
  const eBE  = net.addEdge(B.id,  E.id,  1, 1); // 2
  const eN1A = net.addEdge(N1.id, A.id,  1, 1); // 3
  const eAS1 = net.addEdge(A.id,  S1.id, 1, 1); // 4
  const eN2B = net.addEdge(N2.id, B.id,  1, 1); // 5
  const eBS2 = net.addEdge(B.id,  S2.id, 1, 1); // 6

  // --- Traffic demands ---
  // Each demand: { route: [{edgeId, forward}], rate: cars/sim-sec, label }
  // Routes are directional paths through the network.

  const r = (segments) => segments; // alias for clarity

  const demands = [
    // Heavy E-W through traffic
    { route: r([{id: eWA.id, fwd: true},  {id: eAB.id, fwd: true},  {id: eBE.id, fwd: true}]),
      rate: 0.38, label: 'W→E' },
    { route: r([{id: eBE.id, fwd: false}, {id: eAB.id, fwd: false}, {id: eWA.id, fwd: false}]),
      rate: 0.38, label: 'E→W' },

    // Moderate N-S cross traffic
    { route: r([{id: eN1A.id, fwd: true},  {id: eAS1.id, fwd: true}]),
      rate: 0.22, label: 'N1→S1' },
    { route: r([{id: eAS1.id, fwd: false}, {id: eN1A.id, fwd: false}]),
      rate: 0.22, label: 'S1→N1' },
    { route: r([{id: eN2B.id, fwd: true},  {id: eBS2.id, fwd: true}]),
      rate: 0.22, label: 'N2→S2' },
    { route: r([{id: eBS2.id, fwd: false}, {id: eN2B.id, fwd: false}]),
      rate: 0.22, label: 'S2→N2' },

    // Light turning movements
    { route: r([{id: eWA.id, fwd: true},  {id: eAS1.id, fwd: true}]),
      rate: 0.08, label: 'W→S1' },
    { route: r([{id: eAS1.id, fwd: false},{id: eAB.id, fwd: true},  {id: eBE.id, fwd: true}]),
      rate: 0.08, label: 'S1→E' },
    { route: r([{id: eN1A.id, fwd: true}, {id: eAB.id, fwd: true},  {id: eBE.id, fwd: true}]),
      rate: 0.06, label: 'N1→E' },
    { route: r([{id: eWA.id, fwd: true},  {id: eAB.id, fwd: true},  {id: eBS2.id, fwd: true}]),
      rate: 0.06, label: 'W→S2' },
  ];

  return { net, demands };
}
