#!/bin/zsh

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEMO_URL="${G11_DEMO_URL:-http://127.0.0.1:5173}"
HEALTH_URL="${G11_HEALTH_URL:-http://127.0.0.1:8000/api/v1/health}"
PID_FILE="${PROJECT_DIR}/.ppt-demo.pid"
LOG_FILE="${PROJECT_DIR}/.ppt-demo.log"

services_ready() {
  curl --connect-timeout 1 --max-time 2 -fsS "${HEALTH_URL}" >/dev/null 2>&1 &&
    curl --connect-timeout 1 --max-time 2 -fsS "${DEMO_URL}" >/dev/null 2>&1
}

open_demo() {
  if [[ "${G11_DEMO_NO_OPEN:-0}" != "1" ]]; then
    open "${DEMO_URL}"
  fi
}

# Reuse an already-running demo instead of creating duplicate services.
if services_ready; then
  open_demo
  exit 0
fi

# Remove a stale launcher PID left by an interrupted presentation.
if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}")"
  if [[ -z "${existing_pid}" ]] || ! kill -0 "${existing_pid}" 2>/dev/null; then
    rm -f "${PID_FILE}"
  fi
fi

if [[ ! -f "${PID_FILE}" ]]; then
  cd "${PROJECT_DIR}"
  nohup "${PROJECT_DIR}/start.sh" >"${LOG_FILE}" 2>&1 </dev/null &
  echo $! >"${PID_FILE}"
fi

# First-time dependency installation can take longer than an ordinary launch.
for ((attempt = 1; attempt <= 180; attempt++)); do
  if services_ready; then
    open_demo
    exit 0
  fi

  if [[ -f "${PID_FILE}" ]]; then
    launcher_pid="$(cat "${PID_FILE}")"
    if [[ -z "${launcher_pid}" ]] || ! kill -0 "${launcher_pid}" 2>/dev/null; then
      rm -f "${PID_FILE}"
      break
    fi
  fi

  sleep 1
done

if [[ "${G11_DEMO_NO_DIALOG:-0}" != "1" ]]; then
  osascript -e \
    'display dialog "G11 Demo failed to start. Inspect .ppt-demo.log in the project directory." buttons {"OK"} default button "OK" with icon stop'
fi

exit 1
