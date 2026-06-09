// Submit button. Disabled when input is empty or a stream is in progress.

import { SendIcon } from '../icons';

export default function SendBtn({ disabled }: { disabled: boolean }) {
  return (
    <button type="submit" className="send-btn" disabled={disabled} aria-label="Send">
      <SendIcon />
    </button>
  );
}
