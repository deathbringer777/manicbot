import ru from './ru/index.js';
import ua from './ua/index.js';
import en from './en/index.js';
import pl from './pl/index.js';

export const L = { ru, ua, en, pl };

export function t(lang, key) {
  const l = L[lang] || L.ru;
  return l[key] ?? L.ru[key] ?? key;
}
