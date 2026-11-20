@echo off
rem DSwritesync 本地助手包装(ADR 0012):浏览器经 Native Messaging 拉起本脚本,
rem 转发给同目录 helper.mjs;PATH 上没有 node 时回一发 NM 帧错误再退出,
rem 让扩展能显示明确错误而不是静默失败(工单 #11 用户故事 21)。
setlocal
set "HERE=%~dp0"
where node >nul 2>nul
if errorlevel 1 goto :nonode
node "%HERE%helper.mjs" %*
endlocal
exit /b %errorlevel%

:nonode
rem 错误帧 base64:4 字节小端长度(98) + {"error":"..."} ,certutil 解码后原样写 stdout
set "ERRB64=%TEMP%\dswritesync-helper-error.b64"
set "ERRBIN=%TEMP%\dswritesync-helper-error.bin"
<nul set /p "=YgAAAHsiZXJyb3IiOiJOb2RlLmpzIG5vdCBmb3VuZCBpbiBQQVRILiBJbnN0YWxsIE5vZGUuanMsIHRoZW4gcmVzdGFydCBEU0ggYW5kIHJlbG9hZCB0aGUgZXh0ZW5zaW9uLiJ9">"%ERRB64%"
certutil -decode "%ERRB64%" "%ERRBIN%" >nul 2>nul
type "%ERRBIN%"
del "%ERRB64%" "%ERRBIN%" >nul 2>nul
endlocal
exit /b 1
