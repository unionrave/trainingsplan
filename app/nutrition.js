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
  S.cardio = S.cardio || []; n.weights = n.weights || []; n.foods = n.foods || []; n.log = n.log || {}; n.templates = n.templates || []; n.week = n.week || {};
  if (!nui.date) nui.date = dstr();
}

/* ---------- Berechnung ---------- */
// Gewicht für die Berechnung: Durchschnitt der Einträge der 7 Tage bis zum letzten Eintrag (glättet Wasserschwankungen), sonst das Profilgewicht
function effW(ds) {
  const ws = (S.nutri && S.nutri.weights) || [], ref = ds || '9999-12-31', le = ws.filter((w) => w.d <= ref), list = le.length ? le : ws;
  if (list.length) { const t = dateObj(list[list.length - 1].d).getTime(), win = list.filter((w) => t - dateObj(w.d).getTime() <= 6 * 864e5); return win.reduce((a, w) => a + w.kg, 0) / win.length; }
  return num(S.nutri.profile.weight) || 0;
}
const profOK = (p) => num(p.age) > 0 && num(p.height) > 0 && effW() > 0;
const bmr = (p) => 10 * effW() + 6.25 * num(p.height) - 5 * num(p.age) + (p.sex === 'f' ? -161 : 5); // Mifflin-St Jeor

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
  const w = effW(), now = Date.now(), win = 28 * 864e5;
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
  const w = effW(), B = bmr(p), base = B * num(p.activity), tr = trainAvg(p), tdee = base + tr.perDay;
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
  const body = nui.sub === 'weight' ? viewWeight() : nui.sub === 'plans' ? viewPlans() : nui.sub === 'profile' ? viewProfile() : viewToday();
  return `<div class="chips">${chip('today', 'Tagebuch')}${chip('plans', 'Pläne')}${chip('weight', 'Gewicht')}${chip('profile', 'Profil')}</div>${body}`;
}

function viewToday() {
  const ds = nui.date, T = targets(), p = S.nutri.profile, log = dayLog(ds), tot = sum(log), isToday = ds === dstr();
  const label = isToday ? 'Heute' : dateObj(ds).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const tk = profOK(p) ? trainOn(ds, effW(ds)) : 0, exp = T ? T.base + tk : 0;
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
    <div class="crow"><span>Gewicht für die Rechnung${S.nutri.weights.length ? ' (Ø 7 Tage aus dem Tracking)' : ' (aus dem Profil)'}</span><b>${f1(T.w)} kg</b></div>
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
  <div class="card"><h2>KI-Foto-Analyse</h2><div id="nKeyBox">${keyBoxHTML()}</div></div>
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
  return all.filter((f) => { const h = norm(foodName(f) + ' ' + f.cat + ' ' + (f.code || '')); return tok.every((t) => h.includes(t)); })
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
  if (nui.fddb && nui.fddb.length) html += `<div class="lsub">FDDB</div>${push(nui.fddb.map((x) => toFood(x, 'online')), 'FDDB')}`;
  if (nui.online.length) html += `<div class="lsub">Online (Open Food Facts)</div>${push(nui.online.map((x) => toFood(x, 'online')), 'online')}`;
  return html;
}
function openPicker(meal, tplId, q = '') {
  nui.pick = { meal, tplId: tplId || null, q }; nui.online = []; nui.fddb = []; nui.onlineMsg = '';
  const title = tplId ? 'Zur Vorlage hinzufügen' : 'Lebensmittel hinzufügen';
  openModal(`<div class="row"><h2 class="grow" style="margin:0">${title}<small class="muted" style="font:500 14px var(--body);display:block">${esc(meal)}</small></h2><button class="btn" data-a="nDone">Fertig</button></div>
    <div class="row" style="margin-top:10px"><input id="nQ" class="grow" type="search" data-f="n.q" maxlength="80" placeholder="Lebensmittel oder Barcode suchen" autocomplete="off" value="${esc(q)}"></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn grow" data-a="nScan">📷 Barcode scannen</button></div>
    <div class="row" style="flex-wrap:wrap"><label class="btn grow">🍽 Mahlzeit fotografieren<input type="file" accept="image/*" capture="environment" data-f="n.photo" hidden></label><label class="btn grow">🖼 Foto aus Galerie<input type="file" accept="image/*" data-f="n.photo" hidden></label></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn grow" data-a="nOnline">🔎 Open Food Facts</button><button class="btn grow" data-a="nFddb">🔎 FDDB</button><button class="btn grow" data-a="nNewFood">＋ Eigenes Lebensmittel</button></div>
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
    case 'nScan': scanModal(); return 1;
    case 'nGoKey': closeModal(); nui.sub = 'profile'; render(); return 1;
    case 'nKeySave': {
      const key = ($('#nKeyIn').value || '').trim(); if (!key) { toast('Bitte den Key einfügen'); return 1; }
      try { const r = await api(`/users/${uid}/aikey`, { method: 'PUT', body: JSON.stringify({ key }) }); nui.key = { ...(nui.key || {}), set: true, last4: r.last4 }; toast('API-Key gespeichert'); }
      catch (e) { toast(e.message); return 1; }
      $('#nKeyBox').innerHTML = keyBoxHTML(); return 1;
    }
    case 'nKeyDel': {
      if (!confirm('Deinen API-Key vom Server entfernen?')) return 1;
      try { await api(`/users/${uid}/aikey`, { method: 'DELETE' }); nui.key = { ...(nui.key || {}), set: false, last4: '' }; toast('API-Key entfernt'); } catch (e) { toast(e.message); return 1; }
      $('#nKeyBox').innerHTML = keyBoxHTML(); return 1;
    }
    case 'nAiAdd': {
      const A = nui.ai; if (!A) return 1;
      const on = A.items.filter((x) => x.on && x.g > 0); if (!on.length) { toast('Nichts ausgewählt'); return 1; }
      on.forEach((x) => { const e = { id: rid(), meal: A.meal, name: x.name, g: Math.round(x.g), per: { k: x.kcal / x.grams * 100, p: x.protein / x.grams * 100, c: x.carbs / x.grams * 100, f: x.fat / x.grams * 100 }, ai: true }; if (A.tplId) tplById(A.tplId).items.push(e); else dayLog(nui.date).push(e); });
      nui.ai = null; closeModal(); afterChange(); toast(on.length + ' Einträge hinzugefügt'); return 1;
    }
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
    case 'nWSave': {
      const kg = num($('#nwKg').value.replace(',', '.')), d = $('#nwDate').value || dstr();
      if (!(kg >= 20 && kg <= 400)) { toast('Bitte ein Gewicht zwischen 20 und 400 kg eingeben'); return 1; }
      const ws = S.nutri.weights, e = ws.find((w) => w.d === d); if (e) e.kg = Math.round(kg * 10) / 10; else ws.push({ d, kg: Math.round(kg * 10) / 10 });
      ws.sort((a, b) => a.d.localeCompare(b.d)); await saveNow(); render(); toast('Gewicht gespeichert'); return 1;
    }
    case 'nWDel': {
      if (!confirm('Diesen Gewichtseintrag löschen?')) return 1;
      S.nutri.weights = S.nutri.weights.filter((w) => w.d !== d.d); await saveNow(); render(); return 1;
    }
    case 'nWRange': nui.wr = +d.d; render(); return 1;
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
    case 'nFddb': {
      const q = ($('#nQ').value || '').trim(); if (q.length < 2) { toast('Bitte einen Suchbegriff eingeben'); return 1; }
      nui.pick.q = q; $('#nMsg').textContent = 'FDDB wird durchsucht…';
      try { const r = await api('/fddbsearch?q=' + encodeURIComponent(q)); nui.fddb = r.results || []; $('#nMsg').textContent = nui.fddb.length ? '' : 'Bei FDDB nichts gefunden.'; }
      catch (e) { nui.fddb = []; $('#nMsg').textContent = e.network ? 'Keine Verbindung: Die FDDB-Suche braucht Internet.' : e.message; }
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
        S.nutri.foods.push({ id: rid(), name: foodName(f), code: f.code, kcal: f.per.k, p: f.per.p, c: f.per.c, f: f.per.f, ...(f.portions && f.portions.length ? { portions: f.portions } : {}) }); // merken für offline und „Meine Lebensmittel“
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
  if (f === 'n.goalw') { S.nutri.profile.goalW = v; save(); return; }
  if (f === 'n.g') { updPrev(); return; }
  if (f === 'n.aig') { const x = nui.ai.items[+el.dataset.i], g = num(v); x.g = g > 0 ? g : 0; const t = aiScale(x, x.g), e = document.getElementById('aiv' + el.dataset.i); if (e) e.textContent = `${f0(t.k)} kcal · P ${f0(t.p)} · KH ${f0(t.c)} · F ${f0(t.f)}`; document.getElementById('aiTot').innerHTML = aiTotals(); return; }
  if (f === 'n.cmin' || f === 'n.ckcal') { cardioPrev(); return; }
  if (f === 'n.tname') { const t = tplById(el.dataset.id); if (t) { t.name = v; save(); } return; }
  if (f.startsWith('n.p.')) { S.nutri.profile[f.slice(4)] = v; save(); const c = $('#nCalc'); if (c) c.innerHTML = profileCalcHTML(); }
}
function nutriChange(f, el) {
  nutriEnsure();
  if (f === 'n.photo') { const file = el.files && el.files[0]; el.value = ''; if (file) analyzePhoto(file); return; }
  if (f === 'n.bcfile') {
    const file = el.files && el.files[0]; el.value = ''; if (!file) return;
    $('#nScanMsg').textContent = 'Barcode wird gelesen…';
    decodeBarcodeFile(file).then((c) => { if (c && barcodeOK(c)) lookupCode(c, nui.pick ? nui.pick.meal : MEALS[0]); else $('#nScanMsg').textContent = 'Kein Barcode erkannt. Nimm das Foto näher und gerade auf, oder tippe die Nummer ein.'; }).catch((e) => { $('#nScanMsg').textContent = e.message; });
    return;
  }
  if (f === 'n.aion') { nui.ai.items[+el.dataset.i].on = el.checked; document.getElementById('aiTot').innerHTML = aiTotals(); return; }
  if (f === 'n.aimeal') { nui.ai.meal = el.value; return; }
  if (f === 'n.week') { if (el.value) S.nutri.week[el.dataset.d] = el.value; else delete S.nutri.week[el.dataset.d]; save(); return; }
  if (f === 'n.p.sex' || f === 'n.p.activity' || f === 'n.p.goal') { S.nutri.profile[f.slice(4)] = f === 'n.p.activity' ? num(el.value) : el.value; save(); render(); }
}

/* ---------- Cardio ---------- */
function cardioListHTML(list, w, withDate) {
  return list.map((c) => `<div class="nrow cardio"><span class="grow"><b>${esc(cardioName(c))}</b><small class="muted">${withDate ? esc(dateObj(localDay(c.date)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })) + ' · ' : ''}${f0(c.min)} Min.${c.kcal > 0 ? ' · Gerätewert' : ' · ' + ['leicht', 'mittel', 'intensiv'][c.lvl]}</small></span><span class="nk">${f0(cardioKcal(c, w))}<small> kcal</small></span><button class="ic danger" data-a="nCardioDel" data-id="${c.id}" aria-label="Cardio löschen">🗑</button></div>`).join('');
}
function cardioHTML() { // Karte im Tab Training
  nutriEnsure();
  const w = effW() || 75, ds = dstr(), list = S.cardio.filter((c) => localDay(c.date) === ds);
  return `<div class="card"><div class="mealhead"><div class="grow"><b class="exname" style="font-size:22px">Cardio</b>${list.length ? `<div class="muted small">Heute ${f0(list.reduce((a, c) => a + cardioKcal(c, w), 0))} kcal</div>` : '<div class="muted small">Laufband, Rad, Stairmaster, Crosstrainer</div>'}</div><button class="btn" data-a="nCardioOpen">＋ Erfassen</button></div>${cardioListHTML(list, w)}</div>`;
}
function cardioHistHTML() { // Abschnitt im Tab Verlauf
  nutriEnsure(); if (!S.cardio.length) return '';
  const w = effW() || 75;
  return `<h2 style="margin:16px 0 8px">Cardio</h2><div class="card">${cardioListHTML([...S.cardio].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60), w, true)}</div>`;
}
function cardioPrev() {
  const hn = document.getElementById('nCHint'); if (hn) hn.textContent = CARDIO[cui.type][2][cui.lvl];
  const el = document.getElementById('nCPrev'); if (!el) return;
  const min = num(document.getElementById('nCMin').value), kc = num(document.getElementById('nCKcal').value), w = effW() || 75;
  const v = kc > 0 ? kc : CARDIO[cui.type][1][cui.lvl] * w * min / 60;
  el.innerHTML = `<div class="nprevk"><b>${f0(v)}</b><small> kcal</small></div><div class="muted small">${kc > 0 ? 'Wert vom Gerät' : `MET ${f1(CARDIO[cui.type][1][cui.lvl])} × ${f0(w)} kg × ${f0(min)} Min.${effW() ? '' : ' (Gewicht 75 kg angenommen, trag deins im Gewichts-Tracking oder Profil ein)'}`}</div>`;
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

/* ---------- Barcode-Scanner ---------- */
let scan = null;
function stopScan() { if (scan) { scan.stop = true; try { scan.stream && scan.stream.getTracks().forEach((t) => t.stop()); } catch {} scan = null; } }
window.addEventListener('load', () => { const _cm = closeModal, _om = openModal; closeModal = function () { stopScan(); _cm(); }; openModal = function (h) { stopScan(); _om(h); }; });
const loadZX = () => window.ZXing ? Promise.resolve() : new Promise((ok, no) => { const el = document.createElement('script'); el.src = '/zxing.min.js'; el.onload = ok; el.onerror = () => no(new Error('Der Scanner konnte nicht geladen werden (offline?)')); document.head.appendChild(el); });
const barcodeOK = (c) => /^\d{8,14}$/.test(c);
async function zxDecode(canvas) { // liefert Text oder null
  await loadZX();
  const Z = window.ZXing, hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]], [Z.DecodeHintType.TRY_HARDER, true]]);
  const r = new Z.MultiFormatReader(); r.setHints(hints);
  try { return r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText(); } catch { return null; }
}
function scanFallbackHTML(msg) {
  return `<p class="muted small" style="margin:10px 0">${esc(msg)}</p><label class="btn block">📷 Foto vom Barcode aufnehmen<input type="file" accept="image/*" capture="environment" data-f="n.bcfile" hidden></label>
    <p class="muted small">Oder die Nummer unter dem Barcode in das Suchfeld tippen und „Online suchen“ wählen.</p>`;
}
async function scanModal() {
  const meal = nui.pick ? nui.pick.meal : MEALS[0];
  openModal(`<div class="row"><h2 class="grow" style="margin:0">Barcode scannen</h2><button class="ic" data-a="nBack" aria-label="Abbrechen">✕</button></div>
    <div class="scanbox"><video id="nVid" playsinline muted autoplay></video><i class="scanline"></i></div><div id="nScanMsg" class="muted small" style="margin-top:8px">Halte den Barcode ruhig in den Rahmen.</div><div id="nScanFb"></div>`);
  const st = (scan = { stop: false, stream: null });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#nScanFb').innerHTML = scanFallbackHTML('Die Kamera ist hier nicht verfügbar (die Seite braucht HTTPS).'); return; }
  try { st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
  catch (e) { if (!st.stop) $('#nScanFb').innerHTML = scanFallbackHTML(e && e.name === 'NotAllowedError' ? 'Kamerazugriff wurde nicht erlaubt. Erlaube ihn in den Browser-Einstellungen oder nutze ein Foto.' : 'Keine Kamera gefunden.'); return; }
  if (st.stop) { st.stream.getTracks().forEach((t) => t.stop()); return; }
  const v = $('#nVid'); v.srcObject = st.stream; try { await v.play(); } catch {}
  let native = null;
  if ('BarcodeDetector' in window) { try { native = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); } catch {} }
  if (!native) { try { await loadZX(); } catch (e) { $('#nScanFb').innerHTML = scanFallbackHTML(e.message); } }
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (st.stop) return;
    let code = null;
    try {
      if (v.videoWidth) {
        if (native) { const r = await native.detect(v); code = r[0] && r[0].rawValue; }
        else if (window.ZXing) { cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0); code = await zxDecode(cv); }
      }
    } catch {}
    if (st.stop) return;
    if (code && barcodeOK(code)) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); lookupCode(code, meal); return; }
    setTimeout(tick, native ? 120 : 220);
  };
  tick();
}
async function lookupCode(code, meal) {
  const p = nui.pick || { meal, tplId: null }, local = S.nutri.foods.find((x) => x.code === code);
  const kind = p.tplId ? 'tpl' : 'log';
  if (local) { nui.pick = { meal: p.meal, tplId: p.tplId, q: '' }; openAmount({ food: toFood(local, 'mine'), g: (local.portions && local.portions[0] && local.portions[0].g) || 100, meal: p.meal, kind, tplId: p.tplId }); return; }
  openPicker(p.meal, p.tplId, code);
  await nutriAct('nOnline', {});
  if (nui.online.length === 1) await nutriAct('nPick', { i: nui.items.length - 1 });
  else if (!nui.online.length) { const m = $('#nMsg'); if (m && !/Keine Verbindung/.test(m.textContent)) m.textContent = 'Barcode ' + code + ' ist online nicht bekannt. Lege das Lebensmittel mit „Eigenes Lebensmittel“ an, beim nächsten Scan wird es gefunden.'; }
}
async function decodeBarcodeFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Bild nicht lesbar')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    if ('BarcodeDetector' in window) { try { const r = await new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }).detect(c); if (r[0]) return r[0].rawValue; } catch {} }
    return await zxDecode(c);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Foto-Analyse (OpenAI über den Server) ---------- */
const blobToDataURL = (b) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Bild nicht lesbar')); r.readAsDataURL(b); });
const aiScale = (x, g) => { const k = x.grams > 0 ? g / x.grams : 0; return { k: x.kcal * k, p: x.protein * k, c: x.carbs * k, f: x.fat * k }; };
async function analyzePhoto(file) {
  const meal = nui.pick ? nui.pick.meal : MEALS[0], tplId = nui.pick ? nui.pick.tplId : null;
  openModal(`<h2 style="margin:0 0 8px">Foto wird analysiert…</h2><p class="muted">Das dauert meist 5 bis 20 Sekunden.</p><div class="spin" aria-hidden="true"></div>`);
  try {
    const dataUrl = await blobToDataURL(await resizeImage(file, 1024));
    const r = await api('/mealphoto', { method: 'POST', body: JSON.stringify({ image: dataUrl }) });
    nui.ai = { meal, tplId, note: r.note, items: r.items.map((x) => ({ ...x, g: x.grams, on: true })) };
    aiModal();
  } catch (e) {
    openModal(`<h2 style="margin:0 0 8px">Analyse nicht möglich</h2><p>${esc(e.network ? 'Keine Verbindung: Die Foto-Analyse braucht Internet.' : e.message)}</p>${/API-Key/.test(e.message) && !auth.trainer ? '<button class="btn primary block" style="margin-bottom:8px" data-a="nGoKey">Key im Profil eintragen</button>' : ''}<button class="btn block" data-a="nBack">Zurück</button>`);
  }
}
function aiTotals() { const t = nui.ai.items.filter((x) => x.on).reduce((a, x) => { const v = aiScale(x, x.g); return { k: a.k + v.k, p: a.p + v.p, c: a.c + v.c, f: a.f + v.f }; }, { k: 0, p: 0, c: 0, f: 0 }); return `Summe: <b>${f0(t.k)} kcal</b> · P ${f0(t.p)} · KH ${f0(t.c)} · F ${f0(t.f)}`; }
function aiModal() {
  const A = nui.ai;
  openModal(`<div class="row"><h2 class="grow" style="margin:0">Ergebnis der Analyse</h2><button class="ic" data-a="nBack" aria-label="Verwerfen">✕</button></div>
    ${A.items.length ? '' : '<p>Auf dem Foto wurde kein Essen erkannt.</p>'}${A.note ? `<p class="muted small">${esc(A.note)}</p>` : ''}
    <div class="stack" style="margin-top:8px">${A.items.map((x, i) => { const v = aiScale(x, x.g); return `<div class="airow"><label class="aichk"><input type="checkbox" data-f="n.aion" data-i="${i}" ${x.on ? 'checked' : ''} aria-label="${esc(x.name)} übernehmen"></label>
      <span class="grow"><b>${esc(x.name)}</b>${x.confidence === 'low' ? ' <small class="warn">unsicher</small>' : ''}<small class="muted" id="aiv${i}" style="display:block">${f0(v.k)} kcal · P ${f0(v.p)} · KH ${f0(v.c)} · F ${f0(v.f)}</small></span>
      <span class="pfi"><input type="number" inputmode="decimal" min="1" data-f="n.aig" data-i="${i}" value="${x.g}" style="width:76px" aria-label="Gramm ${esc(x.name)}"><small>g</small></span></div>`; }).join('')}</div>
    <div id="aiTot" class="card nprev">${aiTotals()}</div>
    ${A.tplId ? '' : `<label class="pf">Mahlzeit<select data-f="n.aimeal">${MEALS.map((m) => `<option ${m === A.meal ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`}
    <p class="muted small">KI-Schätzung: Mengen und Werte können deutlich danebenliegen. Prüfe sie und passe die Gramm an. Das Foto wurde zur Analyse an OpenAI gesendet und nicht gespeichert.</p>
    <div class="row"><button class="btn primary grow" data-a="nAiAdd" ${A.items.length ? '' : 'disabled'}>Ausgewählte hinzufügen</button></div>`);
}

/* ---------- Eigener OpenAI-Key ---------- */
nui.key = null;
function keyBoxHTML() {
  if (auth.trainer) return '<p class="muted small" style="margin:0">Den API-Key trägt jede Person selbst ein, nachdem sie sich mit ihrer PIN angemeldet hat. Als Trainer kannst du die Foto-Analyse nicht für andere nutzen.</p>';
  if (!nui.key) { loadKey(); return '<p class="muted small" style="margin:0">Wird geladen…</p>'; }
  const k = nui.key;
  return `<p class="small" style="margin:0 0 8px">${k.set ? `Dein API-Key ist hinterlegt (endet auf <b>${esc(k.last4)}</b>). Die Foto-Analyse läuft über deinen OpenAI-Account.` : 'Für die Foto-Analyse einer Mahlzeit brauchst du einen eigenen OpenAI-API-Key. Ohne Key bleibt sie aus.'}</p>
    <div class="row" style="margin:0"><input id="nKeyIn" class="grow" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${k.set ? 'Neuen Key einfügen, um ihn zu ersetzen' : 'sk-…'}"><button class="btn primary" data-a="nKeySave">Speichern</button>${k.set ? '<button class="btn danger" data-a="nKeyDel">Entfernen</button>' : ''}</div>
    <p class="muted small" style="margin:8px 0 0">Den Key erstellst du unter <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a> (dort braucht das Konto Guthaben, ein ChatGPT-Abo reicht nicht). Der Key wird verschlüsselt auf dem Server gespeichert, nicht an dein Handy zurückgegeben und von niemandem außer dir verwendet, auch nicht vom Trainer. Die Kosten laufen über dein OpenAI-Konto, Modell: ${esc(k.model || 'gpt-6-luna')}.</p>`;
}
async function loadKey() {
  if (nui.keyLoading) return; nui.keyLoading = true;
  try { nui.key = await api(`/users/${uid}/aikey`); } catch (e) { nui.key = { set: false, last4: '', model: '' }; }
  nui.keyLoading = false; const b = document.getElementById('nKeyBox'); if (b) b.innerHTML = keyBoxHTML();
}

/* ---------- Gewicht ---------- */
const dayDiff = (a, b) => Math.round((dateObj(b) - dateObj(a)) / 864e5);
const kgf = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (n, u) => (n > 0.049 ? '+' : n < -0.049 ? '−' : '±') + kgf(Math.abs(n)) + u;
function weightTrend() { // kg pro Woche aus den Einträgen der letzten 28 Tage (Regressionsgerade), sonst null
  const ws = S.nutri.weights, last = ws[ws.length - 1]; if (!last) return null;
  const pts = ws.filter((w) => dayDiff(w.d, last.d) <= 28); if (pts.length < 3 || dayDiff(pts[0].d, last.d) < 7) return null;
  const xs = pts.map((w) => dayDiff(pts[0].d, w.d)), mx = xs.reduce((a, b) => a + b) / xs.length, my = pts.reduce((a, w) => a + w.kg, 0) / pts.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0); if (!den) return null;
  return 7 * xs.reduce((a, x, i) => a + (x - mx) * (pts[i].kg - my), 0) / den;
}
function weightChart(range) {
  const all = S.nutri.weights, goal = num(S.nutri.profile.goalW), t0 = range ? dstr(new Date(Date.now() - range * 864e5)) : '';
  const pts = all.filter((w) => w.d >= t0);
  if (pts.length < 2) return '<div class="muted small" style="padding:18px 0">Ab zwei Einträgen erscheint hier der Verlauf.</div>';
  const W = 340, H = 190, L = 38, R = 10, T = 12, B = 26, tmin = dateObj(pts[0].d).getTime(), tmax = Math.max(dateObj(pts[pts.length - 1].d).getTime(), tmin + 6 * 864e5);
  const avg = pts.map((w) => { const t = dateObj(w.d).getTime(), win = all.filter((x) => { const d = t - dateObj(x.d).getTime(); return d >= 0 && d <= 6 * 864e5; }); return { d: w.d, kg: win.reduce((a, x) => a + x.kg, 0) / win.length }; });
  const vals = [...pts.map((w) => w.kg), ...(goal > 0 ? [goal] : [])];
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(0.5, (hi - lo) * 0.12); lo = Math.floor((lo - pad) * 2) / 2; hi = Math.ceil((hi + pad) * 2) / 2;
  const X = (d) => L + (dateObj(d).getTime() - tmin) / (tmax - tmin) * (W - L - R), Y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<line class="wg" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="wt" x="${L - 5}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${kgf(v)}</text>`).join('');
  const fd = (d) => dateObj(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const line = avg.map((a) => `${X(a.d).toFixed(1)},${Y(a.kg).toFixed(1)}`).join(' ');
  const cur = avg[avg.length - 1];
  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf von ${fd(pts[0].d)} bis ${fd(pts[pts.length - 1].d)}: von ${kgf(pts[0].kg)} auf ${kgf(pts[pts.length - 1].kg)} Kilogramm">${ticks}
    ${goal > 0 && goal >= lo && goal <= hi ? `<line class="wgoal" x1="${L}" x2="${W - R}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}"/><text class="wt goal" x="${W - R}" y="${(Y(goal) - 4).toFixed(1)}" text-anchor="end">Ziel ${kgf(goal)}</text>` : ''}
    <polyline class="wavg" points="${line}"/>${pts.map((w) => `<circle class="wdot" cx="${X(w.d).toFixed(1)}" cy="${Y(w.kg).toFixed(1)}" r="3"/>`).join('')}
    <circle class="wcur" cx="${X(cur.d).toFixed(1)}" cy="${Y(cur.kg).toFixed(1)}" r="4.5"/>
    <text class="wt" x="${L}" y="${H - 6}">${fd(pts[0].d)}</text><text class="wt" x="${W - R}" y="${H - 6}" text-anchor="end">${fd(pts[pts.length - 1].d)}</text></svg>
    <div class="muted small"><i class="lg dots"></i>Messung <i class="lg avgl"></i>Ø 7 Tage${goal > 0 ? ' <i class="lg goall"></i>Zielgewicht' : ''}</div>`;
}
function viewWeight() {
  const ws = S.nutri.weights, last = ws[ws.length - 1], p = S.nutri.profile, goal = num(p.goalW), range = nui.wr === undefined ? 90 : nui.wr;
  const cur = last ? effW() : 0, first = ws[0], tr = weightTrend();
  const stat = (v, l) => `<div class="wstat"><b>${v}</b><small>${l}</small></div>`;
  const stats = last ? `<div class="wstats">${stat(kgf(cur) + ' kg', 'aktuell (Ø 7 Tage)')}${stat(ws.length > 1 ? signed(cur - first.kg, ' kg') : '–', 'seit dem ersten Eintrag')}${stat(tr === null ? '–' : signed(tr, ' kg'), 'Trend pro Woche')}${goal > 0 ? stat(signed(goal - cur, ' kg'), 'bis zum Ziel') : ''}</div>` : '';
  const rb = (d, l) => `<button class="chip ${range === d ? 'on' : ''}" data-a="nWRange" data-d="${d}">${l}</button>`;
  const rows = [...ws].reverse().slice(0, 14).map((w, i, a) => { const prev = a[i + 1]; return `<div class="nrow cardio"><span class="grow"><b>${esc(dateObj(w.d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }))}</b>${prev ? `<small class="muted">${signed(w.kg - prev.kg, ' kg')} zum Eintrag davor</small>` : ''}</span><span class="nk">${kgf(w.kg)}<small> kg</small></span><button class="ic danger" data-a="nWDel" data-d="${w.d}" aria-label="Eintrag vom ${esc(w.d)} löschen">🗑</button></div>`; }).join('');
  return `<div class="card"><h2>Gewicht eintragen</h2><div class="row" style="margin:0;align-items:flex-end;flex-wrap:wrap"><label class="pf" style="min-width:120px">Gewicht<span class="pfi"><input id="nwKg" type="number" inputmode="decimal" step="0.1" min="20" max="400" placeholder="${last ? kgf(last.kg) : '78,0'}"><small>kg</small></span></label><label class="pf" style="min-width:150px">Datum<input id="nwDate" type="date" value="${dstr()}" max="${dstr()}"></label><button class="btn primary" data-a="nWSave">Speichern</button></div>
    <p class="muted small" style="margin:8px 0 0">Am besten morgens nach dem Aufstehen und vor dem Essen wiegen. Pro Tag zählt ein Wert, ein zweiter am selben Tag ersetzt den ersten. Für den Kalorienbedarf zählt der Durchschnitt der letzten 7 Tage.</p></div>
  ${last ? `<div class="card">${stats}<div class="chips" style="margin:12px 0 4px">${rb(30, '30 Tage')}${rb(90, '90 Tage')}${rb(365, '1 Jahr')}${rb(0, 'Alles')}</div>${weightChart(range)}</div>` : '<div class="card muted">Noch kein Eintrag. Trag dein aktuelles Gewicht ein, dann zeigt die App Verlauf und Trend und rechnet den Kalorienbedarf damit.</div>'}
  <div class="card"><h2>Zielgewicht</h2><label class="pf">Optional, erscheint im Diagramm<span class="pfi"><input type="number" inputmode="decimal" step="0.1" data-f="n.goalw" value="${esc(p.goalW || '')}" placeholder="z. B. 75"><small>kg</small></span></label></div>
  ${rows ? `<div class="card"><h2>Einträge</h2>${rows}</div>` : ''}
  <p class="muted small">Der Trend ist eine Schätzung aus den Einträgen der letzten 4 Wochen und braucht mindestens 3 Werte über 7 Tage. Einzelne Tage schwanken durch Wasser, Salz und Verdauung um 1 bis 2 kg.</p>`;
}
