import { LANGUAGE_QUESTIONS } from './interview-languages.js';
import { questionStudy } from './interview-study.js';

export const ROUND_SIZE = 10;
export const INTERVIEW_DIFFICULTIES = ['all', 'fundamentals', 'intermediate'];
export const INTERVIEW_TOPICS = [
  { id: 'mixed', title: 'Python & C++', description: 'Practice both languages' },
  { id: 'python', title: 'Python', description: 'Python 3 fundamentals and interview pitfalls' },
  { id: 'cpp', title: 'C++', description: 'Modern C++17 ownership, lifetimes, and STL' },
];
export const INTERVIEW_QUESTIONS = LANGUAGE_QUESTIONS;
const byId = new Map(INTERVIEW_QUESTIONS.map(item => [item.id, item]));
export const interviewQuestion = id => byId.get(id);
export const interviewTopic = id => INTERVIEW_TOPICS.find(item => item.id === id);

export function pickQuestions(topic, random = Math.random, difficulty = 'all') {
  if (!interviewTopic(topic)) throw new Error('Choose an interview topic.');
  if (!INTERVIEW_DIFFICULTIES.includes(difficulty)) throw new Error('Choose a difficulty.');
  const pool = INTERVIEW_QUESTIONS.filter(item => (topic === 'mixed' || item.topic === topic)
    && (difficulty === 'all' || item.difficulty === difficulty));
  if (pool.length < ROUND_SIZE) throw new Error('Not enough questions for this round.');
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, ROUND_SIZE).map(item => item.id);
}

export function gradeRound(questionIds, answers, topic) {
  if (!interviewTopic(topic) || !Array.isArray(questionIds) || questionIds.length !== ROUND_SIZE
    || new Set(questionIds).size !== ROUND_SIZE || !Array.isArray(answers) || answers.length !== ROUND_SIZE) {
    throw new Error('Complete ten different questions before saving your round.');
  }
  const results = questionIds.map((id, index) => {
    const item = interviewQuestion(id);
    if (!item || (topic !== 'mixed' && item.topic !== topic) || (answers[index] !== null
      && (!Number.isInteger(answers[index]) || answers[index] < 0 || answers[index] >= item.options.length))) throw new Error('Invalid question or answer.');
    return { question: item, selected: answers[index], correct: answers[index] === item.answer };
  });
  return { score: results.filter(item => item.correct).length, total: ROUND_SIZE, mistakes: results.filter(item => !item.correct) };
}

export function mistakesMarkdown(round) {
  const result = gradeRound(round.questionIds, round.answers, round.topic);
  const lines = ['# Interview prep — mistakes', '', `Topic: ${interviewTopic(round.topic).title}`,
    `Completed: ${round.completedAt}`, `Score: ${result.score} / ${result.total}`, `Round: ${round.id}`, ''];
  if (!result.mistakes.length) lines.push('No mistakes this round. Well done!', '');
  result.mistakes.forEach(({ question: item, selected }, index) => {
    lines.push(`## Question ${index + 1}: ${item.prompt}`, '', `Topic: ${interviewTopic(item.topic).title}`, '');
    item.options.forEach((option, i) => lines.push(`- ${String.fromCharCode(65 + i)}. ${option}`));
    lines.push('', `Your answer: ${selected === null ? 'I don’t know' : `${String.fromCharCode(65 + selected)}. ${item.options[selected]}`}`,
      `Correct answer: ${String.fromCharCode(65 + item.answer)}. ${item.options[item.answer]}`,
      '', `Explanation: ${item.explanation}`, '', '- [ ] Revisit this concept and explain it in your own words.', '');
    if (selected === null) {
      const study = questionStudy(item.id);
      lines.push(`### Basics: ${study.title}`, '', study.basics, '', `\`\`\`${item.topic === 'python' ? 'python' : 'cpp'}`,
        study.code, '```', '');
    }
  });
  return lines.join('\n');
}
