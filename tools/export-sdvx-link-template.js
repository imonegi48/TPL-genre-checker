const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT_DIR, 'raw');
const SONGS_FILE = path.join(ROOT_DIR, 'songs.json');
const LINKS_FILE = path.join(RAW_DIR, 'sdvxindex-links.csv');
const TEMPLATE_FILE = path.join(RAW_DIR, 'sdvxindex-links-template.csv');

function normalizeTitle(title){
  return String(title)
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
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

function csvEscape(value){
  const text = String(value);

  if(/[",\n\r]/.test(text)){
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function loadExistingLinks(){
  const links = new Map();

  if(!fs.existsSync(LINKS_FILE)){
    return links;
  }

  const text = fs.readFileSync(LINKS_FILE, 'utf8').replace(/^\uFEFF/, '');
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

    links.set(makeSongKey(title, levelRaw), url);
  }

  return links;
}

function main(){
  if(!fs.existsSync(SONGS_FILE)){
    console.error('songs.json が見つかりません。先に build-songs-json.js を実行してください。');
    process.exit(1);
  }

  const songs = JSON.parse(fs.readFileSync(SONGS_FILE, 'utf8'));
  const existingLinks = loadExistingLinks();

  const missingSongs = songs.filter(song => {
    const key = makeSongKey(song.title, song.levelRaw);
    return !existingLinks.has(key);
  });

  const lines = [
    'title,levelRaw,url',
    ...missingSongs.map(song => {
      return [
        csvEscape(song.title),
        Number(song.levelRaw).toFixed(1),
        ''
      ].join(',');
    })
  ];

  fs.writeFileSync(TEMPLATE_FILE, lines.join('\n') + '\n', 'utf8');

  console.log(`songs.json: ${songs.length}件`);
  console.log(`登録済みURL: ${existingLinks.size}件`);
  console.log(`未登録URL: ${missingSongs.length}件`);
  console.log(`作成しました: raw/sdvxindex-links-template.csv`);
}

main();