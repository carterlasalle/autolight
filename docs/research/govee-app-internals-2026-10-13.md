# Govee Home 7.7.02 internals

Date: 2026-10-13. Status: research only, no code changed.
Source: `carterlasalle/autolight#9` (author @carterlasalle), landed verbatim as the
research doc that issue cites. Artifact under analysis:

- `com.govee.home` 7.7.02
- 1,658 activities · 19 services · 23 receivers
- 1,217 scene payload constants
- 47,724 decompiled files
- base APK SHA-256 `49149c1e…091d`
- signer SHA-256 `94257a44978717e568b00c24bfcc385ec2f1cfeaf42885bbeb3232c94907eb43`

Reading depth: pipeline, transports, feature values, DaySync model, Matter
sub-commands and the ptUrl transform are read directly from decompiled classes
and methods. The scene container is confirmed arithmetically (200/200 in a first
pass; 572/1,215 strict across the corpus) and the 3-byte entry size is inferred
from a divisibility property across 1,460 frames — labelled as inference, not
read. The H5/Razer location is an absence finding: no Java class exists.

Local paths referenced below (`~/rea-tools/downloads/govee-home-7.7.02.xapk`,
`~/govee-apk/src`, `/tmp/govee-apktool2/AndroidManifest.xml`,
`~/govee-apk/scene_forensics.py`, `~/govee-apk/rea-method.sh`,
`~/govee-apk/rea-evidence/`) are the reporter's machine, not this repo.

## A · How a command actually travels

Nothing in this app sends a bare JSON or a bare byte array. There is one path,
and every feature rides it.

1. **Tap lands in a screen.** Three UI stacks coexist: Jetpack Compose, classic
   Activities with databinding, and WebView pages. All three end up calling the
   same view-model layer. Compose · 1,658 activities · H5 + JS bridge.
2. **The action becomes a typed object.** SwitchObj, BrightnessObj, ColorObj,
   ColorTemObj, DiyObj, SceneObj. ActionConfigManager maps each type to its
   encoder. `eco/executeAction/config` + `data`.
3. **It wraps into a command with a transaction id.** AbsCmd4Op holds a write
   flag, an `op4Transaction` string, and result callbacks. The id comes from
   IotTransactions. `u_<millis*1000+seq>` · `x_<…>`.
4. **A transport is selected per device.** BLE, LAN, cloud MQTT, or Matter. The
   issuer is the control channel: REA's reference trace shows
   `ctlchannel.iot.IotClientProxy` calling the command vocabulary class
   directly, alongside `wlanControl.IotOpV1` and `pact.AbsUI4BleIot`.
   `supportBle` · `supportWlan` · `supportMqtt` · `supportMatter` ·
   `IotClientProxy` (traced).
5. **The reply must echo the transaction.** Realtime commands answer under `op`;
   everything else answers under `state`. Retries are 3 attempts with
   18 s / 10 s / 10 s budgets. `Cmd.getCmdReadParseKey` · `ReqConfig` default
   `(3, 18000, 10000, 10000, 100)`.

This is why the reply rule matters. `op` is not a field name, it is the
transaction token — IotTransactions builds `u_` (write) and `x_` (read) ids as
millis*1000 + counter, counter wrapping at 900, and can append a suffix.
A client that reads `state` for a `ptReal` reply will never match its own write.

## B · Three UI worlds, one command bus

- **Native screens.** Compose plus legacy Activities. The bulk of device control
  lives here. 1,658 activities declared.
- **H5 shell.** Server-side pages at `app-h5.govee.com` with their own manifest
  host, driven by a JS bridge. `JavaScriptInterface` ·
  `WebViewCommand{keyName, optParamsJson}`.
- **Platform.** Matter pairing and Google credential flows are handed to Play
  Services, not implemented in-app. `HandleGms4CommonMatter` · GMS auth
  activities.

The class registry, and one odd config: `assets/base2home_config.properties`
maps feature keys to Activity class names — `mainAcClass`, `diyShareAcClass`,
`musicFeastDetailAc`, `importIotCommandAc`, `rhythmDeviceAc`. The app resolves
screens through this file rather than hard references, which is how so many
variants coexist.

Observation, not conclusion: `assets/config.properties` ships with
`run_mode=qa`, and the APK also carries `config_ci`, `config_pr`, `config_qa`,
`config_qa_inner`. Something selects a mode at runtime, so do not read the
shipped value as the live one — but it is worth knowing the release build
references QA configuration.

## C · What runs alongside the UI

The app declares no custom `android:process` — everything is one process. The
sidecars are services, native libraries, a local database and a web shell, not
separate processes.

| Sidecar | What it does | Evidence |
| --- | --- | --- |
| Mic recorder service | Foreground service with its own notification channel and a stop receiver; feeds music mode. | `RecordingService` · `RecordControllerV3` · `FOREGROUND_SERVICE_MICROPHONE` |
| Control-channel BLE client | GATT connect/notify management, realtime write loop, heartbeat frames. | `ctlchannel`: `VirtualBleClient` · `BleClientProxy` · `NotificationEnbleChecker` |
| H5 web shell | Community, AI-effect browsing, share links, manuals; talks back through a bridge. | `app-h5.govee.com` · `JavaScriptInterface` · `WebViewResult` |
| Local database | ObjectBox-backed local state. | `libobjectbox-jni.so` |
| Push + jobs | FCM messaging, scheduled work, geofence transitions, widgets. | `MessagingService` · `ActiveJobService` · `GeofenceTransitionReceiver` · `GoveeWidgetService` |
| Native security | Key material and crypto outside the JVM. | `libcryptonativekey.so` · `libconscrypt_jni.so` |
| Obfuscated native blob | 3.2 MB of native code with a scrambled library name. | `libl68ae1757.so` (+ x86 twin) |
| Social "feast" features | Shared music/movie moments with their own screens and cloud APIs. | `createFeastAc` · `musicFeastDetailAc` · `movieFeastDetailAc` |

Where Razer Chroma actually lives: `getChroma`, `setChroma` and `maxChroma`
appear in the APK's string pool, but not in any decompiled Java class — and no
razer protocol class exists. The Chroma integration is implemented web-side
(asset hit counts confirm it), reached through the H5 shell and the JS bridge.
That is why a Java-only reading of this app misses it.

## D · BLE values — two frame builders, one checksum

Commands are 20-byte frames. Two builders exist and they differ in the first
bytes — read both before writing a codec.

Builder 1 · single command and heartbeat — `BleUtils.p(proType, cmdType, payload)`:

| Byte | 0 | 1 | 2 | 3 | 4–11 | 12 | 13 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Value | `0x33` / `0xAA` | `00` | proType | cmd | payload | payload | XOR checksum |

Builder 2 · chunked multi-write — `BleUtil.a(type, position, pack)`:

| Byte | 0 | 1 | 2 | 3 | 4–12 | 13 |
| --- | --- | --- | --- | --- | --- | --- |
| Value | `0xA1` (multi-write) | type | `0x33` / `0xAA` | position | payload (≤16 bytes) | XOR checksum |

- **Checksum.** XOR over every preceding byte — confirmed in two independent
  helpers (`BleUtil.getBCC`, `BleUtils.w`). A neighbour sums bytes instead; do
  not use it.
- **Accepted first bytes.** `CmdConfig` in the control channel treats a command
  as valid when byte 0 is `0x33` or `0x3F`.
- **Chunking.** Header packet `A1` type `00` count, then 16-byte chunks with an
  index from 1, then trailer `A1` type `FF`; each packet base64 `NO_WRAP`.
- **Heartbeat.** `HeartGMessage` sends `BleUtils.p(0xAA, 1, null)` and matches
  replies on `[0xAA, 0x01]`. `BleClientProxy.funcRealTimeLoop` drives it from a
  coroutine.
- **Encryption.** AES-ECB, 16-byte key, NoPadding for full blocks and PKCS5 for
  the tail; key ops `0xB1` read and `0xB2` check.
- **Connection.** `BleConnSettings` builder defaults: 60000 ms, 2 attempts,
  plus reconnect flags. `ReqConfig` default is `(3, 18000, 10000, 10000, 100)`.

## E · LAN values — same bodies, a different wrapper byte

LAN commands are the same compiled bodies with proType `0xAB`, wrapped as JSON
over UDP. No crypto on this path.

Supported ops: `turn`, `brightness`, `color`, `colorTem`, `colorwc`, `pt`,
`ptReal`, `ptIot`, `ptUrl`, `multiSync`, `snapshotAWB`, `status`, `timer`,
`bulb`.

- **Reply keying.** `pt` and `ptReal` under `op`; all others under `state`.
- **Payload encoding.** `Encode.encryptByBase64(byte[])` = base64 with flag 2
  (`NO_WRAP`). No key, no IV. The method name is misleading.
- **LAN switch.** Read `[0xEA, 1, xor]`, write `[0xE3, 1, value, xor]`, wrapped
  as `ptIotOp`.
- **Ports.** 4001 discovery, 4002 response, 4003 control — present as app
  constants and matching the community map.
- **Key storage.** `aesKeyBytes`, `encryptedAesKey`, `encryptedAesKeyEmpty=`,
  `aesKeyStoreAlias`, `encryptVersion=` — device hands it over, app keeps it
  under a keystore alias, empty key is the "LAN unavailable" state.
- **White temperature.** `getColorTemKelvinSet(2000, 9000)` steps by 100 → 71
  accepted values. `makeCmdColorWc4Kelvin` rejects anything outside that set and
  sends 0 instead.

No razer literal exists in the app. Streaming rides `ptReal`. Our documented
razer channel has receipts on your units, so both can work — but as a parity
target it is a choice, not a fact to be discovered.

## F · The cloud is not just a relay — it is the encoder

Control channel is MQTT over AWS IoT, credentials from Cognito. Topics are
provisioned, never hardcoded.

- **Big commands.** `POST /bff-app/v1/device/big-commands` →
  `PtUrlInfo{url, type}`.
- **Message channels.** `POST /bff-app/v1/msg-channels?msgId=…` →
  `PtUrl{link, type}`.
- **Matter.** `PUT /bff-app/v1/devices/matter-ids`,
  `POST /bff-app/v1/matter/qrCode`, `/upload-qrcode`, `/check-upload-qrcode`.
- **Topics.** `MqttConfig.getTopic()` then `toReadAccountTopic()` adopts
  `accountTopic` from the server.
- **Bundled key.** `assets/api.key` signs requests — treat as public.

## G · A "URL" that is actually the command

For big payloads the app uploads the effect plus exact firmware versions and
receives a string. It then length-prefixes those bytes and sends them. There is
no client-side encoder for these effects.

```text
effectStr + sku + 4 firmware versions → POST /device/big-commands
  → PtUrlInfo.url → url.getBytes(UTF-8) → len.getLowHighBytes + bytes
  → CmdPtUrl → transport
```

Why this is the single most useful finding: the server decides the byte
encoding per SKU and per firmware, and the client's only jobs are a 2-byte
length prefix and a transport. Anything you reimplement must either reproduce
that call or harvest the resulting strings — guessing the encoding is exactly
the trap.

Read at: `PtUrlService`, `PtUrlData`, `PtUrlInfo`, `GetIotCmdPtUrlLinkInfo` (the
transform is in the suspend body:
`ByteUtils.mergeByteArray(ByteUtils.getLowHighBytes(bytes.length), bytes)`).

## H · Matter values — credentials over BLE, commissioning elsewhere

| Controller | Sub | Returns |
| --- | --- | --- |
| `Controller4BaseInfo` | — | base info |
| `Controller4Gid` | — | GID |
| `Controller4MatterId` | — | Matter ID |
| `Controller4QrCode` | — | pairing QR payload |
| `Controller4WifiSsid` | — | SSID for Matter-over-Wi-Fi |
| `Controller4PairCode` | `0x06` | manual pairing code |

Transport `MtPairProtocol`: proType `0xAB`, command type 1, sub-commands 1…6.
Support is a composite — `supportMatter(...)` returns false unless QR, pair
code, GID and Matter ID are all present. MAC prefix `D0:C9:07:20:` is a
detection heuristic.

## I · Every feature, its carrier, and its numbers

| Feature | Carrier | Values / opcodes | Evidence |
| --- | --- | --- | --- |
| On / off | BLE single + LAN json | `SINGLE_SWITCH` 1 · `SINGLE_MAIN_SWITCH` 1 · `SINGLE_LIGHT_SWITCH` 48 | `BleProtocolConstants` |
| Brightness | BLE single + LAN json | `SINGLE_BRIGHTNESS` 4 · `SINGLE_BASE_LIGHT_BRIGHTNESS_WIFI_BLE` 50 · `SINGLE_LIGHT_LINE_BRIGHTNESS_WIFI_BLE` 49 | `BrightnessObj{brightness}` |
| Colour | BLE single + LAN json | `sub_mode_color` 21 · `sub_mode_color_multi` 110 · `MULTI_V1_NEW_COLOR` 64 | `ColorObj{colorValue, colorGroup, brightnessGroup, colorStripeType}` |
| Colour temperature | BLE single + LAN json | `colorTem` · `SINGLE_PRE_SET_COLOR` 37 · kelvin 2000–9000 step 100 | `ColorTemObj{colorTempKelvin, colorTempValue, timeStamp}` |
| Scenes | prebuilt blobs | scene generations 1 / 2 / 7 / 10 · proType `0xA3` · 100 ms pace | `ScenesRgbIC` 573 blobs · `RgbIcScenesV2/V3` |
| DIY | prebuilt blob + mode frame | `MULTI_DIY` 2 · `MULTI_V1_NEW_DIY` 4 · `sub_mode_new_diy` 10 | `DiyObj{effectId, diyName}` · `MultipleDiyControllerV1/V2/V3` |
| Finger Sketch | blob carrying raster frames | `MULTI_GRAFFITI_COORDINATE` 90 · GIF 92 / 93 · in-series 87 | `diyEffectStr` (base64 PNG) · `ScenesGraffiti` 300–307 |
| Music | mic service + BLE | `sub_mode_music` 19 · `sub_mode_abs_music` 22 · library ops 112–122 · per-SKU mode ids 0/72/73/99/100 | `RecordingService` · `H7063MusicConfig` · `SubMusicModeConfig` |
| AI colour | cloud preview then commit | `RequestPreviewAiEffect{imgUrl, sku, goodsType, pactCode, pactType, versions}` | `ResponsePreviewAiEffect` · `ResponseAiEffect4Home` |
| Illumination | white channel + snapshot | `changeIllumination` · `snapshotAWB` · `whiteBalance.json` lookup | `whiteBalance_25.json` · `Palette4PieceView*` |
| DaySync | schedule schemes | `DAYSYNC_OP` 99 · `LENGTH_CHECK` 100 · `WEATHER_GROUP` 101 · `SUB_MODE_DAYSYNC` −16 | `SchemeBean` · `NodeBean` · `NodeActionBean` |
| Share Space | cloud relay + H5 | `Request4ShareIot{ga, gd, gas, sku, device, iotMsg}` | `community.club` · `app-h5.govee.com` |
| "Razor" = Razer | H5 asset, not Java | `getChroma` / `setChroma` / `maxChroma` (string pool + assets only) | no Java class exists |
| Segments | BLE multi-write + IoT | `SINGLE_WRITE_SEGMENT_SETTING` 15 · `IC_SEGMENT_NUM` 64 · `PART_SCENES` 71 · `SEGMENT_IC_INFO` 72 · `MULTI_RGB_LIST_SET` 81 | `SegmentColorInfo{int, int}` · `DeviceSegmentRequest{ic, segmentCount}` |
| Timers | BLE single | `SINGLE_NEW_TIME_V1` 35 · `SINGLE_AUTO_TIME` 10 · pt op `timer` | `BaseTimerSettingActivity` |
| Snapshot | BLE single | `SINGLE_PRE_SET_INFO` 36 · `SINGLE_PRE_SET_SCENE` 38 · `snapshotAWB` | `EventApplySnapshotResult` |

## J · One action grammar, shared by everything

DaySync, scenes and "feast" all describe what to do with the same object set.
Learn it once and most features unify.

- **SwitchObj** — `{open, feastId}`
- **BrightnessObj** — `{brightness}`
- **ColorObj** — `{colorValue, colorGroup[], brightnessGroup[], colorStripeType}`
- **ColorTemObj** — `{colorTempKelvin, colorTempValue, timeStamp}`
- **DiyObj** — `{effectId, diyName, name, image, localImage}`
- **SceneObj** — `{scenceId, scenceParamId, name, image}`
- **NodeActionBean** — `{actionType, actionValue, actionEffectValue, effectBytes[]}`
  — the schedule action carries raw effect bytes.

DaySync schedule model:

- **SchemeBean** — `{device, effectCodes[], enabled, location, nodes[], recommended, repeatFrequency, sceneTypes[]}`
- node types — `NODE_TYPE_TIME_POINT` 0 · `NODE_TYPE_WEATHER` 1
- time types — `TIME_TYPE_POINT` 0 · `SUNRISE` 1 · `SUNSET` 2
- transitions — `NONE` 0 · `CHANGE` 1 · `ALWAYS` 2
- weather — `WEATHER_TYPE_OTHER` 255
- on connect — `DaySyncAfterConnectConfig` sends op 5 with sub-mode
  `SUB_MODE_DAYSYNC` (−16).

## K · 1,217 payloads, and what they actually are

The app does not compute these. It ships them, keyed by scene id, in eight
classes.

- `ScenesRgbIC` — 573 payloads, the RGBIC family
- `ScenesRgb` — 341, RGB family
- `ScenesCompose` — 131, multi-device compositions
- `ScenesCube` — 83, matrix/cube products
- `ScenesH6057Graffiti` · `ScenesH610B` · `ScenesGraffiti` — 45 · 34 · 9
- total — 1,217 constants, sizes 6 B to 531 B, median 61 B

Container structure: decoding every blob and testing the framing arithmetically
gives one container shape, which parses strictly for about half the corpus:

```text
blob = count, then count × (length, frame)
04 | frame count
23 01 | len = 35
…     | frame 1 (35 B)
23 37 | len = 35
…     | frame 2 (35 B)
23 73 | len = 35
…     | frame 3
23 109| len = 35
…     | frame 4
```

```text
frame = 2-byte header, then N × 3-byte entries
20        | header +0
30        | header +1
d1 14 14  | entry 1 +2
7f 19 01  | entry 2 +5
d2 14 14  | entry 3 +8
…         | entry N
```

- **Frames per blob.** 1 to 6; two is the most common.
- **Frame lengths.** 26 (376×), 29 (265×), 32 (250×), 41 (208×), 35 (199×),
  38 (95×) — every one satisfies length ≡ 2 (mod 3).
- **The 3-byte claim (inference).** 1,460 of 1,492 parsed frames have
  (length − 2) divisible by 3 — the strongest structural signal in the corpus.
- **Frame openers.** `0x00` (847×), `0x50` (72×), `0x55` (68×), `0x20` (50×),
  `0x22` (33×), `0x30` (32×), `0xA0` (31×) — a mix of operate opcodes and plain
  colour runs.
- **Honest limit.** Strict parse succeeds for 572 of 1,215 blobs; the rest fit
  the same first bytes but end with padding or a variant tail, so the container
  is confirmed and the tail rule is not.

Catalogues that name them: `scenes/RgbIcScenesV2` and `V3` hold rows of icon,
label, payload constant, scene id: 2163 Green Forest, 2171 Fire, 2183 Meteor,
2191 Fireworks, 2216 Video Game, 2217 Disco, 2274 Christmas. A further 118 rows
carry a label with no client-side payload — those resolve from the cloud.

Delivery path, read: `AbsMultipleControllerV34DiyInScenes` stores the blob
unchanged and returns it from `g()`; its parent declares proType `0xA3` and
paces at 100 ms. Applying a scene is one multi-write carrying the harvested
bytes — no encoder needed.

## L · Segments and music — the two features with the most per-device variation

Segments:

- model — `SegmentColorInfo{int, int}`, a segment index and its colour word.
- cloud record — `DeviceSegmentRequest{transaction, sku, device, segmentCount, ic}`
  — the app reports how many segments and which IC.
- opcodes — 15 write segment setting · 64 IC segment num · 71 part scenes ·
  72 `PART_SCENES_SEGMENT_IC_INFO` · 81 `MULTI_RGB_LIST_SET`.
- failure mode in the app's own words — `ViewSegmentUI` logs that the segment
  bar cannot draw when the BLE single-read lacks
  `PART_SCENES_SEGMENT_IC_INFO` and IoT sent no segment packet: segment
  topology arrives either way, never from the SKU alone.

Music:

- opcodes — sub-mode 19 (newer protocol uses 15/19 split) ·
  `sub_mode_abs_music` 22 · library 112–122 reads preset colour/info/scenes,
  sets play state, volume, switch, preview.
- per-SKU effect ids — H7063 config registers effects with mode ids 0, 72, 73,
  99, 100 and arrays such as `{1,8}` and `{2,8}`.
- default sub-mode args — `SubMusicModeConfig` defaults to mode −91 with
  `int[]{1,8}`.
- audio side — `RecordingService` is the foreground mic service;
  `RecordControllerV3` owns capture, with its own stop receiver.

Why this matters: music and segments are the two features where a client cannot
assume a value. Both are negotiated per SKU and per firmware, and both have
server records carrying the numbers.

## M · What is still left

Each item below is written as a next action plus the test that closes it.
Nothing here is inferred from configuration files. Foundation documented:
framing (two builders), XOR checksum, chunking with header/trailer, command
vocabulary, reply keying by transaction id, the opcode table, the ptUrl
transform, and the cloud/Matter endpoints are all read and cited.

- **T-BLE framing · reply keying · cloud topics · ptUrl.** Implementation open:
  port `MultipleControllerCommV1` (≈900 lines: V0/V1/V2 dispatch, start packet
  `[proType,0,1,?,commBytes,…]`, continuations marked `0xFF`, 17 bytes per
  continuation, first packet budget `15 − commBytes.length`, plus the `0xA6`
  MTU family). Closes with byte-parity fixtures against harvested blobs.
  (T-BLE-01…10)
- **Live segment streaming: our BB framing or the A1/0xAB envelope?** Unknown,
  needs a capture. Capture one streaming session on H6076 with tcpdump,
  fingerprint the first bytes, then state which. (hardware capture)
- **When does the app turn AES on for LAN payloads?** Unknown, LAN crypto
  trigger open. The flags exist (`encryptVersion=`, `aesKeyStoreAlias`) but no
  call site was traced. Search for the toggle in the LAN send path, or flip LAN
  control on a locked unit and diff the datagrams. (LAN encrypt mode)
- **Container tails.** Unknown, open. 47% of scene blobs parse strictly as
  `[count][len][frame]*`. Resolve the remainder: they share the opening bytes
  but end differently. Compare a member of each tail class against its catalogue
  label. (scene container)
- **Parity target.** Decision, T-GOV-02 yours. The app streams `ptReal` and
  never sends razer. Pick the parity target explicitly — documented razer (has
  receipts on your units) or the app's `ptReal` — and record it in the doc
  comment so nobody re-opens it. (one sentence)
- **Matter.** Open. Read `0xAB/1/<sub>` over BLE for QR, pair code, GID and
  Matter ID; delegate commissioning to a platform commissioner; mirror the four
  BFF endpoints. Support is a composite of four non-empty fields.
  (T-MAT-01…04)
- **Capability model partly known.** Model LAN as boolean plus minimum
  firmware, keep the per-SKU component list from
  `localSkuComponentConfigs.json`, and confirm which `Scenes*` family serves
  each SKU. H6076 also appears in dex strings; H1A45 does not. (wizard +
  profiles)
- **H5 surface.** New thread, open. Chroma/Razer, community and AI-effect
  browsing live in the H5 shell, reachable only through the bridge. If any
  feature must be reproduced, its encoder is web-side. Map `WebViewCommand`
  keys to pages first. (H5 + `JavaScriptInterface`)
- **Server-encoded effects.** New thread, open. Everything big goes through
  `big-commands`. Decide deliberately: reproduce that call, or harvest the
  returned strings for your SKUs. Guessing the encoding is the trap this whole
  page exists to avoid. (ptUrl strategy)

## N · Verified with REA — every load-bearing claim, checked

REA 6.4.0 drove the same APK through its jadx bridge 0.7.1 (bridge digest
`5a5a4e32…`, engine jar `6e5eacf5…`), loading 48,170 classes and 13,156
resources from the artifact whose SHA-256 is `49149c1e…091d`. Each row below is
a decompiled method, not a reading of a listing.

| Claim on this page | REA operation | Evidence | Verdict |
| --- | --- | --- | --- |
| `encryptByBase64` is not encryption | `inspect_android_method Encode.encryptByBase64` | `ev_88f63294…` | confirmed — `Base64.encodeToString(bArr, 2)` |
| `pt`/`ptReal` replies key on `op` | `inspect_android_method Cmd.getCmdReadParseKey` | `ev_f50657a5…` | confirmed — ternary on `"pt"`/`"ptReal"` |
| Transaction id format | `inspect_android_method IotTransactions.i` | `ev_ab37d301…` | confirmed — millis*1000 + counter, wraps at 900 |
| Checksum is XOR | `inspect_android_method BleUtil.getBCC` | `ev_4e86bc62…` | confirmed — XOR loop to length |
| LAN switch uses `0xE3` / `0xEA` | `inspect_android_method WlanController.getCommandType` | `ev_9ff1774a…` | confirmed — write/read constant pair |
| Big commands go through the cloud | `trace_android_references PtUrlService` | `ev_8ecffa73…` | confirmed — 12 refs, incl. `DiyApplyVM…makePtUrl` |
| The control channel issues commands | `trace_android_references base2light.iot.Cmd` | `ev_197cea51…` | confirmed — coverage complete, 5 callers |
| DIY apply is the ptUrl caller | `inspect_android_class DiyApplyVM` | `ev_73f22326…` | confirmed — 71 methods, ptUrlService delegate |
| Manifest + resources decoded | `decode_android_resources` | `ev_64198683…` | confirmed — 13,462 files, 2,000 strings sampled |

What the reference traces changed:

- **PtUrlService callers.** `GetIotCmdPtUrlLinkInfo` plus its suspend inner
  classes, and `pact.newdetail.content.diy.DiyApplyVM` through a method
  literally named `makePtUrl`. Applying a DIY effect is the code path that asks
  the cloud to encode.
- **Command-vocabulary callers.** `ctlchannel.iot.IotClientProxy`,
  `wlanControl.IotOpV1`, `pact.AbsUI4BleIot` and `ai4edit.iot.AiEditIotOp` — the
  control channel and the AI-edit feature both issue the same LAN/IoT commands.

Evidence ids are per run. REA mints a new id for each analysis, so the ids
above are the ones stored in the pack, not universal handles — re-running the
script yields new ids for the same claims. The claim, the operation and the
artifact digest are what stay constant: the loads all report APK SHA-256
`49149c1e…091d`.

One environment gap, stated plainly: REA's MCP method tools in this session
report `REA_JADX_MCP_JAR` unset. The running MCP server was started before that
variable was added to its environment, so it only inherited `GHIDRA_INSTALL_DIR`
and `JAVA_HOME`. Method-level verification therefore ran through REA's CLI,
which reads the same configured jar — same engine, same Evidence format.
A gateway restart closes the gap; the config already carries the variable.

## O · Method — how to check any claim here

- APK: `~/rea-tools/downloads/govee-home-7.7.02.xapk` (194,204,912 bytes)
- decompiled tree: `~/govee-apk/src` — 47,724 files, 518 MB
- decoded manifest: `/tmp/govee-apktool2/AndroidManifest.xml` (apktool, 1,658
  activities)
- blob forensics: `~/govee-apk/scene_forensics.py`
- REA method helper: `~/govee-apk/rea-method.sh`
- REA evidence pack: `~/govee-apk/rea-evidence/` — 11 JSON records (9 numbered
  + 2 traces); re-run with `~/govee-apk/rea-evidence-pack.sh`
- REA heap pin: `REA_JADX_HEAP_MIB=8192` — without it the jadx bridge sizes
  `-Xmx` from transient free memory and large loads fail
- research doc: `autolight/docs/research/govee-app-internals-2026-10-13.md`
- signer SHA-256:
  `94257a44978717e568b00c24bfcc385ec2f1cfeaf42885bbeb3232c94907eb43`

What the signature does not prove: one self-signed certificate, v2/v3 only,
stock Android subject template, 30-year window — the shape both Android Studio
releases and Play App Signing produce. Compare the fingerprint against a second
source before treating provenance as settled.
