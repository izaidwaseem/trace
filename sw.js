/*
 * Relay service worker: shows push alerts and opens the right screen when one is tapped.
 * It never caches pages, so it can't keep an old version of the app around.
 *
 * Pushes arrive empty. On each one it asks Relay's server for alerts newer than the last one it
 * showed (pushInbox) and shows them. Where to ask, and with which key, is saved by the page in
 * Cache Storage ('relay-cfg'), which only this site can read.
 */
const CFG = 'relay-cfg';
const read = async name => { try { const r = await (await caches.open(CFG)).match(name); return r ? await r.text() : ''; } catch (e) { return ''; } };
const write = async (name, text) => { try { await (await caches.open(CFG)).put(name, new Response(text)); } catch (e) {} };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let items = [], unread = 0;
  try {
    const c = JSON.parse(await read('cfg') || '{}');
    const since = Number(await read('seen')) || 0;
    const r = await fetch(c.api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, credentials: 'omit', redirect: 'follow',
      body: JSON.stringify({ k: c.k, fn: 'pushInbox', args: [since] }) });
    const j = await r.json();
    if (j.ok) { items = j.result.items || []; unread = j.result.unread || 0; }
  } catch (err) {}
  // iPhone requires a notification for every push; if the server couldn't be reached, say so plainly
  if (!items.length) items = [{ id: 'relay', title: 'Relay', body: 'Something new needs your attention. Open Relay to see it.', go: 'today' }];
  for (const it of items) {
    await self.registration.showNotification(it.title, { body: it.body, tag: 'relay-' + it.id, data: { go: it.go || 'today', id: it.id }, icon: 'apple-touch-icon.png' });
  }
  const newest = Math.max(0, ...items.map(i => i.ts || 0));
  if (newest) await write('seen', String(newest));
  try { if (unread && self.navigator.setAppBadge) await self.navigator.setAppBadge(unread); } catch (e) {}   // the number on Relay's icon
  try { (await self.clients.matchAll({ type: 'window' })).forEach(w => w.postMessage({ relayAlert: true })); } catch (e) {}   // an open Relay updates its bell
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const go = (e.notification.data || {}).go || 'today', id = (e.notification.data || {}).id || '';
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { w.postMessage({ relayGo: go, relayId: id }); return w.focus(); }
    }
    const c = JSON.parse(await read('cfg') || '{}');
    return self.clients.openWindow(new URL('./', self.registration.scope).href + '#k=' + (c.k || '') + '&go=' + encodeURIComponent(go) + '&alert=' + encodeURIComponent(id));
  })());
});
