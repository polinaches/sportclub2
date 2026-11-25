@echo off
cd /d "%~dp0"

where node >nul 2>&1 || goto fail

echo Installing server...
cd /d "%~dp0server"
call npm install || goto fail

echo Installing client...
cd /d "%~dp0client"
call npm install || goto fail

echo Building client...
call npm run build || goto fail

echo Installing desktop...
cd /d "%~dp0desktop"
call npm install || goto fail

echo Setup complete.
pause
exit /b 0

:fail
echo Setup failed.
pause
exit /b 1