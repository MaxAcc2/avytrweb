'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext, useRemoteParticipants } from '@livekit/components-react';
import type {
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteAudioTrack,
} from 'livekit-client';
import { RoomEvent, Track } from 'livekit-client';

/**
 * Conversation latency overlay:
 *   Latency = time from local end-of-speech (same LiveKit mic track)
 *             to remote start-of-speech (VAD on avatar audio track).
 *
 * Robustness:
 *  - EMA smoothing on energy
 *  - Min speaking duration to qualify
 *  - Refractory after EoS (no double EoS per turn)
 *  - EoS queue; match avatar start to most-recent fresh EoS (0.3–7s window)
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // Local VAD
  const isUserSpeakingRef = useRef(false);
  const speakStartRef = useRef<number | null>(null);
  const lastEosRef = useRef<number | null>(null);
  const eosQueueRef = useRef<number[]>([]);
  const localRAFRef = useRef<number | null>(null);
  const localSilenceTimerRef = useRef<number | null>(null);

  // Remote VAD
  const remoteRAFRef = useRef<number | null>(null);
  const remoteSpeakingRef = useRef(false);
  const remoteCleanupRef = useRef<(() => void) | null>(null); // ✅ initialize to null

  // WebAudio refs
  const localCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteCtxRef = useRef<AudioContext | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);

  // Stats
  const latencyHistoryRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  /* ---------------- Utilities ---------------- */

  // TS compat cast for DOM lib differences
  const getAvg = (analyser: AnalyserNode, buf: Uint8Array) => {
    (analyser as any).getByteFrequencyData(buf as any);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i];
    return s / buf.length;
  };

  const clearTimer = (id: number | null) => {
    if (id !== null) window.clearTimeout(id);
  };

  const recordLatencyFromMarker = (marker: number) => {
    const now = Date.now();
    const latency = now - marker;
    latencyHistoryRef.current.push(latency);
    setLatestLatency(latency);
    const avg =
      latencyHistoryRef.current.reduce((a, b) => a + b, 0) /
      latencyHistoryRef.current.length;
    setAverageLatency(avg);
    // eslint-disable-next-line no-console
    console.log(`🕒 Conversation latency: ${latency} ms (avg ${avg.toFixed(0)} ms)`);
  };

  /* ---------------- Local VAD (same LiveKit mic track) ---------------- */

  const localPubsSize = room?.localParticipant?.trackPublications.size ?? 0;

  useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;

    const pubs = Array.from(lp.trackPublications.values()) as LocalTrackPublication[];
    const micPub =
      pubs.find((p) => p.kind === Track.Kind.Audio) ||
      pubs.find((p) => `${p.source}`.toLowerCase().includes('microphone'));

    if (!micPub || !micPub.track || !('mediaStreamTrack' in micPub.track)) {
      console.log('⚠️ No local audio track yet for VAD; will retry.');
      return;
    }

    const mediaStream = new MediaStream([micPub.track.mediaStreamTrack]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const src = ctx.createMediaStreamSource(mediaStream);
    src.connect(analyser);
    localCtxRef.current = ctx;
    localAnalyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Tunables for stability
    const ALPHA = 0.2;
    const SPEAK_THR = 3.0;
    const MIN_SPEAK_MS = 700;
    const SILENCE_MS = 450;
    const EoS_REFRACT_MS = 1500;

    let ema = 0;

    const loop = () => {
      const avg = getAvg(analyser, buf);
      ema = ALPHA * avg + (1 - ALPHA) * ema;
      const speaking = ema > SPEAK_THR;

      if (speaking && !isUserSpeakingRef.current) {
        isUserSpeakingRef.current = true;
        speakStartRef.current = Date.now();
        clearTimer(localSilenceTimerRef.current);
        localSilenceTimerRef.current = null;
      }

      if (!speaking && isUserSpeakingRef.current) {
        if (localSilenceTimerRef.current === null) {
          localSilenceTimerRef.current = window.setTimeout(() => {
            const now = Date.now();
            const started = speakStartRef.current ?? now;
            const spokeFor = now - started;
            const sinceLastEoS = lastEosRef.current ? now - lastEosRef.current : Infinity;

            if (spokeFor >= MIN_SPEAK_MS && sinceLastEoS >= EoS_REFRACT_MS) {
              eosQueueRef.current.push(now);
              eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= 10_000);
              lastEosRef.current = now;
              console.log('[VAD] User stopped talking at', now, `(spoke ${spokeFor}ms)`);
            }
            isUserSpeakingRef.current = false;
            speakStartRef.current = null;
            localSilenceTimerRef.current = null;
          }, SILENCE_MS);
        }
      }

      localRAFRef.current = requestAnimationFrame(loop);
    };

    localRAFRef.current = requestAnimationFrame(loop);

    return () => {
      if (localRAFRef.current) cancelAnimationFrame(localRAFRef.current);
      clearTimer(localSilenceTimerRef.current);
      localSilenceTimerRef.current = null;
      ctx.close().catch(() => undefined);
      localCtxRef.current = null;
      localAnalyserRef.current = null;
    };
  }, [room, localPubsSize]);

  /* ---------------- Remote VAD (avatar audio) ---------------- */

  const attachRemoteVAD = (track: RemoteAudioTrack) => {
    if (remoteCleanupRef.current) {
      remoteCleanupRef.current();
      remoteCleanupRef.current = null;
    }

    const rctx = new AudioContext();
    const ranalyser = rctx.createAnalyser();
    ranalyser.fftSize = 512;
    const rstream = new MediaStream([track.mediaStreamTrack]);
    const rsrc = rctx.createMediaStreamSource(rstream);
    rsrc.connect(ranalyser);
    remoteCtxRef.current = rctx;
    remoteAnalyserRef.current = ranalyser;

    const rbuf = new Uint8Array(ranalyser.frequencyBinCount);

    const R_ALPHA = 0.25;
    const R_THR = 5.0;
    const R_SILENCE_MS = 300;
    let rema = 0;
    let silenceTimer: number | null = null;

    const rloop = () => {
      const avg = getAvg(ranalyser, rbuf);
      rema = R_ALPHA * avg + (1 - R_ALPHA) * rema;
      const speaking = rema > R_THR;

      if (speaking && !remoteSpeakingRef.current) {
        remoteSpeakingRef.current = true;
        const now = Date.now();
        const FRESH_MIN = 300;
        const FRESH_MAX = 7000;
        const fresh = [...eosQueueRef.current]
          .filter((t) => now - t >= FRESH_MIN && now - t <= FRESH_MAX)
          .sort((a, b) => b - a)[0];

        if (fresh) {
          recordLatencyFromMarker(fresh);
          eosQueueRef.current = eosQueueRef.current.filter((t) => t > fresh && now - t <= 10_000);
        } else {
          console.log('ℹ️ Avatar started but no fresh EoS marker in 0.3–7s window.');
        }
      }

      if (!speaking && remoteSpeakingRef.current) {
        if (silenceTimer === null) {
          silenceTimer = window.setTimeout(() => {
            remoteSpeakingRef.current = false;
            silenceTimer = null;
          }, R_SILENCE_MS);
        }
      } else if (speaking && silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      remoteRAFRef.current = requestAnimationFrame(rloop);
    };

    remoteRAFRef.current = requestAnimationFrame(rloop);

    const audioEl = track.attach();
    audioEl.muted = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    remoteCleanupRef.current = () => {
      if (remoteRAFRef.current) cancelAnimationFrame(remoteRAFRef.current);
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      track.detach(audioEl);
      audioEl.remove();
      rctx.close().catch(() => undefined);
      remoteCtxRef.current = null;
      remoteAnalyserRef.current = null;
    };
  };

  // Scan existing tracks (mid-call join)
  useEffect(() => {
    if (!room) return;
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      rp.trackPublications.forEach((pub: RemoteTrackPublication) => {
        if (pub.kind === Track.Kind.Audio && pub.track) {
          console.log('✅ Found existing subscribed remote audio track. Attaching remote VAD.');
          attachRemoteVAD(pub.track as RemoteAudioTrack);
        }
      });
    });
    return () => {
      if (remoteCleanupRef.current) remoteCleanupRef.current();
    };
  }, [room, remoteParticipants.length]);

  // Attach when avatar audio subscribes
  useEffect(() => {
    if (!room) return;
    const onTrackSubscribed = (
      track: any,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        console.log('📡 RoomEvent.TrackSubscribed (audio) from', participant.sid);
        attachRemoteVAD(track as RemoteAudioTrack);
      }
    };
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    return () => room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
  }, [room]);

  if (!mounted) return null;

  /* ---------------- Overlay ---------------- */
  return createPortal(
    <div
      className="
        fixed bottom-6 right-6 z-[99999]
        bg-white text-black text-sm font-mono
        px-4 py-2 rounded-lg shadow-lg border border-black/20
      "
    >
      {latestLatency === null ? (
        <span>Waiting for avatar audio...</span>
      ) : (
        <>
          <div>Last: {latestLatency} ms</div>
          {typeof averageLatency === 'number' && (
            <div className="text-gray-700">Avg: {averageLatency.toFixed(0)} ms</div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};