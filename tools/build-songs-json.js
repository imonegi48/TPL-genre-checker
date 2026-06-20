const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT_DIR, 'raw');
const OUT_FILE = path.join(ROOT_DIR, 'songs.json');
const SDVX_LINKS_FILE = path.join(RAW_DIR, 'sdvxindex-links.csv');

const SOURCE_URL = 'https://p.eagate.573.jp/game/bpl/season5/sdvx/about/music/final/list/index.html';

const INPUTS = [
  { file: 'notes.txt', genre: 'notes' },
  { file: 'peak.txt', genre: 'peak' },
  { file: 'one-hand.txt', genre: 'one-hand' },
  { file: 'tsumami.txt', genre: 'tsumami' },
  { file: 'hand-trip.txt', genre: 'hand-trip' },
  { file: 'tricky.txt', genre: 'tricky' },
  { file: 'namco.txt', genre: 'namco' },

  // ジャンルではなく、重複可能なフラグ
  { file: 'popular.txt', popular: true },
  { file: 'special.txt', special: true }
];

const LEVEL_RE = /^(17(?:\.0|\.5)?|18\.[0-9]|19\.[0-9]|20\.[0-9]|17|18|19|20)$/;

function isTargetLevel(levelRaw){
  return levelRaw >= 17.0 && levelRaw < 19.0;
}

function normalizeTitle(title){
  return String(title)
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[‐-‒–—―ー]/g, '-')
    .replace(/[：]/g, ':')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .trim();
}

function cleanLine(line){
  return line
    .replace(/\r/g, '')
    .replace(/^\s*[・●]\s*/, '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim();
}

function makeSongKey(title, levelRaw){
  return `${normalizeTitle(title)}@@${Number(levelRaw).toFixed(1)}`;
}

function parseCsvLine(line){
  const result = [];
  let current = '';
  let inQuotes = false;

  for(let i = 0; i < line.length; i++){
    const char = line[i];
    const next = line[i + 1];

    if(char === '"' && inQuotes && next === '"'){
      current += '"';
      i++;
      continue;
    }

    if(char === '"'){
      inQuotes = !inQuotes;
      continue;
    }

    if(char === ',' && !inQuotes){
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());

  return result;
}

function loadSdvxIndexLinks(){
  const links = new Map();

  if(!fs.existsSync(SDVX_LINKS_FILE)){
    fs.writeFileSync(SDVX_LINKS_FILE, 'title,levelRaw,url\n', 'utf8');
    console.log('作成しました: raw/sdvxindex-links.csv');
    return links;
  }

  const text = fs.readFileSync(SDVX_LINKS_FILE, 'utf8').replace(/^\uFEFF/, '');
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for(const line of lines){
    const [title, levelRawText, url] = parseCsvLine(line);

    if(title === 'title' && levelRawText === 'levelRaw'){
      continue;
    }

    if(!title || !levelRawText || !url){
      continue;
    }

    const levelRaw = Number(levelRawText);

    if(!Number.isFinite(levelRaw)){
      continue;
    }

    const key = makeSongKey(title, levelRaw);

    links.set(key, url);
  }

  console.log(`sdvxindex-links.csv: ${links.size}件`);

  return links;
}

function parseLevel(value){
  const text = cleanLine(value).replace(/^\*\s*/, '').trim();

  if(!LEVEL_RE.test(text)){
    return null;
  }

  return Number(text);
}

function isNoise(line){
  const text = cleanLine(line);

  if(!text){
    return true;
  }

  const upper = text.toUpperCase();

  return [
    'NOTES',
    'PEAK',
    'ONE-HAND',
    'TSUMAMI',
    'HAND-TRIP',
    'TRICKY',
    'NAMCO',
    'POPULAR',
    'SPECIAL',
    '本戦課題曲',
    'FREE',
    'SOUND VOLTEX',
    '課題曲',
    '課題曲（決勝トーナメント）',
    'レギュラーステージ',
    '決勝トーナメント',
    'シングルバトル･タッグバトル',
    'メガミックスバトル',
    '曲名',
    'レベル',
    'LEVEL'
  ].includes(upper) || [
    'トップ',
    'ニュース一覧',
    '大会について',
    '大会スケジュール',
    'ドラフト会議'
  ].includes(text);
}

function parseText(text){
  const lines = text
    .split('\n')
    .map(cleanLine)
    .filter(line => !isNoise(line));

  const records = [];
  let currentLevel = null;

  for(const line of lines){
    const rowMatch = line.match(/^(.+?)\s+(17(?:\.0|\.5)?|18\.[0-9]|19\.[0-9]|20\.[0-9]|17|18|19|20)$/);

    if(rowMatch){
      const title = normalizeTitle(rowMatch[1]);
      const levelRaw = Number(rowMatch[2]);

      if(isTargetLevel(levelRaw)){
        records.push({
          title,
          levelRaw
        });
      }

      continue;
    }

    const levelRaw = parseLevel(line);

    if(levelRaw !== null){
      currentLevel = levelRaw;
      continue;
    }

    if(currentLevel !== null && isTargetLevel(currentLevel)){
      records.push({
        title: normalizeTitle(line),
        levelRaw: currentLevel
      });
    }
  }

  return records;
}

function addRecord(map, record, source, urlMap){
  if(!isTargetLevel(record.levelRaw)){
    return;
  }

  const key = makeSongKey(record.title, record.levelRaw);
  const chartUrl = urlMap.get(key) || '';

  if(!map.has(key)){
    map.set(key, {
      id: 0,
      title: normalizeTitle(record.title),
      genres: [],
      popular: false,
      special: false,
      levelRaw: record.levelRaw,
      url: chartUrl
    });
  }

  const song = map.get(key);

  if(chartUrl){
    song.url = chartUrl;
  }

  if(source.genre && !song.genres.includes(source.genre)){
    song.genres.push(source.genre);
  }

  if(source.popular){
    song.popular = true;
  }

  if(source.special){
    song.special = true;
  }
}

function main(){
  if(!fs.existsSync(RAW_DIR)){
    fs.mkdirSync(RAW_DIR, { recursive: true });
  }

  const urlMap = loadSdvxIndexLinks();
  const songMap = new Map();
  let totalRecords = 0;

  for(const source of INPUTS){
    const filePath = path.join(RAW_DIR, source.file);

    if(!fs.existsSync(filePath)){
      fs.writeFileSync(filePath, '', 'utf8');
      console.log(`作成しました: raw/${source.file}`);
      continue;
    }

    const text = fs.readFileSync(filePath, 'utf8');
    const records = parseText(text);

    totalRecords += records.length;

    console.log(`${source.file}: ${records.length}件`);

    for(const record of records){
      addRecord(songMap, record, source, urlMap);
    }
  }

  if(totalRecords === 0){
    console.log('');
    console.log('raw/*.txt が空です。songs.json は更新しませんでした。');
    console.log('BPLサイトや本戦課題曲リストからテキストを貼り付けて、もう一度実行してください。');
    return;
  }

  const songs = [...songMap.values()]
    .sort((a, b) => {
      if(a.levelRaw !== b.levelRaw){
        return a.levelRaw - b.levelRaw;
      }

      return a.title.localeCompare(b.title, 'ja');
    })
    .map((song, index) => ({
      ...song,
      id: index + 1
    }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(songs, null, 2), 'utf8');

  console.log('');
  console.log(`songs.json を作成しました: ${songs.length}件`);
}

main();