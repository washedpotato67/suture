interface FlapTextProps {
  text: string;
  className?: string;
}

/**
 * Posted split-flap text: each character sits in its own hinged cell and the
 * row cascades in sequence whenever the value changes (re-keyed by content).
 * Words stay intact — the board breaks lines between words, never mid-word.
 * Honors prefers-reduced-motion via CSS (cells render instantly).
 */
export function FlapText({ text, className }: FlapTextProps) {
  let charIndex = 0;
  return (
    <span className={`flap-text ${className ?? ""}`} aria-label={text} role="img" key={text}>
      {text.split(" ").map((word, wordIndex) => (
        <span key={`${wordIndex}-${word}`} className="flap-word" aria-hidden="true">
          {word.split("").map((char) => {
            const delay = charIndex++ * 38;
            return (
              <span key={`${charIndex}-${char}`} className="flap-char" style={{ animationDelay: `${delay}ms` }}>
                {char}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}
