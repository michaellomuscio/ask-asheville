// Regression check for the question engine, run in a real browser against the running site:
//   npm start            (in one terminal)
//   npm run test:questions
// It asks every example question, every follow-up those answers suggest (three levels deep), a
// "where is the most / the fewest" question and a "which town" question for every map measure, and
// every question used by the guided investigations. Anything the engine can't answer is printed and
// fails the run.
export default async ({ ev, ready, errs }) => {
  if (!(await ready())) throw new Error('The site did not finish loading.');
  await ev('asheville.labUI.hideWelcome()');
  const report = await ev(`(async () => {
    const ui = asheville.labUI;
    const { QUESTION_BANK } = await import('./src/lab/ask.js');
    const problems = [];
    const seen = new Set(QUESTION_BANK.flatMap((g) => g.qs));
    let frontier = [...seen];
    try {
      // Guided investigations: every question a step, a check, a finding or an "ask next" button sends,
      // with each place choice filled in.
      const inv = await import('./src/lab/investigations.js');
      const add = (q, picks) => {
        if (typeof q !== 'string') return;
        const list = /\{(pick|place)\}/.test(q) ? (picks && picks.length ? picks : ['Weaverville']).map((p) => q.replace(/\{(pick|place)\}/g, p)) : [q];
        for (const x of list) if (!seen.has(x)) { seen.add(x); frontier.push(x); }
      };
      const walk = (o, picks) => {
        if (Array.isArray(o)) { o.forEach((x) => walk(x, picks)); return; }
        if (!o || typeof o !== 'object') return;
        const mine = Array.isArray(o.pick) ? o.pick : Array.isArray(o.places) ? o.places : picks;
        for (const [k, v] of Object.entries(o)) {
          if (k === 'ask' || k === 'asks' || k === 'extend') (Array.isArray(v) ? v : [v]).forEach((x) => add(x, mine));
          else if (typeof v === 'object') walk(v, mine);
        }
      };
      walk(inv.INVESTIGATIONS, null);
    } catch (e) { problems.push('could not read the investigations: ' + e); }
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      for (const q of frontier) {
        let a;
        try { a = ui.asker.ask(q); } catch (e) { problems.push('error: ' + q + ' (' + e + ')'); continue; }
        if (a.miss && !/my (spot|house|home)/i.test(q)) problems.push('not understood: ' + q);
        for (const f of a.follow || []) if (!seen.has(f)) { seen.add(f); next.push(f); }
      }
      frontier = next;
    }
    const twin = { density_b: 'density', pct_kids_b: 'pct_under_18' };
    for (const m of ui.lab.metrics) for (const dir of ['hi', 'lo']) {
      const phrase = dir === 'hi' ? m.hi : m.lo;
      const plural = /^the (most|fewest) /.test(phrase) || /[^s]s$/.test(phrase.split(' ').pop());
      const q = 'Where ' + (plural ? 'are' : 'is') + ' ' + phrase + '?';
      const a = ui.asker.ask(q);
      if (a.kind !== 'rank' || (a.metricId !== m.id && twin[m.id] !== a.metricId && twin[a.metricId] !== m.id)) problems.push('wrong measure: ' + q + ' -> ' + a.kind + ' ' + (a.metricId || ''));
      if (ui.lab.geoOf(m.id) === 'bg' && ui.asker.ask('Which town has ' + phrase + '?').kind !== 'ranktowns') problems.push('town ranking failed: ' + phrase);
    }
    return { asked: seen.size, problems };
  })()`);
  console.log(`${report.asked} questions asked, ${report.problems.length} problems`);
  for (const p of report.problems) console.log('  ' + p);
  if (report.problems.length) errs.push(`${report.problems.length} question(s) failed`);
};
