' SPDX-License-Identifier: GPL-3.0-only
' Silent Windows launcher: runs scripts/launch.ps1 hidden and opens the local visual progress page.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\scripts\launch.ps1"" -Action Start"
shell.Run cmd, 0, False
