@echo off
chcp 65001 >nul
title HomeCoin - DEMO (sample data)
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist ".venv\Scripts\python.exe" (
    echo Environment not found: run setup.ps1 first
    pause
    exit /b 1
)
rem demo version: sample data in demo-data, recreated at every start; the real data is never touched
".venv\Scripts\python.exe" demo.py %*
