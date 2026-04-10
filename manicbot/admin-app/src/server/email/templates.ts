/**
 * Branded HTML email templates for ManicBot.
 * All templates use inline styles for maximum email client compatibility.
 */

import type { Lang } from "~/lib/i18n";

// ─── i18n copy for emails ───────────────────────────────────────────────────

const emailCopy: Record<Lang, {
  verification: { subject: string; heading: string; body: string; cta: string; ignore: string };
  verificationCode: { subject: string; heading: string; body: string; expires: string; ignore: string; copy: string; copied: string };
  passwordReset: { subject: string; heading: string; body: string; cta: string; ignore: string; expires: string };
  welcome: { subject: string; heading: string; body: string; cta: string };
  emailChange: { subject: string; heading: string; body: string; cta: string; ignore: string; expires: string };
  loginAlert: { subject: string; heading: string; body: string; ip: string; time: string; warning: string };
  footer: string;
}> = {
  ru: {
    verification: {
      subject: "Подтвердите ваш email — ManicBot",
      heading: "Подтвердите email",
      body: "Спасибо за регистрацию! Нажмите кнопку ниже, чтобы подтвердить ваш email и начать работу.",
      cta: "Подтвердить email",
      ignore: "Если вы не регистрировались, просто проигнорируйте это письмо.",
    },
    verificationCode: {
      subject: "Ваш код подтверждения — ManicBot",
      heading: "Код подтверждения",
      body: "Введите этот код в ManicBot, чтобы подтвердить ваш email:",
      expires: "Код действителен 15 минут.",
      ignore: "Если вы не регистрировались, просто проигнорируйте это письмо.",
      copy: "Скопировать",
      copied: "Скопировано ✓",
    },
    passwordReset: {
      subject: "Сброс пароля — ManicBot",
      heading: "Сброс пароля",
      body: "Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы установить новый пароль.",
      cta: "Установить новый пароль",
      ignore: "Если вы не запрашивали сброс, проигнорируйте это письмо.",
      expires: "Ссылка действует 1 час.",
    },
    welcome: {
      subject: "Добро пожаловать в ManicBot!",
      heading: "Добро пожаловать!",
      body: "Ваш email подтверждён. Теперь вы можете войти и начать настройку вашего салона.",
      cta: "Войти в кабинет",
    },
    emailChange: {
      subject: "Подтвердите новый email — ManicBot",
      heading: "Смена email",
      body: "Вы запросили смену email. Нажмите кнопку ниже, чтобы подтвердить новый адрес.",
      cta: "Подтвердить новый email",
      ignore: "Если вы не запрашивали смену, проигнорируйте это письмо.",
      expires: "Ссылка действует 1 час.",
    },
    loginAlert: {
      subject: "Вход с нового устройства — ManicBot",
      heading: "Новый вход в аккаунт",
      body: "Зафиксирован вход в ваш аккаунт с нового IP-адреса.",
      ip: "IP-адрес",
      time: "Время",
      warning: "Если это были не вы, смените пароль немедленно.",
    },
    footer: "ManicBot.com — платформа для салонов красоты",
  },
  ua: {
    verification: {
      subject: "Підтвердіть ваш email — ManicBot",
      heading: "Підтвердіть email",
      body: "Дякуємо за реєстрацію! Натисніть кнопку нижче, щоб підтвердити ваш email та почати роботу.",
      cta: "Підтвердити email",
      ignore: "Якщо ви не реєструвалися, просто проігноруйте цей лист.",
    },
    verificationCode: {
      subject: "Ваш код підтвердження — ManicBot",
      heading: "Код підтвердження",
      body: "Введіть цей код у ManicBot, щоб підтвердити ваш email:",
      expires: "Код дійсний 15 хвилин.",
      ignore: "Якщо ви не реєструвалися, просто проігноруйте цей лист.",
      copy: "Скопіювати",
      copied: "Скопійовано ✓",
    },
    passwordReset: {
      subject: "Скидання пароля — ManicBot",
      heading: "Скидання пароля",
      body: "Ви запросили скидання пароля. Натисніть кнопку нижче, щоб встановити новий пароль.",
      cta: "Встановити новий пароль",
      ignore: "Якщо ви не запитували скидання, проігноруйте цей лист.",
      expires: "Посилання дійсне 1 годину.",
    },
    welcome: {
      subject: "Ласкаво просимо до ManicBot!",
      heading: "Ласкаво просимо!",
      body: "Ваш email підтверджено. Тепер ви можете увійти та почати налаштування вашого салону.",
      cta: "Увійти до кабінету",
    },
    emailChange: {
      subject: "Підтвердіть новий email — ManicBot",
      heading: "Зміна email",
      body: "Ви запросили зміну email. Натисніть кнопку нижче, щоб підтвердити нову адресу.",
      cta: "Підтвердити новий email",
      ignore: "Якщо ви не запитували зміну, проігноруйте цей лист.",
      expires: "Посилання дійсне 1 годину.",
    },
    loginAlert: {
      subject: "Вхід з нового пристрою — ManicBot",
      heading: "Новий вхід до акаунту",
      body: "Зафіксовано вхід до вашого акаунту з нової IP-адреси.",
      ip: "IP-адреса",
      time: "Час",
      warning: "Якщо це були не ви, змініть пароль негайно.",
    },
    footer: "ManicBot.com — платформа для салонів краси",
  },
  en: {
    verification: {
      subject: "Confirm your email — ManicBot",
      heading: "Confirm your email",
      body: "Thanks for signing up! Click the button below to verify your email and get started.",
      cta: "Confirm email",
      ignore: "If you didn't sign up, just ignore this email.",
    },
    verificationCode: {
      subject: "Your verification code — ManicBot",
      heading: "Verification code",
      body: "Enter this code in ManicBot to verify your email:",
      expires: "This code expires in 15 minutes.",
      ignore: "If you didn't sign up, just ignore this email.",
      copy: "Copy",
      copied: "Copied ✓",
    },
    passwordReset: {
      subject: "Reset your password — ManicBot",
      heading: "Reset your password",
      body: "You requested a password reset. Click the button below to set a new password.",
      cta: "Set new password",
      ignore: "If you didn't request this, ignore this email.",
      expires: "This link expires in 1 hour.",
    },
    welcome: {
      subject: "Welcome to ManicBot!",
      heading: "Welcome!",
      body: "Your email is verified. You can now sign in and start setting up your salon.",
      cta: "Go to dashboard",
    },
    emailChange: {
      subject: "Confirm your new email — ManicBot",
      heading: "Email change",
      body: "You requested an email change. Click the button below to confirm your new address.",
      cta: "Confirm new email",
      ignore: "If you didn't request this, ignore this email.",
      expires: "This link expires in 1 hour.",
    },
    loginAlert: {
      subject: "New login detected — ManicBot",
      heading: "New login to your account",
      body: "A login to your account was detected from a new IP address.",
      ip: "IP address",
      time: "Time",
      warning: "If this wasn't you, change your password immediately.",
    },
    footer: "ManicBot.com — beauty salon platform",
  },
  pl: {
    verification: {
      subject: "Potwierdź swój email — ManicBot",
      heading: "Potwierdź email",
      body: "Dziękujemy za rejestrację! Kliknij przycisk poniżej, aby potwierdzić email i zacząć.",
      cta: "Potwierdź email",
      ignore: "Jeśli nie rejestrowałeś się, zignoruj tę wiadomość.",
    },
    verificationCode: {
      subject: "Twój kod weryfikacyjny — ManicBot",
      heading: "Kod weryfikacyjny",
      body: "Wpisz ten kod w ManicBot, aby potwierdzić swój email:",
      expires: "Kod ważny 15 minut.",
      ignore: "Jeśli nie rejestrowałeś się, zignoruj tę wiadomość.",
      copy: "Kopiuj",
      copied: "Skopiowano ✓",
    },
    passwordReset: {
      subject: "Resetowanie hasła — ManicBot",
      heading: "Resetowanie hasła",
      body: "Poprosiłeś o reset hasła. Kliknij przycisk poniżej, aby ustawić nowe hasło.",
      cta: "Ustaw nowe hasło",
      ignore: "Jeśli nie prosiłeś o reset, zignoruj tę wiadomość.",
      expires: "Link ważny 1 godzinę.",
    },
    welcome: {
      subject: "Witamy w ManicBot!",
      heading: "Witamy!",
      body: "Twój email został zweryfikowany. Możesz się zalogować i zacząć konfigurację salonu.",
      cta: "Przejdź do panelu",
    },
    emailChange: {
      subject: "Potwierdź nowy email — ManicBot",
      heading: "Zmiana emaila",
      body: "Poprosiłeś o zmianę emaila. Kliknij przycisk poniżej, aby potwierdzić nowy adres.",
      cta: "Potwierdź nowy email",
      ignore: "Jeśli nie prosiłeś o zmianę, zignoruj tę wiadomość.",
      expires: "Link ważny 1 godzinę.",
    },
    loginAlert: {
      subject: "Nowe logowanie — ManicBot",
      heading: "Nowe logowanie na konto",
      body: "Wykryto logowanie na Twoje konto z nowego adresu IP.",
      ip: "Adres IP",
      time: "Czas",
      warning: "Jeśli to nie Ty, zmień hasło natychmiast.",
    },
    footer: "ManicBot.com — platforma dla salonów kosmetycznych",
  },
};

export function getEmailCopy(lang: Lang) {
  return emailCopy[lang] ?? emailCopy.en;
}

// ─── Base layout ────────────────────────────────────────────────────────────

function baseLayout(heading: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e1a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background-color:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
  <!-- Header -->
  <tr><td style="padding:32px 32px 0;text-align:center;">
    <div style="display:inline-block;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);text-align:center;line-height:48px;font-size:20px;font-weight:800;color:#fff;">M</div>
    <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${heading}</h1>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:24px 32px 32px;">
    ${body}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">${footer}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(url: string, text: string): string {
  return `<div style="text-align:center;margin:24px 0;">
<a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;">${text}</a>
</div>`;
}

function paragraph(text: string, color = "#d1d5db"): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${color};">${text}</p>`;
}

function muted(text: string): string {
  return paragraph(text, "#64748b");
}

// ─── Template functions ─────────────────────────────────────────────────────

export function verificationCodeEmailHtml(code: string, lang: Lang): string {
  const c = getEmailCopy(lang).verificationCode;
  const digits = code.split("").map(d =>
    `<td style="width:48px;height:56px;text-align:center;font-size:28px;font-weight:700;color:#ffffff;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-family:monospace;letter-spacing:2px;">${d}</td>`
  ).join('<td style="width:8px;"></td>');
  const escapedCode = code.replace(/'/g, "\\'");
  const copyBtn = `<td style="padding-left:12px;vertical-align:middle;">
    <a href="#"
       onclick="var el=this;navigator.clipboard.writeText('${escapedCode}').then(function(){el.textContent='${c.copied}';el.style.background='#10b981';setTimeout(function(){el.textContent='${c.copy}';el.style.background='#374151';},2000)}).catch(function(){});return false;"
       style="display:inline-block;padding:10px 16px;background:#374151;color:#e2e8f0;font-size:13px;font-weight:600;text-decoration:none;border-radius:10px;border:1px solid rgba(255,255,255,0.12);white-space:nowrap;cursor:pointer;"
    >${c.copy}</a>
  </td>`;
  const codeBlock = `<table style="margin:24px auto;" cellpadding="0" cellspacing="0">
    <tr>
      <td><table cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td>
      ${copyBtn}
    </tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function verificationEmailHtml(verifyUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).verification;
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(verifyUrl, c.cta) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function passwordResetEmailHtml(resetUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).passwordReset;
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(resetUrl, c.cta) + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function welcomeEmailHtml(name: string | null, dashboardUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).welcome;
  const greeting = name ? c.heading.replace("!", `, ${name}!`) : c.heading;
  return baseLayout(
    greeting,
    paragraph(c.body) + ctaButton(dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

export function emailChangeEmailHtml(confirmUrl: string, newEmail: string, lang: Lang): string {
  const c = getEmailCopy(lang).emailChange;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    paragraph(`<strong>${newEmail}</strong>`, "#e2e8f0") +
    ctaButton(confirmUrl, c.cta) +
    muted(c.expires) +
    muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function loginAlertEmailHtml(ip: string, time: string, lang: Lang): string {
  const c = getEmailCopy(lang).loginAlert;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.ip}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);font-family:monospace;">${ip}</td></tr>
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.time}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${time}</td></tr>
    </table>` +
    paragraph(`<strong style="color:#f87171;">${c.warning}</strong>`),
    getEmailCopy(lang).footer,
  );
}
