import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_LANGUAGE, REGISTERED_LANGUAGES, SELECTABLE_LANGUAGES,
  isRegisteredLanguage, isSelectableLanguage, languageLocale, languageName, normalizeLanguage,
} from "../lib/languages";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(readFileSync(resolve(root, "languages.json"), "utf8"));
const expected = ["en", "hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "or", "as"];
assert.equal(DEFAULT_LANGUAGE, "en");
assert.deepEqual(REGISTERED_LANGUAGES.map((l) => l.code), expected);
assert.equal(new Set(REGISTERED_LANGUAGES.map((l) => l.code)).size, expected.length);
assert.deepEqual(SELECTABLE_LANGUAGES.map((l) => l.code), expected);
assert.deepEqual(registry.languages, REGISTERED_LANGUAGES);
for (const language of REGISTERED_LANGUAGES) {
  assert.match(language.code, /^[a-z]{2}$/);
  assert.ok(language.name && language.nativeName && language.locale);
  assert.equal(isRegisteredLanguage(language.code), true);
  assert.equal(isSelectableLanguage(language.code), language.selectable);
  assert.equal(normalizeLanguage(language.code), language.code);
  assert.equal(languageLocale(language.code), language.locale);
}
assert.equal(isRegisteredLanguage("xx"), false);
assert.equal(isSelectableLanguage("xx"), false);
assert.equal(normalizeLanguage("xx"), "en");
assert.equal(normalizeLanguage(null), "en");
assert.deepEqual(["en", "hi", "mr"].map(languageName), ["English", "Hindi", "Marathi"]);
assert.equal(languageName("ta"), "Tamil");

// Catalogs are flat JSON objects. Inspect their raw key lines before JSON.parse, which
// otherwise silently accepts duplicate keys and retains only the last value.
function catalog(code: string): Record<string, string> {
  const raw = readFileSync(resolve(root, "web", "locales", `${code}.json`), "utf8");
  const keys = [...raw.matchAll(/^\s*("(?:\\.|[^"\\])*")\s*:/gm)].map((m) => JSON.parse(m[1]) as string);
  assert.equal(new Set(keys).size, keys.length, `${code}: duplicate JSON key`);
  const parsed: unknown = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  const values = parsed as Record<string, unknown>;
  assert.equal(keys.length, Object.keys(values).length, `${code}: catalog must be a flat object`);
  for (const [key, value] of Object.entries(values)) {
    assert.equal(typeof value, "string", `${code}.${key}: value is not a string`);
    assert.ok((value as string).trim(), `${code}.${key}: empty translation`);
  }
  return values as Record<string, string>;
}

const placeholders = (value: string) =>
  [...new Set([...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort();
const english = catalog("en");
for (const code of expected) {
  const translated = catalog(code);
  assert.deepEqual(Object.keys(translated).sort(), Object.keys(english).sort(), `${code}: key mismatch`);
  for (const [key, value] of Object.entries(english)) {
    assert.deepEqual(placeholders(translated[key]), placeholders(value), `${code}.${key}: placeholders differ`);
  }
}
console.log("languages ok");
