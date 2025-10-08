'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRemoteParticipants } from '@livekit/components-react';
import type { RemoteParticipant, RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';

export const ConversationLatencyVAD = () => {
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);
  const [userEndTime, setUserEndTime] = useState<number | null>(null);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [mounted, setMounted] = useState(false);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latencyHistoryRef = useRef<number[]>([]);
  const remoteParticipants = useRemoteParticipants();

  useEffect(() => setMounted(true), []);

  /* ------------------  Voice Activity Detection  ------------------ */
  useEffect(() => {
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        const src = ctx.createMediaStreamSource(stream);
        src.connect(analyser);
        analyser.fftSize = 512;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          const speaking = avg > 15;
          if (speaking && !isUserSpeaking) {
            setIsUserSpeaking(true);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          } else if (!speaking && isUserSpeaking) {
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => {
                setIsUserSpeaking(false);
                setUserEndTime(Date.now());
                console.log('[VAD] User stopped talking at', Date.now());
              }, 400);
            }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        analyserRef.current = analyser;
        audioContextRef.current = ctx;
      } catch (e) {
        console.error('VAD init error:', e);
      }
    };
    init();
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isUserSpeaking]);

  /* ------------------  Detect avatar playback  ------------------ */
  useEffect(() => {
    if (!remoteParticipants.length) return;

    // pick the first participant with any published tracks
    const remote: RemoteParticipant | undefined = remoteParticipants.find(
      (p) => p.trackPublications.size > 0
    );

    if (!remote) {
      console.log('⚠️ No remote participant with tracks yet.');
      return;
    }

    const pubs = Array.from(remote.trackPublications.values());
    console.log('🔍 Remote pubs found:', pubs.length, pubs.map((p) => p.source));

    // find any audio track
    const audioPub: RemoteTrackPublication | undefined = pubs.find(
      (p) => p.kind === 'audio' || p.source?.toString().includes('microphone')
    );

    if (!audioPub || !audioPub.track) {
      console.log('⚠️ No remote audio track yet, will re-check on next render');
      return;
    }

    const track = audioPub.track as RemoteAudioTrack;
    console.log('✅ Found remote audio track, attaching listener');

    const audioEl = track.attach();
    audioEl.muted = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    const handlePlay = () => {
      console.log('🎧 Remote audio element started playing');
      if (userEndTime) {
        const latencyMs = Date.now() - userEndTime;
        setLatestLatency(latencyMs);
        latencyHistoryRef.current.push(latencyMs);
        const avg =
          latencyHistoryRef.current.reduce((a, b) => a + b, 0) /
          latencyHistoryRef.current.length;
        setAverageLatency(avg);
        console.log(
          `🕒 Conversation latency: ${latencyMs} ms (avg ${avg.toFixed(0)} ms)`
        );
      }
    };

    audioEl.addEventListener('play', handlePlay);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      track.detach(audioEl);
      audioEl.remove();
    };
  }, [remoteParticipants.map((p) => p.trackPublications.size).join(','), userEndTime]);
  // ^ depend on the number of remote publications so it re-runs when a new track appears

  if (!mounted) return null;

  /* ------------------  Overlay UI  ------------------ */
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
          {averageLatency && (
            <div className="text-gray-700">
              Avg: {averageLatency.toFixed(0)} ms
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};