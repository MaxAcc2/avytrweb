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

// ✅ No scale-in on mount. We only fade and we set the starting scale
// to the *final* value immediately via the `style` prop below.
const animationProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0.95 },
  transition: { type: 'spring', stiffness: 675, damping: 75, mass: 1 },
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

  // We still like the slightly smaller look in 1-col; we just *start* there.
  const scaleValue = chatOpen ? 1 : 0.9;
  const transition = { ...animationProps.transition, delay: chatOpen ? 0 : 0.15 };

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
            {/* Disable initial mount animation so we start at final size */}
            <AnimatePresence mode="popLayout" initial={false}>
              {!isAvatar && (
                <MotionAgentTile
                  key="agent"
                  layoutId="agent"
                  {...animationProps}
                  // Start at the final scale immediately
                  style={{ scale: scaleValue, opacity: 1 }}
                  animate={{ opacity: 1, scale: scaleValue }}
                  transition={transition}
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
                  // Start at the final scale immediately
                  style={{ scale: scaleValue, opacity: 1 }}
                  animate={{ opacity: 1, scale: scaleValue }}
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
            <AnimatePresence initial={false}>
              {cameraTrack && isCameraEnabled && (
                <MotionVideoTile
                  key="camera"
                  layout="position"
                  layoutId="camera"
                  {...animationProps}
                  transition={transition}
                  trackRef={cameraTrack}
                  className="h-[90px]"
                />
              )}
              {isScreenShareEnabled && (
                <MotionVideoTile
                  key="screen"
                  layout="position"
                  layoutId="screen"
                  {...animationProps}
                  transition={transition}
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