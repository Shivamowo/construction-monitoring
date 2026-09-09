@echo off
cd /d C:\Users\SHIVAM\construction-monitoring\dashboard
npx tsc --noEmit > tsc_v.txt 2>&1
echo %ERRORLEVEL% > tsc_rc.txt