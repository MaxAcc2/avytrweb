import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Image from 'next/image'; 
import { ConversationLatencyVAD } from './livekit/conversation-latency-vad'; // ✅ added import

interface WelcomeProps {
  disabled: boolean;
  startButtonText: string;
  onStartCall: () => void;
}

export const Welcome = ({
  disabled,
  startButtonText,
  onStartCall,
  ref,
}: React.ComponentProps<'div'> & WelcomeProps) => {
  return (
    <section
      ref={ref}
      inert={disabled}
      className={cn(
        'bg-background fixed inset-0 mx-auto flex h-svh flex-col items-center justify-center text-center',
        disabled ? 'z-10' : 'z-20'
      )}
    >
      <Image
        src="/avatar.png"
        alt="A description of your image"
        width={340}
        height={500}
      />

      <Button variant="primary" size="lg" onClick={onStartCall} className="mt-6 w-64 font-mono">
        Start
      </Button>

      {/* ✅ Latency display overlay */}
      <ConversationLatencyVAD />

      <footer className="fixed bottom-5 left-0 z-20 flex w-full items-center justify-center">
      </footer>
    </section>
  );
};
