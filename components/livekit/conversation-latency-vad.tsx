'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useRoomContext,
  useRemoteParticipants,
} from '@livekit/components-react';
import type {
  LocalTrackPublication,
  RemoteTrackPublication,
  RemoteParticipant,
  RemoteAudioTrack,
} from 'livekit-client';
import {
  RoomEvent,
  Track,
} from 'livekit-client';

/**
 * Measures latency between:
 *  - when YOU stop speaking (VAD from the SAME local mic track LiveKit publishes)
 *  - when the AVATAR starts playing audio (via remote audio element 'play' on TrackSubscribed)
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

  // keep track of the currently attached remote audio element so we can clean up
  const remoteAudioCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => setMounted(true), []);

  /* ------------------  VAD using the SAME local mic track  ------------------ */
  const localPubsSize =
    room?.localParticipant?.trackPublications.size ?? 0;

  useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;

    // Find the LOCAL mic publication LiveKit is actually using
    const pubs = Array.from(lp.trackPublications.values()) as LocalTrackPublication[];
    const micPub =
      pubs.find((p) => p.kind === Track.Kind.Audio) ||
      pubs.find((p) => `${p.source}`.includes('microphone'));

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
  }, [room, localPubsSize, isUserSpeaking]);

  /* ------------------  Remote audio playback detection (event-based)  ------------------ */

  // Helper: attach to a RemoteAudioTrack and listen for <audio> 'play'
  const attachPlaybackListener = (track: RemoteAudioTrack) => {
    // cleanup any previous attachment
    if (remoteAudioCleanupRef.current) {
      remoteAudioCleanupRef.current();
      remoteAudioCleanupRef.current = null;
    }

    const audioEl = track.attach();
    audioEl.muted = true;            // avoid double audio
    audioEl.style.display = 'none';  // hidden probe
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

        console.log(
          `🕒 Conversation latency: ${latencyMs} ms (avg ${avg.toFixed(0)} ms)`
        );
      } else {
        console.log('ℹ️ Avatar audio started but no VAD marker yet.');
      }
    };

    audioEl.addEventListener('play', handlePlay);

    // store cleanup
    remoteAudioCleanupRef.current = () => {
      audioEl.removeEventListener('play', handlePlay);
      track.detach(audioEl);
      audioEl.remove();
    };
  };

  // Effect A: try to attach to any already-subscribed remote audio tracks
  useEffect(() => {
    if (!room) return;

    // scan all remote participants and their publications for an audio track
    let attached = false;
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      rp.trackPublications.forEach((pub: RemoteTrackPublication) => {
        const t = pub.track;
        if (t && pub.kind === Track.Kind.Audio) {
          console.log('✅ Found existing subscribed remote audio track. Attaching.');
          attachPlaybackListener(t as RemoteAudioTrack);
          attached = true;
        }
      });
    });

    // cleanup when component unmounts
    return () => {
      if (remoteAudioCleanupRef.current) {
        remoteAudioCleanupRef.current();
        remoteAudioCleanupRef.current = null;
      }
    };
  }, [room, remoteParticipants.length]);

  // Effect B: listen for NEW subscriptions via Room events (fires when avatar track actually arrives)
  useEffect(() => {
    if (!room) return;

    const onTrackSubscribed = (
      track: any,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        console.log('📡 RoomEvent.TrackSubscribed (audio) from', participant.sid);
        attachPlaybackListener(track as RemoteAudioTrack);
      }
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [room]);

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