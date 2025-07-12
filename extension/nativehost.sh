#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_FILE="${SCRIPT_DIR}/lib/nativeMessagingHost.js"

NODE_PATH=/Users/yurys/.nvm/versions/node/v20.19.3/bin/node

# Run in the same process as the shell script.
exec "${NODE_PATH}" "${SCRIPT_FILE}" "$@"
