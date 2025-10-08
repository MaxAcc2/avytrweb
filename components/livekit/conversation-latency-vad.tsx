'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import type { LocalTrackPublication, RemoteParticipant } from 'livekit-client';
import { RoomEvent, ParticipantEvent, RoomState, Track } from 'livekit-client';

/**
 * Latency = (performance.now at local End-of-Speech on SAME mic track)
 *           to (performance.now at remote participant speaking rising-edge).
 *
 * No agent state heuristics, no remote VAD math—just two timestamps and a subtraction.
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();

  // ---- UI state
  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // ---- Local VAD (mic) refs
  const isSpeakingRef = useRef(false);
  const speakStartMsRef = useRef<number | null>(null);
  const eosMsRef = useRef<number | null>(null);            // <-- marker we pair
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ---- Remote speaking detection refs
  const attachedParticipantSidsRef = useRef<Set<string>>(new Set());

  // ---- Stats
  const historyRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  const isConnected = room?.state === RoomState.Connected;
  const clearTimer = (t: number | null) => { if (t !== null) window.clearTimeout(t); };

  // Small helper to read energy (cast avoids DOM typing mismatch)
  const avg = (analyser: AnalyserNode, buf: Uint8Array) => {
    (analyser as any).getByteFrequencyData(buf as any);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i];
    return s / buf.length;
  };

  /* ------------------------- Local VAD on SAME mic track ------------------------- */
  const localPubsSize = isConnected ? (room?.localParticipant?.trackPublications.size ?? 0) : 0;

  useEffect(() => {
    if (!isConnected) return;

    const lp = room?.localParticipant;
    if (!lp) return;

    const pubs = Array.from(lp.trackPublications.values()) as LocalTrackPublication[];
    const micPub =
      pubs.find((p) => p.kind === Track.Kind.Audio) ||
      pubs.find((p) => `${p.source}`.toLowerCase().includes('microphone'));

    if (!micPub || !micPub.track || !('mediaStreamTrack' in micPub.track)) {
      // wait for mic publication
      return;
    }

    // Build an analyser on the SAME media track LiveKit publishes
    const stream = new MediaStream([micPub.track.mediaStreamTrack]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    analyserRef.current = analyser;
    audioCtxRef.current = ctx;

    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Simple, robust thresholds (tune if needed for your mic)
    const EMA_A = 0.2;       // smoothing
    const SPEAK_THR = 3.0;   // above => speaking
    const SILENCE_MS = 450;  // sustained silence to mark EoS
    const MIN_SPEAK_MS = 500;// must speak at least this long
    const REFRACT_MS = 1200; // block double EoS for a bit

    let ema = 0;

    const loop = () => {
      const val = avg(analyser, buf);
      ema = EMA_A * val + (1 - EMA_A) * ema;
      const speaking = ema > SPEAK_THR;

      // rising edge
      if (speaking && !isSpeakingRef.current) {
        isSpeakingRef.current = true;
        speakStartMsRef.current = performance.now();
        clearTimer(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      // falling edge → schedule EoS after sustained quiet
      if (!speaking && isSpeakingRef.current) {
        if (silenceTimerRef.current === null) {
          silenceTimerRef.current = window.setTimeout(() => {
            const now = performance.now();
            const started = speakStartMsRef.current ?? now;
            const spokeFor = now - started;
            const last = eosMsRef.current;

            // accept one EoS per turn-ish
            if (spokeFor >= MIN_SPEAK_MS && (!last || now - last >= REFRACT_MS)) {
              eosMsRef.current = now;                // <-- our marker
              // console.log('[EoS]', Math.round(now));
            }

            isSpeakingRef.current = false;
            speakStartMsRef.current = null;
            silenceTimerRef.current = null;
          }, SILENCE_MS);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimer(silenceTimerRef.current);
      silenceTimerRef.current = null;
      ctx.close().catch(() => undefined);
      analyserRef.current = null;
      audioCtxRef.current = null;
    };
  }, [isConnected, room, localPubsSize]);

  /* -------------------- Remote start via IsSpeakingChanged (rising) -------------------- */

  // Attach to current remote participants and future joins
  useEffect(() => {
    if (!isConnected || !room) return;

    const onParticipant = (rp: RemoteParticipant) => {
      if (attachedParticipantSidsRef.current.has(rp.sid)) return;
      attachedParticipantSidsRef.current.add(rp.sid);

      const handler = () => {
        if (rp.isSpeaking) {
          const marker = eosMsRef.current;
          if (marker != null) {
            const now = performance.now();
            const delta = now - marker;        // <-- pure subtraction
            historyRef.current.push(delta);
            setLatestLatency(Math.round(delta));
            const avgVal =
              historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;
            setAverageLatency(avgVal);
            eosMsRef.current = null;           // consume marker; 1:1 pairing
            // console.log('[Start]', Math.round(now), 'Δ', Math.round(delta));
          }
        }
      };

      rp.on(ParticipantEvent.IsSpeakingChanged, handler);

      // cleanup
      return () => {
        rp.off(ParticipantEvent.IsSpeakingChanged, handler);
        attachedParticipantSidsRef.current.delete(rp.sid);
      };
    };

    // attach to existing
    room.remoteParticipants.forEach((rp) => onParticipant(rp));

    // attach to future
    const onConnected = (rp: RemoteParticipant) => onParticipant(rp);
    const onDisconnected = (rp: RemoteParticipant) => {
      // ensure we remove any listener left
      if (attachedParticipantSidsRef.current.has(rp.sid)) {
        rp.removeAllListeners(ParticipantEvent.IsSpeakingChanged);
        attachedParticipantSidsRef.current.delete(rp.sid);
      }
    };

    room.on(RoomEvent.ParticipantConnected, onConnected);
    room.on(RoomEvent.ParticipantDisconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onConnected);
      room.off(RoomEvent.ParticipantDisconnected, onDisconnected);
      // best-effort bulk cleanup
      room.remoteParticipants.forEach((rp) => {
        rp.removeAllListeners(ParticipantEvent.IsSpeakingChanged);
        attachedParticipantSidsRef.current.delete(rp.sid);
      });
    };
  }, [isConnected, room]);

  if (!mounted || !isConnected) return null;

  return createPortal(
    <div className="fixed bottom-6 right-6 z-[99999] bg-white text-black text-sm font-mono px-4 py-2 rounded-lg shadow-lg border border-black/20">
      {latestLatency === null ? (
        <span>Waiting…</span>
      ) : (
        <>
          <div>Last: {latestLatency} ms</div>
          {typeof averageLatency === 'number' && (
            <div className="text-gray-700">Avg: {Math.round(averageLatency)} ms</div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};