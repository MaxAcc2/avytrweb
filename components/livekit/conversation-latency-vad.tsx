'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useRoomContext,
  useVoiceAssistant,
  type AgentState,
} from '@livekit/components-react';
import type { LocalTrackPublication } from 'livekit-client';
import { RoomState, Track } from 'livekit-client';

/**
 * Latency = local End-of-Speech (on the SAME LiveKit mic track)
 *           → agent state flips to 'speaking' (TTS begins).
 *
 * Gated: does nothing until room is connected.
 * Smoothed: EMA + min speaking duration + refractory to avoid micro-pauses.
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const { state: agentState } = useVoiceAssistant();

  // ---- tuneables (if numbers feel off, adjust here) ----
  const VAD_ALPHA = 0.2;         // EMA smoothing
  const VAD_SPEAK_THR = 3.0;     // EMA > thr => speaking
  const VAD_MIN_SPEAK_MS = 600;  // must speak at least this long to accept EoS
  const VAD_SILENCE_MS = 450;    // sustained silence to confirm EoS
  const VAD_REFRACT_MS = 1200;   // block double EoS after one fires

  // Pairing window (match EoS to 'speaking' flip)
  const PAIR_MIN_AGE = 250;      // ignore markers <250ms old (spurious)
  const PAIR_MAX_AGE = 6000;     // cap at 6s to avoid stale long latencies

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // Local VAD refs
  const isSpeakingRef = useRef(false);
  const speakStartRef = useRef<number | null>(null);
  const lastEosRef = useRef<number | null>(null);
  const eosQueueRef = useRef<number[]>([]);

  const localRAFRef = useRef<number | null>(null);
  const localSilenceTimerRef = useRef<number | null>(null);
  const localCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);

  // Stats
  const historyRef = useRef<number[]>([]);
  const prevAgentStateRef = useRef<AgentState | null>(null);

  useEffect(() => setMounted(true), []);
  const isConnected = room?.state === RoomState.Connected;
  const clearTimer = (id: number | null) => { if (id !== null) window.clearTimeout(id); };

  // TS compat for DOM typings
  const getAvg = (analyser: AnalyserNode, buf: Uint8Array) => {
    (analyser as any).getByteFrequencyData(buf as any);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i];
    return s / buf.length;
  };

  /* ---------------- Local VAD on the SAME mic track ---------------- */
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

    const mediaStream = new MediaStream([micPub.track.mediaStreamTrack]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const src = ctx.createMediaStreamSource(mediaStream);
    src.connect(analyser);

    localCtxRef.current = ctx;
    localAnalyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let ema = 0;

    const loop = () => {
      const avg = getAvg(analyser, buf);
      ema = VAD_ALPHA * avg + (1 - VAD_ALPHA) * ema;
      const speaking = ema > VAD_SPEAK_THR;

      // rising edge
      if (speaking && !isSpeakingRef.current) {
        isSpeakingRef.current = true;
        speakStartRef.current = Date.now();
        clearTimer(localSilenceTimerRef.current);
        localSilenceTimerRef.current = null;
      }

      // falling edge → schedule EoS after sustained silence
      if (!speaking && isSpeakingRef.current) {
        if (localSilenceTimerRef.current === null) {
          localSilenceTimerRef.current = window.setTimeout(() => {
            const now = Date.now();
            const started = speakStartRef.current ?? now;
            const spokeFor = now - started;
            const sinceLast = lastEosRef.current ? now - lastEosRef.current : Infinity;

            if (spokeFor >= VAD_MIN_SPEAK_MS && sinceLast >= VAD_REFRACT_MS) {
              eosQueueRef.current.push(now);
              // keep ≤12s of markers
              eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= 12_000);
              lastEosRef.current = now;
              // console.log('[VAD] EoS @', now, `(spoke ${spokeFor}ms)`);
            }

            isSpeakingRef.current = false;
            speakStartRef.current = null;
            localSilenceTimerRef.current = null;
          }, VAD_SILENCE_MS);
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
  }, [isConnected, room, localPubsSize]);

  /* -------- Compute latency on agent state → 'speaking' -------- */
  useEffect(() => {
    if (!isConnected) return;

    const prev = prevAgentStateRef.current;
    if (prev !== 'speaking' && agentState === 'speaking') {
      const now = Date.now();

      // use the most recent EoS in [PAIR_MIN_AGE, PAIR_MAX_AGE]
      const marker = [...eosQueueRef.current]
        .filter((t) => now - t >= PAIR_MIN_AGE && now - t <= PAIR_MAX_AGE)
        .sort((a, b) => b - a)[0];

      if (marker) {
        const latency = now - marker;
        historyRef.current.push(latency);
        setLatestLatency(latency);

        const avg =
          historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;
        setAverageLatency(avg);

        // drop used + stale
        eosQueueRef.current = eosQueueRef.current.filter((t) => t > marker && now - t <= 12_000);
        // console.log(`🕒 Latency ${latency} ms (avg ${avg.toFixed(0)} ms)`);
      } else {
        // console.log('No fresh EoS in window; adjust thresholds if this repeats.');
      }
    }

    prevAgentStateRef.current = agentState;
  }, [isConnected, agentState]);

  if (!mounted || !isConnected) return null;

  return createPortal(
    <div className="fixed bottom-6 right-6 z-[99999] bg-white text-black text-sm font-mono px-4 py-2 rounded-lg shadow-lg border border-black/20">
      {latestLatency === null ? (
        <span>Waiting…</span>
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