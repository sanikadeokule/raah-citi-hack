import assert from "node:assert/strict";
import { pickVoice } from "../lib/audio";
import { SELECTABLE_LANGUAGES } from "../lib/languages";

// Node has no device voices. A missing non-English voice must never pick the
// browser default, which may speak English over text in another script.
async function main() {
  for (const language of SELECTABLE_LANGUAGES) {
    const chosen = await pickVoice(language.locale);
    assert.deepEqual(chosen, language.code === "en" ? {} : null, language.code);
  }
  console.log("audio languages ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
