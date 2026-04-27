import InCallManager from 'react-native-incall-manager';
import {Platform} from 'react-native';
import {
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';

import {BridgeConfig, BridgeEvents, SignalMessage} from './types';

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

type PeerConnectionWithHandlers = RTCPeerConnection & {
  onicecandidate:
    | ((event: {
        candidate: {
          candidate: string;
          sdpMid: string | null;
          sdpMLineIndex: number | null;
        } | null;
      }) => void)
    | null;
  ontrack: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
};

export class BridgeClient {
  private ws: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private config: BridgeConfig | null = null;
  private events: BridgeEvents;
  private manualDisconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private levelInterval: ReturnType<typeof setInterval> | null = null;
  private previousBytes = 0;

  constructor(events: BridgeEvents) {
    this.events = events;
  }

  public connect(config: BridgeConfig) {
    this.config = config;
    this.manualDisconnect = false;
    this.reconnectAttempt = 0;
    this.connectAttempt();
  }

  public disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.stopLevelMeter();

    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    try {
      this.peer?.close();
    } catch {}
    this.peer = null;

    InCallManager.stop();
    this.events.onLevel(0);
    this.events.onStatus('idle');
  }

  private connectAttempt() {
    if (!this.config) {
      this.events.onError('Missing config');
      return;
    }

    this.events.onStatus('connecting');
    const url = `ws://${this.config.pcIp}:41777/signal`;
    this.ws = new WebSocket(url);

    this.ws.onopen = async () => {
      this.reconnectAttempt = 0;
      this.send({
        type: 'hello',
        deviceName: this.config!.deviceName,
        appVersion: this.config!.appVersion,
        sessionCode: this.config!.sessionCode,
      });
      try {
        await this.initPeerAndOffer();
      } catch (error) {
        this.events.onError(
          `WebRTC setup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.events.onStatus('error');
      }
    };

    this.ws.onmessage = async event => {
      let incoming: SignalMessage;
      try {
        incoming = JSON.parse(event.data as string) as SignalMessage;
      } catch (error) {
        this.events.onError(
          `Invalid signal payload: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      try {
        await this.handleSignal(incoming);
      } catch (error) {
        this.events.onError(
          `Signal handling failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    this.ws.onerror = () => {
      if (!this.manualDisconnect) {
        this.events.onStatus('error');
      }
    };

    this.ws.onclose = () => {
      this.stopLevelMeter();
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private async initPeerAndOffer() {
    this.peer = new RTCPeerConnection({
      iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
    });
    const peer = this.peer as PeerConnectionWithHandlers;

    peer.addTransceiver('audio', {direction: 'recvonly'});

    peer.onicecandidate = event => {
      const candidate = event.candidate;
      if (!candidate) {
        return;
      }
      this.send({
        type: 'ice_candidate',
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };

    peer.ontrack = () => {
      try {
        this.startLevelMeter();
        InCallManager.start({media: 'audio', auto: true});
        if (Platform.OS === 'android') {
          InCallManager.setSpeakerphoneOn(true);
        }
        this.events.onStatus('streaming');
      } catch (error) {
        this.events.onError(
          `Audio output init failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === 'connected') {
        this.events.onStatus('streaming');
      } else if (state === 'connecting') {
        this.events.onStatus('connecting');
      } else if (
        (state === 'failed' || state === 'disconnected') &&
        !this.manualDisconnect
      ) {
        this.events.onStatus('error');
        this.scheduleReconnect();
      }
    };

    const offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
    });
    await peer.setLocalDescription(offer);
    await this.waitForIceGatheringComplete(peer, 1500);
    const localSdp = peer.localDescription?.sdp ?? offer.sdp ?? '';

    this.send({
      type: 'offer',
      sdp: localSdp,
    });
  }

  private async handleSignal(msg: SignalMessage) {
    switch (msg.type) {
      case 'ready':
        this.events.onSessionReady(msg.sessionId);
        return;
      case 'answer':
        if (!this.peer) {
          return;
        }
        await this.peer.setRemoteDescription(
          new RTCSessionDescription({
            type: 'answer',
            sdp: msg.sdp,
          }),
        );
        return;
      case 'ice_candidate':
        // LAN mode: ignore trickle ICE and rely on candidates already embedded in SDP.
        return;
      case 'error':
        this.events.onError(`${msg.code}: ${msg.message}`);
        this.events.onStatus('error');
        return;
      default:
        return;
    }
  }

  private send(msg: SignalMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect() {
    if (!this.config) {
      return;
    }
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.events.onError('Reconnect failed after 3 attempts');
      this.events.onStatus('error');
      return;
    }

    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? 4000;
    this.reconnectAttempt += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.connectAttempt();
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startLevelMeter() {
    this.stopLevelMeter();
    this.previousBytes = 0;
    this.levelInterval = setInterval(() => {
      this.pollAudioLevel();
    }, 300);
  }

  private async pollAudioLevel() {
    try {
      if (!this.peer) {
        return;
      }

      const stats = await this.peer.getStats();
      let nextLevel = 0;
      const reports: any[] = [];

      if (stats && typeof (stats as any).forEach === 'function') {
        (stats as any).forEach((report: any) => reports.push(report));
      } else if (stats && typeof stats === 'object') {
        reports.push(...Object.values(stats as Record<string, any>));
      }

      for (const report of reports) {
        if (report?.type !== 'inbound-rtp' || report?.kind !== 'audio') {
          continue;
        }

        if (typeof report.audioLevel === 'number') {
          nextLevel = Math.max(nextLevel, report.audioLevel);
          continue;
        }

        const bytes = Number(report.bytesReceived || 0);
        if (this.previousBytes > 0) {
          const delta = bytes - this.previousBytes;
          const normalized = Math.min(1, Math.max(0, delta / 5000));
          nextLevel = Math.max(nextLevel, normalized);
        }
        this.previousBytes = bytes;
      }

      this.events.onLevel(nextLevel);
    } catch {
      this.events.onLevel(0);
    }
  }

  private async waitForIceGatheringComplete(
    peer: PeerConnectionWithHandlers,
    timeoutMs: number,
  ) {
    if (peer.iceGatheringState === 'complete') {
      return;
    }

    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        peer.onicegatheringstatechange = null;
        resolve();
      }, timeoutMs);

      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState !== 'complete') {
          return;
        }
        clearTimeout(timer);
        peer.onicegatheringstatechange = null;
        resolve();
      };
    });
  }

  private stopLevelMeter() {
    if (!this.levelInterval) {
      return;
    }
    clearInterval(this.levelInterval);
    this.levelInterval = null;
  }
}
