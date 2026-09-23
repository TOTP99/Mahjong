// 你的这张牌会不会点炮给某个 AI：等价于「该 AI 的听牌列表里有这张牌」。
// 原先每张牌、每次渲染都要对三家各跑一次完整 checkHu；改用带缓存的 getWinningTilesOf，
// 结果一致（getWinningTilesOf 要求暗牌张数=完整手牌-1，与 checkHu([...手牌, tile]) 的张数要求相同），
// 同一副手牌命中缓存后不再重复计算。
function isDangerousTile(tile) {
    return ['top', 'left', 'right'].some(p => getWinningTilesOf(hands[p], exposedMelds[p], p).includes(tile));
}

function buildDeck() {
    deck = [];
    for (let s of suits) {
        for (let n = 1; n <= 9; n++) {
            for (let i = 0; i < 4; i++) deck.push(n + s);
        }
    }
    for (let n = 1; n <= honors.length; n++) {
        for (let i = 0; i < 4; i++) deck.push(n + '字');
    }
    shuffle(deck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function tileSuit(t){ return t.slice(-1); }
function tileRank(t){ return parseInt(t.slice(0, -1), 10); }

// Unicode 麻将牌字符（万/条/筒/字）
const wanGlyphs  = ['🀇','🀈','🀉','🀊','🀋','🀌','🀍','🀎','🀏'];
const tiaoGlyphs = ['🀐','🀑','🀒','🀓','🀔','🀕','🀖','🀗','🀘'];
const tongGlyphs = ['🀙','🀚','🀛','🀜','🀝','🀞','🀟','🀠','🀡'];
const honorGlyphs = ['🀀','🀁','🀂','🀃','🀄','🀅','🀆']; // 东南西北中发白

function tileGlyph(t) {
    const suit = tileSuit(t);
    const rank = tileRank(t);
    if (suit === '万') return wanGlyphs[rank - 1];
    if (suit === '条') return tiaoGlyphs[rank - 1];
    if (suit === '筒') return tongGlyphs[rank - 1];
    if (suit === '字') return honorGlyphs[rank - 1];
    return t;
}

const rankChinese = ['一','二','三','四','五','六','七','八','九'];
function tileName(t) {
    if (tileSuit(t) === '字') return honors[tileRank(t) - 1];
    return rankChinese[tileRank(t) - 1] + tileSuit(t);
}

// ---------- 牌面图片（tiles/*.webp，与 index.html 同级的 tiles 文件夹）----------
// 牌码仍是 '5万' '3条' '7筒' '1字'(=东)…；字牌顺序与 honors 一致：东南西北中发白
const TILE_IMG_DIR = 'tiles/';
const TILE_IMG_SUITS = { '万': 'man', '条': 'sou', '筒': 'pin' };
const TILE_IMG_HONORS = ['east', 'south', 'west', 'north', 'red', 'green', 'white'];

function tileImgSrc(t) {
    const suit = tileSuit(t), rank = tileRank(t);
    const name = suit === '字' ? TILE_IMG_HONORS[rank - 1] : TILE_IMG_SUITS[suit] + rank;
    return TILE_IMG_DIR + name + '.webp';
}

// 牌面 <img>：cls 传 'inline' 用于听牌提示等行内文字里的小牌
function tileImg(t, cls) {
    return '<img class="tile-img' + (cls ? ' tile-img-' + cls : '') + '" src="' + tileImgSrc(t) + '" alt="" draggable="false">';
}

// 提前加载 34 张牌面，避免第一次亮牌/摸牌时闪一下
(function preloadTileImages() {
    try {
        const all = [];
        for (const s of suits) for (let n = 1; n <= 9; n++) all.push(n + s);
        for (let n = 1; n <= honors.length; n++) all.push(n + '字');
        all.forEach(t => { const im = new Image(); im.src = tileImgSrc(t); });
    } catch (e) {}
})();
