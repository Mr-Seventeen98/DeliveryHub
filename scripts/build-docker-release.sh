#!/usr/bin/env sh
set -eu

VERSION="${1:-0.1.0-20260723}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release/delivery-hub-$VERSION"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"

docker build --platform "$TARGET_PLATFORM" --target api -t "delivery-hub-api:$VERSION" "$ROOT_DIR"
docker build --platform "$TARGET_PLATFORM" --target worker -t "delivery-hub-worker:$VERSION" "$ROOT_DIR"
docker build --platform "$TARGET_PLATFORM" --target web -t "delivery-hub-web:$VERSION" "$ROOT_DIR"

for image in postgres:16-alpine redis:7-alpine; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    docker pull --platform "$TARGET_PLATFORM" "$image"
  fi
done

mkdir -p "$RELEASE_DIR"
cp "$ROOT_DIR/deploy/production/docker-compose.yml" "$RELEASE_DIR/docker-compose.yml"
cp "$ROOT_DIR/deploy/production/.env.production.example" "$RELEASE_DIR/.env.production.example"
cp "$ROOT_DIR/deploy/production/README.md" "$RELEASE_DIR/README.md"

docker save \
  "delivery-hub-api:$VERSION" \
  "delivery-hub-worker:$VERSION" \
  "delivery-hub-web:$VERSION" \
  postgres:16-alpine \
  redis:7-alpine | gzip -c > "$RELEASE_DIR/delivery-hub-images.tar.gz"

echo "Release created at $RELEASE_DIR"
