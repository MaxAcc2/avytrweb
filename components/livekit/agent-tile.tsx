import React from 'react';
import { AgentState, BarVisualizer, type TrackReference } from '@livekit/components-react';
import { cn } from '@/lib/utils';

interface AgentAudioTileProps {
  state: AgentState;
  audioTrack: TrackReference;
  className?: string;
}

export const AgentTile = ({
  state,
  audioTrack,
  className,
  ref,
}: React.ComponentProps<'div'> & AgentAudioTileProps) => {
  // 🧠 Considered “idle” when not speaking or listening
  const isIdle =
    state === AgentState.Connecting ||
    state === AgentState.Thinking ||
    state === AgentState.Disconnected;

  return (
    <div ref={ref} className={cn('relative flex items-center justify-center', className)}>
      {/* === Active Voice Visualizer === */}
      {!isIdle && (
        <BarVisualizer
          barCount={5}
          state={state}
          options={{ minHeight: 5 }}
          trackRef={audioTrack}
          className={cn(
            'flex aspect-video w-40 items-center justify-center gap-1 scale-[1]',
            'transition-all duration-300 ease-out'
          )}
        >
          <span
            className={cn([
              'bg-muted min-h-4 w-4 rounded-full',
              'origin-center transition-colors duration-250 ease-linear',
              'data-[lk-highlighted=true]:bg-foreground data-[lk-muted=true]:bg-muted',
            ])}
          />
        </BarVisualizer>
      )}

      {/* === Idle / Thinking Indicator (large dots) === */}
      {isIdle && (
        <div className="animate-pulse flex space-x-3 scale-[1]">
          <span className="h-4 w-4 bg-current rounded-full"></span>
          <span className="h-4 w-4 bg-current rounded-full"></span>
          <span className="h-4 w-4 bg-current rounded-full"></span>
        </div>
      )}
    </div>
  );
};