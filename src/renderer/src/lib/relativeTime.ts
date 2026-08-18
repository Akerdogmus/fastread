/** Short Turkish relative-time labels for note timestamps, e.g. "az önce", "3 sa önce", "dün". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'az önce'
  if (min < 60) return `${min} dk önce`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} sa önce`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'dün'
  if (day < 7) return `${day} gün önce`
  return new Date(iso).toLocaleDateString('tr-TR')
}
