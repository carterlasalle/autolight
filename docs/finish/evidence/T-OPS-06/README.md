# T-OPS-06 Clean-machine install matrix

Closes F-OPS-06; probe P-153-clean-install.

## Matrix (per task DoD; each log begins with the absence check)

| Entry | OS | Check first | Then |
| --- | --- | --- | --- |
| mac-current | macOS current major, fresh VM / separate user | `command -v node python3 uv ffmpeg` returns nothing | install, launch, Setup in Simulator mode, prepare analysis, analyze fixture track, normal-night SIM, quit, relaunch, persistence confirmed |
| mac-previous | macOS previous major, same clean setup | same absence proof | same script |
| win11 | Windows 11, fresh VM / separate user | `where node python uv ffmpeg` returns nothing | same script |

Screenshots plus logs per entry. Hosted CI runners are not clean machines.

## State

Matrix defined, runs outstanding: BLOCKED-HARDWARE/VM (needs fresh VM images or a second machine; the owner run is `HW-INST-01`). No matrix script committed this slice; the runbook above plus the T-QA-11 gate H wiring (`P-153-clean-install` in `yarn gates`) is the deliverable so far. The packaged-app smoke job that executes this matrix is `T-TRU-11` scope.
