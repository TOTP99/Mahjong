// 你的这张牌会不会点炮给某个 AI：等价于「该 AI 的听牌列表里有这张牌」。
// 用带缓存的 getWinningTilesOf 判定（结果等价于逐家 checkHu，命中缓存不重复算）。
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

const rankChinese = ['一','二','三','四','五','六','七','八','九'];
function tileName(t) {
    if (tileSuit(t) === '字') return honors[tileRank(t) - 1];
    return rankChinese[tileRank(t) - 1] + tileSuit(t);
}

// 流程日志等纯文字场景：用中文牌名（三万、东…），不再使用 Unicode 麻将字符
function tileGlyph(t) {
    return tileName(t);
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

// 牌背 <img>（tiles/back.webp）：加载失败时给外层 .tileback 加 no-img，回退成原来的蓝色牌背底
function tileBackImg() {
    return '<img class="tile-img tile-img-back" src="' + TILE_IMG_DIR + 'back.webp" alt="" draggable="false" onerror="if(this.parentNode)this.parentNode.classList.add(\'no-img\');this.remove()">';
}

// 提前加载 34 张牌面，避免第一次亮牌/摸牌时闪一下
(function preloadTileImages() {
    try {
        const all = [];
        for (const s of suits) for (let n = 1; n <= 9; n++) all.push(n + s);
        for (let n = 1; n <= honors.length; n++) all.push(n + '字');
        all.forEach(t => { const im = new Image(); im.src = tileImgSrc(t); });
        const bk = new Image(); bk.src = TILE_IMG_DIR + 'back.webp';
    } catch (e) {}
})();

// ---------- 座位工具（从 09-turn-settlement.js 移入：纯映射，与结算是解耦的）----------
/** 座位→方位：东=你（bottom），其余为 AI */
function nameOf(p) {
    return { top: '西', left: '北', right: '南', bottom: '东' }[p];
}
/** 座位对应动物（状态栏小头像：龙西/虎北/狮南/猫东） */
function animalOf(p) {
    return { top: '龙', left: '虎', right: '狮', bottom: '猫' }[p] || '';
}
/** 「东 猫」「南 狮」 */
function seatLabel(p) {
    const w = nameOf(p), a = animalOf(p);
    return a ? (w + ' ' + a) : w;
}
