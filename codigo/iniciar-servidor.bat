@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (py servidor.py) || (python servidor.py)
echo.
echo Se apareceu erro de "python" nao encontrado, instale o Python em https://www.python.org/downloads/ (marque "Add python.exe to PATH").
pause
