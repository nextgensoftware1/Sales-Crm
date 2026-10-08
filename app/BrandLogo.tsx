import Image from 'next/image'
import logo from '../public/logo.png'

/** Displays the supplied brand artwork without altering the source image. */
export default function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`}>
      <Image src={logo} alt="Hired Billing Support" sizes="(max-width: 600px) 280px, 320px" />
    </span>
  )
}
