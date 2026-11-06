# 星骰 AI 深度解析｜Cloudflare Worker 部署

此目錄提供星骰網站的安全 AI 後端。OpenAI API Key 僅儲存在 Cloudflare Worker Secret，不會放進 GitHub Pages 前端。

## 成本控制設計

- 模型：`gpt-4.1-mini`，以較低成本提供結構化解讀。
- 每個來源 IP 每日最多 6 次 AI 深度解析；一般三骰解讀不受影響。
- 僅在使用者主動點選「AI 深度解析」時呼叫 API。
- 限制問題長度、輸出 token，並以 JSON Schema 固定八段回應：延伸結論、深層拉扯、機會、風險、情境、排序行動、觀察訊號／複查標準、理由結論。
- 建議同時在 OpenAI Platform 設定月度預算／用量通知。IP 次數限制不是完整的全球預算上限。

## 部署步驟

1. 在 Cloudflare 建立 KV Namespace，名稱可用 `ASTRO_DICE_USAGE`。
2. 複製 Namespace ID，填入 `worker/wrangler.toml` 的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`。
3. 安裝 Wrangler（本機需 Node.js）：`npm install -g wrangler`。
4. 登入 Cloudflare：`wrangler login`。
5. 在 `worker` 目錄設定 API Key Secret：`wrangler secret put OPENAI_API_KEY`，貼上 OpenAI API Key。
6. 部署：`wrangler deploy`。
7. 部署成功後，複製 Worker 網址，例如 `https://astro-dice-deep-reading.<你的帳號>.workers.dev`。
8. 編輯根目錄 `index.html`，將 `DEEP_API_URL` 改成該網址，並在網址最後加上 `/`（例如 `https://...workers.dev/`）。提交後等待 GitHub Pages 更新。

## API

前端向 Worker 根路徑送出 POST JSON：

```json
{
  "question": "我想探索目前的工作方向",
  "planet": { "name": "土星", "keyword": "責任、限制、規範", "meaning": "..." },
  "zodiac": { "name": "摩羯座", "element": "土", "keyword": "紀律、責任、目標", "meaning": "..." },
  "house": { "name": "第十宮・事業", "domain": "事業、成就、社會地位", "meaning": "..." }
}
```

成功時回傳八個欄位：`core_message`、`tensions`、`opportunities`、`risks`、`scenarios`、`prioritized_steps`、`signals`、`conclusion`。前端同時傳入標準解讀摘要和步驟，讓 AI 延伸既有建議。

## 安全與限制

- 僅允許 `https://jerryp86.github.io` 網站來源。
- OpenAI Key 不會傳回瀏覽器。
- 不儲存 OpenAI Responses（`store: false`）。
- KV 依 IP 與日期計算每日次數；同一 IP 的多人會共用額度，使用 VPN 或更換網路也可能改變額度。
- 若要公開大量使用，建議再加上 Cloudflare Turnstile、全站每日總額度與更嚴格的濫用防護。
