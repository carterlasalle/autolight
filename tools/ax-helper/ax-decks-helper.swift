// ax-decks-helper: reads Rekordbox deck clocks via the Accessibility API and
// serves them as JSON over a loopback TCP socket.
//
// Why a separate binary: the Electron dev binary is not an approvable "app"
// for macOS Automation, so its osascript calls can never be granted. A signed,
// identifiable helper CAN appear in System Settings → Privacy & Security →
// Automation, where the user approves it once. The backend then talks to
// localhost instead of spawning osascript.
//
// API grounding: raw AXUIElement (ApplicationServices) per Apple docs
// (AXUIElementCopyAttributeValue), permission via AXIsProcessTrustedWithOptions
// with kAXTrustedCheckOptionPrompt (prompts once when untrusted), per-text
// kAXValueAttribute reads (bulk fetch returns a list that will not
// string-concat — verified live against Rekordbox 7.2.19 group 2, 102 texts).
//
// Protocol: connect, send "poll\n", receive one JSON line:
//   [{"deckId":1,"elapsed":12.0,"remaining":-180.0}, ...]
// Or {"error":"..."} when Rekordbox is unreachable.
import ApplicationServices
import Cocoa
import Foundation

struct DeckReading: Codable {
  var deckId: Int
  var elapsed: Double?
  var remaining: Double?
}

func ensurePermission() -> Bool {
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  return AXIsProcessTrustedWithOptions(opts)
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
        let kids = v as? [AXUIElement] else { return [] }
  return kids
}

func axRole(_ el: AXUIElement) -> String? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &v) == .success else { return nil }
  return v as? String
}

func axValue(_ el: AXUIElement) -> String? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &v) == .success else { return nil }
  return v as? String
}

func clockToSeconds(_ s: String) -> Double? {
  let t = s.trimmingCharacters(in: .whitespaces)
  let neg = t.hasPrefix("-")
  let core = neg ? String(t.dropFirst()) : t
  let parts = core.split(separator: ":")
  guard parts.count == 2, let m = Double(parts[0]), let sec = Double(parts[1]) else { return nil }
  let v = m * 60 + sec
  return neg ? -v : v
}

func pollDecks() -> [DeckReading] {
  var out: [DeckReading] = []
  guard let rb = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "rekordbox" }) else {
    return out
  }
  let appRef = AXUIElementCreateApplication(rb.processIdentifier)
  var wins: CFTypeRef?
  guard AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &wins) == .success,
        let windows = wins as? [AXUIElement], !windows.isEmpty else { return out }
  for win in windows {
    let groups = axChildren(win).filter { axRole($0) == kAXGroupRole as String }
    guard groups.count >= 2 else { continue }
    var values: [String] = []
    for kid in axChildren(groups[1]) {
      if let s = axValue(kid) { values.append(s) }
    }
    // Pair remaining/elapsed clock values per deck: `-02:56, .8, 00:01, .2`.
    var clocks: [(rem: Double?, el: Double?)] = []
    var i = 0
    while i + 3 < values.count {
      if let rem = clockToSeconds(values[i]), values[i + 1].hasPrefix("."),
         let el = clockToSeconds(values[i + 2]), values[i + 3].hasPrefix(".") {
        clocks.append((rem, el))
        i += 4
      } else { i += 1 }
    }
    for (idx, c) in clocks.prefix(2).enumerated() {
      out.append(DeckReading(deckId: idx + 1, elapsed: c.el, remaining: c.rem))
    }
    if !out.isEmpty { break }
  }
  return out
}

// --- loopback JSON server (POSIX sockets, no framework) ---
func runServer(port: UInt16) {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { fputs("socket failed\n", stderr); exit(1) }
  var one: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
  var addr = sockaddr_in()
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = port.bigEndian
  addr.sin_addr.s_addr = INADDR_LOOPBACK.bigEndian
  let bound = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
  }
  guard bound == 0 else { fputs("bind failed\n", stderr); exit(1) }
  listen(fd, 5)
  print("ax-decks-helper listening on 127.0.0.1:\(port)")
  fflush(stdout)
  let enc = JSONEncoder()
  while true {
    let cfd = accept(fd, nil, nil)
    guard cfd >= 0 else { continue }
    var buf = [UInt8](repeating: 0, count: 64)
    _ = recv(cfd, &buf, buf.count, 0)
    let payload: Data
    let decks = pollDecks()
    payload = (try? enc.encode(decks)) ?? Data("[]".utf8)
    var line = payload
    line.append(0x0A)
    _ = line.withUnsafeBytes { send(cfd, $0.baseAddress!, line.count, 0) }
    close(cfd)
  }
}

if !ensurePermission() {
  fputs("ax-decks-helper: accessibility permission not granted; approve in System Settings → Privacy & Security → Accessibility, then relaunch.\n", stderr)
  exit(2)
}
let portArg = CommandLine.arguments.dropFirst().first.flatMap(UInt16.init) ?? 45991
runServer(port: portArg)
