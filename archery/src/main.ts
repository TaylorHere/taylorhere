import './style.css';
import { exportArcheryPdf } from './pdf';
import {
  diagnoseNoLayoutReason,
  type LayoutMode,
  PAGE_PRESETS_MM,
  RING_SCORE_LOG_STRENGTH_DEFAULT,
  getTargetCenterMm,
  ringFillColor,
  ringScoreByIndex,
  ringScoreTextColor,
  type RingScoreMappingConfig,
  type RingScoreMappingMode,
  solveOptimalLayout,
  suggestNearbyFeasibleLayouts,
  type LayoutInput,
  type LayoutSolution,
  type PagePreset,
  type SpacingMode,
  type TargetColorMode,
} from '../shared/layout';

const PX_PER_MM = 96 / 25.4;
const DEFAULT_PAGE_PRESET: PagePreset = 'A4';
const EPS = 1e-7;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app 未找到');
}

app.innerHTML = `
  <main class="layout">
    <section class="panel">
      <h1>射箭训练标靶生成系统</h1>
      <p class="subtitle">严格满足：边距 = 间距 = s，且水平/垂直数学对称。</p>

      <form id="config-form" class="form-grid">
        <label>
          页面尺寸
          <select id="page-preset">
            <option value="A4">A4 (210 × 297 mm)</option>
            <option value="A3">A3 (297 × 420 mm)</option>
            <option value="custom">自定义</option>
          </select>
        </label>

        <label>
          自定义宽度 (mm)
          <input id="custom-width" type="number" step="0.1" min="1" value="210" />
        </label>

        <label>
          自定义高度 (mm)
          <input id="custom-height" type="number" step="0.1" min="1" value="297" />
        </label>

        <label class="slider-field">
          标靶直径 D (mm)
          <input id="diameter" type="range" step="0.1" min="1" max="120" value="22" />
          <span id="diameter-value" class="slider-value"></span>
        </label>

        <label class="slider-field">
          最小间距 s_min (mm)
          <input id="min-spacing" type="range" step="0.1" min="0.1" max="40" value="3" />
          <span id="min-spacing-value" class="slider-value"></span>
        </label>

        <label class="inline">
          <input id="auto-spacing" type="checkbox" checked />
          按最小间距自动计算页边距/靶间距
        </label>

        <label class="slider-field">
          手动页边距 (mm)
          <input id="manual-margin" type="range" step="0.1" min="0" max="80" value="3" disabled />
          <span id="manual-margin-value" class="slider-value"></span>
        </label>

        <label class="slider-field">
          手动靶间距 (mm)
          <input id="manual-target-spacing" type="range" step="0.1" min="0" max="80" value="3" disabled />
          <span id="manual-target-spacing-value" class="slider-value"></span>
        </label>

        <label>
          排布模式
          <select id="layout-mode">
            <option value="auto_fill">自动填满（最大数量）</option>
            <option value="target_count">指定数量（尽量接近）</option>
          </select>
        </label>

        <label class="slider-field">
          目标数量
          <input id="desired-targets" type="range" step="1" min="1" max="300" value="70" />
          <span id="desired-targets-value" class="slider-value"></span>
        </label>

        <label class="slider-field">
          圆环数量
          <input id="ring-count" type="range" step="1" min="1" max="12" value="3" />
          <span id="ring-count-value" class="slider-value"></span>
        </label>

        <label>
          环分数映射方案
          <select id="ring-score-mapping">
            <option value="linear">线性</option>
            <option value="log">对数</option>
          </select>
        </label>

        <label id="log-score-strength-row">
          对数映射强度
          <input id="log-score-strength" type="range" min="0" max="100" step="1" value="${RING_SCORE_LOG_STRENGTH_DEFAULT}" />
          <span id="log-score-strength-label">${RING_SCORE_LOG_STRENGTH_DEFAULT}%</span>
        </label>

        <label class="inline">
          <input id="checkerboard" type="checkbox" checked />
          黑白棋盘交替模式
        </label>

        <label>
          靶面颜色
          <select id="target-color-mode">
            <option value="bw">黑白靶</option>
            <option value="color">彩色靶</option>
          </select>
        </label>

        <label class="inline">
          <input id="show-ring-scores" type="checkbox" />
          显示环分数
        </label>
      </form>

      <div class="controls">
        <label class="zoom">
          预览缩放
          <input id="zoom" type="range" min="30" max="300" value="100" />
          <span id="zoom-label">100%</span>
        </label>
        <button id="download-pdf" type="button">下载 PDF（矢量）</button>
      </div>

      <div class="result" id="result">
        <div>列数 n：<strong id="out-n">-</strong></div>
        <div>行数 m：<strong id="out-m">-</strong></div>
        <div>页边距：<strong id="out-margin">-</strong> mm</div>
        <div>靶间距 s：<strong id="out-s">-</strong> mm</div>
        <div>总数量 n×m：<strong id="out-total">-</strong></div>
        <div>页面：<strong id="out-page">-</strong></div>
      </div>
      <p class="hint" id="status">提示：打印时请选择 100% 缩放（不要“适合页面”）。</p>
    </section>

    <section class="preview-section">
      <div id="preview-stage" class="preview-stage"></div>
    </section>
  </main>
`;

const refs = {
  pagePreset: getEl<HTMLSelectElement>('page-preset'),
  customWidth: getEl<HTMLInputElement>('custom-width'),
  customHeight: getEl<HTMLInputElement>('custom-height'),
  diameter: getEl<HTMLInputElement>('diameter'),
  diameterValue: getEl<HTMLSpanElement>('diameter-value'),
  minSpacing: getEl<HTMLInputElement>('min-spacing'),
  minSpacingValue: getEl<HTMLSpanElement>('min-spacing-value'),
  autoSpacing: getEl<HTMLInputElement>('auto-spacing'),
  manualMargin: getEl<HTMLInputElement>('manual-margin'),
  manualMarginValue: getEl<HTMLSpanElement>('manual-margin-value'),
  manualTargetSpacing: getEl<HTMLInputElement>('manual-target-spacing'),
  manualTargetSpacingValue: getEl<HTMLSpanElement>('manual-target-spacing-value'),
  layoutMode: getEl<HTMLSelectElement>('layout-mode'),
  desiredTargets: getEl<HTMLInputElement>('desired-targets'),
  desiredTargetsValue: getEl<HTMLSpanElement>('desired-targets-value'),
  ringCount: getEl<HTMLInputElement>('ring-count'),
  ringCountValue: getEl<HTMLSpanElement>('ring-count-value'),
  ringScoreMapping: getEl<HTMLSelectElement>('ring-score-mapping'),
  logScoreStrengthRow: getEl<HTMLLabelElement>('log-score-strength-row'),
  logScoreStrength: getEl<HTMLInputElement>('log-score-strength'),
  logScoreStrengthLabel: getEl<HTMLSpanElement>('log-score-strength-label'),
  checkerboard: getEl<HTMLInputElement>('checkerboard'),
  targetColorMode: getEl<HTMLSelectElement>('target-color-mode'),
  showRingScores: getEl<HTMLInputElement>('show-ring-scores'),
  zoom: getEl<HTMLInputElement>('zoom'),
  zoomLabel: getEl<HTMLSpanElement>('zoom-label'),
  previewStage: getEl<HTMLDivElement>('preview-stage'),
  status: getEl<HTMLParagraphElement>('status'),
  outN: getEl<HTMLElement>('out-n'),
  outM: getEl<HTMLElement>('out-m'),
  outMargin: getEl<HTMLElement>('out-margin'),
  outS: getEl<HTMLElement>('out-s'),
  outTotal: getEl<HTMLElement>('out-total'),
  outPage: getEl<HTMLElement>('out-page'),
  downloadBtn: getEl<HTMLButtonElement>('download-pdf'),
};

let currentLayout: LayoutSolution | null = null;
refs.pagePreset.value = DEFAULT_PAGE_PRESET;
refs.layoutMode.value = 'auto_fill';
refs.targetColorMode.value = 'bw';
refs.ringScoreMapping.value = 'linear';
syncDynamicSliderBounds();
updateAllSliderLabels();
toggleCustomSizeInputs();
toggleSpacingModeInputs();
toggleDesiredTargetsInput();
toggleCheckerboardAvailability();
toggleLogScoreStrengthVisibility();
recalculate();

type EditedField =
  | 'page'
  | 'customWidth'
  | 'customHeight'
  | 'diameter'
  | 'minSpacing'
  | 'manualMargin'
  | 'manualTargetSpacing'
  | 'other';

for (const el of [
  refs.pagePreset,
  refs.customWidth,
  refs.customHeight,
  refs.diameter,
  refs.minSpacing,
  refs.autoSpacing,
  refs.manualMargin,
  refs.manualTargetSpacing,
  refs.layoutMode,
  refs.desiredTargets,
  refs.ringCount,
  refs.ringScoreMapping,
  refs.logScoreStrength,
  refs.checkerboard,
  refs.targetColorMode,
  refs.showRingScores,
  refs.zoom,
]) {
  el.addEventListener('input', () => {
    const editedField = resolveEditedField(el);
    updateSliderLabelForInput(el);
    if (el === refs.pagePreset) {
      applyPresetToCustomInputs();
      toggleCustomSizeInputs();
      syncDynamicSliderBounds();
      updateAllSliderLabels();
    }
    if (el === refs.targetColorMode) {
      toggleCheckerboardAvailability();
    }
    if (el === refs.layoutMode) {
      toggleDesiredTargetsInput();
    }
    if (el === refs.ringScoreMapping) {
      toggleLogScoreStrengthVisibility();
    }
    if (el === refs.autoSpacing) {
      toggleSpacingModeInputs();
    }
    if (el === refs.logScoreStrength) {
      updateLogScoreStrengthLabel();
    }
    if (el === refs.customWidth || el === refs.customHeight || el === refs.diameter) {
      syncDynamicSliderBounds();
      updateAllSliderLabels();
    }
    recalculate(editedField);
  });
}

refs.downloadBtn.addEventListener('click', async () => {
  if (!currentLayout) {
    refs.status.textContent = '当前参数下无可行排布，无法导出 PDF。';
    return;
  }

  const pageSize = getPageSize();
  await exportArcheryPdf({
    pageWidthMm: pageSize.widthMm,
    pageHeightMm: pageSize.heightMm,
    diameterMm: getPositiveNumber(refs.diameter),
    ringCount: getPositiveInteger(refs.ringCount),
    checkerboardEnabled: refs.checkerboard.checked,
    colorMode: getTargetColorMode(),
    showRingScores: refs.showRingScores.checked,
    ringScoreMappingMode: getRingScoreMappingMode(),
    ringScoreLogStrength: getRingScoreLogStrength(),
    layout: currentLayout,
  });
  refs.status.textContent = 'PDF 已生成：矢量图可直接打印，请使用 100% 缩放。';
});

function recalculate(editedField: EditedField = 'other'): void {
  syncDynamicSliderBounds();
  updateAllSliderLabels();
  let input = buildLayoutInput();
  let layout = solveOptimalLayout(input);
  let snapMessage = '';

  if (!layout && editedField !== 'other') {
    const snapped = snapEditedFieldToNearbyFeasible(editedField);
    if (snapped) {
      snapMessage = snapped;
      updateAllSliderLabels();
      input = buildLayoutInput();
      layout = solveOptimalLayout(input);
    }
  }

  currentLayout = layout;
  const pageSize = getPageSize();

  refs.zoomLabel.textContent = `${Math.round(getPositiveNumber(refs.zoom))}%`;
  refs.outPage.textContent = `${pageSize.widthMm.toFixed(1)} × ${pageSize.heightMm.toFixed(1)} mm`;

  if (!layout) {
    refs.outN.textContent = '-';
    refs.outM.textContent = '-';
    refs.outMargin.textContent = '-';
    refs.outS.textContent = '-';
    refs.outTotal.textContent = '0';
    const reason = diagnoseNoLayoutReason(input);
    const spacingMode = getSpacingMode();
    if (spacingMode === 'manual') {
      refs.status.textContent = reason;
      renderSvgPreview(null, input);
      return;
    }
    const suggestions = suggestNearbyFeasibleLayouts(input, {
      limit: 3,
      stepMm: 0.1,
      maxDeltaMm: 20,
      minDiameterMm: 1,
    });
    if (suggestions.length > 0) {
      const formatted = suggestions
        .map(
          (item, idx) =>
            `${idx + 1}) D=${item.diameterMm.toFixed(1)}mm（n=${item.layout.columns}, m=${item.layout.rows}, s=${item.layout.spacingMm.toFixed(2)}mm）`,
        )
        .join('；');
      refs.status.textContent = `${reason} 附近可行参数建议：${formatted}`;
    } else {
      refs.status.textContent = `${reason} 附近 ±20mm 未找到可行直径，建议切换页面尺寸后重试。`;
    }
    renderSvgPreview(null, input);
    return;
  }

  refs.outN.textContent = `${layout.columns}`;
  refs.outM.textContent = `${layout.rows}`;
  refs.outMargin.textContent = layout.marginMm.toFixed(4);
  refs.outS.textContent = layout.spacingMm.toFixed(4);
  refs.outTotal.textContent = `${layout.totalTargets}`;
  const modeStatus = getLayoutModeStatus(layout);
  refs.status.textContent = snapMessage ? `${snapMessage}${modeStatus}` : `已完成本地最优排布计算。${modeStatus}`;
  renderSvgPreview(layout, input);
}

function getMaxStrictSpacingForCurrentDiameter(input: LayoutInput): number | null {
  const W = input.pageWidthMm;
  const H = input.pageHeightMm;
  const D = input.targetDiameterMm;
  if (!Number.isFinite(W) || !Number.isFinite(H) || !Number.isFinite(D) || W <= 0 || H <= 0 || D <= 0) {
    return null;
  }

  const maxColumns = Math.floor((W - EPS) / D);
  const maxRows = Math.floor((H - EPS) / D);
  if (maxColumns < 1 || maxRows < 1) {
    return null;
  }

  let maxSpacing = -Infinity;
  for (let n = 1; n <= maxColumns; n += 1) {
    for (let m = 1; m <= maxRows; m += 1) {
      const spacingFromWidth = (W - n * D) / (n + 1);
      const spacingFromHeight = (H - m * D) / (m + 1);
      if (spacingFromWidth <= EPS || spacingFromHeight <= EPS) {
        continue;
      }
      if (Math.abs(spacingFromWidth - spacingFromHeight) > EPS) {
        continue;
      }
      const spacingMm = (spacingFromWidth + spacingFromHeight) / 2;
      if (spacingMm > maxSpacing) {
        maxSpacing = spacingMm;
      }
    }
  }

  return Number.isFinite(maxSpacing) ? maxSpacing : null;
}

function snapEditedFieldToNearbyFeasible(editedField: EditedField): string | null {
  const spacingMode = getSpacingMode();
  if (editedField === 'diameter' && spacingMode === 'auto_min') {
    const source = buildLayoutInput();
    const [nearest] = suggestNearbyFeasibleLayouts(source, {
      limit: 1,
      stepMm: 0.1,
      maxDeltaMm: 80,
      minDiameterMm: 1,
    });
    if (!nearest) {
      return null;
    }
    setSliderValue(refs.diameter, nearest.diameterMm);
    updateSliderLabelForInput(refs.diameter);
    return `当前直径无可行排布，已吸附到 D=${nearest.diameterMm.toFixed(1)} mm。`;
  }

  if (editedField === 'minSpacing' && spacingMode === 'auto_min') {
    const maxSpacing = getMaxStrictSpacingForCurrentDiameter(buildLayoutInput());
    const current = getPositiveNumber(refs.minSpacing);
    if (maxSpacing !== null && maxSpacing + EPS < current) {
      setSliderValue(refs.minSpacing, maxSpacing);
      updateSliderLabelForInput(refs.minSpacing);
      return `当前 s_min 无可行排布，已吸附到 s_min=${getPositiveNumber(refs.minSpacing).toFixed(1)} mm。`;
    }
    return null;
  }

  if (spacingMode === 'manual') {
    if (editedField === 'diameter') {
      const snapped = snapRangeInputToFeasible(refs.diameter);
      if (snapped !== null) {
        updateSliderLabelForInput(refs.diameter);
        return `当前直径无可行排布，已吸附到 D=${snapped.toFixed(1)} mm。`;
      }
      return null;
    }
    if (editedField === 'manualMargin') {
      const snapped = snapRangeInputToFeasible(refs.manualMargin);
      if (snapped !== null) {
        updateSliderLabelForInput(refs.manualMargin);
        return `当前页边距无可行排布，已吸附到 ${snapped.toFixed(1)} mm。`;
      }
      return null;
    }
    if (editedField === 'manualTargetSpacing') {
      const snapped = snapRangeInputToFeasible(refs.manualTargetSpacing);
      if (snapped !== null) {
        updateSliderLabelForInput(refs.manualTargetSpacing);
        return `当前靶间距无可行排布，已吸附到 ${snapped.toFixed(1)} mm。`;
      }
      return null;
    }
  }

  return null;
}

function resolveEditedField(el: HTMLElement): EditedField {
  if (el === refs.pagePreset) {
    return 'page';
  }
  if (el === refs.customWidth) {
    return 'customWidth';
  }
  if (el === refs.customHeight) {
    return 'customHeight';
  }
  if (el === refs.diameter) {
    return 'diameter';
  }
  if (el === refs.minSpacing) {
    return 'minSpacing';
  }
  if (el === refs.manualMargin) {
    return 'manualMargin';
  }
  if (el === refs.manualTargetSpacing) {
    return 'manualTargetSpacing';
  }
  return 'other';
}

function snapRangeInputToFeasible(inputEl: HTMLInputElement): number | null {
  const step = getInputStep(inputEl);
  const min = Number(inputEl.min);
  const max = Number(inputEl.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }

  const original = Number(inputEl.value);
  if (!Number.isFinite(original)) {
    return null;
  }

  const decimals = countStepDecimals(step);
  const totalSteps = Math.ceil((max - min) / step);
  for (let offset = 1; offset <= totalSteps; offset += 1) {
    const candidateDown = Number((original - offset * step).toFixed(decimals));
    if (candidateDown >= min - EPS) {
      setSliderValue(inputEl, candidateDown);
      if (solveOptimalLayout(buildLayoutInput())) {
        return Number(inputEl.value);
      }
    }
    const candidateUp = Number((original + offset * step).toFixed(decimals));
    if (candidateUp <= max + EPS) {
      setSliderValue(inputEl, candidateUp);
      if (solveOptimalLayout(buildLayoutInput())) {
        return Number(inputEl.value);
      }
    }
  }

  setSliderValue(inputEl, original);
  return null;
}

function setSliderValue(inputEl: HTMLInputElement, value: number): void {
  const min = Number(inputEl.min);
  const max = Number(inputEl.max);
  const step = getInputStep(inputEl);
  const decimals = countStepDecimals(step);
  const clamped = Math.min(max, Math.max(min, value));
  inputEl.value = clamped.toFixed(decimals);
}

function getInputStep(inputEl: HTMLInputElement): number {
  const parsed = Number(inputEl.step);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function countStepDecimals(step: number): number {
  const text = step.toString();
  const dot = text.indexOf('.');
  if (dot < 0) {
    return 0;
  }
  return text.length - dot - 1;
}

function renderSvgPreview(layout: LayoutSolution | null, input: LayoutInput): void {
  const zoom = getPositiveNumber(refs.zoom) / 100;
  const widthPx = input.pageWidthMm * PX_PER_MM * zoom;
  const heightPx = input.pageHeightMm * PX_PER_MM * zoom;

  if (!layout) {
    refs.previewStage.innerHTML = `
      <div class="empty-state">
        <p>无可行排布</p>
      </div>
    `;
    return;
  }

  const ringCount = getPositiveInteger(refs.ringCount);
  const colorMode = getTargetColorMode();
  const checkerboardEnabled = colorMode === 'bw' && refs.checkerboard.checked;
  const showRingScores = refs.showRingScores.checked;
  const scoreMappingConfig = getRingScoreMappingConfig();
  const circles: string[] = [];
  const scoreLabels: string[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.columns; col += 1) {
      const centerWithMargin = getTargetCenterMm(col, row, input.targetDiameterMm, layout.spacingMm, layout.marginMm);
      const startWithBlack = checkerboardEnabled ? (row + col) % 2 === 0 : true;

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const outerRadiusMm = (input.targetDiameterMm / 2) * ((ringCount - ringIndex) / ringCount);
        const innerRadiusMm =
          ringIndex === ringCount - 1 ? 0 : (input.targetDiameterMm / 2) * ((ringCount - ringIndex - 1) / ringCount);
        const fill = ringFillColor(ringIndex, ringCount, colorMode, startWithBlack, scoreMappingConfig);
        circles.push(
          `<circle cx="${centerWithMargin.x}" cy="${centerWithMargin.y}" r="${outerRadiusMm}" fill="${fill}" stroke="#000" stroke-width="0.1" vector-effect="non-scaling-stroke" />`,
        );

        if (!showRingScores) {
          continue;
        }

        const bandThicknessMm = outerRadiusMm - innerRadiusMm;
        if (bandThicknessMm < 0.9) {
          continue;
        }

        const score = ringScoreByIndex(ringIndex, ringCount, scoreMappingConfig);
        const labelRadiusMm = (outerRadiusMm + innerRadiusMm) / 2;
        const fontSizeMm = Math.min(3.2, Math.max(1.2, bandThicknessMm * 0.9));
        const labelY = centerWithMargin.y - labelRadiusMm + fontSizeMm * 0.35;
        const textColor = ringScoreTextColor(fill);
        scoreLabels.push(
          `<text x="${centerWithMargin.x}" y="${labelY}" text-anchor="middle" font-size="${fontSizeMm}" fill="${textColor}" font-weight="600">${score}</text>`,
        );
      }
    }
  }

  const rulerStart = 10;
  const rulerLength = 50;
  const rulerY = input.pageHeightMm - 8;

  refs.previewStage.innerHTML = `
    <svg
      width="${widthPx}"
      height="${heightPx}"
      viewBox="0 0 ${input.pageWidthMm} ${input.pageHeightMm}"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="标靶排布预览"
      shape-rendering="geometricPrecision"
    >
      <rect x="0" y="0" width="${input.pageWidthMm}" height="${input.pageHeightMm}" fill="#fff" stroke="#999" stroke-width="0.3"/>
      ${circles.join('')}
      ${scoreLabels.join('')}
      <line x1="${rulerStart}" y1="${rulerY}" x2="${rulerStart + rulerLength}" y2="${rulerY}" stroke="#1d4ed8" stroke-width="0.25" />
      <line x1="${rulerStart}" y1="${rulerY - 1}" x2="${rulerStart}" y2="${rulerY + 1}" stroke="#1d4ed8" stroke-width="0.25" />
      <line x1="${rulerStart + rulerLength}" y1="${rulerY - 1}" x2="${rulerStart + rulerLength}" y2="${rulerY + 1}" stroke="#1d4ed8" stroke-width="0.25" />
      <text x="${rulerStart + rulerLength / 2}" y="${rulerY - 1.5}" text-anchor="middle" font-size="2.8" fill="#1d4ed8">50 mm</text>
    </svg>
  `;
}

function getPageSize(): { widthMm: number; heightMm: number } {
  const preset = refs.pagePreset.value as PagePreset;
  if (preset === 'custom') {
    return {
      widthMm: getPositiveNumber(refs.customWidth),
      heightMm: getPositiveNumber(refs.customHeight),
    };
  }

  const mapped = PAGE_PRESETS_MM[preset];
  return { widthMm: mapped.width, heightMm: mapped.height };
}

function buildLayoutInput(): LayoutInput {
  const page = getPageSize();
  const layoutMode = getLayoutMode();
  const spacingMode = getSpacingMode();
  return {
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    targetDiameterMm: getPositiveNumber(refs.diameter),
    spacingMode,
    minSpacingMm: spacingMode === 'auto_min' ? getPositiveNumber(refs.minSpacing) : undefined,
    manualMarginMm: spacingMode === 'manual' ? getNonNegativeNumber(refs.manualMargin) : undefined,
    manualTargetSpacingMm: spacingMode === 'manual' ? getNonNegativeNumber(refs.manualTargetSpacing) : undefined,
    layoutMode,
    desiredTargets: layoutMode === 'target_count' ? getPositiveInteger(refs.desiredTargets) : undefined,
  };
}

function toggleCustomSizeInputs(): void {
  const isCustom = refs.pagePreset.value === 'custom';
  refs.customWidth.disabled = !isCustom;
  refs.customHeight.disabled = !isCustom;
}

function toggleDesiredTargetsInput(): void {
  const isTargetCountMode = getLayoutMode() === 'target_count';
  refs.desiredTargets.disabled = !isTargetCountMode;
}

function toggleSpacingModeInputs(): void {
  const manualMode = getSpacingMode() === 'manual';
  refs.minSpacing.disabled = manualMode;
  refs.manualMargin.disabled = !manualMode;
  refs.manualTargetSpacing.disabled = !manualMode;
}

function toggleCheckerboardAvailability(): void {
  const isColorMode = getTargetColorMode() === 'color';
  refs.checkerboard.disabled = isColorMode;
}

function toggleLogScoreStrengthVisibility(): void {
  const isLogMode = getRingScoreMappingMode() === 'log';
  refs.logScoreStrengthRow.style.display = isLogMode ? 'grid' : 'none';
  refs.logScoreStrength.disabled = !isLogMode;
  updateLogScoreStrengthLabel();
}

function updateLogScoreStrengthLabel(): void {
  refs.logScoreStrengthLabel.textContent = `${Math.round(getRingScoreLogStrength())}%`;
}

function applyPresetToCustomInputs(): void {
  const preset = refs.pagePreset.value as PagePreset;
  if (preset === 'custom') {
    return;
  }

  refs.customWidth.value = `${PAGE_PRESETS_MM[preset].width}`;
  refs.customHeight.value = `${PAGE_PRESETS_MM[preset].height}`;
}

function syncDynamicSliderBounds(): void {
  const page = getPageSize();
  const minSide = Math.min(page.widthMm, page.heightMm);

  refs.diameter.max = `${Math.max(1, Number((minSide - 0.1).toFixed(1)))}`;
  const diameter = clampRangeValue(refs.diameter);

  refs.manualMargin.max = `${Math.max(0, Number((minSide / 2 - 0.5).toFixed(1)))}`;
  clampRangeValue(refs.manualMargin);

  refs.manualTargetSpacing.max = `${Math.max(0, Number((minSide - diameter).toFixed(1)))}`;
  clampRangeValue(refs.manualTargetSpacing);

  const estimatedMaxTargets = Math.max(
    1,
    Math.floor(page.widthMm / Math.max(diameter, 1)) * Math.floor(page.heightMm / Math.max(diameter, 1)),
  );
  refs.desiredTargets.max = `${Math.max(10, estimatedMaxTargets)}`;
  clampRangeValue(refs.desiredTargets);
}

function clampRangeValue(inputEl: HTMLInputElement): number {
  const min = Number(inputEl.min);
  const max = Number(inputEl.max);
  const current = Number(inputEl.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(current)) {
    return 0;
  }
  const step = getInputStep(inputEl);
  const decimals = countStepDecimals(step);
  const clamped = Math.max(min, Math.min(max, current));
  inputEl.value = clamped.toFixed(decimals);
  return clamped;
}

function updateAllSliderLabels(): void {
  updateSliderLabelForInput(refs.diameter);
  updateSliderLabelForInput(refs.minSpacing);
  updateSliderLabelForInput(refs.manualMargin);
  updateSliderLabelForInput(refs.manualTargetSpacing);
  updateSliderLabelForInput(refs.desiredTargets);
  updateSliderLabelForInput(refs.ringCount);
}

function updateSliderLabelForInput(el: HTMLElement): void {
  if (el === refs.diameter) {
    refs.diameterValue.textContent = `${getPositiveNumber(refs.diameter).toFixed(1)} mm`;
    return;
  }
  if (el === refs.minSpacing) {
    refs.minSpacingValue.textContent = `${getPositiveNumber(refs.minSpacing).toFixed(1)} mm`;
    return;
  }
  if (el === refs.manualMargin) {
    refs.manualMarginValue.textContent = `${getNonNegativeNumber(refs.manualMargin).toFixed(1)} mm`;
    return;
  }
  if (el === refs.manualTargetSpacing) {
    refs.manualTargetSpacingValue.textContent = `${getNonNegativeNumber(refs.manualTargetSpacing).toFixed(1)} mm`;
    return;
  }
  if (el === refs.desiredTargets) {
    refs.desiredTargetsValue.textContent = `${getPositiveInteger(refs.desiredTargets)}`;
    return;
  }
  if (el === refs.ringCount) {
    refs.ringCountValue.textContent = `${getPositiveInteger(refs.ringCount)}`;
  }
}

function getPositiveNumber(input: HTMLInputElement): number {
  const parsed = Number(input.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function getPositiveInteger(input: HTMLInputElement): number {
  return Math.max(1, Math.round(getPositiveNumber(input)));
}

function getNonNegativeNumber(input: HTMLInputElement): number {
  const parsed = Number(input.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function getTargetColorMode(): TargetColorMode {
  return refs.targetColorMode.value === 'color' ? 'color' : 'bw';
}

function getRingScoreMappingMode(): RingScoreMappingMode {
  return refs.ringScoreMapping.value === 'log' ? 'log' : 'linear';
}

function getRingScoreLogStrength(): number {
  const parsed = Number(refs.logScoreStrength.value);
  if (!Number.isFinite(parsed)) {
    return RING_SCORE_LOG_STRENGTH_DEFAULT;
  }
  return Math.min(100, Math.max(0, parsed));
}

function getRingScoreMappingConfig(): RingScoreMappingConfig {
  const mode = getRingScoreMappingMode();
  if (mode === 'linear') {
    return { mode };
  }
  return {
    mode,
    logStrength: getRingScoreLogStrength(),
  };
}

function getSpacingMode(): SpacingMode {
  return refs.autoSpacing.checked ? 'auto_min' : 'manual';
}

function getLayoutMode(): LayoutMode {
  return refs.layoutMode.value === 'target_count' ? 'target_count' : 'auto_fill';
}

function getLayoutModeStatus(layout: LayoutSolution): string {
  if (getLayoutMode() !== 'target_count') {
    return '';
  }

  const desired = getPositiveInteger(refs.desiredTargets);
  if (layout.totalTargets === desired) {
    return `已满足指定数量 ${desired}。`;
  }
  return `指定数量=${desired}，当前可行最接近数量=${layout.totalTargets}。`;
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`元素 #${id} 未找到`);
  }
  return el as T;
}
