# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SillyMic bridges a PC microphone to an iPhone over LAN using WebRTC. The PC runs a Rust CLI that captures audio, encodes it as Opus, and sends it via WebRTC. The iPhone runs a React Native app that receives and plays the stream. Signaling happens over a local WebSocket; there is no cloud relay.

## Build & run commands

### Backend (Rust, from repo root)

```bash
cargo build -p sillymic-host          # build
cargo run -p sillymic-host -- devices  # list audio input devices
cargo run -p sillymic-host -- doctor --port 41777  # environment diagnostics
cargo run -p sillymic-host -- host --port 41777 --pin 123456  # start host
```

Tracing is controlled via `RUST_LOG`. Default filter: `sillymic_host=info,webrtc=warn`.

### Mobile (React Native bare, from `mobile/`)

```bash
npm install
cd ios && pod install && cd ..
npx react-native start        # Metro bundler
npx react-native run-ios      # build + run on simulator/device
npm run lint                   # ESLint (.ts, .tsx)
```

EAS cloud build (unsigned IPA for sideloading):
```bash
eas build -p ios --profile development
```

## Architecture

### Backend modules (`backend/src/`)

- **cli.rs** — clap CLI with three subcommands: `host`, `devices`, `doctor`
- **server.rs** — axum HTTP/WS server. Routes: `/health`, `/session/create`, `/session/status`, `GET ws /signal`. Contains the full WebSocket signaling loop (`handle_signal_socket`) which enforces single-connection via `ActiveConnectionGuard` (AtomicBool)
- **session.rs** — `SessionManager`: single-session store behind `RwLock<Option<SessionData>>` with TTL expiry (60s for non-streaming states). States: `Waiting → Connecting → Streaming → Error`
- **signal.rs** — `SignalMessage` enum with serde `{tag = "type"}` JSON serialization. Message types: `hello`, `offer`, `answer`, `ice_candidate`, `ready`, `error`
- **audio.rs** — cpal capture → resample to 48kHz mono → Opus encode (20ms frames) → write to WebRTC `TrackLocalStaticSample`. The `FrameAccumulator` handles multi-channel downmix and sample rate conversion. Supports F32, I16, U16, U8 input formats
- **webrtc_engine.rs** — creates the `webrtc` API and a single shared Opus audio track. `create_peer()` builds a new `RTCPeerConnection` per client, attaches the track, and wires ICE candidates to the signal channel

### Mobile (`mobile/`)

- **App.tsx** — single-screen UI: IP input, PIN input, connect/disconnect, status badge, audio level meter
- **src/bridgeClient.ts** — `BridgeClient` class: manages WebSocket connection, WebRTC peer (recvonly audio), reconnect logic (3 attempts with backoff), audio level polling via `getStats()`. Uses `InCallManager` for audio routing
- **src/types.ts** — TypeScript types for `SignalMessage`, `ConnectionStatus`, `BridgeConfig`, `BridgeEvents`

### Signaling flow

1. Mobile opens WebSocket to `ws://<pc-ip>:41777/signal`
2. Mobile sends `hello` with device name, app version, session code (PIN)
3. Host validates PIN against session, replies `ready` with session ID
4. Mobile creates RTCPeerConnection (recvonly), gathers all ICE candidates locally, sends `offer` with full SDP
5. Host sets remote description, creates answer, waits for ICE gathering to complete, sends `answer` with full SDP
6. WebRTC connects, audio streams

**Non-trickle ICE**: Both sides wait for ICE gathering to complete before sending SDP. The mobile client ignores incoming `ice_candidate` messages. This was a deliberate stabilization choice for LAN (see recent git history).

### CI

Two GitHub Actions workflows (manual dispatch only):
- `ios-unsigned.yml` — fast Debug build → unsigned IPA
- `ios-unsigned-release.yml` — Release archive → unsigned IPA

Both run on `macos-14`, use Node 22, Ruby 3.2, CocoaPods via Bundler.

## Key constraints

- LAN-only: host binds `0.0.0.0`, no WAN/TURN relay
- Single mobile connection at a time (enforced server-side)
- PIN must be exactly 6 digits
- Default port is 41777
- Signal payload max size: 128 KB
- Audio: 48kHz mono Opus, 20ms frames
- The project README and some comments are in French
