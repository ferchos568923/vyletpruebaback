const DIAS = [
  { id: 1, corto: 'Lun', largo: 'Lunes' },
  { id: 2, corto: 'Mar', largo: 'Martes' },
  { id: 3, corto: 'Mié', largo: 'Miércoles' },
  { id: 4, corto: 'Jue', largo: 'Jueves' },
  { id: 5, corto: 'Vie', largo: 'Viernes' },
  { id: 6, corto: 'Sáb', largo: 'Sábado' },
  { id: 7, corto: 'Dom', largo: 'Domingo' },
]

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const LARGOS: Record<string, number> = {}
for (const d of DIAS) LARGOS[normalizar(d.largo)] = d.id
const CORTOS: Record<string, number> = {}
for (const d of DIAS) CORTOS[normalizar(d.corto)] = d.id

const normalizarHora = (t: string): string => {
  const limpio = (t ?? '').trim()
  if (!limpio) return ''
  if (limpio.includes(':')) {
    const [h, m] = limpio.split(':')
    const hh = String(Number(h) || 0).padStart(2, '0')
    const mm = m ? String(Number(m) || 0).padStart(2, '0') : '00'
    if (Number(hh) > 23 || Number(mm) > 59) return ''
    return `${hh}:${mm}`
  }
  const n = Number(limpio)
  if (Number.isNaN(n) || n < 0 || n > 23.75) return ''
  const hh = Math.floor(n)
  const mm = Math.round((n - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Devuelve 'abierto' | 'cerrado' según el horario de la sucursal en un momento dado.
// Sin horario configurado = 'cerrado'. "hasta" puede cruzar medianoche (ej. 22:00-02:00).
export function estadoAbierto(horario?: string | null, momento?: Date): 'abierto' | 'cerrado' {
  if (!horario || !horario.trim()) return 'cerrado'

  const horarios = DIAS.map((d) => ({ id: d.id, abierto: false, desde: '', hasta: '' }))
  for (const parte of horario.split(';')) {
    const p = parte.trim()
    if (!p) continue
    const idx = p.indexOf(':')
    const nombre = (idx === -1 ? p : p.slice(0, idx)).trim()
    const id = LARGOS[normalizar(nombre)]
    if (!id) continue
    const rango = (idx === -1 ? '' : p.slice(idx + 1)).trim()
    const [desde, hasta] = rango.split('-')
    const d = horarios.find((x) => x.id === id)
    if (d) {
      d.abierto = true
      d.desde = normalizarHora(desde?.trim() || '09:00') || '09:00'
      d.hasta = normalizarHora(hasta?.trim() || '18:00') || '18:00'
    }
  }

  const ahora = momento ?? new Date()
  const jsDay = ahora.getDay()
  const hoy = jsDay === 0 ? 7 : jsDay
  const d = horarios.find((x) => x.id === hoy)
  if (!d || !d.abierto) return 'cerrado'

  const min = ahora.getHours() * 60 + ahora.getMinutes()
  const [dh, dm] = d.desde.split(':').map(Number)
  const [hh, hm] = d.hasta.split(':').map(Number)
  const desdeMin = dh * 60 + dm
  const hastaMin = hh * 60 + hm

  if (hastaMin < desdeMin) {
    return min >= desdeMin || min <= hastaMin ? 'abierto' : 'cerrado'
  }
  return min >= desdeMin && min <= hastaMin ? 'abierto' : 'cerrado'
}