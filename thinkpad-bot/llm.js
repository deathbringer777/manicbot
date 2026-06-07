const config = require("./config.js");
const tools = require("./tools.js");

const histories = new Map();

const groqStats = {
  lastUpdated: null,
  model: config.GROQ_MODEL,
  rl: {},
  session: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  startedAt: new Date().toISOString(),
};

async function callGroq(messages, useTools = true, model = config.GROQ_MODEL) {
  const body = {
    model,
    messages,
    max_tokens: config.MAX_TOKENS,
    temperature: config.TEMPERATURE,
  };
  if (useTools) {
    body.tools = tools.TOOLS_DEFINITIONS;
    body.tool_choice = "auto";
  }

  const r = await fetch(config.GROQ_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.GROQ_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  groqStats.lastUpdated = new Date().toISOString();
  groqStats.rl = {
    reqLimit:        r.headers.get("x-ratelimit-limit-requests"),
    reqRemaining:    r.headers.get("x-ratelimit-remaining-requests"),
    reqReset:        r.headers.get("x-ratelimit-reset-requests"),
    tokLimit:        r.headers.get("x-ratelimit-limit-tokens"),
    tokRemaining:    r.headers.get("x-ratelimit-remaining-tokens"),
    tokReset:        r.headers.get("x-ratelimit-reset-tokens"),
    tokDayLimit:     r.headers.get("x-ratelimit-limit-tokens-per-day"),
    tokDayRemaining: r.headers.get("x-ratelimit-remaining-tokens-per-day"),
    tokDayReset:     r.headers.get("x-ratelimit-reset-tokens-per-day"),
  };

  const data = await r.json();

  if (data.usage) {
    groqStats.session.calls++;
    groqStats.session.promptTokens     += data.usage.prompt_tokens     || 0;
    groqStats.session.completionTokens += data.usage.completion_tokens || 0;
    groqStats.session.totalTokens      += data.usage.total_tokens      || 0;
  }

  return data;
}

const MAX_TOOL_ITERATIONS = 12;
const MAX_TOOL_RESULT = 1500; // cap each tool result fed back to the model

function isRateLimited(data) {
  return !!data.error && (
    data.error.code === "rate_limit_exceeded" ||
    /rate.?limit/i.test(data.error.message || "")
  );
}

function rateLimitReset(data) {
  const m = (data.error?.message || "").match(/try again in ([\dhms.]+)/i);
  if (m) return m[1];
  return groqStats.rl.tokDayReset || groqStats.rl.tokReset || "несколько минут";
}

async function ask(chatId, userText) {
  if (!histories.has(chatId)) histories.set(chatId, []);
  const history = histories.get(chatId);
  history.push({ role: "user", content: userText });
  if (history.length > 16) history.splice(0, history.length - 16);

  const sysMsg = { role: "system", content: tools.getSystemPrompt() };
  let model = config.GROQ_MODEL;
  let triedFast = false;
  let iterations = 0;

  while (iterations++ < MAX_TOOL_ITERATIONS) {
    let data = await callGroq([sysMsg, ...history], true, model);

    // Rate-limited on the primary model → fall back to the fast model once
    // (separate quota). Keeps the bot answering instead of going silent.
    if (isRateLimited(data) && !triedFast) {
      triedFast = true;
      model = config.GROQ_FAST_MODEL;
      console.log("[llm] rate limited → switching to", model);
      data = await callGroq([sysMsg, ...history], true, model);
    }
    if (isRateLimited(data)) {
      return `🤖 Лимит Groq исчерпан — ИИ вернётся через ~${rateLimitReset(data)}.\nКоманды (/status, /play, скриншот) и музыка работают как обычно.`;
    }

    if (data.error?.type === "failed_generation" || data.error?.code === "tool_use_failed") {
      console.log("[llm] failed_generation, retrying without tools");
      data = await callGroq([sysMsg, ...history], false, model);
    }
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const choice = data.choices[0];
    const msg = choice.message;

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      history.push(msg);
      for (const call of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments); } catch { /* leave empty */ }
        console.log(`[tool] ${call.function.name}`, JSON.stringify(args).slice(0, 120));
        const result = await tools.runTool(call.function.name, args);
        history.push({ role: "tool", tool_call_id: call.id, content: String(result).slice(0, MAX_TOOL_RESULT) });
      }
    } else {
      const reply = msg.content || "(пустой ответ)";
      history.push({ role: "assistant", content: reply });
      return reply;
    }
  }
  return "⚠️ Слишком много шагов — задача оказалась сложной. Сформулируй конкретнее или разбей на части.";
}

function getStats() {
  return { ...groqStats };
}

function resetHistory(chatId) {
  histories.delete(chatId);
}

module.exports = {
  callGroq,
  ask,
  getStats,
  resetHistory,
};
