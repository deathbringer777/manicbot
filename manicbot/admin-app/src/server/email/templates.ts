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
  roleRequestAdmin: { subject: string; heading: string; body: string; from: string; to: string; reason: string; cta: string };
  roleRequestDecision: {
    approvedSubject: string; deniedSubject: string;
    approvedHeading: string; deniedHeading: string;
    approvedBody: string; deniedBody: string;
    note: string; cta: string;
  };
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
      copy: "Нажмите на код, чтобы выделить",
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
    roleRequestAdmin: {
      subject: "Запрос на смену роли — ManicBot",
      heading: "Запрос на смену роли",
      body: "Пользователь отправил запрос на смену роли.",
      from: "Текущая роль",
      to: "Запрошенная роль",
      reason: "Причина",
      cta: "Посмотреть запросы",
    },
    roleRequestDecision: {
      approvedSubject: "Ваша роль изменена — ManicBot",
      deniedSubject: "Запрос на смену роли рассмотрен — ManicBot",
      approvedHeading: "Роль изменена",
      deniedHeading: "Запрос отклонён",
      approvedBody: "Ваш запрос на смену роли одобрен. Новая роль вступила в силу.",
      deniedBody: "К сожалению, ваш запрос на смену роли был отклонён.",
      note: "Комментарий администратора",
      cta: "Перейти в кабинет",
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
      copy: "Натисніть на код, щоб виділити",
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
    roleRequestAdmin: {
      subject: "Запит на зміну ролі — ManicBot",
      heading: "Запит на зміну ролі",
      body: "Користувач надіслав запит на зміну ролі.",
      from: "Поточна роль",
      to: "Запитувана роль",
      reason: "Причина",
      cta: "Переглянути запити",
    },
    roleRequestDecision: {
      approvedSubject: "Вашу роль змінено — ManicBot",
      deniedSubject: "Запит на зміну ролі розглянуто — ManicBot",
      approvedHeading: "Роль змінено",
      deniedHeading: "Запит відхилено",
      approvedBody: "Ваш запит на зміну ролі схвалено. Нова роль набула чинності.",
      deniedBody: "На жаль, ваш запит на зміну ролі було відхилено.",
      note: "Коментар адміністратора",
      cta: "Перейти до кабінету",
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
      copy: "Click the code to select it",
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
    roleRequestAdmin: {
      subject: "Role change request — ManicBot",
      heading: "Role Change Request",
      body: "A user has submitted a role change request.",
      from: "Current role",
      to: "Requested role",
      reason: "Reason",
      cta: "Review requests",
    },
    roleRequestDecision: {
      approvedSubject: "Your role has been changed — ManicBot",
      deniedSubject: "Role change request reviewed — ManicBot",
      approvedHeading: "Role Changed",
      deniedHeading: "Request Denied",
      approvedBody: "Your role change request has been approved. Your new role is now active.",
      deniedBody: "Unfortunately, your role change request has been denied.",
      note: "Admin note",
      cta: "Go to dashboard",
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
      copy: "Kliknij kod, aby go zaznaczyć",
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
    roleRequestAdmin: {
      subject: "Prośba o zmianę roli — ManicBot",
      heading: "Prośba o zmianę roli",
      body: "Użytkownik przesłał prośbę o zmianę roli.",
      from: "Obecna rola",
      to: "Żądana rola",
      reason: "Powód",
      cta: "Sprawdź prośby",
    },
    roleRequestDecision: {
      approvedSubject: "Twoja rola została zmieniona — ManicBot",
      deniedSubject: "Prośba o zmianę roli rozpatrzona — ManicBot",
      approvedHeading: "Rola zmieniona",
      deniedHeading: "Prośba odrzucona",
      approvedBody: "Twoja prośba o zmianę roli została zatwierdzona. Nowa rola jest aktywna.",
      deniedBody: "Niestety, Twoja prośba o zmianę roli została odrzucona.",
      note: "Komentarz administratora",
      cta: "Przejdź do panelu",
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
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
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

// ─── Role change request emails ─────────────────────────────────────────────

export function roleRequestAdminEmailHtml(
  userName: string,
  userEmail: string,
  currentRole: string,
  requestedRole: string,
  reason: string | null,
  reviewUrl: string,
  lang: Lang,
): string {
  const c = getEmailCopy(lang).roleRequestAdmin;
  const reasonRow = reason
    ? `<tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.reason}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${reason}</td></tr>`
    : "";
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    paragraph(`<strong>${userName}</strong> (${userEmail})`, "#e2e8f0") +
    `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.from}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${currentRole}</td></tr>
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;${reason ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${c.to}</td><td style="padding:8px 12px;font-size:13px;color:#a78bfa;font-weight:600;${reason ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${requestedRole}</td></tr>
      ${reasonRow}
    </table>` +
    ctaButton(reviewUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

export function roleRequestDecisionEmailHtml(
  decision: "approved" | "denied",
  oldRole: string,
  newRole: string,
  adminNote: string | null,
  dashboardUrl: string,
  lang: Lang,
): string {
  const c = getEmailCopy(lang).roleRequestDecision;
  const heading = decision === "approved" ? c.approvedHeading : c.deniedHeading;
  const body = decision === "approved" ? c.approvedBody : c.deniedBody;
  const roleInfo = decision === "approved"
    ? paragraph(`${oldRole} → <strong style="color:#a78bfa;">${newRole}</strong>`, "#e2e8f0")
    : "";
  const noteBlock = adminNote
    ? `<div style="margin:16px 0;padding:12px 16px;background-color:#1e293b;border-radius:10px;border-left:3px solid #7c3aed;">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${c.note}</p>
        <p style="margin:0;font-size:14px;color:#e2e8f0;">${adminNote}</p>
      </div>`
    : "";
  return baseLayout(
    heading,
    paragraph(body) + roleInfo + noteBlock + ctaButton(dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

// ─── Phase 2: permission elevation (English-only for launch) ────────────────

const permissionElevationCopy: Record<Lang, {
  subject: string;
  heading: string;
  body: (targetEmail: string, perms: string) => string;
  copy: string;
  expires: string;
  ignore: string;
}> = {
  en: {
    subject: "ManicBot — confirm staff permission elevation",
    heading: "Confirm permission elevation",
    body: (target, perms) => `You're granting sensitive permissions (<b>${perms}</b>) to <b>${target}</b>. Enter this code in the ManicBot dashboard to confirm.`,
    copy: "Tap to copy",
    expires: "The code expires in 15 minutes.",
    ignore: "If you didn't request this change, ignore this email and revoke the staff invitation.",
  },
  ru: {
    subject: "ManicBot — подтвердите расширение прав сотрудника",
    heading: "Подтверждение расширения прав",
    body: (target, perms) => `Вы предоставляете чувствительные права (<b>${perms}</b>) пользователю <b>${target}</b>. Введите этот код в панели ManicBot для подтверждения.`,
    copy: "Нажмите, чтобы скопировать",
    expires: "Код действует 15 минут.",
    ignore: "Если вы не запрашивали это изменение — проигнорируйте письмо и отзовите приглашение сотрудника.",
  },
  ua: {
    subject: "ManicBot — підтвердіть розширення прав співробітника",
    heading: "Підтвердження розширення прав",
    body: (target, perms) => `Ви надаєте чутливі права (<b>${perms}</b>) користувачу <b>${target}</b>. Введіть цей код у панелі ManicBot для підтвердження.`,
    copy: "Натисніть, щоб скопіювати",
    expires: "Код діє 15 хвилин.",
    ignore: "Якщо ви не запитували цю зміну — ігноруйте лист та відкличте запрошення.",
  },
  pl: {
    subject: "ManicBot — potwierdź rozszerzenie uprawnień personelu",
    heading: "Potwierdzenie rozszerzenia uprawnień",
    body: (target, perms) => `Przyznajesz uprawnienia wrażliwe (<b>${perms}</b>) użytkownikowi <b>${target}</b>. Wpisz ten kod w panelu ManicBot, aby potwierdzić.`,
    copy: "Kliknij, aby skopiować",
    expires: "Kod wygasa po 15 minutach.",
    ignore: "Jeśli nie prosiłeś o tę zmianę — zignoruj ten e-mail i cofnij zaproszenie.",
  },
};

export function getPermissionElevationCopy(lang: Lang) {
  return permissionElevationCopy[lang] ?? permissionElevationCopy.en;
}

export function permissionElevationCodeEmailHtml(
  code: string,
  targetEmail: string,
  permissions: string[],
  lang: Lang,
): string {
  const c = getPermissionElevationCopy(lang);
  const permsLabel = permissions.join(", ");
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body(targetEmail, permsLabel)) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}
