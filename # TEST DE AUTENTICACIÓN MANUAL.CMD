# TEST DE AUTENTICACIÓN MANUAL
# Ejecuta este archivo en PowerShell para probar el backend
Write-Host "🔍 PROBANDO BACKEND..." -ForegroundColor Cyan
# CAMBIA ESTOS VALORES POR TU EMAIL Y CONTRASEÑA REAL:
$email = "TU_EMAIL_AQUI@gmail.com"
$password = "bienestar2026"
Write-Host "📧 Intentando login con: $email" -ForegroundColor Yellow
$loginBody = @{
    email = $email
    password = $password
} | ConvertTo-Json
try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody
    
    Write-Host "✅ LOGIN EXITOSO!" -ForegroundColor Green
    Write-Host "Token recibido: $($loginResponse.token.Substring(0, 30))..." -ForegroundColor Green
    
    # Ahora probar crear un cliente
    $token = $loginResponse.token
    $customerBody = @{
        name = "Cliente Test PowerShell"
        taxId = "12345678"
        phone = "999999999"
        address = "Direccion Test"
        creditLimit = 1000
    } | ConvertTo-Json
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    Write-Host "🧪 Intentando crear cliente..." -ForegroundColor Yellow
    
    $customerResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/customers" `
        -Method POST `
        -Headers $headers `
        -Body $customerBody
    
    Write-Host "✅ CLIENTE CREADO EXITOSAMENTE!" -ForegroundColor Green
    Write-Host "Cliente ID: $($customerResponse.id)" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 TODO FUNCIONA CORRECTAMENTE - El problema está en el navegador/frontend" -ForegroundColor Cyan
    
} catch {
    Write-Host "❌ ERROR DETECTADO:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Respuesta del servidor: $responseBody" -ForegroundColor Yellow
    }
}
Write-Host ""
Write-Host "Presiona Enter para cerrar..." -ForegroundColor Gray
Read-Host