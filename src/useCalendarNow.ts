import { useEffect, useState } from 'react'
// Refresh estimates across midnight and after a suspended tab resumes, without writes.
export function useCalendarNow() {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString())
    const timer = setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return now
}
