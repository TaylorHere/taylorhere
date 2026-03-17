import { PDFDocument, rgb } from 'pdf-lib';
import { getTargetCenterMm, ringColorByIndex, type LayoutSolution } from '../shared/layout';

export interface PdfRenderInput {
  pageWidthMm: number;
  pageHeightMm: number;
  diameterMm: number;
  ringCount: number;
  checkerboardEnabled: boolean;
  layout: LayoutSolution;
}

const MM_TO_PT = 72 / 25.4;

function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

function triggerBrowserDownload(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes], { type: 'application/pdf' });
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

      const startWithBlack = input.checkerboardEnabled ? (row + col) % 2 === 0 : true;
      for (let ringIndex = 0; ringIndex < input.ringCount; ringIndex += 1) {
        const radiusMm = (input.diameterMm / 2) * ((input.ringCount - ringIndex) / input.ringCount);
        const colorHex = ringColorByIndex(ringIndex, startWithBlack);
        const isBlack = colorHex === '#000000';
        const color = isBlack ? rgb(0, 0, 0) : rgb(1, 1, 1);

        page.drawCircle({
          x: centerXPt,
          y: centerYPt,
          size: mmToPt(radiusMm),
          color,
          borderColor: ringIndex === 0 ? rgb(0, 0, 0) : undefined,
          borderWidth: ringIndex === 0 ? mmToPt(0.15) : 0,
        });
      }
    }
  }

  const bytes = await doc.save();
  const fileName = `archery-${input.pageWidthMm}x${input.pageHeightMm}-${input.diameterMm}mm.pdf`;
  triggerBrowserDownload(bytes, fileName);
}
