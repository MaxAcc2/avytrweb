import * as React from 'react';
import type { MessageFormatter, ReceivedChatMessage } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { useChatMessage } from './hooks/utils';

export interface ChatEntryProps extends React.HTMLAttributes<HTMLLIElement> {
  entry: ReceivedChatMessage;
  hideName?: boolean;
  hideTimestamp?: boolean;
  messageFormatter?: MessageFormatter;
}

export const ChatEntry = ({
  entry,
  messageFormatter,
  hideName,
  className,
  ...props
}: ChatEntryProps) => {
  const { message, locale, name } = useChatMessage(entry, messageFormatter);
  const isUser = entry.from?.isLocal ?? false;
  const messageOrigin = isUser ? 'remote' : 'local';

  return (
    <li
      data-lk-message-origin={messageOrigin}
      className={cn('group flex flex-col gap-0', className)}
      {...props}
    >
      {/* optional name */}
      {!hideName && (
        <span className="text-muted-foreground text-sm leading-tight block">
          <strong className="font-medium">{name}</strong>
        </span>
      )}

      {/* Chat bubble */}
      <span
        className={cn(
          'block max-w-4/5 rounded-[20px] px-3 py-1 leading-tight text-sm',
          // 👇 style differences for user vs. agent
          isUser
            ? 'bg-blue-600 text-white ml-auto'     // what YOU say
            : 'bg-muted text-foreground mr-auto'   // what the AGENT says
        )}
      >
        {message}
      </span>
    </li>
  );
};