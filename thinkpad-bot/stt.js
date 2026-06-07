// Speech-to-text for incoming Telegram voice notes, via Groq Whisper.
// Flow: getFile → download the OGG → POST to Groq's audio/transcriptions.
// Whisper on Groq is fast and cheap (separate quota from chat tokens), so voice
// control stays usable even when the chat-token budget is tight.
const config = require("./config.js");

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

async function transcribe(fileId) {
  const info = await (await fetch(`${config.TG_API_BASE}/getFile?file_id=${fileId}`)).json();
  if (!info.ok || !info.result?.file_path) return { ok: false, error: "getFile не удался" };

  const url = `https://api.telegram.org/file/bot${config.TELEGRAM_TOKEN}/${info.result.file_path}`;
  const audioRes = await fetch(url);
  if (!audioRes.ok) return { ok: false, error: `скачивание ${audioRes.status}` };
  const buf = Buffer.from(await audioRes.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([buf]), "voice.ogg");
  form.append("model", config.WHISPER_MODEL);
  form.append("response_format", "text");
  form.append("language", "ru");

  const r = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.GROQ_KEY}` },
    body: form,
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    return { ok: false, error: `whisper ${r.status}: ${errText.slice(0, 150)}` };
  }
  const text = (await r.text()).trim();
  return { ok: true, text };
}

module.exports = { transcribe };
