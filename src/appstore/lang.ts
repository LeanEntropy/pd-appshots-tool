/**
 * The Apple language per country (plan-app-store 1.2, decision 1: the local language, like
 * Google Play's hl). Apple's storefront default is not always local (Thailand and Indonesia
 * default to English), so every country is asked in an explicit language.
 */
const BY_HL: Record<string, string> = {
  en: "en_us",
  ja: "ja_jp",
  ko: "ko_kr",
  "zh-TW": "zh_tw",
  "zh-HK": "zh_tw",
  "zh-CN": "zh_cn",
  th: "th_th",
  id: "id_id",
  vi: "vi_vn",
  de: "de_de",
  fr: "fr_fr",
  es: "es_es",
  it: "it_it",
  "pt-BR": "pt_br",
  ru: "ru_ru",
  tr: "tr_tr",
  ms: "ms_my",
};

/** "th_th" for Thai; an unknown language becomes "<hl>_<gl>" (Apple's own pattern). */
export function appleLangFor(gl: string, hl: string): string {
  return BY_HL[hl] ?? `${hl.toLowerCase().replace(/-.*/, "")}_${gl.toLowerCase()}`;
}
