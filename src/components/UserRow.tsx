// Right-aligned user message bubble.

export default function UserRow({ content }: { content: string }) {
  return (
    <div className="row row-user">
      <div className="bubble-user">{content}</div>
    </div>
  );
}
