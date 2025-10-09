'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type AgentState,
  type ReceivedChatMessage,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import { toastAlert } from '@/components/alert-toast';
import { AgentControlBar } from '@/components/livekit/agent-control-bar/agent-control-bar';
import { ChatEntry } from '@/components/livekit/chat/chat-entry';
import { MediaTiles } from '@/components/livekit/media-tiles';
import useChatAndTranscription from '@/hooks/useChatAndTranscription';
import { useDebugMode } from '@/hooks/useDebug';
import type { AppConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ConversationLatencyVAD } from '@/components/livekit/conversation-latency-vad';

function isAgentAvailable(agentState: AgentState) {
  return agentState === 'listening' || agentState === 'thinking' || agentState === 'speaking';
}

interface SessionViewProps {
  appConfig: AppConfig;
  disabled: boolean;
  sessionStarted: boolean;
}

export const SessionView = ({
  appConfig,
  disabled,
  sessionStarted,
  ref,
}: React.ComponentProps<'div'> & SessionViewProps) => {
  const { state: agentState } = useVoiceAssistant();
  const [chatOpen, setChatOpen] = useState(false);
  const { messages, send } = useChatAndTranscription();
  const room = useRoomContext();
  const [showListeningHint, setShowListeningHint] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useDebugMode({ enabled: process.env.NODE_ENV !== 'production' });

  async function handleSendMessage(message: string) {
    await send(message);
  }

  // timeout if agent doesn’t join
  useEffect(() => {
    if (!sessionStarted) return;
    const timeout = setTimeout(() => {
      if (!isAgentAvailable(agentState)) {
        const reason =
          agentState === 'connecting'
            ? 'Agent did not join the room. '
            : 'Agent connected but did not complete initializing. ';
        toastAlert({
          title: 'Session ended',
          description: (
            <p className="w-full">
              {reason}
              <a
                target="_blank"
                rel="noopener noreferrer"
                href="https://docs.livekit.io/agents/start/voice-ai/"
                className="whitespace-nowrap underline"
              >
                See quickstart guide
              </a>
              .
            </p>
          ),
        });
        room.disconnect();
      }
    }, 20_000);
    return () => clearTimeout(timeout);
  }, [agentState, sessionStarted, room]);

  // detect video ready
  useEffect(() => {
    const checkVideoReady = () => {
      const hasRemoteVideo = Array.from(room.remoteParticipants.values()).some((p) =>
        p.getTrackPublications().some(
          (pub) => pub.track && pub.track.kind === 'video' && pub.isSubscribed && !pub.isMuted,
        ),
      );
      if (hasRemoteVideo) setShowListeningHint(true);
    };
    room.on('trackSubscribed', checkVideoReady);
    room.on('participantConnected', checkVideoReady);
    checkVideoReady();
    return () => {
      room.off('trackSubscribed', checkVideoReady);
      room.off('participantConnected', checkVideoReady);
    };
  }, [room]);

  // hide “Listening…” after first message
  useEffect(() => {
    if (messages.length > 0) {
      const t = setTimeout(() => setShowListeningHint(false), 2000);
      return () => clearTimeout(t);
    }
  }, [messages.length]);

  // 🆕 Scroll to top when a new message arrives (since newest is at top)
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = 0;
    }
  }, [messages.length]);

  const { supportsChatInput, supportsVideoInput, supportsScreenShare } = appConfig;
  const capabilities = { supportsChatInput, supportsVideoInput, supportsScreenShare };

  return (
    <section
      ref={ref}
      inert={disabled}
      className={cn(
        'relative min-h-screen bg-background transition-[grid-template-columns] duration-300 grid overflow-hidden',
        chatOpen ? 'md:[grid-template-columns:1fr_1fr] grid-cols-1' : 'grid-cols-1',
      )}
    >
      {/* LEFT: avatar / video */}
      <div className="relative flex items-center justify-center overflow-hidden bg-background transition-all duration-500 pt-[140px]">
        <MediaTiles chatOpen={chatOpen} />
      </div>

      {/* RIGHT: chat panel */}
      <aside
        className={cn(
          'flex flex-col border-l border-bg2 bg-background/95 backdrop-blur-sm transition-all duration-300 ease-out',
          chatOpen
            ? 'translate-x-0 opacity-100 md:relative md:translate-x-0 md:opacity-100'
            : 'translate-x-full opacity-0 md:relative md:translate-x-0 md:opacity-0',
        )}
      >
        <div
          ref={chatScrollRef}
          // 🟢 Top padding (same as video area)
          className="flex-1 overflow-y-auto p-3 pt-[140px]"
        >
          <div className="space-y-1 whitespace-pre-wrap leading-snug">
            <AnimatePresence>
              {/* 🆕 Reverse message order so newest is at the top */}
              {[...messages].reverse().map((message: ReceivedChatMessage) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                >
                  <ChatEntry hideName entry={message} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
        <div className="h-3 shrink-0" />
      </aside>

      {/* control bar */}
      <div className="bg-background fixed right-0 bottom-0 left-0 z-50 px-3 pt-2 pb-3 md:px-12 md:pb-12">
        <motion.div
          key="control-bar"
          initial={{ opacity: 0, translateY: '100%' }}
          animate={{
            opacity: sessionStarted ? 1 : 0,
            translateY: sessionStarted ? '0%' : '100%',
          }}
          transition={{ duration: 0.3, delay: sessionStarted ? 0.5 : 0, ease: 'easeOut' }}
        >
          <div className="relative z-10 mx-auto w-full max-w-2xl">
            {appConfig.isPreConnectBufferEnabled && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{
                  opacity: showListeningHint ? 1 : 0,
                  transition: { ease: 'easeIn', duration: 0.5 },
                }}
                aria-hidden={!showListeningHint}
                className="absolute inset-x-0 -top-12 text-center pointer-events-none"
              >
                <p className="animate-text-shimmer inline-block !bg-clip-text text-sm font-semibold text-transparent">
                  Listening... ask a question
                </p>
              </motion.div>
            )}

            <AgentControlBar
              capabilities={capabilities}
              onChatOpenChange={setChatOpen}
              onSendMessage={handleSendMessage}
            />
          </div>

          <div className="from-background border-background absolute top-0 left-0 h-12 w-full -translate-y-full bg-gradient-to-t to-transparent" />
        </motion.div>
      </div>

      {/* latency overlay always visible */}
      <div className="z-[60] pointer-events-none fixed top-0 right-0">
        {sessionStarted && <ConversationLatencyVAD />}
      </div>
    </section>
  );
};