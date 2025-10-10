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

const animationProps = {
  initial: { opacity: 0, scale: 0 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0 },
  transition: { type: 'spring', stiffness: 675, damping: 75, mass: 1 },
};

// ⬇️ Key changes: center horizontally only (1-col view) and keep vertical at top.
const classNames = {
  grid: [
    'h-full w-full',
    'grid gap-x-2',
    // Only horizontal centering for grid items; keep vertical at start
    'items-start justify-items-center',
    'grid-cols-[1fr_1fr] grid-rows-[90px_1fr_90px]',
  ],
  agentChatOpenWithSecondTile: ['col-start-1 row-start-1', 'self-start justify-self-end'],
  agentChatOpenWithoutSecondTile: ['col-start-1 row-start-1', 'col-span-2', 'place-content-start'],
  agentChatClosed: [
    'col-start-1 row-start-1',
    'col-span-2 row-span-3',
    // top-aligned, horizontally centered
    'self-start justify-self-center',
    // ensure no vertical centering happens inside this grid
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

  const transition = { ...animationProps.transition, delay: chatOpen ? 0 : 0.15 };

  const agentAnimate = {
    ...animationProps.animate,
    scale: chatOpen ? 1 : 0.9,
    transition,
  };
  const avatarAnimate = {
    ...animationProps.animate,
    scale: chatOpen ? 1 : 0.9,
    transition,
  };

  const isAvatar = agentVideoTrack !== undefined;

  return (
    <div
      className={cn(
        // 🧭 Anchored to top of column (no vertical centering)
        'pointer-events-none relative z-10 flex w-full items-start justify-center transition-all duration-500',
        chatOpen
          ? 'pt-[40px] pb-0 pl-[40px] pr-[60px]' // 2-column padding
          : 'pt-[60px] pb-0 px-8 md:px-16',       // 1-column centered padding
      )}
    >
      <div className="relative flex h-auto w-full items-start justify-center">
        <div className={cn(classNames.grid)}>
          {/* === Agent / Avatar === */}
          <div
            className={cn([
              'grid',
              !chatOpen && classNames.agentChatClosed,
              chatOpen && hasSecondTile && classNames.agentChatOpenWithSecondTile,
              chatOpen && !hasSecondTile && classNames.agentChatOpenWithoutSecondTile,
            ])}
          >
            <AnimatePresence mode="popLayout">
              {!isAvatar && (
                <MotionAgentTile
                  key="agent"
                  layoutId="agent"
                  {...animationProps}
                  animate={agentAnimate}
                  transition={transition}
                  // keep horizontally centered with a sane max width
                  className={cn('w-full max-w-5xl mx-auto scale-[1]')}
                  state={agentState}
                  audioTrack={agentAudioTrack}
                />
              )}
              {isAvatar && (
                <MotionAvatarTile
                  key="avatar"
                  layoutId="avatar"
                  {...animationProps}
                  animate={avatarAnimate}
                  transition={transition}
                  videoTrack={agentVideoTrack}
                  className={cn(
                    'w-full max-w-5xl mx-auto',
                    '[&>video]:w-full [&>video]:h-auto [&>video]:object-contain scale-[1]',
                    chatOpen ? 'max-h-[70vh]' : 'max-h-[80vh]',
                  )}
                />
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
            <AnimatePresence>
              {cameraTrack && isCameraEnabled && (
                <MotionVideoTile
                  key="camera"
                  layout="position"
                  layoutId="camera"
                  {...animationProps}
                  trackRef={cameraTrack}
                  transition={transition}
                  className="h-[90px]"
                />
              )}
              {isScreenShareEnabled && (
                <MotionVideoTile
                  key="screen"
                  layout="position"
                  layoutId="screen"
                  {...animationProps}
                  trackRef={screenShareTrack}
                  transition={transition}
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