; NSIS finish-page notes (T-OPS-05, T-SEC-02). electron-builder includes
; this file verbatim; the custom page explains the first-launch prompts so
; the owner is not surprised by them.
!include "MUI2.nsh"

Page custom firewallNotes
Var Dialog
Var NotesLabel

Function firewallNotes
  nsDialogs::Create 1018
  Pop $Dialog
  ${NSD_CreateLabel} 0 0 100% 60u "First launch: Windows Firewall will ask about network access for UDP ports 4001-4003 (Govee LAN discovery and control). Allow it on private networks. Microphone access (live reactive overlay) and Bluetooth (Govee BLE where LAN is unavailable) are requested only when those features are used; enable them in Windows privacy settings if prompted."
  Pop $NotesLabel
  nsDialogs::Show
FunctionEnd
