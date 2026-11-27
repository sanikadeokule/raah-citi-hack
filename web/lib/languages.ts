import registry from "../../languages.json";

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  locale: string;
  selectable: boolean;
}

export const DEFAULT_LANGUAGE = registry.default;
export const REGISTERED_LANGUAGES: readonly Language[] = registry.languages;
export const SELECTABLE_LANGUAGES = REGISTERED_LANGUAGES.filter((language) => language.selectable);
const registeredCodes = new Set(REGISTERED_LANGUAGES.map((language) => language.code));
const selectableCodes = new Set(SELECTABLE_LANGUAGES.map((language) => language.code));

export const isRegisteredLanguage = (code: string) => registeredCodes.has(code);
export const isSelectableLanguage = (code: string) => selectableCodes.has(code);
export const normalizeLanguage = (code: unknown): string =>
  typeof code === "string" && isSelectableLanguage(code) ? code : DEFAULT_LANGUAGE;
export const languageName = (code: unknown): string =>
  REGISTERED_LANGUAGES.find((language) => language.code === normalizeLanguage(code))?.name ?? "English";
