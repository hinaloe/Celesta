#!/bin/sh
# Regenerates danger.wav from danger.txt with the macOS "Kyoko" system
# voice: one 16 kHz PCM WAV, as examples/assets/voice-folder does.
set -eu
cd "$(dirname "$0")"
say -v Kyoko --file-format=WAVE --data-format=LEI16@16000 -o danger.wav -f danger.txt
