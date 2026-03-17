# taylorhere

## 子项目

- `archery/`：射箭训练标靶生成系统（前端 + Cloudflare Functions + PDF 导出）
- `site/`：`taylorhere.com` 独立软件宣传页面（内嵌并链接 `archery.taylorhere.com`）

## Cloudflare 部署变量

- `vars.CLOUDFLARE_MAIN_PAGES_PROJECT`：主站 Pages 项目名（用于 `taylorhere.com`）
- `vars.CLOUDFLARE_PAGES_PROJECT`：Archery Pages 项目名（用于 `archery.taylorhere.com`）
