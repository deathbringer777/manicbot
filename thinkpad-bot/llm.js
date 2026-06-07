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

async function callGroq(messages, useTools = true) {
  const body = {
    model: config.GROQ_MODEL,
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

async function ask(chatId, userText) {
  if (!histories.has(chatId)) histories.set(chatId, []);
  const history = histories.get(chatId);
  history.push({ role: "user", content: userText });
  if (history.length > 20) history.splice(0, 2);

  const sysMsg = { role: "system", content: tools.getSystemPrompt() };
  let iterations = 0;
  const MAX_TOOL_ITERATIONS = 25;

  while (iterations++ < MAX_TOOL_ITERATIONS) {
    let data = await callGroq([sysMsg, ...history], true);

    if (data.error?.type === "failed_generation" || data.error?.code === "tool_use_failed") {
      console.log("[llm] failed_generation, retrying without tools");
      data = await callGroq([sysMsg, ...history], false);
    }

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const choice = data.choices[0];
    const msg = choice.message;

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      history.push(msg);
      for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        console.log(`[tool] ${call.function.name}`, JSON.stringify(args).slice(0, 120));
        const result = await tools.runTool(call.function.name, args);
        console.log(`[→] ${String(result).slice(0, 200)}`);
        history.push({ role: "tool", tool_call_id: call.id, content: String(result) });
      }
    } else {
      const reply = msg.content || "(пустой ответ)";
      history.push({ role: "assistant", content: reply });
      return reply;
    }
  }
  throw new Error(`LLM: превышен лимит вызовов инструментов (${MAX_TOOL_ITERATIONS})`);
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
