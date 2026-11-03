// The NeetCode 150, grouped as on neetcode.io/roadmap. The worker and the
// browser both import this file, so the server validates against the same list.
export const ROADMAP_CATEGORIES = [
  ['Arrays & Hashing', ['Contains Duplicate', 'Valid Anagram', 'Two Sum', 'Group Anagrams', 'Top K Frequent Elements', 'Encode and Decode Strings', 'Product of Array Except Self', 'Valid Sudoku', 'Longest Consecutive Sequence']],
  ['Two Pointers', ['Valid Palindrome', 'Two Sum II Input Array Is Sorted', '3Sum', 'Container With Most Water', 'Trapping Rain Water']],
  ['Sliding Window', ['Best Time to Buy and Sell Stock', 'Longest Substring Without Repeating Characters', 'Longest Repeating Character Replacement', 'Permutation in String', 'Minimum Window Substring', 'Sliding Window Maximum']],
  ['Stack', ['Valid Parentheses', 'Min Stack', 'Evaluate Reverse Polish Notation', 'Generate Parentheses', 'Daily Temperatures', 'Car Fleet', 'Largest Rectangle in Histogram']],
  ['Binary Search', ['Binary Search', 'Search a 2D Matrix', 'Koko Eating Bananas', 'Find Minimum in Rotated Sorted Array', 'Search in Rotated Sorted Array', 'Time Based Key-Value Store', 'Median of Two Sorted Arrays']],
  ['Linked List', ['Reverse Linked List', 'Merge Two Sorted Lists', 'Reorder List', 'Remove Nth Node From End of List', 'Copy List with Random Pointer', 'Add Two Numbers', 'Linked List Cycle', 'Find the Duplicate Number', 'LRU Cache', 'Merge k Sorted Lists', 'Reverse Nodes in k-Group']],
  ['Trees', ['Invert Binary Tree', 'Maximum Depth of Binary Tree', 'Diameter of Binary Tree', 'Balanced Binary Tree', 'Same Tree', 'Subtree of Another Tree', 'Lowest Common Ancestor of a Binary Search Tree', 'Binary Tree Level Order Traversal', 'Binary Tree Right Side View', 'Count Good Nodes in Binary Tree', 'Validate Binary Search Tree', 'Kth Smallest Element in a BST', 'Construct Binary Tree from Preorder and Inorder Traversal', 'Binary Tree Maximum Path Sum', 'Serialize and Deserialize Binary Tree']],
  ['Heap / Priority Queue', ['Kth Largest Element in a Stream', 'Last Stone Weight', 'K Closest Points to Origin', 'Kth Largest Element in an Array', 'Task Scheduler', 'Design Twitter', 'Find Median from Data Stream']],
  ['Backtracking', ['Subsets', 'Combination Sum', 'Permutations', 'Subsets II', 'Combination Sum II', 'Word Search', 'Palindrome Partitioning', 'Letter Combinations of a Phone Number', 'N-Queens']],
  ['Tries', ['Implement Trie', 'Design Add and Search Words Data Structure', 'Word Search II']],
  ['Graphs', ['Number of Islands', 'Max Area of Island', 'Clone Graph', 'Walls and Gates', 'Rotting Oranges', 'Pacific Atlantic Water Flow', 'Surrounded Regions', 'Course Schedule', 'Course Schedule II', 'Graph Valid Tree', 'Number of Connected Components in an Undirected Graph', 'Redundant Connection', 'Word Ladder']],
  ['Advanced Graphs', ['Reconstruct Itinerary', 'Min Cost to Connect All Points', 'Network Delay Time', 'Swim in Rising Water', 'Alien Dictionary', 'Cheapest Flights Within K Stops']],
  ['1-D DP', ['Climbing Stairs', 'Min Cost Climbing Stairs', 'House Robber', 'House Robber II', 'Longest Palindromic Substring', 'Palindromic Substrings', 'Decode Ways', 'Coin Change', 'Maximum Product Subarray', 'Word Break', 'Longest Increasing Subsequence', 'Partition Equal Subset Sum']],
  ['2-D DP', ['Unique Paths', 'Longest Common Subsequence', 'Best Time to Buy and Sell Stock with Cooldown', 'Coin Change II', 'Target Sum', 'Interleaving String', 'Longest Increasing Path in a Matrix', 'Distinct Subsequences', 'Edit Distance', 'Burst Balloons', 'Regular Expression Matching']],
  ['Greedy', ['Maximum Subarray', 'Jump Game', 'Jump Game II', 'Gas Station', 'Hand of Straights', 'Merge Triplets to Form Target Triplet', 'Partition Labels', 'Valid Parenthesis String']],
  ['Intervals', ['Insert Interval', 'Merge Intervals', 'Non-overlapping Intervals', 'Meeting Rooms', 'Meeting Rooms II', 'Minimum Interval to Include Each Query']],
  ['Math & Geometry', ['Rotate Image', 'Spiral Matrix', 'Set Matrix Zeroes', 'Happy Number', 'Plus One', 'Pow(x, n)', 'Multiply Strings', 'Detect Squares']],
  ['Bit Manipulation', ['Single Number', 'Number of 1 Bits', 'Counting Bits', 'Reverse Bits', 'Missing Number', 'Sum of Two Integers', 'Reverse Integer']],
];

// Words a person may type for a language, mapped to the name that is stored.
export const ROADMAP_LANGUAGES = {
  Python: ['python', 'python3', 'py', 'py3'],
  'C++': ['c++', 'cpp', 'cxx', 'cplusplus'],
  C: ['c'],
  Java: ['java'],
  JavaScript: ['javascript', 'js', 'node', 'nodejs'],
  TypeScript: ['typescript', 'ts'],
  Go: ['go', 'golang'],
  Rust: ['rust', 'rs'],
  'C#': ['c#', 'csharp', 'cs'],
  Swift: ['swift'],
  Kotlin: ['kotlin', 'kt'],
  Ruby: ['ruby', 'rb'],
  Scala: ['scala'],
  PHP: ['php'],
};

// Extra short names for problems that are hard to type in full.
const ALIASES = {
  twosum2: 'Two Sum II Input Array Is Sorted',
  lru: 'LRU Cache',
  bst: 'Validate Binary Search Tree',
  rpn: 'Evaluate Reverse Polish Notation',
  lca: 'Lowest Common Ancestor of a Binary Search Tree',
  nqueens: 'N-Queens',
  powxn: 'Pow(x, n)',
  pow: 'Pow(x, n)',
  trie: 'Implement Trie',
  mergeksortedlists: 'Merge k Sorted Lists',
  kthlargest: 'Kth Largest Element in an Array',
  buyandsellstock: 'Best Time to Buy and Sell Stock',
  coinchange2: 'Coin Change II',
  threesum: '3Sum',
  '3sum': '3Sum',
  lis: 'Longest Increasing Subsequence',
  lcs: 'Longest Common Subsequence',
};

export const ROADMAP_PROBLEMS = ROADMAP_CATEGORIES.flatMap(([category, names]) => names.map(name => ({ category, name, key: slug(name) })));
export const ROADMAP_KEYS = new Set(ROADMAP_PROBLEMS.map(problem => problem.key));
export const ROADMAP_LANGUAGE_NAMES = new Set(Object.keys(ROADMAP_LANGUAGES));

function slug(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/\b(\w+) ii\b/g, '$1 2').replace(/\b(\w+) iii\b/g, '$1 3')
    .replace(/[^a-z0-9+#]+/g, '');
}
const normalize = slug;

const LANGUAGE_BY_WORD = new Map(Object.entries(ROADMAP_LANGUAGES).flatMap(([name, words]) => words.map(word => [word, name])));
const BY_KEY = new Map(ROADMAP_PROBLEMS.map(problem => [problem.key, problem]));
for (const [alias, name] of Object.entries(ALIASES)) if (!BY_KEY.has(alias)) BY_KEY.set(alias, BY_KEY.get(slug(name)));

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

export function findProblem(text) {
  const key = normalize(text);
  if (!key) return null;
  if (BY_KEY.has(key)) return BY_KEY.get(key);
  const prefixed = [...new Set(ROADMAP_PROBLEMS.filter(problem => problem.key.startsWith(key)))];
  if (key.length >= 5 && prefixed.length === 1) return prefixed[0];
  if (key.length < 6) return null;
  const near = ROADMAP_PROBLEMS.map(problem => ({ problem, gap: distance(key, problem.key) }))
    .filter(({ gap }) => gap <= (key.length > 12 ? 2 : 1)).sort((a, b) => a.gap - b.gap);
  return near.length && (near.length === 1 || near[0].gap < near[1].gap) ? near[0].problem : null;
}

// Reads one line such as "two sum - python", "3sum (c++)" or a LeetCode link.
export function parseLine(raw) {
  let line = raw.trim()
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '');
  const link = /leetcode\.com\/problems\/([a-z0-9-]+)/i.exec(line);
  if (link) line = line.replace(/https?:\/\/\S+/i, link[1].replace(/-/g, ' '));
  const languages = [];
  for (;;) {
    const tail = /^(.*?)(?:\s*[(\[]\s*([^()\[\]]+?)\s*[)\]]|\s*[-–—:|,]\s*|\s+in\s+|\s+)([^\s,()\[\]-][^\s,()\[\]]*)\s*$/i.exec(line)
      || /^(.*)[(\[]\s*([^()\[\]]+?)\s*[)\]]\s*$/.exec(line);
    if (!tail) break;
    const word = (tail[3] || tail[2] || '').toLowerCase();
    const language = LANGUAGE_BY_WORD.get(word);
    if (!language) {
      const group = (tail[2] || '').toLowerCase().split(/[\s,/&]+/).filter(Boolean);
      if (group.length > 1 && group.every(item => LANGUAGE_BY_WORD.has(item))) {
        for (const item of group.reverse()) languages.push(LANGUAGE_BY_WORD.get(item));
        line = tail[1];
        continue;
      }
      break;
    }
    languages.push(language);
    line = tail[1];
  }
  // A language written first, as in "python: two sum".
  const head = /^([A-Za-z+#]+)\s*[:|-]\s*(.+)$/.exec(line);
  if (head && LANGUAGE_BY_WORD.has(head[1].toLowerCase()) && !findProblem(line)) {
    languages.push(LANGUAGE_BY_WORD.get(head[1].toLowerCase()));
    line = head[2];
  }
  line = line.replace(/\s*[-–—:|,]\s*$/, '').trim();
  return { title: line, languages: languages.reverse() };
}

// Returns the solves found in the text, and the lines that match no problem.
export function parseSolves(text, fallbackLanguage = '') {
  const solves = [];
  const unmatched = [];
  for (const raw of String(text).split(/[\n;]+/)) {
    if (!raw.trim()) continue;
    const { title, languages } = parseLine(raw);
    const problem = findProblem(title);
    if (!problem) {
      if (title) unmatched.push(title.slice(0, 100));
      continue;
    }
    for (const language of languages.length ? languages : [fallbackLanguage]) solves.push({ key: problem.key, name: problem.name, category: problem.category, language });
  }
  return { solves, unmatched };
}

export function otherKey(title) {
  return 'other:' + normalize(title).slice(0, 80);
}
