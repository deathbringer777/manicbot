"use client";

import type { ChatMessage, ChatSalon } from "./chatTypes";
import { sanitizeChatHtml } from "./sanitizeChatHtml";
import { ChatDateStrip } from "./ChatDateStrip";
import { PhotoCarousel } from "./PhotoCarousel";
import { isDateKeyboard, stripPhotoNavButtons } from "./chatKeyboards";
import { formatTime, type Lang } from "~/lib/i18n";

export function MessageBubble({
  msg,
  salon,
  lang,
  onButtonClick,
}: {
  msg: ChatMessage;
  salon: ChatSalon;
  lang: Lang;
  onButtonClick: (callbackData: string, messageId: string) => void;
}) {
  const palette = salon.brandPalette?.primary ?? "#EC4899";
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white shadow-sm"
          style={{ background: palette }}
        >
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          <p className="text-[10px] text-white/70 mt-0.5 text-right tabular-nums">
            {formatTime(new Date(msg.ts * 1000), lang)}
          </p>
        </div>
      </div>
    );
  }

  // Bot message
  const safeHtml = sanitizeChatHtml(msg.text);
  const hasCarousel = (msg.photos?.length ?? 0) > 1;
  // When we render our own carousel, drop the bot's cc:/counter nav buttons.
  const buttonRows = hasCarousel ? stripPhotoNavButtons(msg.buttons) : msg.buttons;
  return (
    <div className="flex items-end gap-2">
      {salon.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={salon.logo}
          alt=""
          className="h-6 w-6 rounded-full object-cover shrink-0"
        />
      ) : (
        <div
          className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
          style={{ background: palette }}
          aria-hidden
        >
          {salon.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="max-w-[80%] space-y-1.5">
        <div className="rounded-2xl rounded-bl-md px-3.5 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200/60 dark:border-white/5">
          {hasCarousel ? (
            <PhotoCarousel photos={msg.photos!} brandColor={palette} />
          ) : msg.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={msg.photo}
              alt=""
              className="w-full rounded-lg mb-2 max-h-64 object-cover"
            />
          ) : null}
          <div
            className="whitespace-pre-wrap break-words leading-relaxed [&_a]:underline"
            style={{ ['--tw-prose-links' as string]: palette }}
            // safeHtml has been escaped + tag-whitelisted upstream
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
          <p className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {formatTime(new Date(msg.ts * 1000), lang)}
          </p>
        </div>
        {buttonRows && buttonRows.length > 0 &&
          (isDateKeyboard(buttonRows) ? (
            <ChatDateStrip
              rows={buttonRows}
              brandColor={palette}
              onPick={(cd) => onButtonClick(cd, msg.id)}
            />
          ) : (
          <div className="space-y-1">
            {buttonRows.map((row, rowIdx) => (
              <div key={rowIdx} className="flex flex-wrap gap-1">
                {row.map((btn, btnIdx) => {
                  // Only http(s) may reach an href — a javascript:/data: URL
                  // stored upstream must degrade to a plain disabled button.
                  if (btn.url && /^https?:\/\//i.test(btn.url)) {
                    return (
                      <a
                        key={btnIdx}
                        href={btn.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-sm px-4 py-2 rounded-xl border border-slate-300 dark:border-white/15 bg-white/80 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition min-w-[72px] text-center"
                      >
                        {btn.text}
                      </a>
                    );
                  }
                  return (
                    <button
                      key={btnIdx}
                      type="button"
                      onClick={() => btn.callback_data && onButtonClick(btn.callback_data, msg.id)}
                      disabled={!btn.callback_data}
                      className="text-sm px-4 py-2 rounded-xl border transition disabled:opacity-40 disabled:cursor-not-allowed min-w-[72px] text-center hover:brightness-95 active:scale-[0.97]"
                      style={{
                        borderColor: `${palette}44`,
                        color: palette,
                        background: `${palette}0d`,
                      }}
                    >
                      {btn.text}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          ))}
      </div>
    </div>
  );
}
