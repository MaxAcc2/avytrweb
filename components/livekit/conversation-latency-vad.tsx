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
 * Latency = time from local end-of-speech (VAD on the SAME LiveKit mic track)
 *           to remote start-of-speech (VAD on avatar's audio track).
 */
export const ConversationLatencyVAD = () => {
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();

  const [mounted, setMounted] = useState(false);
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);

  // Local VAD state
  const isUserSpeakingRef = useRef(false);
  const userEndTimeRef = useRef<number | null>(null);
  const userLastSpokeAtRef = useRef<number | null>(null);
  const localCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localRAFRef = useRef<number | null>(null);
  const localSilenceTimerRef = useRef<number | null>(null);

  // Remote VAD state
  const remoteCtxRef = useRef<AudioContext | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteRAFRef = useRef<number | null>(null);
  const remoteSpeakingRef = useRef(false);
  const remoteCleanupRef = useRef<(() => void) | null>(null);

  // Stats
  const latencyHistoryRef = useRef<number[]>([]);

  useEffect(() => setMounted(true), []);

  /* ---------------------- Helpers ---------------------- */

  // NOTE: Casts fix TS DOM lib mismatch: getByteFrequencyData expects Uint8Array<ArrayBuffer>
  const avgAmplitude = (analyser: AnalyserNode, arr: Uint8Array) => {
    (analyser as any).getByteFrequencyData(arr as any); // <-- TS compatibility cast
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  };

  const computeAndRecordLatency = () => {
    const marker = userEndTimeRef.current;
    const now = Date.now();
    // Only compute if we have a fresh local marker (within 12s)
    if (!marker || now - marker > 12_000) return;

    const latency = now - marker;
    latencyHistoryRef.current.push(latency);
    setLatestLatency(latency);

    const avg =
      latencyHistoryRef.current.reduce((a, b) => a + b, 0) /
      latencyHistoryRef.current.length;
    setAverageLatency(avg);

    // Reset marker so we measure per turn
    userEndTimeRef.current = null;

    // eslint-disable-next-line no-console
    console.log(`🕒 Conversation latency: ${latency} ms (avg ${avg.toFixed(0)} ms)`);
  };

  const clearTimer = (id: number | null) => {
    if (id !== null) window.clearTimeout(id);
  };

  /* ---------------------- Local VAD (same mic track) ---------------------- */

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

    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Thresholds tuned for post-noise-suppression
    const SPEAK_THR = 3;          // speaking if avg amplitude > 3
    const SILENCE_MS = 450;       // sustained quiet to mark EoS
    const SPOKE_RECENT_MS = 8_000; // must have spoken recently to set EoS

    const loop = () => {
      const avg = avgAmplitude(analyser, buf);
      const speaking = avg > SPEAK_THR;

      // Rising edge
      if (speaking && !isUserSpeakingRef.current) {
        isUserSpeakingRef.current = true;
        userLastSpokeAtRef.current = Date.now();
        clearTimer(localSilenceTimerRef.current);
        localSilenceTimerRef.current = null;
        // console.log('[VAD] Speaking… avg=', avg.toFixed(2));
      }

      // Falling edge -> schedule EoS if sustained silence
      if (!speaking && isUserSpeakingRef.current) {
        if (localSilenceTimerRef.current === null) {
          localSilenceTimerRef.current = window.setTimeout(() => {
            isUserSpeakingRef.current = false;
            if (
              userLastSpokeAtRef.current &&
              Date.now() - userLastSpokeAtRef.current < SPOKE_RECENT_MS
            ) {
              const t = Date.now();
              userEndTimeRef.current = t;
              console.log('[VAD] User stopped talking at', t);
            }
            localSilenceTimerRef.current = null;
          }, SILENCE_MS);
        }
      }

      localRAFRef.current = requestAnimationFrame(loop);
    };

    localRAFRef.current = requestAnimationFrame(loop);

    localCtxRef.current = ctx;
    localAnalyserRef.current = analyser;

    return () => {
      if (localRAFRef.current) cancelAnimationFrame(localRAFRef.current);
      clearTimer(localSilenceTimerRef.current);
      localSilenceTimerRef.current = null;
      ctx.close().catch(() => undefined);
      localCtxRef.current = null;
      localAnalyserRef.current = null;
    };
  }, [room, localPubsSize]);

  /* ---------------------- Remote VAD (avatar audio) ---------------------- */

  // Attach analyser to a RemoteAudioTrack and call computeAndRecordLatency on rising edge
  const attachRemoteVAD = (track: RemoteAudioTrack) => {
    // Cleanup any previous remote analyser/attachment
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

    const rbuf = new Uint8Array(ranalyser.frequencyBinCount);

    // Thresholds for TTS (clean signal)
    const REM_SPEAK_THR = 5;     // avatar speaking if avg > 5
    const REM_SILENCE_MS = 300;  // debounce for falling edge

    let silenceTimer: number | null = null;

    const rloop = () => {
      const avg = avgAmplitude(ranalyser, rbuf);
      const speaking = avg > REM_SPEAK_THR;

      // Rising edge: avatar started → compute latency
      if (speaking && !remoteSpeakingRef.current) {
        remoteSpeakingRef.current = true;
        computeAndRecordLatency();
        // console.log('[R-VAD] Avatar speaking… avg=', avg.toFixed(2));
      }

      // Falling edge: debounce
      if (!speaking && remoteSpeakingRef.current) {
        if (silenceTimer === null) {
          silenceTimer = window.setTimeout(() => {
            remoteSpeakingRef.current = false;
            silenceTimer = null;
          }, REM_SILENCE_MS);
        }
      } else if (speaking && silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      remoteRAFRef.current = requestAnimationFrame(rloop);
    };

    remoteRAFRef.current = requestAnimationFrame(rloop);

    // Hidden <audio> keeps the media graph active on some browsers
    const audioEl = track.attach();
    audioEl.muted = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    // Cleanup for this attachment
    remoteCleanupRef.current = () => {
      if (remoteRAFRef.current) cancelAnimationFrame(remoteRAFRef.current);
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      track.detach(audioEl);
      audioEl.remove();
      rctx.close().catch(() => undefined);
      remoteAnalyserRef.current = null;
      remoteCtxRef.current = null;
    };

    remoteAnalyserRef.current = ranalyser;
    remoteCtxRef.current = rctx;
  };

  // Scan existing tracks in case we joined mid-call
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
      if (remoteCleanupRef.current) {
        remoteCleanupRef.current();
        remoteCleanupRef.current = null;
      }
    };
  }, [room, remoteParticipants.length]);

  // Attach when the avatar audio actually subscribes
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
    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [room]);

  if (!mounted) return null;

  /* ---------------------- Overlay ---------------------- */
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