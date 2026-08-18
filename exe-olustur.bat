@echo off
cd /d "%~dp0"
if not exist node_modules goto nomodules

echo Windows kurulum dosyasi (.exe) olusturuluyor, bu biraz zaman alabilir...
call npm run build:win
if errorlevel 1 goto buildfail

echo.
echo Tamamlandi. Kurulum dosyasi "dist" klasorunde: fastread Setup *.exe
goto end

:nomodules
echo node_modules klasoru bulunamadi.
echo Once kur.bat dosyasina cift tiklayip kurulumu tamamlayin.
goto end

:buildfail
echo.
echo HATA: derleme basarisiz oldu.
goto end

:end
pause
