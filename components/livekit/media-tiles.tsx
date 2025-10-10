// media-tiles.tsx
import React, { useMemo } from 'react';
import { Track } from 'livekit-client';
import { AnimatePresence, motion } from 'motion/react';
import {
  type TrackReference,
  useLocalParticipant,
  useTracks,
  useVoiceAssistant,
} from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { AgentTile } from './agent-tile';
import { AvatarTile } from './avatar-tile';
import { VideoTile } from './video-tile';

const MotionVideoTile = motion.create(VideoTile);
const MotionAgentTile = motion.create(AgentTile);
const MotionAvatarTile = motion.create(AvatarTile);

// Fade only. No scale animation at all.
const animationProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0.95 },
  transition: { duration: 0.25, ease: 'easeOut' },
};

// Center horizontally only; keep vertical at top.
const classNames = {
  grid: [
    'h-full w-full',
    'grid gap-x-2',
    'items-start justify-items-center',
    'grid-cols-[1fr_1fr] grid-rows-[90px_1fr_90px]',
  ],
  agentChatOpenWithSecondTile: ['col-start-1 row-start-1', 'self-start justify-self-end'],
  agentChatOpenWithoutSecondTile: ['col-start-1 row-start-1', 'col-span-2', 'place-content-start'],
  agentChatClosed: [
    'col-start-1 row-start-1',
    'col-span-2 row-span-3',
    'self-start justify-self-center',
    'place-content-start',
  ],
  secondTileChatOpen: ['col-start-2 row-start-1', 'self-start justify-self-start'],
  secondTileChatClosed: ['col-start-2 row-start-3', 'place-content-end'],
};

export function useLocalTrackRef(source: Track.Source) {
  const { localParticipant } = useLocalParticipant();
  const publication = localParticipant.getTrackPublication(source);
  const trackRef = useMemo<TrackReference | undefined>(
    () => (publication ? { source, participant: localParticipant, publication } : undefined),
    [source, publication, localParticipant],
  );
  return trackRef;
}

interface MediaTilesProps {
  chatOpen: boolean;
}

export function MediaTiles({ chatOpen }: MediaTilesProps) {
  const {
    state: agentState,
    audioTrack: agentAudioTrack,
    videoTrack: agentVideoTrack,
  } = useVoiceAssistant();

  const [screenShareTrack] = useTracks([Track.Source.ScreenShare]);
  const cameraTrack: TrackReference | undefined = useLocalTrackRef(Track.Source.Camera);

  const isCameraEnabled = cameraTrack && !cameraTrack.publication.isMuted;
  const isScreenShareEnabled = screenShareTrack && !screenShareTrack.publication.isMuted;
  const hasSecondTile = isCameraEnabled || isScreenShareEnabled;

  const isAvatar = agentVideoTrack !== undefined;

  // Choose your starting "bigger" size with max width; no scaling animation.
  const wrapperMaxWidth = 'max-w-5xl';
  const wrapperMaxHeight = chatOpen ? 'max-h-[70vh]' : 'max-h-[80vh]';

  return (
    <div
      className={cn(
        // ❌ was: transition-all
        // ✅ only animate padding changes between 1-col/2-col, not size
        'pointer-events-none relative z-10 flex w-full items-start justify-center transition-[padding] duration-300',
        chatOpen
          ? 'pt-[40px] pb-0 pl-[40px] pr-[60px]' // 2-column padding
          : 'pt-[60px] pb-0 px-8 md:px-16',       // 1-column padding
      )}
    >
      <div className="relative flex h-auto w-full items-start justify-center">
        <div className={cn(classNames.grid)}>
          {/* === Primary Tile (Agent/Avatar) === */}
          <div
            className={cn([
              'grid',
              !chatOpen && classNames.agentChatClosed,
              chatOpen && hasSecondTile && classNames.agentChatOpenWithSecondTile,
              chatOpen && !hasSecondTile && classNames.agentChatOpenWithoutSecondTile,
            ])}
          >
            {/* No first-mount tween; no shared layout IDs */}
            <AnimatePresence initial={false}>
              {!isAvatar && (
                <div
                  key="agent-wrapper"
                  className={cn(
                    'w-full mx-auto',
                    wrapperMaxWidth,
                    'aspect-video',   // reserve space immediately so it starts at final size
                    wrapperMaxHeight,
                    'overflow-hidden'
                  )}
                >
                  <MotionAgentTile
                    {...animationProps}
                    className={cn(
                      'h-full w-full',
                      '[&>video]:h-full [&>video]:w-full [&>video]:object-contain'
                    )}
                    state={agentState}
                    audioTrack={agentAudioTrack}
                  />
                </div>
              )}

              {isAvatar && (
                <div
                  key="avatar-wrapper"
                  className={cn(
                    'w-full mx-auto',
                    wrapperMaxWidth,
                    'aspect-video',   // reserve space immediately so it starts at final size
                    wrapperMaxHeight,
                    'overflow-hidden'
                  )}
                >
                  <MotionAvatarTile
                    {...animationProps}
                    videoTrack={agentVideoTrack}
                    className={cn(
                      'h-full w-full',
                      '[&>video]:h-full [&>video]:w-full [&>video]:object-contain'
                    )}
                  />
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* === Secondary Tile (camera or screen share) === */}
          <div
            className={cn([
              'grid',
              chatOpen && classNames.secondTileChatOpen,
              !chatOpen && classNames.secondTileChatClosed,
            ])}
          >
            <AnimatePresence initial={false}>
              {cameraTrack && isCameraEnabled && (
                <MotionVideoTile
                  key="camera"
                  {...animationProps}
                  trackRef={cameraTrack}
                  className="h-[90px]"
                />
              )}
              {isScreenShareEnabled && (
                <MotionVideoTile
                  key="screen"
                  {...animationProps}
                  trackRef={screenShareTrack}
                  className="h-[90px]"
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}