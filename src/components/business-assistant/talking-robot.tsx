/** Decorative talking animation; the enclosing button provides its accessible name. */
export function TalkingRobot() {
  return (
    <svg className="assistant-robot" viewBox="0 0 64 64" width="54" height="54" fill="none" aria-hidden="true" focusable="false">
      <circle className="assistant-robot-halo" cx="32" cy="32" r="29" />
      <g className="assistant-robot-head">
        <path className="assistant-robot-antenna" d="M32 12v6" />
        <circle className="assistant-robot-light" cx="32" cy="9" r="3" />
        <rect className="assistant-robot-ear" x="7" y="28" width="5" height="13" rx="2.5" />
        <rect className="assistant-robot-ear" x="52" y="28" width="5" height="13" rx="2.5" />
        <rect className="assistant-robot-shell" x="12" y="17" width="40" height="35" rx="12" />
        <rect className="assistant-robot-face" x="17" y="22" width="30" height="24" rx="8" />
        <g className="assistant-robot-eyes">
          <rect x="23" y="28" width="5" height="5" rx="2.5" />
          <rect x="36" y="28" width="5" height="5" rx="2.5" />
        </g>
        <g className="assistant-robot-voice">
          <rect x="23" y="39" width="2" height="3" rx="1" />
          <rect x="27" y="37" width="2" height="7" rx="1" />
          <rect x="31" y="36" width="2" height="9" rx="1" />
          <rect x="35" y="37" width="2" height="7" rx="1" />
          <rect x="39" y="39" width="2" height="3" rx="1" />
        </g>
        <path className="assistant-robot-highlight" d="M21 19.5h11" />
      </g>
    </svg>
  );
}
