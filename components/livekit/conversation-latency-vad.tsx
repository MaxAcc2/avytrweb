'use client';
import { useEffect, useRef, useState } from 'react';
import { useRemoteParticipants } from '@livekit/components-react';

export const ConversationLatencyVAD = () => {
  const [latestLatency, setLatestLatency] = useState<number | null>(null);
  const [averageLatency, setAverageLatency] = useState<number | null>(null);
  const [userEndTime, setUserEndTime] = useState<number | null>(null);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latencyHistoryRef = useRef<number[]>([]);
  const remoteParticipants = useRemoteParticipants();

  // --- Voice Activity Detection (VAD) ---
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

          const speaking = avg > 20; // adjust threshold if too sensitive

          if (speaking && !isUserSpeaking) {
            setIsUserSpeaking(true);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          } else if (!speaking && isUserSpeaking) {
            // Sustained silence for 400ms => user stopped talking
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

  // --- Detect avatar (remote participant) speech start ---
  useEffect(() => {
    const remote = remoteParticipants[0];
    if (!remote) return;

    const audioPub = remote.getTrackPublication('audio');
    if (!audioPub) return;

    const handleSubscribed = () => {
      if (userEndTime) {
        const latencyMs = Date.now() - userEndTime;
        setLatestLatency(latencyMs);
        latencyHistoryRef.current.push(latencyMs);

        // Compute running average
        const avg =
          latencyHistoryRef.current.reduce((a, b) => a + b, 0) /
          latencyHistoryRef.current.length;
        setAverageLatency(avg);

        console.log(`🕒 Conversation latency: ${latencyMs}ms (avg ${avg.toFixed(0)}ms)`);
      }
    };

    audioPub.on('subscribed', handleSubscribed);
    return () => audioPub.off('subscribed', handleSubscribed);
  }, [remoteParticipants, userEndTime]);

  return (
    <div className="fixed bottom-5 right-5 bg-black/70 text-white text-xs px-3 py-2 rounded-xl shadow-md font-mono">
      {latestLatency === null ? (
        <span>Listening...</span>
      ) : (
        <>
          <div>Last: {latestLatency} ms</div>
          {averageLatency && (
            <div className="text-gray-300">Avg: {averageLatency.toFixed(0)} ms</div>
          )}
        </>
      )}
    </div>
  );
};