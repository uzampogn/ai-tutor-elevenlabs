// Reset the conversation back to the Welcome empty state.

export default function NewChat({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="newchat" onClick={onClick}>
      New chat
    </button>
  );
}
