# 射箭训练标靶生成系统（Cloudflare 可部署）

该项目是一个可直接部署的“前端 + 后端 + PDF”一体化实现，满足以下核心目标：

- 前端动态配置参数并实时预览（SVG 矢量）
- 严格几何约束下自动求最优排布（最大化 `n × m`）
- 浏览器端生成可打印 PDF（矢量，毫米精确）
- Cloudflare Pages + Functions 无服务器部署

---

## 1. 功能总览

### 前端

- 配置项：
  - 标靶直径 `D`（mm）
  - 页面尺寸（A4 / A3 / 自定义 mm）
  - 最小间距 `s_min`（默认 3mm）
  - 圆环数量（默认 3）
  - 黑白棋盘交替模式（默认开启）
- 输出：
  - 列数 `n`
  - 行数 `m`
  - 统一间距 `s`
  - 总数量 `n × m`
- 预览：
  - SVG 矢量渲染（WYSIWYG 比例）
  - mm -> px 换算：`96 / 25.4`
  - 可缩放、居中显示
- PDF：
  - `pdf-lib` 生成矢量 PDF
  - 尺寸按 mm 精确映射到 pt（`72 / 25.4`）
  - 支持下载打印

### 后端（Cloudflare Functions）

- `POST /api/layout`
- 入参：页面宽高、标靶直径、最小间距
- 出参：最优 `n/m/s/total` 或无解原因
- 前后端共用 `shared/layout.ts`，避免算法漂移

---

## 2. 关键几何约束

设页面尺寸为 `W × H`，标靶直径 `D`，列数 `n`，行数 `m`，统一间距/页边距 `s`，必须同时满足：

```text
W = n·D + (n+1)·s
H = m·D + (m+1)·s
```

并且：

- 页边距 = 标靶间距 = `s`
- 上下左右页边距一致
- 水平/垂直间距一致（禁止 `s_w` / `s_h`）
- `s >= s_min`
- 允许 `s` 为浮点 mm

优化目标：在全部合法解中最大化 `n × m`。

---

## 3. 项目结构

```text
archery/
├─ functions/
│  └─ api/
│     └─ layout.ts          # Cloudflare Pages Function（后端API）
├─ shared/
│  └─ layout.ts             # 前后端共用的排布算法
├─ src/
│  ├─ main.ts               # 前端页面与SVG实时预览
│  ├─ pdf.ts                # PDF矢量导出
│  └─ style.css
├─ index.html
├─ package.json
└─ wrangler.toml
```

---

## 4. 本地运行

```bash
cd archery
npm install
npm run dev
```

构建：

```bash
npm run build
```

---

## 5. Cloudflare 部署（GitHub Actions）

工作流文件：`.github/workflows/deploy-archery-pages.yml`

需要在 GitHub 仓库配置：

- `secrets.CLOUDFLARE_API_TOKEN`
- `secrets.CLOUDFLARE_ACCOUNT_ID`
- `vars.CLOUDFLARE_PAGES_PROJECT`（Pages 项目名）

推送后会自动：

1. 构建 `archery` 前端
2. 部署 `archery/dist` 静态资源
3. 一并部署 `archery/functions` 的 Serverless API

---

## 6. 示例参数

### 示例 A（用户要求示例）：A4 + D=28mm + s_min=3mm

- 参数：
  - 页面：A4（210 × 297）
  - 直径：28
  - 最小间距：3
- 在“严格等式 + 同一 `s`”约束下，可能出现**无解**（系统会明确提示）。

### 示例 B（可行解示例）：A4 + D=24mm + s_min=3mm

- 可用于快速验证系统输出与 PDF 导出流程。

---

## 7. 打印建议

- 打印对话框选择 **100% 缩放**
- 关闭“适合页面 / Fit to page”
- 使用无边距偏移的打印设置（若打印机支持）
