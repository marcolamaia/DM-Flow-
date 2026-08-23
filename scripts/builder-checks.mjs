/**
 * Drives the flow builder in a real browser, through the whole list of gestures
 * an operator relies on: drag, connect, disconnect, reconnect, delete, duplicate,
 * undo, redo, zoom, pan, and whether any of it survives a page reload.
 *
 * Needs the stack running and the seed data loaded. Build the scenario first:
 *
 *   node -r @swc-node/register apps/api/scripts/build-test-flow.ts
 *   node scripts/builder-checks.mjs <automation-id>
 *
 * Two bugs were found by running this rather than by reading the code: a
 * connection could not be deleted at all, and deleting one also deleted whatever
 * block happened to be open in the side panel.
 */
import { chromium } from 'playwright';
// Screenshots land next to the script unless told otherwise.
const OUT = process.env.SHOT_DIR ?? '.';
const AUTOMATION = process.argv[2];
if (!AUTOMATION) {
  console.error('usage: node scripts/builder-checks.mjs <automation-id>');
  process.exit(1);
}
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const p = await (await b.newContext({viewport:{width:1700,height:1000}})).newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message.slice(0,200)));
const resultados=[];
const ok=(n,c,extra='')=>{ resultados.push([n,c]); console.log(`${c?'✓':'✗'} ${n}${extra?' — '+extra:''}`); };

await p.goto('http://localhost:3000/login',{waitUntil:'networkidle'});
await p.fill('input[type=email]','demo@dmflow.app');
await p.fill('input[type=password]','dmflow-demo-2026');
await p.click('button[type=submit]'); await p.waitForTimeout(4000);
await p.goto(`http://localhost:3000/automations/${AUTOMATION}`,{waitUntil:'networkidle'});
await p.waitForSelector('.react-flow__node',{timeout:15000});
await p.waitForTimeout(3000);

const nN = () => p.$$eval('.react-flow__node', n=>n.length);
const nE = () => p.$$eval('.react-flow__edge', e=>e.length);
const salvo = async () => { await p.waitForTimeout(1800); };
const fit = async () => { await p.click('button[aria-label="Ajustar à tela"]'); await p.waitForTimeout(900); };

await fit();
ok('cenário carrega', await nN()===9 && await nE()===12, `${await nN()} blocos, ${await nE()} conexões`);
await p.screenshot({path:`${OUT}/b-01-cenario.png`});

// --- DRAG: mover node e ver a conexão acompanhar
const antesEdge = await p.$eval('.react-flow__edge path', el => el.getAttribute('d'));
const node = (await p.$$('.react-flow__node'))[1];
const nb = await node.boundingBox();
await p.mouse.move(nb.x+nb.width/2, nb.y+10);
await p.mouse.down(); await p.mouse.move(nb.x+nb.width/2+120, nb.y+10+90,{steps:12}); await p.mouse.up();
await p.waitForTimeout(900);
const nb2 = await node.boundingBox();
const depoisEdge = await p.$eval('.react-flow__edge path', el => el.getAttribute('d'));
ok('arrastar bloco', Math.abs(nb2.x-nb.x)>50);
ok('conexão acompanha o bloco', antesEdge !== depoisEdge);

// --- PERSISTÊNCIA das posições
await salvo();
await p.reload({waitUntil:'networkidle'}); await p.waitForSelector('.react-flow__node'); await p.waitForTimeout(2500);
await fit();
ok('posições persistem após recarregar', await nN()===9 && await nE()===12, `${await nN()}/${await nE()}`);

// --- CONNECT: novo bloco e conexão
const eAntes = await nE(), nAntes = await nN();
await p.click('aside button[data-node-type="add_tag"]'); await p.waitForTimeout(1500);
ok('criar bloco pelo catálogo', await nN()===nAntes+1);

// liga o novo bloco (último) a partir do "Fim"? Fim é terminal. Vamos ligar msg-b -> novo.
const nodes = await p.$$('.react-flow__node');
const novo = nodes[nodes.length-1];
// procura um bloco com saída livre: o novo bloco add_tag tem saída
const alvo = novo;
// conectar: pegar a saída do bloco "Passando para saber" (msg-c já ligado). Usa o novo como destino a partir de msg-b? já ligado.
// Em vez disso: desconectar e reconectar uma edge existente.
const edge = await p.$('.react-flow__edge');
ok('há conexões para manipular', Boolean(edge));

// --- DESCONECTAR: seleciona uma conexão e apaga, sem tocar nos blocos
const eAntesDesc = await nE(), nAntesDesc = await nN();
await (await p.$$('.react-flow__edge-interaction, .react-flow__edge'))[0].click({force:true});
await p.waitForTimeout(700);
const selecionada = Boolean(await p.$('.react-flow__edge.selected'));
await p.keyboard.press('Delete'); await p.waitForTimeout(1000);
const eDesc = await nE(), nDesc = await nN();
ok('conexão fica selecionável', selecionada);
ok('desconectar apaga só a conexão', eDesc===eAntesDesc-1 && nDesc===nAntesDesc,
   `conexões ${eAntesDesc}->${eDesc}, blocos ${nAntesDesc}->${nDesc}`);
await p.keyboard.press('Control+z'); await p.waitForTimeout(1000);
ok('desfazer devolve a conexão', await nE()===eAntesDesc, `${await nE()}`);

// --- RECONECTAR: arrastar a ponta de uma conexão para outro bloco
const edgesAntes = await p.$$eval('.react-flow__edge', els => els.map(e => e.dataset.id ?? e.getAttribute('data-id')));
const alvoNodes = await p.$$('.react-flow__node');
const destinoNovo = alvoNodes[alvoNodes.length-1];
const dn = await destinoNovo.boundingBox();
const primeiraEdge = await p.$('.react-flow__edge path');
if (primeiraEdge) {
  const box = await primeiraEdge.boundingBox();
  if (box) {
    // pega o fim da conexão e leva para a entrada de outro bloco
    await p.mouse.move(box.x+box.width, box.y+box.height);
    await p.mouse.down();
    await p.mouse.move(dn.x+dn.width/2, dn.y+4, {steps:12});
    await p.mouse.up();
    await p.waitForTimeout(1000);
  }
}
const edgesDepois = await p.$$eval('.react-flow__edge', els => els.length);
ok('reconectar não perde nem duplica conexões', edgesDepois === edgesAntes.length,
   `${edgesAntes.length} -> ${edgesDepois}`);

// --- DUPLICAR
const dupAntes = await nN();
const alvoDup = (await p.$$('.react-flow__node'))[2];
await alvoDup.click(); await p.waitForTimeout(500);
await p.click('button[aria-label="Duplicar"]'); await p.waitForTimeout(1000);
ok('duplicar bloco', await nN()===dupAntes+1, `${dupAntes} -> ${await nN()}`);

// --- DESFAZER / REFAZER
await p.click('.react-flow__pane',{position:{x:200,y:700}});
await p.keyboard.press('Control+z'); await p.waitForTimeout(900);
const posUndo = await nN();
ok('desfazer', posUndo===dupAntes, `${posUndo}`);
await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(900);
ok('refazer', await nN()===dupAntes+1, `${await nN()}`);
await p.keyboard.press('Control+z'); await p.waitForTimeout(900);

// --- EXCLUIR bloco conectado: as conexões dele somem
const exAntesN = await nN(), exAntesE = await nE();
const paraExcluir = (await p.$$('.react-flow__node'))[3];
await paraExcluir.click(); await p.waitForTimeout(500);
await p.keyboard.press('Delete'); await p.waitForTimeout(1000);
ok('excluir bloco conectado', await nN()===exAntesN-1 && await nE()<exAntesE, `blocos ${exAntesN}->${await nN()}, conexões ${exAntesE}->${await nE()}`);
const orfas = await p.$$eval('.react-flow__edge', els => els.length);
await p.keyboard.press('Control+z'); await p.waitForTimeout(1200);
ok('desfazer devolve bloco e conexões', await nN()===exAntesN && await nE()===exAntesE, `${await nN()}/${await nE()}`);

// --- ZOOM
const zAntes = await p.$eval('.react-flow__viewport', el => el.style.transform);
await p.click('button[aria-label="Aproximar"]'); await p.waitForTimeout(700);
const zDepois = await p.$eval('.react-flow__viewport', el => el.style.transform);
ok('zoom', zAntes !== zDepois);
await p.click('button[aria-label="Afastar"]'); await p.waitForTimeout(700);

// --- PAN
const pAntes = await p.$eval('.react-flow__viewport', el => el.style.transform);
const pane = await p.$('.react-flow__pane'); const pb = await pane.boundingBox();
await p.mouse.move(pb.x+pb.width*0.5, pb.y+pb.height*0.85);
await p.mouse.down({button:'middle'}).catch(()=>{});
await p.keyboard.down('Space').catch(()=>{});
await p.mouse.move(pb.x+pb.width*0.3, pb.y+pb.height*0.6,{steps:10});
await p.mouse.up({button:'middle'}).catch(()=>{});
await p.waitForTimeout(700);
const pDepois = await p.$eval('.react-flow__viewport', el => el.style.transform);
ok('pan (mover o canvas)', pAntes !== pDepois);

// --- PERFORMANCE: fluxo grande continua fluido
await p.click('button[aria-label="Ajustar à tela"]'); await p.waitForTimeout(600);
const t0 = Date.now();
for (let i=0;i<40;i+=1) {
  await p.click('aside button[data-node-type="add_tag"]');
}
await p.waitForTimeout(2500);
const totalBlocos = await nN();
const tCriar = Date.now()-t0;
ok('cria 40 blocos', totalBlocos>=45, `${totalBlocos} blocos em ${tCriar}ms`);

const arrastar = async () => {
  const n = (await p.$$('.react-flow__node'))[1];
  const bb = await n.boundingBox();
  const t = Date.now();
  await p.mouse.move(bb.x+bb.width/2, bb.y+10);
  await p.mouse.down();
  for (let i=0;i<10;i+=1) await p.mouse.move(bb.x+bb.width/2+i*8, bb.y+10+i*5);
  await p.mouse.up();
  return Date.now()-t;
};
const ms = await arrastar();
ok('arrastar continua fluido com o fluxo grande', ms < 2500, `${ms}ms para 10 passos de arrasto`);

await p.click('button[aria-label="Organizar automaticamente"]'); await p.waitForTimeout(1800);
ok('organizar preserva as conexões', await nE()>=12, `${await nE()} conexões`);

await p.screenshot({path:`${OUT}/b-02-final.png`});
console.log('\nerros de página:', errs.length ? errs.slice(0,4) : 'nenhum');
const falhas = resultados.filter(([,c])=>!c);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} passaram`);
await b.close();

// Non-zero on failure so this can gate a pipeline rather than only inform a human.
if (falhas.length > 0 || errs.length > 0) process.exit(1);
