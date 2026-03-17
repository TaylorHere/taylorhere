# taylorhere

## 子项目

- `archery/`：射箭训练标靶生成系统（前端 + Cloudflare Functions + PDF 导出）
- `site/`：`taylorhere.com` 独立软件宣传页面（内嵌并链接 `archery.taylorhere.com`）

## Cloudflare 部署变量

- 主站项目名固定为 `taylorhere`（用于 `taylorhere.com`）
- 子项目项目名固定为对应文件夹名（例如 `archery/` 对应 Pages 项目 `archery`）
- `secrets.CLOUDFLARE_DNS_API_TOKEN`（可选，推荐）：用于自动创建/更新 DNS 记录；需包含 Zone Read + DNS Edit
- 说明：若未单独配置 `CLOUDFLARE_DNS_API_TOKEN`，工作流会回退使用 `CLOUDFLARE_API_TOKEN`
