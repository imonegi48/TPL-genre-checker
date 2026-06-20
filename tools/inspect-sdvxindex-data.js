const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'source', 'sdvxindex-data.js');

function loadSdvxIndexData(){
  if(!fs.existsSync(DATA_FILE)){
    console.error('source/sdvxindex-data.js が見つかりません。');
    console.error('https://sdvxindex.com/js/data.js を保存してください。');
    process.exit(1);
  }

  let text = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '').trim();

  text = text
    .replace(/^const\s+songs\s*=\s*/, '')
    .replace(/;\s*$/, '');

  return JSON.parse(text);
}

function main(){
  const songs = loadSdvxIndexData();

  console.log(`songs: ${songs.length}件`);
  console.log('');

  console.log('最初の曲のキー:');
  console.log(Object.keys(songs[0]));
  console.log('');

  console.log('最初の曲の内容サンプル:');
  console.log(JSON.stringify(songs[0], null, 2).slice(0, 3000));
  console.log('');

  const heavenKnows = songs.find(song => {
    return String(song.title).toLowerCase() === 'heaven knows';
  });

  if(heavenKnows){
    console.log('HEAVEN KNOWS が見つかりました:');
    console.log(JSON.stringify(heavenKnows, null, 2).slice(0, 5000));
  }else{
    console.log('HEAVEN KNOWS は見つかりませんでした。');
  }
}

main();