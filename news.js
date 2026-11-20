/* Mestario: Новости — вкладка в центре нижней панели.
   Лента из RSS выбранных источников (Россия / Мир по категориям) и посты верифицированных каналов и людей.
   Из источников показываем только заголовок, короткий анонс и ссылку: полный текст читается на сайте источника.
   Админы выдают верификацию (галочку) людям и публичным каналам; с автопостингом их посты сами попадают в ленту.
   Страница открывается на месте списка чатов, как Настройки, и оформлена так же. */
(function () {
  "use strict";
  if (window.MNews) return;

  const CATS = [["top", "Главное"], ["news", "Новости"], ["tech", "Технологии"], ["business", "Бизнес"], ["science", "Наука"],
    ["sport", "Спорт"], ["games", "Игры"], ["auto", "Авто"], ["culture", "Культура"], ["edu", "Учёба"]];
  const CAT = Object.fromEntries(CATS);
  const GEO = [["all", "Все"], ["ru", "Россия"], ["world", "Мир"]];
  const SK = "mestario.news.v1";
  const SVGNS = "http://www.w3.org/2000/svg";

  const css = `
.sidebar.in-news > .side-head, .sidebar.in-news > .search, .sidebar.in-news > #chatList, .sidebar.in-news > .stories-bar,
.sidebar.in-news > .folders, .sidebar.in-news > .get-apps, .sidebar.in-news > .site-banner { display: none !important; }
#newsPage .dlg { display: flex; flex-direction: column; gap: 12px; padding-bottom: 96px; }
#newsPage [data-nv] { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
#newsPage [data-nv][hidden] { display: none; }
.nz-head { display: flex; align-items: center; gap: 6px; min-height: 40px; }
.nz-head h2 { margin: 0; flex: 1; font-size: 22px; font-weight: 750; letter-spacing: -.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nz-head.sub h2 { font-size: 18px; text-align: center; }
.nz-head .icon-btn svg { width: 22px; height: 22px; }
.nz-cats { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -12px; padding: 0 12px 2px; scroll-padding: 12px; }
.nz-cats::-webkit-scrollbar { display: none; }
.nz-cats button { flex: none; border: 0; padding: 7px 13px; border-radius: 999px; background: var(--panel-2); color: var(--ink); font-size: 14px; font-weight: 600; white-space: nowrap; transition: background-color .15s, color .15s; }
.nz-cats button[aria-checked="true"] { background: var(--accent); color: var(--accent-ink, #fff); }
.nz-card { display: block; width: 100%; border: 0; text-align: left; color: var(--ink); background: var(--panel-2); border-radius: 18px; padding: 12px 14px; min-width: 0; }
button.nz-card:active { transform: scale(.985); }
.nz-card.vf { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent); }
.nz-src { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); font-weight: 600; min-width: 0; white-space: nowrap; }
.nz-src .nm { color: var(--ink); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.nz-src .nm .vtick { width: 15px; height: 15px; }
.nz-src .avatar { width: 22px; height: 22px; font-size: 10px; flex: none; }
.nz-ltr { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; font-size: 10.5px; font-weight: 800; color: #fff; flex: none; }
.nz-rg { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--muted); }
.nz-tr { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); padding: 2px 7px 2px 5px; border-radius: 99px; }
.nz-tr svg { width: 12px; height: 12px; }
.nz-tag { margin-left: auto; font-size: 11.5px; font-weight: 700; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); padding: 2px 8px; border-radius: 99px; }
.nz-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; margin-top: 8px; }
.nz-row h4 { margin: 0; font-size: 16px; line-height: 1.32; font-weight: 700; overflow-wrap: anywhere; }
.nz-row p { margin: 6px 0 0; font-size: 14px; line-height: 1.4; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.nz-th { width: 92px; height: 70px; border-radius: 12px; object-fit: cover; background: color-mix(in srgb, var(--ink) 6%, transparent); }
.nz-th[hidden] { display: none; }
.nz-thw { position: relative; flex: none; }
.nz-thw .nz-th { display: block; }
.nz-play { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.nz-play span { width: 30px; height: 30px; border-radius: 50%; background: rgb(0 0 0 / .55); display: grid; place-items: center; }
.nz-play svg { width: 16px; height: 16px; color: #fff; margin-left: 2px; }
.nz-cnt { position: absolute; right: 5px; bottom: 5px; font-size: 11px; font-weight: 700; color: #fff; background: rgb(0 0 0 / .55); border-radius: 7px; padding: 1px 6px; }
.nz-gal { display: flex; flex-direction: column; gap: 8px; margin: 0 -12px; }
.nz-gal img, .nz-gal video { width: 100%; max-height: 70vh; object-fit: contain; background: #000; display: block; }
.nz-gal img { cursor: zoom-in; }
.nz-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.nz-pick .it { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: color-mix(in srgb, var(--ink) 7%, transparent); }
.nz-pick .it img, .nz-pick .it video { width: 100%; height: 100%; object-fit: cover; display: block; }
.nz-pick .it .x { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border: 0; border-radius: 50%; background: rgb(0 0 0 / .6); color: #fff; display: grid; place-items: center; padding: 0; font-size: 17px; line-height: 1; }
.nz-pick .it .x svg { width: 14px; height: 14px; }
.nz-pick .it .bar { position: absolute; left: 0; bottom: 0; height: 4px; background: var(--accent); transition: width .2s; }
.nz-pick .add { aspect-ratio: 1; border: 1.5px dashed var(--line); border-radius: 12px; background: none; color: var(--muted); display: grid; place-items: center; align-content: center; gap: 4px; font-size: 12px; font-weight: 600; }
.nz-pick .add svg { width: 22px; height: 22px; }
div.nz-card { cursor: pointer; }
/* большие фото и видео в ленте */
.nz-big-m { position: relative; margin: 10px -14px 0; background: #000; overflow: hidden; }
.nz-big-m img, .nz-big-m video { display: block; width: 100%; max-height: 420px; object-fit: cover; }
.nz-big-m .nz-cnt { right: 10px; bottom: 10px; font-size: 12px; }
.nz-big-m .nz-play span { width: 52px; height: 52px; } .nz-big-m .nz-play svg { width: 24px; height: 24px; }
/* реакции и комментарии */
.nz-rx { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; cursor: default; }
.nz-rx button { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 99px; padding: 6px 10px; font-size: 13.5px; font-weight: 600;
  background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--muted); transition: transform .15s; }
.nz-rx button:active { transform: scale(.92); }
.nz-rx button svg { width: 16px; height: 16px; }
.nz-rx button[aria-pressed="true"] { color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent); }
.nz-rx .cm { margin-left: auto; }
.nz-cmts { display: flex; flex-direction: column; gap: 10px; }
.nz-cmt { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; }
.nz-cmt .avatar { width: 34px; height: 34px; }
.nz-cmt .bb { background: var(--panel-2); border-radius: 4px 16px 16px 16px; padding: 8px 12px; min-width: 0; }
.nz-cmt .hd { display: flex; align-items: center; gap: 4px; font-size: 13.5px; font-weight: 700; min-width: 0; }
.nz-cmt .hd .vtick { width: 14px; height: 14px; }
.nz-cmt .hd small { color: var(--muted); font-weight: 500; margin-left: 4px; }
.nz-cmt .hd .del { margin-left: auto; border: 0; background: none; color: var(--muted); font-size: 12.5px; padding: 0; }
.nz-cmt .tx { font-size: 14.5px; line-height: 1.4; margin-top: 2px; white-space: pre-wrap; overflow-wrap: anywhere; }
.nz-cbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; position: sticky; bottom: 92px; background: var(--panel); padding: 6px 0; z-index: 2; }
.nz-cbar textarea { resize: none; min-height: 42px; max-height: 120px; font: inherit; color: var(--ink); }
.nz-cbar .btn { padding: 10px 14px; }
/* матч */
.nz-match { margin-top: 10px; border-radius: 16px; padding: 12px; background: color-mix(in srgb, var(--ink) 5%, transparent); cursor: default; }
.nz-match .top { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--muted); font-weight: 700; gap: 8px; }
.nz-match .st { padding: 2px 8px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 8%, transparent); white-space: nowrap; }
.nz-match .st.live { color: #e5484d; background: color-mix(in srgb, #e5484d 14%, transparent); display: inline-flex; align-items: center; gap: 5px; }
.nz-match .st.live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #e5484d; animation: nz-blink 1.2s infinite; }
@keyframes nz-blink { 50% { opacity: .3; } }
.nz-match .sb { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin-top: 10px; text-align: center; }
.nz-match .tm { display: grid; justify-items: center; gap: 6px; font-size: 14px; font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
.nz-match .lg { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; font-weight: 800; color: #fff; font-size: 18px; cursor: zoom-in; }
.nz-match .sc { font-size: 34px; font-weight: 800; letter-spacing: .03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nz-match .sc small { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0; color: var(--muted); }
.nz-stat { margin-top: 10px; display: grid; gap: 8px; }
.nz-stat .r { display: grid; grid-template-columns: 34px minmax(0, 1fr) 34px; gap: 8px; align-items: center; font-size: 13px; }
.nz-stat .r b { font-variant-numeric: tabular-nums; } .nz-stat .r b:last-child { text-align: right; }
.nz-stat .r .mid { display: grid; gap: 3px; text-align: center; color: var(--muted); font-size: 12px; font-weight: 600; }
.nz-stat .bars { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; height: 5px; }
.nz-stat .bars span { border-radius: 9px; background: color-mix(in srgb, var(--ink) 10%, transparent); overflow: hidden; display: flex; }
.nz-stat .bars span:first-child { justify-content: flex-end; }
.nz-stat .bars i { display: block; height: 100%; background: var(--accent); border-radius: 9px; }
.nz-stat .bars span:last-child i { background: #8a7cf6; }
.nz-odds { margin-top: 12px; }
.nz-odds .lb { font-size: 12px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.nz-odds .bar { display: flex; height: 30px; border-radius: 10px; overflow: hidden; font-size: 12.5px; font-weight: 700; color: #fff; }
.nz-odds .bar span { display: grid; place-items: center; min-width: 46px; white-space: nowrap; }
.nz-me { display: grid; grid-template-columns: minmax(0, 1fr) 56px 56px minmax(0, 1fr); gap: 6px; align-items: center; }
.nz-me .input { text-align: center; padding-left: 4px; padding-right: 4px; }
.nz-me .lab { font-size: 12.5px; color: var(--muted); font-weight: 600; }
.nz-me .lab:last-child { text-align: right; }
.nz-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nz-team { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 6px; align-items: center; }
.nz-team .ph { width: 44px; height: 44px; border-radius: 50%; border: 1.5px dashed var(--line); background: none; color: var(--muted); display: grid; place-items: center; padding: 0; overflow: hidden; }
.nz-team .ph img { width: 100%; height: 100%; object-fit: cover; } .nz-team .ph svg { width: 20px; height: 20px; }
.nz-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.nz-chips button { border: 0; border-radius: 99px; padding: 7px 12px; font-size: 13.5px; font-weight: 600; background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.nz-chips button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink, #fff); }
.nz-poll { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; cursor: default; }
.nz-poll .q { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.nz-opt { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; border: 0; text-align: left; border-radius: 12px; padding: 8px 12px; min-height: 42px;
  background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); font-size: 14.5px; overflow: hidden; }
.nz-opt .fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--accent) 24%, transparent); transition: width .5s cubic-bezier(.2,.8,.3,1); }
.nz-opt > *:not(.fill) { position: relative; }
.nz-opt .t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.nz-opt .pc { font-weight: 700; font-variant-numeric: tabular-nums; }
.nz-opt.me { box-shadow: inset 0 0 0 1.5px var(--accent); }
.nz-opt .ck { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--muted); flex: none; display: grid; place-items: center; }
.nz-opt.multi .ck { border-radius: 5px; }
.nz-opt[aria-pressed="true"] .ck { background: var(--accent); border-color: var(--accent); }
.nz-opt[aria-pressed="true"] .ck svg, .nz-opt.me .ck svg { width: 12px; height: 12px; color: #fff; }
.nz-opt.me .ck { background: var(--accent); border-color: var(--accent); }
.nz-opt img.oi { width: 40px; height: 40px; border-radius: 9px; object-fit: cover; flex: none; cursor: zoom-in; }
.nz-poll .f { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--muted); }
.nz-poll .f button { border: 0; background: none; color: var(--accent); font-weight: 700; padding: 0; font-size: 13px; }
.nz-rate { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin-top: 10px; padding: 10px 12px; border-radius: 14px;
  background: color-mix(in srgb, var(--ink) 5%, transparent); border: 0; width: 100%; text-align: left; color: var(--ink); cursor: pointer; }
.nz-rate .co { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; object-fit: cover; }
.nz-rate b { display: block; font-size: 15px; } .nz-rate small { font-size: 12.5px; color: var(--muted); }
.nz-rate .pr { text-align: right; font-weight: 800; font-size: 16px; white-space: nowrap; } .nz-rate .pr small { display: block; font-weight: 700; }
.nz-rate .ch { grid-column: 1 / -1; height: 64px; } .nz-rate .ch svg { width: 100%; height: 64px; }
.nz-opts { display: flex; flex-direction: column; gap: 8px; }
.nz-orow { display: grid; grid-template-columns: minmax(0, 1fr) 44px 32px; gap: 6px; align-items: center; }
.nz-orow .ph { width: 44px; height: 44px; border-radius: 10px; border: 1.5px dashed var(--line); background: none; color: var(--muted); display: grid; place-items: center; padding: 0; overflow: hidden; position: relative; }
.nz-orow .ph img { width: 100%; height: 100%; object-fit: cover; }
.nz-orow .ph svg { width: 20px; height: 20px; }
.nz-orow .rm { border: 0; background: none; color: var(--muted); font-size: 20px; padding: 0; }
.nz-assets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.nz-assets button { border: 0; border-radius: 14px; padding: 10px; background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); font-weight: 700; display: grid; justify-items: center; gap: 4px; }
.nz-assets button[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.nz-assets img, .nz-assets .co { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; }
.nz-seg button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.nz-mkt .hd { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.nz-tick { display: grid; grid-template-columns: 34px minmax(0, 1fr) 84px auto; gap: 10px; align-items: center; padding: 9px 0; border: 0; border-bottom: 1px solid var(--line); width: 100%; background: none; color: var(--ink); text-align: left; }
.nz-tick:last-child { border-bottom: 0; padding-bottom: 2px; }
.nz-tick img.co { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.nz-tick .co { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 13px; color: #fff; background: #0098ea; }
.nz-tick b { font-size: 15px; display: block; } .nz-tick small { font-size: 12px; color: var(--muted); }
.nz-tick .pr { text-align: right; font-weight: 700; font-size: 14.5px; white-space: nowrap; } .nz-tick .pr small { display: block; font-weight: 700; }
.nz-tick svg { width: 84px; height: 30px; }
.nz-up { color: #3fbf73 !important; } .nz-dn { color: #e5484d !important; }
.nz-big { position: relative; height: 140px; margin-top: 10px; border-radius: 14px; background: color-mix(in srgb, var(--ink) 5%, transparent); overflow: hidden; }
.nz-big svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.nz-big .pp { position: absolute; left: 14px; top: 10px; }
.nz-big .pp b { font-size: 20px; font-weight: 800; display: block; } .nz-big .pp small { font-size: 13px; font-weight: 700; }
.nz-per { margin-top: 10px; }
.nz-upd .ver { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--muted); font-weight: 600; }
.nz-upd .ver b { color: var(--accent-ink, #fff); background: var(--accent); padding: 3px 9px; border-radius: 99px; font-size: 12px; }
.nz-upd h4 { margin: 8px 0 4px; font-size: 16px; }
.nz-upd ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 14px; line-height: 1.45; }
.nz-more { align-self: center; }
.nz-empty { padding: 30px 12px; text-align: center; color: var(--muted); }
.nz-skel { height: 96px; border-radius: 18px; background: linear-gradient(90deg, var(--panel-2) 30%, color-mix(in srgb, var(--ink) 6%, var(--panel-2)) 50%, var(--panel-2) 70%); background-size: 300% 100%; animation: nz-sh 1.2s linear infinite; }
@keyframes nz-sh { to { background-position: -150% 0; } }
.nz-cta { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.nz-cta b { display: block; font-size: 15px; } .nz-cta span.s { font-size: 13px; color: var(--muted); }
/* статья */
.nz-art-img { width: calc(100% + 24px); margin: -4px -12px 0; max-height: 240px; object-fit: cover; border-radius: 0 0 18px 18px; display: block; }
.nz-art h3 { margin: 4px 0 0; font-size: 22px; line-height: 1.25; font-weight: 800; letter-spacing: -.01em; overflow-wrap: anywhere; }
.nz-art p { margin: 0; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.nz-trbox { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: color-mix(in srgb, var(--accent) 12%, var(--panel-2)); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.nz-trbox span { display: inline-flex; gap: 7px; align-items: center; } .nz-trbox svg { width: 16px; height: 16px; }
.nz-trbox button { border: 0; background: none; color: var(--accent); font-weight: 700; padding: 0; }
.nz-acts { display: grid; gap: 8px; }
#newsPage .btn { display: flex; align-items: center; justify-content: center; gap: 8px; }
#newsPage .btn svg { width: 18px; height: 18px; flex: none; }
.nz-orig { font-size: 12.5px; color: var(--muted); text-align: center; }
/* источники */
.nz-tbl { border-radius: 16px; background: var(--panel-2); overflow: hidden; }
.nz-tbl .r { display: grid; grid-template-columns: 96px minmax(0, 1fr) minmax(0, 1fr); gap: 6px; padding: 8px 12px; align-items: center; border-bottom: 1px solid var(--line); font-size: 14px; }
.nz-tbl .r:last-child { border-bottom: 0; }
.nz-tbl .r.h { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; padding: 11px 12px; }
.nz-tbl .r .c { font-weight: 700; min-width: 0; }
.nz-tbl .cl { min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.nz-pill { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px 5px 6px; border: 0; border-radius: 99px; background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); font-size: 12.5px; font-weight: 600; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.nz-pill i { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 9px; font-weight: 800; color: #fff; flex: none; }
.nz-pill[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 20%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent); }
/* админка и заявки */
.nz-req .who { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.nz-req .who b { font-size: 15.5px; display: flex; align-items: center; gap: 4px; min-width: 0; } .nz-req .who small { font-size: 13px; color: var(--muted); }
.nz-req .why { font-size: 13.5px; line-height: 1.4; margin-top: 9px; overflow-wrap: anywhere; }
.nz-req .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; color: var(--muted); margin-top: 8px; font-weight: 600; }
.nz-req .ab { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.nz-kind { font-size: 11px; font-weight: 800; letter-spacing: .03em; padding: 3px 8px; border-radius: 7px; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--muted); text-transform: uppercase; }
.nz-form { display: flex; flex-direction: column; gap: 10px; }
.nz-form .lbl { font-size: 12.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 4px 2px -4px; }
.nz-form select.input, .nz-form textarea.input { font: inherit; color: var(--ink); }
.nz-form textarea.input { resize: vertical; min-height: 90px; }
.nz-status { font-size: 13.5px; color: var(--muted); line-height: 1.45; }
.nz-ok { color: var(--accent); font-weight: 700; }
`;
  document.head.append(Object.assign(document.createElement("style"), { textContent: css }));

  /* ---------- настройки ленты на этом устройстве ---------- */
  let prefs = (() => { try { return JSON.parse(localStorage.getItem(SK) || "null") || {}; } catch (e) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(SK, JSON.stringify(prefs)); } catch (e) {} };
  if (!CAT[prefs.cat]) prefs.cat = "top";
  if (!["all", "ru", "world"].includes(prefs.geo)) prefs.geo = "all";
  if (prefs.pubs == null) prefs.pubs = true;

  let sources = [], srcMap = new Map(), srcLoaded = null;
  function loadSources() {
    if (srcLoaded) return srcLoaded;
    srcLoaded = sb.from("news_sources").select("id,name,region,category,site,color,letter,lang,sort,default_on").order("sort").then(({ data, error }) => {
      if (error) { srcLoaded = null; return []; }
      sources = data || [];
      srcMap = new Map(sources.map((s) => [s.id, s]));
      if (!prefs.src) { prefs.src = {}; for (const s of sources) prefs.src[s.id] = !!s.default_on; savePrefs(); }
      for (const s of sources) if (prefs.src[s.id] == null) prefs.src[s.id] = !!s.default_on;
      return sources;
    });
    return srcLoaded;
  }
  const chosenSources = () => sources.filter((s) => prefs.src && prefs.src[s.id]).map((s) => s.id);

  /* ---------- мелочи ---------- */
  const en = () => window.SOROKA_LANG === "en";
  function ago(iso) {
    const t = Date.parse(iso), d = (Date.now() - t) / 60000;
    if (!Number.isFinite(t)) return "";
    if (d < 1) return T("сейчас");
    if (d < 60) return Math.floor(d) + T(" мин");
    if (d < 24 * 60) return Math.floor(d / 60) + T(" ч");
    return new Date(t).toLocaleDateString(en() ? "en-US" : "ru-RU", { day: "numeric", month: "short" });
  }
  const ico = (n) => icon(n);
  function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function spark(pts, w, hgt, area) {
    const s = svgEl("svg", { viewBox: "0 0 " + w + " " + hgt, preserveAspectRatio: "none", "aria-hidden": "true" });
    if (!pts || pts.length < 2) return s;
    const ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w, Y = (v) => hgt - 4 - ((v - lo) / (hi - lo || 1)) * (hgt - 8);
    const d = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    const up = ys[ys.length - 1] >= ys[0], col = up ? "#3fbf73" : "#e5484d";
    if (area) {
      const id = "nzg" + Math.random().toString(36).slice(2, 8);
      const defs = svgEl("defs", {}), g = svgEl("linearGradient", { id, x1: 0, x2: 0, y1: 0, y2: 1 });
      g.append(svgEl("stop", { offset: 0, "stop-color": col, "stop-opacity": ".32" }), svgEl("stop", { offset: 1, "stop-color": col, "stop-opacity": "0" }));
      defs.append(g); s.append(defs, svgEl("path", { d: d + " L" + w + " " + hgt + " L0 " + hgt + "z", fill: "url(#" + id + ")" }));
    }
    s.append(svgEl("path", { d, fill: "none", stroke: col, "stroke-width": area ? 2.5 : 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
    return s;
  }
  const tick = () => preTick({ verified: true, id: "-" });
  function btn(label, cls, onclick, ic) { return h("button", { class: "btn" + (cls ? " " + cls : ""), type: "button", onclick }, ic ? ico(ic) : null, label); }
  function rpcErr(e) {
    const m = String((e && e.message) || "");
    if (/limit/.test(m)) return T("Слишком часто — попробуйте позже");
    if (/not verified/.test(m)) return T("Публиковать в Новостях могут только верифицированные авторы");
    if (/bad url/.test(m)) return T("Ссылка должна начинаться с https://");
    if (/bad poll/.test(m)) return T("Проверьте варианты ответа: от 2 до 10, до 100 символов");
    if (/bad match/.test(m)) return T("Проверьте матч: названия команд до 40 символов, числа без минусов");
    if (/bad category|bad region/.test(m)) return T("Этот раздел вам недоступен");
    if (/bad title/.test(m)) return T("Заголовок — от 3 до 160 символов");
    if (/not channel admin/.test(m)) return T("Заявку за канал подаёт его администратор, канал должен быть публичным");
    return T("Не получилось. Попробуйте ещё раз");
  }

  /* ---------- страница ---------- */
  const page = h("section", { id: "newsPage", class: "set-page", hidden: true });
  const dlg = h("div", { class: "dlg" });
  page.append(dlg);
  const side = document.querySelector(".sidebar");
  const bar = side && side.querySelector(".tabbar");
  if (bar) side.insertBefore(page, bar); else (side || document.body).append(page);

  const views = {};
  let viewNow = "feed", stack = [];
  function view(name) {
    if (!views[name]) { views[name] = h("div", { "data-nv": name, hidden: true }); dlg.append(views[name]); }
    return views[name];
  }
  function show(name, back) {
    for (const k in views) views[k].hidden = k !== name;
    const v = view(name);
    v.hidden = false;
    if (typeof flash === "function" && name !== viewNow) flash(v, 400, back ? "from-left" : "from-right");
    viewNow = name;
    dlg.scrollTop = 0;
  }
  function go(name, paint) { stack.push(viewNow); paint(view(name)); show(name); }
  function back() { const p = stack.pop() || "feed"; show(p, true); if (p === "feed" && feedDirty) { feedDirty = false; loadFeed(true); } }
  function subHead(title, right) {
    const b = h("button", { class: "icon-btn", type: "button", "aria-label": T("Назад"), onclick: back }, ico("back"));
    return h("div", { class: "nz-head sub" }, b, h("h2", {}, title), right || h("span", { style: "width:40px;flex:none" }));
  }

  page.showModal = () => {
    page.hidden = false;
    side && side.classList.add("in-news");
    if (typeof flash === "function") flash(page, 400, "enter");
  };
  page.close = () => {
    if (page.hidden) return;
    page.hidden = true;
    side && side.classList.remove("in-news");
    if (typeof paintTabs === "function") paintTabs();
  };
  Object.defineProperty(page, "open", { get: () => !page.hidden });

  /* ---------- лента ---------- */
  const fv = view("feed");
  const head = h("div", { class: "nz-head" });
  const catsBox = h("div", { class: "nz-cats", role: "tablist" });
  const geoBox = h("div", { class: "seg nz-seg", role: "tablist" });
  const topBox = h("div", { style: "display:contents" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const moreBtn = h("button", { class: "btn ghost nz-more", type: "button", hidden: true, onclick: () => loadFeed(false) }, T("Показать ещё"));
  const ctaBox = h("div", { style: "display:contents" });
  fv.append(head, catsBox, geoBox, topBox, list, moreBtn, ctaBox);

  let status = null;   // моя верификация
  function paintHead() {
    const kids = [h("h2", {}, T("Новости"))];
    if (status && status.me && status.me.autopost) kids.push(h("button", { class: "icon-btn", type: "button", title: T("Написать в Новости"), "aria-label": T("Написать в Новости"), onclick: () => openCompose() }, ico("plus")));
    if (state.isAdmin) kids.push(h("button", { class: "icon-btn", type: "button", title: T("Верификация"), "aria-label": T("Верификация"), onclick: () => openAdmin() }, ico("shield")));
    kids.push(h("button", { class: "icon-btn", type: "button", title: T("Источники"), "aria-label": T("Источники"), onclick: openSources }, ico("grid")));
    head.replaceChildren(...kids);
  }
  function paintCats() {
    catsBox.replaceChildren(...CATS.map(([k, n]) => h("button", { type: "button", role: "tab", "aria-checked": String(prefs.cat === k), onclick: (e) => {
      if (prefs.cat === k) return;
      prefs.cat = k; savePrefs(); paintCats(); loadFeed(true);
      e.currentTarget.scrollIntoView({ block: "nearest", inline: "center", behavior: motionOK() ? "smooth" : "auto" });
    } }, T(n))));
    geoBox.replaceChildren(...GEO.map(([k, n]) => h("button", { type: "button", role: "tab", "aria-checked": String(prefs.geo === k), onclick: () => {
      if (prefs.geo === k) return;
      prefs.geo = k; savePrefs(); paintCats(); loadFeed(true);
    } }, T(n))));
  }

  /* курсы: MST и TON — как в кошельке */
  const M = () => window.MW && MW.market;
  let mktPer = "W";
  function mstIcon() { return h("img", { class: "co", src: "mst.png", alt: "" }); }
  function marketCard(big) {
    const m = M();
    if (!m) return null;
    const card = h("div", { class: "nz-card nz-mkt" });
    const row = (cur, name, sym, co) => {
      const pr = h("div", { class: "pr" }, "—"), sp = h("span", {});
      const b = h("button", { class: "nz-tick", type: "button", onclick: () => MW.open("asset", cur) }, co, h("div", {}, h("b", {}, name), h("small", {}, sym)), sp, pr);
      const paint = (pts) => {
        const p = m.rateOf(cur);
        let ch = null;
        if (pts && pts.length > 1) { ch = (pts[pts.length - 1][1] / pts[0][1] - 1) * 100; sp.replaceChildren(spark(pts, 84, 30)); }
        else if (m.diffOf(cur) != null) ch = m.diffOf(cur);
        pr.replaceChildren(p ? m.money(p, m.priceDig(p)) : "—", ch == null || !Number.isFinite(ch) ? "" : h("small", { class: ch >= 0 ? "nz-up" : "nz-dn" }, m.pct(ch)));
      };
      paint(m.chartPeek(cur, "D"));
      m.loadRates(false).then(() => m.loadChart(cur, "D")).then(paint).catch(() => {});
      return b;
    };
    if (big) {
      const box = h("div", { class: "nz-big" }), pp = h("div", { class: "pp" });
      const per = h("div", { class: "seg nz-per", role: "tablist" });
      const paintBig = (pts) => {
        const p = m.rateOf("MST");
        const ch = pts && pts.length > 1 ? (pts[pts.length - 1][1] / pts[0][1] - 1) * 100 : null;
        pp.replaceChildren(h("b", {}, p ? m.money(p, m.priceDig(p)) : "—"), ch == null || !Number.isFinite(ch) ? "" : h("small", { class: ch >= 0 ? "nz-up" : "nz-dn" }, m.pct(ch)));
        box.replaceChildren(spark(pts, 340, 140, true), pp);
      };
      const load = () => { paintBig(m.chartPeek("MST", mktPer)); m.loadRates(false).then(() => m.loadChart("MST", mktPer)).then(paintBig).catch(() => {}); };
      const pers = [["D", "1Д"], ["W", "7Д"], ["M", "1М"], ["Y", "1Г"]];
      const paintPer = () => per.replaceChildren(...pers.map(([k, n]) => h("button", { type: "button", role: "tab", "aria-checked": String(mktPer === k), onclick: () => { mktPer = k; paintPer(); load(); } }, T(n))));
      paintPer(); load();
      card.append(h("div", { class: "nz-cta", style: "grid-template-columns:34px minmax(0,1fr) auto" }, h("img", { src: "mst.png", alt: "", style: "width:34px;height:34px;border-radius:50%" }),
        h("div", {}, h("b", {}, "MestCoin (MST)"), h("span", { class: "s" }, T("пул DeDust"))),
        h("button", { class: "btn", type: "button", style: "padding:7px 14px", onclick: () => MW.open("swap", { from: "TON" }) }, T("Купить"))), box, per);
      card.append(h("div", { style: "margin-top:6px" }, row("TON", "Toncoin", "TON", h("span", { class: "co" }, "T"))));
      return card;
    }
    card.append(h("div", { class: "hd" }, h("span", {}, T("Курсы")), h("button", { class: "nz-tr", type: "button", style: "border:0", onclick: () => MW.open() }, T("Кошелёк"))),
      row("MST", "MestCoin", "MST", mstIcon()), row("TON", "Toncoin", "TON", h("span", { class: "co" }, "T")));
    return card;
  }
  /* «Что нового» в Mestario */
  let wnCache;
  async function whatsNewCard() {
    if (wnCache === undefined) { const { data } = await sb.rpc("news_whats_new"); wnCache = data || null; }
    const n = wnCache;
    if (!n) return null;
    const lines = String(n.body || "").split(/\n+/).map((x) => x.replace(/^[\p{Extended_Pictographic}️‍\s•*-]+/u, "").trim()).filter(Boolean).slice(0, 3);
    return h("button", { class: "nz-card nz-upd", type: "button", onclick: () => { if (typeof paintNews === "function") { paintNews(n); $("dlgNews").showModal(); } } },
      h("div", { class: "ver" }, h("span", {}, T("Mestario · что нового")), h("b", {}, ago(n.created_at))),
      h("h4", {}, n.title), lines.length ? h("ul", {}, ...lines.map((l) => h("li", {}, l))) : null);
  }

  function srcBadge(it) {
    if (it.kind === "rss") {
      const s = srcMap.get(it.source_id) || {};
      return [h("span", { class: "nz-ltr", style: "background:" + (s.color || "#555") }, s.letter || "•"), h("span", { class: "nm" }, s.name || it.source_id),
        h("span", { class: "nz-rg" }, it.region === "ru" ? "RU" : T("МИР"))];
    }
    return [avatar(it.pub_name || "", it.pub_id, true, it.pub_avatar), h("span", { class: "nm" }, it.kind === "channel" ? kindIcon("horn") : null, it.pub_name || "", tick())];
  }
  const showRu = (it) => it.lang !== "ru" && it.title_ru && !en();
  /* фото и видео: публикации людей лежат в открытом бакете news, посты каналов — во вложениях канала */
  function mediaOf(it) {
    if (Array.isArray(it.media) && it.media.length) return it.media;
    if (it.image) return [{ url: it.image, kind: "image" }];
    if (it.image_path) return [{ bucket: "attachments", path: it.image_path, kind: "image" }];
    return [];
  }
  async function mediaUrl(m) {
    if (m.url) return m.url;
    if (m.bucket === "news") return sb.storage.from("news").getPublicUrl(m.path).data.publicUrl;
    return typeof signedUrl === "function" ? signedUrl(m.path) : null;
  }
  function thumb(it) {
    const ms = mediaOf(it), m = ms[0];
    const img = h("img", { class: "nz-th", alt: "", referrerpolicy: "no-referrer", hidden: true, onerror: (e) => { e.currentTarget.hidden = true; }, onload: (e) => { e.currentTarget.hidden = false; } });
    if (!m) return img;
    const wrap = h("span", { class: "nz-thw" });
    if (m.kind === "video") {
      const vid = h("video", { class: "nz-th", muted: true, playsinline: true, preload: "metadata" });
      vid.muted = true;
      mediaUrl(m).then((u) => { if (u) vid.src = u + "#t=0.5"; });
      wrap.append(vid, h("span", { class: "nz-play" }, h("span", {}, ico("play"))));
    } else {
      mediaUrl(m).then((u) => { if (u) img.src = u; });
      wrap.append(img);
    }
    if (ms.length > 1) wrap.append(h("span", { class: "nz-cnt" }, "1/" + ms.length));
    return wrap;
  }
  function gallery(it) {
    const ms = mediaOf(it);
    if (!ms.length) return null;
    const box = h("div", { class: "nz-gal" });
    for (const m of ms) {
      if (m.kind === "video") {
        const vid = h("video", { controls: true, playsinline: true, preload: "metadata" });
        mediaUrl(m).then((u) => { if (u) vid.src = u; });
        box.append(vid);
      } else {
        const img = h("img", { alt: "", referrerpolicy: "no-referrer", loading: "lazy", onerror: (e) => { e.currentTarget.remove(); },
          onclick: (e) => { if ($("viewerImg") && $("viewer")) { $("viewerImg").src = e.currentTarget.src; try { $("viewer").showModal(); } catch (er) {} } } });
        mediaUrl(m).then((u) => { if (u) img.src = u; });
        box.append(img);
      }
    }
    return box;
  }
  /* реакции без эмодзи: нравится, огонь, поддерживаю, звезда */
  const RX = [["heart", "Нравится"], ["fire", "Огонь"], ["up", "Поддерживаю"], ["star", "Звезда"]];
  const RX_SVG = {
    fire: '<path d="M12 21c-3.9 0-7-2.8-7-6.6 0-2.7 1.6-4.6 3.2-6.3.4 1.6 1.3 2.7 2.4 3.1C10.200 7.600 12.200 4.800 14.600 3c.3 3.200 4.400 5.400 4.400 10.800C19 17.900 16 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    up: '<path d="M7 11v9H4v-9zM7 11l4-8c1.700 0 2.600 1.200 2.300 2.800L12.700 9H19a2 2 0 012 2.300l-1.200 7A2 2 0 0117.800 20H7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' };
  function rxIco(k) {
    if (!RX_SVG[k]) return ico(k);
    const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = RX_SVG[k]; return s;
  }
  function reactBar(it, onComments) {
    const box = h("div", { class: "nz-rx", onclick: (e) => e.stopPropagation() });
    let busy = false;
    const paint = () => {
      const r = it.reactions || { counts: {} }, c = r.counts || {};
      box.replaceChildren(...RX.map(([k, n]) => h("button", { type: "button", title: T(n), "aria-label": T(n), "aria-pressed": String(r.mine === k), onclick: async () => {
        if (busy) return;
        busy = true;
        // сразу показываем результат, потом сверяем с сервером
        const old = JSON.parse(JSON.stringify(r)), was = r.mine;
        if (was) c[was] = Math.max(0, (c[was] || 1) - 1);
        if (was === k) r.mine = null; else { r.mine = k; c[k] = (c[k] || 0) + 1; }
        it.reactions = { counts: c, mine: r.mine }; paint();
        const { data, error } = await sb.rpc("news_react", { p_item: it.id, p_kind: k });
        busy = false;
        it.reactions = error ? old : data; paint();
      } }, rxIco(k), c[k] ? String(c[k]) : null)),
      h("button", { class: "cm", type: "button", title: T("Комментарии"), onclick: () => (onComments ? onComments() : openArticle(it, true)) }, ico("bubble"), it.comments ? String(it.comments) : T("Обсудить")));
    };
    paint();
    return box;
  }
  /* большое фото или видео в ленте — у публикаций авторов и каналов */
  function bigMedia(it) {
    const ms = mediaOf(it), m = ms[0];
    if (!m) return null;
    const box = h("div", { class: "nz-big-m" });
    if (m.kind === "video") {
      const vid = h("video", { muted: true, playsinline: true, preload: "metadata" });
      vid.muted = true;
      mediaUrl(m).then((u) => { if (u) vid.src = u + "#t=0.5"; });
      box.append(vid, h("span", { class: "nz-play" }, h("span", {}, ico("play"))));
    } else {
      const img = h("img", { alt: "", referrerpolicy: "no-referrer", onerror: () => box.remove() });
      mediaUrl(m).then((u) => { if (u) img.src = u; });
      box.append(img);
    }
    if (ms.length > 1) box.append(h("span", { class: "nz-cnt" }, "1/" + ms.length));
    return box;
  }
  /* матч: счёт, статистика и шансы — всё вводит автор */
  const MSTAT = [["possession", "Владение, %"], ["shots", "Удары"], ["on_target", "Удары в створ"], ["corners", "Угловые"], ["fouls", "Фолы"], ["yellow", "Жёлтые карточки"], ["red", "Красные карточки"]];
  function teamLogo(t) {
    const nm = (t && t.name) || "?";
    if (t && t.image) {
      const im = h("img", { class: "lg", alt: "", onclick: (e) => { e.stopPropagation(); if ($("viewerImg") && $("viewer")) { $("viewerImg").src = e.currentTarget.src; try { $("viewer").showModal(); } catch (er) {} } } });
      im.src = sb.storage.from("news").getPublicUrl(t.image).data.publicUrl;
      return im;
    }
    let hsh = 0; for (const ch of nm) hsh = (hsh * 31 + ch.codePointAt(0)) | 0;
    return h("span", { class: "lg", style: "background:hsl(" + (Math.abs(hsh) % 360) + " 55% 42%)" }, [...nm][0].toUpperCase());
  }
  function matchBlock(mt, full) {
    if (!mt || !mt.home || !mt.away) return null;
    const st = mt.status === "live" ? h("span", { class: "st live" }, T("Идёт") + (mt.minute ? " · " + mt.minute + "'" : ""))
      : mt.status === "ht" ? h("span", { class: "st" }, T("Перерыв"))
      : mt.status === "ft" ? h("span", { class: "st" }, T("Завершён"))
      : h("span", { class: "st" }, mt.starts_at ? new Date(mt.starts_at).toLocaleString(en() ? "en-US" : "ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : T("Скоро"));
    const sc = mt.status === "soon" ? h("div", { class: "sc" }, "– : –") : h("div", { class: "sc" }, (mt.score || [0, 0])[0] + " : " + (mt.score || [0, 0])[1]);
    const box = h("div", { class: "nz-match", onclick: (e) => { if (!full) return; e.stopPropagation(); } },
      h("div", { class: "top" }, h("span", {}, mt.league || T("Матч")), st),
      h("div", { class: "sb" }, h("div", { class: "tm" }, teamLogo(mt.home), mt.home.name), sc, h("div", { class: "tm" }, teamLogo(mt.away), mt.away.name)));
    const stats = mt.stats || {};
    const rows = MSTAT.filter(([k]) => Array.isArray(stats[k])).slice(0, full ? 9 : 2);
    if (rows.length) box.append(h("div", { class: "nz-stat" }, ...rows.map(([k, n]) => {
      const [a, b] = stats[k], tot = Math.max(1, a + b);
      return h("div", { class: "r" }, h("b", {}, k === "possession" ? a + "%" : String(a)),
        h("div", { class: "mid" }, T(n).replace(/, %$/, ""), h("div", { class: "bars" }, h("span", {}, h("i", { style: "width:" + Math.round((a / tot) * 100) + "%" })), h("span", {}, h("i", { style: "width:" + Math.round((b / tot) * 100) + "%" })))),
        h("b", {}, k === "possession" ? b + "%" : String(b)));
    })));
    if (Array.isArray(mt.odds) && mt.odds.some((x) => x > 0)) {
      const tot = Math.max(1, mt.odds[0] + mt.odds[1] + mt.odds[2]);
      const seg = (v, lab, col) => v > 0 ? h("span", { style: "flex:" + v + ";background:" + col, title: lab }, lab + " " + Math.round((v / tot) * 100) + "%") : null;
      box.append(h("div", { class: "nz-odds" }, h("div", { class: "lb" }, T("Шансы")),
        h("div", { class: "bar" }, seg(mt.odds[0], T("П1"), "var(--accent)"), seg(mt.odds[1], T("Ничья"), "#7c8a94"), seg(mt.odds[2], T("П2"), "#8a7cf6"))));
    }
    return box;
  }
  /* опрос: голос сразу по нажатию (несколько ответов — галочки и «Голосовать»), после — результаты */
  function pollBlock(it) {
    const box = h("div", { class: "nz-poll", onclick: (e) => e.stopPropagation() });
    let pl = it.poll, sel = new Set(), busy = false;
    const zoom = (e) => { e.stopPropagation(); if ($("viewerImg") && $("viewer")) { $("viewerImg").src = e.currentTarget.src; try { $("viewer").showModal(); } catch (er) {} } };
    const optImg = (o) => {
      if (!o.image) return null;
      const im = h("img", { class: "oi", alt: "", onclick: zoom });
      im.src = sb.storage.from("news").getPublicUrl(o.image).data.publicUrl;
      return im;
    };
    async function vote(ids) {
      if (busy) return;
      busy = true;
      const { data, error } = await sb.rpc("news_vote", { p_item: it.id, p_options: ids });
      busy = false;
      if (error) { toast(/closed/.test(error.message || "") ? T("Опрос уже закрыт") : T("Не получилось. Попробуйте ещё раз")); return; }
      it.poll = pl = data; sel = new Set(); paint();
    }
    function paint() {
      if (!pl) { box.replaceChildren(); return; }
      const voted = (pl.mine || []).length > 0, show = voted || pl.closed;
      const tot = Math.max(1, (pl.options || []).reduce((a, o) => a + Number(o.votes || 0), 0));
      const kids = [h("div", { class: "q" }, h("span", {}, pl.multi ? T("Опрос · несколько ответов") : T("Опрос")),
        pl.closed ? h("span", {}, T("закрыт")) : pl.closes_at ? h("span", {}, T("до ") + new Date(pl.closes_at).toLocaleDateString(en() ? "en-US" : "ru-RU", { day: "numeric", month: "short" })) : null)];
      for (const o of pl.options || []) {
        const mine = (pl.mine || []).includes(o.id), pc = Math.round((Number(o.votes || 0) / tot) * 100);
        if (show) {
          kids.push(h("div", { class: "nz-opt" + (mine ? " me" : "") }, h("span", { class: "fill", style: "width:" + pc + "%" }),
            mine ? h("span", { class: "ck" }, ico("check1")) : null, optImg(o), h("span", { class: "t" }, o.text), h("span", { class: "pc" }, pc + "%")));
        } else {
          const b = h("button", { class: "nz-opt" + (pl.multi ? " multi" : ""), type: "button", "aria-pressed": String(sel.has(o.id)), onclick: () => {
            if (!pl.multi) { vote([o.id]); return; }
            if (sel.has(o.id)) sel.delete(o.id); else sel.add(o.id);
            paint();
          } }, h("span", { class: "ck" }, sel.has(o.id) ? ico("check1") : null), optImg(o), h("span", { class: "t" }, o.text));
          kids.push(b);
        }
      }
      const foot = h("div", { class: "f" }, h("span", {}, T("Проголосовали: ") + (pl.voters || 0)));
      if (!show && pl.multi) foot.append(h("button", { type: "button", disabled: !sel.size, onclick: () => sel.size && vote([...sel]) }, T("Голосовать")));
      if (voted && !pl.closed) foot.append(h("button", { type: "button", onclick: () => vote([]) }, T("Отменить голос")));
      kids.push(foot);
      box.replaceChildren(...kids);
    }
    paint();
    return box;
  }
  /* курс: живая цена и график за неделю — как в кошельке */
  const ASSETS = { MST: { name: "MestCoin", img: "mst.png" }, TON: { name: "Toncoin", color: "#0098ea", letter: "T" }, USDT: { name: "Tether USD", color: "#26a17b", letter: "₮" } };
  function assetIcon(cur, cls) {
    const a = ASSETS[cur] || {};
    return a.img ? h("img", { class: cls || "co", src: a.img, alt: "" }) : h("span", { class: cls || "co", style: "background:" + a.color }, a.letter);
  }
  function rateBlock(cur) {
    const m = M();
    const pr = h("div", { class: "pr" }, "—"), ch = h("div", { class: "ch" });
    const b = h("button", { class: "nz-rate", type: "button", onclick: (e) => { e.stopPropagation(); if (window.MW) MW.open("asset", cur); } },
      assetIcon(cur), h("div", {}, h("b", {}, (ASSETS[cur] || {}).name || cur), h("small", {}, cur + T(" · за неделю"))), pr, ch);
    if (!m) return b;
    const paint = (pts) => {
      const p = m.rateOf(cur);
      const c = pts && pts.length > 1 ? (pts[pts.length - 1][1] / pts[0][1] - 1) * 100 : m.diffOf(cur);
      pr.replaceChildren(p ? m.money(p, m.priceDig(p)) : "—", c == null || !Number.isFinite(c) ? "" : h("small", { class: c >= 0 ? "nz-up" : "nz-dn" }, m.pct(c)));
      if (pts && pts.length > 1) ch.replaceChildren(spark(pts, 320, 64, true));
    };
    paint(m.chartPeek(cur, "W"));
    m.loadRates(false).then(() => m.loadChart(cur, "W")).then(paint).catch(() => {});
    return b;
  }
  function itemCard(it) {
    const ttl = showRu(it) ? it.title_ru : it.title, sum = showRu(it) ? it.summary_ru : it.summary;
    const img = thumb(it);
    const src = h("div", { class: "nz-src" }, ...srcBadge(it), h("span", {}, "· " + ago(it.published_at)),
      showRu(it) ? h("span", { class: "nz-tr" }, ico("globe"), T("Переведено")) : null,
      it.kind !== "rss" ? h("span", { class: "nz-tag" }, it.kind === "channel" ? T("Канал") : T("Автор")) : null);
    const big = it.kind !== "rss" && mediaOf(it).length;
    return h("div", { class: "nz-card" + (it.kind !== "rss" ? " vf" : ""), role: "button", tabindex: "0", onclick: () => openArticle(it),
      onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); openArticle(it); } } },
      src, h("div", { class: "nz-row", style: big ? "grid-template-columns:minmax(0,1fr)" : null }, h("div", {}, h("h4", {}, ttl), sum ? h("p", {}, sum) : null), big ? null : img),
      big ? bigMedia(it) : null,
      it.post_type === "match" && it.match ? matchBlock(it.match, false) : null,
      it.post_type === "poll" && it.poll ? pollBlock(it) : null, it.post_type === "rate" && it.rate_asset ? rateBlock(it.rate_asset) : null,
      reactBar(it));
  }

  let feed = [], feedBusy = false, feedSeq = 0, feedDirty = false;
  async function loadFeed(reset) {
    if (feedBusy && !reset) return;
    const seq = ++feedSeq;
    feedBusy = true;
    if (reset) {
      feed = [];
      list.replaceChildren(h("div", { class: "nz-skel" }), h("div", { class: "nz-skel" }), h("div", { class: "nz-skel" }));
      moreBtn.hidden = true;
      paintTop();
    }
    try {
      await loadSources();
      const before = !reset && feed.length ? feed[feed.length - 1].published_at : null;
      const { data, error } = await sb.rpc("news_feed", {
        p_category: prefs.cat === "top" ? null : prefs.cat, p_region: prefs.geo === "all" ? null : prefs.geo,
        p_sources: chosenSources(), p_pubs: !!prefs.pubs, p_before: before, p_limit: 30 });
      if (seq !== feedSeq) return;
      if (error) { if (reset) list.replaceChildren(h("div", { class: "nz-empty" }, T("Не удалось загрузить новости. Проверьте интернет."))); return; }
      const rows = Array.isArray(data) ? data : [];
      feed = feed.concat(rows);
      if (reset) list.replaceChildren();
      if (!feed.length) list.replaceChildren(h("div", { class: "nz-empty" }, T("Здесь пока пусто. Выберите больше источников — кнопка справа вверху.")));
      list.append(...rows.map(itemCard));
      moreBtn.hidden = rows.length < 30;
    } finally { if (seq === feedSeq) feedBusy = false; }
  }
  async function paintTop() {
    const kids = [];
    if (prefs.cat === "top" || prefs.cat === "business") { const c = marketCard(prefs.cat === "business"); if (c) kids.push(c); }
    topBox.replaceChildren(...kids);
    if (prefs.cat === "top") {
      const seq = feedSeq, c = await whatsNewCard().catch(() => null);
      if (c && seq === feedSeq) topBox.append(c);
    }
  }
  async function paintCta() {
    const { data } = await sb.rpc("news_my_status");
    status = data || null;
    paintHead();
    const me = status && status.me;
    const chans = (status && status.channels) || [];
    let text, sub;
    if (me && me.autopost) { text = T("Вы верифицированы"); sub = T("Публикуйте в Новостях — кнопка «+» вверху"); }
    else if (chans.some((c) => c.news)) { text = T("Ваш канал в Новостях"); sub = T("Новые посты канала попадают в ленту автоматически"); }
    else { text = T("Попасть в Новости"); sub = T("Подайте заявку на верификацию себя или своего канала"); }
    ctaBox.replaceChildren(h("button", { class: "nz-card", type: "button", onclick: openRequest },
      h("div", { class: "nz-cta" }, h("span", { class: "pico sky" }, ico("tick")), h("div", {}, h("b", {}, text), h("span", { class: "s" }, sub)), h("span", { class: "chev", style: "color:var(--muted);font-size:22px" }, "›"))));
  }

  /* ---------- статья ---------- */
  function openArticle(it, toComments) {
    go("article", (v) => {
      let ru = showRu(it);
      const ttl = h("h3", {}), sum = h("p", {});
      const paint = () => { ttl.textContent = ru ? it.title_ru : it.title; sum.textContent = (ru ? it.summary_ru : it.summary) || ""; sum.hidden = !sum.textContent; };
      paint();
      const kids = [subHead(it.kind === "rss" ? ((srcMap.get(it.source_id) || {}).name || T("Новость")) : it.pub_name || T("Новость"))];
      kids.push(gallery(it), h("div", { class: "nz-src" }, ...srcBadge(it), h("span", {}, "· " + ago(it.published_at) + " · " + T(CAT[it.category] || ""))), ttl);
      if (it.lang !== "ru" && it.title_ru) {
        const tb = h("button", { type: "button" });
        const lab = h("span", {});
        const pt = () => { lab.replaceChildren(ico("globe"), ru ? T("Переведено с английского") : T("Оригинал на английском")); tb.textContent = ru ? T("Оригинал") : T("Перевод"); };
        tb.onclick = () => { ru = !ru; paint(); pt(); };
        pt();
        kids.push(h("div", { class: "nz-trbox" }, lab, tb));
      }
      kids.push(sum);
      if (it.post_type === "poll" && it.poll) kids.push(pollBlock(it));
      if (it.post_type === "rate" && it.rate_asset) kids.push(rateBlock(it.rate_asset));
      if (it.post_type === "match" && it.match) {
        kids.push(matchBlock(it.match, true));
        if (it.kind === "user" && state.me && it.pub_id === state.me.id) kids.push(btn(T("Обновить счёт и статистику"), "", () => openCompose("match", it), "refresh"));
      }
      const cmBox = h("div", { class: "nz-cmts" });
      kids.push(reactBar(it, () => cmInput.focus()));
      const acts = h("div", { class: "nz-acts" });
      if (it.url) {
        const s = srcMap.get(it.source_id);
        acts.append(btn(T("Читать на сайте ") + (s ? s.name : T("источника")), "", () => window.open(it.url, "_blank", "noopener"), "share"));
      }
      if (it.kind === "channel" && it.chat_id) acts.append(btn(T("Открыть в канале"), it.url ? "ghost" : "", () => openPost(it), "horn"));
      if (it.kind === "user" && it.pub_id) acts.append(btn(T("Профиль автора"), "ghost", async () => {
        const r = await sb.from("profiles").select(PF).eq("id", it.pub_id).maybeSingle();
        if (r.data) showUser(r.data);
      }, "users"));
      acts.append(btn(T("Отправить в чат"), "ghost", () => shareItem(it), "send"));
      const mine = it.kind === "user" && state.me && it.pub_id === state.me.id;
      if (state.isAdmin || mine) acts.append(btn(T("Убрать из Новостей"), "ghost", () => removeItem(it), "trash"));
      kids.push(acts);
      if (it.kind === "rss") kids.push(h("div", { class: "nz-orig" }, T("Источник: ") + ((srcMap.get(it.source_id) || {}).site || "") + T(" · материал принадлежит автору")));
      // комментарии
      const cmHead = h("div", { class: "set-label", style: "margin:4px 2px 0" }, T("Комментарии"));
      const cmInput = h("textarea", { class: "input", rows: "1", maxlength: "1000", placeholder: T("Написать комментарий…") });
      cmInput.addEventListener("input", () => { cmInput.style.height = "auto"; cmInput.style.height = Math.min(120, cmInput.scrollHeight) + "px"; });
      const send = h("button", { class: "btn", type: "button", "aria-label": T("Отправить") }, ico("send"));
      const cmtEl = (c) => {
        const u = c.user || {};
        const el = h("div", { class: "nz-cmt" }, avatar(u.display_name || "", u.id, true, u.avatar_path),
          h("div", { class: "bb" }, h("div", { class: "hd" }, h("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, u.display_name || ""),
            u.verified || u.is_admin ? tick() : null, h("small", {}, ago(c.created_at)),
            c.can_delete ? h("button", { class: "del", type: "button", onclick: async () => {
              const { error } = await sb.rpc("news_comment_delete", { p_id: c.id });
              if (error) { toast(T("Не удалось")); return; }
              el.remove(); it.comments = Math.max(0, (it.comments || 1) - 1);
            } }, T("Удалить")) : null),
            h("div", { class: "tx" }, c.body)));
        return el;
      };
      send.onclick = async () => {
        const b = cmInput.value.trim();
        if (!b) return;
        send.disabled = true;
        const { data, error } = await sb.rpc("news_comment_add", { p_item: it.id, p_body: b });
        send.disabled = false;
        if (error) { toast(/limit/.test(error.message || "") ? T("Слишком часто — попробуйте позже") : T("Не удалось отправить")); return; }
        cmInput.value = ""; cmInput.style.height = "";
        cmBox.querySelector(".nz-empty")?.remove();
        cmBox.append(cmtEl(data));
        it.comments = (it.comments || 0) + 1;
      };
      cmInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia && matchMedia("(pointer:fine)").matches) { e.preventDefault(); send.onclick(); } });
      cmBox.replaceChildren(h("div", { class: "nz-skel", style: "height:48px" }));
      kids.push(cmHead, cmBox, h("div", { class: "nz-cbar" }, cmInput, send));
      v.replaceChildren(h("div", { class: "nz-art", style: "display:flex;flex-direction:column;gap:12px" }, ...kids));
      sb.rpc("news_comments_list", { p_item: it.id }).then(({ data }) => {
        const rows = Array.isArray(data) ? data : [];
        cmBox.replaceChildren(...(rows.length ? rows.map(cmtEl) : [h("div", { class: "nz-empty", style: "padding:10px" }, T("Комментариев пока нет — будьте первым."))]));
        if (toComments) setTimeout(() => { cmHead.scrollIntoView({ block: "start", behavior: motionOK() ? "smooth" : "auto" }); }, 80);
      });
    });
  }
  async function openPost(it) {
    const id = it.chat_id;
    if (state.chats.has(id)) { close(); await openChat(id); if (it.message_id && typeof jumpTo === "function") setTimeout(() => jumpTo(it.message_id), 300); return; }
    showChannel({ id, title: it.pub_name, username: it.pub_username, avatar_path: it.pub_avatar, is_channel: true, members: it.members, joined: !!it.joined, description: "" });
  }
  function shareItem(it) {
    const ttl = showRu(it) ? it.title_ru : it.title;
    const link = it.url || (it.kind === "channel" && it.pub_username ? location.origin + "/@" + it.pub_username : "");
    const text = ttl + (link ? "\n" + link : "");
    if (typeof shareTextToChat === "function") shareTextToChat(text);
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(T("Скопировано")));
  }
  async function removeItem(it) {
    if (!confirm(T("Убрать эту новость из ленты для всех?"))) return;
    const { error } = await sb.rpc("news_delete", { p_id: it.id });
    if (error) { toast(T("Не удалось убрать")); return; }
    toast(T("Убрано из Новостей"));
    feed = feed.filter((x) => x.id !== it.id);
    back(); loadFeed(true);
  }

  /* ---------- источники ---------- */
  function openSources() {
    go("sources", async (v) => {
      v.replaceChildren(subHead(T("Мои источники")), h("div", { class: "nz-skel" }));
      await loadSources();
      const pill = (s) => h("button", { class: "nz-pill", type: "button", "aria-pressed": String(!!prefs.src[s.id]), onclick: (e) => {
        prefs.src[s.id] = !prefs.src[s.id]; savePrefs(); feedDirty = true;
        e.currentTarget.setAttribute("aria-pressed", String(!!prefs.src[s.id])); count();
      } }, h("i", { style: "background:" + (s.color || "#555") }, s.letter || "•"), s.name);
      const rows = CATS.filter(([k]) => k !== "top").map(([k, n]) => h("div", { class: "r" }, h("span", { class: "c" }, T(n)),
        h("div", { class: "cl" }, ...sources.filter((s) => s.category === k && s.region === "ru").map(pill)),
        h("div", { class: "cl" }, ...sources.filter((s) => s.category === k && s.region === "world").map(pill))));
      const pubs = h("button", { class: "nz-pill", type: "button", "aria-pressed": String(!!prefs.pubs), onclick: (e) => {
        prefs.pubs = !prefs.pubs; savePrefs(); feedDirty = true; e.currentTarget.setAttribute("aria-pressed", String(prefs.pubs));
      } }, tick(), T("Проверенные каналы и авторы"));
      const cnt = h("span", {});
      const count = () => { cnt.textContent = T("Выбрано: ") + chosenSources().length; };
      count();
      v.replaceChildren(subHead(T("Мои источники")),
        h("div", { class: "hint" }, T("Выберите, откуда показывать новости. Зарубежные переводим на русский.")),
        h("div", { class: "nz-tbl" }, h("div", { class: "r h" }, h("span", {}, T("Категория")), h("span", {}, T("Россия")), h("span", {}, T("Мир"))), ...rows,
          h("div", { class: "r" }, h("span", { class: "c" }, "Mestario"), h("div", { class: "cl", style: "grid-column:span 2" }, pubs))),
        h("div", { class: "hint" }, cnt),
        h("div", { class: "nz-card nz-status" }, h("b", { style: "color:var(--ink)" }, T("Как это работает")), h("br"),
          T("В ленте — заголовок, короткий анонс и ссылка на оригинал. Полный материал читается на сайте источника. Посты верифицированных каналов Mestario попадают сюда автоматически.")));
    });
  }

  /* ---------- заявка на верификацию ---------- */
  function openRequest() {
    go("request", async (v) => {
      v.replaceChildren(subHead(T("Верификация")), h("div", { class: "nz-skel" }));
      const { data } = await sb.rpc("news_my_status");
      status = data || status || {};
      const chans = (status.channels || []).filter((c) => !c.private);
      const kids = [subHead(T("Верификация"))];
      kids.push(h("div", { class: "nz-status" }, T("Галочку выдают администраторы Mestario. Верифицированный канал попадает в Новости автоматически: каждый новый пост появляется в ленте. Верифицированный человек публикует прямо из Новостей.")));
      const rowFor = (title, st) => h("div", { class: "nz-card nz-cta", style: "grid-template-columns:minmax(0,1fr) auto" }, h("b", {}, title), h("span", { class: st.ok ? "nz-ok" : "nz-status" }, st.text));
      const stOf = (news, pending, verified) => news ? { ok: true, text: T("в Новостях · ") + catsLabel(news) } : pending ? { text: T("заявка на проверке") } : verified ? { ok: true, text: T("галочка есть") } : { text: T("нет") };
      kids.push(h("div", { class: "lbl set-label" }, T("Статус")), rowFor(T("Я"), stOf(status.me, status.pending, state.profile && state.profile.verified)));
      for (const c of chans) kids.push(rowFor(c.title, stOf(c.news, c.pending, c.verified)));
      const opts = (status.me || status.pending ? [] : [h("option", { value: "" }, T("Себя (") + "@" + (state.profile ? state.profile.username : "") + ")")])
        .concat(chans.filter((c) => !c.news && !c.pending).map((c) => h("option", { value: c.id }, T("Канал «") + c.title + "»")));
      const sel = h("select", { class: "input" }, ...opts);
      const why = h("textarea", { class: "input", maxlength: "500", placeholder: T("О чём вы пишете, сколько ведёте канал, ссылки на работы") });
      const send = btn(T("Отправить заявку"), "", async () => {
        if (why.value.trim().length < 3) { toast(T("Напишите пару слов о себе или канале")); return; }
        send.disabled = true;
        const { error } = await sb.rpc("news_request", { p_chat: sel.value || null, p_reason: why.value.trim() });
        send.disabled = false;
        if (error) { toast(rpcErr(error)); return; }
        toast(T("Заявка отправлена — администраторы рассмотрят её"));
        back(); paintCta();
      });
      if (opts.length) kids.push(h("div", { class: "nz-form" }, h("div", { class: "lbl" }, T("Новая заявка")), sel, why, send,
        chans.length ? null : h("div", { class: "hint" }, T("Чтобы подать заявку за канал, он должен быть публичным (с @юзернеймом), а вы — его администратором."))));
      else kids.push(h("div", { class: "hint" }, T("Новых заявок подать пока не за кого: всё уже в Новостях или на проверке.")));
      v.replaceChildren(...kids);
    });
  }

  /* ---------- публикация от верифицированного человека ---------- */
  // загрузка файла в бакет news (фото сжимаются в webp, видео — как есть, до 100 МБ)
  async function uploadNews(file, kind) {
    let body = file, ext, type;
    if (kind === "image" && !/gif$/i.test(file.type)) { body = await toWebp(file, 2000); ext = "webp"; type = "image/webp"; }
    else { type = file.type || (kind === "video" ? "video/mp4" : "image/jpeg"); ext = ((/\.([a-z0-9]{2,5})$/i.exec(file.name) || [])[1] || type.split("/")[1] || "bin").toLowerCase(); }
    if (ext === "quicktime") ext = "mov";
    const path = state.me.id + "/" + randomId() + "." + ext;
    const up = await sb.storage.from("news").upload(path, body, { contentType: type, cacheControl: "31536000" });
    if (up.error) throw up.error;
    return path;
  }
  const upErr = (e) => toast(/size|large|exceed/i.test(String(e && e.message)) ? T("Файл больше 100 МБ") : T("Не удалось загрузить файл"));

  let composeKind = "post";
  function openCompose(kind, editItem) {
    if (kind) composeKind = kind;
    go("compose", (v) => {
      const t = h("input", { class: "input", maxlength: "160" });
      const x = h("textarea", { class: "input", maxlength: "2000" });
      const u = h("input", { class: "input", type: "url", maxlength: "500", placeholder: T("Ссылка (необязательно)") });
      const me = (status && status.me) || {};
      // фото и видео: до 10 штук; загружаются сразу после выбора
      const items = [];   // { file, kind, url, path, done, fail, el }
      const pick = h("div", { class: "nz-pick" });
      const inp = h("input", { type: "file", accept: "image/*,video/*", multiple: true, hidden: true });
      const add = h("button", { class: "add", type: "button", onclick: () => inp.click() }, ico("cam"), T("Фото / видео"));
      const paintPick = () => { pick.replaceChildren(...items.map((m) => m.el), ...(items.length < 10 ? [add] : [])); };
      inp.addEventListener("change", () => {
        const files = [...inp.files]; inp.value = "";
        for (const f of files) {
          if (items.length >= 10) { toast(T("Не больше 10 фото и видео")); break; }
          const kind = /^video\//.test(f.type) ? "video" : /^image\//.test(f.type) ? "image" : null;
          if (!kind) { toast(T("Можно только фото и видео")); continue; }
          if (f.size > 104857600) { toast(T("Файл больше 100 МБ")); continue; }
          const url = URL.createObjectURL(f);
          const m = { file: f, kind, url, bar: h("span", { class: "bar", style: "width:35%" }) };
          const prev = kind === "video" ? h("video", { src: url + "#t=0.3", muted: true, playsinline: true, preload: "metadata" }) : h("img", { src: url, alt: "" });
          m.el = h("div", { class: "it" }, prev, kind === "video" ? h("span", { class: "nz-play" }, h("span", {}, ico("play"))) : null, m.bar,
            h("button", { class: "x", type: "button", "aria-label": T("Убрать"), onclick: () => {
              items.splice(items.indexOf(m), 1); URL.revokeObjectURL(url);
              if (m.path) sb.storage.from("news").remove([m.path]).catch(() => {});
              paintPick();
            } }, "×"));
          items.push(m);
          m.up = uploadNews(f, kind).then((pth) => { m.path = pth; m.done = true; m.bar.style.width = "100%"; setTimeout(() => { m.bar.hidden = true; }, 400); })
            .catch((e) => { m.fail = true; m.bar.style.width = "100%"; m.bar.style.background = "#e5484d"; upErr(e); });
        }
        paintPick();
      });
      paintPick();

      // опрос: варианты ответа (2–10), у каждого может быть фото
      const opts = [];   // { inp, path, up, el }
      const optsBox = h("div", { class: "nz-opts" });
      const addOpt = h("button", { class: "btn ghost", type: "button", onclick: () => { newOpt(); paintOpts(); opts[opts.length - 1].inp.focus(); } }, ico("plus"), T("Добавить вариант"));
      function newOpt() {
        const o = { inp: h("input", { class: "input", maxlength: "100", placeholder: T("Вариант ответа") }) };
        const fi = h("input", { type: "file", accept: "image/*", hidden: true });
        const ph = h("button", { class: "ph", type: "button", title: T("Фото к варианту"), "aria-label": T("Фото к варианту"), onclick: () => fi.click() }, ico("cam"));
        fi.addEventListener("change", () => {
          const f = fi.files[0]; fi.value = "";
          if (!f || !/^image\//.test(f.type)) return;
          const url = URL.createObjectURL(f);
          ph.replaceChildren(h("img", { src: url, alt: "" }));
          o.path = null; o.fail = false;
          o.up = uploadNews(f, "image").then((pth) => { o.path = pth; }).catch((e) => { o.fail = true; ph.replaceChildren(ico("cam")); upErr(e); });
        });
        o.el = h("div", { class: "nz-orow" }, o.inp, ph, fi, h("button", { class: "rm", type: "button", "aria-label": T("Убрать"), onclick: () => {
          if (opts.length <= 2) { toast(T("В опросе минимум 2 варианта")); return; }
          opts.splice(opts.indexOf(o), 1);
          if (o.path) sb.storage.from("news").remove([o.path]).catch(() => {});
          paintOpts();
        } }, "×"));
        opts.push(o);
      }
      const paintOpts = () => { optsBox.replaceChildren(...opts.map((o) => o.el)); addOpt.hidden = opts.length >= 10; };
      newOpt(); newOpt(); paintOpts();
      const multi = h("input", { type: "checkbox" });
      const days = h("select", { class: "input" }, ...[[0, "Без срока"], [1, "1 день"], [3, "3 дня"], [7, "7 дней"], [30, "30 дней"]].map(([d, n]) => h("option", { value: String(d) }, T(n))));
      const pollBox = h("div", { class: "nz-form" }, h("div", { class: "lbl" }, T("Варианты ответа")), optsBox, addOpt,
        h("label", { class: "toggle" }, multi, h("span", {}, T("Можно выбрать несколько ответов"))),
        h("div", { class: "lbl" }, T("Сколько длится опрос")), days);

      // курс: какой график показать
      let asset = "MST";
      const assets = h("div", { class: "nz-assets" });
      const rateBox = h("div", { class: "nz-form" }, h("div", { class: "lbl" }, T("Курс")), assets, h("div", {}));
      const paintAssets = () => {
        assets.replaceChildren(...Object.keys(ASSETS).map((c) => h("button", { type: "button", "aria-pressed": String(asset === c), onclick: () => { asset = c; paintAssets(); } }, assetIcon(c), c)));
        rateBox.lastChild.replaceChildren(rateBlock(asset));
      };
      paintAssets();

      // матч: команды с фото, счёт, статус, статистика и шансы
      const mt0 = (editItem && editItem.match) || {};
      const num = (val, ph) => { const i = h("input", { class: "input", type: "number", inputmode: "numeric", min: "0", max: "999", placeholder: ph || "0" }); if (val != null && val !== "") i.value = String(val); return i; };
      const team = (side) => {
        const t0 = mt0[side] || {};
        const o = { path: t0.image || null, name: h("input", { class: "input", maxlength: "40", placeholder: side === "home" ? T("Хозяева") : T("Гости") }) };
        o.name.value = t0.name || "";
        const fi = h("input", { type: "file", accept: "image/*", hidden: true });
        const ph = h("button", { class: "ph", type: "button", title: T("Логотип или фото"), "aria-label": T("Логотип или фото"), onclick: () => fi.click() },
          t0.image ? h("img", { src: sb.storage.from("news").getPublicUrl(t0.image).data.publicUrl, alt: "" }) : ico("cam"));
        fi.addEventListener("change", () => {
          const f = fi.files[0]; fi.value = "";
          if (!f || !/^image\//.test(f.type)) return;
          ph.replaceChildren(h("img", { src: URL.createObjectURL(f), alt: "" }));
          o.path = null; o.fail = false;
          o.up = uploadNews(f, "image").then((pth) => { o.path = pth; }).catch((e) => { o.fail = true; ph.replaceChildren(ico("cam")); upErr(e); });
        });
        o.el = h("div", { class: "nz-team" }, ph, fi, o.name);
        return o;
      };
      const mHome = team("home"), mAway = team("away");
      const league = h("input", { class: "input", maxlength: "60", placeholder: T("Турнир, например: Кубок, полуфинал") });
      league.value = mt0.league || "";
      let mStatus = mt0.status || "soon";
      const statusSeg = h("div", { class: "seg", role: "tablist" });
      const minute = num(mt0.minute || "", T("Минута"));
      const starts = h("input", { class: "input", type: "datetime-local" });
      if (mt0.starts_at) try { const d = new Date(mt0.starts_at); starts.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } catch (e) {}
      const sh = num((mt0.score || [])[0]), sa = num((mt0.score || [])[1]);
      const scoreRow = h("div", { class: "nz-me" }, h("span", { class: "lab" }, T("Счёт")), sh, sa, h("span", {}));
      const paintStatus = () => {
        statusSeg.replaceChildren(...[["soon", "Скоро"], ["live", "Идёт"], ["ht", "Перерыв"], ["ft", "Завершён"]].map(([k, n]) =>
          h("button", { type: "button", role: "tab", "aria-checked": String(mStatus === k), onclick: () => { mStatus = k; paintStatus(); } }, T(n))));
        minute.hidden = mStatus !== "live"; starts.hidden = mStatus !== "soon"; scoreRow.hidden = mStatus === "soon";
      };
      paintStatus();
      const st0 = mt0.stats || {};
      const statIn = MSTAT.map(([k, n]) => { const a = num((st0[k] || [])[0], "—"), b = num((st0[k] || [])[1], "—"); return { k, a, b, el: h("div", { class: "nz-me" }, h("span", { class: "lab" }, T(n)), a, b, h("span", {})) }; });
      const od0 = mt0.odds || [];
      const o1 = num(od0[0], "%"), ox = num(od0[1], "%"), o2 = num(od0[2], "%");
      const matchBox = h("div", { class: "nz-form" }, h("div", { class: "lbl" }, T("Матч")), league, h("div", { class: "nz-teams" }, mHome.el, mAway.el),
        h("div", { class: "lbl" }, T("Статус")), statusSeg, minute, starts, scoreRow,
        h("div", { class: "lbl" }, T("Статистика (необязательно)")), h("div", { class: "nz-me" }, h("span", {}), h("span", { class: "lab", style: "text-align:center" }, T("Хоз.")), h("span", { class: "lab", style: "text-align:center" }, T("Гости")), h("span", {})),
        ...statIn.map((r) => r.el),
        h("div", { class: "lbl" }, T("Шансы, % (необязательно)")), h("div", { class: "nz-me", style: "grid-template-columns:repeat(3,minmax(0,1fr))" },
          h("label", { class: "lab", style: "display:grid;gap:4px;text-align:center" }, T("П1"), o1), h("label", { class: "lab", style: "display:grid;gap:4px;text-align:center" }, T("Ничья"), ox), h("label", { class: "lab", style: "display:grid;gap:4px;text-align:center" }, T("П2"), o2)));
      const matchData = () => {
        const nv = (i) => (i.value === "" ? null : String(Math.max(0, Math.round(Number(i.value) || 0))));
        const stats = {};
        for (const r of statIn) if (r.a.value !== "" && r.b.value !== "") stats[r.k] = [nv(r.a), nv(r.b)];
        const m = { league: league.value.trim(), status: mStatus, minute: nv(minute) || "0", score: [nv(sh) || "0", nv(sa) || "0"], stats,
          home: { name: mHome.name.value.trim(), image: mHome.path || null }, away: { name: mAway.name.value.trim(), image: mAway.path || null } };
        if (mStatus === "soon" && starts.value) m.starts_at = new Date(starts.value).toISOString();
        if (o1.value !== "" || ox.value !== "" || o2.value !== "") m.odds = [nv(o1) || "0", nv(ox) || "0", nv(o2) || "0"];
        return m;
      };
      const teamWait = async () => {
        const ups = [mHome, mAway].filter((o) => o.up && !o.path && !o.fail).map((o) => o.up);
        if (ups.length) { toast(T("Дожидаемся загрузки фото и видео…")); await Promise.all(ups); }
        return ![mHome, mAway].some((o) => o.fail);
      };

      // раздел и регион — если админ разрешил несколько
      const cats = (me.categories && me.categories.length ? me.categories : [me.category]).filter(Boolean);
      const regs = (me.regions && me.regions.length ? me.regions : [me.region]).filter(Boolean);
      let pCat = cats[0], pReg = regs[0];
      const catChips = h("div", { class: "nz-chips" }), regChips = h("div", { class: "nz-chips" });
      const paintWhere = () => {
        catChips.replaceChildren(...cats.map((c) => h("button", { type: "button", "aria-pressed": String(pCat === c), onclick: () => { pCat = c; paintWhere(); } }, T(CAT[c] || c))));
        regChips.replaceChildren(...regs.map((r) => h("button", { type: "button", "aria-pressed": String(pReg === r), onclick: () => { pReg = r; paintWhere(); } }, r === "ru" ? T("Россия") : T("Мир"))));
      };
      paintWhere();
      const whereBox = h("div", { class: "nz-form", hidden: cats.length < 2 && regs.length < 2 },
        cats.length > 1 ? h("div", { class: "lbl" }, T("Раздел")) : null, cats.length > 1 ? catChips : null,
        regs.length > 1 ? h("div", { class: "lbl" }, T("Регион")) : null, regs.length > 1 ? regChips : null);

      const kindSeg = h("div", { class: "seg", role: "tablist" });
      const paintKind = () => {
        kindSeg.replaceChildren(...[["post", "Пост"], ["poll", "Опрос"], ["rate", "Курс"], ["match", "Матч"]].map(([k, n]) =>
          h("button", { type: "button", role: "tab", "aria-checked": String(composeKind === k), onclick: () => { composeKind = k; paintKind(); } }, T(n))));
        pollBox.hidden = composeKind !== "poll";
        rateBox.hidden = composeKind !== "rate";
        matchBox.hidden = composeKind !== "match";
        t.placeholder = composeKind === "poll" ? T("Вопрос") : composeKind === "match" ? T("Заголовок (необязательно)") : T("Заголовок");
        x.placeholder = composeKind === "poll" ? T("Пояснение (необязательно)") : composeKind === "rate" ? T("Ваш комментарий к курсу") : composeKind === "match" ? T("Комментарий к матчу (необязательно)") : T("Текст новости");
      };
      paintKind();

      if (editItem) {   // обновление матча по ходу игры
        const save = btn(T("Сохранить"), "", async () => {
          if (!mHome.name.value.trim() || !mAway.name.value.trim()) { toast(T("Укажите обе команды")); return; }
          save.disabled = true;
          try {
            if (!(await teamWait())) { toast(T("Уберите файлы, которые не загрузились")); return; }
            const { data, error } = await sb.rpc("news_match_update", { p_item: editItem.id, p_match: matchData() });
            if (error) { toast(T("Не получилось. Попробуйте ещё раз")); return; }
            editItem.match = data; toast(T("Сохранено"));
            back(); feedDirty = true; openArticle(editItem);
          } finally { save.disabled = false; }
        }, "check1");
        v.replaceChildren(subHead(T("Обновить матч")), matchBox, save);
        return;
      }

      const pub = btn(T("Опубликовать"), "", async () => {
        if (composeKind === "match" && (!mHome.name.value.trim() || !mAway.name.value.trim())) { toast(T("Укажите обе команды")); return; }
        if (t.value.trim().length < 3 && !(composeKind === "match" && !t.value.trim())) { toast(composeKind === "poll" ? T("Вопрос — от 3 до 160 символов") : T("Заголовок — от 3 до 160 символов")); return; }
        let poll = null;
        if (composeKind === "poll") {
          const filled = opts.filter((o) => o.inp.value.trim());
          if (filled.length < 2) { toast(T("В опросе минимум 2 варианта")); return; }
          poll = { filled };
        }
        pub.disabled = true;
        try {
          const waits = items.map((m) => m.up).concat(poll ? poll.filled.map((o) => o.up).filter(Boolean) : []);
          if (items.some((m) => !m.done && !m.fail) || (poll && poll.filled.some((o) => o.up && !o.path && !o.fail))) { toast(T("Дожидаемся загрузки фото и видео…")); await Promise.all(waits); }
          if (items.some((m) => m.fail) || (poll && poll.filled.some((o) => o.fail))) { toast(T("Уберите файлы, которые не загрузились")); return; }
          const media = items.map((m) => ({ path: m.path, kind: m.kind }));
          const args = { p_title: t.value.trim(), p_text: x.value.trim(), p_url: u.value.trim() || null, p_media: media.length ? media : null, p_kind: composeKind };
          if (poll) args.p_poll = { multi: multi.checked, days: Number(days.value) || 0, options: poll.filled.map((o) => ({ text: o.inp.value.trim(), image: o.path || null })) };
          if (composeKind === "rate") args.p_rate = asset;
          if (composeKind === "match") { if (!(await teamWait())) { toast(T("Уберите файлы, которые не загрузились")); return; } args.p_match = matchData(); }
          args.p_category = pCat; args.p_region = pReg;
          const { error } = await sb.rpc("news_publish", args);
          if (error) { toast(rpcErr(error)); return; }
          toast(T("Опубликовано в Новостях"));
          items.forEach((m) => URL.revokeObjectURL(m.url));
          feedDirty = true; back();
        } finally { pub.disabled = false; }
      });
      v.replaceChildren(subHead(T("Написать в Новости")),
        h("div", { class: "nz-card nz-status" }, tick(), " ", T("Вы верифицированы — публикация сразу появится в ленте.")),
        kindSeg, whereBox, matchBox, h("div", { class: "nz-form" }, t, x), pollBox, rateBox, h("div", { class: "nz-form" }, h("div", { class: "lbl" }, T("Фото и видео")), pick, inp, u, pub));
      setTimeout(() => t.focus(), 50);
    });
  }

  /* ---------- админка: верификация ---------- */
  let admTab = "req";
  function openAdmin() {
    if (!state.isAdmin) return;
    go("admin", (v) => paintAdmin(v));
  }
  function admRow(o) {
    const av = avatar(o.name || "", o.target, true, o.avatar_path);
    return h("div", { class: "who" }, av, h("div", { style: "min-width:0" }, h("b", {}, o.kind === "channel" ? kindIcon("horn") : null, o.name || "", o.verified ? tick() : null),
      h("small", {}, (o.username ? "@" + o.username : "") + (o.members != null ? " · " + o.members + T(" подписч.") : ""))), h("span", { class: "nz-kind" }, o.kind === "channel" ? T("Канал") : T("Человек")));
  }
  async function paintAdmin(v) {
    const tabs = h("div", { class: "seg", role: "tablist" }, ...[["req", "Заявки"], ["on", "Выданные"], ["off", "Отозванные"]].map(([k, n]) =>
      h("button", { type: "button", role: "tab", "aria-checked": String(admTab === k), onclick: () => { admTab = k; paintAdmin(v); } }, T(n))));
    const q = h("input", { class: "input", type: "search", placeholder: T("Выдать по @юзернейму или ссылке"), autocomplete: "off" });
    const found = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
    q.addEventListener("input", debounce(async () => {
      const s = q.value.trim();
      if (s.length < 2) { found.replaceChildren(); return; }
      const { data } = await sb.rpc("news_admin_lookup", { p_q: s });
      const rows = Array.isArray(data) ? data : [];
      found.replaceChildren(...(rows.length ? rows.map((o) => h("button", { class: "nz-card nz-req", type: "button", onclick: () => openGrant(o) }, admRow(o),
        o.news ? h("div", { class: "meta" }, h("span", { class: "nz-ok" }, T("В Новостях · ") + catsLabel(o.news))) : null)) : [h("div", { class: "hint" }, T("Никого не нашли. Канал должен быть публичным."))]));
    }, 300));
    const box = h("div", { style: "display:flex;flex-direction:column;gap:10px" }, h("div", { class: "nz-skel" }));
    v.replaceChildren(subHead(T("Верификация")), tabs, q, found, box);
    if (admTab === "req") {
      const { data, error } = await sb.rpc("news_admin_requests");
      const rows = error ? [] : data || [];
      box.replaceChildren(...(rows.length ? rows.map((r) => {
        const o = r.kind === "channel"
          ? { kind: "channel", target: r.chat_id, name: r.title, username: r.chat_username, avatar_path: r.chat_avatar, members: r.members }
          : { kind: "user", target: r.user_id, name: r.display_name, username: r.username, avatar_path: r.avatar_path, verified: r.user_verified };
        return h("div", { class: "nz-card nz-req" }, admRow(o), h("div", { class: "why" }, r.reason),
          h("div", { class: "meta" }, r.kind === "channel" ? h("span", {}, T("Постов: ") + r.posts) : null, h("span", {}, T("Жалоб: ") + r.reports),
            r.kind === "channel" ? h("span", {}, T("от @") + r.username) : null, h("span", {}, ago(r.created_at))),
          h("div", { class: "ab" }, btn(T("Отклонить"), "ghost", async () => {
            const { error: e } = await sb.rpc("news_admin_reject", { p_id: r.id });
            if (e) toast(T("Не удалось")); else { toast(T("Заявка отклонена")); paintAdmin(v); }
          }), btn(T("Выдать"), "", () => openGrant(o), "check1")));
      }) : [h("div", { class: "nz-empty" }, T("Новых заявок нет."))]));
    } else {
      const { data, error } = await sb.rpc("news_admin_list", { p_revoked: admTab === "off" });
      const rows = error ? [] : data || [];
      box.replaceChildren(...(rows.length ? rows.map((o) => h("button", { class: "nz-card nz-req", type: "button", onclick: () => openGrant({ ...o, verified: admTab === "on", news: admTab === "on" ? o : null }) },
        admRow({ ...o, verified: admTab === "on" }),
        h("div", { class: "meta" }, h("span", {}, catsLabel(o) + " · " + regsLabel(o)), h("span", {}, o.autopost ? T("автопостинг") : T("без автопостинга")),
          h("span", {}, T("публикаций: ") + o.items), h("span", {}, ago(o.at))))) : [h("div", { class: "nz-empty" }, admTab === "on" ? T("Пока никому не выдано.") : T("Отозванных нет."))]));
    }
  }
  const catsLabel = (o) => { const c = o.categories || [o.category]; return c.length >= 9 ? T("все разделы") : c.map((k) => T(CAT[k] || k)).join(", "); };
  const regsLabel = (o) => { const r = o.regions || [o.region]; return r.length === 2 ? T("Россия и Мир") : r[0] === "ru" ? T("Россия") : T("Мир"); };
  function openGrant(o) {
    go("grant", (v) => {
      const cur = o.news || {};
      const ALL = CATS.filter(([k]) => k !== "top").map(([k]) => k);
      let kind = o.kind, auto = cur.autopost !== false;
      // порядок важен: первый выбранный раздел — основной (в него идут посты канала)
      let cats = (cur.categories && cur.categories.length ? cur.categories : [cur.category || "news"]).slice();
      let regs = (cur.regions && cur.regions.length ? cur.regions : [cur.region || "ru"]).slice();
      const sel = h("div", { class: "nz-chips" }), regSeg = h("div", { class: "nz-chips" });
      const paintCats = () => {
        const all = ALL.every((k) => cats.includes(k));
        sel.replaceChildren(h("button", { type: "button", "aria-pressed": String(all), onclick: () => { cats = all ? [cats[0]] : [cats[0]].concat(ALL.filter((k) => k !== cats[0])); paintCats(); } }, T("Все разделы")),
          ...CATS.filter(([k]) => k !== "top").map(([k, n]) => h("button", { type: "button", "aria-pressed": String(cats.includes(k)), onclick: () => {
            if (cats.includes(k)) { if (cats.length > 1) cats = cats.filter((x) => x !== k); } else cats.push(k);
            paintCats();
          } }, T(n) + (cats[0] === k && cats.length > 1 ? " · " + T("основной") : ""))));
      };
      const paintReg = () => {
        const both = regs.length === 2;
        regSeg.replaceChildren(h("button", { type: "button", "aria-pressed": String(both), onclick: () => { regs = both ? [regs[0]] : ["ru", "world"]; paintReg(); } }, T("Оба региона")),
          ...[["ru", "Россия"], ["world", "Мир"]].map(([k, n]) => h("button", { type: "button", "aria-pressed": String(regs.includes(k)), onclick: () => {
            if (regs.includes(k)) { if (regs.length > 1) regs = regs.filter((x) => x !== k); } else regs.push(k);
            paintReg();
          } }, T(n))));
      };
      paintCats(); paintReg();
      const sw = h("input", { type: "checkbox" });
      sw.checked = auto; sw.onchange = () => { auto = sw.checked; };
      const give = btn(o.news ? T("Сохранить") : T("Выдать верификацию"), "", async () => {
        give.disabled = true;
        const { error } = await sb.rpc("news_admin_grant", { p_kind: kind, p_target: o.target, p_categories: cats, p_regions: regs, p_autopost: auto });
        give.disabled = false;
        if (error) { toast(T("Не удалось выдать: ") + (error.message || "")); return; }
        toast(o.news ? T("Сохранено") : T("Верификация выдана"));
        if (kind === "channel" && state.chats.has(o.target)) { state.chats.get(o.target).verified = true; if (typeof renderList === "function") renderList(); }
        feedDirty = true; back(); paintAdmin(view("admin"));
      }, "check1");
      const kids = [subHead(o.news ? T("Верификация") : T("Выдать верификацию")), h("div", { class: "nz-card nz-req" }, admRow(o)),
        h("div", { class: "nz-form" },
          h("div", { class: "lbl" }, T("Разделы в Новостях")), sel,
          h("div", { class: "hint" }, kind === "channel" ? T("Посты канала идут в основной раздел — он выбран первым.") : T("Автор сам выбирает раздел из разрешённых при публикации.")),
          h("div", { class: "lbl" }, T("Регион")), regSeg,
          h("label", { class: "toggle" }, sw, h("span", {}, T("Автопостинг в Новости"), h("br"), h("span", { class: "muted small" },
            kind === "channel" ? T("Новые посты канала сразу появляются в ленте") : T("Человек может публиковать прямо из Новостей")))),
          give)];
      if (o.news || o.verified) kids.push(btn(T("Снять верификацию"), "ghost", async () => {
        if (!confirm(T("Снять галочку и убрать из Новостей?"))) return;
        const { error } = await sb.rpc("news_admin_revoke", { p_kind: kind, p_target: o.target });
        if (error) { toast(T("Не удалось")); return; }
        toast(T("Верификация снята"));
        if (kind === "channel" && state.chats.has(o.target)) { state.chats.get(o.target).verified = false; if (typeof renderList === "function") renderList(); }
        feedDirty = true; back(); paintAdmin(view("admin"));
      }, "trash"));
      v.replaceChildren(...kids);
    });
  }

  /* ---------- открыть / закрыть ---------- */
  let opened = false;
  function open(sub) {
    if (!state || !state.started) return;
    const first = !opened;
    opened = true;
    if (!page.open) page.showModal();
    stack = [];
    show("feed", true);
    paintHead(); paintCats();
    if (first || feedDirty || !feed.length || Date.now() - (open.at || 0) > 5 * 60000) { feedDirty = false; loadFeed(true); open.at = Date.now(); }
    paintCta().catch(() => {});
    if (sub === "admin") openAdmin();
    if (typeof paintTabs === "function") paintTabs();
  }
  function close() { page.close(); }
  window.MNews = { open, close, page, isOpen: () => page.open };
})();
