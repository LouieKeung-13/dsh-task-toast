#!/bin/bash
# scripts/card-mac.sh
# dsh-task-toast —— macOS 独立置顶通知（原生通知中心）。
#
# 与 Windows 的 card.ps1 等价：在 macOS 上把一条任务完成通知以「系统通知」形式
# 浮在所有应用之上，并沉淀到通知中心（等价于 Windows 的 Toast + Action Center）。
#
# 注意：macOS 原生通知不支持自定义按钮回调（需要打包 .app 才能注册 action），
# 因此本脚本只负责「显示通知」，点击由用户在通知中心里处理。
# 脚本保持纯 ASCII（与 card.ps1 一致：中文一律由 Host 通过参数传入）。

set -u

TITLE=""
BODY=""
LOCALE="zh"
SELFTEST=0

while [ $# -gt 0 ]; do
  case "$1" in
    -Title)    TITLE="$2"; shift 2 ;;
    -Body)     BODY="$2"; shift 2 ;;
    -Locale)   LOCALE="$2"; shift 2 ;;
    -SelfTest) SELFTEST=1; shift ;;
    -Toast|-ToastOnly) shift ;;
    -Position|-Theme|-Accent|-Timeout|-Slot|-Id|-BtnView|-BtnLater|-BtnIgnore) shift 2 ;;
    *) shift ;;
  esac
done

# 自检模式：确认 osascript 可用即视为成功
if [ "$SELFTEST" -eq 1 ]; then
  if command -v osascript >/dev/null 2>&1; then
    echo '{"ok":true}'
    exit 0
  else
    echo '{"ok":false,"error":"osascript unavailable"}'
    exit 1
  fi
fi

if ! command -v osascript >/dev/null 2>&1; then
  echo '{"ok":false,"error":"osascript unavailable"}'
  exit 1
fi

# AppleScript 的字符串需要转义双引号与反斜杠
esc() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}
T=$(esc "$TITLE")
B=$(esc "$BODY")

# 用 display notification 弹出系统通知（跨应用置顶 + 通知中心留痕）
osascript -e "display notification \"$B\" with title \"$T\"" >/dev/null 2>&1
code=$?
if [ "$code" -eq 0 ]; then
  echo '{"stage":"shown","ok":true}'
  exit 0
else
  echo "{\"ok\":false,\"error\":\"osascript exit $code\"}"
  exit 1
fi
