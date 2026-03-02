import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Box, Typography,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Tooltip,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { skillTreeRoot as initialSkillTreeRoot, SkillNode } from '../data/skillTree';

// ── Flat Anthracite Palette ──────────────────────────────────────────────────
type PKey = 'root' | 'development' | 'research' | 'communication' | 'organisation' | 'default';

const PALETTE: Record<PKey, { stroke: string; fill: string; text: string }> = {
  root:          { stroke: '#e2b714', fill: '#3d3519', text: '#f5e6a3' },
  development:   { stroke: '#38bdf8', fill: '#1a3040', text: '#bae6fd' },
  research:      { stroke: '#a78bfa', fill: '#2a1f40', text: '#ddd6fe' },
  communication: { stroke: '#fb923c', fill: '#3d2210', text: '#fed7aa' },
  organisation:  { stroke: '#4ade80', fill: '#1a3326', text: '#bbf7d0' },
  default:       { stroke: '#94a3b8', fill: '#232b35', text: '#cbd5e1' },
};

const CAT_KEYS: Record<string, PKey> = {
  root: 'root', development: 'development', research: 'research',
  communication: 'communication', organisation: 'organisation',
};

const TREE_BG = '#1e2229';

// ── Color picker swatches (stroke colors from palette + extras) ───────────────
const COLOR_SWATCHES = [
  '#e2b714', '#38bdf8', '#a78bfa', '#fb923c', '#4ade80',
  '#f472b6', '#34d399', '#f87171', '#94a3b8', '#facc15',
];

// ── Geometry ─────────────────────────────────────────────────────────────────
const BASE_R: Record<number, number> = { 0: 50, 1: 40, 2: 31, 3: 22 };
const FOCUS_SCALE = 1.5;

// SVG coordinate space — wide 16:9 canvas gives breathing room full-screen
const VW = 1600;
const VH = 900;

// ── Types ─────────────────────────────────────────────────────────────────────
interface NodeDatum {
  id: string; labelKey: string; label?: string;
  x: number; y: number;
  depth: number; colorKey: PKey; colorOverride?: string;
}
interface EdgeDatum {
  x1: number; y1: number; x2: number; y2: number; // center-to-center positions
  rParent: number; rChild: number;                 // base radii for circumference trimming
  colorKey: PKey; colorOverride?: string; parentId: string; childId: string;
}

// ── Import / Export ───────────────────────────────────────────────────────────
interface ExportNode {
  id: string;
  label: string;
  parentId: string | null;
  colorOverride?: string;
  position?: { x: number; y: number }; // final visual position (spring + manual offset)
}
interface SkillTreeExport {
  treeId: string;
  version: number;
  nodes: ExportNode[]; // sorted by id for stable git diffs
}

// ── Full-tree layout (angular-budget, collision-aware) ────────────────────────
function buildLayout(
  root: SkillNode,
  seedPositions?: Map<string, { x: number; y: number }>,
  frozenPositions?: Map<string, { x: number; y: number }>,
): { nodes: NodeDatum[]; edges: EdgeDatum[] } {
  const GAP = 14; // minimum clearance between node edges (SVG units)

  // ── 1. Collect tree structure ──────────────────────────────────────────────
  interface RawNode {
    id: string; depth: number;
    colorKey: PKey; colorOverride?: string;
    labelKey: string; label?: string;
    positionOffset?: { x: number; y: number };
  }
  const rawNodes: RawNode[] = [];
  const rawEdges: { parentId: string; childId: string }[] = [];

  function collect(
    node: SkillNode, depth: number,
    colorKey: PKey, inheritedOverride: string | undefined,
  ) {
    const co = node.colorOverride ?? inheritedOverride;
    rawNodes.push({ id: node.id, depth, colorKey, colorOverride: co,
      labelKey: node.labelKey, label: node.label, positionOffset: node.positionOffset });
    (node.children ?? []).forEach(child => {
      rawEdges.push({ parentId: node.id, childId: child.id });
      const childCk = depth === 0 ? ((CAT_KEYS[child.id] ?? 'default') as PKey) : colorKey;
      collect(child, depth + 1, childCk, co);
    });
  }
  collect(root, 0, 'root', undefined);

  const depthOf = new Map(rawNodes.map(n => [n.id, n.depth]));

  // ── 2. Warm-start: radial init avoids symmetry traps ─────────────────────
  const pos = new Map<string, { x: number; y: number }>();
  function initRadial(node: SkillNode, x: number, y: number, sa: number, ea: number) {
    pos.set(node.id, { x, y });
    const ch = node.children ?? [];
    if (!ch.length) return;
    const d = depthOf.get(node.id) ?? 0;
    const r = (BASE_R[d] ?? 22) + (BASE_R[d + 1] ?? 22) + GAP * 4;
    ch.forEach((child, i) => {
      const span = (ea - sa) / ch.length;
      const mid  = sa + (i + 0.5) * span;
      initRadial(child, x + r * Math.cos(mid), y + r * Math.sin(mid), mid - span / 2, mid + span / 2);
    });
  }
  initRadial(root, 0, 0, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI);

  // ── Frozen positions: skip simulation entirely (used after import) ────────
  // Nodes not present in frozenPositions (e.g. newly added since last export)
  // retain their radial-init position and are settled by the spring below.
  if (frozenPositions) {
    const frozenIds = new Set<string>();
    for (const { id } of rawNodes) {
      if (id === root.id) continue;
      const fp = frozenPositions.get(id);
      if (fp) { pos.set(id, { x: fp.x, y: fp.y }); frozenIds.add(id); }
    }
    // Only run the spring for nodes that don't have a frozen position
    const unfrozenNodes = rawNodes.filter(n => n.id !== root.id && !frozenIds.has(n.id));
    if (unfrozenNodes.length === 0) {
      // All positions are frozen — skip simulation entirely.
      // positionOffset is still applied so manual moves after import are preserved.
      const nodes: NodeDatum[] = rawNodes.map(info => {
        const p  = pos.get(info.id)!;
        const ox = info.positionOffset?.x ?? 0;
        const oy = info.positionOffset?.y ?? 0;
        return { id: info.id, labelKey: info.labelKey, label: info.label,
          x: p.x + ox, y: p.y + oy, depth: info.depth, colorKey: info.colorKey, colorOverride: info.colorOverride };
      });
      const posMap  = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
      const colorOf = new Map(rawNodes.map(n => [n.id, { colorKey: n.colorKey, colorOverride: n.colorOverride }]));
      const edges: EdgeDatum[] = rawEdges.map(({ parentId, childId }) => {
        const pa = posMap.get(parentId)!, pb = posMap.get(childId)!;
        const c  = colorOf.get(childId)!;
        const rA = BASE_R[depthOf.get(parentId) ?? 3] ?? 22;
        const rB = BASE_R[depthOf.get(childId)  ?? 3] ?? 22;
        return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
          rParent: rA, rChild: rB,
          colorKey: c.colorKey, colorOverride: c.colorOverride, parentId, childId };
      });
      return { nodes, edges };
    }
    // Fall through to spring simulation for newly-added (unfrozen) nodes.
    // Warm-start each unfrozen node near its (frozen) parent so the spring
    // settles quickly without displacing existing nodes.
    for (const { id } of rawNodes) {
      if (id === root.id || frozenIds.has(id)) continue;
      const parentEdge = rawEdges.find(e => e.childId === id);
      if (!parentEdge) continue;
      const parentPos = pos.get(parentEdge.parentId);
      if (!parentPos) continue;
      const angle = Math.random() * 2 * Math.PI;
      const d = (BASE_R[depthOf.get(parentEdge.parentId) ?? 3] ?? 22)
              + (BASE_R[depthOf.get(id) ?? 3] ?? 22) + GAP * 3;
      pos.set(id, { x: parentPos.x + d * Math.cos(angle), y: parentPos.y + d * Math.sin(angle) });
    }
  }

  // Override warm-start with seed positions (supplied when cleanup is triggered from a
  // moved layout so the spring settles from the current visual state, not radial init)
  if (seedPositions) {
    for (const { id } of rawNodes) {
      if (id === root.id) continue; // root is always pinned at origin
      const seed = seedPositions.get(id);
      if (seed) pos.set(id, { x: seed.x, y: seed.y });
    }
  }

  // ── 3. Force-directed spring simulation ───────────────────────────────────
  const K_S         = 0.06;  // spring stiffness
  const K_R         = 55000; // repulsion coefficient
  const DAMP        = 0.82;  // velocity damping per step
  const ITER        = 450;   // simulation steps
  const MAX_EDGE_LEN = 260;  // hard max distance between parent and child (SVG units)

  // Build a parent-lookup for the constraint-projection step
  const parentOf = new Map(rawEdges.map(({ parentId, childId }) => [childId, parentId]));

  const vel = new Map(rawNodes.map(({ id }) => [id, { vx: 0, vy: 0 }]));

  for (let iter = 0; iter < ITER; iter++) {
    const maxStep = 30 * (1 - iter / ITER) + 1; // cooling: large steps early, tiny steps late
    const forces  = new Map(rawNodes.map(({ id }) => [id, { fx: 0, fy: 0 }]));

    // Spring forces along edges (attractive when too far, repulsive when too close)
    for (const { parentId, childId } of rawEdges) {
      const pa = pos.get(parentId)!, pb = pos.get(childId)!;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const rA   = BASE_R[depthOf.get(parentId) ?? 3] ?? 22;
      const rB   = BASE_R[depthOf.get(childId)  ?? 3] ?? 22;
      const rest = rA + rB + GAP; // natural rest length = just touching + gap
      const f    = K_S * (dist - rest);
      const fx = f * dx / dist, fy = f * dy / dist;
      if (parentId !== root.id) { forces.get(parentId)!.fx += fx; forces.get(parentId)!.fy += fy; }
      forces.get(childId)!.fx -= fx;
      forces.get(childId)!.fy -= fy;
    }

    // Repulsive force between every pair of nodes
    for (let i = 0; i < rawNodes.length; i++) {
      for (let j = i + 1; j < rawNodes.length; j++) {
        const a = rawNodes[i].id, b = rawNodes[j].id;
        const pa = pos.get(a)!, pb = pos.get(b)!;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const dist2 = dx * dx + dy * dy || 0.01;
        const dist  = Math.sqrt(dist2);
        const f  = K_R / dist2;
        const fx = f * dx / dist, fy = f * dy / dist;
        if (a !== root.id) { forces.get(a)!.fx -= fx; forces.get(a)!.fy -= fy; }
        if (b !== root.id) { forces.get(b)!.fx += fx; forces.get(b)!.fy += fy; }
      }
    }

    // Integrate velocities → positions
    for (const { id } of rawNodes) {
      if (id === root.id) continue; // root is pinned at origin
      if (frozenPositions?.has(id)) continue; // frozen nodes are pinned
      const v = vel.get(id)!, f = forces.get(id)!;
      v.vx = (v.vx + f.fx) * DAMP;
      v.vy = (v.vy + f.fy) * DAMP;
      const p = pos.get(id)!;
      p.x += Math.max(-maxStep, Math.min(maxStep, v.vx));
      p.y += Math.max(-maxStep, Math.min(maxStep, v.vy));
    }

    // Constraint projection: clamp each child within MAX_EDGE_LEN of its parent
    for (const { id } of rawNodes) {
      if (id === root.id) continue;
      const pid = parentOf.get(id);
      if (!pid) continue;
      const p = pos.get(id)!, pp = pos.get(pid)!;
      const dx = p.x - pp.x, dy = p.y - pp.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      if (dist > MAX_EDGE_LEN) {
        const scale = MAX_EDGE_LEN / dist;
        p.x = pp.x + dx * scale;
        p.y = pp.y + dy * scale;
        // zero out velocity component pushing further away
        const v = vel.get(id)!;
        const dot = v.vx * dx + v.vy * dy;
        if (dot > 0) { v.vx -= dot * dx / (dist * dist); v.vy -= dot * dy / (dist * dist); }
      }
    }
  }

  // ── 4. Build NodeDatum / EdgeDatum  (positionOffset applied on top) ───────
  const nodes: NodeDatum[] = rawNodes.map(info => {
    const p  = pos.get(info.id)!;
    const ox = info.positionOffset?.x ?? 0;
    const oy = info.positionOffset?.y ?? 0;
    return { id: info.id, labelKey: info.labelKey, label: info.label,
      x: p.x + ox, y: p.y + oy,
      depth: info.depth, colorKey: info.colorKey, colorOverride: info.colorOverride };
  });

  const posMap  = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  const colorOf = new Map(rawNodes.map(n => [n.id, { colorKey: n.colorKey, colorOverride: n.colorOverride }]));

  const edges: EdgeDatum[] = rawEdges.map(({ parentId, childId }) => {
    const pa = posMap.get(parentId)!, pb = posMap.get(childId)!;
    const c  = colorOf.get(childId)!;
    const rA = BASE_R[depthOf.get(parentId) ?? 3] ?? 22;
    const rB = BASE_R[depthOf.get(childId)  ?? 3] ?? 22;
    return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
      rParent: rA, rChild: rB,
      colorKey: c.colorKey, colorOverride: c.colorOverride, parentId, childId };
  });

  return { nodes, edges };
}

// ── Text wrap ─────────────────────────────────────────────────────────────────
function wrapText(text: string, maxChars = 10): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Skill node SVG element ────────────────────────────────────────────────────
interface SkillNodeElProps {
  node: NodeDatum; isFocused: boolean; isChild: boolean;
  isMoveMode: boolean; isDraggingNode: boolean;
  dragDx: number; dragDy: number;
  onNodeMouseDown: (e: React.MouseEvent, node: NodeDatum) => void;
  onClick: () => void; label: string;
}

function SkillNodeEl({ node, isFocused, isChild, isMoveMode, isDraggingNode, dragDx, dragDy, onNodeMouseDown, onClick, label }: SkillNodeElProps) {
  const [hovered, setHovered] = useState(false);
  const base = PALETTE[node.colorKey];
  const stroke = node.colorOverride ?? base.stroke;
  const fill   = node.colorOverride ? `${node.colorOverride}22` : base.fill;
  const text   = node.colorOverride ?? base.text;
  const r     = BASE_R[node.depth] ?? 22;
  const lines = wrapText(label);
  const fs    = [12, 11, 9.5, 8.5][node.depth] ?? 8.5;
  const scale = isFocused ? FOCUS_SCALE : isChild ? 1.08 : hovered ? 1.1 : 1;
  const sw    = isFocused ? 2.5 : isChild ? 2 : hovered ? 1.5 : 1;
  const cursor = isMoveMode ? (isFocused ? 'grab' : 'default') : 'pointer';

  const tx = node.x + (isDraggingNode ? dragDx : 0);
  const ty = node.y + (isDraggingNode ? dragDy : 0);

  return (
    <g
      data-node="true"
      transform={`translate(${tx}, ${ty})`}
      onClick={onClick}
      onMouseDown={isMoveMode && isFocused ? (e) => onNodeMouseDown(e, node) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor }}
    >
      {isFocused && (
        <circle r={r * 1.7} fill="none" stroke={stroke} strokeWidth={1}
          opacity={0.35} className={isDraggingNode ? undefined : 'skill-pulse'} />
      )}
      <g style={{
        transformBox: 'fill-box', transformOrigin: 'center',
        transform: `scale(${scale})`,
        transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <circle r={r} fill={fill} stroke={stroke}
          strokeWidth={sw}
          style={{ transition: 'stroke-width 0.2s ease' }} />
        {lines.map((line, i) => (
          <text key={i} textAnchor="middle" dominantBaseline="middle"
            fontSize={fs} fontWeight={isFocused ? 700 : isChild ? 600 : 500}
            fill={isFocused ? text : isChild ? text : '#9aa8b8'}
            y={(i - (lines.length - 1) / 2) * (fs + 2.5)}
            style={{ userSelect: 'none', pointerEvents: 'none' }}>
            {line}
          </text>
        ))}
      </g>
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SkillTree() {
  const { t } = useTranslation();

  // ── Mutable tree state ──
  const [treeRoot, setTreeRootState] = useState<SkillNode>(initialSkillTreeRoot);
  // ── Undo / Redo history ──
  const historyRef = useRef<SkillNode[]>([initialSkillTreeRoot]);
  const historyIdxRef = useRef<number>(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /** Drop-in replacement for setTreeRoot that records history. */
  const setTreeRoot = useCallback((updater: SkillNode | ((prev: SkillNode) => SkillNode)) => {
    setTreeRootState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
      historyRef.current.push(next);
      historyIdxRef.current = historyRef.current.length - 1;
      setCanUndo(true);
      setCanRedo(false);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    setTreeRootState(historyRef.current[historyIdxRef.current]);
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    setTreeRootState(historyRef.current[historyIdxRef.current]);
    setCanUndo(true);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  }, []);

  const [seedPositions, setSeedPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [frozenPositions, setFrozenPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  // Unique tree ID — stable across saves so version-controlled exports are diffable
  const [treeId, setTreeId] = useState<string>(() => crypto.randomUUID());
  const importInputRef = useRef<HTMLInputElement>(null);

  const { nodes, edges } = useMemo(
    () => buildLayout(treeRoot, seedPositions ?? undefined, frozenPositions ?? undefined),
    [treeRoot, seedPositions, frozenPositions],
  );
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const [focusedId, setFocusedId] = useState<string>('root');
  const [panX, setPanX] = useState(VW / 2);
  const [panY, setPanY] = useState(VH / 2);
  const [zoom, setZoom] = useState(1);

  // ── Scroll-to-zoom + trackpad horizontal pan (non-passive so we can preventDefault) ──
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = VW / rect.width;
      const sy = VH / rect.height;

      // Two-finger horizontal swipe → pan horizontally
      if (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setPanX(prev => prev - e.deltaX * sx);
        return;
      }

      // Vertical scroll → zoom towards cursor
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      // Cursor position in SVG viewBox space
      const vx = (e.clientX - rect.left) * sx;
      const vy = (e.clientY - rect.top)  * sy;
      // Adjust pan so the point under the cursor stays fixed
      setPanX(prev => vx + (prev - vx) * factor);
      setPanY(prev => vy + (prev - vy) * factor);
      setZoom(prev => Math.max(0.15, Math.min(5, prev * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Drag-to-pan ──
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Ignore clicks that land on a node circle/text (they have their own handler)
    if ((e.target as Element).closest('[data-node]')) return;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: panX, py: panY };
    setIsDragging(true);
  }, [panX, panY]);

  // Declared here so handleSvgMouseMove/Up can reference them without TDZ errors
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [nodeDragOffset, setNodeDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const nodeDragStartRef = useRef<{
    nodeId: string;
    startMx: number; startMy: number;
    svgScaleX: number; svgScaleY: number;
  } | null>(null);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Node drag takes priority
    if (nodeDragStartRef.current) {
      const { startMx, startMy, svgScaleX, svgScaleY } = nodeDragStartRef.current;
      setNodeDragOffset({
        dx: (e.clientX - startMx) * svgScaleX,
        dy: (e.clientY - startMy) * svgScaleY,
      });
      return;
    }
    if (!dragStartRef.current) return;
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = VW / rect.width;
    const sy = VH / rect.height;
    setPanX(dragStartRef.current.px + (e.clientX - dragStartRef.current.mx) * sx);
    setPanY(dragStartRef.current.py + (e.clientY - dragStartRef.current.my) * sy);
  }, []);

  const handleSvgMouseUp = useCallback(() => {
    // Commit the node drag offset into the tree
    if (nodeDragStartRef.current && nodeDragOffset) {
      const { nodeId } = nodeDragStartRef.current;
      const { dx, dy } = nodeDragOffset;
      setTreeRoot(prev => {
        // Collect all IDs that need offsetting: the dragged node + all its descendants
        const draggedIds = new Set<string>();
        function collectDescendants(node: SkillNode, capturing: boolean) {
          if (capturing || node.id === nodeId) {
            draggedIds.add(node.id);
            node.children?.forEach(child => collectDescendants(child, true));
          } else {
            node.children?.forEach(child => collectDescendants(child, false));
          }
        }
        collectDescendants(prev, false);

        function applyOffset(node: SkillNode): SkillNode {
          if (draggedIds.has(node.id)) {
            const off = node.positionOffset ?? { x: 0, y: 0 };
            return { ...node, positionOffset: { x: off.x + dx, y: off.y + dy }, children: node.children?.map(applyOffset) };
          }
          return { ...node, children: node.children?.map(applyOffset) };
        }
        return applyOffset(prev);
      });
      nodeDragStartRef.current = null;
      setNodeDragOffset(null);
      return;
    }
    dragStartRef.current = null;
    setIsDragging(false);
  }, [nodeDragOffset]);

  // ── Add-node dialog ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newNodeTitle, setNewNodeTitle] = useState('');
  const [newNodeColor, setNewNodeColor] = useState('#94a3b8');

  const openAddDialog = useCallback(() => {
    const focused = nodeMap.get(focusedId);
    const parentColor = focused?.colorOverride ?? PALETTE[focused?.colorKey ?? 'default'].stroke;
    setNewNodeTitle('');
    setNewNodeColor(parentColor);
    setDialogOpen(true);
  }, [focusedId, nodeMap]);

  const handleAddNodeConfirm = useCallback(() => {
    if (!newNodeTitle.trim()) return;
    const id = `custom_${Date.now()}`;
    const newNode: SkillNode = {
      id,
      labelKey: `custom:${id}`,
      label: newNodeTitle.trim(),
      colorOverride: newNodeColor,
    };

    // Freeze all existing nodes so the spring simulation only places the new node,
    // leaving the rest of the layout completely undisturbed.
    // frozenPositions stores spring-basis positions (visual pos minus positionOffset).
    const offsetMap = new Map<string, { x: number; y: number }>();
    function collectOffsets(node: SkillNode) {
      offsetMap.set(node.id, node.positionOffset ?? { x: 0, y: 0 });
      node.children?.forEach(collectOffsets);
    }
    collectOffsets(treeRoot);
    const newFrozen = new Map<string, { x: number; y: number }>();
    for (const [nid, datum] of nodeMap) {
      const off = offsetMap.get(nid) ?? { x: 0, y: 0 };
      newFrozen.set(nid, { x: datum.x - off.x, y: datum.y - off.y });
    }
    setFrozenPositions(newFrozen);
    setSeedPositions(null);

    function insertChild(node: SkillNode): SkillNode {
      if (node.id === focusedId) {
        return { ...node, children: [...(node.children ?? []), newNode] };
      }
      if (!node.children?.length) return node;
      return { ...node, children: node.children.map(insertChild) };
    }

    setTreeRoot(prev => insertChild(prev));
    setFocusedId(id);
    setDialogOpen(false);
  }, [focusedId, newNodeTitle, newNodeColor, nodeMap, treeRoot]);

  const handleAddNodeCancel = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // ── Delete node (with all descendants) ──────────────────────────────────
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteRequest = useCallback(() => {
    if (!focusedId || focusedId === treeRoot.id) return; // root cannot be deleted
    setDeleteDialogOpen(true);
  }, [focusedId, treeRoot.id]);

  const handleDeleteConfirm = useCallback(() => {
    const targetId = focusedId;
    setTreeRoot(prev => {
      function removeNode(node: SkillNode): SkillNode {
        return { ...node, children: node.children?.filter(c => c.id !== targetId).map(removeNode) };
      }
      return removeNode(prev);
    });
    // Also remove frozen/seed positions for deleted subtree descendants
    setFrozenPositions(prev => {
      if (!prev) return prev;
      const next = new Map(prev);
      next.delete(targetId);
      return next;
    });
    // Focus the root after deletion
    setFocusedId(treeRoot.id);
    setDeleteDialogOpen(false);
  }, [focusedId, treeRoot.id]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  // ── Clean-up: seed spring from current visual positions, then strip offsets ──
  // React 18 batches both setState calls → single re-render → buildLayout gets
  // the seed AND the stripped tree at the same time, so the spring settles from
  // where the nodes currently are rather than jumping back to a radial init.
  const handleCleanup = useCallback(() => {
    // Capture current visual positions (positionOffset already baked into n.x/n.y)
    setSeedPositions(new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }])));
    setFrozenPositions(null); // unfreeze so spring can re-settle
    setTreeRoot(prev => {
      function stripOffsets(node: SkillNode): SkillNode {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { positionOffset: _p, ...rest } = node;
        return { ...rest, children: node.children?.map(stripOffsets) };
      }
      return stripOffsets(prev);
    });
  }, [nodes]);

  // ── Export: flat sorted JSON, one line per node for clean git diffs ──────
  const handleExport = useCallback(() => {
    const flatNodes: ExportNode[] = [];
    function flatten(node: SkillNode, parentId: string | null) {
      const label = node.label ?? t(node.labelKey);
      const entry: ExportNode = { id: node.id, label, parentId };
      if (node.colorOverride) entry.colorOverride = node.colorOverride;
      // Save the final visual position (spring position + positionOffset already baked in)
      // so import can warm-start the spring from exactly these coordinates.
      const datum = nodeMap.get(node.id);
      if (datum && parentId !== null) entry.position = { x: Math.round(datum.x), y: Math.round(datum.y) };
      flatNodes.push(entry);
      (node.children ?? []).forEach(child => flatten(child, node.id));
    }
    flatten(treeRoot, null);
    // Sort by id so adding/removing a node produces a minimal one-line diff
    flatNodes.sort((a, b) => a.id.localeCompare(b.id));
    // Warn on duplicate labels (version-control friendliness depends on uniqueness)
    const labelCounts = new Map<string, number>();
    flatNodes.forEach(n => labelCounts.set(n.label, (labelCounts.get(n.label) ?? 0) + 1));
    const dupes = [...new Set(flatNodes.filter(n => (labelCounts.get(n.label) ?? 0) > 1).map(n => n.label))];
    if (dupes.length) console.warn('[skill-tree] Duplicate node labels detected:', dupes);

    const payload: SkillTreeExport = { treeId, version: 1, nodes: flatNodes };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skill-tree-${treeId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [treeRoot, treeId, t, nodeMap]);

  // ── Import: restore tree + layout from exported JSON ─────────────────────
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const payload = JSON.parse(evt.target?.result as string) as SkillTreeExport;
        const nodeList = payload.nodes;

        // Collect saved positions to warm-start the spring simulation
        const seedMap = new Map<string, { x: number; y: number }>();
        nodeList.forEach(n => { if (n.position) seedMap.set(n.id, n.position); });

        function buildNode(id: string): SkillNode {
          const en = nodeList.find(n => n.id === id)!;
          const children = nodeList.filter(n => n.parentId === id).map(n => buildNode(n.id));
          const node: SkillNode = { id: en.id, labelKey: `imported:${en.id}`, label: en.label, children };
          if (en.colorOverride) node.colorOverride = en.colorOverride;
          // No positionOffset: positions are passed as seedPositions instead
          return node;
        }

        const rootExport = nodeList.find(n => n.parentId === null);
        if (!rootExport) throw new Error('No root node found');
        setTreeRoot(buildNode(rootExport.id));
        setTreeId(payload.treeId);
        setSeedPositions(null);
        setFrozenPositions(seedMap.size > 0 ? seedMap : null);
        setFocusedId(rootExport.id);
      } catch (err) {
        console.error('[skill-tree] Import failed:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset so the same file can be re-imported
  }, []);

  // ── Move-node mode (drag-based) ──
  const toggleMoveMode = useCallback(() => {
    setIsMoveMode(prev => !prev);
    setNodeDragOffset(null);
    nodeDragStartRef.current = null;
  }, []);

  // Keyboard shortcuts: 'm' toggles move mode; Ctrl+Z undo; Ctrl+Shift+Z / Ctrl+Y redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) { redo(); } else { undo(); }
        return;
      }
      if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        redo();
        return;
      }
      if (isTyping) return;
      if (e.key === 'm' || e.key === 'M') toggleMoveMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMoveMode, undo, redo]);

  /** Collect IDs of the focused node and all its descendants */
  const getDraggedIds = useCallback((rootId: string): Set<string> => {
    const ids = new Set<string>();
    const queue = [rootId];
    while (queue.length) {
      const id = queue.pop()!;
      ids.add(id);
      edges.forEach(e => { if (e.parentId === id) queue.push(e.childId); });
    }
    return ids;
  }, [edges]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: NodeDatum) => {
    if (!isMoveMode) return;
    e.stopPropagation(); // don't start a pan drag
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    nodeDragStartRef.current = {
      nodeId: node.id,
      startMx: e.clientX,
      startMy: e.clientY,
      // Convert screen pixels → content-space units (viewBox / zoom)
      svgScaleX: VW / rect.width / zoom,
      svgScaleY: VH / rect.height / zoom,
    };
    setNodeDragOffset({ dx: 0, dy: 0 });
  }, [isMoveMode, zoom]);

  // ── Node click: always focuses the node; in move mode this picks the node to drag ──
  const handleNodeClick = useCallback((node: NodeDatum) => {
    setFocusedId(node.id);
  }, []);

  const childrenIds = useMemo(() => {
    const s = new Set<string>();
    edges.forEach(e => { if (e.parentId === focusedId) s.add(e.childId); });
    return s;
  }, [edges, focusedId]);

  const ancestorPath = useMemo(() => {
    const path: NodeDatum[] = [];
    let current = focusedId;
    while (true) {
      const parentEdge = edges.find(e => e.childId === current);
      if (!parentEdge) break;
      const parent = nodeMap.get(parentEdge.parentId);
      if (!parent) break;
      path.unshift(parent);
      current = parent.id;
    }
    return path;
  }, [edges, nodeMap, focusedId]);

  const focusedNode = nodeMap.get(focusedId);

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: TREE_BG, overflow: 'hidden' }}>
      {/* Hidden file input for importing a tree JSON */}
      <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />

      {/* ── Full-screen SVG ── */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', cursor: (isMoveMode && nodeDragOffset) ? 'grabbing' : isMoveMode ? 'default' : isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        <rect width={VW} height={VH} fill={TREE_BG} />

        <g style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
          {(() => {
            // Compute once for both edges and nodes
            const draggedIds = nodeDragOffset ? getDraggedIds(focusedId) : null;
            const ddx = nodeDragOffset?.dx ?? 0;
            const ddy = nodeDragOffset?.dy ?? 0;
            return (<>
              {/* Edges */}
              {edges.map((e, i) => {
                const stroke = e.colorOverride ?? PALETTE[e.colorKey].stroke;
                const toChild  = e.parentId === focusedId;
                const toParent = e.childId  === focusedId;
                const sw       = toChild ? 2 : toParent ? 1.2 : 0.8;
                const opacity  = toChild ? 0.75 : toParent ? 0.35 : 0.15;
                const parentDragged = draggedIds?.has(e.parentId);
                const childDragged  = draggedIds?.has(e.childId);
                // Center positions with drag applied
                const cx1 = e.x1 + (parentDragged ? ddx : 0);
                const cy1 = e.y1 + (parentDragged ? ddy : 0);
                const cx2 = e.x2 + (childDragged  ? ddx : 0);
                const cy2 = e.y2 + (childDragged  ? ddy : 0);
                // Trim to circumference, accounting for focus/child CSS scale
                const pScale = e.parentId === focusedId ? FOCUS_SCALE : childrenIds.has(e.parentId) ? 1.08 : 1;
                const cScale = e.childId  === focusedId ? FOCUS_SCALE : childrenIds.has(e.childId)  ? 1.08 : 1;
                const edx = cx2 - cx1, edy = cy2 - cy1;
                const norm = Math.hypot(edx, edy) || 1;
                const x1 = cx1 + e.rParent * pScale * edx / norm;
                const y1 = cy1 + e.rParent * pScale * edy / norm;
                const x2 = cx2 - e.rChild  * cScale * edx / norm;
                const y2 = cy2 - e.rChild  * cScale * edy / norm;
                return (
                  <line key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={stroke} strokeWidth={sw} strokeOpacity={opacity}
                    style={{ transition: 'stroke-opacity 0.35s ease, stroke-width 0.35s ease' }}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map(n => {
                const isDraggingNode = !!(draggedIds?.has(n.id));
                return (
                  <SkillNodeEl key={n.id} node={n}
                    isFocused={n.id === focusedId}
                    isChild={childrenIds.has(n.id)}
                    isMoveMode={isMoveMode}
                    isDraggingNode={isDraggingNode}
                    dragDx={ddx}
                    dragDy={ddy}
                    onNodeMouseDown={handleNodeMouseDown}
                    onClick={() => handleNodeClick(n)}
                    label={n.label ?? t(n.labelKey)}
                  />
                );
              })}
            </>);
          })()}
        </g>

        <style>{`
          @keyframes skill-pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50%       { opacity: 0;   transform: scale(1.55); }
          }
          .skill-pulse {
            transform-box: fill-box;
            transform-origin: center;
            animation: skill-pulse 2.8s ease-in-out infinite;
          }
        `}</style>
      </svg>

      {/* ── Breadcrumbs overlay (top-left) ── */}
      <Box sx={{
        position: 'absolute', top: 20, left: 24,
        display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap',
      }}>
        {ancestorPath.map((ancestor) => {
          const color = PALETTE[ancestor.colorKey].stroke;
          return (
            <Box key={ancestor.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                variant="caption"
                onClick={() => { const n = nodeMap.get(ancestor.id); if (n) handleNodeClick(n); }}
                sx={{
                  cursor: 'pointer', color: 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                  '&:hover': { color, textDecoration: 'underline' },
                }}
              >
                {t(ancestor.labelKey)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>/</Typography>
            </Box>
          );
        })}
        {focusedNode && (
          <Typography variant="caption" sx={{
            color: PALETTE[focusedNode.colorKey].stroke,
            fontWeight: 700,
          }}>
            {t(focusedNode.labelKey)}
          </Typography>
        )}
      </Box>

      {/* ── Hint overlay (top-right) ── */}
      <Box sx={{
        position: 'absolute', top: 20, right: 24,
      }}>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem' }}>
          {t('tree.hint')}
        </Typography>
      </Box>

      {/* ── Legend overlay (bottom-left) ── */}
      <Box sx={{
        position: 'absolute', bottom: 20, left: 24,
        display: 'flex', gap: 2.5, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {(treeRoot.children ?? []).map(cat => {
          const ck = (CAT_KEYS[cat.id] ?? 'default') as PKey;
          const color = PALETTE[ck].stroke;
          const isFocusedCat = focusedId === cat.id || childrenIds.has(cat.id);
          return (
            <Box key={cat.id}
              onClick={() => { const n = nodeMap.get(cat.id); if (n) handleNodeClick(n); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                opacity: isFocusedCat ? 1 : 0.45,
                transition: 'opacity 0.3s ease',
                '&:hover': { opacity: 1 },
              }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="caption" sx={{
                color, fontWeight: 600, fontSize: '0.7rem', letterSpacing: 0.5,
              }}>
                {t(cat.labelKey)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* ── Command palette (bottom-right) ── */}
      <Box sx={{
        position: 'absolute', bottom: 20, right: 24,
        display: 'flex', gap: 1, alignItems: 'center',
      }}>
        {/* Undo button */}
        <Box sx={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid', borderColor: canUndo ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)', borderRadius: 1, bgcolor: canUndo ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)', transition: 'border-color 0.3s, background-color 0.3s' }}>
          <Tooltip title={t('tree.undo')} placement="top" arrow>
            <Box component="button" onClick={canUndo ? undo : undefined} disabled={!canUndo}
              sx={{ all: 'unset', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', cursor: canUndo ? 'pointer' : 'not-allowed', color: canUndo ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)', transition: 'color 0.2s, background-color 0.2s', '&:hover': canUndo ? { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } : {} }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 7H13a4 4 0 010 8H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 4L3 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Redo button */}
        <Box sx={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid', borderColor: canRedo ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)', borderRadius: 1, bgcolor: canRedo ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)', transition: 'border-color 0.3s, background-color 0.3s' }}>
          <Tooltip title={t('tree.redo')} placement="top" arrow>
            <Box component="button" onClick={canRedo ? redo : undefined} disabled={!canRedo}
              sx={{ all: 'unset', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', cursor: canRedo ? 'pointer' : 'not-allowed', color: canRedo ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)', transition: 'color 0.2s, background-color 0.2s', '&:hover': canRedo ? { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } : {} }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M15 7H5a4 4 0 000 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Separator */}
        <Box sx={{ width: '1px', height: 32, bgcolor: 'rgba(255,255,255,0.1)', mx: 0.5 }} />

        {/* Import button */}
        <Box sx={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }}>
          <Tooltip title={t('tree.importTree')} placement="top" arrow>
            <Box component="button" onClick={() => importInputRef.current?.click()}
              sx={{ all: 'unset', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s, background-color 0.2s', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 11V3M9 3L5.5 6.5M9 3L12.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Export button */}
        <Box sx={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }}>
          <Tooltip title={t('tree.exportTree')} placement="top" arrow>
            <Box component="button" onClick={handleExport}
              sx={{ all: 'unset', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s, background-color 0.2s', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 3v8M9 11L5.5 7.5M9 11L12.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Separator */}
        <Box sx={{ width: '1px', height: 32, bgcolor: 'rgba(255,255,255,0.1)', mx: 0.5 }} />

        {/* Clean-up button */}
        <Box sx={{
          width: 52, height: 52,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 1,
          bgcolor: 'rgba(255,255,255,0.04)',
        }}>
          <Tooltip title={t('tree.cleanUp')} placement="top" arrow>
            <Box
              component="button"
              onClick={handleCleanup}
              sx={{
                all: 'unset',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.7)',
                transition: 'color 0.2s, background-color 0.2s',
                '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' },
              }}
            >
              {/* Radial-burst / auto-layout icon */}
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="9" y1="1" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="9" y1="13" x2="9" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="1" y1="9" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="13" y1="9" x2="17" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="3.1" y1="3.1" x2="5.9" y2="5.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="12.1" y1="12.1" x2="14.9" y2="14.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="14.9" y1="3.1" x2="12.1" y2="5.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="5.9" y1="12.1" x2="3.1" y2="14.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Move button */}
        <Box sx={{
          width: 52, height: 52,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid',
          borderColor: isMoveMode ? 'rgba(255,255,255,0.5)' : focusedId ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
          borderRadius: 1,
          bgcolor: isMoveMode ? 'rgba(255,255,255,0.1)' : focusedId ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
          transition: 'border-color 0.3s, background-color 0.3s',
        }}>
          <Tooltip
            title={!focusedId ? t('tree.selectNodeFirst') : isMoveMode ? t('tree.cancelMove') : t('tree.moveNode')}
            placement="top"
            arrow
          >
            <Box
              component="button"
              onClick={focusedId ? toggleMoveMode : undefined}
              disabled={!focusedId}
              sx={{
                all: 'unset',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                cursor: focusedId ? 'pointer' : 'not-allowed',
                color: isMoveMode ? '#fff' : focusedId ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
                transition: 'color 0.2s, background-color 0.2s',
                '&:hover': focusedId ? { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } : {},
              }}
            >
              {/* Arrow-cross / move icon drawn in SVG */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2 L10 18 M2 10 L18 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M10 2 L7.5 5 M10 2 L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 18 L7.5 15 M10 18 L12.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 10 L5 7.5 M2 10 L5 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18 10 L15 7.5 M18 10 L15 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Box>
          </Tooltip>
        </Box>

        {/* Add button */}
        <Box sx={{
          width: 52, height: 52,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid',
          borderColor: focusedId ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
          borderRadius: 1,
          bgcolor: focusedId ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
          transition: 'border-color 0.3s, background-color 0.3s',
        }}>
          <Tooltip
            title={focusedId ? t('tree.addNode') : t('tree.selectNodeFirst')}
            placement="top"
            arrow
          >
            <Box
              component="button"
              onClick={focusedId ? openAddDialog : undefined}
              disabled={!focusedId}
              sx={{
                all: 'unset',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                cursor: focusedId ? 'pointer' : 'not-allowed',
                color: focusedId ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
                fontSize: '1.5rem', lineHeight: 1,
                transition: 'color 0.2s, background-color 0.2s',
                '&:hover': focusedId ? { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } : {},
              }}
            >
              +
            </Box>
          </Tooltip>
        </Box>

        {/* Delete button — disabled for root node */}
        {(() => {
          const canDelete = !!focusedId && focusedId !== treeRoot.id;
          return (
            <Box sx={{
              width: 52, height: 52,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid',
              borderColor: canDelete ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.06)',
              borderRadius: 1,
              bgcolor: canDelete ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.01)',
              transition: 'border-color 0.3s, background-color 0.3s',
            }}>
              <Tooltip
                title={!focusedId || focusedId === treeRoot.id ? t('tree.selectNodeFirst') : t('tree.deleteNode')}
                placement="top" arrow
              >
                <Box
                  component="button"
                  onClick={canDelete ? handleDeleteRequest : undefined}
                  disabled={!canDelete}
                  sx={{
                    all: 'unset',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: '50%',
                    cursor: canDelete ? 'pointer' : 'not-allowed',
                    color: canDelete ? 'rgba(239,68,68,0.8)' : 'rgba(255,255,255,0.2)',
                    transition: 'color 0.2s, background-color 0.2s',
                    '&:hover': canDelete ? { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.12)' } : {},
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 5h12M7 5V3h4v2M8 8v6M10 8v6M4 5l1 10a1 1 0 001 1h6a1 1 0 001-1L14 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Box>
              </Tooltip>
            </Box>
          );
        })()}
      </Box>

      {/* ── Move mode banner ── */}
      {isMoveMode && (
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%) translateY(-220px)',
          pointerEvents: 'none',
          bgcolor: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 1,
          px: 2.5, py: 1,
        }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', letterSpacing: 0.5 }}>
            {t('tree.moveBanner')}
          </Typography>
        </Box>
      )}

      {/* ── Add Node dialog ── */}
      <Dialog
        open={dialogOpen}
        onClose={handleAddNodeCancel}
        PaperProps={{
          sx: {
            bgcolor: '#252b34', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.1)',
            minWidth: 340,
          },
        }}
      >
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700, pb: 1 }}>
          {t('tree.addNode')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            autoFocus
            label={t('tree.nodeTitle')}
            value={newNodeTitle}
            onChange={e => setNewNodeTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddNodeConfirm(); }}
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                color: '#e2e8f0',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.4)' },
                '&.Mui-focused fieldset': { borderColor: newNodeColor },
              },
              '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.45)' },
              '& .MuiInputLabel-root.Mui-focused': { color: newNodeColor },
            }}
          />
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', mb: 1, display: 'block' }}>
              {t('tree.nodeColor')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {COLOR_SWATCHES.map(color => (
                <Box
                  key={color}
                  onClick={() => setNewNodeColor(color)}
                  sx={{
                    width: 24, height: 24, borderRadius: '50%',
                    bgcolor: color,
                    cursor: 'pointer',
                    border: newNodeColor === color ? '2px solid #fff' : '2px solid transparent',
                    boxShadow: newNodeColor === color ? `0 0 0 1px ${color}` : 'none',
                    transition: 'transform 0.15s, border-color 0.15s',
                    '&:hover': { transform: 'scale(1.2)' },
                  }}
                />
              ))}
              {/* custom hex input swatch */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  component="input"
                  type="color"
                  value={newNodeColor}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNodeColor(e.target.value)}
                  sx={{
                    width: 24, height: 24, borderRadius: '50%',
                    border: 'none', padding: 0, cursor: 'pointer',
                    background: 'none',
                    '&::-webkit-color-swatch-wrapper': { padding: 0 },
                    '&::-webkit-color-swatch': { borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)' },
                  }}
                />
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button
            onClick={handleAddNodeCancel}
            size="small"
            sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#fff' } }}
          >
            {t('tree.cancel')}
          </Button>
          <Button
            onClick={handleAddNodeConfirm}
            disabled={!newNodeTitle.trim()}
            size="small"
            variant="contained"
            sx={{
              bgcolor: newNodeColor, color: '#111',
              fontWeight: 700,
              '&:hover': { bgcolor: newNodeColor, filter: 'brightness(1.15)' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' },
            }}
          >
            {t('tree.ok')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        PaperProps={{
          sx: {
            bgcolor: '#252b34', color: '#e2e8f0',
            border: '1px solid rgba(239,68,68,0.25)',
            minWidth: 320,
          },
        }}
      >
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700, pb: 1, color: '#fca5a5' }}>
          {t('tree.deleteConfirmTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.65)' }}>
            {t('tree.deleteConfirmBody', { name: nodeMap.get(focusedId ?? '')?.label ?? t((nodeMap.get(focusedId ?? '')?.labelKey) ?? '') })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button
            onClick={handleDeleteCancel}
            size="small"
            sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#fff' } }}
          >
            {t('tree.cancel')}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            size="small"
            variant="contained"
            sx={{
              bgcolor: '#ef4444', color: '#fff',
              fontWeight: 700,
              '&:hover': { bgcolor: '#dc2626' },
            }}
          >
            {t('tree.deleteConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
