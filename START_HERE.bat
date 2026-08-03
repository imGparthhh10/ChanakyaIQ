@echo off
REM ESDS BOIP — one-click launcher.
REM Double-click this file to start the local server.
title ESDS BOIP - Local Server
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause

