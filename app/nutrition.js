/* Ernährung: Tagesbedarf, Tagebuch, Lebensmittel, Vorlagen und Wochenplan.
   Läuft im selben Seitenbereich wie index.html und nutzt dessen Hilfen (S, esc, num, norm, rid, save, render, openModal …). */

const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
const DAYN = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const ACT = [[1.2, 'Überwiegend sitzend (Büro, Schule)'], [1.35, 'Teils aktiv (viel Stehen und Gehen)'], [1.5, 'Viel in Bewegung (z. B. Handwerk, Pflege)'], [1.7, 'Körperlich sehr anstrengend']];
const GOALS = { cut: ['Abnehmen', -15, 2.0], maintain: ['Gewicht halten', 0, 1.6], bulk: ['Aufbauen', 10, 1.8] }; // Name, Kalorienanpassung %, Protein g/kg
const MET_STRENGTH = 5.0; // Krafttraining, mittlere bis hohe Intensität (Compendium of Physical Activities)

const CARDIO = { // Gerät: [Name, MET leicht/mittel/intensiv, Hinweise] (Werte nach dem Compendium of Physical Activities, gerundet)
  treadmill: ['Laufband', [4.3, 8.3, 11], ['Gehen, ca. 5–6 km/h', 'Joggen, ca. 8–9 km/h', 'Laufen, ab ca. 11 km/h']],
  bike: ['Fitnessrad', [3.5, 6.8, 8.8], ['locker, ca. 50–80 W', 'zügig, ca. 100–150 W', 'hart, ab ca. 180 W']],
  stair: ['Stairmaster', [6, 9, 11], ['langsam', 'mittleres Tempo', 'schnell']],
  cross: ['Crosstrainer', [4.6, 5.8, 7.5], ['locker', 'zügig', 'hart']],
  custom: ['Eigenes', [4, 6, 8], ['locker', 'mittel', 'intensiv']],
};
const cui = { type: 'treadmill', lvl: 1 };
let FOODS = [];
(async () => { try { FOODS = (await (await fetch('/foods.json')).json()).foods || []; if (typeof tab !== 'undefined' && tab === 'nutri') render(); } catch {} })();

const nui = { sub: 'today', date: null, pick: null, amt: null, online: [], onlineMsg: '', items: [] };
const dstr = (d = new Date()) => d.toLocaleDateString('sv-SE'); // lokales Datum JJJJ-MM-TT
const dateObj = (s) => new Date(s + 'T12:00:00');
const f0 = (n) => Math.round(n).toLocaleString('de-DE');
const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');

function nutriEnsure() {
  if (!S) return;
  const n = (S.nutri = S.nutri || {});
  n.profile = Object.assign({ sex: 'm', age: '', height: '', weight: '', activity: 1.35, goal: 'maintain', adj: '', prot: '', fat: 25 }, n.profile || {});
  S.cardio = S.cardio || []; n.foods = n.foods || []; n.log = n.log || {}; n.templates = n.templates || []; n.week = n.week || {};
  if (!nui.date) nui.date = dstr();
}

/* ---------- Berechnung ---------- */
const profOK = (p) => num(p.age) > 0 && num(p.height) > 0 && num(p.weight) > 0;
const bmr = (p) => 10 * num(p.weight) + 6.25 * num(p.height) - 5 * num(p.age) + (p.sex === 'f' ? -161 : 5); // Mifflin-St Jeor

function trainKcal(h, weight) { // geschätzter Verbrauch einer Einheit: MET × Gewicht × Dauer
  const sets = (h.items || []).reduce((a, i) => a + (i.detail ? i.detail.length : i.sets || 0), 0);
  const min = Math.min(180, h.dur || Math.max(15, Math.round(sets * 2.5)));
  return MET_STRENGTH * weight * min / 60;
}
const localDay = (iso) => dstr(new Date(iso));
const cardioKcal = (c, weight) => (c.kcal > 0 ? c.kcal : CARDIO[c.type][1][c.lvl] * (weight || 75) * c.min / 60);
const cardioName = (c) => (c.type === 'custom' && c.name ? c.name : CARDIO[c.type][0]);
function trainOn(ds, weight) {
  return S.history.filter((h) => localDay(h.date) === ds).reduce((a, h) => a + trainKcal(h, weight), 0)
    + S.cardio.filter((c) => localDay(c.date) === ds).reduce((a, c) => a + cardioKcal(c, weight), 0);
}
function trainAvg(p) { // durchschnittlicher Trainingsverbrauch pro Tag (letzte bis zu 28 Tage), sonst aus dem Plan geschätzt
  const w = num(p.weight), now = Date.now(), win = 28 * 864e5;
  const recent = S.history.filter((h) => now - new Date(h.date).getTime() <= win);
  const rc = S.cardio.filter((c) => now - new Date(c.date).getTime() <= win);
  if (recent.length || rc.length) {
    const oldest = Math.min(...[...recent, ...rc].map((h) => new Date(h.date).getTime()));
    const days = Math.max(7, Math.min(28, Math.ceil((now - oldest) / 864e5) + 1));
    const sum = recent.reduce((a, h) => a + trainKcal(h, w), 0) + rc.reduce((a, c) => a + cardioKcal(c, w), 0);
    return { perDay: sum / days, n: recent.length, nc: rc.length, days, src: 'hist' };
  }
  const per = S.days.length ? S.days.length * trainKcal({ dur: 60 }, w) / 7 : 0;
  return { perDay: per, n: 0, days: 0, src: 'plan' };
}
function targets() {
  const p = S.nutri.profile; if (!profOK(p)) return null;
  const w = num(p.weight), B = bmr(p), base = B * num(p.activity), tr = trainAvg(p), tdee = base + tr.perDay;
  const g = GOALS[p.goal] || GOALS.maintain, adj = p.adj === '' || p.adj == null ? g[1] : num(p.adj);
  let kcal = Math.round(tdee * (1 + adj / 100) / 10) * 10, floored = false;
  if (kcal < Math.round(B)) { kcal = Math.round(B); floored = true; } // nie unter den Grundumsatz
  const prot = p.prot === '' || p.prot == null ? g[2] : num(p.prot), fatPct = num(p.fat) || 25;
  const protG = prot * w, fatG = fatPct / 100 * kcal / 9, carbG = Math.max(0, (kcal - protG * 4 - fatG * 9) / 4);
  return { bmr: B, base, tr, tdee, adj, kcal, protG, fatG, carbG, floored, w };
}

/* ---------- Tagebuch ---------- */
const per = (e) => e.per || { k: 0, p: 0, c: 0, f: 0 };
const ent = (e) => { const x = e.g / 100, q = per(e); return { k: q.k * x, p: q.p * x, c: q.c * x, f: q.f * x }; };
const sum = (list) => list.reduce((a, e) => { const v = ent(e); return { k: a.k + v.k, p: a.p + v.p, c: a.c + v.c, f: a.f + v.f }; }, { k: 0, p: 0, c: 0, f: 0 });
const dayLog = (ds) => (S.nutri.log[ds] = S.nutri.log[ds] || []);
const share = (t) => { const e = t.p * 4 + t.c * 4 + t.f * 9; return e > 0 ? [t.p * 4 / e * 100, t.c * 4 / e * 100, t.f * 9 / e * 100] : [0, 0, 0]; };

function ringSVG(v, max, over) {
  const C = 2 * Math.PI * 50, frac = max > 0 ? Math.min(1, v / max) : 0;
  return `<svg class="nring ${over ? 'over' : ''}" viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="50"/><circle class="arc" cx="60" cy="60" r="50" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/></svg>`;
}
function macroBars(t, T) {
  const row = (cls, label, v, goal) => `<div class="mrow"><div class="mhead"><span>${label}</span><b>${f0(v)}${goal ? ` <small>/ ${f0(goal)} g</small>` : ' <small>g</small>'}</b></div><div class="mtrack"><i class="${cls}" style="width:${goal ? Math.min(100, v / goal * 100) : 0}%"></i></div></div>`;
  const sh = share(t), tsh = T ? share({ p: T.protG, c: T.carbG, f: T.fatG }) : null;
  return `${row('mp', 'Protein', t.p, T && T.protG)}${row('mc', 'Kohlenhydrate', t.c, T && T.carbG)}${row('mf', 'Fett', t.f, T && T.fatG)}
    <div class="dist" role="img" aria-label="Verteilung Protein ${f0(sh[0])} Prozent, Kohlenhydrate ${f0(sh[1])} Prozent, Fett ${f0(sh[2])} Prozent"><i class="mp" style="flex:${sh[0] || 0.001}"></i><i class="mc" style="flex:${sh[1] || 0.001}"></i><i class="mf" style="flex:${sh[2] || 0.001}"></i></div>
    <div class="muted small">Verteilung der Energie: ${f0(sh[0])} % Protein · ${f0(sh[1])} % Kohlenhydrate · ${f0(sh[2])} % Fett${tsh ? ` (Ziel ${f0(tsh[0])} / ${f0(tsh[1])} / ${f0(tsh[2])})` : ''}</div>`;
}

/* ---------- Ansichten ---------- */
function viewNutri() {
  nutriEnsure();
  const chip = (k, l) => `<button class="chip ${nui.sub === k ? 'on' : ''}" data-a="nSub" data-k="${k}">${l}</button>`;
  const body = nui.sub === 'plans' ? viewPlans() : nui.sub === 'profile' ? viewProfile() : viewToday();
  return `<div class="chips">${chip('today', 'Tagebuch')}${chip('plans', 'Pläne')}${chip('profile', 'Profil & Ziele')}</div>${body}`;
}

function viewToday() {
  const ds = nui.date, T = targets(), p = S.nutri.profile, log = dayLog(ds), tot = sum(log), isToday = ds === dstr();
  const label = isToday ? 'Heute' : dateObj(ds).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const tk = profOK(p) ? trainOn(ds, num(p.weight)) : 0, exp = T ? T.base + tk : 0;
  const trained = [...S.history.filter((h) => localDay(h.date) === ds).map((h) => h.day), ...S.cardio.filter((c) => localDay(c.date) === ds).map(cardioName)].join(', ');
  const wd = (dateObj(ds).getDay() + 6) % 7, tpl = S.nutri.templates.find((t) => t.id === S.nutri.week[wd]);
  const nav = `<div class="row dnav"><button class="ic" data-a="nDay" data-d="-1" aria-label="Vorheriger Tag">‹</button><div class="grow dlabel"><b>${esc(label)}</b>${isToday ? `<small class="muted">${esc(dateObj(ds).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }))}</small>` : ''}</div>${isToday ? '' : '<button class="chip" data-a="nToday">Heute</button>'}<button class="ic" data-a="nDay" data-d="1" aria-label="Nächster Tag">›</button></div>`;
  const hint = !T ? `<div class="card nhint"><b>Kalorienziel einrichten</b><div class="muted small" style="margin:4px 0 10px">Trag Größe, Gewicht und Alter ein, dann berechnet die App Tagesbedarf, Kalorienziel und Makros.</div><button class="btn primary" data-a="nSub" data-k="profile">Profil ausfüllen</button></div>` : '';
  const sum1 = `<div class="card nsum"><div class="nsumrow"><div class="ringbox">${ringSVG(tot.k, T ? T.kcal : 0, T && tot.k > T.kcal)}<div class="ringtxt"><b>${f0(tot.k)}</b><small>${T ? 'von ' + f0(T.kcal) + ' kcal' : 'kcal'}</small></div></div>
      <div class="nstats">${T ? `<div><b class="${tot.k > T.kcal ? 'neg' : ''}">${tot.k > T.kcal ? '+' + f0(tot.k - T.kcal) : f0(T.kcal - tot.k)}</b><small>${tot.k > T.kcal ? 'über dem Ziel' : 'noch übrig'}</small></div>
      <div><b>${f0(exp)}</b><small>Verbrauch ${isToday ? 'heute' : 'an dem Tag'} (geschätzt)</small></div>
      <div><b class="${tot.k - exp > 0 ? '' : 'pos'}">${tot.k - exp > 0 ? '+' : '−'}${f0(Math.abs(tot.k - exp))}</b><small>Bilanz zum Verbrauch</small></div>` : '<div><small class="muted">Ohne Profil gibt es nur die Summe.</small></div>'}</div></div>
    ${T && tk > 0 ? `<div class="muted small" style="margin-top:8px">Training: ${esc(trained)} · ca. ${f0(tk)} kcal. Verbrauch = Grundumsatz ${f0(T.bmr)} + Alltag ${f0(T.base - T.bmr)} + Training ${f0(tk)}.</div>` : T ? `<div class="muted small" style="margin-top:8px">Kein Training eingetragen. Verbrauch = Grundumsatz ${f0(T.bmr)} + Alltag ${f0(T.base - T.bmr)}.</div>` : ''}
    <div style="margin-top:12px">${macroBars(tot, T)}</div></div>`;
  const planBanner = tpl && !log.length ? `<div class="card nhint"><b>Laut Wochenplan: ${esc(tpl.name)}</b><div class="muted small" style="margin:4px 0 10px">${f0(sum(tpl.items).k)} kcal, ${tpl.items.length} Einträge</div><button class="btn primary" data-a="nTplApply" data-id="${tpl.id}">In diesen Tag übernehmen</button></div>` : '';
  const meals = MEALS.map((m) => {
    const items = log.filter((e) => e.meal === m), t = sum(items);
    return `<div class="card meal"><div class="mealhead"><div class="grow"><b class="exname" style="font-size:22px">${m}</b>${items.length ? `<div class="muted small">${f0(t.k)} kcal · P ${f0(t.p)} · KH ${f0(t.c)} · F ${f0(t.f)}</div>` : ''}</div><button class="btn" data-a="nOpen" data-meal="${m}">＋ Hinzufügen</button></div>
      ${items.map((e) => { const v = ent(e); return `<button class="nrow" data-a="nEdit" data-kind="log" data-id="${e.id}"><span class="grow"><b>${esc(e.name)}</b><small class="muted">${f0(e.g)} g · P ${f1(v.p)} · KH ${f1(v.c)} · F ${f1(v.f)}</small></span><span class="nk">${f0(v.k)}<small> kcal</small></span></button>`; }).join('')}</div>`;
  }).join('');
  const prev = dstr(new Date(dateObj(ds).getTime() - 864e5)), hasPrev = (S.nutri.log[prev] || []).length > 0;
  return `${nav}${hint}${sum1}${planBanner}${meals}
    <div class="row" style="flex-wrap:wrap"><button class="btn grow" data-a="nTplPick">Aus Vorlage übernehmen</button>${hasPrev ? '<button class="btn grow" data-a="nCopyPrev">Vortag kopieren</button>' : ''}</div>
    <p class="muted small">Alle Werte sind Schätzungen. Sie ersetzen keine ärztliche oder ernährungsberatende Empfehlung.</p>`;
}

function viewPlans() {
  const T = targets(), tpls = S.nutri.templates;
  const cards = tpls.map((t) => {
    const tot = sum(t.items);
    return `<div class="card"><div class="row"><input class="grow title" data-f="n.tname" data-id="${t.id}" value="${esc(t.name)}" aria-label="Name der Vorlage"><button class="ic danger" data-a="nTplDel" data-id="${t.id}" aria-label="Vorlage löschen">🗑</button></div>
      <div class="muted small" style="margin-bottom:6px"><b style="color:var(--text)">${f0(tot.k)} kcal</b> · P ${f0(tot.p)} · KH ${f0(tot.c)} · F ${f0(tot.f)}${T ? ` · Ziel ${f0(T.kcal)} kcal (${tot.k - T.kcal >= 0 ? '+' : '−'}${f0(Math.abs(tot.k - T.kcal))})` : ''}</div>
      ${MEALS.map((m) => { const it = t.items.filter((e) => e.meal === m); return `<div class="tmeal"><div class="row" style="margin:6px 0 2px"><b class="grow">${m}</b><button class="chip" data-a="nOpen" data-meal="${m}" data-tpl="${t.id}">＋</button></div>${it.map((e) => `<button class="nrow" data-a="nEdit" data-kind="tpl" data-tpl="${t.id}" data-id="${e.id}"><span class="grow"><b>${esc(e.name)}</b><small class="muted">${f0(e.g)} g</small></span><span class="nk">${f0(ent(e).k)}<small> kcal</small></span></button>`).join('')}</div>`; }).join('')}
      <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn grow" data-a="nTplApply" data-id="${t.id}">In Tag übernehmen</button><button class="btn" data-a="nTplDup" data-id="${t.id}">Duplizieren</button></div></div>`;
  }).join('');
  const week = DAYN.map((n, i) => `<div class="row"><span style="width:96px">${n}</span><select class="grow" data-f="n.week" data-d="${i}" aria-label="Plan für ${n}"><option value="">– kein Plan –</option>${tpls.map((t) => `<option value="${t.id}" ${S.nutri.week[i] === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`).join('');
  return `<h2 style="margin:4px 2px 8px">Ernährungspläne</h2>
    <p class="muted small" style="margin:0 2px 12px">Vorlagen sind feste Tage mit Mahlzeiten, zum Beispiel ein Trainingstag und ein Ruhetag. Sie lassen sich mit einem Tipp in das Tagebuch übernehmen.</p>
    ${cards || '<div class="card muted">Noch keine Vorlage.</div>'}
    <button class="btn primary block" style="margin-bottom:14px" data-a="nTplNew">＋ Neue Vorlage</button>
    ${tpls.length ? `<div class="card"><h2>Wochenplan</h2><p class="muted small" style="margin:0 0 8px">Welche Vorlage gilt an welchem Tag? Das Tagebuch schlägt sie dann automatisch vor.</p>${week}</div>` : ''}`;
}

function profileCalcHTML() {
  const T = targets(), p = S.nutri.profile;
  if (!T) return '<div class="muted small">Trag Alter, Größe und Gewicht ein, dann erscheinen hier die Ergebnisse.</div>';
  const g = GOALS[p.goal] || GOALS.maintain;
  return `<div class="calc">
    <div class="crow"><span>Grundumsatz</span><b>${f0(T.bmr)} kcal</b></div>
    <div class="crow"><span>Alltag (× ${num(p.activity).toLocaleString("de-DE")})</span><b>+ ${f0(T.base - T.bmr)} kcal</b></div>
    <div class="crow"><span>Training (Ø pro Tag)</span><b>+ ${f0(T.tr.perDay)} kcal</b></div>
    <div class="crow total"><span>Gesamtverbrauch</span><b>${f0(T.tdee)} kcal</b></div>
    <div class="crow"><span>${g[0]} (${T.adj > 0 ? '+' : ''}${f1(T.adj)} %)</span><b>${T.adj >= 0 ? '+' : '−'} ${f0(Math.abs(T.kcal - T.tdee))} kcal</b></div>
    <div class="crow total"><span>Kalorienziel pro Tag</span><b>${f0(T.kcal)} kcal</b></div></div>
    <div style="margin:10px 0 4px"><b>Makroziele</b></div>
    <div class="crow"><span><i class="dot mp"></i>Protein (${f1(T.protG / T.w)} g pro kg)</span><b>${f0(T.protG)} g</b></div>
    <div class="crow"><span><i class="dot mf"></i>Fett (${f0(num(p.fat) || 25)} % der Energie)</span><b>${f0(T.fatG)} g</b></div>
    <div class="crow"><span><i class="dot mc"></i>Kohlenhydrate (Rest)</span><b>${f0(T.carbG)} g</b></div>
    <p class="muted small" style="margin:10px 0 0">${T.tr.src === 'hist' ? `Training: ${T.tr.n} Krafteinheiten${T.tr.nc ? ' und ' + T.tr.nc + ' Cardio-Einheiten' : ''} in den letzten ${T.tr.days} Tagen, im Mittel ca. ${f0(T.tr.perDay)} kcal pro Tag.` : 'Noch keine Einheiten geloggt: Training wird aus der Anzahl der Plantage mit 60 Minuten pro Einheit geschätzt.'} Grundumsatz nach Mifflin-St Jeor, Training mit MET (Kraft ${f1(MET_STRENGTH)}, Cardio je nach Gerät und Intensität) × Gewicht × Dauer; bei Cardio zählt eine eingetragene Gerätekalorienzahl stattdessen.${T.floored ? ' Das Ziel liegt am Grundumsatz, weil die Anpassung sonst darunter läge.' : ''}</p>`;
}

function viewProfile() {
  const p = S.nutri.profile, g = GOALS[p.goal] || GOALS.maintain;
  const inp = (k, label, ph, step, unit) => `<label class="pf">${label}<span class="pfi"><input type="number" inputmode="decimal" step="${step}" data-f="n.p.${k}" value="${esc(p[k])}" placeholder="${ph}">${unit ? `<small>${unit}</small>` : ''}</span></label>`;
  return `<div class="card"><h2>Profil</h2>
    <div class="stack">
      <label class="pf">Geschlecht (für die Formel)<select data-f="n.p.sex"><option value="m" ${p.sex !== 'f' ? 'selected' : ''}>Männlich</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Weiblich</option></select></label>
      <div class="row" style="margin:0">${inp('age', 'Alter', '30', '1', 'J.')}${inp('height', 'Größe', '178', '1', 'cm')}${inp('weight', 'Gewicht', '78', '0.1', 'kg')}</div>
      <label class="pf">Alltag ohne Training<select data-f="n.p.activity">${ACT.map(([v, l]) => `<option value="${v}" ${num(p.activity) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="pf">Ziel<select data-f="n.p.goal">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${p.goal === k ? 'selected' : ''}>${v[0]} (${v[1] > 0 ? '+' : ''}${v[1]} %)</option>`).join('')}</select></label>
    </div></div>
  <div class="card"><h2>Feineinstellung</h2><p class="muted small" style="margin:0 0 8px">Leer lassen für die Standardwerte des gewählten Ziels.</p>
    <div class="row" style="margin:0;align-items:flex-end">${inp('adj', 'Kalorien ± %', String(g[1]), '1', '%')}${inp('prot', 'Protein', String(g[2]), '0.1', 'g/kg')}${inp('fat', 'Fett', '25', '1', '%')}</div></div>
  <div class="card"><h2>Dein Bedarf</h2><div id="nCalc">${profileCalcHTML()}</div></div>
  <p class="muted small">Die Werte sind Schätzungen aus Standardformeln. Sie ersetzen keine ärztliche oder ernährungsberatende Empfehlung, bei Vorerkrankungen oder Unsicherheit bitte fachlichen Rat einholen.</p>`;
}

/* ---------- Lebensmittel: Suche, Menge, eigene ---------- */
const toFood = (x, src) => ({ src, id: x.id, name: x.name, brand: x.brand || '', code: x.code || '', cat: x.cat || '', portions: x.portions || [], per: { k: x.kcal, p: x.p, c: x.c, f: x.f } });
const foodName = (x) => (x.brand ? `${x.name} (${x.brand})` : x.name);
function recentFoods() {
  const seen = new Set(), out = [];
  Object.keys(S.nutri.log).sort().reverse().slice(0, 21).forEach((d) => [...S.nutri.log[d]].reverse().forEach((e) => {
    const k = norm(e.name); if (seen.has(k) || out.length >= 12) return; seen.add(k);
    out.push({ src: 'recent', name: e.name, brand: '', cat: '', portions: [], per: e.per, lastG: e.g });
  }));
  return out;
}
function poolSearch(q) {
  const tok = norm(q).split(/\s+/).filter(Boolean);
  const all = [...S.nutri.foods.map((x) => toFood(x, 'mine')), ...FOODS.map((x) => toFood(x, 'lib'))];
  return all.filter((f) => { const h = norm(foodName(f) + ' ' + f.cat); return tok.every((t) => h.includes(t)); })
    .sort((a, b) => (norm(b.name).startsWith(tok[0]) - norm(a.name).startsWith(tok[0])) || ((b.src === 'mine') - (a.src === 'mine')) || a.name.localeCompare(b.name, 'de')).slice(0, 40);
}
function foodRow(f, i, label) {
  return `<button class="altrow nfood" data-a="nPick" data-i="${i}"><span class="grow"><b>${esc(foodName(f))}</b><small class="muted">${f0(f.per.k)} kcal · P ${f1(f.per.p)} · KH ${f1(f.per.c)} · F ${f1(f.per.f)} pro 100 g${label ? ' · ' + label : ''}</small></span><span class="muted">›</span></button>`;
}
function pickListHTML() {
  const q = (nui.pick && nui.pick.q) || '', items = (nui.items = []);
  const push = (arr, label) => arr.map((f) => { items.push(f); return foodRow(f, items.length - 1, label); }).join('');
  let html = '';
  if (!q.trim()) {
    const rec = recentFoods(), mine = S.nutri.foods.map((x) => toFood(x, 'mine')).filter((f) => !rec.some((r) => norm(r.name) === norm(foodName(f))));
    if (rec.length) html += `<div class="lsub">Zuletzt verwendet</div>${push(rec)}`;
    if (mine.length) html += `<div class="lsub">Meine Lebensmittel</div>${push(mine)}`;
    html += `<div class="lsub">Häufige Lebensmittel</div>${push(FOODS.slice(0, 0).map((x) => toFood(x, 'lib')))}<p class="muted small">Tipp einen Namen in das Suchfeld, zum Beispiel „Haferflocken“, oder eine Barcode-Nummer für die Online-Suche.</p>`;
  } else {
    const res = poolSearch(q);
    html += res.length ? push(res) : '<p class="muted small">Nichts in der eingebauten Liste gefunden.</p>';
  }
  if (nui.online.length) html += `<div class="lsub">Online (Open Food Facts)</div>${push(nui.online.map((x) => toFood(x, 'online')), 'online')}`;
  return html;
}
function openPicker(meal, tplId, q = '') {
  nui.pick = { meal, tplId: tplId || null, q }; nui.online = []; nui.onlineMsg = '';
  const title = tplId ? 'Zur Vorlage hinzufügen' : 'Lebensmittel hinzufügen';
  openModal(`<div class="row"><h2 class="grow" style="margin:0">${title}<small class="muted" style="font:500 14px var(--body);display:block">${esc(meal)}</small></h2><button class="btn" data-a="nDone">Fertig</button></div>
    <div class="row" style="margin-top:10px"><input id="nQ" class="grow" type="search" data-f="n.q" maxlength="80" placeholder="Lebensmittel oder Barcode suchen" autocomplete="off" value="${esc(q)}"></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn grow" data-a="nOnline">🔎 Online suchen</button><button class="btn grow" data-a="nNewFood">＋ Eigenes Lebensmittel</button></div>
    <div id="nMsg" class="muted small"></div><div id="nList" class="altlist">${pickListHTML()}</div>`);
}
function openAmount(a) { // a: {food, g, meal, kind, tplId, editId}
  nui.amt = a; const f = a.food, pr = f.portions || [];
  const edit = !!a.editId;
  openModal(`<div class="row"><h2 class="grow" style="margin:0;font-size:24px">${esc(foodName(f))}</h2><button class="ic" data-a="nBack" aria-label="Zurück">✕</button></div>
    <div class="muted small" style="margin:2px 0 10px">${f0(f.per.k)} kcal · P ${f1(f.per.p)} · KH ${f1(f.per.c)} · F ${f1(f.per.f)} pro 100 g</div>
    <label class="pf">Menge<span class="pfi"><input id="nG" type="number" inputmode="decimal" step="1" min="1" data-f="n.g" value="${esc(a.g)}"><small>g</small></span></label>
    ${pr.length ? `<div class="chips" style="margin-top:8px">${pr.map((x) => `<button class="chip" data-a="nPortion" data-g="${x.g}">${esc(x.n)} · ${x.g} g</button>`).join('')}</div>` : ''}
    <div id="nPrev" class="card nprev"></div>
    ${a.kind === 'log' ? `<label class="pf">Mahlzeit<select id="nMeal" data-f="n.meal">${MEALS.map((m) => `<option ${m === a.meal ? 'selected' : ''}>${m}</option>`).join('')}</select></label>` : ''}
    <div class="row" style="margin-top:14px"><button class="btn primary grow" data-a="nAdd">${edit ? 'Speichern' : 'Hinzufügen'}</button>${edit ? '<button class="btn danger" data-a="nDel">Entfernen</button>' : ''}</div>
    ${f.src === 'mine' ? '<button class="btn block" style="margin-top:8px" data-a="nDelFood">Aus „Meine Lebensmittel“ löschen</button>' : ''}`);
  updPrev();
}
function updPrev() {
  const el = document.getElementById('nPrev'); if (!el || !nui.amt) return;
  const g = num(document.getElementById('nG').value), q = nui.amt.food.per, x = g / 100;
  el.innerHTML = `<div class="nprevk"><b>${f0(q.k * x)}</b><small> kcal</small></div><div class="muted small">Protein <b>${f1(q.p * x)}</b> g · Kohlenhydrate <b>${f1(q.c * x)}</b> g · Fett <b>${f1(q.f * x)}</b> g</div>`;
}
function newFoodModal() {
  openModal(`<div class="row"><h2 class="grow" style="margin:0">Eigenes Lebensmittel</h2><button class="ic" data-a="nBack" aria-label="Zurück">✕</button></div>
    <p class="muted small" style="margin:4px 0 10px">Nährwerte pro 100 g, wie auf der Verpackung.</p>
    <div class="stack"><input id="nfName" maxlength="60" placeholder="Name"><div class="row" style="margin:0"><label class="pf">kcal<input id="nfK" type="number" inputmode="decimal" step="1"></label><label class="pf">Protein g<input id="nfP" type="number" inputmode="decimal" step="0.1"></label></div>
    <div class="row" style="margin:0"><label class="pf">Kohlenhydrate g<input id="nfC" type="number" inputmode="decimal" step="0.1"></label><label class="pf">Fett g<input id="nfF" type="number" inputmode="decimal" step="0.1"></label></div></div>
    <div class="row" style="margin-top:14px"><button class="btn primary grow" data-a="nSaveFood">Speichern</button></div>`);
}

/* ---------- Aktionen ---------- */
function afterChange() { save(); render(); }
function tplById(id) { return S.nutri.templates.find((t) => t.id === id); }
function curAmtFood(i) { return nui.items[+i]; }
async function nutriAct(a, d) {
  if (!/^n[A-Z]/.test(a)) return undefined;
  nutriEnsure();
  switch (a) {
    case 'nCardioOpen': cardioModal(); return 1;
    case 'nCType': case 'nCLvl': {
      const ph = { min: $('#nCMin').value, kc: $('#nCKcal').value, dt: $('#nCDate').value, nm: $('#nCName') ? $('#nCName').value : '' };
      if (a === 'nCType') cui.type = d.k; else cui.lvl = +d.l;
      cardioModal(); $('#nCMin').value = ph.min; $('#nCKcal').value = ph.kc; $('#nCDate').value = ph.dt; if ($('#nCName')) $('#nCName').value = ph.nm; cardioPrev(); return 1;
    }
    case 'nCardioSave': {
      const min = Math.round(num($('#nCMin').value)); if (!(min > 0 && min <= 600)) { toast('Bitte die Dauer in Minuten eingeben'); return 1; }
      const kc = Math.round(num($('#nCKcal').value)), name = $('#nCName') ? $('#nCName').value.trim() : '';
      if (cui.type === 'custom' && name.length < 2) { toast('Bitte einen Namen eingeben'); return 1; }
      const day = $('#nCDate').value || dstr();
      S.cardio.push({ id: rid(), date: new Date(day + 'T12:00:00').toISOString(), type: cui.type, lvl: cui.lvl, min, ...(cui.type === 'custom' ? { name } : {}), ...(kc > 0 ? { kcal: kc } : {}) });
      closeModal(); await saveNow(); render(); toast('Cardio gespeichert'); return 1;
    }
    case 'nCardioDel': {
      if (!confirm('Diesen Cardio-Eintrag löschen?')) return 1;
      S.cardio = S.cardio.filter((c) => c.id !== d.id); await saveNow(); render(); return 1;
    }
    case 'nSub': nui.sub = d.k; render(); return 1;
    case 'nDay': nui.date = dstr(new Date(dateObj(nui.date).getTime() + (+d.d) * 864e5)); render(); return 1;
    case 'nToday': nui.date = dstr(); render(); return 1;
    case 'nOpen': openPicker(d.meal, d.tpl, ''); return 1;
    case 'nDone': closeModal(); flush(); return 1;
    case 'nBack': if (nui.pick) openPicker(nui.pick.meal, nui.pick.tplId, nui.pick.q); else closeModal(); return 1;
    case 'nPick': {
      const f = curAmtFood(d.i); if (!f) return 1;
      const g = f.lastG || (f.portions && f.portions[0] ? f.portions[0].g : 100);
      openAmount({ food: f, g, meal: nui.pick.meal, kind: nui.pick.tplId ? 'tpl' : 'log', tplId: nui.pick.tplId }); return 1;
    }
    case 'nPortion': { const el = document.getElementById('nG'); el.value = d.g; updPrev(); return 1; }
    case 'nOnline': {
      const q = ($('#nQ').value || '').trim(); if (q.length < 2) { toast('Bitte einen Suchbegriff oder eine Barcode-Nummer eingeben'); return 1; }
      nui.pick.q = q; $('#nMsg').textContent = 'Suche läuft…';
      try {
        const r = await api('/foodsearch?' + (/^\d{8,14}$/.test(q) ? 'code=' : 'q=') + encodeURIComponent(q));
        nui.online = r.results || []; $('#nMsg').textContent = nui.online.length ? '' : 'Online nichts gefunden. Probier einen anderen Begriff oder leg das Lebensmittel selbst an.';
      } catch (e) { nui.online = []; $('#nMsg').textContent = e.network ? 'Keine Verbindung: Die Online-Suche braucht Internet.' : e.message; }
      $('#nList').innerHTML = pickListHTML(); return 1;
    }
    case 'nNewFood': newFoodModal(); return 1;
    case 'nSaveFood': {
      const name = $('#nfName').value.trim(), k = num($('#nfK').value), p = num($('#nfP').value), c = num($('#nfC').value), f = num($('#nfF').value);
      if (name.length < 2) { toast('Bitte einen Namen eingeben'); return 1; }
      if (!(k > 0) && !(p + c + f > 0)) { toast('Bitte die Nährwerte eintragen'); return 1; }
      const food = { id: rid(), name, kcal: k > 0 ? k : p * 4 + c * 4 + f * 9, p, c, f };
      S.nutri.foods.push(food); save();
      openAmount({ food: toFood(food, 'mine'), g: 100, meal: nui.pick ? nui.pick.meal : MEALS[0], kind: nui.pick && nui.pick.tplId ? 'tpl' : 'log', tplId: nui.pick && nui.pick.tplId }); return 1;
    }
    case 'nAdd': {
      const A = nui.amt; if (!A) return 1;
      const g = num($('#nG').value); if (!(g > 0)) { toast('Bitte eine Menge eingeben'); return 1; }
      const meal = A.kind === 'log' ? $('#nMeal').value : A.meal, f = A.food;
      if (A.editId) {
        const list = A.kind === 'tpl' ? tplById(A.tplId).items : dayLog(nui.date), e = list.find((x) => x.id === A.editId);
        if (e) { e.g = g; if (A.kind === 'log') e.meal = meal; }
        closeModal(); afterChange(); return 1;
      }
      if (f.src === 'online' && !S.nutri.foods.some((x) => (f.code && x.code === f.code) || norm(foodName(x)) === norm(foodName(f)))) {
        S.nutri.foods.push({ id: rid(), name: foodName(f), code: f.code, kcal: f.per.k, p: f.per.p, c: f.per.c, f: f.per.f }); // merken für offline und „Meine Lebensmittel“
      }
      const entry = { id: rid(), meal, name: foodName(f), g, per: { ...f.per } };
      if (A.kind === 'tpl') tplById(A.tplId).items.push(entry); else dayLog(nui.date).push(entry);
      save(); render(); toast('Hinzugefügt: ' + entry.name);
      openPicker(A.meal, A.kind === 'tpl' ? A.tplId : null, nui.pick ? nui.pick.q : ''); return 1;
    }
    case 'nEdit': {
      const list = d.kind === 'tpl' ? (tplById(d.tpl) || { items: [] }).items : dayLog(nui.date), e = list.find((x) => x.id === d.id); if (!e) return 1;
      nui.pick = null;
      openAmount({ food: { src: 'recent', name: e.name, portions: [], per: e.per }, g: e.g, meal: e.meal, kind: d.kind, tplId: d.tpl, editId: e.id }); return 1;
    }
    case 'nDel': {
      const A = nui.amt; if (!A || !A.editId) return 1;
      if (A.kind === 'tpl') { const t = tplById(A.tplId); t.items = t.items.filter((x) => x.id !== A.editId); }
      else S.nutri.log[nui.date] = dayLog(nui.date).filter((x) => x.id !== A.editId);
      closeModal(); afterChange(); return 1;
    }
    case 'nDelFood': {
      const A = nui.amt; if (!A) return 1;
      S.nutri.foods = S.nutri.foods.filter((x) => x.id !== A.food.id); save(); toast('Gelöscht'); nui.pick ? openPicker(nui.pick.meal, nui.pick.tplId, nui.pick.q) : closeModal(); return 1;
    }
    case 'nCopyPrev': {
      const prev = dstr(new Date(dateObj(nui.date).getTime() - 864e5));
      (S.nutri.log[prev] || []).forEach((e) => dayLog(nui.date).push({ ...e, id: rid(), per: { ...e.per } })); afterChange(); toast('Vortag kopiert'); return 1;
    }
    case 'nTplPick': {
      const t = S.nutri.templates;
      openModal(`<div class="row"><h2 class="grow" style="margin:0">Vorlage übernehmen</h2><button class="ic" data-a="closeModal" aria-label="Schließen">✕</button></div>
        <div class="altlist" style="margin-top:10px">${t.length ? t.map((x) => `<button class="altrow" data-a="nTplApply" data-id="${x.id}"><span class="grow"><b>${esc(x.name)}</b><small class="muted">${f0(sum(x.items).k)} kcal · ${x.items.length} Einträge</small></span></button>`).join('') : '<p class="muted small">Noch keine Vorlage. Lege unter „Pläne“ eine an.</p>'}</div>`); return 1;
    }
    case 'nTplApply': {
      const t = tplById(d.id); if (!t) return 1;
      t.items.forEach((e) => dayLog(nui.date).push({ ...e, id: rid(), per: { ...e.per } }));
      closeModal(); nui.sub = 'today'; afterChange(); toast('Übernommen: ' + t.name); return 1;
    }
    case 'nTplNew': S.nutri.templates.push({ id: rid(), name: 'Neue Vorlage', items: [] }); afterChange(); return 1;
    case 'nTplDup': {
      const t = tplById(d.id); if (!t) return 1;
      S.nutri.templates.push({ id: rid(), name: t.name + ' (Kopie)', items: t.items.map((e) => ({ ...e, id: rid(), per: { ...e.per } })) }); afterChange(); return 1;
    }
    case 'nTplDel': {
      if (!confirm('Diese Vorlage löschen?')) return 1;
      S.nutri.templates = S.nutri.templates.filter((x) => x.id !== d.id);
      Object.keys(S.nutri.week).forEach((k) => { if (S.nutri.week[k] === d.id) delete S.nutri.week[k]; });
      afterChange(); return 1;
    }
  }
  return undefined;
}
function nutriInput(f, el, v) {
  nutriEnsure();
  if (f === 'n.q') { nui.pick.q = v; if (/^\d{8,14}$/.test(v.trim())) $('#nMsg').textContent = 'Barcode erkannt: „Online suchen“ tippen.'; else if ($('#nMsg').textContent.startsWith('Barcode')) $('#nMsg').textContent = ''; $('#nList').innerHTML = pickListHTML(); return; }
  if (f === 'n.g') { updPrev(); return; }
  if (f === 'n.cmin' || f === 'n.ckcal') { cardioPrev(); return; }
  if (f === 'n.tname') { const t = tplById(el.dataset.id); if (t) { t.name = v; save(); } return; }
  if (f.startsWith('n.p.')) { S.nutri.profile[f.slice(4)] = v; save(); const c = $('#nCalc'); if (c) c.innerHTML = profileCalcHTML(); }
}
function nutriChange(f, el) {
  nutriEnsure();
  if (f === 'n.week') { if (el.value) S.nutri.week[el.dataset.d] = el.value; else delete S.nutri.week[el.dataset.d]; save(); return; }
  if (f === 'n.p.sex' || f === 'n.p.activity' || f === 'n.p.goal') { S.nutri.profile[f.slice(4)] = f === 'n.p.activity' ? num(el.value) : el.value; save(); render(); }
}

/* ---------- Cardio ---------- */
function cardioListHTML(list, w, withDate) {
  return list.map((c) => `<div class="nrow cardio"><span class="grow"><b>${esc(cardioName(c))}</b><small class="muted">${withDate ? esc(dateObj(localDay(c.date)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })) + ' · ' : ''}${f0(c.min)} Min.${c.kcal > 0 ? ' · Gerätewert' : ' · ' + ['leicht', 'mittel', 'intensiv'][c.lvl]}</small></span><span class="nk">${f0(cardioKcal(c, w))}<small> kcal</small></span><button class="ic danger" data-a="nCardioDel" data-id="${c.id}" aria-label="Cardio löschen">🗑</button></div>`).join('');
}
function cardioHTML() { // Karte im Tab Training
  nutriEnsure();
  const w = num(S.nutri.profile.weight) || 75, ds = dstr(), list = S.cardio.filter((c) => localDay(c.date) === ds);
  return `<div class="card"><div class="mealhead"><div class="grow"><b class="exname" style="font-size:22px">Cardio</b>${list.length ? `<div class="muted small">Heute ${f0(list.reduce((a, c) => a + cardioKcal(c, w), 0))} kcal</div>` : '<div class="muted small">Laufband, Rad, Stairmaster, Crosstrainer</div>'}</div><button class="btn" data-a="nCardioOpen">＋ Erfassen</button></div>${cardioListHTML(list, w)}</div>`;
}
function cardioHistHTML() { // Abschnitt im Tab Verlauf
  nutriEnsure(); if (!S.cardio.length) return '';
  const w = num(S.nutri.profile.weight) || 75;
  return `<h2 style="margin:16px 0 8px">Cardio</h2><div class="card">${cardioListHTML([...S.cardio].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60), w, true)}</div>`;
}
function cardioPrev() {
  const hn = document.getElementById('nCHint'); if (hn) hn.textContent = CARDIO[cui.type][2][cui.lvl];
  const el = document.getElementById('nCPrev'); if (!el) return;
  const min = num(document.getElementById('nCMin').value), kc = num(document.getElementById('nCKcal').value), w = num(S.nutri.profile.weight) || 75;
  const v = kc > 0 ? kc : CARDIO[cui.type][1][cui.lvl] * w * min / 60;
  el.innerHTML = `<div class="nprevk"><b>${f0(v)}</b><small> kcal</small></div><div class="muted small">${kc > 0 ? 'Wert vom Gerät' : `MET ${f1(CARDIO[cui.type][1][cui.lvl])} × ${f0(w)} kg × ${f0(min)} Min.${num(S.nutri.profile.weight) ? '' : ' (Gewicht 75 kg angenommen, trag deins im Profil ein)'}`}</div>`;
}
function cardioModal() {
  const T = CARDIO[cui.type];
  openModal(`<div class="row"><h2 class="grow" style="margin:0">Cardio erfassen</h2><button class="ic" data-a="closeModal" aria-label="Schließen">✕</button></div>
    <div class="chips" style="flex-wrap:wrap;margin-top:10px">${Object.entries(CARDIO).map(([k, v]) => `<button class="chip ${cui.type === k ? 'on' : ''}" data-a="nCType" data-k="${k}">${v[0]}</button>`).join('')}</div>
    ${cui.type === 'custom' ? '<input id="nCName" class="block" style="width:100%;margin-bottom:10px" maxlength="40" placeholder="Name, z. B. Rudergerät">' : ''}
    <div class="row"><label class="pf">Dauer<span class="pfi"><input id="nCMin" type="number" inputmode="numeric" min="1" data-f="n.cmin" value="30"><small>Min.</small></span></label>
      <label class="pf">Datum<input id="nCDate" type="date" value="${dstr()}" max="${dstr()}"></label></div>
    <div class="muted small">Intensität</div><div class="chips" style="margin-top:4px">${['Leicht', 'Mittel', 'Intensiv'].map((l, i) => `<button class="chip ${cui.lvl === i ? 'on' : ''}" data-a="nCLvl" data-l="${i}">${l}</button>`).join('')}</div>
    <div id="nCHint" class="muted small">${esc(T[2][cui.lvl])}</div>
    <label class="pf" style="margin-top:10px">Kalorien vom Gerät (optional, ersetzt die Schätzung)<span class="pfi"><input id="nCKcal" type="number" inputmode="numeric" min="0" data-f="n.ckcal" placeholder="z. B. 320"><small>kcal</small></span></label>
    <div id="nCPrev" class="card nprev"></div>
    <button class="btn primary block" data-a="nCardioSave">Speichern</button>`);
  cardioPrev();
}
