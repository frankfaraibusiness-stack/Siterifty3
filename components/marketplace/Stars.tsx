// Ports mpStars exactly: filled/half/empty 5-star display + a count.
export default function Stars({ rating, count }: { rating: number; count: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  const Star = ({ filled }: { filled: boolean }) => (
    <svg
      className={`mp-star${filled ? " on" : ""}`}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );

  return (
    <>
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f${i}`} filled />
      ))}
      {Array.from({ length: half }).map((_, i) => (
        <Star key={`h${i}`} filled />
      ))}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e${i}`} filled={false} />
      ))}
      <span className="mp-star-count">({count})</span>
    </>
  );
}
