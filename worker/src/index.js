const ALLOWED_ORIGIN = "https://jerryp86.github.io";
const MODEL = "gpt-4.1-mini";
const DAILY_LIMIT = 6;
const PRICING = { input: 0.40, cachedInput: 0.10, output: 1.60 };
const PRICING_DATE = "2026-11-11";
const RETENTION = 60 * 60 * 24 * 90;
const SCHEMA = {
  type: "object",
  properties: {
    core_message: { type: "string" }, tensions: { type: "string" },
    opportunities: { type: "string" }, risks: { type: "string" },
    scenarios: { type: "string" }, prioritized_steps: { type: "string" },
    signals: { type: "string" }, conclusion: { type: "string" }
  },
  required: ["core_message","tensions","opportunities","risks","scenarios","prioritized_steps","signals","conclusion"],
  additionalProperties: false
};
function json(data, status, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":origin, "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type", "Vary":"Origin"
  }});
}
function adminJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "Vary":"Authorization"
  }});
}
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a,b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i=0;i<Math.max(x.length,y.length);i++) diff |= (x[i]||0) ^ (y[i]||0);
  return diff === 0;
}
const n = v => Number.isSafeInteger(Number(v)) && Number(v)>=0 ? Number(v) : 0;
const money = v => Math.round((v + Number.EPSILON)*1e10)/1e10;
function tokenCost(usage) {
  const input=n(usage?.input_tokens), output=n(usage?.output_tokens);
  const cached=Math.min(input,n(usage?.input_tokens_details?.cached_tokens));
  return { usage_available:!!usage && typeof usage==="object", input_tokens:input,
    cached_input_tokens:cached, output_tokens:output,
    total_tokens:n(usage?.total_tokens)||input+output,
    estimated_cost_usd:money(((input-cached)*PRICING.input+cached*PRICING.cachedInput+output*PRICING.output)/1e6) };
}
async function logUsage(env,status,usage,upstreamStatus=null) {
  const now=new Date().toISOString(), date=now.slice(0,10), month=date.slice(0,7);
  const metadata={version:1,timestamp:now,date,model:MODEL,status,upstream_status:upstreamStatus,
    ...tokenCost(usage),pricing_effective_date:PRICING_DATE};
  try {
    await env.USAGE_KV.put(`usage:event:${month}:${date}:${crypto.randomUUID()}`,"",{
      expirationTtl:RETENTION,metadata
    });
  } catch { console.error("Usage event could not be saved to KV."); }
}
function bucket(date) { return {date,api_calls:0,successful_calls:0,failed_calls:0,usage_missing_calls:0,
  input_tokens:0,cached_input_tokens:0,output_tokens:0,total_tokens:0,estimated_cost_usd:0}; }
async function usageReport(kv,month,env) {
  const prefix=`usage:event:${month}:`, days=new Map(); let cursor,pages=0,complete=false,records=0;
  do {
    const opts={prefix,limit:1000}; if(cursor) opts.cursor=cursor;
    const page=await kv.list(opts); pages++;
    for(const item of page.keys||[]) {
      records++; const m=item.metadata||{};
      const date=m.date || item.name.slice(prefix.length, prefix.length+10);
      if(!days.has(date)) days.set(date,bucket(date));
      const b=days.get(date); b.api_calls++;
      if(m.status==="success") b.successful_calls++; else b.failed_calls++;
      if(m.usage_available!==true) b.usage_missing_calls++;
      for(const field of ["input_tokens","cached_input_tokens","output_tokens","total_tokens"]) b[field]+=n(m[field]);
      b.estimated_cost_usd+=Number(m.estimated_cost_usd)||0;
    }
    complete=page.list_complete===true; cursor=page.cursor;
    if(!complete&&!cursor) break;
  } while(!complete&&pages<100);
  const daily=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const totals=daily.reduce((s,d)=>{
    for(const k of ["api_calls","successful_calls","failed_calls","usage_missing_calls","input_tokens","cached_input_tokens","output_tokens","total_tokens"]) s[k]+=d[k];
    s.estimated_cost_usd+=d.estimated_cost_usd; return s;
  },bucket("month-total"));
  for(const d of daily) d.estimated_cost_usd=money(d.estimated_cost_usd);
  totals.estimated_cost_usd=money(totals.estimated_cost_usd);
  const budget=Number(env.MONTHLY_BUDGET_USD), configured=Number.isFinite(budget)&&budget>0;
  const ratioValue=Number(env.BUDGET_WARNING_RATIO);
  const ratio=Number.isFinite(ratioValue)&&ratioValue>0&&ratioValue<=1?ratioValue:0.8;
  return {month,timezone:"UTC",model:MODEL,event_records:records,complete,pages_read:pages,daily,totals,
    pricing:{currency:"USD",effective_date:PRICING_DATE,input_per_million_tokens:PRICING.input,
      cached_input_per_million_tokens:PRICING.cachedInput,output_per_million_tokens:PRICING.output},
    budget:{status:!configured?"not_configured":totals.estimated_cost_usd>=budget?"budget_reached":
      totals.estimated_cost_usd>=budget*ratio?"warning":"ok",monthly_budget_usd:configured?budget:null,
      warning_ratio:ratio,warning_at_usd:configured?money(budget*ratio):null,
      remaining_estimated_usd:configured?money(Math.max(0,budget-totals.estimated_cost_usd)):null,
      percent_used:configured?money(totals.estimated_cost_usd/budget*100):null,enforcement:"report_only"},
    retention_days:90,cost_note:"Estimated from API token usage and published model rates; not an invoice or account billing total.",
    consistency_note:"KV is eventually consistent; recent events may take about 60 seconds to appear."};
}
async function adminUsage(request,env) {
  if(request.method!=="GET") return adminJson({error:"僅接受 GET 請求。"},405);
  if(!env.USAGE_ADMIN_TOKEN) return adminJson({error:"管理報表尚未設定。"},503);
  if(!safeEqual(request.headers.get("Authorization")||"",`Bearer ${env.USAGE_ADMIN_TOKEN}`))
    return adminJson({error:"未經授權。"},401);
  if(!env.USAGE_KV) return adminJson({error:"使用量 KV 尚未設定。"},503);
  const requested=new URL(request.url).searchParams.get("month");
  const month=requested||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return adminJson({error:"月份格式錯誤，請使用 YYYY-MM。"},400);
  try { return adminJson(await usageReport(env.USAGE_KV,month,env)); }
  catch { console.error("Usage report could not be generated."); return adminJson({error:"目前無法產生使用量報表。"},500); }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/admin/usage") return adminUsage(request,env);
    const origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS") {
      if(origin!==ALLOWED_ORIGIN) return new Response(null,{status:403});
      return new Response(null,{headers:{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type",
        "Access-Control-Max-Age":"86400","Vary":"Origin"}});
    }
    if(origin!==ALLOWED_ORIGIN) return json({error:"來源網站未獲授權。"},403);
    if(request.method!=="POST") return json({error:"僅接受 POST 請求。"},405);
    if(!env.OPENAI_API_KEY) return json({error:"AI 服務尚未完成設定。"},503);
    if(!env.USAGE_KV) return json({error:"使用量控管尚未設定，請聯絡網站管理者。"},503);
    let body; try { body=await request.json(); } catch { return json({error:"請求格式不正確。"},400); }
    const question=String(body.question||"").trim().slice(0,240);
    const planet=body.planet||{}, zodiac=body.zodiac||{}, house=body.house||{}, standard=body.standard||{};
    if(!question) return json({error:"請先輸入想探索的問題。"},400);
    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const day=new Date().toISOString().slice(0,10);
    const key="daily:"+day+":"+await hash(ip);
    let used;
    try { const value=Number(await env.USAGE_KV.get(key)||"0"); used=Number.isFinite(value)&&value>0?value:0; }
    catch { return json({error:"使用量控管暫時無法讀取，請稍後再試。"},503); }
    if(used>=DAILY_LIMIT) return json({error:"今天的 AI 深度解析次數已達上限（每日 6 次），請明天再來探索。一般星骰解讀仍可正常使用。"},429);
    // Preserve the existing per-IP daily counter and reserve a slot before calling OpenAI.
    try { await env.USAGE_KV.put(key,String(used+1),{expirationTtl:60*60*48}); }
    catch { return json({error:"使用量控管暫時無法寫入，為避免超額呼叫，請稍後再試。"},503); }
    const safe=value=>String(value||"").slice(0,500);
    const prompt=[
      "你是務實顧問型星骰分析師。使用繁體中文，語氣清楚、直接、尊重，不宿命、不恐嚇、不講空泛鼓勵。",
      "本功能必須延伸下方標準解讀，補足推理、情境、風險、判斷條件與優先方案；不要改寫或重複標準答案，也不可只把它拉長。",
      "使用者問題："+question,"標準解讀問題類型："+safe(standard.category),
      "標準解讀摘要："+safe(standard.summary),
      "標準解讀行動步驟："+(Array.isArray(standard.steps)?standard.steps.slice(0,3).map(safe).join("；"):""),
      "行星："+safe(planet.name)+"；象徵："+safe(planet.keyword)+"；參考："+safe(planet.meaning),
      "星座："+safe(zodiac.name)+"；元素："+safe(zodiac.element)+"；象徵："+safe(zodiac.keyword)+"；參考："+safe(zodiac.meaning),
      "宮位："+safe(house.name)+"；生活領域："+safe(house.domain)+"；參考："+safe(house.meaning),
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
    let response;
    try {
      response=await fetch("https://api.openai.com/v1/responses",{method:"POST",
        headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({model:MODEL,input:[
          {role:"system",content:"你是星骰自我探索解讀助手。保持尊重、非宿命論、務實且不恐嚇。只輸出符合指定 JSON Schema 的繁體中文內容。"},
          {role:"user",content:prompt}],
          text:{format:{type:"json_schema",name:"astro_dice_deep_reading",strict:true,schema:SCHEMA},verbosity:"medium"},
          max_output_tokens:1400,store:false})});
    } catch {
      await logUsage(env,"network_error",null); console.error("OpenAI API request failed: network error.");
      return json({error:"AI 服務暫時無法連線，請稍後再試。"},502);
    }
    if(!response.ok) {
      await logUsage(env,"upstream_error",null,response.status);
      console.error("OpenAI API request failed with status:",response.status);
      return json({error:"OpenAI API 請求失敗（HTTP "+response.status+"）。請將這個狀態碼提供給管理者。",upstream_status:response.status},502);
    }
    let result; try { result=await response.json(); }
    catch { await logUsage(env,"invalid_response",null,response.status); return json({error:"AI 回傳內容無法讀取，請稍後重試。"},502); }
    const outputText=(result.output||[]).flatMap(item=>item.content||[])
      .filter(item=>item.type==="output_text").map(item=>item.text).join("");
    if(!outputText) { await logUsage(env,"invalid_response",result.usage,response.status); return json({error:"AI 回傳內容不完整，請稍後重試。"},502); }
    let reading; try { reading=JSON.parse(outputText); }
    catch { await logUsage(env,"invalid_response",result.usage,response.status); return json({error:"AI 回傳格式暫時無法讀取，請稍後重試。"},502); }
    await logUsage(env,"success",result.usage,response.status);
    return json(reading,200);
  }
};