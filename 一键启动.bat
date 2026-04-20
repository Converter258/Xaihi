@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

echo ========================================
echo Xaihi 一键启动脚本
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装并配置 PATH。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装并配置 PATH。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [提示] 检测到 node_modules 不存在，正在安装依赖...
  npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或 npm 源设置。
    pause
    exit /b 1
  )
)

set "PORT_PIDS="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ids = @(Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($ids.Count -gt 0) { [string]::Join(',', $ids) }"`) do set "PORT_PIDS=%%i"

if defined PORT_PIDS (
  echo [提示] 检测到 5173 端口被占用，正在清理进程: %PORT_PIDS%
  powershell -NoProfile -Command "$ids = '%PORT_PIDS%'.Split(','); foreach ($id in $ids) { if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue } }"
  timeout /t 1 >nul
) else (
  echo [提示] 5173 端口空闲。
)

echo [提示] 正在启动开发环境...
npm run dev

if errorlevel 1 (
  echo [错误] 启动失败，请查看上方日志定位问题。
  pause
  exit /b 1
)

endlocal
