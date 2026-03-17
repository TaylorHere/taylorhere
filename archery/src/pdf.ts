import { PDFDocument, rgb } from 'pdf-lib';
import {
  getTargetCenterMm,
  ringFillColor,
  ringScoreByIndex,
  ringScoreTextColor,
  type LayoutSolution,
  type TargetColorMode,
} from '../shared/layout';

export interface PdfRenderInput {
  pageWidthMm: number;
  pageHeightMm: number;
  diameterMm: number;
  ringCount: number;
  checkerboardEnabled: boolean;
  colorMode: TargetColorMode;
  showRingScores: boolean;
  layout: LayoutSolution;
}

const MM_TO_PT = 72 / 25.4;

function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

function triggerBrowserDownload(bytes: Uint8Array, fileName: string): void {
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportArcheryPdf(input: PdfRenderInput): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([mmToPt(input.pageWidthMm), mmToPt(input.pageHeightMm)]);
  const pageHeightPt = mmToPt(input.pageHeightMm);

  for (let row = 0; row < input.layout.rows; row += 1) {
    for (let col = 0; col < input.layout.columns; col += 1) {
      const center = getTargetCenterMm(col, row, input.diameterMm, input.layout.spacingMm);
      const centerXPt = mmToPt(center.x);
      const centerYPt = pageHeightPt - mmToPt(center.y);

      const checkerboardEnabled = input.colorMode === 'bw' && input.checkerboardEnabled;
      const startWithBlack = checkerboardEnabled ? (row + col) % 2 === 0 : true;
      for (let ringIndex = 0; ringIndex < input.ringCount; ringIndex += 1) {
        const outerRadiusMm = (input.diameterMm / 2) * ((input.ringCount - ringIndex) / input.ringCount);
        const innerRadiusMm =
          ringIndex === input.ringCount - 1 ? 0 : (input.diameterMm / 2) * ((input.ringCount - ringIndex - 1) / input.ringCount);
        const colorHex = ringFillColor(ringIndex, input.ringCount, input.colorMode, startWithBlack);
        const color = hexToRgbColor(colorHex);

        page.drawCircle({
          x: centerXPt,
          y: centerYPt,
          size: mmToPt(outerRadiusMm),
          color,
          borderColor: rgb(0, 0, 0),
          borderWidth: mmToPt(0.1),
        });

        if (!input.showRingScores) {
          continue;
        }

        const bandThicknessMm = outerRadiusMm - innerRadiusMm;
        if (bandThicknessMm < 0.9) {
          continue;
        }

        const score = ringScoreByIndex(ringIndex, input.ringCount);
        const labelRadiusMm = (outerRadiusMm + innerRadiusMm) / 2;
        const fontSizeMm = Math.min(3.2, Math.max(1.2, bandThicknessMm * 0.9));
        const labelColorHex = ringScoreTextColor(colorHex);
        page.drawText(`${score}`, {
          x: centerXPt - mmToPt(fontSizeMm * 0.35),
          y: centerYPt + mmToPt(labelRadiusMm) - mmToPt(fontSizeMm * 0.35),
          size: mmToPt(fontSizeMm),
          color: hexToRgbColor(labelColorHex),
        });
      }
    }
  }

  const bytes = await doc.save();
  const fileName = `archery-${input.pageWidthMm}x${input.pageHeightMm}-${input.diameterMm}mm.pdf`;
  triggerBrowserDownload(bytes, fileName);
}

function hexToRgbColor(hex: string): ReturnType<typeof rgb> {
  const normalized = hex.trim().toLowerCase();
  const matched = /^#([0-9a-f]{6})$/.exec(normalized);
  if (!matched) {
    return rgb(0, 0, 0);
  }
  const value = matched[1];
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}
