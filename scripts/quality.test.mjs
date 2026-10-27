import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { PUBLIC_PAGES } from './verify-site.mjs';
import { packageSite, PUBLIC_ROOT_FILES } from './package-site.mjs';
import { verifyRelease } from './verify-release.mjs';
import { DESTINATIONS } from '../worker/navigation.js';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('public scheduling link is approved and identical on both home pages', async () => {
  const registry = JSON.parse(await readFile(resolve('content/site-facts.json'), 'utf8'));
  const fact = registry.facts.find((entry) => entry.id === 'contact.scheduling_link');
  assert.equal(fact?.status, 'approved');
  assert.deepEqual(fact.surfaces, ['index.html', 'en/index.html']);
  assert.equal(fact.source_url, fact.value);
  for (const [path, label] of [['index.html', fact.display_pl], ['en/index.html', fact.display_en]]) {
    const html = await readFile(resolve(path), 'utf8');
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`<a href="${escape(fact.value)}" target="_blank" rel="noopener noreferrer" class="contact-detail">\\s*<span data-fact-id="${escape(fact.id)}">${escape(label)}</span>`));
  }
});

function chatHarness(fetch) {
  const nodes = new Map();
  const element = () => ({
    children: [], hidden: false, disabled: false, value: '', textContent: '', events: {},
    append(node) { this.children.push(node); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, focus() {}, addEventListener(name, handler) { this.events[name] = handler; }
  });
  for (const id of ['chat-messages', 'chat-input', 'chat-send', 'chat-retry', 'chat-reset', 'ai-chat']) nodes.set(id, element());
  const fallback = element();
  const timers = new Map(); let sequence = 0;
  const context = { fetch, URL, TextEncoder, AbortController, crypto: webcrypto,
    localStorage: {getItem() {return null;}, setItem() {}},
    setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) {timers.delete(id);},
    document: {documentElement: {lang:'pl'}, getElementById: id => nodes.get(id),
      createElement:element, createTextNode:text => ({textContent:text}), querySelectorAll:selector => selector === "[data-chat-fallback]" ? [fallback] : []}
  };
  runInNewContext(source.slice(0, source.lastIndexOf('\ninitNavigation();')), context);
  context.initChat();
  return {nodes, context, timers, fallback, send(text) {nodes.get('chat-input').value=text; return nodes.get('chat-send').events.click();}};
}

test('chat retains bounded history with emoji, quotes and long multilingual messages', () => {
  const {context} = chatHarness(() => {});
  for (const text of ['😀'.repeat(1000), '\\"'.repeat(1000), 'ą'.repeat(2000)]) {
    const history = Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:text}));
    const messages = context.chatRequestHistory(history,text);
    assert(messages.length<=20);
    assert.equal(messages[0].role,'user');
    assert.equal(messages.at(-1).content,text);
    assert(messages.reduce((n,m)=>n+[...m.content].length,0)<=12000);
    assert(new TextEncoder().encode(JSON.stringify({messages})).length<=16384);
  }
});

test('chat excludes failed requests from the next request and exposes a retry', async () => {
  const bodies=[];
  const harness=chatHarness(async (_url, init)=>{bodies.push(JSON.parse(init.body)); return bodies.length===1?{ok:false,status:429}:{ok:true,json:async()=>({reply:'Odpowiedź',links:[]})};});
  await harness.send('Nieudane pytanie');
  assert.equal(harness.nodes.get('chat-retry').hidden,false);
  await harness.send('Nowe pytanie');
  assert.deepEqual(bodies[1].messages,[{role:'user',content:'Nowe pytanie'}]);
  assert.equal(harness.nodes.get('chat-retry').hidden,true);
  assert.equal(harness.fallback.hidden,true);
});

test('chat reset aborts a pending request and ignores its late reply', async () => {
  let finish, signal;
  const harness=chatHarness((_url,init)=>{signal=init.signal;return new Promise(resolve=>{finish=resolve;});});
  const pending=harness.send('Aplikacje');
  harness.nodes.get('chat-reset').events.click();
  assert.equal(signal.aborted,true);
  finish({ok:true,json:async()=>({reply:'Stara odpowiedź'})});
  await pending;
  assert.equal(harness.nodes.get('chat-messages').children.length,1);
  assert.equal(harness.nodes.get('chat-input').disabled,false);
  assert.equal(harness.timers.size,0);
});

test('chat timeout releases controls and preserves the email fallback', async () => {
  const harness=chatHarness((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  const pending=harness.send('Pytanie');
  [...harness.timers.values()][0]();
  await pending;
  assert.equal(harness.nodes.get('chat-input').disabled,false);
  assert.equal(harness.nodes.get('chat-retry').hidden,false);
  assert.equal(harness.nodes.get('chat-messages').children.at(-1).children[1].href,'mailto:pawel@mamcarz.com');
});

test('chat renders only existing destinations as text and links', async () => {
  const harness=chatHarness(async()=>({ok:true,json:async()=>({reply:'<img onerror=alert(1)>',links:[{label:'Projekty',url:'https://mamcarz.com/case-studies/'},{label:'Fake',url:'https://mamcarz.com/fake/'},{label:'Attack',url:'javascript:alert(1)'}]})}));
  await harness.send('Projekty');
  const message=harness.nodes.get('chat-messages').children.at(-1);
  assert.equal(message.textContent,'<img onerror=alert(1)>');
  // The status placeholder is a node in this small DOM harness.
  const anchors=message.children.filter(node=>node.href);
  assert.equal(anchors.length,1);
  assert.equal(anchors[0].href,'https://mamcarz.com/case-studies/');
  assert.equal(harness.context.safeChatLink('https://user:password@www.linkedin.com/in/pawelmamcarz/'),false);
  assert.equal(harness.context.safeChatLink('https://linkedin.com/in/pawelmamcarz/'),true);
  for(const entry of DESTINATIONS) for(const prefix of ['', 'en/']) assert(PUBLIC_PAGES.some(page=>page.route===`/${prefix}${entry.path}`));
});

test('release package excludes private sources, hidden files and stale bytes', async t => {
  const root=await mkdtemp(resolve(tmpdir(),'mamcarz-release-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const file of [...PUBLIC_ROOT_FILES,'infographic_procurement_2026_EN.html']) {
    await mkdir(dirname(resolve(root,file)),{recursive:true});
    await copyFile(resolve(file),resolve(root,file));
  }
  await mkdir(resolve(root,'assets/js'),{recursive:true});
  await writeFile(resolve(root,'assets/js/main.js'),'// public');
  await writeFile(resolve(root,'AGENTS.md'),'private');
  await writeFile(resolve(root,'assets/js/private.json'),'private');
  await mkdir(resolve(root,'assets/img/.private'),{recursive:true});
  await writeFile(resolve(root,'assets/img/.private.jpg'),'private');
  await writeFile(resolve(root,'assets/img/.private/photo.jpg'),'private');
  const result=await packageSite(root);
  assert(!result.files.includes('AGENTS.md'));
  assert(!result.files.includes('assets/js/private.json'));
  assert(!result.files.some(file=>file.includes('.private')));
  await verifyRelease({source:root});
  await writeFile(resolve(root,'.public/.secret'),'private');
  await assert.rejects(verifyRelease({source:root}),/exactly the allowed files/);
  await packageSite(root);
  await writeFile(resolve(root,'.public/index.html'),'stale');
  await assert.rejects(verifyRelease({source:root}),/stale/);
  await symlink(resolve(root,'AGENTS.md'),resolve(root,'assets/leak.svg'));
  await assert.rejects(packageSite(root),/Symbolic link/);
});
