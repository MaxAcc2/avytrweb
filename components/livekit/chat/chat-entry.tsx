import * as React from 'react';
import type { MessageFormatter, ReceivedChatMessage } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { useChatMessage } from './hooks/utils';

export interface ChatEntryProps extends React.HTMLAttributes<HTMLLIElement> {
  /** The chat message object to display. */
  entry: ReceivedChatMessage;
  /** Hide sender name. Useful when displaying multiple consecutive chat messages from the same person. */
  hideName?: boolean;
  /** Hide message timestamp. */
  hideTimestamp?: boolean;
  /** An optional formatter for the message body. */
  messageFormatter?: MessageFormatter;
}

export const ChatEntry = ({
  entry,
  messageFormatter,
  hideName,
  hideTimestamp,
  className,
  ...props
}: ChatEntryProps) => {
  const { message, hasBeenEdited, time, locale, name } = useChatMessage(entry, messageFormatter);

  const isUser = entry.from?.isLocal ?? false;
  const messageOrigin = isUser ? 'remote' : 'local';

  return (
    <li
      data-lk-message-origin={messageOrigin}
      title={time.toLocaleTimeString(locale, { timeStyle: 'full' })}
      className={cn('group flex flex-col !gap-0', className)}
      {...props}
    >
      {(!hideTimestamp || !hideName || hasBeenEdited) && (
        <span
          className="text-muted-foreground flex text-sm"
          style={{ lineHeight: 1.15, marginTop: 0, marginBottom: 0 }}
        >
          {!hideName && <strong className="font-medium">{name}</strong>}

          {!hideTimestamp && (
            <span className="align-self-end ml-auto font-mono text-xs opacity-0 transition-opacity ease-linear group-hover:opacity-100">
              {hasBeenEdited && '*'}
              {time.toLocaleTimeString(locale, { timeStyle: 'short' })}
            </span>
          )}
        </span>
      )}

      <span
        className={cn(
          // block + smaller vertical padding; keep decent horizontal padding
          'block max-w-4/5 rounded-[20px] px-3 py-1 whitespace-pre-line',
          isUser ? 'bg-muted ml-auto' : 'mr-auto'
        )}
        // 🔒 Hard override line-height so it can’t be reset elsewhere
        style={{ lineHeight: 1.15, marginTop: 0, marginBottom: 0 }}
      >
        {message}
      </span>
    </li>
  );
};