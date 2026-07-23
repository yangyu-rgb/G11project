#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/FrontEnd"
BACKEND_DIR="${PROJECT_ROOT}/BackEnd"
BACKEND_PYTHON="${BACKEND_DIR}/.venv/bin/python"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
DEMO_SCENARIO="${BACKEND_DIR}/experiments/test_scenario/trajectory.xml"
DEMO_EVENTS="${BACKEND_DIR}/experiments/test_scenario/events.json"
DEMO_MODEL="${BACKEND_DIR}/experiments/test_ppo/model.zip"
SERVICE_PIDS=()

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM

  for pid in "${SERVICE_PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done

  for pid in "${SERVICE_PIDS[@]}"; do
    wait "${pid}" 2>/dev/null || true
  done

  exit "${exit_code}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm，请先安装 Node.js 22。" >&2
  exit 1
fi

if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
  echo "首次运行：正在安装前端依赖……"
  (cd "${FRONTEND_DIR}" && npm ci)
fi

if [[ ! -x "${BACKEND_PYTHON}" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "错误：未找到 python3，请先安装 Python 3.11 或更高版本。" >&2
    exit 1
  fi

  echo "首次运行：正在创建后端虚拟环境并安装依赖……"
  python3 -m venv "${BACKEND_DIR}/.venv"
  (cd "${BACKEND_DIR}" && "${BACKEND_PYTHON}" -m pip install -e .)
fi

if [[ ! -f "${DEMO_SCENARIO}" || ! -f "${DEMO_EVENTS}" || ! -f "${DEMO_MODEL}" ]]; then
  echo "提示：M1演示场景或PPO模型尚未准备，服务仍会正常启动。" >&2
  echo "请另开终端依次执行：" >&2
  echo "  BackEnd/.venv/bin/python BackEnd/scripts/generate_highway_scenario.py --output experiments/test_scenario" >&2
  echo "  BackEnd/.venv/bin/python BackEnd/src/training/train_ppo.py --config configs/training_config.yaml --episodes 10 --output experiments/test_ppo" >&2
fi

echo "正在启动后端：http://${BACKEND_HOST}:${BACKEND_PORT}"
(
  cd "${BACKEND_DIR}"
  exec "${BACKEND_PYTHON}" -m uvicorn app.main:app \
    --reload \
    --host "${BACKEND_HOST}" \
    --port "${BACKEND_PORT}"
) &
SERVICE_PIDS+=("$!")

echo "正在启动前端：http://${FRONTEND_HOST}:${FRONTEND_PORT}"
(
  cd "${FRONTEND_DIR}"
  exec "${FRONTEND_DIR}/node_modules/.bin/vite" \
    --host "${FRONTEND_HOST}" \
    --port "${FRONTEND_PORT}"
) &
SERVICE_PIDS+=("$!")

echo "前后端已启动，按 Ctrl+C 同时停止。"

while true; do
  for pid in "${SERVICE_PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      set +e
      wait "${pid}"
      service_status=$?
      set -e
      exit "${service_status}"
    fi
  done
  sleep 1
done
