'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Participant } from 'livekit-client';

/**
 * Conversation Latency Overlay (ActiveSpeakers-based)
 *
 * What it measures:
 *   latency = time between local End-of-Speech (leaving active speakers)
 *             and the first remote speaker becoming active (agent starts).
 *
 * Why this is reliable:
 *   - Uses LiveKit server-side active speaker detection (no WebAudio/VAD).
 *   - Timestamps both edges independently and pairs them regardless of order.
 *   - Uses performance.now() for precise, monotonic timing.
 *
 * Assumptions:
 *   - There's only one remote "agent" speaker in the room while testing.
 *     (If there are multiple remotes, the first newly-active remote after your EoS is used.)
 */

export const ConversationLatencyVAD = () => {
  const room = useRoomContext();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // State for previous active-speaker set to detect edges
  const prevActiveSidsRef = useRef<Set<string>>(new Set());
  const wasLocalActiveRef = useRef<boolean>(false);
  const wasAnyRemoteActiveRef = useRef<boolean>(false);

  // Queues for pairing (hold a few recent markers)
  const eosQueueRef = useRef<number[]>([]);         // local EoS timestamps
  const agentStartQueueRef = useRef<number[]>([]);  // remote start timestamps
  const historyRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  // Pairing window (tunable)
  const MIN_GAP_MS = 50;     // ignore ultra-fast (likely noise)
  const MAX_GAP_MS = 8000;   // ignore if agent starts much later than EoS
  const STALE_MS   = 12000;  // cleanup window

  // Try to pair the latest EoS with the latest agent start (in either order)
  const tryComputeLatency = () => {
    const now = performance.now();

    // Cleanup old markers
    eosQueueRef.current = eosQueueRef.current.filter((t) => now - t <= STALE_MS);
    agentStartQueueRef.current = agentStartQueueRef.current.filter((t) => now - t <= STALE_MS);

    if (eosQueueRef.current.length === 0 || agentStartQueueRef.current.length === 0) {
      return;
    }

    // Use most recent timestamps
    const eos = eosQueueRef.current[eosQueueRef.current.length - 1];
    const start = agentStartQueueRef.current[agentStartQueueRef.current.length - 1];

    // If agent started after EoS (normal case)
    if (start >= eos) {
      const gap = start - eos;
      if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS) {
        recordLatency(gap);
        // drop used markers
        eosQueueRef.current = eosQueueRef.current.filter((t) => t > eos);
        agentStartQueueRef.current = agentStartQueueRef.current.filter((t) => t > start);
        return;
      }
    }

    // If agent started slightly BEFORE our EoS (rare overlap):
    // hold off; pairing will succeed when the *next* matching edge arrives.
  };

  const recordLatency = (latency: number) => {
    historyRef.current.push(latency);
    setLatestLatency(latency);
    const avg = historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;
    setAverageLatency(avg);
    // eslint-disable-next-line no-console
    console.log(`🕒 Conversation latency: ${latency.toFixed(1)} ms (avg ${avg.toFixed(0)} ms)`);
  };

  useEffect(() => {
    const r = room;
    if (!r) return;

    const onActiveSpeakersChanged = () => {
      const now = performance.now();

      // Current active speakers set
      const active = r.activeSpeakers; // Participant[]
      const activeSids = new Set(active.map((p) => p.sid));

      const local = r.localParticipant;
      const isLocalActive = !!local && activeSids.has(local.sid);

      // Any remote active?
      const remoteActives: Participant[] = active.filter((p) => !p.isLocal);
      const isAnyRemoteActive = remoteActives.length > 0;

      // --- Detect local EoS: local was active, now not active
      if (wasLocalActiveRef.current && !isLocalActive) {
        eosQueueRef.current.push(now);
        // eslint-disable-next-line no-console
        console.log('[AS] Local EoS at', now.toFixed(1));
        tryComputeLatency();
      }

      // --- Detect remote start: someone remote became newly active
      // Compute rising edges for remote participants
      const newlyActiveRemote = [...activeSids].some(
        (sid) => !prevActiveSidsRef.current.has(sid) && sid !== local?.sid
      );

      if (newlyActiveRemote) {
        agentStartQueueRef.current.push(now);
        // eslint-disable-next-line no-console
        console.log('[AS] Remote start at', now.toFixed(1));
        tryComputeLatency();
      }

      // Update "previous" trackers
      prevActiveSidsRef.current = activeSids;
      wasLocalActiveRef.current = isLocalActive;
      wasAnyRemoteActiveRef.current = isAnyRemoteActive;
    };

    r.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);

    // Initialize prev set (in case the event fires after someone is already speaking)
    prevActiveSidsRef.current = new Set(r.activeSpeakers.map((p) => p.sid));
    wasLocalActiveRef.current = !!r.localParticipant && prevActiveSidsRef.current.has(r.localParticipant.sid);
    wasAnyRemoteActiveRef.current = r.activeSpeakers.some((p) => !p.isLocal);

    return () => {
      r.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    };
  }, [room]);

  if (!mounted) return null;

  // ---------------- Overlay ----------------
  return createPortal(
    <div
      className="
        fixed bottom-6 right-6 z-[99999]
        bg-white text-black text-sm font-mono
        px-4 py-2 rounded-lg shadow-lg border border-black/20
      "
    >
      {latestLatency === null ? (
        <span>Waiting for first latency…</span>
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