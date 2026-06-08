$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "HWP 지원서 자동작성 - 사용자 PC 환경 점검" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$workerExe = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) "bin\hwp_worker.exe"
if (Test-Path $workerExe) {
    Write-Host "[OK] 내장 HWP 워커: $workerExe" -ForegroundColor Green
}
else {
    Write-Host "[참고] 내장 HWP 워커 exe가 아직 없습니다. 개발 PC에서는 npm run build:worker를 먼저 실행하세요." -ForegroundColor Yellow
}

try {
    $result = & reg query "HKCR\HWPFrame.HwpObject\CLSID" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Windows용 한글(HWP) COM 등록 확인" -ForegroundColor Green
        Write-Host ""
        Write-Host "환경 점검 통과: 이 PC에서 HWP 자동 작성 기능을 사용할 수 있습니다." -ForegroundColor Green
        exit 0
    }
}
catch {
    $result = $_.Exception.Message
}

Write-Host "[필요] Windows용 한글(HWP)이 설치되어 있지 않거나 COM 등록을 확인할 수 없습니다." -ForegroundColor Yellow
Write-Host ""
Write-Host "이제 Python 3와 pywin32는 따로 설치하지 않아도 됩니다."
Write-Host "다만 HWP 양식을 그대로 열고 저장하려면 Windows용 한글(HWP)은 반드시 필요합니다."
Write-Host ""
Write-Host $result
exit 1
