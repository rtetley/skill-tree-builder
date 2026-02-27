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
const D1 = 225;                    // root → category
const D2 = 162;                    // category → sub
const D3 = 108;                    // sub → leaf
const SPREAD_L2 = Math.PI * 0.65;
const SPREAD_L3 = Math.PI * 0.55;
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
  x1: number; y1: number; x2: number; y2: number;
  colorKey: PKey; colorOverride?: string; parentId: string; childId: string;
}

// ── Full-tree layout ──────────────────────────────────────────────────────────
function buildLayout(root: SkillNode): { nodes: NodeDatum[]; edges: EdgeDatum[] } {
  const nodes: NodeDatum[] = [];
  const edges: EdgeDatum[] = [];

  function walk(
    node: SkillNode, x: number, y: number, outAngle: number,
    depth: number, parentPos: { x: number; y: number } | null,
    parentId: string | null, colorKey: PKey, colorOverride?: string,
  ) {
    nodes.push({ id: node.id, labelKey: node.labelKey, label: node.label, x, y, depth, colorKey, colorOverride: node.colorOverride ?? colorOverride });
    if (parentId !== null && parentPos !== null)
      edges.push({ x1: parentPos.x, y1: parentPos.y, x2: x, y2: y, colorKey, colorOverride: node.colorOverride ?? colorOverride, parentId, childId: node.id });

    const children = node.children ?? [];
    if (!children.length) return;
    const pos = { x, y };

    if (depth === 0) {
      children.forEach((child, i) => {
        const angle = (2 * Math.PI * i) / children.length - Math.PI / 2;
        const ck = (CAT_KEYS[child.id] ?? 'default') as PKey;
        walk(child, D1 * Math.cos(angle), D1 * Math.sin(angle), angle, 1, pos, node.id, ck, child.colorOverride);
      });
    } else {
      const spread = depth === 1 ? SPREAD_L2 : SPREAD_L3;
      const dist   = depth === 1 ? D2 : D3;
      const childColorOverride = node.colorOverride ?? colorOverride;
      children.forEach((child, i) => {
        const angle = children.length === 1
          ? outAngle
          : outAngle - spread / 2 + (i * spread) / (children.length - 1);
        walk(child, x + dist * Math.cos(angle), y + dist * Math.sin(angle),
          angle, depth + 1, pos, node.id, colorKey, child.colorOverride ?? childColorOverride);
      });
    }
  }

  walk(root, 0, 0, -Math.PI / 2, 0, null, null, 'root');
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
  onClick: () => void; label: string;
}

function SkillNodeEl({ node, isFocused, isChild, onClick, label }: SkillNodeElProps) {
  const [hovered, setHovered] = useState(false);
  const base = PALETTE[node.colorKey];
  const stroke = node.colorOverride ?? base.stroke;
  // derive fill/text from override: darken the override color for fill, lighten for text
  const fill   = node.colorOverride ? `${node.colorOverride}22` : base.fill;
  const text   = node.colorOverride ?? base.text;
  const r     = BASE_R[node.depth] ?? 22;
  const lines = wrapText(label);
  const fs    = [12, 11, 9.5, 8.5][node.depth] ?? 8.5;
  const scale = isFocused ? FOCUS_SCALE : isChild ? 1.08 : hovered ? 1.1 : 1;
  const sw    = isFocused ? 2.5 : isChild ? 2 : hovered ? 1.5 : 1;

  return (
    <g
      data-node="true"
      transform={`translate(${node.x}, ${node.y})`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: 'pointer' }}
    >
      {isFocused && (
        <circle r={r * 1.7} fill="none" stroke={stroke} strokeWidth={1}
          opacity={0.35} className="skill-pulse" />
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
  const [treeRoot, setTreeRoot] = useState<SkillNode>(initialSkillTreeRoot);

  const { nodes, edges } = useMemo(() => buildLayout(treeRoot), [treeRoot]);
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const [focusedId, setFocusedId] = useState<string>('root');
  const [panX, setPanX] = useState(VW / 2);
  const [panY, setPanY] = useState(VH / 2);

  // ── Node click: only focuses (enlarges) the node, no auto-pan ──
  const handleNodeClick = useCallback((node: NodeDatum) => {
    setFocusedId(node.id);
  }, []);

  // ── Scroll-to-pan (non-passive so we can preventDefault) ──
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = VW / rect.width;
      const sy = VH / rect.height;
      setPanX(prev => prev - e.deltaX * sx);
      setPanY(prev => prev - e.deltaY * sy);
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

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
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
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

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
  }, [focusedId, newNodeTitle, newNodeColor]);

  const handleAddNodeCancel = useCallback(() => {
    setDialogOpen(false);
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

      {/* ── Full-screen SVG ── */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        <rect width={VW} height={VH} fill={TREE_BG} />

        <g style={{ transform: `translate(${panX}px, ${panY}px)` }}>
          {/* Edges */}
          {edges.map((e, i) => {
            const { stroke } = PALETTE[e.colorKey];
            const toChild  = e.parentId === focusedId;
            const toParent = e.childId  === focusedId;
            const sw       = toChild ? 2 : toParent ? 1.2 : 0.8;
            const opacity  = toChild ? 0.75 : toParent ? 0.35 : 0.15;
            return (
              <line key={i}
                x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                stroke={stroke} strokeWidth={sw} strokeOpacity={opacity}
                style={{ transition: 'stroke-opacity 0.35s ease, stroke-width 0.35s ease' }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map(n => (
            <SkillNodeEl key={n.id} node={n}
              isFocused={n.id === focusedId}
              isChild={childrenIds.has(n.id)}
              onClick={() => handleNodeClick(n)}
              label={n.label ?? t(n.labelKey)}
            />
          ))}
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
              '&:hover': focusedId ? {
                color: '#fff',
                bgcolor: 'rgba(255,255,255,0.08)',
              } : {},
            }}
          >
            +
          </Box>
        </Tooltip>
      </Box>

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

    </Box>
  );
}
