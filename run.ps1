# Set path for this session
$env:PATH = "C:\Users\Suleban\node-dist\node-v20.12.2-win-x64;" + $env:PATH

Clear-Host
Write-Host "=============================================" -ForegroundColor DarkMagenta
Write-Host "       A E T H E R   E C O S Y S T E M       " -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor DarkMagenta
Write-Host "Starting all services in separate windows..." -ForegroundColor Magenta
Write-Host ""

# 1. Start Backend API Server
Write-Host "[1/3] Launching Aether API Backend (Port 4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'Aether API Backend'; `$env:PATH = 'C:\Users\Suleban\node-dist\node-v20.12.2-win-x64;' + `$env:PATH; cd c:\suleban\suban\backend; npm run dev"

# 2. Start Admin Dashboard
Write-Host "[2/3] Launching Aether Admin Web Console (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'Aether Admin Dashboard'; `$env:PATH = 'C:\Users\Suleban\node-dist\node-v20.12.2-win-x64;' + `$env:PATH; cd c:\suleban\suban\admin; npm run dev"

# 3. Start Mobile Expo App in Web Mode
Write-Host "[3/3] Launching Aether Mobile Web Client (Port 8081)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'Aether Mobile Web'; `$env:PATH = 'C:\Users\Suleban\node-dist\node-v20.12.2-win-x64;' + `$env:PATH; cd c:\suleban\suban\mobile; npx expo start --web"

Write-Host ""
Write-Host "=============================================" -ForegroundColor DarkMagenta
Write-Host "   SERVICES INITIATED SUCCESSFULLY           " -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor DarkMagenta
Write-Host "Urls to access:" -ForegroundColor White
Write-Host " - Backend Health Check: http://localhost:4000/api/health" -ForegroundColor Cyan
Write-Host " - Admin Dashboard:      http://localhost:5000" -ForegroundColor Yellow
Write-Host "   (User: aether_admin | Password: admin123)" -ForegroundColor Yellow
Write-Host " - Mobile Web Client:    http://localhost:8081" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor DarkMagenta
