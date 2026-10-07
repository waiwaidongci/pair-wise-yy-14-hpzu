import type { BirdRecord, IssueRule } from '../types'
import { haversineDistance, normalizeRecord, normalizeRingCode, normalizeSpecies } from '../utils/normalization'

export const ISSUE_RULES: IssueRule[] = [
  {
    type: 'ring_invalid',
    severity: 'error',
    label: '环号格式无法归一化',
    description: '环号缺少已知方案前缀、年份或有效序列号。',
    correctionMode: 'automatic',
  },
  {
    type: 'ring_duplicate',
    severity: 'error',
    label: '跨年份重复环号',
    description: '同一归一化环号在多个年度或来源中重复出现。',
    correctionMode: 'manual',
  },
  {
    type: 'species_alias',
    severity: 'warning',
    label: '鸟种使用同义名或俗名',
    description: '记录可匹配统一鸟种库，但原始名称不是规范名称。',
    correctionMode: 'automatic',
  },
  {
    type: 'species_unknown',
    severity: 'review',
    label: '鸟种待分类',
    description: '名称无法匹配现有鸟种库，需要移交人员确认。',
    correctionMode: 'manual',
  },
  {
    type: 'coordinate_invalid',
    severity: 'error',
    label: '坐标格式无效',
    description: '度分秒或十进制度数无法转换为有效经纬度。',
    correctionMode: 'manual',
  },
  {
    type: 'location_jump',
    severity: 'warning',
    label: '同环号地点异常跳变',
    description: '在无法合理解释的时间间隔内，同环号记录距离超过迁徙阈值。',
    correctionMode: 'manual',
  },
]

const SOURCES = ['北戴河春季环志队', '崇明东滩监测站', '鄱阳湖巡护队', '湛江红树林站', '云南会泽夜栖调查']
const LOCATIONS = [
  { name: '北戴河湿地', latitude: 39.83, longitude: 119.52 },
  { name: '崇明东滩', latitude: 31.53, longitude: 121.95 },
  { name: '鄱阳湖吴城', latitude: 29.18, longitude: 116.01 },
  { name: '湛江红树林', latitude: 21.18, longitude: 110.43 },
  { name: '会泽念湖', latitude: 26.63, longitude: 103.31 },
  { name: '盘锦辽河口', latitude: 40.9, longitude: 121.83 },
  { name: '盐城条子泥', latitude: 32.82, longitude: 120.95 },
  { name: '洞庭湖东洲', latitude: 29.23, longitude: 112.82 },
]
const RECORDERS = ['周岚', '陈铖', '宋婉', '罗志远', '叶谦', '韩雨桐', '顾维', '马骁']
const AGES = ['幼鸟', '第一年', '第二年', '成鸟', '未知']
const SEXES = ['雄', '雌', '未知']
const SPECIES = [
  { canonical: '鸿雁', scientificName: 'Anser cygnoides' },
  { canonical: '白鹤', scientificName: 'Leucogeranus leucogeranus' },
  { canonical: '东方白鹳', scientificName: 'Ciconia boyciana' },
  { canonical: '黑脸琵鹭', scientificName: 'Platalea minor' },
  { canonical: '丹顶鹤', scientificName: 'Grus japonensis' },
  { canonical: '青头潜鸭', scientificName: 'Aythya baeri' },
  { canonical: '黄胸鹀', scientificName: 'Emberiza aureola' },
  { canonical: '勺嘴鹬', scientificName: 'Calidris pygmaea' },
  { canonical: '遗鸥', scientificName: 'Ichthyaetus relictus' },
  { canonical: '中华秋沙鸭', scientificName: 'Mergus squamatus' },
]
const SYNONYMS: Record<string, string[]> = {
  鸿雁: ['大雁', 'Chinese Goose'],
  白鹤: ['西伯利亚白鹤', 'Grus leucogeranus'],
  东方白鹳: ['白鹳'],
  黑脸琵鹭: ['黑面琵鹭', '饭匙鸟'],
  丹顶鹤: ['仙鹤', 'Red-crowned Crane'],
  青头潜鸭: ['青头鸭', 'Baer Pochard'],
  黄胸鹀: ['禾花雀', '黄胆'],
  勺嘴鹬: ['匙嘴鹬', 'Eurynorhynchus pygmeus'],
  遗鸥: ['Larus relictus', 'Relict Gull'],
  中华秋沙鸭: ['鳞胁秋沙鸭'],
}
const RING_PREFIXES = ['BJ', '沪环', 'GD', 'YN', '环志']

function formatDms(value: number, kind: 'latitude' | 'longitude') {
  const direction = kind === 'latitude' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  const absolute = Math.abs(value)
  const degrees = Math.floor(absolute)
  const minuteFloat = (absolute - degrees) * 60
  const minutes = Math.floor(minuteFloat)
  const seconds = Number(((minuteFloat - minutes) * 60).toFixed(1))
  return `${degrees}°${String(minutes).padStart(2, '0')}′${seconds}″${direction}`
}

function createRing(index: number, year: number) {
  const prefix = RING_PREFIXES[index % RING_PREFIXES.length]
  const serial = String(((index * 37 + year) % 99999) + 1).padStart(5, '0')
  if (index % 173 === 0) return `${prefix}${year}${String(serial).slice(-3)}`
  if (index % 131 === 0) return `未知-${year}-${serial}`
  if (prefix === '沪环') return `沪环 ${year} ${serial}`
  return `${prefix}-${year}-${serial}`
}

function observationDate(index: number) {
  const date = new Date(Date.UTC(2018 + (index % 9), 0, 1))
  date.setUTCDate(1 + ((index * 11) % 330))
  return date
}

export function createMockRecords(count = 4200): BirdRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = (index * 7) % SOURCES.length
    const crossYearDuplicate = index > 600 && index % 347 === 0
    const locationJumpDuplicate = index > 500 && index % 509 === 0
    const ringIndex = crossYearDuplicate
      ? index - 337
      : locationJumpDuplicate
        ? index - 1
        : index
    const ringYear = 2018 + (ringIndex % 9)
    const date = locationJumpDuplicate ? observationDate(index - 1) : observationDate(index)
    if (locationJumpDuplicate) date.setUTCDate(date.getUTCDate() + 3)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    const previousLocationIndex =
      ((index - 1) * 11 + Math.floor((index - 1) / 97)) % LOCATIONS.length
    const locationIndex = locationJumpDuplicate
      ? (previousLocationIndex + 4) % LOCATIONS.length
      : (index * 11 + Math.floor(index / 97)) % LOCATIONS.length
    const location = LOCATIONS[locationIndex]
    const species = SPECIES[(index * 13) % SPECIES.length]
    const synonyms = SYNONYMS[species.canonical] || []
    const speciesRaw =
      index % 43 === 0 && synonyms.length
        ? synonyms[index % synonyms.length]
        : index % 617 === 0
          ? '待鉴定鸥类'
          : species.canonical

    let latitude = location.latitude + ((index % 13) - 6) * 0.002
    let longitude = location.longitude + ((index % 17) - 8) * 0.002
    if (index % 389 === 0) {
      latitude = latitude > 30 ? 22.47 : 44.76
      longitude = longitude > 115 ? 114.06 : 126.61
    }
    const latitudeRaw =
      index % 3 === 0
        ? formatDms(latitude, 'latitude')
        : `${latitude.toFixed(5)}`
    const longitudeRaw =
      index % 4 === 0
        ? formatDms(longitude, 'longitude')
        : `${longitude.toFixed(5)}`

    const record: BirdRecord = {
      id: `REC-${String(index + 1).padStart(6, '0')}`,
      source: SOURCES[sourceIndex],
      sourceFile: `${year}_${SOURCES[sourceIndex].slice(0, 2)}_${String(Math.floor(index / 180) + 1).padStart(2, '0')}.xlsx`,
      rawRingCode: createRing(ringIndex, ringYear),
      normalizedRingCode: '',
      ringScheme: '',
      speciesRaw,
      speciesCanonical: '',
      scientificName: '',
      observedAt: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(index % 24).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
      location: location.name,
      latitudeRaw: index % 997 === 0 ? '北纬 999°' : latitudeRaw,
      longitudeRaw: index % 1249 === 0 ? '--' : longitudeRaw,
      latitude: null,
      longitude: null,
      recorder: RECORDERS[(index * 5) % RECORDERS.length],
      ageCode: AGES[(index * 3) % AGES.length],
      sex: SEXES[(index * 7) % SEXES.length],
      remarks: index % 71 === 0 ? '原始表格含合并单元格，已按观察日期拆分。' : '',
    }
    return normalizeRecord(record)
  })
}

export function getLocationDistance(record: BirdRecord, previous: BirdRecord) {
  if (
    record.latitude === null ||
    record.longitude === null ||
    previous.latitude === null ||
    previous.longitude === null
  ) {
    return null
  }
  return haversineDistance(
    record.latitude,
    record.longitude,
    previous.latitude,
    previous.longitude,
  )
}

export function inspectSourceRecord(raw: Partial<BirdRecord>) {
  const ring = normalizeRingCode(String(raw.rawRingCode || ''))
  const species = normalizeSpecies(String(raw.speciesRaw || ''))
  return { ring, species }
}
