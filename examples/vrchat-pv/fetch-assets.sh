#!/bin/sh
# Download the third-party media this film uses (Steam store screenshots and
# trailers, images from hello.vrchat.com). Run from the repository root.
set -eu
cd "$(dirname "$0")/assets"
mkdir -p photos src

i=1
for url in $(curl -fsS "https://store.steampowered.com/api/appdetails?appids=438100" |
  python3 -c "import json,sys; [print(s['path_full']) for s in json.load(sys.stdin)['438100']['data']['screenshots']]"); do
  curl -fsS -o "photos/steam-$i.jpg" "$url"; i=$((i + 1))
done

SQ=https://images.squarespace-cdn.com/content
curl -fsSL -o photos/vrc-logo.webp "https://static1.squarespace.com/static/5f0770791aaf57311515b23d/t/6508c787b8ced41ca3404f36/1718212268632/VRC_Logo.png?format=1500w"
curl -fsS -o photos/site-tribe.webp "$SQ/5f0770791aaf57311515b23d/42a6aa4e-ca30-4d01-a8f1-01be8dcef940/Tribe.webp"
curl -fsS -o photos/site-worlds.webp "$SQ/5f0770791aaf57311515b23d/679b57c5-3bc0-4b93-a702-47c04edd470d/Endless_Worlds.webp"
curl -fsS -o photos/site-bewhoever.webp "$SQ/5f0770791aaf57311515b23d/84066272-5738-41de-a641-ba5b0bfaf6fe/BeWhoever.webp"

T=https://video.akamai.steamstatic.com/store_trailers/438100
ffmpeg -v error -y -i "$T/857316145/968c80671784eef5aa58a1e0185982130f77d230/1753399782/hls_264_master.m3u8" \
  -map 0:v:0 -c copy src/trailer-create.mp4
ffmpeg -v error -y -i "$T/1996256566/994584d17c30577a83cbdb10be28086f2014ede4/1762366133/hls_264_master.m3u8" \
  -map 0:v:0 -c copy src/trailer-animated.mp4
echo "fetched photos and trailers into $(pwd)"
