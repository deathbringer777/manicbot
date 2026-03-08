import { AI_MODEL, AI_MODEL_FALLBACK, AI_MODEL_FALLBACK2, AI_MAX_TOKENS, LANG_HINT, SALON, ADDRESS, HOURS_STR, PHONE, CB } from './config.js';
import { todayStr, getDayOfWeek, dateStrForOffset, resolveDateHint } from './utils/date.js';
import { escHtml, fill, t } from './utils/helpers.js';
import { send } from './telegram.js';
import { getLang } from './services/chat.js';
import { showMyApts, showPrices, showContacts, showCatalog, showWelcome, showReviews } from './ui/screens.js';
import { startBooking, startBookingWithService, showCancelAllConfirm } from './ui/booking.js';
import { showAdminPanel, showMasterPanel, showAdminApts, showMasterAllApts, showMastersList, showAdminCancelAllConfirm } from './ui/admin.js';
import { showPlatformAdminPanel, showPlatformTenantsList, showPlatformSupportList } from './ui/sysadmin.js';
import { confirmAllPendingApts } from './notifications.js';
import { setState } from './services/state.js';
import { STEP } from './config.js';

export function buildAISystemPrompt(role, langHint, today = null) {
  const lang = langHint || 'русском';
  const td = today || todayStr();
  const base = `
Ты помощник администрации маникюрного салона "${SALON}" в чате бота. Общайся вежливо, по-человечески. Отвечай только на языке: ${lang}. Коротко (1–4 предложения).

КРИТИЧНО — ИДЕНТИЧНОСТЬ: Никогда не говори, что ты ИИ, LLM, нейросеть, бот, искусственный интеллект или ChatGPT. Не называй модели (GPT, Llama, Claude и т.д.). Если спросят «ты ИИ?», «какая модель?», «ты бот?» — отвечай нейтрально: «Я помощник салона. Чем могу помочь?» или «Давайте по делу — запись, прайс, контакты?» Никогда не раскрывай технические детали.

Сегодня: ${td}. День недели: ${getDayOfWeek(td)}. «Прошлый четверг» = четверг до этой даты. Формат: YYYY-MM-DD, HH:MM.

Факты: Адрес ${ADDRESS}. Режим ${HOURS_STR}. Телефон ${PHONE}. Услуги: classic (маникюр), gel (гель-лак), pedi (педикюр), ext (наращивание), design (дизайн), combo (маникюр+педикюр).

КОНТЕКСТ: Учитывай предыдущие сообщения. Объединяй уточнения (педикюр + вторник 12). НЕ сбрасывай тему — если была жалоба, продолжай её, не спрашивай «что я могу помочь?».

КРИТИЧНО — ТЕЛЕФОН/ИМЯ: НИКОГДА не спрашивай номер телефона, имя, email или другие данные для поиска записей. Бот ЗНАЕТ пользователя по chat_id. Для показа записей — ТОЛЬКО тег [MY_APTS]. Поиска по телефону НЕТ. Это правило без исключений.

ПРИОРИТЕТ ТЕГОВ: При запросе действия (записи, прайс, отмена, контакты, каталог) — СРАЗУ ставь тег. НЕ описывай текстом «вы можете...» — тег откроет экран с кнопками. Бот сам покажет нужный интерфейс.

ОТМЕНА: «отмени все», «отмени», «cancel all» — однозначно про записи. Сразу [CANCEL_ALL], не уточняй «что отменить».

ЗАПИСЬ: При полных данных (услуга + дата + время) — СРАЗУ выводи [BOOK:svcId:date:time]. НЕ спрашивай подтверждение текстом. Бот покажет кнопки подтверждения. Примеры: «запиши в пятницу на 17 маникюр» → [BOOK:classic:дата_пятницы:17:00]; «педикюр завтра в обед» → [BOOK:pedi:завтра:12:00]. Если услуга неясна — спроси: «классический или гель-лак?».

ЖАЛОБЫ: Плохие ногти, паршивые, недоволен, дай номер мастера — это жалоба. Сразу или после уточнения (дата, имя мастера) добавляй [CONSULT]. Не придумывай даты — «прошлый четверг» = вычисли от сегодня (четверг до текущей даты).

ТЕГИ — только при явном запросе действия. Casual chat — без тега.
`.replace(/\n+/g, '\n').trim();

  const clientActions = `
КЛИЕНТ — теги:
[MY_APTS] — показать записи. «мои записи», «покажи записи», «когда записан» → сразу [MY_APTS]. ЗАПРЕЩЕНО спрашивать номер телефона — в личном чате бот знает пользователя. Нет поиска по телефону.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (RU: инстаграм, инста; UA: інстаграм, інста; EN/PL: instagram, insta; what is your instagram, jaki macie instagram)
[MAIN] — главное меню
[BOOK] — начать запись
[BOOK:svcId] — запись на услугу (svcId: classic, gel, pedi, ext, design, combo, correction)
[BOOK:correction] — бесплатное исправление (скрытая услуга, без цены). При: мастер предложил исправление, клиент согласен на коррекцию.
[BOOK:date] — запись на завтра/дату без услуги → слоты на дату, услуга classic. date: tomorrow, YYYY-MM-DD, послезавтра
[BOOK:svcId:date] — запись с датой. date: tomorrow, YYYY-MM-DD, послезавтра
[BOOK:svcId:date:time] — запись с датой и временем. time: HH:MM (16:00 = 4 вечера, 12:00 = обед)

Примеры: «завтра» → [BOOK:tomorrow]; «завтра в обед» → [BOOK:classic:tomorrow:12:00]; «педикюр 17 марта в 4» → [BOOK:pedi:2026-03-17:16:00]; «маникюр завтра» → [BOOK:classic:tomorrow]; «исправление», «коррекция», «да на исправление» → [BOOK:correction]; «12 на 14 марта» (в контексте исправления) → [BOOK:correction:2026-03-14:12:00]
[CANCEL_ALL] — отменить все записи. «отмени все», «отмени», «cancel all» → сразу [CANCEL_ALL]
[CONSULT] — кнопка консультанта. ОБЯЗАТЕЛЬНО при: жалоба (плохие ногти, паршивые, недоволен, дай номер мастера), запрос человека. После уточнения деталей жалобы — сразу [CONSULT], не сбрасывай на «что помочь?».

Правила: Casual chat — без тега. Жалоба → [CONSULT]. Не придумывай цены и даты. Исправление/коррекция — бесплатно, НЕ указывай цену. При контексте исправления (мастер предложил, клиент согласен) → [BOOK:correction] или [BOOK:correction:date:time].
`.replace(/\n+/g, '\n').trim();

  const adminActions = `
АДМИН — теги:
[ADM_PANEL] — панель администратора
[ADM_TODAY] — записи всех клиентов на сегодня
[ADM_TOMORROW] — записи всех клиентов на завтра
[ADM_MASTERS] — список мастеров
[ADM_CONFIRM_ALL] — подтвердить все ожидающие заявки
[ADM_CANCEL_ALL] — отменить ВСЕ записи ВСЕХ клиентов. «отмени все брони всех клиентов» → [ADM_CANCEL_ALL]

Общие действия (клиентский режим):
[MY_APTS] — показать МОИ записи. «мои записи», «покажи записи», «когда записан» → СРАЗУ [MY_APTS]. ЗАПРЕЩЕНО спрашивать телефон.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (instagram, инста)
[MAIN] — главное меню (клиентское)
[BOOK] / [BOOK:svcId:date:time] — записаться на услугу
[CANCEL_ALL] — отменить все МОИ записи
`.replace(/\n+/g, '\n').trim();

  const masterActions = `
МАСТЕР — теги:
[MST_PANEL] — панель мастера
[MST_TODAY] — мои записи на сегодня
[MST_TOMORROW] — все записи
[ADM_CONFIRM_ALL] — подтвердить все ожидающие заявки

Общие действия (клиентский режим):
[MY_APTS] — показать МОИ записи. «мои записи», «покажи записи», «когда записан» → СРАЗУ [MY_APTS]. ЗАПРЕЩЕНО спрашивать телефон.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (instagram, інста)
[MAIN] — главное меню (клиентское)
[BOOK] / [BOOK:svcId:date:time] — записаться на услугу
[CANCEL_ALL] — отменить все МОИ записи
`.replace(/\n+/g, '\n').trim();

  const sysAdminActions = `
СИСТЕМНЫЙ АДМИНИСТРАТОР ПЛАТФОРМЫ — теги:
[SYSADM_PANEL] — панель платформы ManicBot
[TENANT_LIST] — список всех тенантов (салонов)
[SUPPORT_LIST] — список агентов поддержки
[CREATE_TENANT] — создать нового тенанта (спросит название)
[BOT_NEW] — зарегистрировать нового бота

Доступны ВСЕ действия администратора:
[ADM_PANEL] — панель текущего салона
[ADM_TODAY] — записи на сегодня
[ADM_TOMORROW] — записи на завтра
[ADM_MASTERS] — мастера
[ADM_CONFIRM_ALL] — подтвердить все ожидающие
[ADM_CANCEL_ALL] — отменить все записи

И все клиентские действия:
[MY_APTS], [BOOK:svcId:date:time], [CANCEL_ALL], [PRICES], [CATALOG], [CONTACTS], [MAIN]

РЕЖИМ ОБЩЕГО АССИСТЕНТА ДЛЯ СИСТЕМНОГО АДМИНИСТРАТОРА:
Ты также выступаешь личным ИИ-ассистентом администратора. Отвечай на любые разумные вопросы:
- Генерация паролей, токенов, случайных строк — генерируй напрямую
- Математика и расчёты — считай и отвечай
- Общие знания, советы, информация
- Варшава и транспорт: ты знаешь общую информацию о маршрутах ZTM, трамваях, автобусах (например, с Мокотова до центра — трамвай №14 или №31, метро M1 до Centrum). НО реальное расписание можешь не знать — рекомендуй сайт ZTM.waw.pl
- Погода: у тебя нет доступа к интернету, поэтому актуальную погоду сказать не можешь — направляй на погодные сервисы (weather.com, Google). Но общий климат Варшавы описать можешь.
- Если вопрос не требует тега — просто ответь текстом без тегов.
Можешь признать, что ты ИИ-ассистент, но не называй конкретную модель.
`.replace(/\n+/g, '\n').trim();

  if (role === 'system_admin') {
    // For system_admin: strip the "never say you're AI" restriction from base
    const adminBase = base.replace(/КРИТИЧНО — ИДЕНТИЧНОСТЬ:.*?(?=\n\nСегодня:)/s, '').trim();
    return `${adminBase}\n\n${sysAdminActions}`;
  }
  if (role === 'admin') return `${base}\n\n${adminActions}`;
  if (role === 'master') return `${base}\n\n${masterActions}`;
  return `${base}\n\n${clientActions}`;
}

export function parseAIResponse(out) {
  if (out == null) return null;
  if (typeof out === 'string') return out.trim() || null;
  const t =
    out.response ??
    out.result?.response ??
    out.output ??
    out.text ??
    (Array.isArray(out.choices) && out.choices[0]?.message?.content) ??
    (Array.isArray(out.choices) && out.choices[0]?.text) ??
    null;
  return t && typeof t === 'string' ? t.trim() : null;
}

export const AI_ACTION_RE = /\[([A-Za-z_]+)(?::([^\]]*))?\]/g;

export function parseAIActions(aiReply) {
  if (!aiReply || typeof aiReply !== 'string') return { text: '', actions: [] };
  const actions = [];
  let text = aiReply.replace(AI_ACTION_RE, (_, tag, param) => {
    actions.push({ tag: tag.toUpperCase(), param: (param || '').trim() });
    return '';
  });
  return { text: text.trim().replace(/\n{3,}/g, '\n\n'), actions };
}

export async function executeAIAction(ctx, cid, role, tag, param, from) {
  const lg = await getLang(ctx, cid) || 'ru';
  const name = from?.first_name ? escHtml(from.first_name.slice(0, 64)) : '👋';
  switch (tag) {
    case 'MY_APTS': await showMyApts(ctx, cid); return true;
    case 'PRICES': await showPrices(ctx, cid); return true;
    case 'CATALOG': await showCatalog(ctx, cid); return true;
    case 'CONTACTS': await showContacts(ctx, cid); return true;
    case 'MAIN': await showWelcome(ctx, cid, name); return true;
    case 'BOOK': {
      const parts = (param || '').split(':');
      let svcId = parts[0]?.trim();
      let dateHint = parts[1]?.trim() || null;
      const timeHint = parts.length >= 4 ? `${parts[2]}:${parts[3]}` : parts[2]?.trim() || null;
      if (svcId && ctx.svcIds?.has(svcId)) {
        await startBookingWithService(ctx, cid, from, svcId, dateHint, timeHint);
      } else if (svcId && resolveDateHint(svcId)) {
        await startBookingWithService(ctx, cid, from, 'classic', svcId, timeHint);
      } else {
        await startBooking(ctx, cid, from);
      }
      return true;
    }
    case 'CANCEL_ALL': await showCancelAllConfirm(ctx, cid); return true;
  }
  if (role === 'system_admin') {
    switch (tag) {
      case 'SYSADM_PANEL': await showPlatformAdminPanel(ctx, cid, name); return true;
      case 'TENANT_LIST': await showPlatformTenantsList(ctx, cid); return true;
      case 'SUPPORT_LIST': await showPlatformSupportList(ctx, cid); return true;
      case 'CREATE_TENANT':
        await setState(ctx, cid, { step: STEP.SYSADM_NEW_TENANT });
        await send(ctx, cid, t(lg, 'sysadm_tenant_enter_name'));
        return true;
      case 'BOT_NEW':
        await setState(ctx, cid, { step: STEP.SYSADM_NEW_BOT });
        await send(ctx, cid, t(lg, 'sysadm_bot_enter_token'));
        return true;
      // All admin actions available to system_admin too
      case 'ADM_PANEL': await showAdminPanel(ctx, cid, name); return true;
      case 'ADM_TODAY': await showAdminApts(ctx, cid, dateStrForOffset(0)); return true;
      case 'ADM_TOMORROW': await showAdminApts(ctx, cid, dateStrForOffset(1)); return true;
      case 'ADM_MASTERS': await showMastersList(ctx, cid); return true;
      case 'ADM_CANCEL_ALL': await showAdminCancelAllConfirm(ctx, cid); return true;
      case 'ADM_CONFIRM_ALL': {
        const count = await confirmAllPendingApts(ctx, cid);
        const msg = count > 0 ? fill(t(lg, 'confirm_all_done'), { n: String(count) }) : t(lg, 'confirm_all_none');
        await send(ctx, cid, msg, { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.SYSADM_MAIN }]] } });
        return true;
      }
    }
  }
  if (role === 'admin') {
    switch (tag) {
      case 'ADM_PANEL': await showAdminPanel(ctx, cid, name); return true;
      case 'ADM_TODAY': await showAdminApts(ctx, cid, dateStrForOffset(0)); return true;
      case 'ADM_TOMORROW': await showAdminApts(ctx, cid, dateStrForOffset(1)); return true;
      case 'ADM_MASTERS': await showMastersList(ctx, cid); return true;
      case 'ADM_CANCEL_ALL': await showAdminCancelAllConfirm(ctx, cid); return true;
      case 'ADM_CONFIRM_ALL': {
        const count = await confirmAllPendingApts(ctx, cid);
        const msg = count > 0 ? fill(t(lg, 'confirm_all_done'), { n: String(count) }) : t(lg, 'confirm_all_none');
        await send(ctx, cid, msg, { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
        return true;
      }
    }
  }
  if (role === 'master') {
    switch (tag) {
      case 'MST_PANEL': await showMasterPanel(ctx, cid, name); return true;
      case 'MST_TODAY': await showAdminApts(ctx, cid, dateStrForOffset(0)); return true;
      case 'MST_TOMORROW': await showMasterAllApts(ctx, cid); return true;
      case 'ADM_CONFIRM_ALL': {
        const count = await confirmAllPendingApts(ctx, cid);
        const msg = count > 0 ? fill(t(lg, 'confirm_all_done'), { n: String(count) }) : t(lg, 'confirm_all_none');
        await send(ctx, cid, msg, { reply_markup: { inline_keyboard: [[{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }]] } });
        return true;
      }
    }
  }
  return false;
}

const WORKERS_AI_RUN_URL = 'https://api.cloudflare.com/client/v4/accounts';

export async function runWorkersAIViaRESTOne(ctx, accountId, token, modelId, promptBody) {
  const url = `${WORKERS_AI_RUN_URL}/${accountId}/ai/run/${encodeURIComponent(modelId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(promptBody),
  });
  if (!res.ok) {
    if (res.status === 429) console.error('Workers AI REST rate limit (429), trying next model');
    else console.error('Workers AI REST', res.status, await res.text().catch(() => '').slice(0, 200));
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (_) {
    return null;
  }
  if (data?.success === false) return null;
  const text = data?.result?.response ?? data?.response ?? null;
  return text && typeof text === 'string' ? text.trim().slice(0, 1000) : null;
}

export async function runWorkersAIViaREST(ctx, userMessage, lg, role = 'client', history = []) {
  const token = ctx.WORKERS_AI_API_TOKEN;
  const accountId = ctx.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId || !userMessage || userMessage.length < 2) return null;
  const langHint = LANG_HINT[lg] || 'русском';
  const sys = buildAISystemPrompt(role, langHint, todayStr());
  const userText = userMessage.slice(0, 500);
  let prompt = sys + '\n\n';
  for (const m of history) {
    const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
    prompt += `${roleLabel}: ${m.content}\n\n`;
  }
  prompt += `User: ${userText}`;
  const promptBody = { prompt: prompt.slice(0, 6000), max_tokens: AI_MAX_TOKENS };
  const models = [AI_MODEL, AI_MODEL_FALLBACK, AI_MODEL_FALLBACK2];
  for (const modelId of models) {
    try {
      const text = await runWorkersAIViaRESTOne(ctx, accountId, token, modelId, promptBody);
      if (text) return text;
    } catch (e) {
      console.error('Workers AI REST model', modelId, e.message);
    }
  }
  return null;
}

export async function runWorkersAI(ctx, userMessage, lg, role = 'client', history = []) {
  if (!userMessage || userMessage.length < 2) return null;

  if (ctx.WORKERS_AI_API_TOKEN && ctx.CLOUDFLARE_ACCOUNT_ID) {
    const rest = await runWorkersAIViaREST(ctx, userMessage, lg, role, history);
    if (rest) return rest;
  }

  if (ctx.AI) {
    const langHint = LANG_HINT[lg] || 'русском';
    const sys = buildAISystemPrompt(role, langHint, todayStr());
    const userText = userMessage.slice(0, 500);
    const messages = [{ role: 'system', content: sys }];
    for (const m of history) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
    }
    messages.push({ role: 'user', content: userText });
    const messagesPayload = { messages, max_tokens: AI_MAX_TOKENS };

    const bindingModels = [
      { id: AI_MODEL, useInput: true },
      { id: AI_MODEL_FALLBACK, useInput: false },
      { id: AI_MODEL_FALLBACK2, useInput: false },
    ];
    for (const { id: modelId, useInput } of bindingModels) {
      try {
        let out;
        try {
          out = await ctx.AI.run(modelId, messagesPayload);
        } catch (e1) {
          if (useInput && modelId === AI_MODEL) {
            try {
              out = await ctx.AI.run(modelId, { instructions: sys, input: userText, max_tokens: AI_MAX_TOKENS });
            } catch (e2) {
              continue;
            }
          } else {
            continue;
          }
        }
        const text = parseAIResponse(out);
        if (text) return text.slice(0, 1000);
      } catch (e) {
        console.error('Workers AI binding', modelId, e.message);
      }
    }
  }
  return null;
}
