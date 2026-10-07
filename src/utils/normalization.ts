import type { BirdRecord, RingScheme, SpeciesRule } from '../types'

export const SPECIES_RULES: SpeciesRule[] = [
  {
    canonical: '鸿雁',
    scientificName: 'Anser cygnoides',
    aliases: ['大雁', '鸿雁（东亚亚种）', 'Anser cygnoid', 'Chinese Goose'],
  },
  {
    canonical: '白鹤',
    scientificName: 'Leucogeranus leucogeranus',
    aliases: ['西伯利亚白鹤', '白鹤 Siberian Crane', 'Grus leucogeranus'],
  },
  {
    canonical: '东方白鹳',
    scientificName: 'Ciconia boyciana',
    aliases: ['白鹳', '东方白鹳（东北种群）', 'Japanese White Stork'],
  },
  {
    canonical: '黑脸琵鹭',
    scientificName: 'Platalea minor',
    aliases: ['黑面琵鹭', '饭匙鸟', 'Black-faced Spoonbill'],
  },
  {
    canonical: '丹顶鹤',
    scientificName: 'Grus japonensis',
    aliases: ['仙鹤', '红顶鹤', 'Red-crowned Crane'],
  },
  {
    canonical: '青头潜鸭',
    scientificName: 'Aythya baeri',
    aliases: ['青头鸭', 'Baer’s Pochard', 'Baer Pochard'],
  },
  {
    canonical: '黄胸鹀',
    scientificName: 'Emberiza aureola',
    aliases: ['黄胆', '禾花雀', 'Yellow-breasted Bunting'],
  },
  {
    canonical: '勺嘴鹬',
    scientificName: 'Calidris pygmaea',
    aliases: ['匙嘴鹬', 'Spoon-billed Sandpiper', 'Eurynorhynchus pygmeus'],
  },
  {
    canonical: '遗鸥',
    scientificName: 'Ichthyaetus relictus',
    aliases: ['遗鸥（蒙古种群）', 'Relict Gull', 'Larus relictus'],
  },
  {
    canonical: '中华秋沙鸭',
    scientificName: 'Mergus squamatus',
    aliases: ['鳞胁秋沙鸭', 'Scaly-sided Merganser'],
  },
]

export const RING_SCHEMES: RingScheme[] = [
  { prefix: 'BJ', normalizedPrefix: 'BJ', organization: '北京环志站', pattern: 'BJ-年份-序列号' },
  { prefix: '沪环', normalizedPrefix: 'SH', organization: '上海环志协作组', pattern: '沪环 年份 序列号' },
  { prefix: 'GD', normalizedPrefix: 'GD', organization: '广东鸟类环志中心', pattern: 'GD年份序列号' },
  { prefix: 'YN', normalizedPrefix: 'YN', organization: '云南湿地环志站', pattern: 'YN-年份-序列号' },
  { prefix: '环志', normalizedPrefix: 'CN', organization: '全国环志中心旧制', pattern: '环志年份序列号' },
]

const SPECIES_LOOKUP = new Map<string, SpeciesRule>()

for (const rule of SPECIES_RULES) {
  SPECIES_LOOKUP.set(rule.canonical.toLowerCase(), rule)
  SPECIES_LOOKUP.set(rule.scientificName.toLowerCase(), rule)
  rule.aliases.forEach((alias) => SPECIES_LOOKUP.set(alias.toLowerCase(), rule))
}

export interface NormalizedRing {
  original: string
  normalized: string
  normalizedPrefix: string
  scheme: string
  organization: string
  year: string | null
  serial: string | null
  valid: boolean
}

export function normalizeRingCode(input: string): NormalizedRing {
  const original = input.trim()
  const compact = original
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9-]/g, '')
    .toUpperCase()
  const scheme = RING_SCHEMES.find((item) => compact.startsWith(item.prefix.toUpperCase()))
  const prefix = scheme?.normalizedPrefix ?? ''
  const withoutPrefix = scheme ? compact.slice(scheme.prefix.length) : compact
  const digits = withoutPrefix.replace(/[^0-9]/g, '')
  let year: string | null = null
  let serial: string | null = null

  if (digits.length >= 8) {
    year = digits.slice(0, 4)
    serial = digits.slice(4).padStart(5, '0')
  } else if (digits.length >= 6) {
    const firstFour = Number(digits.slice(0, 4))
    if (firstFour >= 1990 && firstFour <= 2035) {
      year = digits.slice(0, 4)
      serial = digits.slice(4).padStart(5, '0')
    } else {
      year = String(2000 + Number(digits.slice(0, 2)))
      serial = digits.slice(2).padStart(5, '0')
    }
  }

  const plausibleYear = year !== null && Number(year) >= 1990 && Number(year) <= 2035
  return {
    original,
    normalizedPrefix: prefix,
    normalized: scheme && plausibleYear && serial ? `${prefix}-${year}-${serial}` : compact,
    scheme: scheme?.organization ?? '未知环志方案',
    organization: scheme?.organization ?? '待区域中心识别',
    year: plausibleYear ? year : null,
    serial,
    valid: Boolean(scheme && plausibleYear && serial && serial !== '00000'),
  }
}

export function normalizeSpecies(input: string) {
  const cleaned = input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[?？]+/, '')
    .replace(/[（(](?:暂定|待核|sp\.?|cf\.?)[）)]$/i, '')
  const direct = SPECIES_LOOKUP.get(cleaned.toLowerCase())
  if (direct) {
    return {
      matched: true,
      exact: direct.canonical === cleaned,
      canonical: direct.canonical,
      scientificName: direct.scientificName,
    }
  }

  const fuzzy = SPECIES_RULES.find(
    (rule) =>
      cleaned.includes(rule.canonical) ||
      rule.scientificName.toLowerCase().includes(cleaned.toLowerCase()) ||
      rule.aliases.some((alias) => alias.includes(cleaned) || cleaned.includes(alias)),
  )
  if (fuzzy) {
    return {
      matched: true,
      exact: false,
      canonical: fuzzy.canonical,
      scientificName: fuzzy.scientificName,
    }
  }
  return { matched: false, exact: false, canonical: cleaned, scientificName: '待鉴定' }
}

export function parseCoordinate(input: string, kind: 'latitude' | 'longitude'): number | null {
  const text = input.trim().replace(/[，]/g, '.').replace(/\s+/g, '')
  const decimal = Number(text.replace(/[°NSEW]/gi, ''))
  if (!Number.isNaN(decimal) && /^\d+(?:\.\d+)?[°]?[NSEW]?$/i.test(text)) {
    const signed = /[SW]/i.test(text) ? -Math.abs(decimal) : decimal
    if (kind === 'latitude' && Math.abs(signed) <= 90) return Number(signed.toFixed(6))
    if (kind === 'longitude' && Math.abs(signed) <= 180) return Number(signed.toFixed(6))
  }

  const match = text.match(/^([NSEW])?(\d{1,3})[°:d](?:(\d{1,2})[′':m])?(?:(\d+(?:\.\d+)?)[″":s])?([NSEW])?$/i)
  if (!match) return null
  const hemisphere = (match[1] || match[5] || '').toUpperCase()
  const degrees = Number(match[2])
  const minutes = Number(match[3] || 0)
  const seconds = Number(match[4] || 0)
  if (minutes >= 60 || seconds >= 60) return null
  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
  const value = sign * (degrees + minutes / 60 + seconds / 3600)
  if (kind === 'latitude' && Math.abs(value) <= 90) return Number(value.toFixed(6))
  if (kind === 'longitude' && Math.abs(value) <= 180) return Number(value.toFixed(6))
  return null
}

export function haversineDistance(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const radius = 6371
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLatitude = toRadians(latitudeB - latitudeA)
  const deltaLongitude = toRadians(longitudeB - longitudeA)
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(a))
}

export function normalizeRecord(record: BirdRecord): BirdRecord {
  const ring = normalizeRingCode(record.rawRingCode)
  const species = normalizeSpecies(record.speciesRaw)
  return {
    ...record,
    normalizedRingCode: ring.normalized,
    ringScheme: ring.scheme,
    speciesCanonical: species.canonical,
    scientificName: species.scientificName,
    latitude: parseCoordinate(record.latitudeRaw, 'latitude'),
    longitude: parseCoordinate(record.longitudeRaw, 'longitude'),
  }
}
