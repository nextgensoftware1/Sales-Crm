import { redirect } from 'next/navigation'

// Sold leads now live as a tab on the Clients page.
export default function SoldLeadsPage() {
  redirect('/clients?tab=sold')
}
