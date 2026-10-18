#!/bin/sh
# Regenerates the recordings in shizuku/ from their transcripts with the
# macOS "Kyoko" system voice, standing in for a VOICEROID-style export:
# one 16 kHz PCM WAV beside each UTF-8 .txt of the same name.
set -eu
cd "$(dirname "$0")/shizuku"
for txt in *.txt; do
  say -v Kyoko --file-format=WAVE --data-format=LEI16@16000 -o "${txt%.txt}.wav" -f "$txt"
done
