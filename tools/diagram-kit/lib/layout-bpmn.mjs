// Deterministic BPMN 2.0 auto-layout with pools, lanes, message flows,
// boundary events, data objects and text annotations.
//
// Input:  semantic BPMN XML (any existing BPMNDiagram is discarded).
// Output: the same model plus fresh BPMN DI + neutral colour theme.
//
// Layout model: a grid. Columns come from a longest-path layering of the
// combined sequence-flow + message-flow graph (cycles broken by DFS), rows
// are lanes, and nodes sharing a lane+column are stacked in sub-rows.

import { BpmnModdle } from 'bpmn-moddle';

const COL_W = 170;
const ROW_H = 130;
const POOL_BAND = 30;
const LANE_BAND = 30;
const X0 = POOL_BAND + LANE_BAND + 10;
const POOL_GAP = 60;
const BLACKBOX_H = 70;

const COLOR_NS = 'http://www.omg.org/spec/BPMN/non-normative/color/1.0';
const BIOC_NS = 'http://bpmn.io/schema/bpmn/biocolor/1.0';
// Colour attributes are a non-normative extension; parsers merely note them.
export const COLOR_ATTR_WARNING = /unknown attribute <(color|bioc):/;

export const THEME = {
  task: { fill: '#EAF2FB', stroke: '#2F5D8A' },
  start: { fill: '#E8F5E9', stroke: '#2E7D32' },
  end: { fill: '#ECEFF1', stroke: '#37474F' },
  intermediate: { fill: '#FFFFFF', stroke: '#2F5D8A' },
  gateway: { fill: '#FFF8E1', stroke: '#B7791F' },
  exception: { fill: '#FDECEA', stroke: '#C62828' },
  pool: { fill: '#FFFFFF', stroke: '#546E7A' },
  laneA: { fill: '#F7F9FB', stroke: '#90A4AE' },
  laneB: { fill: '#FFFFFF', stroke: '#90A4AE' },
  data: { fill: '#FFFFFF', stroke: '#546E7A' },
  annotation: { fill: '#FFFFFF', stroke: '#78909C' },
  flow: { stroke: '#37474F' },
  message: { stroke: '#546E7A' },
};

const EXCEPTION_DEFS = new Set([
  'bpmn:ErrorEventDefinition',
  'bpmn:EscalationEventDefinition',
  'bpmn:CompensateEventDefinition',
  'bpmn:TerminateEventDefinition',
  'bpmn:CancelEventDefinition',
]);

const isA = (el, type) => el && el.$instanceOf && el.$instanceOf(type);

function sizeOf(el) {
  if (isA(el, 'bpmn:Event')) return { w: 36, h: 36 };
  if (isA(el, 'bpmn:Gateway')) return { w: 50, h: 50 };
  if (isA(el, 'bpmn:DataObjectReference')) return { w: 36, h: 50 };
  if (isA(el, 'bpmn:DataStoreReference')) return { w: 50, h: 50 };
  if (isA(el, 'bpmn:TextAnnotation')) {
    const lines = Math.max(1, Math.ceil(((el.text || '').length * 6.4) / 132));
    return { w: 150, h: lines * 14 + 14 };
  }
  return { w: 100, h: 80 };
}

function isException(el) {
  if (/^(Error|Exception)_/i.test(el.id)) return true;
  return (el.eventDefinitions || []).some((d) => EXCEPTION_DEFS.has(d.$type)) &&
    !isA(el, 'bpmn:StartEvent');
}

function styleOf(el) {
  if (isException(el)) return THEME.exception;
  if (isA(el, 'bpmn:StartEvent')) return THEME.start;
  if (isA(el, 'bpmn:EndEvent')) return THEME.end;
  if (isA(el, 'bpmn:Event')) return THEME.intermediate;
  if (isA(el, 'bpmn:Gateway')) return THEME.gateway;
  if (isA(el, 'bpmn:DataObjectReference') || isA(el, 'bpmn:DataStoreReference')) return THEME.data;
  if (isA(el, 'bpmn:TextAnnotation')) return THEME.annotation;
  return THEME.task;
}

function paint(diEl, style) {
  if (style.fill) {
    diEl.$attrs['color:background-color'] = style.fill;
    diEl.$attrs['bioc:fill'] = style.fill;
  }
  diEl.$attrs['color:border-color'] = style.stroke;
  diEl.$attrs['bioc:stroke'] = style.stroke;
}

function leafLanes(laneSet) {
  const out = [];
  for (const lane of laneSet?.lanes || []) {
    if (lane.childLaneSet?.lanes?.length) out.push(...leafLanes(lane.childLaneSet));
    else out.push(lane);
  }
  return out;
}

export async function layoutBpmn(xml) {
  const moddle = new BpmnModdle();
  const { rootElement: defs, warnings } = await moddle.fromXML(xml);

  defs.$attrs['xmlns:color'] = COLOR_NS;
  defs.$attrs['xmlns:bioc'] = BIOC_NS;
  defs.diagrams = [];

  const collaboration = defs.rootElements.find((e) => isA(e, 'bpmn:Collaboration'));
  const processes = defs.rootElements.filter((e) => isA(e, 'bpmn:Process'));

  // Participants in declaration order; a bare process becomes an implicit,
  // undrawn container so the same code path handles it.
  const containers = [];
  if (collaboration) {
    for (const p of collaboration.participants || []) {
      containers.push({ participant: p, process: p.processRef || null });
    }
  } else {
    for (const proc of processes) containers.push({ participant: null, process: proc });
  }

  // ---- collect nodes ------------------------------------------------------
  const nodes = []; // layered flow nodes
  const info = new Map(); // id -> { el, container, lane, col, row }
  const boundaries = [];
  const pseudo = []; // annotations + data refs: { el, anchorId, kind }
  const seqFlows = [];
  const associations = [];
  const dataAssocs = [];

  for (const c of containers) {
    if (!c.process) continue;
    const lanes = leafLanes(c.process.laneSets?.[0]);
    c.lanes = lanes.length ? lanes : [{ id: `__virtual_${c.process.id}`, virtual: true, flowNodeRef: [] }];
    const laneOf = new Map();
    for (const lane of c.lanes) for (const ref of lane.flowNodeRef || []) laneOf.set(ref.id, lane);

    for (const el of c.process.flowElements || []) {
      if (isA(el, 'bpmn:SequenceFlow')) { seqFlows.push(el); continue; }
      if (isA(el, 'bpmn:BoundaryEvent')) { boundaries.push(el); continue; }
      if (isA(el, 'bpmn:DataObject')) continue;
      if (isA(el, 'bpmn:DataObjectReference') || isA(el, 'bpmn:DataStoreReference')) {
        pseudo.push({ el, container: c, kind: 'data' });
        continue;
      }
      if (!isA(el, 'bpmn:FlowNode')) continue;
      const lane = laneOf.get(el.id) || c.lanes[0];
      nodes.push(el);
      info.set(el.id, { el, container: c, lane, explicit: laneOf.has(el.id) });
      for (const a of el.dataInputAssociations || []) dataAssocs.push({ assoc: a, task: el, dir: 'in' });
      for (const a of el.dataOutputAssociations || []) dataAssocs.push({ assoc: a, task: el, dir: 'out' });
    }
    for (const art of c.process.artifacts || []) {
      if (isA(art, 'bpmn:TextAnnotation')) pseudo.push({ el: art, container: c, kind: 'annotation' });
      if (isA(art, 'bpmn:Association')) associations.push(art);
    }
  }
  for (const art of collaboration?.artifacts || []) {
    if (isA(art, 'bpmn:TextAnnotation')) pseudo.push({ el: art, container: null, kind: 'annotation' });
    if (isA(art, 'bpmn:Association')) associations.push(art);
  }

  // Modelling tools serialise <incoming>/<outgoing>; bpmnlint and some
  // importers rely on them, so (re)derive them from the sequence flows.
  for (const f of seqFlows) {
    for (const [node, key] of [[f.sourceRef, 'outgoing'], [f.targetRef, 'incoming']]) {
      if (!node) continue;
      const list = node.get(key);
      if (!list.includes(f)) list.push(f);
    }
  }

  // Nodes the author forgot to put in a lane inherit one from a neighbour in
  // the same pool (predecessors first, then successors) and are reported.
  const notes = [];
  const nodeFor = (el) => (isA(el, 'bpmn:BoundaryEvent') ? el.attachedToRef : el);
  const unlaned = new Set(
    [...info.values()].filter((i) => !i.explicit && !i.container.lanes[0].virtual).map((i) => i.el.id),
  );
  const inheritFrom = (pairs) => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const [from, to] of pairs) {
        const a = info.get(nodeFor(from)?.id), b = info.get(nodeFor(to)?.id);
        if (a && b && unlaned.has(b.el.id) && !unlaned.has(a.el.id) && a.container === b.container) {
          b.lane = a.lane;
          unlaned.delete(b.el.id);
          notes.push(`"${b.el.name || b.el.id}" was not assigned to a lane; placed in "${a.lane.name}" (inferred from sequence flow)`);
          changed = true;
        }
      }
    }
  };
  inheritFrom(seqFlows.map((f) => [f.sourceRef, f.targetRef]));
  inheritFrom(seqFlows.map((f) => [f.targetRef, f.sourceRef]));
  for (const id of unlaned) {
    const i = info.get(id);
    notes.push(`"${i.el.name || id}" was not assigned to a lane and could not be inferred; placed in "${i.lane.name}"`);
  }

  // Boundary events borrow the host's lane; their flows layer from the host.
  const hostOf = new Map();
  for (const b of boundaries) {
    hostOf.set(b.id, b.attachedToRef);
    info.set(b.id, { el: b, container: info.get(b.attachedToRef.id)?.container, boundary: true });
  }
  const layerId = (el) => (hostOf.has(el.id) ? hostOf.get(el.id).id : el.id);

  // ---- graph + cycle breaking --------------------------------------------
  const succ = new Map(nodes.map((n) => [n.id, []]));
  const addEdge = (a, b, kind, flow) => {
    if (succ.has(a) && succ.has(b) && a !== b) succ.get(a).push({ to: b, kind, flow });
  };
  for (const f of seqFlows) addEdge(layerId(f.sourceRef), f.targetRef.id, 'seq', f);
  for (const m of collaboration?.messageFlows || []) addEdge(m.sourceRef.id, m.targetRef.id, 'msg', m);

  const back = new Set();
  const state = new Map();
  const dfsOrder = [];
  const visit = (id) => {
    state.set(id, 1);
    dfsOrder.push(id);
    for (const e of succ.get(id)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  const starts = nodes.filter((n) => isA(n, 'bpmn:StartEvent'));
  for (const n of [...starts, ...nodes]) if (!state.get(n.id)) visit(n.id);

  // Longest-path layering over the DAG (Kahn).
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const [, es] of succ) for (const e of es) if (!back.has(e)) indeg.set(e.to, indeg.get(e.to) + 1);
  const col = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift();
    for (const e of succ.get(id)) {
      if (back.has(e)) continue;
      col.set(e.to, Math.max(col.get(e.to), col.get(id) + 1));
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }

  // ---- sub-row assignment -------------------------------------------------
  const occupied = new Map(); // `${laneId}:${col}` -> Set(rows in use)
  const take = (laneId, c, preferred) => {
    const key = `${laneId}:${c}`;
    if (!occupied.has(key)) occupied.set(key, new Set());
    const used = occupied.get(key);
    let r = Math.max(0, preferred);
    while (used.has(r)) r++;
    used.add(r);
    return r;
  };

  // Like take(), but the row must be free in every listed column.
  const takeSpan = (laneId, cols, preferred) => {
    const sets = cols.map((c) => {
      const key = `${laneId}:${c}`;
      if (!occupied.has(key)) occupied.set(key, new Set());
      return occupied.get(key);
    });
    let r = Math.max(0, preferred);
    while (sets.some((u) => u.has(r))) r++;
    sets.forEach((u) => u.add(r));
    return r;
  };

  const placed = new Map(); // id -> row
  const boundaryTargets = new Map();
  for (const f of seqFlows) {
    if (hostOf.has(f.sourceRef.id)) boundaryTargets.set(f.targetRef.id, hostOf.get(f.sourceRef.id).id);
  }
  const placeNode = (id, preferred) => {
    if (placed.has(id)) return;
    const i = info.get(id);
    const row = take(i.lane.id, col.get(id), preferred);
    placed.set(id, row);
    i.col = col.get(id);
    i.row = row;
    for (const e of succ.get(id)) {
      if (e.kind !== 'seq' || back.has(e)) continue;
      const t = info.get(e.to);
      const sameLane = t.lane === i.lane;
      const fromBoundary = hostOf.has(e.flow.sourceRef.id);
      placeNode(e.to, sameLane ? row + (fromBoundary ? 1 : 0) : 0);
    }
  };
  for (const id of dfsOrder) placeNode(id, boundaryTargets.has(id) ? (placed.get(boundaryTargets.get(id)) ?? 0) + 1 : 0);

  // Annotations and data refs sit in the column of what they describe.
  const anchorOf = new Map();
  for (const a of associations) {
    const s = a.sourceRef, t = a.targetRef;
    if (isA(t, 'bpmn:TextAnnotation')) anchorOf.set(t.id, s);
    else if (isA(s, 'bpmn:TextAnnotation')) anchorOf.set(s.id, t);
  }
  for (const { assoc, task, dir } of dataAssocs) {
    const ref = dir === 'in' ? assoc.sourceRef?.[0] : assoc.targetRef;
    if (ref && !anchorOf.has(ref.id)) anchorOf.set(ref.id, task);
  }
  // Data objects sit side by side in the row below their anchor; each
  // annotation gets its own row beneath them.
  const DATA_SLOT = 90;
  const groups = new Map();
  for (const p of pseudo) {
    let anchor = anchorOf.get(p.el.id);
    if (anchor && hostOf.has(anchor.id)) anchor = hostOf.get(anchor.id);
    const key = anchor ? anchor.id : p.el.id;
    if (!groups.has(key)) groups.set(key, { anchor, container: p.container, items: [] });
    groups.get(key).items.push(p);
  }
  // A message flow that leaves/enters the anchor from a pool further down
  // runs straight through the area below it, so items move aside.
  const poolIndex = (el) => containers.findIndex((c) => c.participant === el || (info.get(el.id) && info.get(el.id).container === c));
  const hasDownMessage = (el) =>
    (collaboration?.messageFlows || []).some((m) => {
      const other = m.sourceRef === el ? m.targetRef : m.targetRef === el ? m.sourceRef : null;
      return other && poolIndex(other) > poolIndex(el);
    });
  for (const g of groups.values()) {
    const ai = g.anchor && info.get(g.anchor.id);
    const c = ai?.container || g.container || containers.find((x) => x.process);
    const lane = ai?.lane || c.lanes[0];
    const cl = ai?.col ?? 0;
    const hasBoundary = g.anchor && boundaries.some((b) => b.attachedToRef === g.anchor);
    let row = (ai?.row ?? 0) + 1 + (hasBoundary ? 1 : 0);
    const dataItems = g.items.filter((p) => p.kind === 'data');
    const notes = g.items.filter((p) => p.kind !== 'data');
    if (dataItems.length > 2) {
      // a wide data row would spill into neighbouring columns: go below their nodes
      for (const i of info.values()) {
        if (!i.pseudo && !i.boundary && i.lane === lane && i.col != null && Math.abs(i.col - cl) === 1) row = Math.max(row, i.row + 1);
      }
    }
    const aside = g.anchor && hasDownMessage(g.anchor);
    const side = cl === 0 ? 1 : -1;
    const cols = aside ? [cl, cl + side] : [cl];
    if (dataItems.length) {
      row = takeSpan(lane.id, cols, row);
      const shift = aside ? side * (69 + 45 * (dataItems.length - 1)) : 0;
      dataItems.forEach((p, k) => {
        const dx = (k - (dataItems.length - 1) / 2) * DATA_SLOT + shift;
        info.set(p.el.id, { el: p.el, container: c, lane, col: cl, row, pseudo: true, kind: 'data', dx });
      });
      row += 1;
    }
    for (const p of notes) {
      row = takeSpan(lane.id, cols, row);
      info.set(p.el.id, { el: p.el, container: c, lane, col: cl, row, pseudo: true, kind: p.kind, dx: aside ? side * 87 : 0 });
      row += 1;
    }
  }

  // ---- geometry -----------------------------------------------------------
  const maxCol = Math.max(0, ...[...info.values()].filter((i) => i.col != null).map((i) => i.col));
  const width = X0 + (maxCol + 1) * COL_W + 20;
  const laneRows = new Map();
  for (const i of info.values()) {
    if (!i.lane) continue;
    laneRows.set(i.lane.id, Math.max(laneRows.get(i.lane.id) || 0, i.row + 1));
  }

  const bounds = new Map();
  const poolBounds = new Map();
  const laneBounds = new Map();
  let y = 0;
  for (const c of containers) {
    if (!c.process) {
      poolBounds.set(c.participant.id, { x: 0, y, width, height: BLACKBOX_H });
      y += BLACKBOX_H + POOL_GAP;
      continue;
    }
    const top = y;
    for (const lane of c.lanes) {
      const h = Math.max(1, laneRows.get(lane.id) || 1) * ROW_H;
      laneBounds.set(lane.id, { x: POOL_BAND, y, width: width - POOL_BAND, height: h });
      y += h;
    }
    if (c.participant) poolBounds.set(c.participant.id, { x: 0, y: top, width, height: y - top });
    c.bounds = { y: top, bottom: y };
    y += POOL_GAP;
  }

  for (const [id, i] of info) {
    if (i.boundary) continue;
    const lb = laneBounds.get(i.lane.id);
    const { w, h } = sizeOf(i.el);
    const cx = X0 + i.col * COL_W + COL_W / 2 + (i.dx || 0);
    const cy = lb.y + i.row * ROW_H + ROW_H / 2;
    bounds.set(id, { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h });
  }
  const perHost = new Map();
  for (const b of boundaries) {
    const hb = bounds.get(b.attachedToRef.id);
    const k = perHost.get(b.attachedToRef.id) || 0;
    perHost.set(b.attachedToRef.id, k + 1);
    bounds.set(b.id, { x: hb.x + hb.width - 30 - k * 40, y: hb.y + hb.height - 18, width: 36, height: 36 });
  }

  // ---- DI construction ----------------------------------------------------
  const plane = moddle.create('bpmndi:BPMNPlane', {
    id: 'BPMNPlane_1',
    bpmnElement: collaboration || processes[0],
    planeElement: [],
  });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1', plane });
  defs.diagrams = [diagram];

  const B = (b) => moddle.create('dc:Bounds', b);
  const P = (x, yy) => moddle.create('dc:Point', { x: Math.round(x), y: Math.round(yy) });
  const shapeDi = new Map();
  const edgeDi = new Map();
  const shape = (el, b, style, extra = {}) => {
    const s = moddle.create('bpmndi:BPMNShape', { id: `${el.id}_di`, bpmnElement: el, bounds: B(b), ...extra });
    if (style) paint(s, style);
    plane.planeElement.push(s);
    shapeDi.set(el.id, s);
  };
  let edgeSeq = 0;
  const allSegs = [];
  const edge = (el, pts, style, weight = 3) => {
    if (!el.id) el.id = `Assoc_${++edgeSeq}`;
    const e = moddle.create('bpmndi:BPMNEdge', { id: `${el.id}_di`, bpmnElement: el, waypoint: pts.map(([a, b]) => P(a, b)) });
    if (style) paint(e, style);
    plane.planeElement.push(e);
    edgeDi.set(el.id, e);
    allSegs.push({ pts, weight });
    return e;
  };

  // Explicit label boxes: without them bpmn-js picks narrow default boxes
  // that wrap words mid-way and sit on top of connection lines. Positions are
  // requested here and resolved once every route exists (see below).
  const textBox = (name, maxW) => {
    const est = Math.ceil(name.length * 6.6) + 6;
    return { w: Math.max(24, Math.min(maxW, est)), h: Math.max(1, Math.ceil(est / maxW)) * 14 + 2 };
  };
  const setLabel = (di, x, yy, w, h) => {
    di.label = moddle.create('bpmndi:BPMNLabel', {
      bounds: B({ x: Math.round(x), y: Math.round(yy), width: w, height: h }),
    });
  };
  const labelReqs = [];
  const requestLabel = (di, w, h, cands, selfId) => labelReqs.push({ di, w, h, cands, selfId });
  const placeEdgeLabel = (di, pts, name, firstSegment) => {
    const { w, h } = textBox(name, 110);
    let k = 0;
    if (!firstSegment) {
      let longest = -1;
      for (let n = 0; n + 1 < pts.length; n++) {
        const len = Math.abs(pts[n + 1][0] - pts[n][0]) + Math.abs(pts[n + 1][1] - pts[n][1]);
        if (len > longest) { longest = len; k = n; }
      }
    }
    const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
    const steps = firstSegment ? [4, 28, 52] : [0.5, 0.3, 0.7];
    const cands = [];
    for (const t of steps) {
      if (x1 === x2) {
        const yy = firstSegment ? (y2 > y1 ? y1 + t : y1 - t - h) : y1 + (y2 - y1) * t - h / 2;
        cands.push([x1 + 6, yy], [x1 - 6 - w, yy]);
      } else {
        const xx = firstSegment ? (x2 > x1 ? x1 + t : x1 - t - w) : x1 + (x2 - x1) * t - w / 2;
        cands.push([xx, y1 - h - 3], [xx, y1 + 3]);
      }
    }
    requestLabel(di, w, h, cands);
  };

  for (const c of containers) {
    if (c.participant) shape(c.participant, poolBounds.get(c.participant.id), THEME.pool, { isHorizontal: true });
    if (!c.process) continue;
    c.lanes.forEach((lane, idx) => {
      if (lane.virtual) return;
      shape(lane, laneBounds.get(lane.id), idx % 2 ? THEME.laneB : THEME.laneA, { isHorizontal: true });
    });
  }
  for (const [id, i] of info) {
    const extra = {};
    if (isA(i.el, 'bpmn:ExclusiveGateway')) extra.isMarkerVisible = true;
    if (isA(i.el, 'bpmn:SubProcess')) extra.isExpanded = false;
    shape(i.el, bounds.get(id), styleOf(i.el), extra);
  }

  const mid = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  const rightOf = (b) => b.x + b.width;
  const boxOf = (el) => bounds.get(el.id) || poolBounds.get(el.id);
  const poolOf = (el) => {
    if (poolBounds.has(el.id)) return poolBounds.get(el.id);
    const c = info.get(el.id)?.container;
    return c?.participant ? poolBounds.get(c.participant.id) : null;
  };
  const msgSide = (el) => {
    const eb = boxOf(el);
    for (const m of collaboration?.messageFlows || []) {
      const other = m.sourceRef === el ? m.targetRef : m.targetRef === el ? m.sourceRef : null;
      const ob = other && boxOf(other);
      if (ob && eb) return ob.y < eb.y ? 'up' : 'down';
    }
    return null;
  };

  // Pick, per flow, the candidate route that crosses the fewest other nodes.
  const boxes = [...info.keys()].map((id) => [id, bounds.get(id)]).filter(([, b]) => b);
  const hitCount = (pts, skip) => {
    let n = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
      for (const [id, b] of boxes) {
        if (skip.has(id)) continue;
        if (hx > b.x + 1 && lx < b.x + b.width - 1 && hy > b.y + 1 && ly < b.y + b.height - 1) n++;
      }
    }
    return n;
  };

  for (const f of seqFlows) {
    const sb = bounds.get(f.sourceRef.id), tb = bounds.get(f.targetRef.id);
    if (!sb || !tb) continue;
    const [sx, sy] = mid(sb), [tx, ty] = mid(tb);
    const fromBoundary = hostOf.has(f.sourceRef.id);
    const src = layerId(f.sourceRef);
    const sCol = info.get(src).col, tCol = info.get(f.targetRef.id).col;
    const skip = new Set([f.sourceRef.id, f.targetRef.id, src]);
    const bend = tCol - sCol <= 1 ? (rightOf(sb) + tb.x) / 2 : tb.x - 25;
    const hFirst = [[rightOf(sb), sy], [bend, sy], [bend, ty], [tb.x, ty]];
    const cands = [];
    if (tCol <= sCol && !fromBoundary) {
      const yt = Math.min(sb.y, tb.y) - 12;
      const yb = Math.max(sb.y + sb.height, tb.y + tb.height) + 12;
      const above = [[sx, sb.y], [sx, yt], [tx, yt], [tx, tb.y]];
      const below = [[sx, sb.y + sb.height], [sx, yb], [tx, yb], [tx, tb.y + tb.height]];
      const preferAbove = msgSide(f.sourceRef) !== 'up' && msgSide(f.targetRef) !== 'up';
      cands.push(...(preferAbove ? [above, below] : [below, above]));
    } else if (fromBoundary) {
      if (ty > sb.y + sb.height) cands.push([[sx, sb.y + sb.height], [sx, ty], [tb.x, ty]]);
      cands.push(hFirst);
    } else if (Math.abs(sy - ty) < 1) {
      cands.push([[rightOf(sb), sy], [tb.x, ty]]);
    } else if (isA(f.sourceRef, 'bpmn:Gateway')) {
      cands.push([[sx, ty > sy ? sb.y + sb.height : sb.y], [sx, ty], [tb.x, ty]], hFirst);
    } else if (isA(f.targetRef, 'bpmn:Gateway')) {
      cands.push([[rightOf(sb), sy], [tx, sy], [tx, ty > sy ? tb.y : tb.y + tb.height]], hFirst);
    } else {
      cands.push(hFirst);
    }
    const pts = cands.map((c) => [hitCount(c, skip), c]).sort((a, b) => a[0] - b[0])[0][1];
    const bad = isException(f) || isException(f.sourceRef) || isException(f.targetRef);
    const di = edge(f, pts, bad ? THEME.exception : THEME.flow);
    if (f.name) placeEdgeLabel(di, pts, f.name, isA(f.sourceRef, 'bpmn:Gateway'));
  }

  for (const m of collaboration?.messageFlows || []) {
    const sb = boxOf(m.sourceRef), tb = boxOf(m.targetRef);
    if (!sb || !tb) continue;
    const sIsPool = poolBounds.has(m.sourceRef.id), tIsPool = poolBounds.has(m.targetRef.id);
    let sx = mid(sb)[0], tx = mid(tb)[0];
    if (sIsPool) sx = tx;
    if (tIsPool) tx = sx;
    const down = sb.y < tb.y;
    const sy = down ? sb.y + sb.height : sb.y;
    const ty = down ? tb.y : tb.y + tb.height;
    let pts;
    if (Math.abs(sx - tx) < 1) pts = [[sx, sy], [tx, ty]];
    else {
      const sp = poolOf(m.sourceRef);
      const my = sp ? (down ? sp.y + sp.height + POOL_GAP / 2 : sp.y - POOL_GAP / 2) : (sy + ty) / 2;
      pts = [[sx, sy], [sx, my], [tx, my], [tx, ty]];
    }
    const di = edge(m, pts, THEME.message);
    if (m.name) placeEdgeLabel(di, pts, m.name, false);
  }

  // Association from an anchor to its data object / annotation. The line
  // leaves at an x that is shared by both shapes and clear of sibling shapes.
  const assocRoute = (a, b, ends) => {
    const down = b.y > a.y;
    const y1 = down ? a.y + a.height : a.y, y2 = down ? b.y : b.y + b.height;
    const acx = a.x + a.width / 2, bcx = b.x + b.width / 2;
    const inA = (x) => x >= a.x + 4 && x <= a.x + a.width - 4;
    const inB = (x) => x >= b.x + 4 && x <= b.x + b.width - 4;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    const alongLine = (x) =>
      allSegs.some(({ pts }) =>
        pts.some((q, k) => {
          const r = pts[k + 1];
          return r && q[0] === r[0] && Math.abs(q[0] - x) < 6 && Math.max(Math.min(q[1], r[1]), lo) < Math.min(Math.max(q[1], r[1]), hi);
        }));
    const clear = (x) =>
      hitCount([[x - 4, y1], [x - 4, y2]], ends) + hitCount([[x + 4, y1], [x + 4, y2]], ends) === 0 && !alongLine(x);
    const xs = [bcx, acx - 42, acx + 42, acx, acx - 20, acx + 20, acx - 30, acx + 30].filter((x) => inA(x) && inB(x));
    const x = xs.find(clear) ?? xs[0];
    if (x == null) {
      const my = (y1 + y2) / 2;
      return [[acx, y1], [acx, my], [bcx, my], [bcx, y2]];
    }
    return [[x, y1], [x, y2]];
  };
  for (const a of associations) {
    const s0 = a.sourceRef, t0 = a.targetRef;
    const sb = boxOf(s0), tb = boxOf(t0);
    if (!sb || !tb) continue;
    const toNote = isA(t0, 'bpmn:TextAnnotation');
    if (!toNote && !isA(s0, 'bpmn:TextAnnotation')) {
      edge(a, [mid(sb), mid(tb)], THEME.annotation, 1);
      continue;
    }
    const [anchor, note] = toNote ? [s0, t0] : [t0, s0];
    const pts = assocRoute(boxOf(anchor), boxOf(note), new Set([anchor.id, note.id]));
    edge(a, toNote ? pts : [...pts].reverse(), THEME.annotation, 1);
  }
  for (const { assoc, task, dir } of dataAssocs) {
    const ref = dir === 'in' ? assoc.sourceRef?.[0] : assoc.targetRef;
    const rb = ref && bounds.get(ref.id), tb = bounds.get(task.id);
    if (!rb || !tb) continue;
    const pts = assocRoute(tb, rb, new Set([task.id, ref.id]));
    edge(assoc, dir === 'in' ? [...pts].reverse() : pts, THEME.data, 1);
  }

  // Label requests for events, boundary events, gateways and data objects.
  for (const [id, i] of info) {
    const b = bounds.get(id);
    if (!i.el.name || !b || (i.pseudo && i.kind !== 'data')) continue;
    const di = shapeDi.get(id);
    const maxW = i.pseudo ? 70 : i.boundary ? 90 : 100;
    const { w, h } = textBox(i.el.name, maxW);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    let cands = null;
    if (i.pseudo) cands = [[cx - w / 2, b.y + b.height + 4]];
    else if (i.boundary) {
      cands = [[b.x + b.width + 2, b.y + b.height + 2], [b.x - 2 - w, b.y + b.height + 2], [b.x + b.width + 2, b.y - h]];
    } else if (isA(i.el, 'bpmn:Event')) {
      cands = [[cx - w / 2, b.y + b.height + 4], [cx - w / 2, b.y - 4 - h], [b.x + b.width + 4, cy - h / 2], [b.x - 4 - w, cy - h / 2]];
    } else if (isA(i.el, 'bpmn:Gateway')) {
      const n = textBox(i.el.name, 64);
      cands = [
        [cx - w / 2, b.y - 4 - h], [cx - w / 2, b.y + b.height + 4],
        [b.x - w + 6, b.y - h + 2], [b.x + b.width - 6, b.y - h + 2],
        [b.x - w + 6, b.y + b.height - 2], [b.x + b.width - 6, b.y + b.height - 2],
        [b.x - n.w + 4, b.y + b.height - 2, n.w, n.h], [b.x + b.width - 4, b.y + b.height - 2, n.w, n.h],
        [b.x - n.w + 4, b.y - n.h + 2, n.w, n.h], [b.x + b.width - 4, b.y - n.h + 2, n.w, n.h],
      ];
    }
    if (cands) requestLabel(di, w, h, cands, id);
  }

  // Resolve every label to the first candidate box that touches nothing; if
  // none is free, take the one with the lowest penalty (flows 3, associations 1,
  // shapes 6, other labels 4).
  const segHits = (pts, r) => {
    let n = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
      // 5px clearance so a label never visually touches a line
      if (hx > r.x - 5 && lx < r.x + r.w + 5 && hy > r.y - 5 && ly < r.y + r.h + 5) n++;
    }
    return n;
  };
  const overlaps = (r, q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y;
  const placedLabels = [];
  for (const req of labelReqs) {
    let best = null;
    for (const [x, yy, cw, ch] of req.cands) {
      const r = { x: Math.round(x), y: Math.round(yy), w: cw ?? req.w, h: ch ?? req.h };
      let score = 0;
      for (const { pts, weight } of allSegs) score += segHits(pts, r) * weight;
      for (const [id, b] of boxes) {
        if (id !== req.selfId && overlaps(r, { x: b.x, y: b.y, w: b.width, h: b.height })) score += 6;
      }
      for (const q of placedLabels) if (overlaps(r, q)) score += 4;
      if (!best || score < best.score) best = { score, r };
      if (score === 0) break;
    }
    setLabel(req.di, best.r.x, best.r.y, best.r.w, best.r.h);
    placedLabels.push(best.r);
  }

  const { xml: out } = await moddle.toXML(defs, { format: true });
  return { xml: out, warnings: warnings.map((w) => w.message).filter((m) => !COLOR_ATTR_WARNING.test(m)), notes };
}
