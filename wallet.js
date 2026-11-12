/* ============================================================================================
   Встроенный TON-кошелёк Mestario.
   Некастодиальный: сид-фраза (24 слова) создаётся прямо на устройстве и хранится только здесь,
   зашифрованная паролем кошелька (PBKDF2 + AES-GCM). На сервер уходит лишь публичный адрес —
   чтобы друзья могли переводить по @юзернейму, и карточки переводов в чатах.
   Подпись — tonweb (vendor/, грузится только когда нужен ключ). Балансы, история и курс — tonapi.io и toncenter.com.
   ============================================================================================ */
"use strict";
(function () {
const WORDS = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like limb limit link lion liquid list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond pony pool popular portion position possible post potato pottery poverty powder power practice praise predict prefer prepare present pretty prevent price pride primary print priority prison private prize problem process produce profit program project promote proof property prosper protect proud provide public pudding pull pulp pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret section security seed seek segment select sell seminar senior sense sentence series service session settle setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth zebra zero zone zoo".split(" ");
const TONWEB_SRC = "vendor/tonweb-0.0.66.js";
const USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const TONAPI = "https://tonapi.io/v2", TONCENTER = "https://toncenter.com/api";
const TON_FEE_RESERVE = 10000000n;          // 0,01 TON остаётся на комиссию (и развёртывание кошелька при первом переводе)
const JETTON_GAS = 50000000n;               // 0,05 TON уходит вместе с USDT на газ, излишек возвращается
const te = new TextEncoder(), td = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsKey = () => "mestario.tonw.v1." + (state.me && state.me.id);
const cacheKey = () => "mestario.tonw.cache." + (state.me && state.me.id);

/* ---------- адреса ---------- */
const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_");
function unb64(s) { try { const t = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(t, (c) => c.charCodeAt(0)); } catch (e) { return null; } }
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
function crc16(b) { let c = 0; for (const x of b) { c ^= x << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
function toRaw(a) {
  if (!a) return null;
  if (/^-?[0-9]+:[0-9a-fA-F]{64}$/.test(a)) return a.toLowerCase();
  const b = unb64(a);
  if (!b || b.length !== 36) return null;
  const c = crc16(b.slice(0, 34));
  if (b[34] !== c >> 8 || b[35] !== (c & 255)) return null;
  return (b[1] === 0xff ? -1 : b[1]) + ":" + hex(b.slice(2, 34));
}
function toFriendly(raw, bounce) {
  const r = toRaw(raw); if (!r) return raw;
  const [wc, hh] = r.split(":"), b = new Uint8Array(36);
  b[0] = bounce ? 0x11 : 0x51; b[1] = wc === "-1" ? 0xff : Number(wc); b.set(unhex(hh), 2);
  const c = crc16(b.slice(0, 34)); b[34] = c >> 8; b[35] = c & 255;
  return b64u(b);
}
const sameAddr = (a, b) => !!a && !!b && toRaw(a) === toRaw(b);
const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "");

/* ---------- суммы ---------- */
const DEC = { TON: 9, USDT: 6 };
function parseUnits(s, dec) {
  s = String(s || "").trim().replace(",", ".");
  if (!/^[0-9]{1,12}(\.[0-9]*)?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  if (f.length > dec) return null;
  return BigInt(i) * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
}
function fmtUnits(v, dec, max) {
  v = BigInt(v || 0); const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(dec), i = v / base;
  let f = (v % base).toString().padStart(dec, "0").slice(0, max ?? dec).replace(/0+$/, "");
  return (neg ? "-" : "") + Number(i).toLocaleString(window.SOROKA_LANG === "en" ? "en-US" : "ru-RU") + (f ? (window.SOROKA_LANG === "en" ? "." : ",") + f : "");
}
const plainUnits = (v, dec) => { v = BigInt(v); const base = 10n ** BigInt(dec); const f = (v % base).toString().padStart(dec, "0").replace(/0+$/, ""); return (v / base).toString() + (f ? "." + f : ""); };
const usd = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- сид-фраза (тот же алгоритм, что у Tonkeeper и tonweb-mnemonic) ---------- */
async function hmac512(phrase) {
  const k = await crypto.subtle.importKey("raw", te.encode(phrase), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(0)));
}
async function pbkdf2_512(key, salt, it) {
  const k = await crypto.subtle.importKey("raw", key, { name: "PBKDF2" }, false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: te.encode(salt), iterations: it }, k, 512));
}
async function isBasic(words) { const e = await hmac512(words.join(" ")); return (await pbkdf2_512(e, "TON seed version", 390))[0] === 0; }
async function genMnemonic() {
  for (;;) {
    const r = crypto.getRandomValues(new Uint16Array(24)), w = Array.from(r, (x) => WORDS[x & 2047]);
    if (await isBasic(w)) return w;
  }
}
const cleanWords = (s) => String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
async function validMnemonic(w) { return w.length === 24 && w.every((x) => WORDS.includes(x)) && await isBasic(w); }
async function seedOf(words) { const e = await hmac512(words.join(" ")); return (await pbkdf2_512(e, "TON default seed", 100000)).slice(0, 32); }

/* ---------- tonweb (только когда нужен ключ) ---------- */
let twLoad = null;
function tonweb() {
  if (window.TonWeb) return Promise.resolve(window.TonWeb);
  return twLoad || (twLoad = new Promise((ok, no) => {
    const sc = document.createElement("script"); sc.src = TONWEB_SRC; sc.async = true;
    sc.onload = () => (window.TonWeb ? ok(window.TonWeb) : no(new Error("tonweb")));
    sc.onerror = () => { twLoad = null; sc.remove(); no(new Error("tonweb load")); };
    document.head.append(sc);
  }));
}
const NOPROV = { send: () => Promise.reject(new Error("offline")) };
async function walletOf(words) {
  const TW = await tonweb();
  const kp = TW.utils.nacl.sign.keyPair.fromSeed(await seedOf(words));
  const w = new TW.Wallets.all.v4R2(NOPROV, { publicKey: kp.publicKey, wc: 0 });
  const addr = (await w.getAddress()).toString(true, true, false);
  return { TW, kp, w, addr };
}

/* ---------- хранилище на устройстве: сид-фраза зашифрована паролем кошелька ---------- */
async function aesKey(pass, salt, it) {
  const k = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: it }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(words, pass, addr) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), it = 250000;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(pass, salt, it), te.encode(words.join(" "))));
  return { v: 1, addr, it, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct), at: Date.now() };
}
async function unseal(v, pass) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, await aesKey(pass, unb64(v.salt), v.it), unb64(v.ct));
    return td.decode(pt).split(" ");
  } catch (e) { return null; }
}
function vault() { try { const v = JSON.parse(localStorage.getItem(lsKey()) || "null"); return v && v.v === 1 && v.addr ? v : null; } catch (e) { return null; } }
function saveVault(v) { try { localStorage.setItem(lsKey(), JSON.stringify(v)); return true; } catch (e) { return false; } }

/* ---------- сеть: по запросу в секунду на каждый сервис (бесплатные лимиты) ---------- */
const lanes = {};
function net(host, url, opt) {
  const L = lanes[host] || (lanes[host] = { chain: Promise.resolve(), last: 0 });
  const run = async () => {
    for (let i = 0; i < 3; i++) {
      const wait = L.last + 1100 - Date.now(); if (wait > 0) await sleep(wait);
      L.last = Date.now();
      const r = await fetch(url, opt);
      if (r.status !== 429) return r;
      await sleep(1200 * (i + 1));
    }
    throw new Error("rate");
  };
  const p = L.chain.then(run, run); L.chain = p.catch(() => {}); return p;
}
const tonapi = (path, opt) => net("tonapi", TONAPI + path, opt);
async function j(r) { if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; } return r.json(); }

async function loadAccount(addr) {
  const [info, jet, rate] = await Promise.all([
    net("toncenter", TONCENTER + "/v3/walletInformation?use_v2=false&address=" + encodeURIComponent(addr)).then(j).catch(() => null),
    tonapi("/accounts/" + encodeURIComponent(addr) + "/jettons?currencies=usd").then(j).catch((e) => (e.status === 404 ? { balances: [] } : null)),
    tonapi("/rates?tokens=ton&currencies=usd").then(j).catch(() => null)]);
  const out = { at: Date.now(), ton: info ? String(info.balance || "0") : null, seqno: info && info.seqno != null ? Number(info.seqno) : 0,
    status: info ? info.status : null, usdt: null, usdtWallet: null, tonUsd: null, usdtUsd: 1 };
  if (jet) {
    out.usdt = "0";
    for (const b of jet.balances || []) if (sameAddr(b.jetton && b.jetton.address, USDT_MASTER)) {
      out.usdt = String(b.balance || "0"); out.usdtWallet = b.wallet_address && b.wallet_address.address;
      const pr = b.price && b.price.prices && b.price.prices.USD; if (pr) out.usdtUsd = Number(pr);
    }
  }
  const tp = rate && rate.rates && rate.rates.TON && rate.rates.TON.prices && rate.rates.TON.prices.USD;
  if (tp) out.tonUsd = Number(tp);
  return out;
}
async function freshSeqno(addr) {
  try { const r = await net("toncenter", TONCENTER + "/v3/walletInformation?use_v2=false&address=" + encodeURIComponent(addr)).then(j); return Number(r.seqno || 0); }
  catch (e) { try { const r = await tonapi("/wallet/" + encodeURIComponent(addr) + "/seqno").then(j); return Number(r.seqno || 0); } catch (e2) { return 0; } }
}
async function sendBoc(boc) {
  try { const r = await net("toncenter", TONCENTER + "/v2/sendBoc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boc }) }); const d = await r.json().catch(() => ({})); if (r.ok && d.ok !== false) return true; }
  catch (e) {}
  const r = await tonapi("/blockchain/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boc }) });
  if (!r.ok) throw new Error("send " + r.status);
  return true;
}
async function loadEvents(addr, limit) {
  const d = await tonapi("/accounts/" + encodeURIComponent(addr) + "/events?limit=" + (limit || 40) + "&i18n=" + (window.SOROKA_LANG === "en" ? "en" : "ru")).then(j);
  const me = toRaw(addr), out = [];
  for (const ev of d.events || []) for (const a of ev.actions || []) {
    let it = null;
    if (a.type === "TonTransfer" && a.TonTransfer) { const t = a.TonTransfer; it = { cur: "TON", dec: 9, amt: String(t.amount), from: t.sender && t.sender.address, to: t.recipient && t.recipient.address, cmt: t.comment || "", fromName: t.sender && t.sender.name, toName: t.recipient && t.recipient.name }; }
    else if (a.type === "JettonTransfer" && a.JettonTransfer) {
      const t = a.JettonTransfer, jt = t.jetton || {};
      it = { cur: jt.symbol || "?", dec: Number(jt.decimals ?? 9), amt: String(t.amount), from: t.sender && t.sender.address, to: t.recipient && t.recipient.address, cmt: t.comment || "", usdt: sameAddr(jt.address, USDT_MASTER), fromName: t.sender && t.sender.name, toName: t.recipient && t.recipient.name };
      if (jt.verification === "blacklist") it = null;
    } else if (a.simple_preview) it = { other: a.simple_preview.description || a.type };
    if (!it) continue;
    it.ts = ev.timestamp * 1000; it.ok = a.status === "ok"; it.pending = !!ev.in_progress; it.id = ev.event_id; it.scam = !!ev.is_scam;
    if (!it.other) it.out = toRaw(it.from) === me;
    out.push(it);
  }
  return out;
}

/* ---------- стили ---------- */
const CSS = `
#dlgTonW { width: min(520px, 100vw); max-width: 100vw; height: min(820px, 100dvh); max-height: 100dvh; padding: 0; border: 0; border-radius: 22px; background: var(--bg); color: var(--ink); overflow: hidden; }
@media (max-width: 560px) { #dlgTonW { width: 100vw; height: 100dvh; border-radius: 0; } }
#dlgTonW::backdrop { background: rgb(0 0 0 / .55); }
.tw-wrap { display: flex; flex-direction: column; height: 100%; }
.tw-top { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.tw-top h2 { flex: 1; margin: 0; font-size: 22px; font-weight: 750; display: flex; align-items: center; gap: 10px; }
.tw-top h2 svg { width: 26px; height: 26px; color: #4f8dff; }
.tw-ib { width: 38px; height: 38px; border: 0; border-radius: 50%; background: none; color: inherit; display: grid; place-items: center; cursor: pointer; }
.tw-ib:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.tw-ib svg { width: 22px; height: 22px; }
.tw-pill { padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; background: rgb(52 199 89 / .14); color: #34c759; white-space: nowrap; }
.tw-pill.off { background: color-mix(in srgb, var(--ink) 9%, transparent); color: color-mix(in srgb, var(--ink) 55%, transparent); }
.tw-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.tw-nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 0; padding: 10px 12px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.tw-nav button { border: 0; background: none; color: color-mix(in srgb, var(--ink) 55%, transparent); font: inherit; font-size: 15px; padding: 4px 2px; cursor: pointer; }
.tw-nav button + button::before { content: "·"; margin: 0 9px; color: color-mix(in srgb, var(--ink) 35%, transparent); }
.tw-nav button.on { color: var(--ink); font-weight: 600; }
.tw-card { border-radius: 22px; padding: 20px 18px 18px; background: linear-gradient(160deg, #18233a, #121a2b); color: #fff; text-align: center; }
.tw-card small { display: block; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #9aa6bd; }
.tw-card .big { display: block; margin: 10px 0 6px; font-size: 44px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.tw-card .sub { color: #9aa6bd; font-size: 15px; }
.tw-acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
.tw-act { border: 0; border-radius: 16px; padding: 14px 6px 12px; background: #1f2f50; color: #fff; font: inherit; font-size: 15px; display: grid; justify-items: center; gap: 6px; cursor: pointer; transition: background .15s; }
.tw-act:hover { background: #27396096; background: #263a62; }
.tw-act svg { width: 22px; height: 22px; color: #7fb0ff; }
.tw-h { margin: 4px 0 0; font-size: 20px; font-weight: 750; }
.tw-list { border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 18px; overflow: hidden; }
.tw-row { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
button.tw-row { cursor: pointer; } button.tw-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.tw-row + .tw-row { border-top: 1px solid color-mix(in srgb, var(--ink) 9%, transparent); }
.tw-row .tx { flex: 1; min-width: 0; display: grid; gap: 2px; }
.tw-row .tx b { font-size: 17px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tw-row .tx span { font-size: 14px; color: color-mix(in srgb, var(--ink) 55%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tw-row .rt { text-align: right; display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.tw-row .rt b { font-size: 17px; font-weight: 650; white-space: nowrap; }
.tw-row .rt span { font-size: 13px; color: color-mix(in srgb, var(--ink) 50%, transparent); }
.tw-row .rt b.in { color: #34c759; }
.tw-coin { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
.tw-coin.ton { background: #1e3a6e; } .tw-coin.ton i { width: 18px; height: 18px; border-radius: 50%; background: #6aa8ff; }
.tw-coin.usdt { background: #1f5a48; color: #6be0a8; font-weight: 800; font-size: 17px; }
.tw-coin.ev { background: color-mix(in srgb, var(--ink) 9%, transparent); } .tw-coin svg { width: 20px; height: 20px; }
.tw-num { flex: none; width: 30px; font-size: 18px; font-weight: 600; color: color-mix(in srgb, var(--ink) 50%, transparent); font-variant-numeric: tabular-nums; }
.tw-ico { flex: none; width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center; background: color-mix(in srgb, var(--ink) 9%, transparent); }
.tw-ico svg { width: 22px; height: 22px; }
.tw-foot { font-size: 13px; color: color-mix(in srgb, var(--ink) 50%, transparent); text-align: center; line-height: 1.45; }
.tw-f { display: grid; gap: 6px; }
.tw-f > span { font-size: 14px; color: color-mix(in srgb, var(--ink) 60%, transparent); }
.tw-in { width: 100%; box-sizing: border-box; padding: 13px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); background: color-mix(in srgb, var(--ink) 4%, transparent); color: inherit; font: inherit; font-size: 16px; }
.tw-in:focus { outline: none; border-color: #4f8dff; }
textarea.tw-in { min-height: 120px; resize: vertical; line-height: 1.5; }
.tw-amt { display: flex; gap: 8px; } .tw-amt .tw-in { flex: 1; font-size: 22px; font-weight: 700; }
.tw-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border-radius: 14px; background: color-mix(in srgb, var(--ink) 7%, transparent); }
.tw-seg button { border: 0; border-radius: 11px; padding: 10px; background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.tw-seg button.on { background: var(--bg); box-shadow: 0 1px 3px rgb(0 0 0 / .2); }
.tw-btn { border: 0; border-radius: 16px; padding: 15px 16px; background: #3d78e6; color: #fff; font: inherit; font-size: 17px; font-weight: 650; cursor: pointer; width: 100%; }
.tw-btn:disabled { opacity: .5; cursor: default; }
.tw-btn.ghost { background: color-mix(in srgb, var(--ink) 8%, transparent); color: inherit; }
.tw-btn.red { background: color-mix(in srgb, #ff453a 16%, transparent); color: #ff453a; }
.tw-btn.sm { width: auto; padding: 10px 14px; font-size: 15px; border-radius: 12px; }
.tw-err { min-height: 1.2em; color: #ff6b62; font-size: 14px; }
.tw-note { padding: 12px 14px; border-radius: 14px; background: color-mix(in srgb, #ffb340 13%, transparent); color: color-mix(in srgb, #ffb340 80%, var(--ink)); font-size: 14px; line-height: 1.45; }
.tw-p { margin: 0; line-height: 1.5; color: color-mix(in srgb, var(--ink) 72%, transparent); }
.tw-words { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; counter-reset: w; }
.tw-words span { padding: 9px 8px; border-radius: 10px; background: color-mix(in srgb, var(--ink) 7%, transparent); font-family: ui-monospace, Menlo, monospace; font-size: 14px; }
.tw-words span::before { counter-increment: w; content: counter(w) ". "; color: color-mix(in srgb, var(--ink) 45%, transparent); }
.tw-words.blur span { filter: blur(6px); user-select: none; }
.tw-qr { align-self: center; padding: 14px; border-radius: 22px; background: #fff; line-height: 0; }
.tw-qr img, .tw-qr canvas { width: 220px; height: 220px; image-rendering: pixelated; }
.tw-addr { word-break: break-all; font-family: ui-monospace, Menlo, monospace; font-size: 15px; text-align: center; padding: 12px; border-radius: 14px; background: color-mix(in srgb, var(--ink) 6%, transparent); }
.tw-sum { display: grid; gap: 10px; padding: 16px; border-radius: 18px; background: color-mix(in srgb, var(--ink) 6%, transparent); }
.tw-sum div { display: flex; justify-content: space-between; gap: 12px; } .tw-sum div span { color: color-mix(in srgb, var(--ink) 55%, transparent); } .tw-sum div b { text-align: right; word-break: break-all; }
.tw-done { text-align: center; display: grid; gap: 10px; justify-items: center; padding: 20px 0; }
.tw-done .ok { width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; background: rgb(52 199 89 / .15); color: #34c759; }
.tw-done .ok svg { width: 40px; height: 40px; }
.tw-center { text-align: center; display: grid; gap: 12px; justify-items: center; padding: 10px 0; }
.tw-center .logo { width: 84px; height: 84px; border-radius: 26px; display: grid; place-items: center; background: linear-gradient(150deg, #3d78e6, #6a4ff0); color: #fff; }
.tw-center .logo svg { width: 42px; height: 42px; }
.tw-skel { color: transparent !important; background: color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 8px; }
/* карточка перевода в чате */
.msg.paym { padding: 4px; background: none !important; box-shadow: none !important; }
.pay-card { width: min(300px, 68vw); padding: 16px 18px 15px; border-radius: 18px; background: color-mix(in srgb, var(--ink) 10%, var(--panel, #222)); display: grid; gap: 6px; text-align: left; cursor: pointer; }
.msg.mine .pay-card { background: #233a66; color: #fff; }
.pay-card b.t { font-size: 17px; }
.pay-card .a { font-size: 30px; font-weight: 800; letter-spacing: -.01em; color: #34c759; font-variant-numeric: tabular-nums; line-height: 1.15; }
.msg.mine .pay-card .a { color: #fff; }
.pay-card .s { font-size: 14px; opacity: .7; }
.pay-card .c { font-size: 14px; opacity: .85; }
.pay-card .st { justify-self: start; margin-top: 4px; padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; background: rgb(52 199 89 / .16); color: #34c759; }
.pay-card .st.wait { background: rgb(255 179 64 / .16); color: #ffb340; }
.pay-card .st.bad { background: rgb(255 69 58 / .16); color: #ff6b62; }
.srow .tw-new { margin-left: 6px; padding: 2px 7px; border-radius: 999px; background: #3d78e6; color: #fff; font-size: 11px; font-weight: 700; text-transform: lowercase; }
`;

/* ---------- значки ---------- */
const SV = {
  out: '<path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  in: '<path d="M17 7L7 17M15 17H7V9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  swap: '<path d="M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16m0 4v-4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 016.5 5H18v3M4 7.5V17a2 2 0 002 2h13a1 1 0 001-1v-3M4 7.5A1.5 1.5 0 005.5 9H19a1 1 0 011 1v2m0 0h-4a1.5 1.5 0 000 3h4m0-3v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2M17 17v3h3v-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  hist: '<path d="M3.5 12a8.5 8.5 0 102.5-6L3.5 8.5M3.5 4v4.5H8M12 8v4l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 2.8l1.6 1.9 2.4-.5.7 2.4 2.3.9-.4 2.4L20.4 12l-1.8 2.1.4 2.4-2.3.9-.7 2.4-2.4-.5L12 21.2l-1.6-1.9-2.4.5-.7-2.4-2.3-.9.4-2.4L3.6 12l1.8-2.1-.4-2.4 2.3-.9.7-2.4 2.4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="1.9"/>',
};
function sv(name) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = SV[name]; return s; }

/* ---------- окно ---------- */
let dlg = null, view = "overview", acc = null, unlocked = null, sendCtx = null, hist = null, histAt = 0, busy = false;
function ensureDlg() {
  if (dlg) return dlg;
  const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
  dlg = h("dialog", { id: "dlgTonW", "aria-label": T("Кошелёк") },
    h("div", { class: "tw-wrap" },
      h("div", { class: "tw-top" },
        h("button", { class: "tw-ib", type: "button", id: "twBack", "aria-label": T("Назад"), hidden: true }, sv("back")),
        h("h2", {}, sv("wallet"), h("span", { id: "twTitle" }, T("Кошелёк"))),
        h("span", { class: "tw-pill off", id: "twPill" }, T("Не создан")),
        h("button", { class: "tw-ib", type: "button", "aria-label": T("Закрыть"), onclick: () => dlg.close() }, sv("close"))),
      h("div", { class: "tw-body", id: "twBody" }),
      h("nav", { class: "tw-nav", id: "twNav" })));
  dlg.addEventListener("close", () => { sendCtx = null; if (unlocked && unlocked.t) { clearTimeout(unlocked.t); } });
  document.body.append(dlg);
  return dlg;
}
const body = () => $("twBody");
const put = (...kids) => body().append(...kids.filter((k) => k != null && k !== false));
let backTo = null;
function goBack() { const b = backTo; backTo = null; show(b || "overview"); }
function setHead(title, back) {
  $("twTitle").textContent = title;
  $("twBack").hidden = !back; backTo = back || null; $("twBack").onclick = () => goBack();
  const v = vault();
  $("twPill").textContent = v ? T("Подключён") : T("Не создан");
  $("twPill").classList.toggle("off", !v);
  const nav = $("twNav"), tabs = v ? [["overview", T("Обзор")], ["assets", T("Активы")], ["activity", T("История")], ["settings", T("Настройки")]] : [];
  nav.hidden = !tabs.length;
  nav.replaceChildren(...tabs.map(([k, l]) => h("button", { type: "button", class: k === view ? "on" : "", onclick: () => show(k) }, l)));
}
function show(v, arg) {
  view = v;
  const fn = VIEWS[v] || VIEWS.overview;
  body().replaceChildren();
  body().scrollTop = 0;
  fn(arg);
}
async function open(v, arg) {
  if (!state.me) return;
  ensureDlg();
  if (!dlg.open) dlg.showModal();
  const vv = vault();
  if (!vv) { show("start"); return; }
  show(v || "overview", arg);
}

/* ---------- обзор ---------- */
function cached() { try { return JSON.parse(localStorage.getItem(cacheKey()) || "null"); } catch (e) { return null; } }
async function refresh(force) {
  const v = vault(); if (!v) return null;
  if (!force && acc && Date.now() - acc.at < 20000) return acc;
  try {
    const a = await loadAccount(v.addr);
    if (a.ton == null && acc) a.ton = acc.ton;
    acc = a;
    try { localStorage.setItem(cacheKey(), JSON.stringify(a)); } catch (e) {}
  } catch (e) { if (!acc) acc = cached(); }
  return acc;
}
function totals(a) {
  if (!a) return null;
  const ton = Number(BigInt(a.ton || 0)) / 1e9, us = Number(BigInt(a.usdt || 0)) / 1e6;
  return { ton, us, usd: (a.tonUsd ? ton * a.tonUsd : 0) + us * (a.usdtUsd || 1) };
}
function assetRows(a) {
  const t = totals(a), skel = !a;
  const row = (cls, inner, name, sub, amt, val) => h("button", { class: "tw-row", type: "button", onclick: () => show("asset", cls === "ton" ? "TON" : "USDT") },
    h("span", { class: "tw-coin " + cls }, inner), h("span", { class: "tx" }, h("b", {}, name), h("span", {}, sub)),
    h("span", { class: "rt" }, h("b", { class: skel ? "tw-skel" : "" }, amt), h("span", { class: skel ? "tw-skel" : "" }, val)));
  return h("div", { class: "tw-list" },
    row("ton", h("i"), "Toncoin", "TON", skel ? "0 TON" : fmtUnits(a.ton || 0, 9, 4) + " TON", skel ? "$0" : a.tonUsd ? usd(t.ton * a.tonUsd) : "—"),
    row("usdt", "₮", "Tether USD", "USDT · TON", skel ? "0 USDT" : fmtUnits(a.usdt || 0, 6, 2) + " USDT", skel ? "$0" : usd(t.us * (a.usdtUsd || 1))));
}
const VIEWS = {};
VIEWS.overview = () => {
  setHead(T("Кошелёк"));
  const a = acc || cached(), t = totals(a);
  const big = h("span", { class: "big" + (a ? "" : " tw-skel") }, a ? usd(t.usd) : "$0.00");
  const act = (ic, l, fn) => h("button", { class: "tw-act", type: "button", onclick: fn }, sv(ic), h("span", {}, l));
  const card = h("div", { class: "tw-card" }, h("small", {}, T("Общий баланс")), big, h("span", { class: "sub" }, T("Ваш криптопортфель")),
    h("div", { class: "tw-acts" }, act("out", T("Отправить"), () => show("send")), act("in", T("Получить"), () => show("receive")),
      act("swap", T("Обмен"), () => toast(T("Обмен TON ↔ USDT появится в следующем обновлении")))));
  const list = assetRows(a);
  put(card, h("h3", { class: "tw-h" }, T("Мои активы")), list,
    h("p", { class: "tw-foot" }, T("Ключи хранятся только на этом устройстве. Mestario не может ни потратить, ни восстановить ваши средства.")));
  refresh(false).then((n) => { if (view !== "overview" || !n) return; const tt = totals(n); big.className = "big"; big.textContent = usd(tt.usd); list.replaceWith(assetRows(n)); });
};
VIEWS.assets = () => {
  setHead(T("Активы"));
  const a = acc || cached(), list = assetRows(a);
  put(list, h("p", { class: "tw-foot" }, T("Поддерживаются TON и USDT в сети TON. Курс — tonapi.io.")));
  refresh(false).then((n) => { if (view === "assets" && n) list.replaceWith(assetRows(n)); });
};
VIEWS.asset = (cur) => {
  setHead(cur === "TON" ? "Toncoin" : "Tether USD", "assets");
  const a = acc || cached(), dec = DEC[cur], bal = a ? (cur === "TON" ? a.ton : a.usdt) || "0" : "0";
  put(h("div", { class: "tw-card" }, h("small", {}, cur === "TON" ? "Toncoin" : "Tether USD · TON"),
    h("span", { class: "big" }, fmtUnits(bal, dec, cur === "TON" ? 4 : 2) + " " + cur),
    h("span", { class: "sub" }, a ? usd(Number(BigInt(bal)) / 10 ** dec * (cur === "TON" ? a.tonUsd || 0 : a.usdtUsd || 1)) : ""),
    h("div", { class: "tw-acts", style: "grid-template-columns:1fr 1fr" },
      h("button", { class: "tw-act", type: "button", onclick: () => show("send", { cur }) }, sv("out"), h("span", {}, T("Отправить"))),
      h("button", { class: "tw-act", type: "button", onclick: () => show("receive") }, sv("in"), h("span", {}, T("Получить"))))));
  const box = h("div", { class: "tw-list" }, h("div", { class: "tw-row" }, h("span", { class: "tx" }, h("span", {}, T("Загружаем историю…")))));
  put(h("h3", { class: "tw-h" }, T("История")), box);
  history(false).then((list) => { if (view === "asset") box.replaceWith(histList((list || []).filter((x) => !x.other && (cur === "TON" ? x.cur === "TON" : x.usdt)))); });
};

/* ---------- история ---------- */
async function history(force) {
  const v = vault(); if (!v) return [];
  if (!force && hist && Date.now() - histAt < 20000) return hist;
  try { hist = await loadEvents(v.addr, 40); histAt = Date.now(); } catch (e) { if (!hist) return null; }
  return hist;
}
function histList(list) {
  if (list == null) return h("div", { class: "tw-list" }, h("div", { class: "tw-row" }, h("span", { class: "tx" }, h("span", {}, T("Не удалось загрузить историю. Проверьте интернет.")))));
  if (!list.length) return h("div", { class: "tw-list" }, h("div", { class: "tw-row" }, h("span", { class: "tx" }, h("b", {}, T("Пока пусто")), h("span", {}, T("Здесь появятся ваши переводы")))));
  const fmtT = (ts) => new Date(ts).toLocaleString(window.SOROKA_LANG === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return h("div", { class: "tw-list" }, ...list.slice(0, 60).map((x) => {
    if (x.other) return h("div", { class: "tw-row" }, h("span", { class: "tw-coin ev" }, sv("hist")), h("span", { class: "tx" }, h("b", {}, x.other), h("span", {}, fmtT(x.ts))));
    const who = x.out ? (x.toName || short(toFriendly(x.to, false))) : (x.fromName || short(toFriendly(x.from, false)));
    const st = x.pending ? T(" · в обработке") : !x.ok ? T(" · ошибка") : "";
    return h("a", { class: "tw-row", href: "https://tonviewer.com/transaction/" + x.id, target: "_blank", rel: "noopener noreferrer" },
      h("span", { class: "tw-coin ev" }, sv(x.out ? "out" : "in")),
      h("span", { class: "tx" }, h("b", {}, (x.out ? T("Отправлено → ") : T("Получено ← ")) + who), h("span", {}, fmtT(x.ts) + st + (x.cmt ? " · " + x.cmt : ""))),
      h("span", { class: "rt" }, h("b", { class: x.out ? "" : "in" }, (x.out ? "−" : "+") + fmtUnits(x.amt, x.dec, x.dec === 6 ? 2 : 4) + " " + x.cur)));
  }));
}
VIEWS.activity = () => {
  setHead(T("История"));
  const box = h("div", { class: "tw-list" }, h("div", { class: "tw-row" }, h("span", { class: "tx" }, h("span", {}, T("Загружаем…")))));
  put(box);
  history(true).then((list) => { if (view === "activity") box.replaceWith(histList(list)); });
};

/* ---------- получить ---------- */
VIEWS.receive = () => {
  setHead(T("Получить"), "overview");
  const v = vault(), qr = h("div", { class: "tw-qr" });
  put(h("p", { class: "tw-p", style: "text-align:center" }, T("Отправляйте на этот адрес только TON и USDT в сети TON.")), qr,
    h("div", { class: "tw-addr" }, v.addr),
    h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px" },
      h("button", { class: "tw-btn", type: "button", onclick: () => copyText(v.addr, T("Адрес скопирован")) }, T("Скопировать")),
      h("button", { class: "tw-btn ghost", type: "button", onclick: () => { if (navigator.share) navigator.share({ text: v.addr }).catch(() => {}); else copyText(v.addr, T("Адрес скопирован")); } }, T("Поделиться"))),
    h("p", { class: "tw-foot" }, T("Друзья в Mestario могут переводить вам прямо из чата или по вашему @юзернейму.")));
  (async () => {
    try {
      const qrcode = await qrReady(), q = qrcode(0, "M");
      q.addData("ton://transfer/" + v.addr); q.make();
      const n = q.getModuleCount(), c = document.createElement("canvas"), s = 8; c.width = c.height = n * s;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(k * s, r * s, s, s);
      qr.append(c);
    } catch (e) { qr.hidden = true; }
  })();
};

/* ---------- отправить ---------- */
async function resolveTo(s) {
  s = String(s || "").trim();
  if (!s) return { err: T("Укажите получателя") };
  if (/^@?[A-Za-z0-9_]{3,32}$/.test(s) && !toRaw(s)) {
    const name = s.replace(/^@/, "").toLowerCase();
    const { data: p } = await sb.from("profiles").select("id,display_name,username").ilike("username", name).maybeSingle();
    if (!p) return { err: T("Пользователь @") + name + T(" не найден") };
    const { data: a } = await sb.rpc("ton_address_of", { p_user: p.id });
    if (!a) return { err: p.display_name + T(" ещё не создал кошелёк Mestario") };
    return { addr: a, name: p.display_name, user: p };
  }
  if (!toRaw(s)) return { err: T("Неверный адрес TON") };
  return { addr: s.startsWith("0:") || s.startsWith("-1:") ? toFriendly(s, true) : s };
}
VIEWS.send = (arg) => {
  arg = arg || {};
  if (arg.ctx) sendCtx = arg.ctx;
  setHead(T("Отправить"), "overview");
  let cur = arg.cur || (sendCtx && sendCtx.cur) || "TON";
  const a = acc || cached();
  const seg = h("div", { class: "tw-seg" });
  const to = h("input", { class: "tw-in", placeholder: T("Адрес или @юзернейм"), autocomplete: "off", spellcheck: "false", value: arg.to || (sendCtx && sendCtx.toLabel) || "" });
  if (sendCtx && sendCtx.addr) to.readOnly = true;
  const amt = h("input", { class: "tw-in", inputmode: "decimal", placeholder: "0", autocomplete: "off", value: arg.amt || "" });
  const cmt = h("input", { class: "tw-in", placeholder: T("Комментарий (необязательно)"), maxlength: "120", value: arg.cmt || "" });
  const avail = h("span", {}), err = h("div", { class: "tw-err" });
  const maxOf = () => {
    const x = acc || a; if (!x) return 0n;
    if (cur === "TON") { const b = BigInt(x.ton || 0) - TON_FEE_RESERVE; return b > 0n ? b : 0n; }
    return BigInt(x.usdt || 0);
  };
  const paint = () => {
    seg.replaceChildren(...["TON", "USDT"].map((c) => h("button", { type: "button", class: c === cur ? "on" : "", onclick: () => { cur = c; paint(); } }, c)));
    const x = acc || a;
    avail.textContent = T("Доступно: ") + (x ? fmtUnits(cur === "TON" ? x.ton || 0 : x.usdt || 0, DEC[cur], cur === "TON" ? 4 : 2) : "…") + " " + cur;
  };
  paint();
  refresh(false).then(() => { if (view === "send") paint(); });
  const go = h("button", { class: "tw-btn", type: "button" }, T("Продолжить"));
  go.onclick = async () => {
    err.textContent = "";
    const units = parseUnits(amt.value, DEC[cur]);
    if (!units || units <= 0n) { err.textContent = T("Введите сумму"); return; }
    go.disabled = true;
    try {
      const r = sendCtx && sendCtx.addr ? { addr: sendCtx.addr, name: sendCtx.name, user: sendCtx.user } : await resolveTo(to.value);
      if (r.err) { err.textContent = r.err; return; }
      if (sameAddr(r.addr, vault().addr)) { err.textContent = T("Это ваш собственный адрес"); return; }
      const x = await refresh(true);
      if (!x || x.ton == null) { err.textContent = T("Не удалось проверить баланс. Проверьте интернет."); return; }
      if (cur === "TON" && units > maxOf()) { err.textContent = T("Недостаточно TON (0,01 TON остаётся на комиссию)"); return; }
      if (cur === "USDT") {
        if (units > BigInt(x.usdt || 0)) { err.textContent = T("Недостаточно USDT"); return; }
        if (BigInt(x.ton || 0) < JETTON_GAS + 5000000n) { err.textContent = T("Для перевода USDT нужно ≥ 0,055 TON на комиссию сети"); return; }
      }
      show("confirm", { cur, units, to: r.addr, name: r.name, user: r.user, cmt: cmt.value.trim(), back: { cur, to: to.value, amt: amt.value, cmt: cmt.value } });
    } finally { go.disabled = false; }
  };
  put(seg,
    h("label", { class: "tw-f" }, h("span", {}, T("Кому")), to),
    sendCtx && sendCtx.name ? h("p", { class: "tw-p", style: "margin-top:-8px" }, T("Получатель: ") + sendCtx.name) : null,
    h("label", { class: "tw-f" }, h("span", {}, T("Сумма")), h("div", { class: "tw-amt" }, amt,
      h("button", { class: "tw-btn ghost sm", type: "button", onclick: () => { amt.value = plainUnits(maxOf(), DEC[cur]); } }, T("Макс")))),
    avail, h("label", { class: "tw-f" }, h("span", {}, T("Комментарий")), cmt), err, go,
    h("p", { class: "tw-foot" }, T("Комиссия сети ≈ 0,005 TON. Переводы в блокчейне нельзя отменить — проверьте адрес.")));
  setTimeout(() => (to.value ? amt : to).focus(), 50);
};
function pwField(ph) { return h("input", { class: "tw-in", type: "password", placeholder: ph || T("Пароль кошелька"), autocomplete: "current-password" }); }
async function unlock(pass) {
  const v = vault(); if (!v) return null;
  if (unlocked && unlocked.addr === v.addr && Date.now() < unlocked.until) return unlocked.words;
  const words = await unseal(v, pass);
  if (!words) return null;
  unlocked = { addr: v.addr, words, until: Date.now() + 5 * 60000 };
  return words;
}
const isUnlocked = () => { const v = vault(); return !!(unlocked && v && unlocked.addr === v.addr && Date.now() < unlocked.until); };
VIEWS.confirm = (o) => {
  setHead(T("Подтверждение"));
  $("twBack").hidden = false; $("twBack").onclick = () => show("send", o.back);
  const dec = DEC[o.cur], pw = pwField(), err = h("div", { class: "tw-err" });
  const btn = h("button", { class: "tw-btn", type: "button" }, T("Отправить ") + fmtUnits(o.units, dec) + " " + o.cur);
  put(h("div", { class: "tw-sum" },
    h("div", {}, h("span", {}, T("Сумма")), h("b", {}, fmtUnits(o.units, dec) + " " + o.cur)),
    h("div", {}, h("span", {}, T("Кому")), h("b", {}, o.name ? o.name + " · " + short(o.to) : o.to)),
    o.cmt ? h("div", {}, h("span", {}, T("Комментарий")), h("b", {}, o.cmt)) : null,
    h("div", {}, h("span", {}, T("Комиссия сети")), h("b", {}, o.cur === "TON" ? "≈ 0,005 TON" : "≈ 0,05 TON" + T(" (излишек вернётся)")))),
    isUnlocked() ? null : h("label", { class: "tw-f" }, h("span", {}, T("Пароль кошелька")), pw), err, btn);
  if (!isUnlocked()) setTimeout(() => pw.focus(), 50);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
  btn.onclick = async () => {
    if (busy) return;
    err.textContent = ""; btn.disabled = true; busy = true;
    btn.textContent = T("Отправляем…");
    try {
      const words = await unlock(pw.value);
      if (!words) { err.textContent = T("Неверный пароль"); return; }
      const W = await walletOf(words), me = vault();
      if (W.addr !== me.addr && !sameAddr(W.addr, me.addr)) { err.textContent = T("Сид-фраза не подходит к этому кошельку"); return; }
      const TW = W.TW, BN = TW.utils.BN;
      const seqno = await freshSeqno(me.addr);
      let q;
      if (o.cur === "TON") {
        q = W.w.methods.transfer({ secretKey: W.kp.secretKey, toAddress: o.to, amount: new BN(o.units.toString()), seqno, payload: o.cmt || undefined, sendMode: 3 });
      } else {
        const x = await refresh(true);
        if (!x || !x.usdtWallet) { err.textContent = T("Не нашли ваш USDT-кошелёк. Попробуйте позже."); return; }
        const jw = new TW.token.jetton.JettonWallet(NOPROV, { address: toFriendly(x.usdtWallet, true) });
        let fwd = null;
        if (o.cmt) { fwd = new TW.boc.Cell(); fwd.bits.writeUint(0, 32); fwd.bits.writeBytes(te.encode(o.cmt)); }
        const payload = await jw.createTransferBody({ queryId: Date.now(), jettonAmount: new BN(o.units.toString()), toAddress: new TW.utils.Address(o.to),
          responseAddress: new TW.utils.Address(me.addr), forwardAmount: new BN(1), forwardPayload: fwd || undefined });
        q = W.w.methods.transfer({ secretKey: W.kp.secretKey, toAddress: toFriendly(x.usdtWallet, true), amount: new BN(JETTON_GAS.toString()), seqno, payload, sendMode: 3 });
      }
      const cell = await q.getQuery();
      const boc = TW.utils.bytesToBase64(await cell.toBoc(false));
      await sendBoc(boc);
      acc = null; hist = null;
      // перевод из чата — карточка в этот чат
      let posted = false;
      if (sendCtx && sendCtx.chat) {
        const amtS = plainUnits(o.units, dec);
        const { data, error } = await sb.from("messages").insert({ chat_id: sendCtx.chat, sender_id: state.me.id,
          body: "💎 " + amtS + " " + o.cur, pay: { cur: o.cur, amt: amtS, to: o.to, cmt: o.cmt || "" } }).select().single();
        if (!error && data) { posted = true; try { touchChat(data); if (state.activeId === sendCtx.chat) addMsg(data); } catch (e) {} }
      }
      show("done", { ...o, posted });
    } catch (e) {
      console.warn(e);
      err.textContent = /send|rate|fetch|network/i.test(String(e && e.message)) ? T("Сеть не приняла перевод. Проверьте интернет и попробуйте ещё раз.") : T("Не удалось отправить: ") + ((e && e.message) || e);
    } finally { busy = false; btn.disabled = false; btn.textContent = T("Отправить ") + fmtUnits(o.units, dec) + " " + o.cur; }
  };
};
VIEWS.done = (o) => {
  setHead(T("Отправлено"));
  const fromChat = !!(sendCtx && sendCtx.chat);
  put(h("div", { class: "tw-done" }, h("span", { class: "ok" }, sv("check")),
    h("b", { style: "font-size:24px" }, "−" + fmtUnits(o.units, DEC[o.cur]) + " " + o.cur),
    h("span", { class: "tw-p" }, T("Перевод отправлен в сеть TON. Подтверждение обычно занимает 5–15 секунд.")),
    o.posted ? h("span", { class: "tw-p" }, T("Карточка перевода добавлена в чат.")) : null),
    h("button", { class: "tw-btn", type: "button", onclick: () => { if (fromChat) dlg.close(); else show("overview"); } }, fromChat ? T("Вернуться в чат") : T("Готово")),
    h("button", { class: "tw-btn ghost", type: "button", onclick: () => show("activity") }, T("Открыть историю")));
  sendCtx = fromChat ? sendCtx : null;
};

/* ---------- настройки и безопасность (разделы как на макете) ---------- */
VIEWS.settings = () => {
  setHead(T("Настройки"));
  const v = vault();
  const row = (n, ic, title, sub, fn) => h("button", { class: "tw-row", type: "button", onclick: fn },
    h("span", { class: "tw-num" }, n), h("span", { class: "tw-ico" }, sv(ic)), h("span", { class: "tx" }, h("b", {}, title), h("span", {}, sub)));
  put(h("h3", { class: "tw-h" }, T("Все разделы")),
    h("div", { class: "tw-list" },
      row("01", "wallet", T("Обзор"), T("Общий баланс и активы"), () => show("overview")),
      row("02", "out", T("Отправить"), T("Переводы по адресу и @юзернейму"), () => show("send")),
      row("03", "qr", T("Получить"), T("Адрес, QR-код и получение"), () => show("receive")),
      row("04", "hist", T("История"), T("История всех операций"), () => show("activity")),
      row("05", "shield", T("Безопасность"), T("Восстановление и защита"), () => show("security")),
      row("06", "gear", T("Настройки кошелька"), T("Адрес, сеть и устройство"), () => show("wsettings"))),
    h("p", { class: "tw-foot" }, T("Адрес: ") + short(v.addr) + " · TON Mainnet · Wallet v4R2"));
};
VIEWS.wsettings = () => {
  setHead(T("Настройки кошелька"), "settings");
  const v = vault();
  let armed = false;
  const del = h("button", { class: "tw-btn red", type: "button" }, T("Удалить кошелёк с этого устройства"));
  del.onclick = async () => {
    if (!armed) { armed = true; del.textContent = T("Точно? Без сид-фразы доступ пропадёт навсегда"); setTimeout(() => { armed = false; del.textContent = T("Удалить кошелёк с этого устройства"); }, 5000); return; }
    try { localStorage.removeItem(lsKey()); localStorage.removeItem(cacheKey()); } catch (e) {}
    unlocked = null; acc = null; hist = null;
    toast(T("Кошелёк удалён с этого устройства"));
    show("start");
  };
  put(h("div", { class: "tw-sum" },
      h("div", {}, h("span", {}, T("Адрес")), h("b", {}, v.addr)),
      h("div", {}, h("span", {}, T("Сеть")), h("b", {}, "TON Mainnet")),
      h("div", {}, h("span", {}, T("Тип")), h("b", {}, "Wallet v4R2")),
      h("div", {}, h("span", {}, T("Создан")), h("b", {}, new Date(v.at || Date.now()).toLocaleDateString()))),
    h("button", { class: "tw-btn ghost", type: "button", onclick: () => copyText(v.addr, T("Адрес скопирован")) }, T("Скопировать адрес")),
    h("a", { class: "tw-btn ghost", style: "text-align:center;text-decoration:none", href: "https://tonviewer.com/" + v.addr, target: "_blank", rel: "noopener noreferrer" }, T("Открыть в Tonviewer")),
    h("p", { class: "tw-p" }, T("Тот же кошелёк можно открыть в Tonkeeper или другом кошельке TON: «Импорт» → 24 слова.")),
    del);
};
VIEWS.security = () => {
  setHead(T("Безопасность"), "settings");
  const pw = pwField(), err = h("div", { class: "tw-err" }), out = h("div");
  const showBtn = h("button", { class: "tw-btn", type: "button" }, T("Показать сид-фразу"));
  showBtn.onclick = async () => {
    err.textContent = ""; showBtn.disabled = true;
    const words = await unlock(pw.value); showBtn.disabled = false;
    if (!words) { err.textContent = T("Неверный пароль"); return; }
    const grid = h("div", { class: "tw-words blur", title: T("Нажмите, чтобы показать") }, ...words.map((w) => h("span", {}, w)));
    grid.onclick = () => grid.classList.toggle("blur");
    out.replaceChildren(h("div", { class: "tw-note" }, T("Никому не показывайте эти слова — даже поддержке Mestario. Кто знает сид-фразу, тот владеет деньгами.")), grid);
  };
  const p1 = pwField(T("Новый пароль")), p2 = pwField(T("Повторите новый пароль")), err2 = h("div", { class: "tw-err" });
  p1.autocomplete = p2.autocomplete = "new-password";
  const chg = h("button", { class: "tw-btn ghost", type: "button" }, T("Сменить пароль"));
  chg.onclick = async () => {
    err2.textContent = "";
    const words = await unlock(pw.value);
    if (!words) { err2.textContent = T("Сначала введите текущий пароль выше"); return; }
    if (p1.value.length < 6) { err2.textContent = T("Новый пароль — минимум 6 символов"); return; }
    if (p1.value !== p2.value) { err2.textContent = T("Пароли не совпадают"); return; }
    saveVault(await seal(words, p1.value, vault().addr));
    p1.value = p2.value = ""; toast(T("Пароль кошелька изменён"));
  };
  put(h("p", { class: "tw-p" }, T("Сид-фраза из 24 слов — единственный способ восстановить кошелёк, если вы потеряете устройство или удалите приложение. Запишите её на бумаге и храните в надёжном месте.")),
    h("label", { class: "tw-f" }, h("span", {}, T("Пароль кошелька")), pw), err, showBtn, out,
    h("h3", { class: "tw-h" }, T("Пароль")), p1, p2, err2, chg);
};

/* ---------- создание и восстановление ---------- */
VIEWS.start = async () => {
  setHead(T("Кошелёк"));
  const has = await sb.from("ton_accounts").select("address").eq("user_id", state.me.id).maybeSingle().then((r) => r.data && r.data.address).catch(() => null);
  if (view !== "start") return;
  put(h("div", { class: "tw-center" }, h("span", { class: "logo" }, sv("wallet")),
      h("b", { style: "font-size:24px" }, T("Кошелёк Mestario")),
      h("p", { class: "tw-p" }, T("Храните и переводите TON и USDT прямо в мессенджере — друзьям в чате или по @юзернейму."))),
    has ? h("div", { class: "tw-note" }, T("Ваш кошелёк ") + short(has) + T(" создан на другом устройстве. Чтобы пользоваться им здесь, восстановите его по сид-фразе.")) : null,
    h("button", { class: "tw-btn", type: "button", onclick: () => show(has ? "import" : "email", has ? { expect: has } : { next: "create" }) }, has ? T("Восстановить по сид-фразе") : T("Создать кошелёк")),
    h("button", { class: "tw-btn ghost", type: "button", onclick: () => show("email", has ? { next: "create", replace: true } : { next: "import" }) }, has ? T("Создать новый кошелёк") : T("У меня есть сид-фраза")),
    h("p", { class: "tw-foot" }, T("Кошелёк некастодиальный: 24 слова и ключи хранятся только у вас. Mestario не видит их и не может восстановить.")));
};
// подтверждение почты кодом — без этого кошелёк не создаётся
VIEWS.email = (o) => {
  setHead(T("Подтвердите почту"), "start");
  const email = state.me.email || "";
  if (!email || /@deleted\.invalid$/.test(email)) { put(h("div", { class: "tw-note" }, T("Чтобы создать кошелёк, к аккаунту должна быть привязана электронная почта."))); return; }
  const masked = email.replace(/^(.{2})[^@]*/, "$1•••");
  const code = h("input", { class: "tw-in", inputmode: "numeric", autocomplete: "one-time-code", placeholder: T("Код из письма"), maxlength: "10" });
  const err = h("div", { class: "tw-err" }), info = h("p", { class: "tw-p" }, T("Отправим код на ") + masked + T(" — так мы убедимся, что кошелёк создаёте именно вы."));
  const sendBtn = h("button", { class: "tw-btn ghost", type: "button" }, T("Отправить код"));
  const ok = h("button", { class: "tw-btn", type: "button", disabled: true }, T("Подтвердить"));
  sendBtn.onclick = async () => {
    err.textContent = ""; sendBtn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) { err.textContent = /rate|seconds/i.test(error.message) ? T("Код уже отправлен. Повторить можно через минуту.") : T("Не удалось отправить код: ") + error.message; sendBtn.disabled = false; return; }
    info.textContent = T("Код отправлен на ") + masked + T(". Письмо приходит за минуту — загляните и в «Спам».");
    ok.disabled = false; code.focus();
    setTimeout(() => { sendBtn.disabled = false; sendBtn.textContent = T("Отправить ещё раз"); }, 60000);
  };
  ok.onclick = async () => {
    const tk = code.value.replace(/\D/g, "");
    if (tk.length < 6) { err.textContent = T("Введите код из письма"); return; }
    ok.disabled = true; err.textContent = "";
    const { error } = await sb.auth.verifyOtp({ email, token: tk, type: "email" });
    ok.disabled = false;
    if (error) { err.textContent = T("Неверный или устаревший код"); return; }
    show(o.next === "import" ? "import" : "pass", o);
  };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); });
  put(info, sendBtn, h("label", { class: "tw-f" }, h("span", {}, T("Код")), code), err, ok);
};
VIEWS.pass = (o) => {
  setHead(T("Пароль кошелька"), "start");
  const p1 = pwField(T("Придумайте пароль")), p2 = pwField(T("Повторите пароль")), err = h("div", { class: "tw-err" });
  p1.autocomplete = p2.autocomplete = "new-password";
  const go = h("button", { class: "tw-btn", type: "button" }, o.words ? T("Сохранить кошелёк") : T("Создать кошелёк"));
  go.onclick = async () => {
    err.textContent = "";
    if (p1.value.length < 6) { err.textContent = T("Минимум 6 символов"); return; }
    if (p1.value !== p2.value) { err.textContent = T("Пароли не совпадают"); return; }
    go.disabled = true; go.textContent = o.words ? T("Сохраняем…") : T("Создаём ключи…");
    try {
      const words = o.words || await genMnemonic();
      const W = await walletOf(words);
      if (o.words) { await finish(words, W.addr, p1.value); toast(T("Кошелёк восстановлен")); show("overview"); return; }
      show("seed", { words, addr: W.addr, pass: p1.value });
    } catch (e) { err.textContent = T("Не удалось: ") + ((e && e.message) || e); }
    finally { go.disabled = false; }
  };
  put(h("p", { class: "tw-p" }, T("Пароль защищает кошелёк на этом устройстве: он нужен для переводов и чтобы посмотреть сид-фразу. Восстановить его нельзя — но всегда можно войти заново по сид-фразе.")),
    p1, p2, err, go);
  setTimeout(() => p1.focus(), 50);
};
async function finish(words, addr, pass) {
  if (!saveVault(await seal(words, pass, addr))) throw new Error(T("не хватает места в хранилище браузера"));
  unlocked = { addr, words, until: Date.now() + 5 * 60000 };
  acc = null; hist = null;
  const { error } = await sb.rpc("ton_account_set", { p_addr: addr });
  if (error) toast(T("Кошелёк сохранён, но адрес не записан на сервер — переводы по @юзернейму пока недоступны"));
}
VIEWS.seed = (o) => {
  setHead(T("Сид-фраза"));
  const grid = h("div", { class: "tw-words" }, ...o.words.map((w) => h("span", {}, w)));
  put(h("div", { class: "tw-note" }, T("Запишите 24 слова по порядку на бумаге. Это единственный способ восстановить кошелёк. Никому их не показывайте — даже поддержке Mestario.")),
    grid,
    h("button", { class: "tw-btn ghost", type: "button", onclick: () => copyText(o.words.join(" "), T("Скопировано. Не храните сид-фразу в заметках и скриншотах.")) }, T("Скопировать")),
    h("button", { class: "tw-btn", type: "button", onclick: () => show("check", o) }, T("Я записал(а) слова")));
};
VIEWS.check = (o) => {
  setHead(T("Проверка"), null);
  const idx = []; while (idx.length < 3) { const r = crypto.getRandomValues(new Uint8Array(1))[0] % 24; if (!idx.includes(r)) idx.push(r); }
  idx.sort((x, y) => x - y);
  const ins = idx.map((i) => h("input", { class: "tw-in", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: T("Слово №") + (i + 1) }));
  const err = h("div", { class: "tw-err" });
  const go = h("button", { class: "tw-btn", type: "button" }, T("Готово"));
  go.onclick = async () => {
    if (idx.some((i, k) => ins[k].value.trim().toLowerCase() !== o.words[i])) { err.textContent = T("Слова не совпадают — проверьте запись"); return; }
    go.disabled = true;
    try { await finish(o.words, o.addr, o.pass); toast(T("Кошелёк создан")); show("overview"); }
    catch (e) { err.textContent = T("Не удалось сохранить: ") + ((e && e.message) || e); go.disabled = false; }
  };
  put(h("p", { class: "tw-p" }, T("Введите слова №") + idx.map((i) => i + 1).join(", ") + T(" — чтобы убедиться, что вы их записали.")),
    ...ins.map((x, k) => h("label", { class: "tw-f" }, h("span", {}, T("Слово №") + (idx[k] + 1)), x)), err, go,
    h("button", { class: "tw-btn ghost", type: "button", onclick: () => show("seed", o) }, T("Показать слова ещё раз")));
};
VIEWS.import = (o) => {
  o = o || {};
  setHead(T("Восстановление"), "start");
  const ta = h("textarea", { class: "tw-in", placeholder: T("24 слова через пробел"), autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
  const err = h("div", { class: "tw-err" });
  const go = h("button", { class: "tw-btn", type: "button" }, T("Продолжить"));
  go.onclick = async () => {
    err.textContent = "";
    const w = cleanWords(ta.value);
    if (w.length !== 24) { err.textContent = T("Нужно ровно 24 слова (сейчас ") + w.length + ")"; return; }
    go.disabled = true;
    try {
      if (!await validMnemonic(w)) { err.textContent = T("Это не сид-фраза TON — проверьте слова"); return; }
      const W = await walletOf(w);
      if (o.expect && !sameAddr(W.addr, o.expect)) { err.textContent = T("Эта фраза от другого кошелька (") + short(W.addr) + T("). Ваш кошелёк Mestario: ") + short(o.expect); return; }
      show("pass", { words: w });
    } catch (e) { err.textContent = T("Не удалось: ") + ((e && e.message) || e); }
    finally { go.disabled = false; }
  };
  put(h("p", { class: "tw-p" }, T("Введите 24 слова сид-фразы. Подходит и кошелёк из Tonkeeper (тип v4R2).")), ta, err, go);
  setTimeout(() => ta.focus(), 50);
};

/* ---------- перевод из чата ---------- */
async function openSend(peer, chatId) {
  if (!vault()) { await open("start"); toast(T("Сначала создайте кошелёк")); return; }
  const { data: a } = await sb.rpc("ton_address_of", { p_user: peer.id });
  if (!a) { toast((peer.display_name || T("Собеседник")) + T(" ещё не создал кошелёк Mestario — попросите его открыть «Кошелёк» в настройках")); return; }
  ensureDlg(); if (!dlg.open) dlg.showModal();
  sendCtx = { chat: chatId, addr: a, name: peer.display_name, user: peer, toLabel: "@" + (peer.username || "") };
  show("send", { to: "@" + (peer.username || short(a)) });
}

/* ---------- карточка перевода в чате: статус берём из блокчейна ---------- */
const payStat = new Map(), evCache = new Map();
async function eventsOf(addr) {
  const c = evCache.get(addr);
  if (c && Date.now() - c.at < 15000) return c.p;
  const p = loadEvents(addr, 30).catch(() => null);
  evCache.set(addr, { at: Date.now(), p });
  return p;
}
async function checkPay(m) {
  const p = m.pay, k = m.id;
  const old = payStat.get(k);
  if (old && (old.s === "ok" || old.s === "bad" || Date.now() - old.at < 12000)) return old.s;
  const list = await eventsOf(p.from);
  let s = "wait";
  if (list) {
    const want = parseUnits(p.amt, DEC[p.cur]), to = toRaw(p.to);
    const hit = list.find((x) => !x.other && x.out && toRaw(x.to) === to && BigInt(x.amt) === want && (p.cur === "TON" ? x.cur === "TON" : x.usdt) && x.ts >= p.at - 180000 && x.ts <= p.at + 3600000);
    if (hit) s = hit.pending ? "wait" : hit.ok ? "ok" : "bad";
    else if (Date.now() - p.at > 15 * 60000) s = "lost";
  }
  payStat.set(k, { s, at: Date.now() });
  return s;
}
function payCard(m, mine) {
  const p = m.pay || {};
  const st = h("span", { class: "st wait" }, T("Проверяем…"));
  const card = h("div", { class: "pay-card", role: "link", tabindex: "0", title: T("Открыть в Tonviewer"),
      onclick: (e) => { e.stopPropagation(); open2("https://tonviewer.com/" + p.from); } },
    h("b", { class: "t" }, mine ? T("Перевод отправлен") : T("Перевод получен")),
    h("span", { class: "a" }, (mine ? "−" : "+") + fmtUnits(parseUnits(p.amt, DEC[p.cur]) || 0n, DEC[p.cur]) + " " + p.cur),
    p.cmt ? h("span", { class: "c" }, "«" + p.cmt + "»") : null,
    h("span", { class: "s" }, T("Блокчейн TON")), st);
  const paint = (s) => {
    st.className = "st" + (s === "ok" ? "" : s === "wait" ? " wait" : " bad");
    st.textContent = s === "ok" ? T("Подтверждено") : s === "wait" ? T("В обработке…") : s === "bad" ? T("Ошибка перевода") : T("Не найден в блокчейне");
    card.lastElementChild.previousElementSibling.textContent = s === "ok" ? T("Подтверждено в блокчейне TON") : T("Блокчейн TON");
  };
  const tick = async (n) => {
    const s = await checkPay(m);
    if (!card.isConnected && n > 0) return;
    paint(s);
    if (s === "wait" && n < 20) setTimeout(() => tick(n + 1), n < 6 ? 5000 : 15000);
  };
  const cachedS = payStat.get(m.id); if (cachedS) paint(cachedS.s);
  setTimeout(() => tick(0), 50);
  return card;
}
const open2 = (u) => { try { window.open(u, "_blank", "noopener"); } catch (e) {} };

window.MW = { open, openSend, payCard, hasVault: () => !!vault(), toRaw, toFriendly, _t: { show, genMnemonic, validMnemonic, seedOf, walletOf, parseUnits, fmtUnits, plainUnits, seal, unseal } };
})();
