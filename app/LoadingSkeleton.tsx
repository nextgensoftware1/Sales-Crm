import styles from './loading-skeleton.module.css'
import BrandLogo from './BrandLogo'

type Props = { title?: string; detail?: boolean }

function Fields({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <div className={styles.field} key={i}>
      <div className={styles.block} />
      <div className={styles.block} />
    </div>
  ))
}

function DetailPlaceholder() {
  return (
    <div className={styles.detail}>
      <div className={styles.card}>
        <div className={styles.block} />
        <Fields count={5} />
      </div>
      <div className={styles.card}>
        <div className={styles.block} />
        <div className={`${styles.block} ${styles.textarea}`} />
        <div className={styles.fields}><Fields count={4} /></div>
      </div>
    </div>
  )
}

function TablePlaceholder() {
  return (
    <div className={styles.table}>
      <div className={styles.toolbar}>
        <div className={styles.block} />
        <div className={styles.block} />
      </div>
      {Array.from({ length: 7 }, (_, i) => (
        <div className={styles.row} key={i}>
          {[0, 1, 2, 3].map(j => <div className={styles.block} key={j} />)}
        </div>
      ))}
    </div>
  )
}

export default function LoadingSkeleton({ title = 'Loading your workspace', detail = false }: Props) {
  return (
    <div className={styles.shell} aria-busy="true">
      <aside className={styles.sidebar} aria-hidden="true">
        <div className={styles.brand}>
          <BrandLogo className="sidebar-logo" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div className={styles.nav} key={i}>
            <i className={styles.block} /><span className={styles.block} />
          </div>
        ))}
        <div className={styles.sidebarFoot}><div className={styles.block} /></div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <span>Hired Billing Support</span>
          <span className={styles.status} role="status">
            <i className={styles.spinner} aria-hidden="true" />{title}…
          </span>
        </header>
        <div className={styles.content} aria-hidden="true">
          <div className={styles.heading}>
            <div className={styles.block} /><div className={styles.block} />
          </div>
          <div className={styles.stats}>
            {[0, 1, 2].map(i => (
              <div className={styles.card} key={i}>
                <div className={styles.block} />
                <div className={`${styles.block} ${styles.value}`} />
                <div className={styles.block} />
              </div>
            ))}
          </div>
          {detail ? <DetailPlaceholder /> : <TablePlaceholder />}
        </div>
      </main>
    </div>
  )
}
