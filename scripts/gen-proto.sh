#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PROTO_SRC="../../proto/vested/v1/connector_hub.proto"
OUT="src/proto"
mkdir -p "$OUT"

npx --yes \
  protoc \
  --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out="$OUT" \
  --ts_proto_opt=esModuleInterop=true,outputServices=grpc-js,useExactTypes=false,onlyTypes=false,fileSuffix=,initializeFieldsAsUndefined=false \
  --proto_path=../../proto \
  "$PROTO_SRC"

echo "proto bindings → $OUT/"
