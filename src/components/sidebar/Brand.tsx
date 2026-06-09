// Logo mark with a pulsing accent dot, plus the product name and subtitle.

export default function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <span className="brand-pulse" />
      </div>
      <div>
        <div className="brand-name">AI News Tutor</div>
        <div className="brand-sub">Anthropic blog × voice</div>
      </div>
    </div>
  );
}
