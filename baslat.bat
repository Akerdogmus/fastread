@echo off
cd /d "%~dp0"
if not exist node_modules goto nomodules

echo fastread baslatiliyor... (kapatmak icin bu pencereyi kapatabilirsiniz)
call npm run dev
goto end

:nomodules
echo node_modules klasoru bulunamadi.
echo Once kur.bat dosyasina cift tiklayip kurulumu tamamlayin.
goto end

:end
pause
