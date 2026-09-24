; HawHost installer hooks (included by electron-builder's NSIS script).

!macro customInit
  ; Stop the boot-time task first (otherwise it restarts HawHost after the
  ; kill), then any running HawHost so its files can be replaced.
  nsExec::Exec `schtasks.exe /End /TN "HawHost Server"`
  nsExec::Exec `taskkill.exe /F /T /IM HawHost.exe`
!macroend

!macro customUnInit
  nsExec::Exec `schtasks.exe /End /TN "HawHost Server"`
  nsExec::Exec `taskkill.exe /F /T /IM HawHost.exe`
!macroend

!macro customUnInstall
  ; On a real uninstall (not an upgrade) remove what HawHost added to Windows:
  ; the boot-time task and the "HawHost" firewall rule group. Your websites,
  ; settings and certificates in %APPDATA%\HawHost are left untouched.
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'HawHost Server' -Confirm:$$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -Group 'HawHost' -ErrorAction SilentlyContinue"`
  ${endIf}
!macroend
