# 星骰 Astro Dice

一個以繁體中文呈現的互動占星骰子網站，提供自我探索與反思的靈感。

## 使用方式

在提問欄輸入一個明確問題。每次擲出一個行星／交點、一個星座與一個宮位，網站會播放擲骰動畫，並依感情、職涯、財務、人際合作、學習成長或自我探索六類問題給出情境化的標準解讀。標準解讀不呼叫 API，包含三骰互動、風險檢核及三個可執行步驟。使用者可選擇額外的 AI 深度解讀；結果可複製或透過裝置分享。

## 參考資料

- 12 個占星行星／交點象徵：太陽、月亮、水星、金星、火星、木星、土星、天王星、海王星、冥王星、北交點、南交點。
- 12 星座與火、土、風、水四元素。
- 黃道十二宮位及其常見生活領域。

網站前端以靜態 `index.html` 運作。只有使用者主動選擇 AI 深度解讀時，才會呼叫 Cloudflare Worker。

## 本機檢查

需要 Node.js 20 或更新版本，執行：`node --test tests/*.test.mjs`。

## GitHub Pages

Repository Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/(root)`。

## 使用提醒

星骰是占星象徵的自我探索工具，不是確定預言，亦不構成醫療、法律或財務建議。重要決策請結合現實資訊與專業意見。

AI 深度解讀仍依賴已設定的 Cloudflare Worker 與 OpenAI API Key；Worker 與每日額度設定見 [`worker/README.md`](worker/README.md)。
