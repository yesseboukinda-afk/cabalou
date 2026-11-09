export function DotSpinner({ className = "" }: { className?: string }) {
  return <span className={`dot-spinner ${className}`.trim()} aria-hidden="true">
    {Array.from({ length: 8 }, (_, index) => <span className="dot-spinner__dot" key={index} aria-hidden="true" />)}
  </span>;
}
