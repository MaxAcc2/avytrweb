import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Image from 'next/image'; // <-- THE FIX IS HERE

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
        src="/avatar.png" // The image must be in your `/public` folder
        alt="A description of your image"
        width={340}
        height={500}
      />

      {/*<p className="text-fg1 max-w-prose pt-1 leading-6 font-medium">
        Chat live with your voice AI agent
      </p>*/}
      <Button variant="primary" size="lg" onClick={onStartCall} className="mt-6 w-64 font-mono">
        Start
      </Button>
      <footer className="fixed bottom-5 left-0 z-20 flex w-full items-center justify-center">
         {/*<p className="text-fg1 max-w-prose pt-1 text-xs leading-5 font-normal text-pretty md:text-sm">
          Need help getting set up? Check out the{' '}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://docs.livekit.io/agents/start/voice-ai/"
            className="underline"
          >
            Voice AI quickstart
          </a>
          .
        </p>*/}
      </footer>
    </section>
  );
};
