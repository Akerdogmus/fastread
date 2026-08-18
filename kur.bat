@echo off
cd /d "%~dp0"
echo ============================================
echo  fastread - bagimliliklari kuruyor (ilk kurulum)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

call npm install
if errorlevel 1 goto installfail

echo.
echo Kurulum tamamlandi. Uygulamayi acmak icin baslat.bat dosyasina cift tiklayin.
goto end

:nonode
echo HATA: Node.js bulunamadi.
echo Once https://nodejs.org adresinden Node.js (LTS surumu) kurun, sonra bu dosyayi tekrar calistirin.
goto end

:installfail
echo.
echo HATA: npm install basarisiz oldu. Yukarida yazan hata mesajina bakin.
goto end

:end
echo.
pause
