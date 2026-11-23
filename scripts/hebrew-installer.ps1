param(
    [Parameter(Mandatory = $true)][string]$Inno,          # folder holding zed.iss (copy of the upstream windows resources)
    [Parameter(Mandatory = $true)][string]$Iscc,          # path to ISCC.exe
    [Parameter(Mandatory = $true)][string]$Translations   # folder holding he.isl
)

# Turns the upstream installer script into a Hebrew-only installer: no language picker,
# Inno Setup's own Hebrew wizard texts plus our translation of Zed's extra strings.
$ErrorActionPreference = "Stop"
$messages = Join-Path $Inno "messages"
New-Item -ItemType Directory -Force $messages | Out-Null

$isccDir = Split-Path $Iscc
$base = @("$isccDir\Languages\Hebrew.isl", "$isccDir\Languages\Unofficial\Hebrew.isl") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if ($base) {
    Write-Host "Hebrew base translation found: $base"
    Copy-Item $base "$messages\Hebrew.isl" -Force
} else {
    foreach ($path in "Files/Languages/Hebrew.isl", "Files/Languages/Unofficial/Hebrew.isl") {
        try {
            Invoke-WebRequest "https://raw.githubusercontent.com/jrsoftware/issrc/main/$path" -OutFile "$messages\Hebrew.isl"
            Write-Host "Hebrew base translation downloaded: $path"
            break
        } catch { Write-Host "Not at $path" }
    }
}
if (-not (Test-Path "$messages\Hebrew.isl")) { throw "Could not find Inno Setup's Hebrew.isl" }
Copy-Item "$Translations\he.isl" "$messages\he.isl" -Force

$issPath = Join-Path $Inno "zed.iss"
$iss = Get-Content $issPath -Raw
$hebrewLine = 'Name: "hebrew"; MessagesFile: "{#ResourcesDir}\messages\Hebrew.isl,{#ResourcesDir}\messages\he.isl"; LicenseFile: "script\terms\terms.rtf"'
$patched = [regex]::Replace($iss, '(?m)^Name: "english";.*\r?\n', $hebrewLine + "`n")
$patched = [regex]::Replace($patched, '(?m)^Name: "simplifiedChinese";.*\r?\n', '')
$patched = $patched -replace 'ShowLanguageDialog=auto', 'ShowLanguageDialog=no'
if ($patched -notmatch 'Name: "hebrew"' -or $patched -match 'simplifiedChinese' -or $patched -notmatch 'ShowLanguageDialog=no') {
    throw "zed.iss did not have the expected [Languages] layout"
}
Set-Content $issPath $patched
Write-Host "Installer is now Hebrew-only"
