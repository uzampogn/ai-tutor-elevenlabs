export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  message: Message;
  isTyping?: boolean;
}

export default function MessageBubble({ message, isTyping }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-end gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isUser ? 'bg-slate-600 text-white' : 'bg-purple-600 text-white'
        }`}
      >
        {isUser ? 'You' : 'AI'}
      </div>

      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-purple-600 text-white rounded-br-sm'
            : 'bg-white/10 text-slate-200 rounded-bl-sm'
        }`}
      >
        {isTyping && message.content === '' ? (
          <div className="flex gap-1.5 py-1">
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
      </div>
    </div>
  );
}
