const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT_DIR, 'raw');
const SONGS_FILE = path.join(ROOT_DIR, 'songs.json');
const SDVX_DATA_FILE = path.join(ROOT_DIR, 'source', 'sdvxindex-data.js');

const EXISTING_LINKS_FILE = path.join(RAW_DIR, 'sdvxindex-links.csv');
const AUTO_LINKS_FILE = path.join(RAW_DIR, 'sdvxindex-links-auto.csv');
const UNRESOLVED_FILE = path.join(RAW_DIR, 'sdvxindex-links-unresolved.csv');

const SDVX_INDEX_BASE_URL = 'https://sdvxindex.com';

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

function makeSongKey(title, levelRaw){
  return `${normalizeTitle(title)}@@${Number(levelRaw).toFixed(1)}`;
}

function makeTitleKey(title){
  return normalizeTitle(title).toLowerCase();
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

function csvEscape(value){
  const text = String(value ?? '');

  if(/[",\n\r]/.test(text)){
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function loadSdvxIndexData(){
  if(!fs.existsSync(SDVX_DATA_FILE)){
    console.error('source/sdvxindex-data.js が見つかりません。');
    console.error('先に https://sdvxindex.com/js/data.js を source/sdvxindex-data.js として保存してください。');
    process.exit(1);
  }

  const bytes = fs.readFileSync(SDVX_DATA_FILE);

  let text = new TextDecoder('utf-8').decode(bytes);
  let brokenCount = (text.match(/\uFFFD/g) || []).length;

  if(brokenCount > 20){
    try{
      const shiftJisText = new TextDecoder('shift_jis').decode(bytes);
      const shiftJisBrokenCount = (shiftJisText.match(/\uFFFD/g) || []).length;

      if(shiftJisBrokenCount < brokenCount){
        text = shiftJisText;
      }
    }catch(err){
      // shift_jis が使えない環境なら utf-8 のまま続行
    }
  }

  text = text.replace(/^\uFEFF/, '').trim();

  text = text
    .replace(/^const\s+songs\s*=\s*/, '')
    .replace(/;\s*$/, '');

  return JSON.parse(text);
}

function loadExistingLinks(){
  const links = new Map();

  if(!fs.existsSync(EXISTING_LINKS_FILE)){
    return links;
  }

  const text = fs.readFileSync(EXISTING_LINKS_FILE, 'utf8').replace(/^\uFEFF/, '');
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

    links.set(key, {
      title: normalizeTitle(title),
      levelRaw,
      url
    });
  }

  return links;
}

function buildSdvxTitleMap(sdvxSongs){
  const map = new Map();

  for(const song of sdvxSongs){
    const key = makeTitleKey(song.title);

    if(!map.has(key)){
      map.set(key, []);
    }

    map.get(key).push(song);
  }

  return map;
}

function getDifficultyNumber(difficulty){
  const imagePath = String(difficulty.imagePath || '');
  const match = imagePath.match(/_(\d+)[a-z]+_cmod_rendered\.png$/i);

  if(match){
    return match[1];
  }

  return null;
}

function findSdvxIndexUrl(song, sdvxTitleMap){
  const titleKey = makeTitleKey(song.title);
  const sdvxSongs = sdvxTitleMap.get(titleKey) || [];

  const targetIntegerLevel = Math.floor(Number(song.levelRaw));
  const candidates = [];

  for(const sdvxSong of sdvxSongs){
    for(const difficulty of sdvxSong.difficulties || []){
      const diffLevel = Number(difficulty.level);

      if(diffLevel !== targetIntegerLevel){
        continue;
      }

      const difficultyNumber = getDifficultyNumber(difficulty);

      if(!difficultyNumber){
        continue;
      }

      candidates.push({
        url: `${SDVX_INDEX_BASE_URL}/s/${sdvxSong.songid}/${difficultyNumber}/`,
        songid: sdvxSong.songid,
        title: sdvxSong.title,
        type: difficulty.type,
        level: difficulty.level
      });
    }
  }

  const uniqueCandidates = [];

  for(const candidate of candidates){
    if(!uniqueCandidates.some(x => x.url === candidate.url)){
      uniqueCandidates.push(candidate);
    }
  }

  return uniqueCandidates;
}

function main(){
  if(!fs.existsSync(SONGS_FILE)){
    console.error('songs.json が見つかりません。先に build-songs-json.js を実行してください。');
    process.exit(1);
  }

  const songs = JSON.parse(fs.readFileSync(SONGS_FILE, 'utf8'));
  const sdvxSongs = loadSdvxIndexData();
  const sdvxTitleMap = buildSdvxTitleMap(sdvxSongs);
  const existingLinks = loadExistingLinks();

  const resolvedRows = [];
  const unresolvedRows = [];

  let existingCount = 0;
  let autoResolvedCount = 0;
  let ambiguousCount = 0;
  let notFoundCount = 0;

  for(const song of songs){
    const key = makeSongKey(song.title, song.levelRaw);

    if(existingLinks.has(key)){
      const existing = existingLinks.get(key);

      resolvedRows.push({
        title: existing.title,
        levelRaw: existing.levelRaw,
        url: existing.url
      });

      existingCount++;
      continue;
    }

    const candidates = findSdvxIndexUrl(song, sdvxTitleMap);

    if(candidates.length === 1){
      resolvedRows.push({
        title: normalizeTitle(song.title),
        levelRaw: Number(song.levelRaw),
        url: candidates[0].url
      });

      autoResolvedCount++;
      continue;
    }

    if(candidates.length === 0){
      unresolvedRows.push({
        title: normalizeTitle(song.title),
        levelRaw: Number(song.levelRaw),
        reason: 'not_found',
        candidates: ''
      });

      notFoundCount++;
      continue;
    }

    unresolvedRows.push({
      title: normalizeTitle(song.title),
      levelRaw: Number(song.levelRaw),
      reason: 'ambiguous',
      candidates: candidates.map(candidate => {
        return `${candidate.type}:${candidate.level}:${candidate.url}`;
      }).join(' | ')
    });

    ambiguousCount++;
  }

  const resolvedLines = [
    'title,levelRaw,url',
    ...resolvedRows.map(row => {
      return [
        csvEscape(row.title),
        Number(row.levelRaw).toFixed(1),
        csvEscape(row.url)
      ].join(',');
    })
  ];

  const unresolvedLines = [
    'title,levelRaw,reason,candidates',
    ...unresolvedRows.map(row => {
      return [
        csvEscape(row.title),
        Number(row.levelRaw).toFixed(1),
        csvEscape(row.reason),
        csvEscape(row.candidates)
      ].join(',');
    })
  ];

  fs.writeFileSync(AUTO_LINKS_FILE, resolvedLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(UNRESOLVED_FILE, unresolvedLines.join('\n') + '\n', 'utf8');

  console.log(`songs.json: ${songs.length}件`);
  console.log(`SDVX Index data: ${sdvxSongs.length}曲`);
  console.log(`既存URL: ${existingCount}件`);
  console.log(`自動解決: ${autoResolvedCount}件`);
  console.log(`未解決: ${notFoundCount}件`);
  console.log(`あいまい: ${ambiguousCount}件`);
  console.log('');
  console.log(`作成しました: raw/sdvxindex-links-auto.csv`);
  console.log(`作成しました: raw/sdvxindex-links-unresolved.csv`);
}

main();