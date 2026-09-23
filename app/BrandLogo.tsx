/** Displays the supplied brand artwork without altering the source image. */
export default function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`}>
      <img src="/brand-logo.png" alt="Hired Billing Support" width={1800} height={900} />
    </span>
  )
}
