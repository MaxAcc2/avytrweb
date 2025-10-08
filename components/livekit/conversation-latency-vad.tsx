'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRemoteParticipants } from '@livekit/components-react';
import type { RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';

/**
 * Measures latency between when the user stops speaking (VAD)
 * and when the remote avatar begins playing audio.
 */
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

  // --- Voice Activity Detection (VAD) for local user ---
  useEffect(() => {
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 512;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
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

          requestAnimationFrame(checkVolume);
        };

        requestAnimationFrame(checkVolume);
        analyserRef.current = analyser;
        audioContextRef.current = audioContext;
      } catch (err) {
        console.error('VAD init error:', err);
      }
    };

    init();
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isUserSpeaking]);

  // --- Detect when avatar (remote participant) starts speaking ---
  useEffect(() => {
    const remote = remoteParticipants[0];
    if (!remote) return;

    const audioPub: RemoteTrackPublication | undefined = Array.from(
      remote.trackPublications.values()
    ).find((pub) => pub.kind === 'audio');

    if (!audioPub) {
      console.log('⚠️ No remote audio publication found');
      return;
    }

    const track = audioPub.track as RemoteAudioTrack | undefined;
    if (!track) {
      console.log('⚠️ Remote audio track not yet attached');
      return;
    }

    // Attach the track to an invisible <audio> element to monitor playback
    const audioEl = track.attach();
    audioEl.muted = true; // avoid echo
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
  }, [remoteParticipants, userEndTime]);

  if (!mounted) return null;

  // --- Display overlay (portal) ---
  return createPortal(
    <div
      className="
        fixed bottom-6 right-6 z-[99999]
        bg-white text-black text-sm font-mono
        px-4 py-2 rounded-lg shadow-lg border border-black/20
      "
    >
      {latestLatency === null ? (
        <span>Listening...</span>
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