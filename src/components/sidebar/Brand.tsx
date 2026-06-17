// Product name and subtitle. The pulsing brand mark now lives in the top-left
// SidebarToggle (which doubles as the collapse control), so it is not repeated here.

export default function Brand() {
  return (
    <div className="brand">
      <div>
        <div className="brand-name">AI News Tutor</div>
        <div className="brand-sub">Claude blog × voice</div>
      </div>
    </div>
  );
}
