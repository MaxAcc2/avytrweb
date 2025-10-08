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

/**
 * Measures latency between:
 *  - when YOU stop speaking (VAD from the SAME local mic track LiveKit publishes)
 *  - when the AVATAR starts playing audio (via the remote audio element 'play' event)
 */
export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();

  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);
  const [userEndTime, setUserEndTime] = useState<number | null>(null);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [mounted, setMounted] = useState(false); // SSR-safe portal gate

  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latencyHistoryRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  /* ------------------  VAD using the SAME local mic track  ------------------ */
  const localPubsSize = room?.localParticipant?.trackPublications.size ?? 0;

  useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;

    // Find the LOCAL mic publication LiveKit is actually using
    const pubs: LocalTrackPublication[] = Array.from(lp.trackPublications.values()) as any;
    const micPub = pubs.find((p) => p.kind === 'audio') || pubs.find((p) => `${p.source}`.includes('microphone'));

    if (!micPub || !micPub.track || !('mediaStreamTrack' in micPub.track)) {
      console.log('⚠️ No local audio track yet for VAD; will retry.');
      return;
    }

    // Create an analyser from the SAME MediaStreamTrack LiveKit publishes
    const mediaStream = new MediaStream([micPub.track.mediaStreamTrack]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    const src = ctx.createMediaStreamSource(mediaStream);
    src.connect(analyser);
    analyser.fftSize = 512;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const loop = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;

      // Be sensitive; this is post-NS mic data
      const speaking = avg > 3;

      if (speaking && !isUserSpeaking) {
        setIsUserSpeaking(true);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      } else if (!speaking && isUserSpeaking) {
        // sustained silence → mark "user stopped talking"
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            setIsUserSpeaking(false);
            setUserEndTime(Date.now());
            console.log('[VAD] User stopped talking at', Date.now());
          }, 400);
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    analyserRef.current = analyser;
    audioContextRef.current = ctx;

    return () => {
      cancelAnimationFrame(raf);
      ctx.close().catch(() => {});
    };
    // Re-run when the set of local publications changes (e.g., mic turns on)
  }, [room, localPubsSize, isUserSpeaking]);

  /* ------------------  Detect avatar playback (remote audio)  ------------------ */
  const remotePubsKey = remoteParticipants
    .map((p) => `${p.sid}:${p.trackPublications.size}`)
    .join('|');

  useEffect(() => {
    // pick first remote participant that has any tracks
    const remote: RemoteParticipant | undefined = remoteParticipants.find(
      (p) => p.trackPublications.size > 0
    );
    if (!remote) {
      console.log('⚠️ No remote participant with tracks yet.');
      return;
    }

    const pubs: RemoteTrackPublication[] = Array.from(remote.trackPublications.values()) as any;
    console.log('🔍 Remote pubs found:', pubs.length, pubs.map((p) => p.source));

    // Find any audio-like publication
    const audioPub =
      pubs.find((p) => p.kind === 'audio') ||
      pubs.find((p) => `${p.source}`.includes('microphone')) ||
      pubs.find((p) => !!p.track);

    if (!audioPub || !audioPub.track) {
      console.log('⚠️ No remote audio track yet, will re-check on next render');
      return;
    }

    const track = audioPub.track as RemoteAudioTrack;
    console.log('✅ Found remote audio track, attaching listener');

    // Attach to an invisible <audio> to detect playback reliably
    const audioEl = track.attach();
    audioEl.muted = true; // avoid double audio
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    const handlePlay = () => {
      console.log('🎧 Remote audio element started playing');
      if (userEndTime) {
        const latencyMs = Date.now() - userEndTime;
        latencyHistoryRef.current.push(latencyMs);
        setLatestLatency(latencyMs);

        const avg =
          latencyHistoryRef.current.reduce((a, b) => a + b, 0) /
          latencyHistoryRef.current.length;
        setAverageLatency(avg);

        console.log(`🕒 Conversation latency: ${latencyMs} ms (avg ${avg.toFixed(0)} ms)`);
      } else {
        // Fallback: show that avatar played but we had no VAD marker yet
        console.log('ℹ️ Avatar audio started but no VAD marker yet.');
      }
    };

    audioEl.addEventListener('play', handlePlay);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      track.detach(audioEl);
      audioEl.remove();
    };
  }, [remotePubsKey, userEndTime]);

  if (!mounted) return null;

  /* ------------------  Overlay UI (portal)  ------------------ */
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