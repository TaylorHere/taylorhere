import { solveOptimalLayout, validateInput, type LayoutInput } from '../../shared/layout';

interface JsonPayload {
  pageWidthMm?: unknown;
  pageHeightMm?: unknown;
  targetDiameterMm?: unknown;
  minSpacingMm?: unknown;
}

export const onRequestPost: PagesFunction = async (context) => {
  try {
    const payload = (await context.request.json()) as JsonPayload;
    const input: LayoutInput = {
      pageWidthMm: Number(payload.pageWidthMm),
      pageHeightMm: Number(payload.pageHeightMm),
      targetDiameterMm: Number(payload.targetDiameterMm),
      minSpacingMm: Number(payload.minSpacingMm),
    };

    const validation = validateInput(input);
    if (!validation.ok) {
      return json(
        {
          ok: false,
          layout: null,
          reason: validation.reason ?? '参数无效',
        },
        400,
      );
    }

    const layout = solveOptimalLayout(input);
    if (!layout) {
      return json({
        ok: false,
        layout: null,
        reason: '当前参数不存在满足严格对称约束的 (n, m, s) 组合',
      });
    }

    return json({ ok: true, layout });
  } catch {
    return json(
      {
        ok: false,
        layout: null,
        reason: '请求体必须是 JSON',
      },
      400,
    );
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
