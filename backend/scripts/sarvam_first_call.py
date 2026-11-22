"""Make a small Saaras v4 transcription call using the key in backend/.env."""
from __future__ import annotations

import base64
import os
from pathlib import Path
import sys

from dotenv import load_dotenv
from sarvamai import SarvamAI


BACKEND = Path(__file__).resolve().parents[1]
AUDIO_FILE = BACKEND / "samples" / "sarvam-stt-sample.wav"


def main() -> None:
    load_dotenv(BACKEND / ".env")
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        raise SystemExit("Set SARVAM_API_KEY in backend/.env first.")

    client = SarvamAI(api_subscription_key=api_key)
    # A short synthesized Marathi sample makes this script runnable without recording input.
    if not AUDIO_FILE.exists():
        audio = client.text_to_speech.convert(
            text="नमस्कार! मी रााहसाठी बोली तपासत आहे.",
            language_code="mr-IN",
            model="bulbul:v4-flash",
            speaker="simran_en_customer",
            output_audio_codec="wav",
        )
        AUDIO_FILE.parent.mkdir(parents=True, exist_ok=True)
        AUDIO_FILE.write_bytes(base64.b64decode(audio.audios[0]))

    with AUDIO_FILE.open("rb") as source:
        result = client.speech_to_text.transcribe(
            file=source,
            model="saaras:v4",
            mode="transcribe",
        )
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"Transcript: {result.transcript}")
    print(f"Detected language: {result.language_code or 'unknown'}")


if __name__ == "__main__":
    main()
