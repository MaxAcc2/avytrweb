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
    <>
      <li
        data-lk-message-origin={messageOrigin}
        title={time.toLocaleTimeString(locale, { timeStyle: 'full' })}
        className={cn('group flex flex-col gap-0', className)}
        {...props}
      >
        {(!hideTimestamp || !hideName || hasBeenEdited) && (
          // ⬇️ make it non-flex so line-height applies, and tag it for tight meta
          <span className="meta-tight text-muted-foreground text-sm block">
            {!hideName && <strong className="font-medium">{name}</strong>}
            {!hideTimestamp && (
              <span className="float-right font-mono text-xs opacity-0 transition-opacity ease-linear group-hover:opacity-100">
                {hasBeenEdited && '*'}
                {time.toLocaleTimeString(locale, { timeStyle: 'short' })}
              </span>
            )}
          </span>
        )}

        {/* ⬇️ the bubble gets a tight wrapper class; px trimmed slightly, py tighter */}
        <span
          className={cn(
            'chat-tight block max-w-4/5 rounded-[20px] px-3 py-1',
            isUser ? 'bg-muted ml-auto' : 'mr-auto'
          )}
        >
          {message}
        </span>
      </li>

      {/* 🔒 Scoped hard overrides that win against anything else */}
      <style jsx>{`
        li[data-lk-message-origin] .chat-tight,
        li[data-lk-message-origin] .chat-tight * {
          line-height: 1.12 !important;       /* very tight */
          margin-top: 0 !important;
          margin-bottom: 0 !important;
        }
        li[data-lk-message-origin] .meta-tight,
        li[data-lk-message-origin] .meta-tight * {
          line-height: 1.12 !important;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
        }
      `}</style>
    </>
  );
};