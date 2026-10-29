@echo off
chcp 65001 >nul
title HomeCoin
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist ".venv\Scripts\python.exe" (
    echo Environment not found: run setup.ps1 first
    pause
    exit /b 1
)
".venv\Scripts\python.exe" run.py %*
