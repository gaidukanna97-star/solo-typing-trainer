// Конфігуровані пороги (ТЗ 4.3). Усі значення можна змінити тут; частину — у «Налаштуваннях».

export const LEVELS = [
  { id: 'intro', name: 'Ознайомлення', minSpm: 0, minAcc: 95, goal: 'правильний палець і повернення на домашній ряд' },
  { id: 'basic', name: 'Базовий', minSpm: 100, minAcc: 96, goal: 'стабільна механіка' },
  { id: 'confident', name: 'Впевнений', minSpm: 150, minAcc: 97, goal: 'слова й типові переходи' },
  { id: 'working', name: 'Робочий', minSpm: 225, minAcc: 97, goal: 'зв’язний текст і рівний ритм' },
  { id: 'speed', name: 'Швидкісний', minSpm: 300, minAcc: 98, goal: 'темп без втрати точності' },
];

// Вимоги для зарахування вправи за етапами. Точність обов'язкова завжди.
// Швидкість блокує лише вправи Академії й лише якщо ввімкнено speedGate —
// початківця не зупиняє недосяжний темп.
export const PASS_RULES = {
  scales: { minAcc: 95, minSpm: 0 },
  words: { minAcc: 96, minSpm: 0 },
  academy: { minAcc: 97, minSpm: 100 },
  tempo: { minAcc: 97, minSpm: 150 },
  text: { minAcc: 97, minSpm: 120 },
  free: { minAcc: 95, minSpm: 0 },
};

export const DEFAULT_SETTINGS = {
  lang: null, // 'uk' | 'en' — обирається під час створення профілю
  fontSize: 26, // px, 18–36
  sound: false,
  animations: true,
  theme: 'auto', // auto | light | dark
  errorMode: 'stop', // stop — зупинка на помилці; backspace — виправлення клавішею Backspace
  streak: 3, // скільки успішних залікових спроб поспіль зараховують вправу
  speedGate: true,
};

// Діагностика: з якого результату вважаємо, що людина вже друкує наосліп.
export const PLACEMENT = { minSpm: 100, minAcc: 95 };

export const HISTORY_LIMIT = 300;
// Інтервали, довші за це, вважаються паузою і не входять до статистики ритму й переходів.
export const PAUSE_MS = 3000;
