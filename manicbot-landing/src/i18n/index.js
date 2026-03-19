import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import ruCommon from './locales/ru/common.json';
import plCommon from './locales/pl/common.json';
import ukCommon from './locales/uk/common.json';

const resources = {
  en: { common: enCommon },
  ru: { common: ruCommon },
  pl: { common: plCommon },
  uk: { common: ukCommon },
  ua: { common: ukCommon },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ru', 'pl', 'uk', 'ua'],
    defaultNS: 'common',
    ns: ['common'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupQuerystring: 'lang',
    },
  });

export default i18n;
