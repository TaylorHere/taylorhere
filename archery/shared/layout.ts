export type PagePreset = 'A4' | 'A3' | 'custom';
export type TargetColorMode = 'bw' | 'color';
export type LayoutMode = 'auto_fill' | 'target_count';
export type SpacingMode = 'auto_min' | 'manual';

export interface LayoutInput {
  pageWidthMm: number;
  pageHeightMm: number;
  targetDiameterMm: number;
  minSpacingMm?: number;
  spacingMode?: SpacingMode;
  manualMarginMm?: number;
  manualTargetSpacingMm?: number;
  layoutMode?: LayoutMode;
  desiredTargets?: number;
}

export interface LayoutSolution {
  columns: number;
  rows: number;
  spacingMm: number;
  marginMm: number;
  totalTargets: number;
}

export interface NearbyLayoutSuggestion {
  diameterMm: number;
  layout: LayoutSolution;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const EPS = 1e-7;
const COLOR_RING_OUTER = '#000000';
const COLOR_RING_CENTER = '#facc15';

export const PAGE_PRESETS_MM: Record<Exclude<PagePreset, 'custom'>, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

export function validateInput(input: LayoutInput): ValidationResult {
  const values: Array<[string, number]> = [
    ['pageWidthMm', input.pageWidthMm],
    ['pageHeightMm', input.pageHeightMm],
    ['targetDiameterMm', input.targetDiameterMm],
  ];

  for (const [name, value] of values) {
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `${name} 必须是大于 0 的数字` };
    }
  }

  const spacingMode = normalizeSpacingMode(input.spacingMode);
  if (spacingMode === 'manual') {
    const manualMargin = Number(input.manualMarginMm);
    const manualSpacing = Number(input.manualTargetSpacingMm);
    if (!Number.isFinite(manualMargin) || manualMargin < 0) {
      return { ok: false, reason: '手动模式下页边距必须是大于等于 0 的数字' };
    }
    if (!Number.isFinite(manualSpacing) || manualSpacing < 0) {
      return { ok: false, reason: '手动模式下靶间距必须是大于等于 0 的数字' };
    }
  } else {
    const minSpacingMm = Number(input.minSpacingMm);
    if (!Number.isFinite(minSpacingMm) || minSpacingMm <= 0) {
      return { ok: false, reason: '自动模式下 minSpacingMm 必须是大于 0 的数字' };
    }
  }

  const mode = normalizeLayoutMode(input.layoutMode);
  if (mode === 'target_count') {
    const desiredTargets = Number(input.desiredTargets);
    if (!Number.isFinite(desiredTargets) || desiredTargets <= 0) {
      return { ok: false, reason: '指定数量模式下 desiredTargets 必须是大于 0 的数字' };
    }
  }

  return { ok: true };
}

export function solveOptimalLayout(input: LayoutInput): LayoutSolution | null {
  const validation = validateInput(input);
  if (!validation.ok) {
    return null;
  }

  const spacingMode = normalizeSpacingMode(input.spacingMode);
  if (spacingMode === 'manual') {
    return solveManualSpacingLayout(input);
  }

  const W = input.pageWidthMm;
  const H = input.pageHeightMm;
  const D = input.targetDiameterMm;
  const sMin = Number(input.minSpacingMm);

  const maxColumns = Math.floor((W - sMin) / (D + sMin));
  const maxRows = Math.floor((H - sMin) / (D + sMin));
  if (maxColumns < 1 || maxRows < 1) {
    return null;
  }

  const candidates: LayoutSolution[] = [];

  // 穷举整数列数 n、行数 m，严格约束同一个 s 同时满足宽高公式：
  // W = nD + (n+1)s
  // H = mD + (m+1)s
  for (let n = 1; n <= maxColumns; n += 1) {
    for (let m = 1; m <= maxRows; m += 1) {
      const spacingFromWidth = (W - n * D) / (n + 1);
      const spacingFromHeight = (H - m * D) / (m + 1);

      if (spacingFromWidth < sMin - EPS || spacingFromHeight < sMin - EPS) {
        continue;
      }

      if (Math.abs(spacingFromWidth - spacingFromHeight) > EPS) {
        continue;
      }

      const spacingMm = (spacingFromWidth + spacingFromHeight) / 2;
      const checkWidth = n * D + (n + 1) * spacingMm;
      const checkHeight = m * D + (m + 1) * spacingMm;
      if (Math.abs(checkWidth - W) > 1e-6 || Math.abs(checkHeight - H) > 1e-6) {
        continue;
      }

      const totalTargets = n * m;
      const candidate: LayoutSolution = {
        columns: n,
        rows: m,
        spacingMm,
        marginMm: spacingMm,
        totalTargets,
      };

      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const mode = normalizeLayoutMode(input.layoutMode);
  if (mode === 'target_count') {
    return pickClosestByDesiredTargets(candidates, Math.max(1, Math.round(Number(input.desiredTargets))));
  }

  return pickAutoFillBest(candidates);
}

export function diagnoseNoLayoutReason(input: LayoutInput): string {
  const validation = validateInput(input);
  if (!validation.ok) {
    return validation.reason ?? '参数无效';
  }

  const spacingMode = normalizeSpacingMode(input.spacingMode);
  if (spacingMode === 'manual') {
    const marginMm = Number(input.manualMarginMm);
    const D = input.targetDiameterMm;
    const maxUsableWidth = input.pageWidthMm - 2 * marginMm;
    const maxUsableHeight = input.pageHeightMm - 2 * marginMm;
    if (maxUsableWidth < D - EPS || maxUsableHeight < D - EPS) {
      return '手动页边距过大：当前页面可用区域不足以放下 1 个标靶。请减小页边距或直径。';
    }
    return '当前手动页边距/靶间距组合无可行排布。请减小页边距、靶间距或标靶直径。';
  }

  const W = input.pageWidthMm;
  const H = input.pageHeightMm;
  const D = input.targetDiameterMm;
  const sMin = Number(input.minSpacingMm);

  // s > 0 时，必须满足 n·D < W 且 m·D < H。
  const maxColumnsWithPositiveSpacing = Math.floor((W - EPS) / D);
  const maxRowsWithPositiveSpacing = Math.floor((H - EPS) / D);
  if (maxColumnsWithPositiveSpacing < 1 || maxRowsWithPositiveSpacing < 1) {
    return '标靶直径过大：页面至少有一个方向连 1 个标靶都无法留出正间距。';
  }

  let hasExactSymmetricPair = false;
  let maxFeasibleSpacing = -Infinity;

  for (let n = 1; n <= maxColumnsWithPositiveSpacing; n += 1) {
    for (let m = 1; m <= maxRowsWithPositiveSpacing; m += 1) {
      const spacingFromWidth = (W - n * D) / (n + 1);
      const spacingFromHeight = (H - m * D) / (m + 1);

      if (spacingFromWidth <= EPS || spacingFromHeight <= EPS) {
        continue;
      }

      if (Math.abs(spacingFromWidth - spacingFromHeight) > EPS) {
        continue;
      }

      hasExactSymmetricPair = true;
      const spacingMm = (spacingFromWidth + spacingFromHeight) / 2;
      if (spacingMm > maxFeasibleSpacing) {
        maxFeasibleSpacing = spacingMm;
      }
    }
  }

  if (!hasExactSymmetricPair) {
    return '当前页面尺寸与直径组合不存在“同一 s 同时满足宽高公式”的严格对称解（与 s_min 无关）。请优先调整直径 D 或页面尺寸。';
  }

  return `存在严格对称解，但可行间距上限约为 ${maxFeasibleSpacing.toFixed(4)} mm，小于当前 s_min=${sMin.toFixed(
    4,
  )} mm。请减小 s_min。`;
}

export function suggestNearbyFeasibleLayouts(
  input: LayoutInput,
  options?: {
    limit?: number;
    stepMm?: number;
    maxDeltaMm?: number;
    minDiameterMm?: number;
  },
): NearbyLayoutSuggestion[] {
  if (normalizeSpacingMode(input.spacingMode) === 'manual') {
    return [];
  }

  const minSpacingMm = Number(input.minSpacingMm);
  const pageValidation: Array<number> = [input.pageWidthMm, input.pageHeightMm, minSpacingMm];
  for (const value of pageValidation) {
    if (!Number.isFinite(value) || value <= 0) {
      return [];
    }
  }

  const limit = Math.max(1, Math.round(options?.limit ?? 3));
  const stepMm = Math.max(0.01, options?.stepMm ?? 0.1);
  const maxDeltaMm = Math.max(stepMm, options?.maxDeltaMm ?? 20);
  const minDiameterMm = Math.max(0.1, options?.minDiameterMm ?? 1);
  const maxDiameterMm = Math.min(input.pageWidthMm, input.pageHeightMm) - minSpacingMm - EPS;
  if (maxDiameterMm < minDiameterMm) {
    return [];
  }

  const baseDiameter = Number.isFinite(input.targetDiameterMm) ? input.targetDiameterMm : minDiameterMm;
  const visited = new Set<string>();
  const results: NearbyLayoutSuggestion[] = [];

  const tryDiameter = (diameterMm: number): void => {
    const normalized = Number(diameterMm.toFixed(4));
    if (normalized < minDiameterMm - EPS || normalized > maxDiameterMm + EPS) {
      return;
    }
    const key = normalized.toFixed(4);
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const layout = solveOptimalLayout({
      ...input,
      targetDiameterMm: normalized,
    });
    if (layout) {
      results.push({ diameterMm: normalized, layout });
    }
  };

  const stepCount = Math.ceil(maxDeltaMm / stepMm);
  for (let i = 0; i <= stepCount && results.length < limit; i += 1) {
    if (i === 0) {
      tryDiameter(baseDiameter);
      continue;
    }

    const delta = i * stepMm;
    tryDiameter(baseDiameter - delta);
    if (results.length >= limit) {
      break;
    }
    tryDiameter(baseDiameter + delta);
  }

  return results.sort((a, b) => {
    const deltaA = Math.abs(a.diameterMm - baseDiameter);
    const deltaB = Math.abs(b.diameterMm - baseDiameter);
    if (Math.abs(deltaA - deltaB) > EPS) {
      return deltaA - deltaB;
    }
    if (a.layout.totalTargets !== b.layout.totalTargets) {
      return b.layout.totalTargets - a.layout.totalTargets;
    }
    return b.layout.spacingMm - a.layout.spacingMm;
  });
}

export function getTargetCenterMm(
  col: number,
  row: number,
  diameterMm: number,
  spacingMm: number,
  marginMm = spacingMm,
): { x: number; y: number } {
  return {
    x: marginMm + diameterMm / 2 + col * (diameterMm + spacingMm),
    y: marginMm + diameterMm / 2 + row * (diameterMm + spacingMm),
  };
}

export function ringColorByIndex(ringIndexFromOuter: number, startWithBlack: boolean): '#000000' | '#FFFFFF' {
  const isBlack = startWithBlack ? ringIndexFromOuter % 2 === 0 : ringIndexFromOuter % 2 !== 0;
  return isBlack ? '#000000' : '#FFFFFF';
}

export function ringScoreByIndex(ringIndexFromOuter: number, ringCount: number): number {
  const safeRingCount = Math.max(1, Math.round(ringCount));
  const safeIndex = Math.min(safeRingCount - 1, Math.max(0, Math.round(ringIndexFromOuter)));
  if (safeRingCount === 1) {
    return 10;
  }
  if (safeIndex === 0) {
    return 1;
  }
  if (safeIndex === safeRingCount - 1) {
    return 10;
  }
  return Math.floor(1 + (safeIndex / (safeRingCount - 1)) * 9);
}

export function ringFillColor(
  ringIndexFromOuter: number,
  ringCount: number,
  colorMode: TargetColorMode,
  startWithBlack: boolean,
): string {
  if (colorMode === 'bw') {
    return ringColorByIndex(ringIndexFromOuter, startWithBlack);
  }

  const safeRingCount = Math.max(1, Math.round(ringCount));
  const safeIndex = Math.min(safeRingCount - 1, Math.max(0, Math.round(ringIndexFromOuter)));
  if (safeRingCount === 1) {
    // 单环时中心与外环重合，优先保证中心为黄色。
    return COLOR_RING_CENTER;
  }
  if (safeIndex === 0) {
    return COLOR_RING_OUTER;
  }
  if (safeIndex === safeRingCount - 1) {
    return COLOR_RING_CENTER;
  }

  // 按“分数段 -> 箭靶色板”映射，不做插值：
  // 9-10 黄，7-8 红，5-6 蓝，1-4 黑。
  const score = ringScoreByIndex(safeIndex, safeRingCount);
  if (score >= 9) {
    return '#facc15';
  }
  if (score >= 7) {
    return '#dc2626';
  }
  if (score >= 5) {
    return '#2563eb';
  }
  return '#000000';
}

export function ringScoreTextColor(fillHex: string): '#000000' | '#FFFFFF' {
  const rgb = parseHexRgb(fillHex);
  if (!rgb) {
    return '#000000';
  }
  const luminance = relativeLuminance(rgb.r, rgb.g, rgb.b);
  if (luminance < 0.45) {
    return '#FFFFFF';
  }
  return '#000000';
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().toLowerCase();
  const matched = /^#([0-9a-f]{6})$/.exec(normalized);
  if (!matched) {
    return null;
  }
  const raw = matched[1];
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    if (normalized <= 0.04045) {
      return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function normalizeLayoutMode(mode?: LayoutMode): LayoutMode {
  return mode === 'target_count' ? 'target_count' : 'auto_fill';
}

function normalizeSpacingMode(mode?: SpacingMode): SpacingMode {
  return mode === 'manual' ? 'manual' : 'auto_min';
}

function solveManualSpacingLayout(input: LayoutInput): LayoutSolution | null {
  const W = input.pageWidthMm;
  const H = input.pageHeightMm;
  const D = input.targetDiameterMm;
  const marginMm = Number(input.manualMarginMm);
  const spacingMm = Number(input.manualTargetSpacingMm);

  const usableWidth = W - 2 * marginMm;
  const usableHeight = H - 2 * marginMm;
  if (usableWidth < D - EPS || usableHeight < D - EPS) {
    return null;
  }

  const maxColumns = Math.floor((usableWidth + spacingMm + EPS) / (D + spacingMm));
  const maxRows = Math.floor((usableHeight + spacingMm + EPS) / (D + spacingMm));
  if (maxColumns < 1 || maxRows < 1) {
    return null;
  }

  const candidates: LayoutSolution[] = [];
  for (let n = 1; n <= maxColumns; n += 1) {
    const usedWidth = n * D + (n - 1) * spacingMm;
    if (usedWidth > usableWidth + EPS) {
      continue;
    }
    for (let m = 1; m <= maxRows; m += 1) {
      const usedHeight = m * D + (m - 1) * spacingMm;
      if (usedHeight > usableHeight + EPS) {
        continue;
      }
      candidates.push({
        columns: n,
        rows: m,
        spacingMm,
        marginMm,
        totalTargets: n * m,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const mode = normalizeLayoutMode(input.layoutMode);
  if (mode === 'target_count') {
    return pickClosestByDesiredTargets(candidates, Math.max(1, Math.round(Number(input.desiredTargets))));
  }
  return pickAutoFillBest(candidates);
}

function pickAutoFillBest(candidates: LayoutSolution[]): LayoutSolution {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (
      candidate.totalTargets > best.totalTargets ||
      (candidate.totalTargets === best.totalTargets && candidate.spacingMm > best.spacingMm + EPS) ||
      (candidate.totalTargets === best.totalTargets &&
        Math.abs(candidate.spacingMm - best.spacingMm) <= EPS &&
        candidate.columns > best.columns)
    ) {
      best = candidate;
    }
  }
  return best;
}

function pickClosestByDesiredTargets(candidates: LayoutSolution[], desiredTargets: number): LayoutSolution {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const candidateDiff = Math.abs(candidate.totalTargets - desiredTargets);
    const bestDiff = Math.abs(best.totalTargets - desiredTargets);
    if (candidateDiff < bestDiff - EPS) {
      best = candidate;
      continue;
    }
    if (Math.abs(candidateDiff - bestDiff) > EPS) {
      continue;
    }

    // 差距相同，优先不低于目标数量。
    const candidateMeetsTarget = candidate.totalTargets >= desiredTargets;
    const bestMeetsTarget = best.totalTargets >= desiredTargets;
    if (candidateMeetsTarget && !bestMeetsTarget) {
      best = candidate;
      continue;
    }
    if (!candidateMeetsTarget && bestMeetsTarget) {
      continue;
    }

    // 再并列时优先更大间距和更多列。
    if (
      candidate.spacingMm > best.spacingMm + EPS ||
      (Math.abs(candidate.spacingMm - best.spacingMm) <= EPS && candidate.columns > best.columns)
    ) {
      best = candidate;
    }
  }
  return best;
}
