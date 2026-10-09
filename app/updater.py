"""Hand Windows updates to a process that survives the WebView closing."""
import os
from pathlib import Path
import subprocess
import time
import uuid


def _ps_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def _windows_update_script(setup, arguments, parent_pid, ready, log):
    return f"""$ErrorActionPreference = 'Stop'
$updateLog = {_ps_literal(log)}
function Write-UpdateLog([string]$message) {{
    Add-Content -LiteralPath $updateLog -Encoding UTF8 -Value "[$(Get-Date -Format o)] $message"
}}
try {{
    $parentProcess = $null
    try {{ $parentProcess = [System.Diagnostics.Process]::GetProcessById({int(parent_pid)}) }}
    catch [System.ArgumentException] {{ }}
    Write-UpdateLog 'Update helper ready; waiting for QuickModel to exit'
    Set-Content -LiteralPath {_ps_literal(ready)} -Value 'ready' -Encoding ASCII
    if ($parentProcess -and -not $parentProcess.WaitForExit(120000)) {{
        throw 'QuickModel did not exit within 120 seconds; installation cancelled'
    }}
    # Allow WebView2 children to release DLL handles after their parent exits.
    Start-Sleep -Seconds 2
    Write-UpdateLog 'Starting installer'
    $installer = Start-Process -FilePath {_ps_literal(setup)} -ArgumentList {_ps_literal(arguments)} -WindowStyle Hidden -PassThru -Wait
    Write-UpdateLog "Installer exit code: $($installer.ExitCode)"
    if ($installer.ExitCode -ne 0) {{ throw "Installer failed: $($installer.ExitCode)" }}
}} catch {{
    Write-UpdateLog "Update failed: $_"
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("QuickModel update failed. See: $updateLog", 'QuickModel') | Out-Null
    exit 1
}} finally {{
    Remove-Item -LiteralPath {_ps_literal(ready)} -ErrorAction SilentlyContinue
}}
"""


def launch_windows_update(setup_path, current_exe, parent_pid, log_dir):
    """Return only once the detached helper is ready; caller may then close UI."""
    setup = Path(setup_path).resolve()
    if not setup.is_file() or setup.suffix.lower() != '.exe':
        raise ValueError(f'安装包不存在或不是 exe：{setup}')
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    ready = log_dir / f'update-{run_id}.ready'
    script = log_dir / f'update-{run_id}.ps1'
    install_dir = Path(current_exe).resolve().parent
    arguments = subprocess.list2cmdline([
        '/SILENT', '/CLOSEAPPLICATIONS', '/NORESTART',
        f'/DIR={install_dir}', f'/LOG={log_dir / "installer.log"}',
    ])
    script.write_text(_windows_update_script(
        setup, arguments, parent_pid, ready, log_dir / 'update.log'), encoding='utf-8-sig')
    powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    process = subprocess.Popen([
        str(powershell), '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', str(script),
    ], creationflags=0x08000000 | 0x00000200, close_fds=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if ready.exists():
            return process.pid
        if process.poll() is not None:
            raise RuntimeError(f'更新辅助进程启动失败，请查看 {log_dir / "update.log"}')
        time.sleep(0.05)
    process.terminate()
    raise RuntimeError('更新辅助进程未就绪，应用未退出，请手动运行已下载的安装包。')
