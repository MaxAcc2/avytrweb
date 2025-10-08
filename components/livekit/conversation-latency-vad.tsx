'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Participant } from 'livekit-client';

/**
 * Conversation Latency Overlay (ActiveSpeakers-based)
 *
 * Measures time between local End-of-Speech (EoS)
 * and remote (agent) start-of-speech, using LiveKit’s
 * server-side ActiveSpeaker events.
 *
 * This version:
 *  - No waiting message
 *  - Appears only after first measurement
 *  - Displays white text in upper-right corner (no box)
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // State for previous active-speaker set to detect edges
  const prevActiveSidsRef = useRef<Set<string>>(new Set());
  const wasLocalActiveRef = useRef<boolean>(false);

  // Queues for pairing (hold recent markers)
  const eosQueueRef = useRef<number[]>([]);
  const agentStartQueueRef = useRef<number[]>([]);
  const historyRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  const MIN_GAP_MS = 50;
  const MAX_GAP_MS = 8000;
  const STALE_MS = 12000;

  const recordLatency = (latency: number) => {
    historyRef.current.push(latency);
    setLatestLatency(latency);
    const avg = historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;
    setAverageLatency(avg);
    console.log(`🕒 Conversation latency: ${latency.toFixed(1)} ms (avg ${avg.toFixed(0)} ms)`);
  };

  const tryComputeLatency = () => {
    const now = performance.now();

    eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= STALE_MS);
    agentStartQueueRef.current = agentStartQueueRef.current.filter((t) => now - t <= STALE_MS);

    if (eosQueueRef.current.length === 0 || agentStartQueueRef.current.length === 0) return;

    const eos = eosQueueRef.current[eosQueueRef.current.length - 1];
    const start = agentStartQueueRef.current[agentStartQueueRef.current.length - 1];

    if (start >= eos) {
      const gap = start - eos;
      if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS) {
        recordLatency(gap);
        eosQueueRef.current = eosQueueRef.current.filter((t) => t > eos);
        agentStartQueueRef.current = agentStartQueueRef.current.filter((t) => t > start);
      }
    }
  };

  useEffect(() => {
    const r = room;
    if (!r) return;

    const onActiveSpeakersChanged = () => {
      const now = performance.now();
      const active = r.activeSpeakers; // Participant[]
      const activeSids = new Set(active.map((p) => p.sid));

      const local = r.localParticipant;
      const isLocalActive = !!local && activeSids.has(local.sid);

      // Local EoS: was speaking, now not
      if (wasLocalActiveRef.current && !isLocalActive) {
        eosQueueRef.current.push(now);
        console.log('[AS] Local EoS at', now.toFixed(1));
        tryComputeLatency();
      }

      // Remote start: someone remote became active
      const newlyActiveRemote = [...activeSids].some(
        (sid) => !prevActiveSidsRef.current.has(sid) && sid !== local?.sid
      );

      if (newlyActiveRemote) {
        agentStartQueueRef.current.push(now);
        console.log('[AS] Remote start at', now.toFixed(1));
        tryComputeLatency();
      }

      prevActiveSidsRef.current = activeSids;
      wasLocalActiveRef.current = isLocalActive;
    };

    r.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    prevActiveSidsRef.current = new Set(r.activeSpeakers.map((p) => p.sid));
    wasLocalActiveRef.current = !!r.localParticipant && prevActiveSidsRef.current.has(r.localParticipant.sid);

    return () => {
      r.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    };
  }, [room]);

  if (!mounted || latestLatency === null) return null;

  return createPortal(
    <div
      className="
        fixed top-6 right-6 z-[99999]
        text-white text-sm font-mono
        text-right
      "
    >
      <div>Last: {latestLatency.toFixed(1)} ms</div>
      {typeof averageLatency === 'number' && (
        <div className="opacity-70">Avg: {averageLatency.toFixed(0)} ms</div>
      )}
    </div>,
    document.body
  );
};