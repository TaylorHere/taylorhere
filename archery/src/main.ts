import './style.css';
import { exportArcheryPdf } from './pdf';
import {
  diagnoseNoLayoutReason,
  PAGE_PRESETS_MM,
  getTargetCenterMm,
  ringColorByIndex,
  solveOptimalLayout,
  type LayoutInput,
  type LayoutSolution,
  type PagePreset,
} from '../shared/layout';

const PX_PER_MM = 96 / 25.4;
const DEFAULT_PAGE_PRESET: PagePreset = 'A4';

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

        <label>
          标靶直径 D (mm)
          <input id="diameter" type="number" step="0.1" min="1" value="22" />
        </label>

        <label>
          最小间距 s_min (mm)
          <input id="min-spacing" type="number" step="0.1" min="0.1" value="3" />
        </label>

        <label>
          圆环数量
          <input id="ring-count" type="number" step="1" min="1" value="3" />
        </label>

        <label class="inline">
          <input id="checkerboard" type="checkbox" checked />
          黑白棋盘交替模式
        </label>
      </form>

      <div class="controls">
        <label class="zoom">
          预览缩放
          <input id="zoom" type="range" min="30" max="300" value="100" />
          <span id="zoom-label">100%</span>
        </label>
        <button id="download-pdf" type="button">下载 PDF（矢量）</button>
        <button id="verify-api" type="button" class="secondary">后端 API 复核</button>
      </div>

      <div class="result" id="result">
        <div>列数 n：<strong id="out-n">-</strong></div>
        <div>行数 m：<strong id="out-m">-</strong></div>
        <div>统一间距 s：<strong id="out-s">-</strong> mm</div>
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
  minSpacing: getEl<HTMLInputElement>('min-spacing'),
  ringCount: getEl<HTMLInputElement>('ring-count'),
  checkerboard: getEl<HTMLInputElement>('checkerboard'),
  zoom: getEl<HTMLInputElement>('zoom'),
  zoomLabel: getEl<HTMLSpanElement>('zoom-label'),
  previewStage: getEl<HTMLDivElement>('preview-stage'),
  status: getEl<HTMLParagraphElement>('status'),
  outN: getEl<HTMLElement>('out-n'),
  outM: getEl<HTMLElement>('out-m'),
  outS: getEl<HTMLElement>('out-s'),
  outTotal: getEl<HTMLElement>('out-total'),
  outPage: getEl<HTMLElement>('out-page'),
  downloadBtn: getEl<HTMLButtonElement>('download-pdf'),
  verifyApiBtn: getEl<HTMLButtonElement>('verify-api'),
};

let currentLayout: LayoutSolution | null = null;
refs.pagePreset.value = DEFAULT_PAGE_PRESET;
toggleCustomSizeInputs();
recalculate();

for (const el of [
  refs.pagePreset,
  refs.customWidth,
  refs.customHeight,
  refs.diameter,
  refs.minSpacing,
  refs.ringCount,
  refs.checkerboard,
  refs.zoom,
]) {
  el.addEventListener('input', () => {
    if (el === refs.pagePreset) {
      applyPresetToCustomInputs();
      toggleCustomSizeInputs();
    }
    recalculate();
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
    layout: currentLayout,
  });
  refs.status.textContent = 'PDF 已生成：矢量图可直接打印，请使用 100% 缩放。';
});

refs.verifyApiBtn.addEventListener('click', async () => {
  const input = buildLayoutInput();
  refs.status.textContent = '正在请求后端 API 复核...';

  try {
    const response = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      refs.status.textContent = `后端 API 异常：HTTP ${response.status}`;
      return;
    }

    const data = (await response.json()) as { ok: boolean; layout: LayoutSolution | null; reason?: string };
    if (!data.ok || !data.layout) {
      refs.status.textContent = `后端复核：无可行解。${data.reason ? `原因：${data.reason}` : ''}`;
      return;
    }

    refs.status.textContent = `后端复核成功：n=${data.layout.columns}, m=${data.layout.rows}, s=${data.layout.spacingMm.toFixed(4)}mm`;
  } catch {
    refs.status.textContent = '后端 API 不可达（本地前端计算仍可使用）。部署到 Cloudflare Pages 后可直接复核。';
  }
});

function recalculate(): void {
  const pageSize = getPageSize();
  const input = buildLayoutInput();
  const layout = solveOptimalLayout(input);
  currentLayout = layout;

  refs.zoomLabel.textContent = `${Math.round(getPositiveNumber(refs.zoom))}%`;
  refs.outPage.textContent = `${pageSize.widthMm.toFixed(1)} × ${pageSize.heightMm.toFixed(1)} mm`;

  if (!layout) {
    refs.outN.textContent = '-';
    refs.outM.textContent = '-';
    refs.outS.textContent = '-';
    refs.outTotal.textContent = '0';
    refs.status.textContent = diagnoseNoLayoutReason(input);
    renderSvgPreview(null, input);
    return;
  }

  refs.outN.textContent = `${layout.columns}`;
  refs.outM.textContent = `${layout.rows}`;
  refs.outS.textContent = layout.spacingMm.toFixed(4);
  refs.outTotal.textContent = `${layout.totalTargets}`;
  refs.status.textContent = '已完成本地最优排布计算。';
  renderSvgPreview(layout, input);
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
  const checkerboardEnabled = refs.checkerboard.checked;
  const circles: string[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.columns; col += 1) {
      const center = getTargetCenterMm(col, row, input.targetDiameterMm, layout.spacingMm);
      const startWithBlack = checkerboardEnabled ? (row + col) % 2 === 0 : true;

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const radiusMm = (input.targetDiameterMm / 2) * ((ringCount - ringIndex) / ringCount);
        const fill = ringColorByIndex(ringIndex, startWithBlack);
        const outerStroke = ringIndex === 0 ? ' stroke="#000" stroke-width="0.15"' : '';
        circles.push(
          `<circle cx="${center.x}" cy="${center.y}" r="${radiusMm}" fill="${fill}"${outerStroke} vector-effect="non-scaling-stroke" />`,
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
  return {
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    targetDiameterMm: getPositiveNumber(refs.diameter),
    minSpacingMm: getPositiveNumber(refs.minSpacing),
  };
}

function toggleCustomSizeInputs(): void {
  const isCustom = refs.pagePreset.value === 'custom';
  refs.customWidth.disabled = !isCustom;
  refs.customHeight.disabled = !isCustom;
}

function applyPresetToCustomInputs(): void {
  const preset = refs.pagePreset.value as PagePreset;
  if (preset === 'custom') {
    return;
  }

  refs.customWidth.value = `${PAGE_PRESETS_MM[preset].width}`;
  refs.customHeight.value = `${PAGE_PRESETS_MM[preset].height}`;
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

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`元素 #${id} 未找到`);
  }
  return el as T;
}
