# 星骰 AI 深度解析｜Cloudflare Worker 部署

此目錄提供星骰網站的安全 AI 後端。OpenAI API Key 僅儲存在 Cloudflare Worker Secret，不會放進 GitHub Pages 前端。

## 現有功能與成本監控

- 模型：`gpt-4.1-mini`，使用 OpenAI Responses API，`store: false`。
- 每個來源 IP 每日最多 6 次 AI 深度解析；一般三骰解讀不受影響。
- 沿用既有 `USAGE_KV` Namespace；不需要新建資料庫或更換 KV binding。
- 每次上游 API 嘗試會寫入一筆獨立 KV event（成功、上游錯誤、網路錯誤或無效回應），避免多人同時請求時共用每日彙總 key 的讀改寫碰撞。
- 記錄每日 API 呼叫數、成功／失敗數、Input／Cached Input／Output／Total Tokens，以及依模型費率估算的 USD 費用。
- 使用量事件保留 90 天；原本 IP 日額度 key 仍保留 48 小時。
- 管理報表端點：`GET /admin/usage`；可加 `?month=YYYY-MM` 查詢月份。
- 報表以 UTC 日界線彙總；Cloudflare KV 為 eventual consistency，最新事件可能延遲約 60 秒出現。
- 月預算只產生警戒狀態，不會自動阻擋 API 呼叫；真正帳單以 OpenAI Dashboard 為準。

## 模型費率與估算方式

目前程式定價表（每 1,000,000 tokens）：

| 類型 | USD |
|---|---:|
| Input | $0.40 |
| Cached Input | $0.10 |
| Output | $1.60 |

費用估算公式：
`((Input - Cached Input) × 0.40 + Cached Input × 0.10 + Output × 1.60) / 1,000,000`

費率依 OpenAI 官方定價頁面核對，更新日期記錄於程式 `PRICING_DATE`。模型價格若有變動，需同步更新該常數。這是依 API usage 回傳值估算的模型 token 費用，不是實際帳單；其他產品費用、稅金、折扣或帳戶層級調整不一定包含在內。

## Cloudflare 手動設定

在 Cloudflare Dashboard → Workers & Pages → `astro-dice-deep-reading` → Settings → Variables and Secrets：

**Secrets**
1. 保留現有 `OPENAI_API_KEY`，不要把值貼到 GitHub、程式碼或日誌。
2. 新增 `USAGE_ADMIN_TOKEN`：使用密碼管理器產生至少 32 bytes 的隨機高熵字串。此 token 只供管理者查詢報表，切勿放進前端。

**Variables**
1. 新增 `MONTHLY_BUDGET_USD`：你的月預算美元數字，例如 `10`（請自行決定）。
2. 可選 `BUDGET_WARNING_RATIO`：預警比例，預設 `0.8`（即預算 80%）。

保存設定後重新部署／確認 Worker 使用最新設定。不要建立第二個 KV Namespace；確認既有 binding 名稱仍為 `USAGE_KV`。

## 查詢報表

用管理者工具或 curl 對 Worker URL 發送 GET，並在 Authorization header 傳入 Secret：

```bash
curl -H "Authorization: Bearer $USAGE_ADMIN_TOKEN" \
  "https://astro-dice-deep-reading.<你的帳號>.workers.dev/admin/usage"
```

指定月份：

```bash
curl -H "Authorization: Bearer $USAGE_ADMIN_TOKEN" \
  "https://astro-dice-deep-reading.<你的帳號>.workers.dev/admin/usage?month=2026-11"
```

回傳包含 `daily` 每日明細、`totals` 月累計、`budget.status`（`ok`、`warning`、`budget_reached` 或 `not_configured`），以及費率資訊。報表不含 IP、提問內容、API Key 或管理 token。

## 部署

1. 安裝 Wrangler：`npm install -g wrangler`。
2. 登入 Cloudflare：`wrangler login`。
3. 在 `worker` 目錄部署：`wrangler deploy`。
4. 確認 Worker 的既有 `USAGE_KV` binding 指向原本 Namespace。
5. 保留 GitHub Pages 前端的既有 Worker URL；本次不需要修改 `index.html`。

## API 與安全

- 僅允許 `https://jerryp86.github.io` 網站來源呼叫一般解析端點。
- OpenAI Key 僅由 Worker Secret 提供，絕不回傳瀏覽器。
- 上游錯誤日誌只記錄狀態碼，不記錄完整錯誤 body、請求內容或 headers。
- 管理端點不開放 CORS，並要求獨立的 `USAGE_ADMIN_TOKEN`。
- 原有 IP 日額度 key 維持 SHA-256 雜湊 IP 與每日日期組合；每日 6 次限制不變。
- KV 的讀取／寫入限制不是嚴格原子交易；同一 IP 同時發出多個請求時，KV eventual consistency 仍可能造成競爭。若需要嚴格全域硬上限，應另評估 Durable Objects 或具原子性的 rate limiter。
- 若要公開大量使用，建議再加 Cloudflare Turnstile、全站每日總額度與更嚴格的濫用防護。
