param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Out
)

# Launches Zed, drives a fixed sequence of panels with the keyboard, takes a screenshot after
# each step and records what the process and its log did. The same script runs against the
# vanilla and the Hebrew build so their results can be compared.
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Set-Content "$Out\demo.asm" "section .text`nglobal _start`n_start:`n    mov rdx,8`n    cmp rdx,4`n    jg looks"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$script:index = 0
function Shot($name) {
    $script:index++
    $label = "{0:D2}-{1}" -f $script:index, $name
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save("$Out\$label.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
}

function Keys($keys, $wait = 3) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep $wait
}

function Palette($command, $name) {
    Keys "^+p" 2
    Keys $command 2
    Keys "{ENTER}" 5
    Shot $name
}

$status = @()
$process = Start-Process $Exe -ArgumentList "--user-data-dir", "$Out\data", "$Out\demo.asm" -PassThru -RedirectStandardError "$Out\stderr.txt"
Start-Sleep 45
$status += "alive_after_startup=$(-not $process.HasExited)"
Shot "start-trust-dialog"
Keys "{ENTER}" 5
Shot "editor"

Palette "git: toggle focus" "git-panel"
Palette "terminal panel: toggle focus" "terminal"
Palette "pane: toggle search" "buffer-search"
Palette "pane: deploy search" "project-search"
Palette "zed: open keymap" "keymap-editor"
Keys "{ESC}" 2
Palette "zed: extensions" "extensions"
Palette "debug panel: toggle focus" "debugger"
Palette "agent: toggle focus" "agent"
Palette "outline panel: toggle focus" "outline-panel"
Palette "collab: toggle focus" "collab-panel"
Palette "zed: open settings" "settings"
Keys "^+p" 2
Shot "palette-open-last"
Keys "{ESC}" 2

$status += "alive_at_end=$(-not $process.HasExited)"
if ($process.HasExited) { $status += "exit_code=$($process.ExitCode)" }
if (-not $process.HasExited) { Stop-Process $process -Force }
$status | Out-File "$Out\status.txt"

$log = Get-ChildItem "$Out\data" -Recurse -Filter "Zed.log" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($log) {
    Copy-Item $log.FullName "$Out\Zed.log"
    $lines = Get-Content $log.FullName
    $summary = @(
        "log_lines=$($lines.Count)",
        "error_lines=$(($lines | Select-String ' ERROR ').Count)",
        "warn_lines=$(($lines | Select-String ' WARN ').Count)",
        "panic_lines=$(($lines | Select-String -Pattern 'panic' -CaseSensitive:$false).Count)"
    )
    $summary | Out-File "$Out\log-summary.txt"
}
$crashes = Get-ChildItem "$Out\data" -Recurse -Include *.dmp, *.mdmp -ErrorAction SilentlyContinue
"crash_dumps=$($crashes.Count)" | Out-File "$Out\status.txt" -Append
