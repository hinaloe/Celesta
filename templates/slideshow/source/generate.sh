#!/bin/sh
# Regenerates the sample media in ../assets/: photo-01.png ... photo-05.png
# drawn by draw-photos.tsx, and music.wav synthesized by make-music.py.
#
# Uses `celesta-exporter` from PATH; set CELESTA_EXPORTER to run another, for
# example from the repository root's Cargo workspace:
#
#   CELESTA_EXPORTER="cargo run -p celesta-exporter --release --" sh generate.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
assets="$here/../assets"
exporter=${CELESTA_EXPORTER:-celesta-exporter}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$assets"
$exporter --react --frames 0,1,2,3,4 --overwrite "$here/draw-photos.tsx" "$work/photo.png"
for frame in 0 1 2 3 4; do
  mv "$work/photo-00000$frame.png" "$assets/photo-0$((frame + 1)).png"
done
# The exported files come out readable by their owner only.
chmod 644 "$assets"/photo-0?.png
python3 "$here/make-music.py"
