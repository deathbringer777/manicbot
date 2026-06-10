const config = require("./config.js");
const tools = require("./tools.js");

const histories = new Map();
const sessionEffort = new Map(); // per-chat effort level for callAnthropic

const groqStats = {
  lastUpdated: null,
  model: config.GROQ_MODEL,
  rl: {},
  session: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  startedAt: new Date().toISOString(),
};

const opencodeStats = {
  lastUpdated: null,
  model: config.OPENCODE_MODEL,
  session: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  startedAt: new Date().toISOString(),
};

const anthropicStats = {
  lastUpdated: null,
  model: config.ANTHROPIC_MODEL,
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

async function callOpenCode(messages, useTools = true) {
  const model = config.OPENCODE_MODEL;

  // DeepSeek won't accept reasoning_content or tool_calls from other
  // providers (Groq). Strip them and drop tool-only assistant messages.
  const cleanMessages = messages.filter((m) => {
    if (m.role === "tool") return false;
    if (m.role === "assistant" && !m.content && m.tool_calls) return false;
    return true;
  }).map((m) => {
    const clean = { ...m };
    delete clean.reasoning_content;
    delete clean.tool_calls;
    return clean;
  });

  const body = {
    model,
    messages: cleanMessages,
    max_tokens: config.OPENCODE_MAX_TOKENS,
    temperature: config.TEMPERATURE,
  };
  if (useTools) {
    body.tools = tools.TOOLS_DEFINITIONS;
    body.tool_choice = "auto";
  }

  const r = await fetch(config.OPENCODE_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENCODE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  opencodeStats.lastUpdated = new Date().toISOString();

  const data = await r.json();

  if (data.usage) {
    opencodeStats.session.calls++;
    opencodeStats.session.promptTokens     += data.usage.prompt_tokens     || 0;
    opencodeStats.session.completionTokens += data.usage.completion_tokens || 0;
    opencodeStats.session.totalTokens      += data.usage.total_tokens      || 0;
  }

  return data;
}

// ── Anthropic Claude ───────────────────────────────────────────────────────────
// Converts between OpenAI-style tools & messages and Anthropic's format.

function openaiToolsToAnthropic(openaiTools) {
  if (!openaiTools || !Array.isArray(openaiTools)) return undefined;
  return openaiTools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function convertMessagesForAnthropic(openaiMessages) {
  let systemText = "";
  const msgs = [];

  for (const msg of openaiMessages) {
    if (msg.role === "system") {
      systemText += (systemText ? "\n" : "") + msg.content;
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        // Check if there are tool results cached — Anthropic needs tool_result
        // content blocks, not plain text, for the prior tool_use round.
        msgs.push({ role: "user", content: msg.content });
      } else {
        msgs.push({ role: "user", content: msg.content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const content = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      // Anthropic requires at least one content block
      if (content.length === 0) content.push({ type: "text", text: "." });
      msgs.push({ role: "assistant", content });
      continue;
    }

    if (msg.role === "tool") {
      msgs.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content || "" }],
      });
      continue;
    }

    // fallback: pass through
    msgs.push(msg);
  }

  return { system: systemText || undefined, messages: msgs };
}

function fromAnthropicResponse(anthropicResponse) {
  const textBlocks = (anthropicResponse.content || []).filter(c => c.type === "text");
  const toolBlocks = (anthropicResponse.content || []).filter(c => c.type === "tool_use");

  let finishReason = "stop";
  if (anthropicResponse.stop_reason === "tool_use") finishReason = "tool_calls";
  else if (anthropicResponse.stop_reason === "max_tokens") finishReason = "length";
  else if (anthropicResponse.stop_reason === "end_turn") finishReason = "stop";

  const message = {
    role: "assistant",
    content: textBlocks.map(t => t.text).join("") || null,
  };
  if (toolBlocks.length > 0) {
    message.tool_calls = toolBlocks.map(t => ({
      id: t.id,
      type: "function",
      function: { name: t.name, arguments: JSON.stringify(t.input) },
    }));
  }

  return {
    choices: [{ finish_reason: finishReason, message }],
    usage: {
      input_tokens: anthropicResponse.usage?.input_tokens || 0,
      output_tokens: anthropicResponse.usage?.output_tokens || 0,
    },
  };
}

async function callAnthropic(messages, useTools = true, effort = "medium") {
  const { system, messages: anthropicMessages } = convertMessagesForAnthropic(messages);

  const body = {
    model: config.ANTHROPIC_MODEL,
    max_tokens: config.ANTHROPIC_MAX_TOKENS,
    output_config: { effort: effort || "medium" },
    messages: anthropicMessages,
  };
  if (system) body.system = system;
  if (useTools) {
    body.tools = openaiToolsToAnthropic(tools.TOOLS_DEFINITIONS);
    body.tool_choice = { type: "auto" };
  }

  const r = await fetch(config.ANTHROPIC_BASE_URL, {
    method: "POST",
    headers: {
      "x-api-key": config.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  anthropicStats.lastUpdated = new Date().toISOString();

  if (r.status === 429) {
    const bodyText = await r.text();
    let errMsg = "rate_limit_exceeded";
    try { const e = JSON.parse(bodyText); errMsg = e.error?.message || errMsg; } catch {}
    return { error: { code: "rate_limit_exceeded", message: errMsg } };
  }

  const data = await r.json();

  if (data.error) {
    return { error: { code: data.error.type || "api_error", message: data.error.message || JSON.stringify(data.error) } };
  }

  if (data.usage) {
    anthropicStats.session.calls++;
    anthropicStats.session.promptTokens     += data.usage.input_tokens  || 0;
    anthropicStats.session.completionTokens += data.usage.output_tokens || 0;
    anthropicStats.session.totalTokens      += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
  }

  return fromAnthropicResponse(data);
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
  let triedGroq = false;
  let triedOpenCode = false;
  let currentProvider = config.ANTHROPIC_API_KEY ? "anthropic" : "groq"; // anthropic → groq → opencode
  let iterations = 0;

  async function callCurrent(messages, useTools) {
    if (currentProvider === "opencode") {
      return await callOpenCode(messages, useTools);
    }
    if (currentProvider === "anthropic") {
      return await callAnthropic(messages, useTools, getEffort(chatId));
    }
    return await callGroq(messages, useTools, currentProvider === "groq-fast" ? config.GROQ_FAST_MODEL : model);
  }

  while (iterations++ < MAX_TOOL_ITERATIONS) {
    let data;

    // ── Provider fallback chain: Anthropic → Groq → Groq-fast → OpenCode ──
    data = await callCurrent([sysMsg, ...history], currentProvider !== "opencode");

    if (currentProvider === "anthropic" && data.error) {
      if (!triedGroq && config.GROQ_KEY) {
        triedGroq = true;
        currentProvider = "groq";
        console.log("[llm] Anthropic unavailable → falling back to Groq");
        continue;
      }
      if (!triedOpenCode && config.OPENCODE_KEY) {
        triedOpenCode = true;
        currentProvider = "opencode";
        console.log("[llm] falling back to OpenCode Zen");
        continue;
      }
      return `🤖 Все LLM исчерпаны — ИИ вернётся позже. Команды (/status, /play, скриншот) и музыка работают как обычно.`;
    }

    if ((currentProvider === "groq" || currentProvider === "groq-fast") && isRateLimited(data)) {
      if (currentProvider === "groq" && !triedFast) {
        triedFast = true;
        currentProvider = "groq-fast";
        console.log("[llm] Groq rate limited → switching to", config.GROQ_FAST_MODEL);
        continue;
      }
      if (!triedOpenCode && config.OPENCODE_KEY) {
        triedOpenCode = true;
        currentProvider = "opencode";
        console.log("[llm] Groq exhausted → falling back to OpenCode Zen");
        continue;
      }
      return `🤖 Лимит Groq исчерпан — ИИ вернётся через ~${rateLimitReset(data)}.
Команды (/status, /play, скриншот) и музыка работают как обычно.`;
    }

    // ── Handle generation errors ──
    if (data.error) {
      const isGenerationError = data.error.type === "failed_generation"
        || data.error.code === "tool_use_failed"
        || data.error.code === "overloaded_error";
      if (isGenerationError) {
        console.log(`[llm] ${currentProvider} generation error, retrying without tools`);
        data = await callCurrent([sysMsg, ...history], false);
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      } else {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
    }

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

function setEffort(chatId, level) {
  const valid = ["low", "medium", "high"];
  if (!valid.includes(level)) throw new Error("Invalid effort: must be low, medium, or high");
  sessionEffort.set(chatId, level);
}

function getEffort(chatId) {
  return sessionEffort.get(chatId) || "medium";
}

async function askOnce(userText, chatId = null) {
  const effort = chatId ? getEffort(chatId) : "medium";
  const messages = [
    { role: "system", content: "You are a helpful assistant. Be concise and direct." },
    { role: "user", content: userText },
  ];
  const data = await callAnthropic(messages, false, effort);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0]?.message?.content || "(пустой ответ)";
}

function getStats() {
  return { groq: { ...groqStats }, opencode: { ...opencodeStats }, anthropic: { ...anthropicStats } };
}

function getOpenCodeStats() {
  return { ...opencodeStats };
}

function resetHistory(chatId) {
  histories.delete(chatId);
}

module.exports = {
  callGroq,
  callOpenCode,
  callAnthropic,
  ask,
  askOnce,
  getStats,
  getOpenCodeStats,
  resetHistory,
  setEffort,
  getEffort,
};
