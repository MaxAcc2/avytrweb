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

  // Prevent SSR/layout flicker
  const [hasMounted, setHasMounted] = useState(false);

  // Stabilize "open" signal so 2-col layouts don't react to 1-frame blips
  const [gridChatOpen, setGridChatOpen] = useState(false);
  useEffect(() => {
    if (chatOpen) {
      const id = requestAnimationFrame(() => setGridChatOpen(true));
      return () => cancelAnimationFrame(id);
    }
    setGridChatOpen(false);
  }, [chatOpen]);

  const { messages, send } = useChatAndTranscription();
  const room = useRoomContext();
  const [showListeningHint, setShowListeningHint] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useDebugMode({ enabled: process.env.NODE_ENV !== 'production' });

  async function handleSendMessage(message: string) {
    await send(message);
  }

  useEffect(() => {
    setHasMounted(true);
  }, []);

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

  // newest at top -> scroll to top on new messages
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
        'relative min-h-screen bg-background grid overflow-hidden transition-[grid-template-columns] duration-300',
        // Always single column on small screens
        'grid-cols-1',
        // Desktop: closed = second column is width 0; open = 1fr/1fr
        hasMounted && gridChatOpen
          ? 'md:[grid-template-columns:minmax(0,1fr)_minmax(0,1fr)]'
          : 'md:[grid-template-columns:minmax(0,1fr)_0]'
      )}
    >
      {/* LEFT: avatar / video */}
      <div className="relative flex items-start justify-center overflow-hidden bg-background transition-all duration-500 pt-[40px] md:pt-[80px] md:overflow-visible md:min-h-screen">
        {/* IMPORTANT: pass the STABILIZED flag, not raw chatOpen */}
        <MediaTiles chatOpen={gridChatOpen} />
      </div>

      {/* RIGHT: chat panel */}
      <aside
        className={cn(
          'flex flex-col border-l border-bg2 bg-background/95 backdrop-blur-sm transition-all duration-300 ease-out overflow-hidden',
          // Mobile slides; desktop width is controlled by the grid
          chatOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0',
          'md:translate-x-0'
        )}
      >
        <div
          ref={chatScrollRef}
          className={cn(
            // Always keep desktop padding
            'flex-1 overflow-y-auto p-3 md:pt-[140px]',
            // Only adjust base (mobile) padding depending on chatOpen
            chatOpen ? 'pt-[env(safe-area-inset-top)]' : 'pt-0'
          )}
        >
          <div className="space-y-1 whitespace-pre-wrap leading-snug">
            <AnimatePresence>
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