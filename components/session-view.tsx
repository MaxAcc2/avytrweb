'use client';

import React, { useEffect, useState } from 'react';
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
import { ChatMessageView } from '@/components/livekit/chat/chat-message-view';
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

  // 👂 “Listening…” hint state
  const [showListeningHint, setShowListeningHint] = useState(false);

  useDebugMode({
    enabled: process.env.NODE_ENV !== 'production',
  });

  async function handleSendMessage(message: string) {
    await send(message);
  }

  // 🕒 Auto-timeout if agent never joins
  useEffect(() => {
    if (sessionStarted) {
      const timeout = setTimeout(() => {
        if (!isAgentAvailable(agentState)) {
          const reason =
            agentState === 'connecting'
              ? 'Agent did not join the room.'
              : 'Agent connected but did not complete initializing.';

          toastAlert({
            title: 'Session ended',
            description: (
              <p className="w-full">
                {reason}{' '}
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://docs.livekit.io/agents/start/voice-ai/"
                  className="underline whitespace-nowrap"
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
    }
  }, [agentState, sessionStarted, room]);

  // 🎥 Show “Listening…” only after avatar video appears
  useEffect(() => {
    const checkVideoReady = () => {
      const hasRemoteVideo = Array.from(room.remoteParticipants.values()).some((p) =>
        p.getTrackPublications().some(
          (pub) =>
            pub.track &&
            pub.track.kind === 'video' &&
            pub.isSubscribed &&
            !pub.isMuted,
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

  // ⏱️ Hide “Listening…” after first message
  useEffect(() => {
    if (messages.length > 0) {
      const timeout = setTimeout(() => setShowListeningHint(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [messages.length]);

  // ✅ Capabilities for control bar
  const { supportsChatInput, supportsVideoInput, supportsScreenShare } = appConfig;
  const capabilities = {
    supportsChatInput,
    supportsVideoInput,
    supportsScreenShare,
  };

  // ✅ Scroll to newest message (top) when chat updates
  useEffect(() => {
    const chatContainer = document.querySelector('.chat-scroll-container');
    if (chatContainer) chatContainer.scrollTo({ top: 0, behavior: 'smooth' });
  }, [messages.length]);

  return (
    <section
      ref={ref}
      inert={disabled}
      className={cn('opacity-0', !chatOpen && 'max-h-svh overflow-hidden')}
    >
      {/* === Chat messages === */}
      <ChatMessageView
        className={cn(
          'mx-auto w-full max-w-2xl px-3 pt-[140px] pb-[180px] transition-[opacity,translate] duration-300 ease-out md:px-0 md:pt-[160px]',
          chatOpen ? 'translate-y-0 opacity-100 delay-200' : 'translate-y-20 opacity-0',
        )}
      >
        <div
          className="chat-scroll-container flex flex-col-reverse overflow-y-auto max-h-[50vh] space-y-3 space-y-reverse whitespace-pre-wrap pb-2"
          style={{ scrollBehavior: 'smooth' }}
        >
          <AnimatePresence>
            {messages.map((message: ReceivedChatMessage) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                <ChatEntry hideName entry={message} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ChatMessageView>

      {/* === Background and gradient fade === */}
      <div className="bg-background mp-12 fixed top-0 right-0 left-0 h-32 md:h-36">
        <div className="from-background absolute bottom-0 left-0 h-12 w-full translate-y-full bg-gradient-to-b to-transparent" />
      </div>

      {/* === Avatar / Video === */}
      <MediaTiles chatOpen={chatOpen} />

      {/* === Bottom Control Bar === */}
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
                className={cn(
                  'absolute inset-x-0 -top-12 text-center',
                  showListeningHint && 'pointer-events-none',
                )}
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

      {/* ✅ Conversation latency overlay */}
      {sessionStarted && <ConversationLatencyVAD />}
    </section>
  );
};