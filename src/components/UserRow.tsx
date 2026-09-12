// The user's question, set as a ruled heading of the passage that answers it —
// no bubble (shape brief §4 anti-goals).

export default function UserRow({ content }: { content: string }) {
  return (
    <div className="row row-user">
      <p className="q">{content}</p>
    </div>
  );
}
