const ALLOWED_ORIGIN = "https://jerryp86.github.io";
const MODEL = "gpt-4.1-mini";
const DAILY_LIMIT = 6;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    core_message: { type: "string" },
    planet_insight: { type: "string" },
    zodiac_insight: { type: "string" },
    house_insight: { type: "string" },
    integration: { type: "string" },
    action_steps: { type: "string" },
    closing_message: { type: "string" }
  },
  required: ["core_message", "planet_insight", "zodiac_insight", "house_insight", "integration", "action_steps", "closing_message"],
  additionalProperties: false
};

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  });
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }
    if (origin !== ALLOWED_ORIGIN) return json({ error: "來源網站未獲授權。" }, 403, ALLOWED_ORIGIN);
    if (request.method !== "POST") return json({ error: "僅接受 POST 請求。" }, 405, ALLOWED_ORIGIN);
    if (!env.OPENAI_API_KEY) return json({ error: "AI 服務尚未完成設定。" }, 503, ALLOWED_ORIGIN);
    if (!env.USAGE_KV) return json({ error: "使用量控管尚未設定，請聯絡網站管理者。" }, 503, ALLOWED_ORIGIN);

    let body;
    try { body = await request.json(); } catch { return json({ error: "請求格式不正確。" }, 400, ALLOWED_ORIGIN); }
    const question = String(body.question || "").trim().slice(0, 240);
    const planet = body.planet || {};
    const zodiac = body.zodiac || {};
    const house = body.house || {};
    if (!question) return json({ error: "請先輸入想探索的問題。" }, 400, ALLOWED_ORIGIN);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const key = "daily:" + day + ":" + await hash(ip);
    const used = Number(await env.USAGE_KV.get(key) || "0");
    if (used >= DAILY_LIMIT) {
      return json({ error: "今天的 AI 深度解析次數已達上限（每日 5 次），請明天再來探索。一般星骰解讀仍可正常使用。" }, 429, ALLOWED_ORIGIN);
    }

    const safe = value => String(value || "").slice(0, 500);
    const prompt = [
      "使用繁體中文，為星骰網站撰寫溫和、清晰、具體的自我探索解讀。",
      "使用者問題：" + question,
      "行星：" + safe(planet.name) + "；象徵：" + safe(planet.keyword) + "；參考：" + safe(planet.meaning),
      "星座：" + safe(zodiac.name) + "；元素：" + safe(zodiac.element) + "；象徵：" + safe(zodiac.keyword) + "；參考：" + safe(zodiac.meaning),
      "宮位：" + safe(house.name) + "；生活領域：" + safe(house.domain) + "；參考：" + safe(house.meaning),
      "請依序提供：核心訊息、行星如何反映問題核心、星座如何影響表達方式、宮位如何落實到生活、三骰整合（包含相互支持處與可能盲點）、三個具體且低風險的小步驟、最後一句提醒。",
      "每個欄位約 60 至 100 個中文字；action_steps 請用 1. 2. 3. 分列。必須針對使用者的原始問題與三骰組合分析，不要只重述字典。指出不確定性，不把骰子說成必然預言。",
      "避免醫療、法律、投資等專業結論；若問題涉及重大決策，提醒使用者結合現實資料與合格專業意見。"
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: "system", content: "你是星骰自我探索解讀助手。保持尊重、非宿命論、務實且不恐嚇。只輸出符合指定 JSON Schema 的繁體中文內容。" },
          { role: "user", content: prompt }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "astro_dice_deep_reading",
            strict: true,
            schema: OUTPUT_SCHEMA
          },
          verbosity: "medium"
        },
        max_output_tokens: 1100,
        store: false
      })
    });

    if (!response.ok) {
      const upstreamError = await response.text();
      console.error("OpenAI API request failed:", response.status, upstreamError.slice(0, 2000));
      return json({
        error: "OpenAI API 請求失敗（HTTP " + response.status + "）。請將這個狀態碼提供給管理者。",
        upstream_status: response.status
      }, 502, ALLOWED_ORIGIN);
    }
    const result = await response.json();
    const outputText = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("");
    if (!outputText) return json({ error: "AI 回傳內容不完整，請稍後重試。" }, 502, ALLOWED_ORIGIN);
    let reading;
    try { reading = JSON.parse(outputText); } catch {
      return json({ error: "AI 回傳格式暫時無法讀取，請稍後重試。" }, 502, ALLOWED_ORIGIN);
    }

    await env.USAGE_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
    return json(reading, 200, ALLOWED_ORIGIN);
  }
};
