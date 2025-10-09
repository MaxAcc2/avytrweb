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
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { type: 'spring', stiffness: 675, damping: 75, mass: 1 },
};

const classNames = {
  grid: [
    'h-full w-full',
    'grid gap-x-2 place-content-center',
    'grid-cols-[1fr_1fr] grid-rows-[90px_1fr_90px]',
  ],
  agentChatOpenWithSecondTile: ['col-start-1 row-start-1', 'self-center justify-self-end'],
  agentChatOpenWithoutSecondTile: ['col-start-1 row-start-1', 'col-span-2', 'place-content-center'],
  agentChatClosed: ['col-start-1 row-start-1', 'col-span-2 row-span-3', 'place-content-center'],
  secondTileChatOpen: ['col-start-2 row-start-1', 'self-center justify-self-start'],
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
        'pointer-events-none relative z-10 flex w-full h-full items-center justify-center transition-all duration-500',
        chatOpen
          ? 'pt-[20px] pb-[0px] pl-[40px] pr-[60px]' // 🧭 higher avatar, less right padding
          : 'py-0 px-8 md:px-16', // 1-column remains centered
      )}
    >
      <div className="relative flex h-auto w-full items-center justify-center">
        <div className={cn(classNames.grid, 'place-items-center')}>
          {/* === Agent / Avatar Tile === */}
          <div
            className={cn([
              'grid',
              !chatOpen && classNames.agentChatClosed,
              chatOpen && hasSecondTile && classNames.agentChatOpenWithSecondTile,
              chatOpen && !hasSecondTile && classNames.agentChatOpenWithoutSecondTile,
            ])}
          >
            <AnimatePresence mode="popLayout">
              {/* === Agent (audio only) === */}
              {!isAvatar && (
                <MotionAgentTile
                  key="agent"
                  layoutId="agent"
                  {...animationProps}
                  animate={agentAnimate}
                  transition={transition}
                  state={agentState}
                  audioTrack={agentAudioTrack}
                  className={cn('w-full scale-[1]')}
                />
              )}

              {/* === Avatar (video) === */}
              {isAvatar && (
                <MotionAvatarTile
                  key="avatar"
                  layoutId="avatar"
                  {...animationProps}
                  animate={avatarAnimate}
                  transition={transition}
                  videoTrack={agentVideoTrack}
                  className={cn(
                    'w-full scale-[1] overflow-hidden rounded-2xl bg-background/80 flex items-center justify-center',
                    chatOpen ? 'max-h-[70vh]' : 'max-h-[80vh]',
                    '[&>video]:h-full [&>video]:w-auto [&>video]:object-contain'
                  )}
                  style={{ minHeight: chatOpen ? '70vh' : '80vh' }} // ✅ prevents resize pop
                >
                  {!agentVideoTrack?.publication?.isSubscribed && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                      Loading avatar...
                    </div>
                  )}
                </MotionAvatarTile>
              )}
            </AnimatePresence>
          </div>

          {/* === Second Tile (camera or screen share) === */}
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