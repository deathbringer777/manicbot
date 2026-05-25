# DMARC + SPF + DKIM в DNS (Blocker 2 pre-launch)

> Оператор-инструкция для Кирилла. CLI-кода нет — все шаги это клики
> в Cloudflare dashboard. Файл сам ничего не применяет.

## Текущее состояние (проверь `dig` перед правкой)

На момент запуска remediation-sprint (2026-05-25) в DNS уже было:

```
$ dig +short TXT _dmarc.manicbot.com
"v=DMARC1; p=reject;"

$ dig +short TXT manicbot.com | grep -i spf
"v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all"

$ dig +short TXT resend._domainkey.manicbot.com
"p=MIGfMA0GCSqGSIb3DQ..."
```

DMARC, SPF и DKIM **уже опубликованы**. Это значит:

- **Защита от спуфинга работает.** Любое письмо, не прошедшее SPF/DKIM
  alignment, отклоняется получающим сервером (`p=reject`).
- **Однако** мы не видим отчётов о том, что отклоняется. Если завтра
  легитимный поставщик (CRM, новый transactional-сервис) начнёт слать
  под именем manicbot.com — его письма уйдут в /dev/null, и узнаем мы
  об этом из жалоб пользователей.

## Что меняем (одна правка)

Добавляем `rua=mailto:vdovin.kyrylo@gmail.com` к existing DMARC-записи.
Это активирует ежедневные XML-отчёты от Google / Microsoft / Yahoo и
прочих больших MX о том, кто шлёт под domain'ом и проходит ли DMARC.

**Не меняем `p=reject` на `p=none`.** Существующая жёсткая защита
работает; ослабление = регрессия. Если когда-нибудь нужно мягче —
делается отдельной правкой.

## Шаг за шагом (Cloudflare DNS dashboard)

1. Открыть https://dash.cloudflare.com → выбрать зону **manicbot.com**.
2. **DNS → Records.**
3. Фильтр **Type = TXT**, **Name contains `_dmarc`**.
4. Должна быть ровно одна запись:
   - Type: `TXT`
   - Name: `_dmarc`
   - Content: `v=DMARC1; p=reject;`
   - TTL: Auto
   - Proxy status: DNS only (TXT никогда не проксируются)
5. Клик на **Edit** (карандаш).
6. Заменить **Content** на точно:

   ```
   v=DMARC1; p=reject; rua=mailto:vdovin.kyrylo@gmail.com
   ```

   Без кавычек. Без точки в конце. Одной строкой.

7. **Save.**
8. Из терминала проверить:

   ```
   dig +short TXT _dmarc.manicbot.com
   ```

   Ожидаемый вывод:

   ```
   "v=DMARC1; p=reject; rua=mailto:vdovin.kyrylo@gmail.com"
   ```

Или одной командой запустить готовый верификатор:

```bash
cd manicbot/
node scripts/verify-deliverability.mjs
```

Скрипт проверит SPF, DKIM, DMARC и покажет, что готово/что нет. Если
хочешь дополнительно отправить тестовое письмо через Resend на твою
почту:

```bash
node scripts/verify-deliverability.mjs --send-test vdovin.kyrylo@gmail.com
```

(нужны env `RESEND_API_KEY` + `RESEND_FROM` — они уже стоят в проде).

## Где увидеть отчёты

Через 24-48 ч после правки на `vdovin.kyrylo@gmail.com` начнут падать
XML-отчёты от Google, Microsoft, Yahoo. Это **обычные письма** с XML-
вложением. Содержимое — статистика отправителей домена за сутки.

Прочитать руками XML тяжело — загрузи в один из бесплатных
DMARC-парсеров:

- https://dmarc.postmarkapp.com (без регистрации, drag-and-drop)
- https://dmarcian.com — есть бесплатный тариф

**Что искать** в первый месяц:

- Все ли отправители под manicbot.com проходят SPF/DKIM (должны быть
  `_spf.mx.cloudflare.net` для Email Routing + `_spf.resend.com` для
  transactional).
- Если появится незнакомый отправитель — это либо новый сервис, либо
  спуфинг. Если не помнишь, что подключал — поднять вопрос.
- Если легитимный сервис фейлит DKIM/SPF — добавить его в SPF (правка
  `manicbot.com TXT`) или попросить поставщика опубликовать DKIM.

## Что НЕ делать

- **Не убирать `p=reject`**. Это снизит защиту от спуфинга.
- **Не добавлять `ruf=`** (forensic reports). Они шлют полные тела
  писем — содержат PII клиентов салонов. Польза маргинальная.
- **Не менять SPF без понимания**. Если убрать `include:_spf.resend.com`
  — Resend-почта перестанет проходить DMARC alignment, начнёт падать
  в спам у получателей. Сначала тест в логах за 24 ч после правки.

## Если `rua=` сломал доставку (крайне редко)

Откат — одна правка обратно:

```
v=DMARC1; p=reject;
```

DNS TTL единственный таймер; никаких очередей и подтверждений нет.

## Аутреф

- RFC 7489 — DMARC
- Cloudflare docs: DNS records for DMARC
- Google Postmaster Tools: https://postmaster.google.com (для глубокой
  аналитики деливерабилити с Gmail)
