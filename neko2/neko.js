/*!
 * neko.js（v2：PixelLabのコマ絵版） — ページの中で自由に猫する黒猫
 * --------------------------------------------------------------
 * 使い方（どのページにも1行で入る）:
 *   <script src="/neko2/neko.js" defer></script>
 *
 * 画像 neko1-sheet.png は neko.js と同じフォルダに置く。
 * v1（1枚絵を切り貼りした版）との違いは「描く部分」だけ。頭脳・足場・物理・反応は共通。
 *
 * コマ絵（neko1-sheet.png：103x98 のコマが横に9つ）
 *   0〜7 = 歩き（右向き、PixelLabの骨で動かす方式で生成）
 *   0    = 立ち止まっているときもこのコマ
 *   8    = まばたき（0のコマの目を消したもの）
 *   左向きは反転で作る
 *
 * オプション（scriptタグの data-属性）:
 *   data-scale="2"           ドットの拡大率（整数推奨。初期はPC=2、スマホ幅=1）
 *                            1より小さくもできる（例 0.75）。そのときはドットを間引かず、なめらかに縮めて描く
 *   data-platforms="..."     猫が乗れる要素のCSSセレクタ（上書き）
 *   data-extra-platforms="..." 既定の乗れる要素に「追加」するセレクタ
 *   data-z="2147483000"      重なり順
 *   data-start="drop|walk"   登場のしかた（上から落ちてくる/画面端から歩いてくる）
 *
 * 自分のページで「ここに乗ってほしい」要素には data-neko-platform を付ける。
 * 逆に乗ってほしくない要素には data-neko-ignore を付ける。
 *
 * 外から操作するAPI:  window.Neko.say("にゃ") / .hide() / .show() / .sleep() / .wake()
 *
 * ふるまい一覧:
 *   ① 待機中は呼吸してまばたきする。カーソルが近いと首をかしげて見る
 *   ② ページの見出し・画像・ボタン等の「上の辺」を床として歩く／ジャンプして乗り移る
 *   ③ スクロールで足場が流れると、ちゃんと落ちて下の足場に着地する
 *   ④ クリック → 「にゃ」と鳴いて跳ねる。連打すると怒って逃げる
 *   ⑤ 猫の上でカーソルをゆっくり動かす（なでる）→ 目を細めてゴロゴロ、ハートが出る
 *      スマホは猫を長押しでなでる
 *   ⑥ ドラッグでつまみ上げられる。投げると放物線で飛んで着地する
 *   ⑦ カーソルを猫の近くで素早く動かす → お尻を振って飛びかかる
 *   ⑧ 退屈すると毛づくろい・のび・昼寝（Zzz）。夜中（0〜6時）はよく寝る
 *   ⑨ カーソルを猫の近くでじっと止めておくと、ゆっくりまばたき（猫の「好き」の合図）
 *   ⑩ 「動きを減らす」設定のOSでは、ジャンプせずのんびり過ごす
 */
(() => {
  'use strict';
  if (window.Neko) return; // 二重読み込み防止

  // ---------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------
  const script = document.currentScript;
  const ds = (script && script.dataset) || {};
  const baseUrl = script && script.src ? script.src.replace(/[^/]*$/, '') : '/neko/';

  const DEFAULT_PLATFORMS = [
    'h1', 'h2', 'h3', 'img', 'video', 'picture', 'svg:not(.neko-ignore-svg)',
    'button', 'a.button', '.btn', 'pre', 'blockquote', 'table', 'figure',
    'input', 'textarea', 'select', '.card', '[data-neko-platform]',
  ].join(',');

  const extCfg = window.NekoConfig || {};
  const CFG = {
    scale: Number(extCfg.scale || ds.scale || (innerWidth < 600 ? 1 : 2)),
    platforms: extCfg.platforms || ds.platforms ||
      (DEFAULT_PLATFORMS + (ds.extraPlatforms || extCfg.extraPlatforms ? ',' + (ds.extraPlatforms || extCfg.extraPlatforms) : '')),
    z: Number(extCfg.z || ds.z || 2147483000),
    start: extCfg.start || ds.start || 'drop',
    // 吹き出し（「にゃ」等）は出さないのが標準。data-bubble="on" で出す。Neko.say() は常に出る
    bubbles: (extCfg.bubble || ds.bubble) === 'on',
    sprite: extCfg.sprite || ds.sprite || baseUrl + 'neko1-sheet.png',
    spriteFallback: baseUrl + 'neko1-sheet.png',
  };

  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------
  // コマ絵の一覧（build_sheet.py が書き出した manifest をここに埋め込む）
  //   cell    = コマ1枚の大きさ [幅, 高さ]
  //   foot    = コマの中で「足元」にあたる点 [x, y]（ここを猫の立ち位置に合わせる）
  //   idleBox = 立ちコマで猫が写っている範囲 [左, 上, 右, 下]（当たり判定・物理の大きさに使う）
  //   clips   = 動きごとの { s:開始コマ, n:コマ数, fps:速さ }
  //   blink   = { 目あきコマ番号: 目つぶりコマ番号 }
  //   jump    = ジャンプの動きの中で「溜め／上昇／落下／着地」に使うコマ（jumpの中の何コマ目か）
  // ---------------------------------------------------------------
  const MF = /*MANIFEST*/{"cell":[156,120],"foot":[85.5,113],"idleBox":[42,20,129,113],"clips":{"walk":{"s":0,"n":8,"fps":10},"sit":{"s":8,"n":8,"fps":10},"liedown":{"s":16,"n":10,"fps":9},"getup":{"s":26,"n":8,"fps":10},"lick":{"s":34,"n":12,"fps":9},"jump":{"s":46,"n":8,"fps":14},"sleep":{"s":54,"n":9,"fps":4},"dangle":{"s":63,"n":9,"fps":8},"tailStand":{"s":72,"n":9,"fps":6},"tailSit":{"s":81,"n":9,"fps":6},"tailLoaf":{"s":90,"n":9,"fps":6},"tailSleep":{"s":99,"n":9,"fps":4},"lickTail":{"s":108,"n":9,"fps":8},"stretch":{"s":117,"n":13,"fps":8},"meow":{"s":130,"n":9,"fps":8},"yawn":{"s":139,"n":9,"fps":8},"swipe":{"s":148,"n":9,"fps":10},"shake":{"s":157,"n":9,"fps":12},"rollover":{"s":166,"n":13,"fps":8},"knead":{"s":179,"n":9,"fps":8},"facewash":{"s":188,"n":13,"fps":8},"hunt":{"s":201,"n":13,"fps":10},"yannoPose":{"s":214,"n":9,"fps":12},"yannoStep":{"s":223,"n":9,"fps":10},"frontSit":{"s":232,"n":17,"fps":8},"lieSphinx":{"s":249,"n":17,"fps":8},"lieSide":{"s":266,"n":17,"fps":8},"lieBelly":{"s":283,"n":17,"fps":8},"lieGomen":{"s":300,"n":17,"fps":8},"lieChin":{"s":317,"n":17,"fps":8},"punch":{"s":334,"n":9,"fps":14},"frontSwipe":{"s":343,"n":9,"fps":12},"tapRapid":{"s":352,"n":13,"fps":14},"punchCombo":{"s":365,"n":13,"fps":14},"flopPlay":{"s":378,"n":17,"fps":10},"lieSwipe":{"s":395,"n":13,"fps":12},"lieKick":{"s":408,"n":13,"fps":14},"lookStand":{"s":421,"n":13,"fps":8},"lookSit":{"s":434,"n":13,"fps":8},"lookLoaf":{"s":447,"n":13,"fps":8},"lookFront":{"s":460,"n":13,"fps":8},"lieMelt":{"s":473,"n":17,"fps":8},"lieTwist":{"s":490,"n":17,"fps":8},"liePaws":{"s":507,"n":17,"fps":8},"lookBack":{"s":524,"n":13,"fps":8},"lieFlirt":{"s":537,"n":17,"fps":8},"sitAlert":{"s":554,"n":13,"fps":8},"rub":{"s":567,"n":13,"fps":8},"scratch":{"s":580,"n":13,"fps":10},"chatter":{"s":593,"n":13,"fps":10},"startle":{"s":606,"n":13,"fps":12},"lookSphinx":{"s":619,"n":13,"fps":8},"lookChin":{"s":632,"n":13,"fps":8},"legGroom":{"s":645,"n":13,"fps":8},"earScratch":{"s":658,"n":13,"fps":12},"sneeze":{"s":671,"n":13,"fps":10},"headTilt":{"s":684,"n":13,"fps":8},"lipLick":{"s":697,"n":13,"fps":10},"tailWrap":{"s":710,"n":17,"fps":8},"chestGroom":{"s":727,"n":13,"fps":9},"backGroom":{"s":740,"n":13,"fps":9},"lookBackSit":{"s":753,"n":13,"fps":8},"sitToLoaf":{"s":766,"n":13,"fps":10},"sniff":{"s":779,"n":13,"fps":8},"hindStand":{"s":792,"n":13,"fps":10},"turnAround":{"s":805,"n":13,"fps":12},"greet":{"s":818,"n":13,"fps":9},"stretchBack":{"s":831,"n":13,"fps":8},"lookBackStand":{"s":844,"n":13,"fps":8},"loafDoze":{"s":857,"n":17,"fps":6},"loafYawn":{"s":874,"n":13,"fps":8},"loafLick":{"s":887,"n":13,"fps":9},"loafStretch":{"s":900,"n":13,"fps":8},"tailThump":{"s":913,"n":13,"fps":10},"pawFace":{"s":926,"n":17,"fps":8},"sideStretch":{"s":943,"n":13,"fps":8},"bellyStretch":{"s":956,"n":13,"fps":8},"dream":{"s":969,"n":13,"fps":8},"frontTilt":{"s":982,"n":13,"fps":8},"frontMeow":{"s":995,"n":13,"fps":8},"frontYawn":{"s":1008,"n":13,"fps":8},"frontLick":{"s":1021,"n":13,"fps":8},"sideGroom":{"s":1034,"n":13,"fps":8},"sphinxYawn":{"s":1047,"n":13,"fps":8},"pouncePin":{"s":1060,"n":13,"fps":10},"curlWake":{"s":1073,"n":13,"fps":7}},"blink":{"0":1086,"15":1087,"25":1088,"34":1089,"35":1090,"36":1091,"37":1092,"38":1093,"39":1094,"40":1095,"41":1096,"42":1097,"45":1098,"72":1099,"73":1100,"74":1101,"75":1102,"76":1103,"77":1104,"78":1105,"79":1106,"80":1107,"81":1108,"82":1109,"83":1110,"84":1111,"85":1112,"86":1113,"87":1114,"88":1115,"89":1116,"90":1117,"91":1118,"92":1119,"93":1120,"94":1121,"95":1122,"96":1123,"97":1124,"98":1125,"232":1126,"233":1127,"235":1128,"247":248,"248":1130,"421":1131,"422":1132,"423":1133,"424":1134,"425":1135,"426":1136,"427":1137,"428":1138,"429":1139,"430":1140,"431":1141,"432":1142,"433":1143,"434":1144,"435":1145,"436":1146,"437":1147,"438":1148,"439":1149,"440":1150,"441":1151,"442":1152,"443":1153,"444":1154,"445":1155,"446":1156,"447":1157,"448":1158,"449":1159,"450":1160,"451":1161,"452":1162,"453":1163,"454":1164,"455":1165,"456":1166,"457":1167,"458":1168,"459":1169,"524":1170,"525":1171,"526":1172,"527":1173,"528":1174,"529":1175,"530":1176,"531":1177,"532":1178,"533":1179,"534":1180,"535":1181,"536":1182,"507":1183,"508":1184,"509":1185,"510":1186,"511":1187,"512":1188,"513":523,"514":523,"522":523,"523":1192,"537":1193,"538":1194,"539":1195,"540":1196,"541":1197,"542":1198,"543":1199,"544":1200,"545":551,"546":551,"547":551,"548":551,"549":551,"550":551,"553":551,"554":1208,"555":1209,"557":1210,"558":1211,"559":1212,"560":1213,"561":1214,"562":1215,"563":1216,"564":1217,"565":1218,"566":1219,"593":1220,"594":1221,"595":1222,"596":1223,"597":1224,"598":1225,"599":1226,"600":1227,"601":1228,"602":1229,"603":1230,"604":1231,"605":1232,"624":1233,"625":1234,"626":1235,"628":1236,"629":1237,"631":1238,"632":1239,"633":1240,"634":1241,"635":1242,"636":1243,"637":1244,"638":1245,"639":1246,"640":1247,"641":1248,"642":1249,"643":1250,"644":1251,"710":1252,"711":1253,"712":1254,"753":1255,"754":1256,"756":1257,"757":1258,"758":1259,"759":1260,"760":1261,"761":1262,"762":1263,"763":1264,"764":1265,"765":1266,"844":1267,"845":1268,"846":1269,"847":1270,"848":1271,"849":1272,"850":1273,"851":1274,"852":1275,"853":1276,"854":1277,"855":1278,"856":1279,"818":1280,"819":1281,"820":1282,"821":1283,"822":1284,"823":1285,"824":1286,"825":1287,"826":1288,"827":1289,"828":1290,"829":1291,"830":1292,"779":1293,"780":1294,"781":1295,"782":1296,"783":1297,"784":1298,"785":1299,"786":1300,"787":1301,"788":1302,"789":1303,"790":1304,"791":1305,"249":1306,"250":1307,"251":1308,"252":1309,"253":1310,"254":1311,"317":1312,"318":1313,"319":1314,"320":1315,"321":1316,"322":1317,"325":1318,"332":1319,"333":1320,"237":248,"238":248,"239":248,"240":248,"241":248,"242":248,"243":248,"244":248,"245":248,"246":248,"515":523,"516":523,"517":523,"518":523,"519":523,"520":523,"521":523,"552":551},"jump":{"crouch":[0,1],"rise":3,"fall":4,"land":[6,7]},"holds":{"0":"tailStand","15":"tailSit","25":"tailLoaf"},"drop":{"49":12,"50":26},"walkD":[7,10,7,1,4,6,1,4],"huntParts":{"crouch":[0,3],"wiggle":[4,12]},"spots":{"front":{"clip":"frontSit","base":"sit","enter":[0,5],"loop":[5,16],"sleep":false},"sphinx":{"clip":"lieSphinx","base":"loaf","enter":[0,5],"loop":[5,16],"sleep":false},"side":{"clip":"lieSide","base":"loaf","enter":[0,5],"loop":[5,16],"sleep":true},"belly":{"clip":"lieBelly","base":"loaf","enter":[0,6],"loop":[6,16],"sleep":true},"gomen":{"clip":"lieGomen","base":"loaf","enter":[0,5],"loop":[5,16],"sleep":true},"chin":{"clip":"lieChin","base":"loaf","enter":[0,5],"loop":[5,16],"sleep":false},"play":{"clip":"flopPlay","base":"sit","enter":[0,3],"loop":[3,16],"sleep":false,"state":"play"},"melt":{"clip":"lieMelt","base":"loaf","enter":[0,5],"loop":[5,16],"sleep":true},"twist":{"clip":"lieTwist","base":"loaf","enter":[0,6],"loop":[6,16],"sleep":true},"paws":{"clip":"liePaws","base":"loaf","enter":[0,6],"loop":[6,16],"sleep":false},"flirt":{"clip":"lieFlirt","base":"loaf","enter":[0,8],"loop":[8,16],"sleep":false},"wrap":{"clip":"tailWrap","base":"sit","enter":[0,4],"loop":[4,16],"sleep":false,"state":"lie"},"pawface":{"clip":"pawFace","base":"loaf","enter":[0,4],"loop":[4,16],"sleep":true}},"punchHit":{"punch":0.6,"swipe":0.38,"frontSwipe":0.42,"tapRapid":[0.25,0.5,0.7],"punchCombo":[0.25,0.62],"lieSwipe":[0.2,0.65],"lieKick":[0.3,0.6]},"gaze":{"stand":{"clip":"lookStand","range":[6,12],"kind":"pitch","back":{"clip":"lookBackStand","range":[0,12]}},"sit":{"clip":"lookSit","range":[6,12],"kind":"pitch","back":{"clip":"lookBackSit","range":[0,12]}},"loaf":{"clip":"lookLoaf","range":[7,12],"kind":"pitch","back":{"clip":"lookBack","range":[0,12]}},"front":{"clip":"lookFront","range":[3,12],"kind":"yaw","leftIsScreenLeft":true},"sphinx":{"clip":"lookSphinx","range":[5,12],"kind":"pitch"},"chin":{"clip":"lookChin","range":[2,12],"kind":"pitch"}},"actHold":{"sitAlert":6,"hindStand":6,"headTilt":5,"frontTilt":6},"loops":{"sleep":[4,8],"dangle":[3,8]},"hang":[88.0,6.7],"cols":32}/*END*/;
  const SP_W = MF.cell[0], SP_H = MF.cell[1];
  const CL = MF.clips;
  const IDLE = CL.walk.s;                             // 立ち止まっているときのコマ
  const [IB_L, IB_T, IB_R, IB_B] = MF.idleBox;
  const FOOT = { x: MF.foot[0], y: MF.foot[1] };
  const HEAD = { cx: IB_R - (IB_R - IB_L) * 0.18, cy: IB_T + (IB_B - IB_T) * 0.16 }; // 顔の中心（吹き出し用）
  // つまむ場所：「ぶらーん」の絵があれば、その絵の中の手の位置（manifest.hang）。無ければ首の後ろあたり
  const SCRUFF = MF.hang ? { x: MF.hang[0], y: MF.hang[1] }
                         : { x: IB_L + (IB_R - IB_L) * 0.62, y: IB_T + (IB_B - IB_T) * 0.12 };
  const LOOPS = MF.loops || {};
  // 歩きの1コマごとに体が進む量（コマ上のドット）。足が地面を滑らないよう、コマごとに進む速さを変える
  const WALK_D = MF.walkD || new Array(MF.clips.walk.n).fill(5);
  const WALK_D_MEAN = WALK_D.reduce((a, b) => a + b, 0) / WALK_D.length;                        // くり返す区間 { 動き: [何コマ目から, 何コマ目まで] }
  const STRIDE = 5;                                   // 歩きで1コマ進めるのに必要な移動量（コマ上のピクセル）

  // 表示サイズ（ドット絵なので整数倍で拡大してにじませない）
  const S = CFG.scale;                                // コマ→表示の倍率
  const DW = SP_W * S, DH = SP_H * S;                 // コマ1枚の表示サイズ
  const W = Math.round((IB_R - IB_L) * S);            // 猫の体の幅（物理・足場の判定に使う）
  const H = Math.round((IB_B - IB_T) * S);            // 猫の体の高さ
  const PAD_X = 2;
  const PAD_T = 2;
  const PAD_B = Math.max(0, ...Object.values(MF.drop || {})) * S; // 空中コマを下げて描く分の余白
  const CW = DW + PAD_X * 2;
  const CH = DH + PAD_T + PAD_B;
  const OX = PAD_X + FOOT.x * S, OY = PAD_T + FOOT.y * S; // 要素の中の足元の位置

  // 物理
  const G = 2400;                                     // 重力(px/s^2)
  const WALK_SPEED = reducedMotion ? 40 : 70;
  const RUN_SPEED = 300;

  // ---------------------------------------------------------------
  // DOM組み立て
  // ---------------------------------------------------------------
  const css = `
  .neko-root{position:fixed;inset:0;pointer-events:none;z-index:${CFG.z};overflow:hidden;contain:strict}
  .neko-cat{position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;pointer-events:none;will-change:transform;
    transform-origin:${OX}px ${OY}px}
  .neko-cat canvas{width:${CW}px;height:${CH}px;display:block;image-rendering:pixelated;image-rendering:crisp-edges}
  .neko-hit{position:absolute;left:${PAD_X + IB_L * S}px;top:${PAD_T + IB_T * S}px;width:${W}px;height:${H}px;
    pointer-events:auto;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  .neko-cat.held .neko-hit{cursor:${MF.hang ? 'none' : 'grabbing'}}  /* 絵の中に手があるときは、カーソルを隠して絵の手を自分の手に見せる */
  .neko-bubble{position:absolute;left:0;top:0;padding:4px 10px;border-radius:12px;background:#fff;color:#111;
    font:700 13px/1.3 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;white-space:nowrap;
    box-shadow:0 2px 10px rgba(0,0,0,.18);opacity:0;transition:opacity .15s;pointer-events:none}
  .neko-bubble::after{content:"";position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#fff}
  .neko-bubble.on{opacity:1}
  html.neko-knock, html.neko-knock *{cursor:none !important}
  .neko-cursor{position:fixed;left:0;top:0;width:22px;height:28px;pointer-events:none;z-index:${CFG.z + 1};display:none;will-change:transform}
  .neko-fx{position:absolute;left:0;top:0;pointer-events:none;font:700 16px/1 system-ui,sans-serif;
    animation:neko-float 1.6s ease-out forwards;text-shadow:0 1px 2px rgba(0,0,0,.25)}
  @keyframes neko-float{0%{opacity:0;transform:translate(0,0) scale(.6)}15%{opacity:1}
    100%{opacity:0;transform:translate(var(--dx,10px),-46px) scale(1.1)}}
  `;
  const style = document.createElement('style');
  style.textContent = css;

  const root = document.createElement('div');
  root.className = 'neko-root';
  root.setAttribute('aria-hidden', 'true');
  const catEl = document.createElement('div');
  catEl.className = 'neko-cat';
  const canvas = document.createElement('canvas');
  const hit = document.createElement('div');
  hit.className = 'neko-hit';
  catEl.append(canvas, hit);
  const bubble = document.createElement('div');
  bubble.className = 'neko-bubble';
  root.append(catEl, bubble);
  // 猫パンチで吹っ飛ばす用の「偽カーソル」。殴られた瞬間だけ本物のカーソルを隠してこれを出す
  // （ブラウザは本物のカーソルを動かせないため、見た目で再現する）
  const fakeCursor = document.createElement('div');
  fakeCursor.className = 'neko-cursor';
  fakeCursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M1.5 1.5 L1.5 21 L6.5 16.5 L10 25 L13.5 23.5 L10 15.5 L16.5 15.5 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  root.appendChild(fakeCursor);

  const ctx = canvas.getContext('2d');
  let dpr = 1;
  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
  }

  // ---------------------------------------------------------------
  // 画像読み込み（横並びのコマ絵をそのまま使う）
  // ---------------------------------------------------------------
  const sprite = new Image();
  let frames = null; // 読み込み済みなら true

  function makeFrames() { frames = true; }

  // ---------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------
  const cat = {
    x: 0, y: 0,          // 足元（下辺の中央）の画面座標
    vx: 0, vy: 0,
    facing: 1,           // 1=右向き（元絵の向き）, -1=左向き
    plat: null,          // 立っている足場
    state: 'air',
    stateT: 0,           // 今の状態に入ってからの秒数
    stateDur: 0,         // 今の状態の予定時間
    targetX: 0,
    speed: WALK_SPEED,
    // 見た目
    headAngle: 0, headTarget: 0,
    anim: null,          // 再生中の動き（play() で入る）
    walkDist: 0,         // 歩いた距離
    walkPhase: 0,        // 歩きのコマ送りの位置（小数。整数部分が今のコマ）
    beforePurr: null,    // なでられる前の状態（なで終わったら戻る）
    pose: 'stand',       // 今いる駅（stand / sit / loaf / curl）
    queue: [],           // これからやる予定（駅への移動・動き・休み）
    step: null,          // 予定のうち、今やっている一歩
    tailT: 0,            // 尻尾ゆらゆらの再生位置（秒）
    blinkUntil: 0, nextBlink: 1.5,
    eyesClosed: false,
    sx: 1, sy: 1, rot: 0, offY: 0, offX: 0,
    turnPulse: 0,
    breath: 0,
    boredom: 0,          // 退屈ゲージ（寝る確率が上がる）
    pendingJump: null,
    hidden: false,
  };

  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, speed: 0, lastMove: 0, stillSince: 0, samples: [], revs: [], lastSg: 0 };
  // 直近 sec 秒のうちに、カーソルを左右に何回振り返したか
  const recentShakes = (sec) => { const t = performance.now() / 1000; return pointer.revs.filter((r) => t - r < sec).length; };
  let now = 0;            // 経過秒
  let lastHuntAt = -99;
  let lastSlowBlinkAt = -99;
  const clicks = [];       // 直近のクリック時刻
  let petAmount = 0;       // なでた量（時間で減る）
  let lastPetAt = -99;

  // ---------------------------------------------------------------
  // 足場（乗れる要素）の収集
  // ---------------------------------------------------------------
  const TEXT_TAGS = /^(H1|H2|H3)$/;
  let platforms = [];
  let platformsAt = -1;

  const floor = () => ({ el: null, floor: true, left: 0, right: innerWidth, top: innerHeight });

  // 要素の「乗る面」を返す。見出しは文字そのものの1行目の上に乗る
  function surfaceOf(el) {
    if (!el.isConnected) return null;
    if (TEXT_TAGS.test(el.tagName)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      let first = null;
      for (const r of rects) { if (r.width > 4 && r.height > 4) { first = r; break; } }
      if (first) {
        // 同じ行の矩形をまとめて1行目の横幅を出す
        let left = first.left, right = first.right;
        for (const r of rects) {
          if (Math.abs(r.top - first.top) < 3 && r.width > 0) { left = Math.min(left, r.left); right = Math.max(right, r.right); }
        }
        // 行の上の余白(ハーフリーディング)ぶん下げて、文字の頭に足が付くようにする
        return { left, right, top: first.top + first.height * 0.16 };
      }
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, right: r.right, top: r.top };
  }

  function isVisible(el, s) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) return false;
    // 上に何か被っていないか（モーダル等）を、乗る面のすぐ下の1点で確認
    const px = Math.min(Math.max((s.left + s.right) / 2, 1), innerWidth - 1);
    const py = Math.min(Math.max(s.top + 3, 1), innerHeight - 1);
    const hitEl = document.elementFromPoint(px, py);
    if (!hitEl) return false;
    return hitEl === el || el.contains(hitEl) || hitEl.contains(el) || root.contains(hitEl);
  }

  function collectPlatforms() {
    const vw = innerWidth, vh = innerHeight;
    const list = [];
    let els;
    try { els = document.querySelectorAll(CFG.platforms); } catch (e) { els = []; }
    for (const el of els) {
      if (root.contains(el) || el.closest('[data-neko-ignore]')) continue;
      const s = surfaceOf(el);
      if (!s) continue;
      const left = Math.max(s.left, 0), right = Math.min(s.right, vw);
      if (right - left < W * 0.55) continue;            // 狭すぎて乗れない
      if (s.top < H * 0.8 || s.top > vh - 12) continue;  // 画面外・頭がはみ出す位置
      if (!isVisible(el, s)) continue;
      list.push({ el, floor: false, left, right, top: s.top });
    }
    // 入れ子で同じ高さの足場は1つにまとめる（picture>img など）
    list.sort((a, b) => a.top - b.top);
    const out = [];
    for (const p of list) {
      if (!out.some(q => Math.abs(q.top - p.top) < 4 && q.left < p.right && p.left < q.right)) out.push(p);
    }
    out.push(floor());
    platforms = out;
    platformsAt = now;
  }

  function refreshPlatformsIfStale(maxAge) {
    if (now - platformsAt > maxAge) collectPlatforms();
  }

  // ---------------------------------------------------------------
  // 状態遷移
  // ---------------------------------------------------------------
  function setState(s, dur = 0) {
    cat.state = s;
    cat.stateT = 0;
    cat.stateDur = dur;
    cat.anim = null; // 状態が変わったら再生中の動きは止める（必要なら直後に play する）
  }

  // 動きの再生。from/to は動きの中の何コマ目から何コマ目までか（省略で全部）
  //   loop=true でくり返し、rev=true で逆再生（座る→立つ に使う）。最後のコマで止まる
  //   pingpong=true で「最後まで行ったら逆戻り」をくり返す（最初と最後の絵が違う動きのつなぎ目を消す）
  function play(name, { loop = false, rev = false, from = 0, to = null, pingpong = false } = {}) {
    const c = CL[name];
    if (!c) return false;
    const n = (to == null ? c.n - 1 : to) - from + 1;
    cat.anim = { s: c.s + from, n, fps: c.fps, loop: loop || pingpong, pp: pingpong, rev, t: 0 };
    return true;
  }
  // 往復再生のコマ番号（0,1,…,n-1,n-2,…,1,0,1,…）
  const pingpongIndex = (k, n) => { if (n < 2) return 0; const m = k % (2 * n - 2); return m < n ? m : 2 * n - 2 - m; };
  const clipDur = (name) => (CL[name] ? CL[name].n / CL[name].fps : 0);

  function animIndex() {
    const a = cat.anim;
    let k = Math.floor(a.t * a.fps);
    k = a.pp ? pingpongIndex(k, a.n) : a.loop ? k % a.n : Math.min(k, a.n - 1);
    if (a.rev) k = a.n - 1 - k;
    return a.s + k;
  }

  // ---------------------------------------------------------------
  // 駅と線路（姿勢のつなぎ方）
  //   駅 = 猫が落ち着いていられる姿勢：stand（立ち）/ sit（座り）/ loaf（香箱）/ curl（丸まって寝る）
  //   線路 = 駅と駅をつなぐ動き。全部の動きは「どの駅で始まり、どの駅で終わるか」が決まっている
  //   やりたい動きがあると、今の駅からその動きの駅までの線路を探して、順番に再生してから動きに入る
  //   → どこからどこへでも、絵が飛ばずに流れるようにつながる
  // ---------------------------------------------------------------
  const TRACKS = [
    // [出発駅, 到着駅, 再生のしかた]
    ['stand', 'sit',   () => play('sit')],
    ['sit',   'stand', () => play('sit', { rev: true })],
    ['stand', 'loaf',  () => play('liedown')],
    ['loaf',  'stand', () => play('getup')],
    ['loaf',  'curl',  () => play('sleep', { to: LOOPS.sleep ? LOOPS.sleep[0] : null })],
    ['sit',   'loaf',  () => play('sitToLoaf')],                 // 座りから、立たずにそのまま伏せる
    ['loaf',  'sit',   () => play('sitToLoaf', { rev: true })],  // 伏せから、そのまま上体を起こして座る
    ['stand', 'arch',  () => play('yannoPose')],                 // やんのかポーズになる
    ['arch',  'stand', () => play('yannoPose', { rev: true })],  // 毛が戻って普通に立つ
    ['curl',  'loaf',  () => { // 丸まりをほどく：丸くなる動きを倍速で逆再生
      const ok = play('sleep', { from: 0, to: LOOPS.sleep ? LOOPS.sleep[0] : null, rev: true });
      if (ok) cat.anim.fps *= 2; return ok; }],
  ].filter(([a, b]) => {
    // 絵が無い線路は使わない
    const need = { 'stand>sit': 'sit', 'sit>stand': 'sit', 'stand>loaf': 'liedown', 'loaf>stand': 'getup', 'loaf>curl': 'sleep', 'curl>loaf': 'sleep',
                   'stand>arch': 'yannoPose', 'arch>stand': 'yannoPose', 'sit>loaf': 'sitToLoaf', 'loaf>sit': 'sitToLoaf' }[a + '>' + b];
    return !!CL[need];
  });

  // 寝そべり・正面座りの駅（manifest.spots）：1本の絵の前半が「香箱（または座り）からその姿勢になる」線路、
  // 後半が「その姿勢でくつろぐ」ループ。ここで線路と駅を足す
  //   spots[名前] = { clip, base: つながる駅, enter: [始, 終], loop: [始, 終], sleep: 寝ている姿勢か }
  const SPOTS = {};
  for (const [name, sp] of Object.entries(MF.spots || {})) {
    if (!CL[sp.clip]) continue;
    SPOTS[name] = sp;
    TRACKS.push([sp.base, name, () => play(sp.clip, { from: sp.enter[0], to: sp.enter[1] })]);
    TRACKS.push([name, sp.base, () => play(sp.clip, { from: sp.enter[0], to: sp.enter[1], rev: true })]);
  }

  const FRONT_SPOT = Object.keys(SPOTS).find((k) => (SPOTS[k].state || (SPOTS[k].base === 'sit' ? 'front' : 'lie')) === 'front');
  const PLAY_SPOT = Object.keys(SPOTS).find((k) => SPOTS[k].state === 'play');   // ゴロンして寝転んでじゃれる駅
  // カーソルが猫の近くで止まっている時間（秒）。じっと見ていると、猫もこっちを向いて見つめ返す
  const stillNear = () => {
    const d = Math.hypot(pointer.x - cat.x, pointer.y - cat.y);
    return d < 350 ? performance.now() / 1000 - pointer.stillSince : 0;
  };
  // すりすり：カーソルが猫の体の高さ（床すれすれ）でじっと止まっていたら、寄っていって体をこすりつける
  //   猫が人の足にすりすりするのと同じ。カーソルが顔の高さより上で止まっているときは「見つめる」の方
  let lastRubAt = -99;
  function maybeRub() {
    if (!CL.rub || !cat.plat || now - lastRubAt < 25) return false;
    const dx = pointer.x - cat.x, dy = pointer.y - cat.y;
    const low = dy < 10 && dy > -H * 0.75;                 // 猫の体の高さ
    const still = performance.now() / 1000 - pointer.stillSince;
    if (!low || Math.abs(dx) > 360 || still < 1.2 || Math.random() > frameDt * 1.2) return false;
    const p = currentSurface() || floor();
    const [a, b] = walkRange(p);
    const dir = Math.sign(dx) || cat.facing;
    const tx = clamp(pointer.x - dir * W * 0.3, a, b);      // 顔の横にカーソルが来る位置まで歩く
    if (Math.abs((pointer.x - dir * W * 0.3) - tx) > W * 0.4) return false;   // 足場の外なら届かない
    lastRubAt = now;
    const doRub = () => { face(Math.sign(pointer.x - cat.x) || dir); planAct('rub', rand(1.5, 3)); };
    standThen(() => {
      if (Math.abs(tx - cat.x) < W * 0.15) doRub();
      else startWalk(tx, WALK_SPEED * 0.8, doRub);
    });
    return true;
  }
  // 後ろ足立ち：カーソルが頭の少し上（手が届きそうで届かない高さ）で止まっていたら、立ち上がって手を伸ばす
  let lastReachAt = -99;
  function maybeReach() {
    if (!CL.hindStand || !cat.plat || now - lastReachAt < 20) return false;
    const dx = pointer.x - cat.x, dy = pointer.y - cat.y;
    const still = performance.now() / 1000 - pointer.stillSince;
    if (dy > -H * 0.85 || dy < -H * 2 || Math.abs(dx) > W * 0.8 || still < 0.8 || still > 6 || Math.random() > frameDt * 1.5) return false;
    // 背中側のカーソルには手を伸ばさない（その場でパッと反転してしまうので。背中側は振り返りの担当）
    if (dx * cat.facing < -W * 0.2) return false;
    lastReachAt = now;
    face(Math.sign(dx) || cat.facing);
    planAct('hindStand', rand(1.5, 3));
    return true;
  }
  // ごあいさつ：しばらくいなかったカーソルが戻ってきたら、尻尾をピーンと立てて短く鳴く
  let lastGreetAt = -99;
  function maybeGreet() {
    if (!CL.greet || !cat.plat || now - lastGreetAt < 60 || !pointer.returnedAt) return false;
    const t = performance.now() / 1000;
    if (t - pointer.returnedAt > 1.5) { pointer.returnedAt = 0; return false; }
    if (Math.hypot(pointer.x - cat.x, pointer.y - cat.y) > 700) return false;
    pointer.returnedAt = 0; lastGreetAt = now;
    face(Math.sign(pointer.x - cat.x) || cat.facing);
    planAct('greet', rand(1.5, 3));
    return true;
  }
  // カカカ：画面の上の方（猫の頭よりずっと上）でカーソルが速く動いている＝鳥や虫が飛んでいる
  //   座って見上げて、あごをカカカッと鳴らす（立っていれば座ってから）
  let lastChatterAt = -99;
  function maybeChatter() {
    if (!CL.chatter || !cat.plat || now - lastChatterAt < 30) return false;
    const dx = pointer.x - cat.x, dy = pointer.y - cat.y;
    const moving = performance.now() / 1000 - pointer.lastMove < 0.15;
    if (!moving || pointer.speed < 500 || dy > -H * 1.0 || Math.abs(dx) > 520 || Math.random() > frameDt * 2) return false;
    lastChatterAt = now;
    face(Math.sign(dx) || cat.facing);
    planAct('chatter', rand(2, 4));
    return true;
  }
  // びっくり：香箱でくつろいでいるときに、すぐ近くでカーソルを激しく振られると、ビクッと飛び上がって立つ
  let lastStartleAt = -99;
  function maybeStartle() {
    if (!CL.startle || reducedMotion || now - lastStartleAt < 60) return false;
    const d = Math.hypot(pointer.x - cat.x, pointer.y - (cat.y - H * 0.4));
    const moving = performance.now() / 1000 - pointer.lastMove < 0.08;
    // 体のすぐそば（体の幅の半分くらい）で、0.8秒以内に左右に3回以上振ったときだけ
    //   ふつうにカーソルが横切っただけでは驚かない（以前はこれで頻繁に跳んでいた）
    if (!moving || d > Math.max(110, W * 0.5) || pointer.speed < 1500 || recentShakes(0.8) < 3) return false;
    lastStartleAt = now;
    JLOG.push([+now.toFixed(1), 'startle']);
    // 飛び上がりの絵は「香箱 → 立ち」で終わるので、そのまま立ちの駅で少し固まってからブルブル
    const steps = [{ kind: 'part', clip: 'startle', from: 0, to: CL.startle.n - 1 },
                   { kind: 'call', fn: () => {
                     cat.pose = 'stand';
                     const after = [];
                     if (hasAct('shake')) after.push({ kind: 'act', name: 'shake', cycles: 1 });
                     after.push({ kind: 'rest', pose: 'stand', dur: rand(1.5, 3) });
                     plan(after);
                   } }];
    plan(steps);
    return true;
  }
  let lastTiltAt = -99;
  function maybeStare() {
    // 前足が届く距離にカーソルがあるときは見つめない（ちょいちょいの方が先）
    const pw = pawPoint();
    if (Math.hypot(pointer.x - pw.x, pointer.y - pw.y) < REACH * 1.3) return;
    // 座っているときに近くでじっと見られたら、まず首をかしげることがある
    if (cat.pose === 'sit' && CL.headTilt && stillNear() > 1.2 && now - lastTiltAt > 15 && Math.random() < frameDt * 0.5) {
      lastTiltAt = now; planAct('headTilt', rand(1, 2)); return;
    }
    if (FRONT_SPOT && stillNear() > 2.5 && Math.random() < frameDt * 0.6) planPose(FRONT_SPOT, rand(8, 20));
  }

  // 駅でじっとしているときに見せるコマ（尻尾ゆらゆらは manifest.holds で自動的に差し替わる）
  const POSE_FRAME = {
    stand: IDLE,
    sit: CL.sit ? CL.sit.s + CL.sit.n - 1 : IDLE,
    loaf: CL.liedown ? CL.liedown.s + CL.liedown.n - 1 : IDLE,
    arch: CL.yannoPose ? CL.yannoPose.s + CL.yannoPose.n - 1 : IDLE,
  };
  // 駅にいるときの状態名（ほかの処理が見ている名前に合わせる）
  const REST_STATE = { stand: 'idle', sit: 'sit', loaf: 'loaf', curl: 'sleep', arch: 'arch' };
  for (const [name, sp] of Object.entries(SPOTS)) {
    REST_STATE[name] = sp.state || (sp.base === 'sit' ? 'front' : 'lie');
    POSE_FRAME[name] = CL[sp.clip].s + sp.enter[1];
  }

  // 動きのカタログ：どの駅でやるか・くり返すか（くり返す場合は何周するか）
  const ACTS = {
    lick:     { pose: 'sit',   loops: [2, 4] },   // 毛づくろい（尻尾つき版があればそちら）
    facewash: { pose: 'sit' },                    // 顔洗い
    yawn:     { pose: 'sit' },                    // あくび
    swipe:    { pose: 'sit' },                    // ちょいちょい
    meow:     { pose: 'stand' },                  // 鳴く
    shake:    { pose: 'stand' },                  // ブルブル
    knead:    { pose: 'stand', loops: [2, 3] },   // ふみふみ
    stretch:  { pose: 'stand' },                  // のび
    rollover: { pose: 'loaf' },                   // ごろーん
    yannoStep: { pose: 'arch', loops: [2, 3] },   // やんのかステップ（アーチの駅で横にピョンピョン）
    sitAlert: { pose: 'sit', hold: [2, 5] },      // 虚空を見る：急に横を向いて、何もないところを2〜5秒じーっと
    rub:      { pose: 'stand', loops: [2, 3] },   // すりすり（カーソルに体をこすりつける。maybeRub から）
    scratch:  { pose: 'stand' },                  // 爪とぎ（床をバリバリ）
    chatter:  { pose: 'sit' },                    // カカカ（上の方の鳥を見て、あごを鳴らす。maybeChatter から）
    // --- 座り ---
    legGroom:   { pose: 'sit' },                  // 後ろ足を高く上げて、脚・お腹をなめる
    earScratch: { pose: 'sit' },                  // 後ろ足で耳の後ろをカキカキ
    sneeze:     { pose: 'sit' },                  // くしゃみ
    headTilt:   { pose: 'sit', hold: [1, 2.5] },  // 首かしげ（かしげたまま少し止まる）
    lipLick:    { pose: 'sit' },                  // 舌ペロ
    chestGroom: { pose: 'sit' },                  // 胸をなめる
    backGroom:  { pose: 'sit' },                  // 振り返って背中をなめる
    // --- 立ち ---
    sniff:       { pose: 'stand' },               // 床のにおいを嗅ぐ
    hindStand:   { pose: 'stand', hold: [1, 2.5] },  // 後ろ足で立って、上に手を伸ばす（maybeReach から）
    greet:       { pose: 'stand' },               // 尻尾ピーンでごあいさつ（maybeGreet から）
    stretchBack: { pose: 'stand' },               // 後ろ足のび
    // --- 香箱 ---
    loafDoze:    { pose: 'loaf' },                // うとうと・こっくり（そのまま寝落ちすることも）
    loafYawn:    { pose: 'loaf' },                // 香箱であくび
    loafLick:    { pose: 'loaf' },                // 香箱で前足をなめる
    loafStretch: { pose: 'loaf' },                // 香箱から前足だけぐーっとのび
    tailThump:   { pose: 'loaf' },                // 尻尾パタンパタン（なでられすぎてちょっとイラッ）
    // --- 寝そべり・寝ている・正面 ---
    sideStretch:  { pose: 'side' },               // 横倒しで手足をぐーっと伸ばす
    bellyStretch: { pose: 'belly' },              // へそ天でのび
    dream:        { pose: 'curl' },               // 丸まって寝ながら、夢を見てピクピク
    frontTilt:    { pose: 'front', hold: [1, 2.5] },  // 正面で首かしげ
    frontMeow:    { pose: 'front' },              // 正面でこっちに向かってにゃー
    frontYawn:    { pose: 'front' },              // 正面であくび
    frontLick:    { pose: 'front' },              // 正面で前足をなめる
    sideGroom:    { pose: 'side' },               // 横倒しでお腹をなめる
    sphinxYawn:   { pose: 'sphinx' },             // スフィンクスであくび
  };
  const clipOf = (name) => (name === 'lick' && CL.lickTail ? 'lickTail' : name);
  const hasAct = (name) => !!CL[clipOf(name)];

  // 駅Aから駅Bまでの線路を探す（幅優先探索）。見つからなければ null
  function findTracks(from, to) {
    if (from === to) return [];
    const prev = { [from]: null }, q = [from];
    while (q.length) {
      const p = q.shift();
      for (const t of TRACKS) {
        if (t[0] !== p || t[1] in prev) continue;
        prev[t[1]] = t; q.push(t[1]);
        if (t[1] === to) {
          const path = []; let k = to;
          while (prev[k]) { path.unshift(prev[k]); k = prev[k][0]; }
          return path;
        }
      }
    }
    return null;
  }

  // やることの予定表（cat.queue）を組んで実行を始める
  //   step = { kind:'track', track } | { kind:'act', name, cycles } | { kind:'rest', pose, dur } | { kind:'call', fn }
  function plan(steps) {
    cat.queue = steps;
    setState('act');
    nextStep();
  }
  // 「駅 pose まで移動 → 動き name → その駅でしばらく休む」の予定を作る
  function planAct(name, restDur = rand(2, 5)) {
    const a = ACTS[name];
    if (!a || !hasAct(name)) return false;
    const path = findTracks(cat.pose, a.pose);
    if (!path) return false;
    const steps = path.map((t) => ({ kind: 'track', track: t }));
    const cycles = a.loops ? Math.round(rand(a.loops[0], a.loops[1])) : 1;
    const h = a.hold && MF.actHold ? MF.actHold[clipOf(name)] : null;
    if (h != null) {
      // 途中で止める動き：止めるコマまで再生 → そのコマで固まる → 残りを再生
      const c = clipOf(name);
      steps.push({ kind: 'part', clip: c, from: 0, to: h });
      steps.push({ kind: 'freeze', clip: c, frame: h, dur: rand(a.hold[0], a.hold[1]) });
      steps.push({ kind: 'part', clip: c, from: h, to: CL[c].n - 1 });
    } else steps.push({ kind: 'act', name, cycles });
    steps.push({ kind: 'rest', pose: a.pose, dur: restDur });
    plan(steps);
    return true;
  }
  // 駅 pose まで移動して、そこで dur 秒休む（寝る・座る・香箱）
  function planPose(pose, dur, extra = []) {
    const path = findTracks(cat.pose, pose);
    if (!path) return false;
    plan([...extra, ...path.map((t) => ({ kind: 'track', track: t })), { kind: 'rest', pose, dur }]);
    return true;
  }
  // 立ち駅に戻ってから fn を実行（歩く・跳ぶ・飛びかかるなど、立っていないとできないこと用）
  function standThen(fn) {
    if (cat.pose === 'stand') { fn(); return; }
    const path = findTracks(cat.pose, 'stand');
    if (!path) { cat.pose = 'stand'; fn(); return; }
    plan([...path.map((t) => ({ kind: 'track', track: t })), { kind: 'call', fn }]);
  }

  // 予定表の次の一歩へ
  function nextStep() {
    const st = cat.queue && cat.queue.shift();
    if (!st) { rest(cat.pose, rand(2, 5)); return; }
    cat.step = st;
    if (cat.state !== 'act') setState('act');
    cat.anim = null; cat.stateT = 0;
    if (st.kind === 'track') {
      if (!st.track[2]()) { cat.pose = st.track[1]; nextStep(); }   // 絵が無ければ飛ばす
    } else if (st.kind === 'act') {
      const c = clipOf(st.name);
      // くり返す動き（毛づくろい・ふみふみ）は最初と最後が同じ姿勢なので、そのまま周回させる
      const cyc = st.cycles || 1;
      play(c, cyc > 1 ? { loop: true } : {});
      st.until = CL[c].n / CL[c].fps * cyc;
    } else if (st.kind === 'part') {
      play(st.clip, { from: st.from, to: st.to });
    } else if (st.kind === 'turn') {
      play('turnAround', { from: 0, to: 0, loop: true });   // コマは描画側で turnFrame() から選ぶ
      st.until = st.dur;
    } else if (st.kind === 'freeze') {
      play(st.clip, { from: st.frame, to: st.frame, loop: true });
      st.until = st.dur;
    } else if (st.kind === 'rest') {
      rest(st.pose, st.dur);
    } else if (st.kind === 'call') {
      cat.queue = []; st.fn();
    }
  }

  // 駅で休む（状態名は REST_STATE）。丸まりは寝息のくり返しを流す
  function rest(pose, dur) {
    cat.pose = pose;
    cat.queue = [];
    cat.step = null;
    setState(REST_STATE[pose] || 'idle', dur);
    const sp = SPOTS[pose];
    if (sp) play(sp.clip, { from: sp.loop[0], to: sp.loop[1], pingpong: true });
    if (pose === 'curl' && !play('tailSleep', { pingpong: true }) && LOOPS.sleep) {
      play('sleep', { from: LOOPS.sleep[0], to: LOOPS.sleep[1], loop: true });
    }
  }

  // 寝る：立っていれば、ふみふみしてから伏せて丸くなる
  function goSleep(dur) {
    cat.boredom = 0;
    const extra = cat.pose === 'stand' && hasAct('knead') && Math.random() < 0.6
      ? [{ kind: 'act', name: 'knead', cycles: 2 }] : [];
    planPose('curl', dur, extra);
  }
  // 起きる：丸まりをほどいて香箱 → 立つ → のび（またはブルブル）
  function wakeUp() {
    cat.relax = 0;   // ちゃんと起きたら、くつろぎ度はリセット（また香箱から段階を踏む）
    let steps;
    if (cat.pose === 'curl' && CL.curlWake && Math.random() < 0.7) {
      // 丸まり → 顔を上げて前足をのび〜っ → 香箱。そこから立つ
      steps = [{ kind: 'part', clip: 'curlWake', from: 0, to: CL.curlWake.n - 1 }, { kind: 'call', fn: () => {
        cat.pose = 'loaf';
        const rest2 = (findTracks('loaf', 'stand') || []).map((t) => ({ kind: 'track', track: t }));
        const after2 = pick(['stretch', 'shake', 'stretchBack', 'none']);
        if (after2 !== 'none' && hasAct(after2)) rest2.push({ kind: 'act', name: after2, cycles: 1 });
        rest2.push({ kind: 'rest', pose: 'stand', dur: rand(1, 3) });
        plan(rest2);
      } }];
      plan(steps);
      return;
    }
    steps = (findTracks(cat.pose, 'stand') || []).map((t) => ({ kind: 'track', track: t }));
    const after = pick(['stretch', 'stretch', 'shake', 'stretchBack', 'yawnStand']);
    if (after === 'yawnStand') { /* 立ったまま次の判断へ */ }
    else if (hasAct(after)) steps.push({ kind: 'act', name: after, cycles: 1 });
    steps.push({ kind: 'rest', pose: 'stand', dur: rand(1, 3) });
    plan(steps);
  }

  // 1回きりの動きが最後のコマまで来たか
  const animDone = () => !cat.anim || (!cat.anim.loop && cat.anim.t * cat.anim.fps >= cat.anim.n);
  // いま再生中の動きが name か
  const animIs = (name) => cat.anim && CL[name] && cat.anim.s >= CL[name].s && cat.anim.s < CL[name].s + CL[name].n;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function face(dir) {
    if (dir === 0 || dir === cat.facing) return;
    cat.facing = dir;
    cat.turnPulse = 1; // くるっと向きを変える演出
  }

  // 足場の上で歩ける範囲
  function walkRange(p) {
    const m = W * 0.42;
    let a = p.left + m, b = p.right - m;
    if (a > b) { a = b = (p.left + p.right) / 2; }
    return [a, b];
  }

  // 次に何をするか決める（駅で休み終わったとき）。今いる駅によって選べることが変わる
  // 寝そべりの段階：2＝目を開けてくつろぐ / 3＝目を閉じて寝る / 4＝一番無防備（へそ天）
  const RELAX_TIER = { sphinx: 2, chin: 2, paws: 2, flirt: 2, side: 3, melt: 3, gomen: 3, pawface: 3, belly: 4, twist: 4 };
  // その段階に行けるようになるまでの、くつろぎ度（秒）
  const RELAX_NEED = { 1: 0, 2: 10, 3: 40, 4: 90 };
  function decide() {
    const p = cat.plat;
    const hour = new Date().getHours();
    const night = hour < 6;
    const [a, b] = p ? walkRange(p) : [cat.x, cat.x];
    const canWalk = b - a > W * 0.6;
    const ptrNear = Math.hypot(pointer.x - cat.x, pointer.y - cat.y) < 300 && performance.now() / 1000 - pointer.lastMove < 2;
    const sleepW = (night ? 30 : 3) + cat.boredom * 2;
    const opts = [];
    const add = (k, w) => { if (w > 0) opts.push([k, w]); };
    const lieSpots = Object.keys(SPOTS).filter((k) => SPOTS[k].base === 'loaf');
    const frontSpot = FRONT_SPOT;
    // 寝相の深さ（段階）。猫は「香箱 → 目を開けて寝そべる → 目を閉じる → だんだん無防備（へそ天）」と一段ずつ深くなる
    //   1回に進めるのは一段だけ。深い段階は、くつろぎ度（cat.relax 秒）がたまってから
    const tierOf = (k) => RELAX_TIER[k] || 2;
    const relax = cat.relax || 0;
    const unlocked = (t) => relax >= (RELAX_NEED[t] || 0);
    const curTier = cat.pose === 'loaf' ? 1 : (SPOTS[cat.pose] && SPOTS[cat.pose].base === 'loaf' ? tierOf(cat.pose) : 0);
    const flirtW = () => (relax >= RELAX_NEED[2] && now - (cat.lastPurrAt || -99) < 30) ? 8 : 1;   // 構っては、なでられた後に
    if (cat.pose === 'stand') {
      // 猫はほとんど寝そべっている：立っているときは「どこかで寝そべる」が一番選ばれやすい
      add('stay', 8);
      if (canWalk) add('walk', 24);
      // 自分から跳ぶのはたまに：重みを小さくして、前回から40秒は跳ばない
      if (!reducedMotion && now - lastJumpAt > 90) add('jump', 2);
      // 立ちからは、まず香箱（いきなり寝る・いきなり寝そべるはしない）。眠い時間帯ほど香箱に行きやすい
      add('sit', 12); add('loaf', 16 + sleepW);
      add('lick', 5); add('facewash', 3); add('stretch', 4); add('shake', 2); add('knead', 2); add('meow', 2);
      add('sitAlert', 2); add('scratch', 3);
      add('sniff', 4); add('stretchBack', 2);
    } else if (cat.pose === 'sit') {
      add('stay', 10); add('stand', 12); add('loaf', 6 + sleepW * 0.6);
      add('lick', 8); add('facewash', 6); add('yawn', 5); add('swipe', ptrNear ? 14 : 2);
      add('sitAlert', 6);   // 虚空を見る
      add('chatter', 1);    // 窓の外の鳥（カーソルが無くても、たまに）
      add('legGroom', 4); add('earScratch', 4); add('sneeze', 1); add('lipLick', 3);
      add('chestGroom', 3); add('backGroom', 3); add('headTilt', ptrNear ? 6 : 1);
      if (SPOTS.wrap) add('spot:wrap', 6);   // 尻尾を前足に巻いて、すました座り
      if (frontSpot) add('spot:' + frontSpot, ptrNear ? 16 : 6);
    } else if (cat.pose === 'loaf') {
      add('stay', 8); add('stand', 8); add('rollover', 4); add('sit', 3);
      add('loafYawn', 4); add('loafLick', 5); add('loafStretch', 3);
      // うとうと（→そのまま丸まって寝落ち）・丸まって寝るは、少しくつろいでから
      if (relax >= 15) { add('doze', 6); add('sleep', sleepW); }
      // 香箱から行けるのは段階2（目を開けて寝そべる）まで
      for (const k of lieSpots) if (tierOf(k) === 2) add('spot:' + k, k === 'flirt' ? flirtW() : 8);
    } else if (SPOTS[cat.pose]) {
      // 寝そべり・正面座り：そのまま続けることが多い。飽きたら元の駅へ（寝そべりから寝落ちも）
      add('stay', 14); add('back', 8);
      if (curTier) {
        // 次の段階へ一段だけ深くなる（くつろぎ度が足りていれば）。へそ天など一番深い段階は控えめに
        const nt = curTier + 1;
        if (unlocked(nt)) for (const k of lieSpots) if (tierOf(k) === nt) add('spot:' + k, nt >= 4 ? 3 * (night ? 2 : 1) : 6);
        // 目を閉じて寝る段階まで来ていたら、丸まって本格的に寝ることも
        if (curTier >= 3) add('sleep', sleepW);
      }
      if (cat.pose === 'side') { add('sideStretch', 5); add('sideGroom', 4); }
      if (cat.pose === 'sphinx') add('sphinxYawn', 4);
      if (cat.pose === 'belly') add('bellyStretch', 5);
      if (cat.pose === FRONT_SPOT) { add('frontTilt', ptrNear ? 8 : 2); add('frontMeow', 3); add('frontYawn', 3); add('frontLick', 3); }
    } else { // curl（寝ている途中で decide が呼ばれた場合）
      add('stay', 1);
    }
    // 絵がまだ無い動きは候補から外す
    const usable = opts.filter(([k]) => (!ACTS[k] || hasAct(k)) && (!k.startsWith('spot:') || SPOTS[k.slice(5)]));
    let total = usable.reduce((t, o) => t + o[1], 0), r = Math.random() * total, choice = 'stay';
    for (const [k, w] of usable) { if ((r -= w) <= 0) { choice = k; break; } }

    cat.boredom += 1;
    switch (choice) {
      case 'walk': {
        let tx = rand(a, b);
        if (Math.abs(tx - cat.x) < W * 0.5) tx = cat.x < (a + b) / 2 ? b - rand(0, W * 0.3) : a + rand(0, W * 0.3);
        const spd = Math.random() < 0.12 ? RUN_SPEED : WALK_SPEED;
        // 後ろへ歩き出すときは、パッと反転せずに、その場でくるっと振り向いてから歩く
        if (Math.sign(tx - cat.x) !== cat.facing && CL.turnAround) turnAround(() => startWalk(tx, spd));
        else startWalk(tx, spd);
        break;
      }
      case 'doze': {
        // うとうと → 6割はそのまま寝落ち、4割はハッと起きて香箱に戻る
        if (!hasAct('loafDoze')) { rest(cat.pose, rand(2, 4)); break; }
        const steps = [{ kind: 'act', name: 'loafDoze', cycles: 1 }];
        if (Math.random() < 0.6) {
          for (const t of findTracks('loaf', 'curl') || []) steps.push({ kind: 'track', track: t });
          steps.push({ kind: 'rest', pose: 'curl', dur: night ? rand(90, 240) : rand(25, 80) });
        } else steps.push({ kind: 'rest', pose: 'loaf', dur: rand(3, 8) });
        plan(steps);
        break;
      }
      case 'jump':
        if (!tryJumpToRandomPlatform()) rest(cat.pose, rand(1, 3));
        break;
      case 'sit':   planPose('sit', rand(4, 12)); break;
      case 'loaf':  planPose('loaf', rand(5, 15)); break;
      case 'stand': planPose('stand', rand(1, 3)); break;
      case 'sleep': goSleep(night ? rand(90, 240) : rand(25, 80)); break;
      case 'stay':  rest(cat.pose, SPOTS[cat.pose] ? rand(15, 40) : rand(2, 5)); break;
      case 'back':  planPose(SPOTS[cat.pose] ? SPOTS[cat.pose].base : 'stand', rand(3, 8)); break;
      default:
        if (choice.startsWith('spot:')) {
          // 寝そべり・正面座りへ：長めにくつろぐ
          if (!planPose(choice.slice(5), rand(20, 60))) rest(cat.pose, rand(2, 4));
          break;
        }
        if (!planAct(choice)) rest(cat.pose, rand(2, 4));
    }
  }

  function idle(dur = rand(2, 5)) { cat.pose = 'stand'; cat.queue = []; cat.step = null; setState('idle', dur); }

  // 振り向き：動物の振り向きは「頭を低くして、頭が先にグイッと向き、体があとから追いつく」。
  //   ① 頭が先（0〜HEAD秒）：立ちで振り返る絵（lookBackStand）の0→8コマ。体を少し沈めて鼻先を下げる
  //   ② ため（〜HOLD秒）：頭だけ後ろを向いたまま一瞬止まる
  //   ③ 体が追いつく（〜DUR秒）：振り向きの絵（turnAround）の8→12コマ。踏み替えの上下とUの字の軌道
  //   どちらの絵も8コマ目で頭が同じ向き（左後ろ）なので、体だけがグイッと回り込んだように見える
  //   ※ 振り返りの絵が無いときは、振り向きの絵だけを緩急つけて流す（以前の上品な振り向き）
  const TURN_HEAD = 0.26, TURN_HOLD = 0.32, TURN_DUR = 0.62;
  const TURN_JOIN_LB = 8, TURN_JOIN_TA = 8;
  const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  // 振り向き開始からの秒数 t → 見せるコマ（シート上の通し番号）
  function turnFrame(t) {
    const TA = CL.turnAround, LB = CL.lookBackStand;
    if (!LB) return TA.s + Math.round(ease(t / TURN_DUR) * (TA.n - 1));
    if (t < TURN_HEAD) return LB.s + Math.round(ease(t / TURN_HEAD) * TURN_JOIN_LB);
    if (t < TURN_HOLD) return LB.s + TURN_JOIN_LB;
    return TA.s + TURN_JOIN_TA + Math.round(ease((t - TURN_HOLD) / (TURN_DUR - TURN_HOLD)) * (TA.n - 1 - TURN_JOIN_TA));
  }
  // その場でくるっと向きを変える（振り向きの絵の最後は反対向き → 向きを反転すると立ちコマとつながる）
  function turnAround(then) {
    if (!CL.turnAround) { face(-cat.facing); if (then) then(); return; }
    //   振り向きの絵は「足を動かさずに体だけ回る」13コマで、そのまま流すと台座に載せたフィギュアの回転に見える。
    //   そこで「頭を低くして頭が先、体があとから」の順に、振り返りの絵と振り向きの絵をつないで見せる（TURN_* と turnFrame）
    plan([{ kind: 'turn', dur: TURN_DUR },
          { kind: 'call', fn: () => { cat.facing = -cat.facing; cat.pose = 'stand'; if (then) then(); else idle(rand(1.5, 3)); } }]);
  }
  function startWalk(tx, speed, onArrive = null) {
    cat.onArrive = onArrive;   // 着いたらやること（すりすりなど）。無ければ立ち止まる
    cat.targetX = tx;
    cat.speed = speed;
    face(Math.sign(tx - cat.x));
    setState('walk');
    cat.walkPhase = 0;
  }

  // 放物線で (tx, ty) に着地するジャンプを準備（溜め→跳ぶ）
  function prepareJump(tx, ty, extraApex = rand(40, 100)) {
    cat.pouncing = false;
    const apexY = Math.min(cat.y, ty) - extraApex;
    const up = cat.y - apexY, down = ty - apexY;
    if (up <= 0 || down <= 0) return false;
    const t = Math.sqrt(2 * up / G) + Math.sqrt(2 * down / G);
    const vx = (tx - cat.x) / t;
    if (Math.abs(vx) > 1100) return false;
    cat.pendingJump = { vx, vy: -Math.sqrt(2 * G * up) };
    face(Math.sign(vx));
    setState('crouch', 0.28);
    playJumpPart('crouch');
    return true;
  }

  // 跳んだ・落ちた記録（いつ・なぜ）。「よく跳ぶ」と感じたらコンソールで Neko.jlog() を見ると理由がわかる
  //   decide＝自分から / hunt＝狩りの飛びかかり / quickPounce＝すれ違い飛びかかり / startle＝びっくり / hop / fall＝足場から落ちた
  const JLOG = [];
  let lastJumpAt = -99;   // 最後に自分から跳んだ時刻
  function tryJumpToRandomPlatform() {
    JLOG.push([+now.toFixed(1), 'decide']);
    lastJumpAt = now;
    refreshPlatformsIfStale(0.05);
    const maxUp = Math.min(innerHeight * 0.6, W * 3.4);
    const cands = [];
    for (const p of platforms) {
      if (cat.plat && (p.el === cat.plat.el && p.floor === cat.plat.floor)) continue;
      const up = cat.y - p.top;
      if (up > maxUp) continue;
      const [a, b] = walkRange(p);
      const tx = clamp(cat.x, a, b) + (a < b ? rand(-W * 0.4, W * 0.4) : 0);
      const txc = clamp(tx, a, b);
      const dx = Math.abs(txc - cat.x);
      if (dx > innerWidth * 0.65) continue;
      // 近い足場ほど選ばれやすい
      cands.push({ p, tx: txc, w: 1 / (1 + (dx + Math.abs(up)) / 250) });
    }
    if (!cands.length) return false;
    let total = cands.reduce((s, c) => s + c.w, 0), r = Math.random() * total;
    for (const c of cands) {
      if ((r -= c.w) <= 0) return prepareJump(c.tx, c.p.top);
    }
    return false;
  }

  // 足場から外れて落ちる
  function fall() {
    JLOG.push([+now.toFixed(1), 'fall']);
    cat.plat = null;
    if (cat.state !== 'held') setState('air');
  }

  function land(p, impact) {
    cat.plat = { el: p.el, floor: p.floor, lastLeft: p.left };
    // 足場の位置は少し前に測ったもの（0.08秒ごとに更新）なので、チャットがスクロール中だとずれている。
    //   着地の瞬間に今の位置を測り直して、そこに足を付ける（以前は着地の1フレームだけ浮いたり沈んだりした）
    const s = p.el ? surfaceOf(p.el) : null;
    cat.y = s ? s.top : p.top;
    if (s) cat.plat.lastLeft = Math.max(s.left, 0);
    cat.vy = 0; cat.vx = 0;
    const k = clamp(impact / 1600, 0.08, 0.35);
    cat.sy = 1 - k; cat.sx = 1 + k * 0.8;   // 着地でむにっと潰れる
    if (impact > 1500) say(pick(['にゃっ', 'っと', '…!']));
    // 飛びかかりの着地なら：前足でカーソル（獲物）をギュッと押さえ込んで、そっと覗いてから立つ
    if (cat.pouncing) {
      cat.pouncing = false;
      if (CL.pouncePin) {
        plan([{ kind: 'part', clip: 'pouncePin', from: 0, to: CL.pouncePin.n - 1 }, { kind: 'rest', pose: 'stand', dur: rand(1, 2) }]);
        return;
      }
    }
    setState('land', 0.25);
    playJumpPart('land');
  }

  // ジャンプの動きの一部（溜め・着地など）を再生する
  function playJumpPart(part) {
    if (!CL.jump || !MF.jump || !MF.jump[part]) return;
    const [a, b] = MF.jump[part];
    play('jump', { from: a, to: b });
  }

  // ---------------------------------------------------------------
  // 吹き出し・エフェクト
  // ---------------------------------------------------------------
  let bubbleUntil = 0;
  function say(text, dur = 1.6, force = false) {
    if (!CFG.bubbles && !force) return;
    bubble.textContent = text;
    bubble.classList.add('on');
    bubbleUntil = now + dur;
  }

  function headWorld() {
    return {
      x: cat.x + cat.facing * (HEAD.cx - FOOT.x) * S * cat.sx,
      y: cat.y - (FOOT.y - HEAD.cy) * S * cat.sy - cat.offY,
    };
  }

  function spawnFx(char, color, size = 16) {
    const fx = document.createElement('span');
    fx.className = 'neko-fx';
    fx.textContent = char;
    const h = headWorld();
    fx.style.left = (h.x + rand(-14, 14)) + 'px';
    fx.style.top = (h.y - H * 0.35) + 'px';
    fx.style.color = color;
    fx.style.fontSize = size + 'px';
    fx.style.setProperty('--dx', rand(-16, 16) + 'px');
    root.appendChild(fx);
    fx.addEventListener('animationend', () => fx.remove());
  }

  // ---------------------------------------------------------------
  // 入力（クリック・なでる・つまむ）
  // ---------------------------------------------------------------
  let down = null; // つまみ判定用 { id, x, y, t }

  window.addEventListener('pointermove', (e) => {
    const t = performance.now() / 1000;
    const dt = Math.max(t - (pointer.lastMove || t), 1 / 240);
    const vx = (e.clientX - pointer.x) / dt, vy = (e.clientY - pointer.y) / dt;
    if (pointer.x > -9000) {
      pointer.vx = vx; pointer.vy = vy;
      const sp = Math.hypot(vx, vy);
      pointer.speed = pointer.speed * 0.8 + Math.min(sp, 6000) * 0.2;
      if (sp > 30) pointer.stillSince = t;
    }
    // 左右の向きが変わった瞬間を記録（「振っている」かどうかの判定用）
    if (Math.abs(vx) > 300) {
      const sg = Math.sign(vx);
      if (pointer.lastSg && sg !== pointer.lastSg) { pointer.revs.push(t); while (pointer.revs.length > 10) pointer.revs.shift(); }
      pointer.lastSg = sg;
    }
    // 15秒以上動きが無かった（またはページに入ってきたばかりの）カーソルが動いた＝戻ってきた
    if (pointer.x < -9000 || t - pointer.lastMove > 15) pointer.returnedAt = t;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastMove = t;
    pointer.samples.push({ x: e.clientX, y: e.clientY, t });
    while (pointer.samples.length > 8) pointer.samples.shift();

    // ドラッグ開始の判定
    if (down && cat.state !== 'held' && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
      pickUp();
    }
  }, { passive: true });

  // スマホ・タブレット：指を離したら「カーソルはもう無い」ことにする
  //   指にはマウスと違って「画面の上に浮いているカーソル」が無い。最後に触った場所に見えないカーソルが残ったままだと、
  //   猫がそこへちょいちょい・ゴロンして遊ぶ、を続けてしまう（猫をタップしたあと20秒以上パンチし続けていた）
  //   少し待ってから消すのは、離した直後の反応（逃げる向きなど）にはまだ指の位置を使うため
  let touchGoneTimer = 0;
  function touchLifted(e) {
    if (e.pointerType === 'mouse') return;
    clearTimeout(touchGoneTimer);
    touchGoneTimer = setTimeout(() => {
      if (down) return;                       // まだ触っている（長押しでなでている等）ならそのまま
      pointer.x = pointer.y = -9999;
      pointer.speed = 0; pointer.samples = []; pointer.revs = [];
    }, 800);
  }
  window.addEventListener('pointerup', touchLifted, { passive: true, capture: true });
  window.addEventListener('pointercancel', touchLifted, { passive: true, capture: true });

  // なでる：ボタンを押さずに猫の上でカーソルを動かす
  hit.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'touch') return;
    if (cat.state === 'held' || cat.state === 'air' || cat.state === 'crouch') return;
    const sp = Math.hypot(pointer.vx, pointer.vy);
    if (sp > 1800) return; // 速すぎるのはなでてない
    petAmount += Math.min(sp / 60, 25);
    lastPetAt = now;
    if (petAmount > 200 && cat.state !== 'purr') startPurr();   // カーソルが通りがかっただけでは反応しない量
  });

  hit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit.setPointerCapture(e.pointerId);
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now, touch: e.pointerType !== 'mouse', longPress: false };
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.samples = [{ x: e.clientX, y: e.clientY, t: performance.now() / 1000 }];
  });

  function endPointer(e) {
    if (!down || e.pointerId !== down.id) return;
    const wasHeld = cat.state === 'held';
    const wasLongPress = down.longPress;
    down = null;
    if (wasHeld) throwCat();
    else if (!wasLongPress) poke();
  }
  hit.addEventListener('pointerup', endPointer);
  hit.addEventListener('pointercancel', endPointer);

  function poke() {
    // 空中（投げた・跳んだ・落ちている途中）の猫をクリックしても何もしない
    //   以前はここで「鳴く」などの動きが始まって物理が止まり、猫が空中で固まっていた（足場が無いまま止まり続ける）
    if (!cat.plat || cat.state === 'air' || cat.state === 'held') return;
    clicks.push(now);
    while (clicks.length && now - clicks[0] > 2.5) clicks.shift();
    cat.boredom = 0;
    if (clicks.length >= 4) {
      clicks.length = 0;
      say('シャーッ!!', 1.4);
      // 1回目の「しつこい」→ やんのかポーズでカーソルの方へやんのかステップ → 毛を戻して、ブルブル
      // やんのか中や直後にまだしつこい → 逃げる
      cat.angry = (cat.angry || 0) + 1;
      cat.angryAt = now;
      if (cat.angry === 1 && hasAct('yannoStep') && cat.state !== 'held') {
        const steps = (findTracks(cat.pose, 'arch') || []).map((t) => ({ kind: 'track', track: t }));
        steps.push({ kind: 'act', name: 'yannoStep', cycles: Math.round(rand(2, 3)) });
        steps.push({ kind: 'rest', pose: 'arch', dur: rand(0.8, 1.5) });
        plan(steps);
        return;
      }
      cat.angry = 0;
      flee();
      return;
    }
    if (cat.angry && now - cat.angryAt > 20) cat.angry = 0;   // 20秒たったら怒りはおさまる
    // クリックへの反応は、今いる駅によって変える（駅の移動はしないので、すっと反応する）
    //   寝ている → ゆっくり起きる / 立っている → 鳴く / 座っている → ちょいちょい / 香箱 → ごろーん
    if (cat.state === 'sleep' || (cat.state === 'lie' && SPOTS[cat.pose] && SPOTS[cat.pose].sleep)) { wakeUp(); return; }
    if (cat.state === 'act') return;                 // 何かの動きの途中なら、終わるまで気にしない
    say(pick(['にゃ', 'にゃあ', 'にゃっ', 'みゃ', 'にゃーん']));
    // 座り：3割は首かしげ（「なに？」）、正面座り：こっちに向かってにゃー
    // 香箱：へそ天（ごろーん）は簡単には出さない。くつろいでいるところを触られると、だいたいちょっと迷惑そう
    //   尻尾パタン4割・あくび3割・ゆっくりまばたきだけ2割・ごろーん1割。なでた直後でくつろいでいれば、ごろーん35%
    const loafPick = () => {
      const petted = now - (cat.lastPurrAt || -99) < 30 && (cat.relax || 0) >= 10;
      const r = Math.random();
      if (r < (petted ? 0.35 : 0.1)) return 'rollover';
      const r2 = Math.random();
      return r2 < 0.45 ? 'tailThump' : r2 < 0.8 ? 'loafYawn' : 'blink';
    };
    const byPose = { stand: 'meow', sit: hasAct('headTilt') && Math.random() < 0.3 ? 'headTilt' : 'swipe', loaf: loafPick(),
                     [FRONT_SPOT]: 'frontMeow', sphinx: Math.random() < 0.4 ? 'sphinxYawn' : 'blink' }[cat.pose];
    // ゆっくりまばたき：動かずに、見て目を細めるだけ（起きている寝そべりも、これを返す）
    if (byPose === 'blink' || (!byPose && cat.state === 'lie')) { cat.blinkUntil = now + 0.7; return; }
    if (byPose && hasAct(byPose)) { planAct(byPose, rand(1.5, 3)); return; }
    if (cat.pose === 'stand') hopUp(rand(380, 480));
  }

  function hopUp(v) {
    cat.pouncing = false;
    JLOG.push([+now.toFixed(1), 'hop']);
    if (!cat.plat) return;
    cat.plat = null;
    cat.pose = 'stand'; cat.queue = [];
    cat.vy = -v; cat.vx = rand(-40, 40);
    setState('air');
  }

  // 怒って逃げる：カーソルから遠い足場へ跳ぶ、無ければ走って離れる
  function flee() {
    refreshPlatformsIfStale(0.05);
    let best = null, bestD = -1;
    for (const p of platforms) {
      if (cat.y - p.top > Math.min(innerHeight * 0.6, W * 3.4)) continue;
      const [a, b] = walkRange(p);
      const tx = Math.abs(a - pointer.x) > Math.abs(b - pointer.x) ? a : b;
      const d = Math.abs(tx - pointer.x) - Math.abs(tx - cat.x) * 0.2;
      if (Math.abs(tx - cat.x) < innerWidth * 0.75 && d > bestD) { bestD = d; best = { tx, top: p.top }; }
    }
    if (best && !reducedMotion && prepareJump(best.tx, best.top, rand(60, 120))) {
      cat.stateDur = 0.12; // 逃げるときは溜めが短い
      return;
    }
    if (cat.plat) {
      const p = currentSurface() || floor();
      const [a, b] = walkRange(p);
      startWalk(pointer.x > cat.x ? a : b, RUN_SPEED);
    }
  }

  // なでられる：立ち上がったりせず、今の姿勢のまま（寝ていれば寝たまま、座っていれば座ったまま）ゴロゴロ
  function startPurr() {
    cat.lastPurrAt = now;
    const prev = { state: cat.state, stateT: cat.stateT, stateDur: cat.stateDur, anim: cat.anim, queue: cat.queue, step: cat.step };
    setState('purr', 0);
    // 歩いている途中なら立ち止まる。それ以外は今の動き（寝息など）を続ける
    cat.anim = prev.state === 'walk' ? null : prev.anim;
    cat.beforePurr = prev;
    say('ゴロゴロ…', 2.2);
  }
  function endPurr() {
    const p = cat.beforePurr;
    cat.beforePurr = null;
    // なでる前にしていたことの続きに戻る（歩き・待機・溜めなどは待機に戻す）
    if (p && ['sleep', 'sit', 'loaf', 'act', 'lie', 'front', 'arch', 'play'].includes(p.state)) {
      const anim = cat.anim;
      setState(p.state, p.stateDur);
      cat.stateT = p.stateT;
      cat.anim = anim; cat.queue = p.queue; cat.step = p.step;
    } else if (cat.pose !== 'stand') rest(cat.pose, rand(2, 4));
    else idle(rand(2, 4));
  }

  function pickUp() {
    cat.pouncing = false;
    cat.plat = null;
    cat.pose = 'stand'; cat.queue = [];
    cat.boredom = 0;
    setState('held');
    catEl.classList.add('held');
    // つまみ上げ：持ち上がるコマから入って、ぶらーんのくり返しへ（update側でつなぐ）
    if (CL.dangle) play('dangle', { from: Math.max(0, (LOOPS.dangle ? LOOPS.dangle[0] : 1) - 1), to: (LOOPS.dangle ? LOOPS.dangle[0] : 1) - 1 });
    say(pick(['にゃー!?', 'みゃっ', 'にゃ〜']), 1.2);
  }

  function throwCat() {
    catEl.classList.remove('held');
    // 直近の数サンプルからカーソルの速度を出して、その勢いで投げる
    const s = pointer.samples;
    let vx = 0, vy = 0;
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1];
      const dt = Math.max(b.t - a.t, 1 / 60);
      if (performance.now() / 1000 - b.t < 0.1) { vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt; }
    }
    cat.vx = clamp(vx, -2200, 2200);
    cat.vy = clamp(vy, -2200, 2200);
    // 持っていた位置（首根っこ）から足元の位置に戻す
    const o = scruffOffset();
    cat.x = pointer.x - o.x; cat.y = pointer.y - o.y;
    face(Math.sign(cat.vx) || cat.facing);
    setState('air');
  }

  // 足元から見た首根っこの位置
  function scruffOffset() {
    return { x: cat.facing * (SCRUFF.x - FOOT.x) * S, y: -(FOOT.y - SCRUFF.y) * S };
  }

  // ---------------------------------------------------------------
  // 立っている足場の現在位置（スクロール・レイアウト変化に追従）
  // ---------------------------------------------------------------
  // 足場がスクロールする箱（チャット欄など）の中にあるとき、箱の見えている範囲の外へ流れたら「足場が無い」扱いにする
  //   以前は、チャット欄の中の表・コードに乗ったまま新しい発言で中身がスクロールすると、
  //   箱のふちの外（見えなくなった表の上）に立ち続けていた
  //   箱 = 中身を切り取る祖先（overflow が visible 以外）。祖先の一覧は要素ごとに1回だけ調べて覚えておく
  const clipCache = new WeakMap();
  function clipBoxesOf(el) {
    let list = clipCache.get(el);
    if (!list) {
      list = [];
      for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') list.push(a);
      }
      clipCache.set(el, list);
    }
    return list;
  }
  function insideClip(el, s) {
    for (const a of clipBoxesOf(el)) {
      const r = a.getBoundingClientRect();
      if (s.top < r.top - 1 || s.top > r.bottom + 1) return false;   // 箱の上のふちより上・下のふちより下に流れた
    }
    return true;
  }

  function currentSurface() {
    const p = cat.plat;
    if (!p) return null;
    if (p.floor) return floor();
    const s = surfaceOf(p.el);
    if (!s || !insideClip(p.el, s)) return null;
    return { el: p.el, floor: false, left: Math.max(s.left, 0), right: Math.min(s.right, innerWidth), top: s.top };
  }

  // ---------------------------------------------------------------
  // メインループ
  // ---------------------------------------------------------------
  let prevT = 0;
  let frameDt = 1 / 60;
  function tick(ts) {
    requestAnimationFrame(tick);
    const t = ts / 1000;
    const dt = Math.min(t - (prevT || t), 0.05); // タブ復帰時の大ジャンプ防止
    prevT = t;
    frameDt = dt;
    now += dt;
    if (!frames || cat.hidden) return;
    update(dt);
    render();
  }

  function update(dt) {
    cat.stateT += dt;
    if (cat.anim) cat.anim.t += dt;
    const vw = innerWidth, vh = innerHeight;

    // --- 安全網：足場が無いのに空中でも手の中でもない状態になっていたら、落とす ---
    //   （空中で何かの動きが始まってしまう抜け道が他にあっても、空中で固まらないように）
    if (!cat.plat && cat.state !== 'air' && cat.state !== 'held') {
      JLOG.push([+now.toFixed(1), 'noFloor']);
      cat.queue = []; cat.step = null; cat.pose = 'stand';
      setState('air');
    }

    // --- 足場に追従 ---
    if (cat.plat && cat.state !== 'held') {
      const s = currentSurface();
      if (!s) fall();
      else {
        if (!s.floor) cat.x += s.left - cat.plat.lastLeft; // 足場が横に動いたら一緒に動く
        cat.plat.lastLeft = s.left;
        if (!s.floor && s.top > vh - 2) {
          // 足場が画面の下に流れていった → 画面の床に立つ
          cat.plat = { el: null, floor: true, lastLeft: 0 };
          cat.y = vh;
        } else if (!s.floor && s.top < H * 0.5) {
          fall(); // 足場が上に流れていった → 落ちる
        } else if (cat.x < s.left - W * 0.3 || cat.x > s.right + W * 0.3) {
          cat.vx = cat.state === 'walk' ? cat.speed * cat.facing : 0;
          fall(); // 足場の端から落ちた
        } else {
          cat.y = s.top;
        }
      }
    }

    // --- 反射：前足の届く範囲をカーソルが横切ったらパンチ、少し先を速く通ったら飛びかかる ---
    // くつろぎ度（秒）：香箱・寝そべり・寝ている・なでられている間にたまり、立つ・歩くと下がる
    //   寝相が深くなる（へそ天など）のは、これが十分たまってから（decide の RELAX_TIER）
    {
      const resting = ['loaf', 'lie', 'sleep'].includes(cat.state) ||
        (cat.state === 'act' && !['stand', 'sit', 'arch', FRONT_SPOT, 'wrap'].includes(cat.pose));
      if (cat.state === 'purr') cat.relax = (cat.relax || 0) + dt * 2;          // なでられると早くくつろぐ
      else if (resting) cat.relax = (cat.relax || 0) + dt;
      else if (cat.state !== 'act') cat.relax = Math.max(0, (cat.relax || 0) - dt * 4);
    }
    maybeReflex(dt);
    updateKnock(dt);

    // --- 状態ごとの動き ---
    const near = Math.hypot(pointer.x - cat.x, pointer.y - (cat.y - H * 0.5)) < 380;

    switch (cat.state) {
      case 'idle': {
        if (cat.stateT > cat.stateDur) decide();
        // カーソルが後ろにいたら：まず首だけで振り返る（描画の gaze.back）。
        //   後ろにいる時間が長ければ（2.5秒）、その場でくるっと振り向く。振り返りの絵が無ければすぐ反転
        {
          const behind = near && (pointer.x - cat.x) * cat.facing < -W * 0.6;
          cat.behindT = behind ? (cat.behindT || 0) + dt : 0;
          const hasBack = MF.gaze && MF.gaze.stand && MF.gaze.stand.back;
          if (behind && cat.stateT > 0.6 && (!hasBack || cat.behindT > 2.5)) { cat.behindT = 0; turnAround(); break; }
        }
        maybeHunt();
        maybeSlowBlink();
        if (!maybeGreet() && !maybeRub() && !maybeReach() && !maybeChatter()) maybeStare();
        break;
      }
      case 'walk': {
        // 平均の速さ（cat.speed）からコマ送りの速さを決め、今のコマの「進み量」の分だけ体を進める
        // （足が前に出るコマでは速く、踏ん張るコマではゆっくり進む＝足が地面に吸い付く）
        const dir = Math.sign(cat.targetX - cat.x);
        const fps = cat.speed / (WALK_D_MEAN * S);
        const k = Math.floor(cat.walkPhase) % WALK_D.length;
        const step = WALK_D[k] * S * fps * dt;
        cat.walkPhase += fps * dt;
        if (Math.abs(cat.targetX - cat.x) <= step) {
          cat.x = cat.targetX;
          const fn = cat.onArrive; cat.onArrive = null;
          if (fn) { cat.pose = 'stand'; fn(); } else idle(rand(1.5, 4));
        }
        else { cat.x += dir * step; cat.walkDist += step; }
        if (cat.speed < RUN_SPEED) maybeHunt();
        break;
      }
      case 'crouch': {
        if (cat.stateT >= cat.stateDur && cat.pendingJump) {
          cat.plat = null;
          cat.vx = cat.pendingJump.vx; cat.vy = cat.pendingJump.vy;
          cat.pendingJump = null;
          cat.sy = 1.18; cat.sx = 0.88; // 跳ぶ瞬間は縦に伸びる
          setState('air');
        }
        break;
      }
      case 'hunt': {
        // お尻ふりふり → 飛びかかる
        face(Math.sign(pointer.x - cat.x) || cat.facing);
        if (CL.hunt && MF.huntParts && animIs('hunt') && animDone()) {
          play('hunt', { from: MF.huntParts.wiggle[0], to: MF.huntParts.wiggle[1], pingpong: true });
        }
        if (cat.stateT >= cat.stateDur) pounce();
        break;
      }
      case 'land':
        if (cat.stateT >= cat.stateDur) idle(rand(0.8, 3));
        break;
      case 'act': {
        // 予定表の一歩を進める：線路は絵が最後まで行ったら到着、動きは決めた周回が終わったら次へ
        const stp = cat.step;
        if (!stp) { nextStep(); break; }
        if (stp.kind === 'track' && animDone()) { cat.pose = stp.track[1]; nextStep(); }
        else if (stp.kind === 'act' && cat.stateT >= stp.until) nextStep();
        else if (stp.kind === 'part' && animDone()) nextStep();
        else if (stp.kind === 'freeze' && cat.stateT >= stp.until) nextStep();
        else if (stp.kind === 'turn' && cat.stateT >= stp.until) nextStep();
        // すりすり：体をこすりつけるたびに、カーソルがちょっとだけ押される（1周に1回）
        if (stp.kind === 'act' && stp.name === 'rub' && CL.rub) {
          const cyc = Math.floor(cat.stateT * CL.rub.fps / CL.rub.n);
          const ph = (cat.stateT * CL.rub.fps % CL.rub.n) / CL.rub.n;
          if (ph > 0.5 && stp.nudged !== cyc && Math.hypot(pointer.x - cat.x, pointer.y - (cat.y - H * 0.5)) < W) {
            stp.nudged = cyc; knockCursor(cat.facing, 0.12, true);
          }
        }
        if (stp.kind === 'act' && stp.name === 'yannoStep' && cat.plat) {
          // やんのかステップ：カーソルの方へピョンピョン寄っていく（足場の外には出ない）
          const p = currentSurface() || floor();
          const [a, b] = walkRange(p);
          const dir = Math.sign(pointer.x - cat.x) || cat.facing;
          face(dir);
          // 範囲の外（着地で足場の端ぎりぎりに乗った時など）にいるときは、範囲の中へワープさせない。
          //   以前は clamp で1フレームに27pxほど瞬間移動していた。今いる位置までは許して、それより外へは出さない
          cat.x = clamp(cat.x + dir * 38 * dt, Math.min(a, cat.x), Math.max(b, cat.x));
        }
        break;
      }
      case 'arch':
        // アーチの駅で少しにらんでから、毛を戻して立つ
        face(Math.sign(pointer.x - cat.x) || cat.facing);
        if (cat.stateT >= cat.stateDur) {
          // 毛を戻して立つ → ブルブルで気持ちを切り替える
          const steps = (findTracks('arch', 'stand') || []).map((t) => ({ kind: 'track', track: t }));
          if (hasAct('shake')) steps.push({ kind: 'act', name: 'shake', cycles: 1 });
          steps.push({ kind: 'rest', pose: 'stand', dur: rand(1, 2) });
          plan(steps);
        }
        break;
      case 'punch': {
        // 前足が一番伸びたコマの瞬間に、まだカーソルが届く範囲にいれば「当たり」
        const pc = cat.punch;
        if (pc && pc.next < pc.hits.length && cat.stateT >= pc.hits[pc.next]) {
          // 連打は2発目以降を少し弱く（タタタッと小刻みに弾く）
          const pw = pawPoint();
          if (Math.hypot(pointer.x - pw.x, pointer.y - pw.y) < REACH * 1.5) {
            const dir = (cat.pose === FRONT_SPOT || cat.pose === PLAY_SPOT) ? (Math.sign(pointer.x - cat.x) || 1) : cat.facing;
            knockCursor(dir, (pc.power || 1) * (pc.next === 0 ? 1 : 0.6));
          }
          pc.next++;
        }
        if (animDone()) rest(cat.pose, rand(1, 2.5));
        break;
      }
      case 'lie':
        // 寝そべり：時間が来たら次を決める（寝ていた姿勢なら起きる流れ）
        //   寝ていることは Zzz の文字ではなく、閉じた目と寝息・尻尾の動き（ドット絵）だけで見せる
        if (cat.stateT >= cat.stateDur) decide();
        break;
      case 'play':
        // 寝転んでじゃれている。しばらく構われないと起き上がって座りに戻る
        if (now - (cat.lastTeaseAt || -99) > 6 && cat.stateT > 6) planPose('sit', rand(2, 5));
        else if (cat.stateT >= cat.stateDur) planPose('sit', rand(2, 5));
        break;
      case 'front':
        // 正面座り：こっちをじっと見る。ときどきゆっくりまばたき
        if (Math.random() < frameDt * 0.25) { cat.blinkUntil = now + 0.7; }
        // じっと見つめ合っていると、首をかしげる
        if (CL.frontTilt && cat.pose === FRONT_SPOT && stillNear() > 1.5 && now - lastTiltAt > 12 && Math.random() < frameDt * 0.5) {
          lastTiltAt = now; planAct('frontTilt', rand(3, 8)); break;
        }
        if (cat.stateT >= cat.stateDur) decide();
        break;
      case 'sit': case 'loaf':
        if (cat.state === 'loaf' && maybeStartle()) break;
        // すりすり・カカカが始まったら、このフレームはここで終わり（下の「次を決める」で上書きしない）
        if (cat.state === 'sit') { if (maybeGreet() || maybeRub() || maybeReach() || maybeChatter()) break; maybeStare(); }
        // 座り・香箱で休んでいる間もカーソルの方を向く。時間が来たら次を決める
        //   ただし香箱は体ごと裏返らない（寝そべった猫がパッと左右反転すると瞬間移動に見える）。
        //   香箱は首だけで振り返る（描画の gaze.back）
        const backLook = MF.gaze && MF.gaze[cat.pose] && MF.gaze[cat.pose].back;   // 座りも香箱も、首で振り返れるなら反転しない
        if (!backLook && near && (pointer.x - cat.x) * cat.facing < -W * 0.6 && cat.stateT > 1.5) face(-cat.facing);
        if (cat.stateT >= cat.stateDur) decide();
        break;
      case 'sleep':
        // 丸まって寝ている（寝息のくり返しは rest() で流している）。時間が来たら起きる
        if (cat.stateT >= cat.stateDur) { wakeUp(); break; }
        // ときどき夢を見てピクピク（残りの寝る時間はそのまま引き継ぐ）
        if (hasAct('dream') && cat.stateT > 6 && cat.stateDur - cat.stateT > 8 && Math.random() < frameDt * 0.04) {
          planAct('dream', cat.stateDur - cat.stateT); break;
        }
        // （以前は Zzz の文字を飛ばしていた。寝ていることはドット絵だけで見せるので無し）
        break;
      case 'purr':
        if (now - lastPetAt > 1.4) endPurr();
        // 香箱で長くなでられ続けると（7秒）、ちょっとイラッとして尻尾をパタンパタン
        else if (cat.pose === 'loaf' && cat.stateT > 7 && hasAct('tailThump')) {
          endPurr(); petAmount = 0;
          planAct('tailThump', rand(2, 4));
        }
        // （以前は ♥ を飛ばしていた。気持ちよさは目を細める・首をかしげる（描画側）だけで見せるので無し）
        break;
      case 'held': {
        // つままれている：首根っこがカーソルに付いてくる。揺れはrender側
        const o = scruffOffset();
        cat.x = pointer.x - o.x; cat.y = pointer.y - o.y;
        if (CL.dangle && LOOPS.dangle && animDone()) play('dangle', { from: LOOPS.dangle[0], to: LOOPS.dangle[1], loop: true });
        break;
      }
    }

    // --- 空中の物理 ---
    if (cat.state === 'air') {
      refreshPlatformsIfStale(0.08);
      const prevY = cat.y;
      cat.vy += G * dt;
      cat.x += cat.vx * dt;
      cat.y += cat.vy * dt;
      // 左右の壁で跳ね返る
      if (cat.x < W * 0.5) { cat.x = W * 0.5; cat.vx = Math.abs(cat.vx) * 0.4; }
      if (cat.x > vw - W * 0.5) { cat.x = vw - W * 0.5; cat.vx = -Math.abs(cat.vx) * 0.4; }
      // 天井：画面の上に消えないように
      if (cat.y < H * 0.9 && cat.vy < 0) { cat.y = H * 0.9; cat.vy = Math.abs(cat.vy) * 0.2; }
      // 着地判定（上から下へ足場の上辺をまたいだら乗る）
      if (cat.vy > 0) {
        let hitP = null;
        for (const p of platforms) {
          const top = p.floor ? vh : p.top;
          if (prevY <= top + 2 && cat.y >= top && cat.x >= p.left - W * 0.2 && cat.x <= p.right + W * 0.2) {
            if (!hitP || top < (hitP.floor ? vh : hitP.top)) hitP = p;
          }
        }
        if (!hitP && cat.y >= vh) hitP = floor();
        if (hitP) land(hitP.floor ? floor() : hitP, cat.vy);
      }
      // 空中では進行方向を向く
      if (Math.abs(cat.vx) > 60) face(Math.sign(cat.vx));
    }

    // 画面幅の変化などで外に出ないように
    if (cat.state !== 'held' && cat.state !== 'air') cat.x = clamp(cat.x, W * 0.3, vw - W * 0.3);

    // スマホ：猫を長押し（動かさない）＝ なでている扱い
    if (down && down.touch && cat.state !== 'held' && cat.plat && now - down.t > 0.45) {
      if (!down.longPress) { down.longPress = true; startPurr(); }
      lastPetAt = now;
    }

    // なで量は時間で減る
    petAmount = Math.max(0, petAmount - 60 * dt);

    // 跳んだ・落ちた記録は直近200件だけ残す（開きっぱなしでも増え続けないように）
    if (JLOG.length > 400) JLOG.splice(0, JLOG.length - 200);

    // 吹き出し
    if (bubbleUntil && now > bubbleUntil) { bubble.classList.remove('on'); bubbleUntil = 0; }
  }

  // ---------------------------------------------------------------
  // 猫パンチ・すれ違いざまの飛びかかり
  // ---------------------------------------------------------------
  const REACH = Math.max(40, W * 0.42);          // 前足が届く距離（猫の体の大きさに比例）
  let lastReflexAt = -99, lastQuickPounceAt = -99;
  // 前足の先の位置（猫の顔の少し前・少し下）
  function pawPoint() {
    // 正面座り：前足は体の真ん中・胸の高さ（こっちに向かって手を出す）
    if (cat.pose === FRONT_SPOT) return { x: cat.x, y: cat.y - H * 0.45 };
    if (cat.pose === PLAY_SPOT) return { x: cat.x - cat.facing * W * 0.05, y: cat.y - H * 0.35 };   // 仰向けで上げた前足のあたり
    const up = cat.pose === 'sit' ? 0.55 : 0.45;
    return { x: cat.x + cat.facing * W * 0.5, y: cat.y - H * up };
  }
  // 姿勢ごとの「手を出す」絵：立ち＝立ちパンチ、座り＝ちょいちょい、正面座り＝正面ちょいちょい
  function swipeClipFor(pose, power) {
    const pickHave = (arr) => { const have = arr.filter((c) => CL[c]); return have.length ? pick(have) : null; };
    if (pose === 'stand') return power >= 1 ? pickHave(['punch', 'punch', 'punchCombo']) : pickHave(['punch']);
    if (pose === 'sit') return power >= 1 ? pickHave(['swipe']) : (cat.teaseCount >= 2 ? pickHave(['tapRapid', 'swipe']) : pickHave(['swipe']));
    if (pose === FRONT_SPOT) return pickHave(['frontSwipe']);
    if (pose === PLAY_SPOT) return pickHave(['lieSwipe', 'lieKick']);
    return null;
  }
  // 手を出す（power=1 で本気、0.5 くらいで軽く）
  function doSwipe(power) {
    const clip = swipeClipFor(cat.pose, power);
    if (!clip || !CL[clip]) return false;
    lastReflexAt = now;
    cat.queue = []; cat.step = null;
    setState('punch');
    play(clip);
    cat.anim.fps = CL[clip].fps * (power >= 1 ? 1.6 : 1.2);    // 反射は速め、構われたときは少しゆっくり
    // 当たりのタイミング（1回なら数値、連打なら配列）。動きの長さのうち何割の時点か
    const hv = (MF.punchHit && MF.punchHit[clip]) != null ? MF.punchHit[clip] : 0.4;
    const fracs = Array.isArray(hv) ? hv : [hv];
    const dur = CL[clip].n / cat.anim.fps;
    cat.punch = { hits: fracs.map((f) => f * dur), next: 0, power };
    return true;
  }
  // 視線の基準になる顔の位置（姿勢ごとのおおよその高さ）
  function gazeHead() {
    const up = { stand: 0.8, sit: 0.85, loaf: 0.5, sphinx: 0.5, chin: 0.35 }[cat.pose] || 0.8;
    const fwd = cat.pose === FRONT_SPOT ? 0 : 0.35;
    return { x: cat.x + cat.facing * W * fwd, y: cat.y - H * up };
  }
  function maybeReflex(dt) {
    if (reducedMotion || !cat.plat) return;
    if (!['idle', 'walk', 'sit', 'hunt', 'front', 'play'].includes(cat.state)) { cat.teaseT = 0; return; }
    // すりすりした直後は甘えモード：そのカーソルを叩きに行かない
    if (now - lastRubAt < 9) { cat.teaseT = 0; return; }
    const tNow = performance.now() / 1000;
    const pw = pawPoint();
    const d = Math.hypot(pointer.x - pw.x, pointer.y - pw.y);
    // 猫の前側か（正面座りはこっち向きなので左右どちらでも前）
    const front = cat.pose === FRONT_SPOT || cat.pose === PLAY_SPOT || (pointer.x - cat.x) * cat.facing > -W * 0.1;
    const moving = tNow - pointer.lastMove < 0.08;
    // ① 前足が届く範囲を、それなりの速さで横切った → 即パンチ（本気）
    if (moving && front && d < REACH && pointer.speed > 250 && now - lastReflexAt > 1.2) {
      if (doSwipe(1)) { cat.teaseT = 0; return; }
    }
    // ② 顔の近くにゆっくり来て居座っている（構われている）→ 体はそのままで、軽くちょいちょい
    //    居座っている限り、少し間をあけて何度でも
    if (front && d < REACH * 1.15 && cat.state !== 'walk') {
      cat.teaseT = (cat.teaseT || 0) + dt;
      if (!cat.teaseNeed) cat.teaseNeed = rand(0.4, 0.9);
      if (cat.teaseT > cat.teaseNeed && now - lastReflexAt > 1.4) {
        // 何回も構われると、遊びモードに入る：座り → 連打ちょいちょい → ゴロン（寝転んでじゃれる駅へ）
        if (now - (cat.lastTeaseAt || -99) > 5) cat.teaseCount = 0;
        cat.lastTeaseAt = now;
        cat.teaseCount = (cat.teaseCount || 0) + 1;
        cat.teaseT = 0; cat.teaseNeed = rand(0.5, 1.2);
        if (cat.pose === 'sit' && PLAY_SPOT && cat.teaseCount >= 4 && Math.random() < 0.6) {
          lastReflexAt = now;
          planPose(PLAY_SPOT, rand(12, 30));
          return;
        }
        if (doSwipe(0.5)) return;
      }
    } else {
      cat.teaseT = Math.max(0, (cat.teaseT || 0) - dt * 2);
    }
    if (!moving) return;
    // ② 少し先を速く通り過ぎた → 溜めなしで飛びかかる（立っているときだけ・ときどき）
    const lowPtr = pointer.y - cat.y < 30 && pointer.y - cat.y > -H * 0.6;   // 床すれすれを通った
    if (cat.pose === 'stand' && front && lowPtr && d > REACH && d < 300 && pointer.speed > 700 &&
        now - lastQuickPounceAt > 45 && Math.random() < 0.1) {   // すれ違い飛びかかりはかなり控えめに
      lastQuickPounceAt = now;
      cat.queue = []; cat.step = null;
      pounce();
    }
  }

  // カーソルを殴られた方向に吹っ飛ばして、バネで元の位置へ戻す（見た目だけ）
  const knock = { on: false, t: 0, ox: 0, oy: 0, vx: 0, vy: 0 };
  function knockCursor(dir, power = 1, quiet = false) {
    knock.on = true; knock.t = 0;
    knock.ox = 0; knock.oy = 0;
    knock.vx = dir * rand(1100, 1500) * power; knock.vy = -rand(400, 700) * power;
    document.documentElement.classList.add('neko-knock');
    fakeCursor.style.display = 'block';
    // （以前は当たったところに ✦ を出していた。絵文字の演出はやめて、カーソルが飛ぶ動きだけで見せる）
    //   quiet は「すりすりで軽く押す」ときの印。今はどちらも星を出さないので見た目は同じ
    void quiet;
  }
  function updateKnock(dt) {
    if (!knock.on) return;
    knock.t += dt;
    // 減衰するバネ：飛んでいって、ぽよんと戻る
    const k = 55, c = 10;
    knock.vx += (-k * knock.ox - c * knock.vx) * dt;
    knock.vy += (-k * knock.oy - c * knock.vy) * dt;
    knock.ox += knock.vx * dt; knock.oy += knock.vy * dt;
    const rot = clamp(knock.vx / 40, -45, 45);
    fakeCursor.style.transform = `translate3d(${(pointer.x + knock.ox).toFixed(1)}px,${(pointer.y + knock.oy).toFixed(1)}px,0) rotate(${rot.toFixed(1)}deg)`;
    if (knock.t > 0.9 && Math.hypot(knock.ox, knock.oy) < 2) {
      knock.on = false;
      fakeCursor.style.display = 'none';
      document.documentElement.classList.remove('neko-knock');
    }
  }

  // カーソルを猫の近くで素早く動かすと狩りモード
  function maybeHunt() {
    if (reducedMotion || now - lastHuntAt < 30) return;   // 狩り（かまえ→飛びかかる）は30秒に1回まで
    // 前足が届く距離にいるカーソルは、狩りのかまえではなくパンチで迎え撃つ
    const pw0 = pawPoint();
    if (Math.hypot(pointer.x - pw0.x, pointer.y - pw0.y) < REACH * 1.6) return;
    const dx = pointer.x - cat.x, dy = pointer.y - cat.y;
    const dist = Math.hypot(dx, dy);
    const movingNow = performance.now() / 1000 - pointer.lastMove < 0.1;
    // 獲物っぽい動き＝床すれすれ（猫の体の高さ）を、速すぎない速さで動いている。
    //   画面の上の方を通り過ぎるだけのカーソル（ふつうの操作）には反応しない
    const prey = dy < 30 && dy > -H * 0.6 && pointer.speed > 600 && pointer.speed < 2600;
    if (dist > 120 && dist < 420 && prey && movingNow) {
      lastHuntAt = now;
      if (Math.random() > 0.4) return;   // 気が乗らないこともある
      setState('hunt', rand(0.9, 1.6));
      // かまえの絵があれば：身を低くする部分 → お尻ゆさゆさの部分を往復でくり返す（update側でつなぐ）
      if (CL.hunt && MF.huntParts) play('hunt', { from: MF.huntParts.crouch[0], to: MF.huntParts.crouch[1] });
    }
  }

  function pounce() {
    cat.pouncing = true;   // 着地したら押さえ込み（land で見る）
    JLOG.push([+now.toFixed(1), cat.state === 'hunt' ? 'hunt' : 'quickPounce']);
    // カーソルの位置を頂点に通るように跳ぶ
    const tx = pointer.x, ty = pointer.y;
    const h = clamp(cat.y - ty, 50, Math.min(innerHeight * 0.6, W * 3));
    const vy0 = -Math.sqrt(2 * G * h);
    const tUp = -vy0 / G;
    cat.plat = null;
    cat.vx = clamp((tx - cat.x) / tUp, -1000, 1000);
    cat.vy = vy0;
    cat.sy = 1.2; cat.sx = 0.86;
    setState('air');
  }

  // カーソルを近くでじっと止めておくと、ゆっくりまばたき（信頼のサイン）
  function maybeSlowBlink() {
    const tNow = performance.now() / 1000;
    const still = tNow - pointer.stillSince;
    const d = Math.hypot(pointer.x - cat.x, pointer.y - cat.y);
    if (still > 3 && d < 320 && now - lastSlowBlinkAt > 12) {
      lastSlowBlinkAt = now;
      cat.blinkUntil = now + 0.9;
      cat.nextBlink = now + rand(3, 6);
    }
  }

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------
  const lerp = (a, b, k) => a + (b - a) * k;

  function render() {
    const st = cat.state, T = cat.stateT;
    let targetSx = 1, targetSy = 1, rot = 0, offY = 0, offX = 0;
    let headT = 0;
    let closed = false;
    let breathAmp = 0.012, breathRate = 1.6;

    // まばたき
    if (now > cat.nextBlink) {
      cat.blinkUntil = now + 0.12;
      cat.nextBlink = now + (Math.random() < 0.2 ? 0.25 : rand(2.5, 6)); // たまに2回まばたき
    }
    if (now < cat.blinkUntil) closed = true;

    // カーソルの方を見る（首の角度）
    const hw = headWorld();
    const pdx = (pointer.x - hw.x) * cat.facing, pdy = pointer.y - hw.y;
    const lookable = Math.hypot(pdx, pdy) < 450 && pdx > -20;
    if (lookable) headT = clamp(Math.atan2(pdy, Math.max(pdx, 40)) * 0.4, -0.24, 0.26);

    switch (st) {
      case 'walk': {
        // コマ絵に歩きが入っているので、体を揺らす演出はしない
        if (cat.speed > 100) { targetSx = 1.04; targetSy = 0.97; }
        break;
      }
      case 'crouch':
        targetSy = 0.8; targetSx = 1.14;
        break;
      case 'hunt':
        // かまえの絵が無いときだけ、体を縮めて揺らす演出で代用する
        if (!(CL.hunt && MF.huntParts)) {
          targetSy = 0.86; targetSx = 1.1;
          rot = Math.sin(now * 38) * 2.5; offX = Math.sin(now * 38) * 1.5; // お尻ふりふり
        }
        headT = clamp(headT, -0.2, 0.25);
        break;
      case 'air':
        targetSy = clamp(1 + Math.abs(cat.vy) / 9000, 1, 1.12);
        targetSx = 2 - targetSy;
        // 上昇中は鼻先が上、落下中は鼻先が下を向く
        rot = Math.abs(cat.vx) > 30 ? clamp(cat.vy / 80, -12, 12) * cat.facing : 0;
        break;
      case 'sleep':
        closed = true; headT = 0.14;
        breathAmp = 0.028; breathRate = 0.55;
        break;
      case 'purr':
        closed = true; headT = -0.12 + Math.sin(now * 3) * 0.05;
        breathAmp = 0.02; breathRate = 1.1;
        // （以前はゴロゴロの微振動で体を揺らしていたが、ただ震えて見えるので無し）
        break;
      case 'held': {
        // つままれてぶらーん：カーソルの横の速さで振り子のように揺れる
        // 絵の中でもう揺れているので、ここでは振った勢いのぶんだけ傾ける
        const swing = clamp(-pointer.vx / 80, -18, 18);
        cat.heldRot = lerp(cat.heldRot || 0, swing, 0.1);
        rot = cat.heldRot;
        headT = -0.18;
        break;
      }
    }

    // 振り向き中：踏み替えの上下（2歩）と、Uの字に前へふくらむ軌道
    const turning = st === 'act' && cat.step && cat.step.kind === 'turn' && CL.turnAround;
    if (turning) {
      const t = cat.stateT;
      // 頭を低く：①②で体を沈めて鼻先を下げ、③で体が回り込みながら元の高さへ戻る
      const low = t < TURN_HOLD ? ease(t / TURN_HEAD) : 1 - ease((t - TURN_HOLD) / (TURN_DUR - TURN_HOLD));
      targetSy = 1 - 0.07 * low; targetSx = 1 + 0.03 * low;
      rot = cat.facing * 3 * low;                                                             // 鼻先が下がる向きに3°
      if (t >= TURN_HOLD) {
        const u = (t - TURN_HOLD) / (TURN_DUR - TURN_HOLD);
        offX = cat.facing * W * 0.10 * Math.sin(Math.PI * u);                                 // 体が前にふくらんで回り込む
        offY = Math.abs(Math.sin(u * Math.PI * 2)) * 2 * S;                                   // トトッ（2歩・2ドット）
      }
    }
    // 向き変えの演出（横につぶれて戻る）
    if (cat.turnPulse > 0) { targetSx *= 1 - cat.turnPulse * 0.35; cat.turnPulse = Math.max(0, cat.turnPulse - 0.12); }

    // ぷにっと戻るバネ
    cat.sx = lerp(cat.sx, targetSx, 0.2);
    cat.sy = lerp(cat.sy, targetSy, 0.2);
    cat.headAngle = lerp(cat.headAngle, headT, 0.12);
    cat.offY = offY;
    cat.breath += frameDt * breathRate * Math.PI * 2;

    // --- 今のコマを選ぶ ---
    // 歩き：歩いた距離でコマを送る（速さが変わっても足が床を滑らない）
    // 空中：脚を伸ばしたコマ／それ以外：立ちコマ（目を閉じる場面はまばたきコマ）
    let fi = POSE_FRAME[cat.pose] != null ? POSE_FRAME[cat.pose] : IDLE;
    if (st === 'walk') fi = CL.walk.s + Math.floor(cat.walkPhase) % CL.walk.n;
    else if (turning) fi = turnFrame(Math.min(cat.stateT, TURN_DUR));
    else if (cat.anim) fi = animIndex();
    else if ((st === 'air' || st === 'held') && CL.jump && MF.jump) {
      // 空中：上がっている間と落ちている間でコマを変える
      fi = CL.jump.s + (st === 'held' || cat.vy > 0 ? MF.jump.fall : MF.jump.rise);
    } else if (st === 'hunt' && CL.jump && MF.jump) {
      fi = CL.jump.s + MF.jump.crouch[0]; // 飛びかかる前は身を低くする
    }
    // --- 視線：休んでいる姿勢で、近くでカーソルが動いていたら、首振りの絵の中からカーソルの方を向くコマを選ぶ ---
    //   manifest.gaze[姿勢] = { clip, range:[下(左)を向くコマ, 上(右)を向くコマ], kind:'pitch'|'yaw' }
    //   pitch＝上下（横向きの姿勢）、yaw＝左右（正面座り）
    let gazing = false;
    const gz = MF.gaze && MF.gaze[cat.pose];
    // 寝そべり（lie）は、その寝そべりに首振りの絵があるときだけ（スフィンクス・あご乗せ）
    const restNow = { idle: 'stand', sit: 'sit', loaf: 'loaf', front: FRONT_SPOT }[st] === cat.pose || (st === 'lie' && !!gz);
    if (gz && CL[gz.clip] && restNow) {
      const hp = gazeHead();
      const dx = pointer.x - hp.x, dy = pointer.y - hp.y;
      const attentive = Math.hypot(dx, dy) < 480 && performance.now() / 1000 - pointer.lastMove < 3;
      // 振り返り（gz.back）：背中側でカーソルが動いたら、肩越しにくるっと振り返る。
      //   backT＝0（前を向いている）〜1（完全に振り返った）。いきなり切り替えず、首を回すようになめらかに
      const bk = gz.back && CL[gz.back.clip] ? gz.back : null;
      if (bk) {
        const behind = attentive && dx * cat.facing < -W * 0.15;
        cat.backT = lerp(cat.backT || 0, behind ? 1 : 0, behind ? 0.08 : 0.12);
        if (cat.backT < 0.02) cat.backT = 0;
      }
      if (bk && cat.backT > 0) {
        fi = CL[bk.clip].s + Math.round(bk.range[0] + cat.backT * (bk.range[1] - bk.range[0]));
        cat.gazeIdx = null;
        gazing = true;
      } else if (attentive) {
        let t;
        if (gz.kind === 'yaw') {
          // 正面座り：画面上で左にいれば左を、右にいれば右を見る（反転しているときは逆）
          t = clamp(0.5 + (dx / 520) * (gz.leftIsScreenLeft ? 1 : -1) * cat.facing, 0, 1);
        } else {
          // 横向き：顔の前方向を0°として、上向きが＋。下45°〜上75°をコマの範囲に対応させる
          const ang = Math.atan2(-dy, Math.max(dx * cat.facing, 8)) * 180 / Math.PI;
          t = clamp((ang + 45) / 120, 0, 1);
        }
        const target = gz.range[0] + t * (gz.range[1] - gz.range[0]);
        cat.gazeIdx = cat.gazeIdx == null ? target : lerp(cat.gazeIdx, target, 0.18);  // 首はなめらかに追う
        fi = CL[gz.clip].s + Math.round(cat.gazeIdx);
        gazing = true;
      } else cat.gazeIdx = null;
    } else { cat.gazeIdx = null; cat.backT = 0; }
    cat.gazing = gazing;

    // 止まっている姿勢のコマは、その姿勢の「尻尾ゆらゆら」に差し替える（manifest.holds）
    // 揺れる速さは気分次第：近くでカーソルが動いている＝気になってる → 速く、寝ている・なでられている → ゆっくり
    const hold = !gazing && MF.holds && MF.holds[fi];
    if (hold && CL[hold]) {
      const c = CL[hold];
      const watching = Math.hypot(pointer.x - cat.x, pointer.y - cat.y) < 380 && performance.now() / 1000 - pointer.lastMove < 0.3;
      const rate = st === 'purr' || st === 'sleep' ? 0.6 : watching ? 1.8 : 1;
      cat.tailT += frameDt * rate;
      fi = c.s + pingpongIndex(Math.floor(cat.tailT * c.fps), c.n);
    }
    const bf = MF.blink[fi];
    if (closed && bf != null) fi = bf;
    void breathAmp; void breathRate; // v2は呼吸の伸縮なし（ドットがにじむため）

    // --- キャンバスに描く（ドットをにじませない） ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    // 等倍より小さく描くとき（data-scale が 1 未満）は、ドットを間引くと目や縞が欠けるので、なめらかに縮める
    // 1 以上はドットをにじませない（今まで通り）
    if (S < 1) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    else ctx.imageSmoothingEnabled = false;
    // 空中コマは絵の中で浮いている分だけ下げて描く（manifest.drop）
    const drop = (MF.drop && MF.drop[fi]) || 0;
    // 絵は横 MF.cols コマで折り返した格子（無ければ昔の1列並び）
    const COLS = MF.cols || 1e9;
    ctx.drawImage(sprite, (fi % COLS) * SP_W, Math.floor(fi / COLS) * SP_H, SP_W, SP_H, PAD_X, PAD_T + drop * S, DW, DH);

    // --- 要素全体の位置・反転・つぶれ ---
    let ox, oy, tx, ty;
    if (st === 'held') {
      // 首根っこを支点にしてカーソル位置へ
      // 反転は支点まわりに起きるので、支点＝首根っこにしておけば向きに関係なく位置がずれない
      ox = PAD_X + SCRUFF.x * S; oy = PAD_T + SCRUFF.y * S;
      tx = pointer.x; ty = pointer.y;
    } else {
      ox = OX; oy = OY;
      tx = cat.x + offX; ty = cat.y - offY;
    }
    catEl.style.transformOrigin = `${ox}px ${oy}px`;
    catEl.style.transform =
      `translate3d(${(tx - ox).toFixed(1)}px,${(ty - oy).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${(cat.facing * cat.sx).toFixed(3)},${cat.sy.toFixed(3)})`;

    // 吹き出しは頭の上に付いていく
    if (bubbleUntil) {
      const h = headWorld();
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      const bx = clamp(h.x - bw / 2, 4, innerWidth - bw - 4);
      const by = Math.max(4, h.y - H * 0.42 - bh);
      bubble.style.transform = `translate3d(${bx}px,${by}px,0)`;
    }
  }

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------
  let scrollQueued = false;
  function onScrollOrResize() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; collectPlatforms(); });
  }

  function start() {
    document.head.appendChild(style);
    document.body.appendChild(root);
    sizeCanvas();
    makeFrames();
    collectPlatforms();
    if (CFG.start === 'walk') {
      // 画面の端から歩いて登場
      cat.facing = -1;
      cat.x = innerWidth + W * 0.6; cat.y = innerHeight;
      cat.plat = { el: null, floor: true, lastLeft: 0 };
      startWalk(innerWidth * rand(0.55, 0.8), WALK_SPEED);
    } else {
      // 上から落ちてくる
      cat.x = innerWidth * rand(0.55, 0.8);
      cat.y = -10;
      setState('air');
    }
    addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
    addEventListener('resize', () => { sizeCanvas(); onScrollOrResize(); });
    if (window.matchMedia) {
      // 画面の拡大率(DPR)が変わったとき用
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', sizeCanvas);
    }
    requestAnimationFrame(tick);
  }

  sprite.decoding = 'async';
  sprite.onload = () => {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  };
  sprite.onerror = () => {
    // webp が読めない環境用に png へ切り替え
    if (sprite.src !== CFG.spriteFallback) sprite.src = CFG.spriteFallback;
  };
  sprite.src = CFG.sprite;

  // ---------------------------------------------------------------
  // 外部API
  // ---------------------------------------------------------------
  window.Neko = {
    say: (t, d) => say(String(t), d, true),
    hide() { cat.hidden = true; root.style.display = 'none'; },
    show() { cat.hidden = false; root.style.display = ''; },
    sleep() { if (cat.plat) goSleep(rand(40, 120)); },
    wake() { if (cat.state === 'sleep') wakeUp(); },
    sit(dur) { if (cat.plat) planPose('sit', dur || rand(4, 12)); },
    stand(dur) { if (cat.plat) planPose('stand', dur || rand(2, 5)); },
    loaf(dur) { if (cat.plat) planPose('loaf', dur || rand(5, 15)); },
    groom() { if (cat.plat) planAct('lick'); },
    // 寝そべり・正面座りの駅へ（例：Neko.spot('belly')）。今の駅から線路をたどって移動する
    spot(name) { if (cat.plat && SPOTS[name]) return planPose(name, rand(20, 60)); return false; },
    // 名前で動きをやらせる（例：Neko.act('yawn')）。必要なら駅を移動してから
    act(name) { if (cat.plat) return planAct(name); return false; },
    get pose() { return cat.pose; },
    // 調整用：前足の位置・届く距離・カーソルの速さなど
    jlog() { return JLOG.slice(-50); },
    // その場でくるっと振り向く（確認用。普段はカーソルが背中側に居続けたときや、後ろへ歩き出すときに出る）
    turn() { if (cat.plat) standThen(() => turnAround()); },
    debug() { return { paw: pawPoint(), reach: REACH, pointer: { x: pointer.x, y: pointer.y, speed: pointer.speed }, cat: { x: cat.x, y: cat.y, facing: cat.facing, state: cat.state, pose: cat.pose, backT: cat.backT, now, lastRubAt, relax: Math.round(cat.relax || 0), gazing: cat.gazing, gazeIdx: cat.gazeIdx, step: cat.step ? (cat.step.name || cat.step.clip || (cat.step.track ? cat.step.track[0] + ">" + cat.step.track[1] : cat.step.kind)) : null } }; },
    jump() { if (cat.plat) standThen(() => { if (!tryJumpToRandomPlatform()) idle(); }); },
    // 画面のx座標まで歩かせる（立っている足場の範囲内に収める）
    walkTo(x, run) {
      if (!cat.plat) return;
      standThen(() => {
        const p = currentSurface() || floor();
        const [a, b] = walkRange(p);
        startWalk(clamp(x, a, b), run ? RUN_SPEED : WALK_SPEED);
      });
    },
    get state() { return cat.state; },
  };
})();
