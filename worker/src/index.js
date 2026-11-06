const ALLOWED_ORIGIN = "https://jerryp86.github.io";
const MODEL = "gpt-4.1-mini";
const DAILY_LIMIT = 6;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    core_message: { type: "string" },
    tensions: { type: "string" },
    opportunities: { type: "string" },
    risks: { type: "string" },
    scenarios: { type: "string" },
    prioritized_steps: { type: "string" },
    signals: { type: "string" },
    conclusion: { type: "string" }
  },
  required: ["core_message", "tensions", "opportunities", "risks", "scenarios", "prioritized_steps", "signals", "conclusion"],
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
    const standard = body.standard || {};
    if (!question) return json({ error: "請先輸入想探索的問題。" }, 400, ALLOWED_ORIGIN);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const key = "daily:" + day + ":" + await hash(ip);
    const used = Number(await env.USAGE_KV.get(key) || "0");
    if (used >= DAILY_LIMIT) {
      return json({ error: "今天的 AI 深度解析次數已達上限（每日 6 次），請明天再來探索。一般星骰解讀仍可正常使用。" }, 429, ALLOWED_ORIGIN);
    }

    const safe = value => String(value || "").slice(0, 500);
    const prompt = [
      "你是務實顧問型星骰分析師。使用繁體中文，語氣清楚、直接、尊重，不宿命、不恐嚇、不講空泛鼓勵。",
      "本功能必須延伸下方標準解讀，補足推理、情境、風險、判斷條件與優先方案；不要改寫或重複標準答案，也不可只把它拉長。",
      "使用者問題：" + question,
      "標準解讀問題類型：" + safe(standard.category),
      "標準解讀摘要：" + safe(standard.summary),
      "標準解讀行動步驟：" + (Array.isArray(standard.steps) ? standard.steps.slice(0, 3).map(safe).join("；") : ""),
      "行星：" + safe(planet.name) + "；象徵：" + safe(planet.keyword) + "；參考：" + safe(planet.meaning),
      "星座：" + safe(zodiac.name) + "；元素：" + safe(zodiac.element) + "；象徵：" + safe(zodiac.keyword) + "；參考：" + safe(zodiac.meaning),
      "宮位：" + safe(house.name) + "；生活領域：" + safe(house.domain) + "；參考：" + safe(house.meaning),
      "先辨識問題類型（例如感情、職涯、財務、人際、學習或生活選擇），再用三骰象徵分析該情境。若問題資訊不足，不可自行編造背景；請明確說明哪些是推論、哪些仍需使用者查證。",
      "請依序輸出八個欄位：",
      "1. core_message：延伸標準解讀，針對這個問題提出有條件的方向及其根據。",
      "2. tensions：指出至少一組需求、行動方式或現實條件間的深層拉扯，說明三骰如何形成這種張力。",
      "3. opportunities：指出問題類型下可把握的具體機會，以及成立所需條件。",
      "4. risks：列出現實風險、常見盲點和可降低風險的方法；不要將星象當證據。",
      "5. scenarios：提供兩種合理情境（條件、可能發展、對應做法），不得宣稱預測必然發生。",
      "6. prioritized_steps：列出 2 至 3 個有順序的具體行動，每步包含做法、期限或交付物及依據；說明先後理由。",
      "7. signals：列出可觀察的正向／警示訊號，以及明確複查時間與繼續、調整或停止的判準。",
      "8. conclusion：給出理由清楚的結論，說明目前最值得優先做什麼、為何如此，以及什麼新資訊會改變判斷。",
      "內容要有資訊密度，不重複骰象字典。各欄位約 40 至 90 個中文字，scenarios、prioritized_steps 與 signals 可較長；整體清楚易讀。",
      "不可宣稱知道第三者真實想法、不可保證未來結果。骰象只作為反思工具，不是事實證據。涉及醫療、法律、投資或重大財務決策時，不提供專業結論，提醒結合現實資料及合格專業意見。"
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
        max_output_tokens: 1400,
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
