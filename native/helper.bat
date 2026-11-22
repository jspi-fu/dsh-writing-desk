@echo off
rem DSwritesync local helper wrapper (ADR 0012): Chrome launches this via
rem Native Messaging; it forwards to helper.mjs next to it. ASCII only --
rem cmd parses batch files in the system codepage, non-ASCII comments
rem corrupt parsing (observed: GBK codepage mangles UTF-8 Chinese comments
rem and falsely reports node missing). Chinese design notes live in helper.mjs.
setlocal
set "HERE=%~dp0"
where node >nul 2>nul
if errorlevel 1 goto :nonode
node "%HERE%helper.mjs" %*
endlocal
exit /b %errorlevel%

:nonode
rem Error frame: 4-byte LE length(98) + {"error":"Node.js not found in PATH"} --
rem written verbatim so the extension shows a clear error instead of hanging.
set "ERRB64=%TEMP%dswritesync-helper-error.b64"
set "ERRBIN=%TEMP%dswritesync-helper-error.bin"
<nul set /p "=YgAAAHsiZXJyb3IiOiJOb2RlLmpzIG5vdCBmb3VuZCBpbiBQQVRILiBJbnN0YWxsIE5vZGUuanMsIHRoZW4gcmVzdGFydCBEU0ggYW5kIHJlbG9hZCB0aGUgZXh0ZW5zaW9uLiJ9">"%ERRB64%"
certutil -decode "%ERRB64%" "%ERRBIN%" >nul 2>nul
type "%ERRBIN%"
del "%ERRB64%" "%ERRBIN%" >nul 2>nul
endlocal
exit /b 1
