#!/usr/bin/env python3
"""
voice_transcribe_whisper.py

Transcribe audio files to Traditional Chinese using local Whisper.
Uses the whisper venv at ~/.venvs/whisper.

Usage:
    python voice_transcribe_whisper.py <audio_file>

Output (JSON to stdout):
    {"text": "...", "lang": "zh", "seconds": 5.2}
    {"error": "...", "text": null, "lang": null, "seconds": null}
"""

import sys
import json
import subprocess
import tempfile
import os
from pathlib import Path

# Whisper venv location
WHISPER_PYTHON = Path.home() / ".venvs" / "whisper" / "bin" / "python"
WHISPER_BIN = Path.home() / ".venvs" / "whisper" / "bin" / "whisper"

# Model selection - use medium for better Traditional Chinese accuracy
# Options: tiny, base, small, medium, large, large-v2, large-v3
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base")


def get_audio_duration(audio_path: str) -> float | None:
    """Get audio duration in seconds using ffprobe if available."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                audio_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def transcribe(audio_path: str, model: str = DEFAULT_MODEL) -> dict:
    """
    Transcribe audio file using Whisper.

    Args:
        audio_path: Path to audio file (.ogg, .mp3, .wav, etc.)
        model: Whisper model to use

    Returns:
        dict with keys: text, lang, seconds, error (optional)
    """
    audio_path = Path(audio_path)

    if not audio_path.exists():
        return {
            "text": None,
            "lang": None,
            "seconds": None,
            "error": f"File not found: {audio_path}"
        }

    # Get audio duration
    seconds = get_audio_duration(str(audio_path))

    # Create temp dir for output
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            # Run whisper CLI
            # Use Chinese as initial language hint but let whisper auto-detect
            # Output JSON format for structured parsing
            result = subprocess.run(
                [
                    str(WHISPER_BIN),
                    str(audio_path),
                    "--model", model,
                    "--language", "zh",  # Hint for Chinese (includes Traditional)
                    "--task", "transcribe",
                    "--output_format", "json",
                    "--output_dir", tmpdir,
                    "--fp16", "False",  # CPU-friendly, works on most systems
                ],
                capture_output=True,
                text=True,
                timeout=300,  # 5 min timeout
            )

            if result.returncode != 0:
                # Check stderr for common errors
                stderr = result.stderr.strip()
                return {
                    "text": None,
                    "lang": None,
                    "seconds": seconds,
                    "error": f"Whisper failed: {stderr or 'unknown error'}"
                }

            # Find output JSON
            json_file = Path(tmpdir) / (audio_path.stem + ".json")
            if not json_file.exists():
                # Try to find any json file
                json_files = list(Path(tmpdir).glob("*.json"))
                if json_files:
                    json_file = json_files[0]
                else:
                    return {
                        "text": None,
                        "lang": None,
                        "seconds": seconds,
                        "error": "Whisper did not produce output JSON"
                    }

            # Parse whisper JSON output
            with open(json_file, "r", encoding="utf-8") as f:
                whisper_output = json.load(f)

            # Extract text from segments
            text = whisper_output.get("text", "").strip()
            detected_lang = whisper_output.get("language", "zh")

            # Calculate duration from segments if not available from ffprobe
            if seconds is None and "segments" in whisper_output:
                segments = whisper_output["segments"]
                if segments:
                    seconds = segments[-1].get("end", 0)

            return {
                "text": text,
                "lang": detected_lang,
                "seconds": round(seconds, 2) if seconds else None
            }

        except subprocess.TimeoutExpired:
            return {
                "text": None,
                "lang": None,
                "seconds": seconds,
                "error": "Transcription timed out (>5 min)"
            }
        except Exception as e:
            return {
                "text": None,
                "lang": None,
                "seconds": seconds,
                "error": f"Transcription error: {str(e)}"
            }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Usage: voice_transcribe_whisper.py <audio_file>",
            "text": None,
            "lang": None,
            "seconds": None
        }))
        sys.exit(1)

    audio_file = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL

    result = transcribe(audio_file, model)
    print(json.dumps(result, ensure_ascii=False))

    # Exit code: 0 = success, 1 = error
    sys.exit(0 if result.get("text") is not None else 1)


if __name__ == "__main__":
    main()
