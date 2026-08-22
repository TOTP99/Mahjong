function isDangerousTile(tile) {
    return ['top', 'left', 'right'].some(p => checkHu([...hands[p], tile], exposedMelds[p], p));
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

