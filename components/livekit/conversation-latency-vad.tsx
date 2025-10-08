'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useRoomContext,
  useVoiceAssistant,
  type AgentState,
} from '@livekit/components-react';
import type { LocalTrackPublication } from 'livekit-client';
import { Track } from 'livekit-client';

/**
 * Conversation latency overlay
 * Measures time between user's end-of-speech (EoS)
 * and assistant beginning to speak (TTS start).
 *
 * Improvements:
 *  - Uses performance.now() for high precision.
 *  - EoS marked immediately when energy drops below threshold
 *    (no delayed silence confirmation).
 *  - Tightened pairing window prevents stale markers.
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const { state: agentState } = useVoiceAssistant();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // Refs
  const isSpeakingRef = useRef(false);
  const lastEosRef = useRef<number | null>(null);
  const eosQueueRef = useRef<number[]>([]);
  const historyRef = useRef<number[]>([]);
  const prevAgentStateRef = useRef<AgentState | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  const getAvg = (analyser: AnalyserNode, buf: Uint8Array) => {
    (analyser as any).getByteFrequencyData(buf as any);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i];
    return s / buf.length;
  };

  /* ---------------- Local VAD on SAME LiveKit mic track ---------------- */

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

    ctxRef.current = ctx;
    analyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Tunables
    const ALPHA = 0.2; // EMA smoothing
    const SPEAK_THR = 3.0; // EMA > threshold => speaking
    const MIN_SPEAK_MS = 300; // must speak at least this long to count
    const EoS_REFRACT_MS = 1000; // ignore EoS if one fired recently

    let ema = 0;
    let speakStart: number | null = null;

    const loop = () => {
      const avg = getAvg(analyser, buf);
      ema = ALPHA * avg + (1 - ALPHA) * ema;
      const speaking = ema > SPEAK_THR;
      const now = performance.now();

      // Rising edge → start speaking
      if (speaking && !isSpeakingRef.current) {
        isSpeakingRef.current = true;
        speakStart = now;
      }

      // Falling edge → early EoS detection
      if (!speaking && isSpeakingRef.current) {
        const spokeFor = speakStart ? now - speakStart : 0;
        const sinceLast = lastEosRef.current ? now - lastEosRef.current : Infinity;

        if (spokeFor >= MIN_SPEAK_MS && sinceLast >= EoS_REFRACT_MS) {
          eosQueueRef.current.push(now);
          eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= 12000);
          lastEosRef.current = now;
          console.log('[VAD] Early EoS detected at', now.toFixed(1));
        }

        isSpeakingRef.current = false;
        speakStart = null;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctx.close().catch(() => undefined);
      ctxRef.current = null;
      analyserRef.current = null;
    };
  }, [room, localPubsSize]);

  /* --------- Compute latency on agent state flip to 'speaking' --------- */

  useEffect(() => {
    const prev = prevAgentStateRef.current;

    if (prev !== 'speaking' && agentState === 'speaking') {
      const now = performance.now();

      // tighter window: 50ms – 3s
      const MIN_AGE = 50;
      const MAX_AGE = 3000;

      const marker = [...eosQueueRef.current]
        .filter((t) => now - t >= MIN_AGE && now - t <= MAX_AGE)
        .sort((a, b) => b - a)[0];

      if (marker) {
        const latency = now - marker;
        historyRef.current.push(latency);
        setLatestLatency(latency);

        const avg =
          historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;
        setAverageLatency(avg);

        eosQueueRef.current = eosQueueRef.current.filter(
          (t) => t > marker && now - t <= 12000
        );

        console.log(`🕒 Conversation latency: ${latency.toFixed(1)} ms (avg ${avg.toFixed(0)} ms)`);
      } else {
        console.log('ℹ️ Agent started speaking but no recent EoS found (0.05–3s window).');
      }
    }

    prevAgentStateRef.current = agentState;
  }, [agentState]);

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
          <div>Last: {latestLatency.toFixed(1)} ms</div>
          {typeof averageLatency === 'number' && (
            <div className="text-gray-700">Avg: {averageLatency.toFixed(0)} ms</div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};