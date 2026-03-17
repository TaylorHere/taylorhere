export type PagePreset = 'A4' | 'A3' | 'custom';

export interface LayoutInput {
  pageWidthMm: number;
  pageHeightMm: number;
  targetDiameterMm: number;
  minSpacingMm: number;
}

export interface LayoutSolution {
  columns: number;
  rows: number;
  spacingMm: number;
  totalTargets: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const EPS = 1e-7;

export const PAGE_PRESETS_MM: Record<Exclude<PagePreset, 'custom'>, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

export function validateInput(input: LayoutInput): ValidationResult {
  const values: Array<[string, number]> = [
    ['pageWidthMm', input.pageWidthMm],
    ['pageHeightMm', input.pageHeightMm],
    ['targetDiameterMm', input.targetDiameterMm],
    ['minSpacingMm', input.minSpacingMm],
  ];

  for (const [name, value] of values) {
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `${name} 必须是大于 0 的数字` };
    }
  }

  return { ok: true };
}

export function solveOptimalLayout(input: LayoutInput): LayoutSolution | null {
  const validation = validateInput(input);
  if (!validation.ok) {
    return null;
  }

  const W = input.pageWidthMm;
  const H = input.pageHeightMm;
  const D = input.targetDiameterMm;
  const sMin = input.minSpacingMm;

  const maxColumns = Math.floor((W - sMin) / (D + sMin));
  const maxRows = Math.floor((H - sMin) / (D + sMin));
  if (maxColumns < 1 || maxRows < 1) {
    return null;
  }

  let best: LayoutSolution | null = null;

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
        totalTargets,
      };

      if (!best) {
        best = candidate;
        continue;
      }

      // 主目标：最大化数量。并列时优先更大间距，再优先更多列（使预览更“横向密集”）。
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
  }

  return best;
}

export function getTargetCenterMm(
  col: number,
  row: number,
  diameterMm: number,
  spacingMm: number,
): { x: number; y: number } {
  return {
    x: spacingMm + diameterMm / 2 + col * (diameterMm + spacingMm),
    y: spacingMm + diameterMm / 2 + row * (diameterMm + spacingMm),
  };
}

export function ringColorByIndex(ringIndexFromOuter: number, startWithBlack: boolean): '#000000' | '#FFFFFF' {
  const isBlack = startWithBlack ? ringIndexFromOuter % 2 === 0 : ringIndexFromOuter % 2 !== 0;
  return isBlack ? '#000000' : '#FFFFFF';
}
