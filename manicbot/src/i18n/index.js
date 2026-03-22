import ru from './ru.js';
import ua from './ua.js';
import en from './en.js';
import pl from './pl.js';

export const L = { ru, ua, en, pl };

export function t(lang, key) {
  const l = L[lang] || L.ru;
  return l[key] ?? L.ru[key] ?? key;
}
