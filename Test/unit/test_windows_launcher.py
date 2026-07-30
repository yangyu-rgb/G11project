from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_windows_launchers_use_native_virtualenv_and_process_cleanup() -> None:
    powershell = (PROJECT_ROOT / "start.ps1").read_text(encoding="utf-8")
    command = (PROJECT_ROOT / "start.cmd").read_text(encoding="utf-8")

    assert ".venv\\Scripts\\python.exe" in powershell
    assert 'Find-CommandPath @("npm.cmd", "npm")' in powershell
    assert "npm ci" in powershell
    assert "taskkill.exe /PID" in powershell
    assert "--reload" in powershell
    assert "-ExecutionPolicy Bypass" in command
    assert "%~dp0start.ps1" in command
