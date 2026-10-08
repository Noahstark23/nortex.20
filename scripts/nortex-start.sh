#!/bin/sh
# Sin DDL: el gate de identidad/schema debe pasar antes del servidor original.
set -eu
node scripts/nortex-schema-gate.mjs
exec env NODE_ENV=production node node_modules/tsx/dist/cli.mjs backend/server.ts
