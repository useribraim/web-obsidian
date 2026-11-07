import { gradeRound, mistakesMarkdown, interviewTopic } from './public/interview-data.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function interviewResponse(request, env, url) {
  if (url.pathname !== '/api/interview/results') return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Invalid origin.' }, 403);
  const text = await request.text();
  if (text.length > 8192) return json({ error: 'This round is too large.' }, 413);
  let round;
  let result;
  try {
    round = JSON.parse(text);
    if (!round || typeof round.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(round.id)
      || typeof round.completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(round.completedAt)
      || !Number.isFinite(Date.parse(round.completedAt)) || new Date(round.completedAt).toISOString() !== round.completedAt) {
      throw new Error('Invalid round.');
    }
    // Grade from the bank, never from a score or answer key supplied by the client.
    result = gradeRound(round.questionIds, round.answers, round.topic);
  } catch { return json({ error: 'Invalid round. Complete ten questions and try again.' }, 400); }
  if (!result.mistakes.length) return json({ score: result.score, total: result.total, note: null });

  const content = mistakesMarkdown(round);
  const title = `Interview mistakes — ${interviewTopic(round.topic).title} — ${round.completedAt.slice(0, 16).replace('T', ' ')} UTC`;
  // The round UUID is also the new note UUID. Retrying after a lost response
  // cannot duplicate a note, and a retry never overwrites a later manual edit.
  const inserted = await env.DB.prepare('INSERT INTO notes (id, title, content) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(round.id, title, content).run();
  const note = await env.DB.prepare('SELECT id, title, content, version, updated_at, deleted_at FROM notes WHERE id = ?').bind(round.id).first();
  if (!note || note.deleted_at || note.content !== content) {
    return json({ error: 'This round’s note was changed or removed. Your existing notes were not overwritten. Download the mistakes to keep this copy.' }, 409);
  }
  return json({ score: result.score, total: result.total, note: { id: note.id, title: note.title, updated_at: note.updated_at } }, inserted.meta.changes ? 201 : 200);
}
