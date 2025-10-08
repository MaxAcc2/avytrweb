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
  return agentState == 'listening' || agentState == 'thinking' || agentState == 'speaking';
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

  // 👇 NEW state for listening hint
  const [showListeningHint, setShowListeningHint] = useState(false);

  useDebugMode({
    enabled: process.env.NODE_ENV !== 'production',
  });

  async function handleSendMessage(message: string) {
    await send(message);
  }

  // Session timeout if agent doesn't join
  useEffect(() => {
    if (sessionStarted) {
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
    }
  }, [agentState, sessionStarted, room]);

  // 👇 Show "Listening..." only after avatar video is visible
  useEffect(() => {
    const checkVideoReady = () => {
      const hasRemoteVideo = Array.from(room.remoteParticipants.values()).some((p) =>
        p.getTrackPublications().some(
          (pub) =>
            pub.track &&
            pub.track.kind === 'video' &&
            pub.isSubscribed &&
            !pub.isMuted
        )
      );
      if (hasRemoteVideo) {
        setShowListeningHint(true);
      }
    };

    room.on('trackSubscribed', checkVideoReady);
    room.on('participantConnected', checkVideoReady);
    checkVideoReady();

    return () => {
      room.off('trackSubscribed', checkVideoReady);
      room.off('participantConnected', checkVideoReady);
    };
  }, [room]);

  // 👇 Delay hiding the hint for 2s after first message arrives
  useEffect(() => {
    if (messages.length > 0) {
      const timeout = setTimeout(() => setShowListeningHint(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [messages.length]);

  const { supportsChatInput, supportsVideoInput, supportsScreenShare } = appConfig;
  const capabilities = {
    supportsChatInput,
    supportsVideoInput,
    supportsScreenShare,
  };

  return (
    <section
      ref={ref}
      inert={disabled}
      className="relative"
    >
      {/* 💬 Chat overlay with scroll + height limit */}
      <ChatMessageView
        className={cn(
          'pointer-events-none absolute inset-0 z-30 flex flex-col justify-end px-3 pb-36 md:px-0 md:pb-48 transition-opacity duration-300',
          chatOpen ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-2xl overflow-y-auto max-h-[50vh] rounded-lg bg-background/70 backdrop-blur-sm p-2 scrollbar-thin scrollbar-thumb-muted-foreground/50 scrollbar-track-transparent">
          <div className="space-y-1 whitespace-pre-wrap leading-snug">
            <AnimatePresence>
              {messages.map((message: ReceivedChatMessage) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <ChatEntry hideName entry={message} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </ChatMessageView>

      {/* Keeps agent video full-size */}
      <div className="bg-background mp-12 fixed top-0 right-0 left-0 h-32 md:h-36">
        <div className="from-background absolute bottom-0 left-0 h-12 w-full translate-y-full bg-gradient-to-b to-transparent" />
      </div>

      {/* Keep avatar full-size, ignore chatOpen */}
      <MediaTiles chatOpen={false} />

      {/* Control bar and hint */}
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
                  transition: {
                    ease: 'easeIn',
                    duration: 0.5,
                  },
                }}
                aria-hidden={!showListeningHint}
                className={cn(
                  'absolute inset-x-0 -top-12 text-center',
                  showListeningHint && 'pointer-events-none'
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

      {/* ✅ Latency overlay */}
      {sessionStarted && <ConversationLatencyVAD />}
    </section>
  );
};