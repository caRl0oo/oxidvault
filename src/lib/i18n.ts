import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import { getStoredLocale, persistLocale, type LocaleId } from "@/lib/locale";

try {
  await i18n.use(initReactI18next).init({
    resources: {
      de: { translation: de },
      en: { translation: en },
    },
    lng: getStoredLocale(),
    fallbackLng: false,
    supportedLngs: ["de", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
  });
} catch {
  /* i18n init failure is non-fatal for shell UI */
}

i18n.on("languageChanged", (lng) => {
  if (lng === "de" || lng === "en") {
    persistLocale(lng);
  }
});

export function changeAppLocale(locale: LocaleId): void {
  i18n.changeLanguage(locale).catch(() => {
    /* ignore locale switch errors */
  });
}

export default i18n;
