@echo off
echo =================================================
echo Publishing @lunibee/builders...
cd packages\builders
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/cli...
cd packages\cli
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/collection...
cd packages\collection
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/core...
cd packages\core
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/create...
cd packages\create
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/formatters...
cd packages\formatters
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/handlers...
cd packages\handlers
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing lunibee (root)...
call npm publish
if %errorlevel% neq 0 exit /b %errorlevel%

echo =================================================
echo Publishing @lunibee/lunibee...
cd packages\lunibee
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/managers...
cd packages\managers
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/rest...
cd packages\rest
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/sharding...
cd packages\sharding
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/structures...
cd packages\structures
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/testing...
cd packages\testing
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/types...
cd packages\types
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/utils...
cd packages\utils
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/voice...
cd packages\voice
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo =================================================
echo Publishing @lunibee/ws...
cd packages\ws
call npm publish --access public
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo 🎉 All packages published successfully!
