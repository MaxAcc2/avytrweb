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
 * Latency = time from local End-of-Speech (EoS) on the SAME LiveKit mic track
 *           to when the agent state flips to 'speaking' (TTS begins).
 *
 * Why this is more accurate & stable:
 *  - EoS is measured on the exact mic track LiveKit publishes (no second getUserMedia).
 *  - Avatar "start" is taken from the assistant state transition, not raw audio frames.
 *  - EMA smoothing + minimum speaking duration + refractory period removes micro-pauses.
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const { state: agentState } = useVoiceAssistant();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // ----- Local VAD state -----
  const isSpeakingRef = useRef(false);
  const speakStartRef = useRef<number | null>(null);
  const lastEosRef = useRef<number | null>(null);
  const eosQueueRef = useRef<number[]>([]); // recent, deduped EoS markers

  // WebAudio refs for local VAD
  const localCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localRAFRef = useRef<number | null>(null);
  const localSilenceTimerRef = useRef<number | null>(null);

  // Stats
  const historyRef = useRef<number[]>([]);
  const prevAgentStateRef = useRef<AgentState | null>(null);

  useEffect(() => setMounted(true), []);

  // Small helpers
  const clearTimer = (id: number | null) => {
    if (id !== null) window.clearTimeout(id);
  };

  // TS compat cast for DOM lib differences (Edge/Node types)
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
      // eslint-disable-next-line no-console
      console.log('⚠️ No local audio track yet for VAD; will retry.');
      return;
    }

    // Build analyser from the *same* MediaStreamTrack LiveKit publishes
    const mediaStream = new MediaStream([micPub.track.mediaStreamTrack]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const src = ctx.createMediaStreamSource(mediaStream);
    src.connect(analyser);

    localCtxRef.current = ctx;
    localAnalyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Tunables (stable defaults)
    const ALPHA = 0.2;          // EMA smoothing
    const SPEAK_THR = 3.0;      // EMA > threshold => speaking
    const MIN_SPEAK_MS = 600;   // must speak at least this long to allow EoS
    const SILENCE_MS = 400;     // sustained silence to confirm EoS
    const EoS_REFRACT_MS = 1200; // block double EoS events

    let ema = 0;

    const loop = () => {
      const avg = getAvg(analyser, buf);
      ema = ALPHA * avg + (1 - ALPHA) * ema;
      const speaking = ema > SPEAK_THR;

      // Rising edge → started speaking
      if (speaking && !isSpeakingRef.current) {
        isSpeakingRef.current = true;
        speakStartRef.current = Date.now();
        clearTimer(localSilenceTimerRef.current);
        localSilenceTimerRef.current = null;
      }

      // Falling edge → schedule EoS after sustained silence
      if (!speaking && isSpeakingRef.current) {
        if (localSilenceTimerRef.current === null) {
          localSilenceTimerRef.current = window.setTimeout(() => {
            const now = Date.now();
            const started = speakStartRef.current ?? now;
            const spokeFor = now - started;
            const sinceLast = lastEosRef.current ? now - lastEosRef.current : Infinity;

            if (spokeFor >= MIN_SPEAK_MS && sinceLast >= EoS_REFRACT_MS) {
              // accept EoS marker
              eosQueueRef.current.push(now);
              // keep only recent markers (≤ 12s)
              eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= 12_000);
              lastEosRef.current = now;
              // eslint-disable-next-line no-console
              console.log('[VAD] User stopped talking at', now, `(spoke ${spokeFor}ms)`);
            }

            isSpeakingRef.current = false;
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

  /* --------- Compute latency on agent state flip to 'speaking' --------- */

  useEffect(() => {
    const prev = prevAgentStateRef.current;
    // Transition into speaking = avatar starts TTS playback
    if (prev !== 'speaking' && agentState === 'speaking') {
      const now = Date.now();
      // Pair with the most recent EoS that’s plausibly from this turn
      // window: 0.25s .. 8s before speaking
      const MIN_AGE = 250;
      const MAX_AGE = 8000;
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

        // Drop used + stale markers
        eosQueueRef.current = eosQueueRef.current.filter((t) => t > marker && now - t <= 12_000);

        // eslint-disable-next-line no-console
        console.log(
          `🕒 Conversation latency: ${latency} ms (avg ${avg.toFixed(0)} ms)`
        );
      } else {
        // eslint-disable-next-line no-console
        console.log('ℹ️ Agent started speaking but no fresh local EoS in 0.25–8s window.');
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