// LeetCode Top Interview 150, regrouped into the ten stages from the study roadmap.
// Source: https://leetcode.com/studyplan/top-interview-150/
// Stable problem slugs are also the persistence keys. No progress lives in this file.
const group = (title, rows) => ({
  title,
  problems: rows.trim().split('\n').map(row => {
    const [level, id, title] = row.split('|');
    return { id, title, difficulty: { E: 'Easy', M: 'Medium', H: 'Hard' }[level] };
  }),
});

export const ROADMAP = [
  {
    id: 'foundations', title: 'Foundations',
    goal: 'Counting, lookups, indexing, and prefix / suffix information.',
    checkpoint: 'Explain when a hash map replaces a nested loop, and what each index represents.',
    groups: [
      group('Arrays & strings', `
E|merge-sorted-array|Merge Sorted Array
E|remove-element|Remove Element
E|remove-duplicates-from-sorted-array|Remove Duplicates from Sorted Array
M|remove-duplicates-from-sorted-array-ii|Remove Duplicates from Sorted Array II
E|majority-element|Majority Element
M|rotate-array|Rotate Array
E|best-time-to-buy-and-sell-stock|Best Time to Buy and Sell Stock
M|best-time-to-buy-and-sell-stock-ii|Best Time to Buy and Sell Stock II
M|jump-game|Jump Game
M|jump-game-ii|Jump Game II
M|h-index|H-Index
M|insert-delete-getrandom-o1|Insert Delete GetRandom O(1)
M|product-of-array-except-self|Product of Array Except Self
M|gas-station|Gas Station
H|candy|Candy
H|trapping-rain-water|Trapping Rain Water
E|roman-to-integer|Roman to Integer
M|integer-to-roman|Integer to Roman
E|length-of-last-word|Length of Last Word
E|longest-common-prefix|Longest Common Prefix
M|reverse-words-in-a-string|Reverse Words in a String
M|zigzag-conversion|Zigzag Conversion
E|find-the-index-of-the-first-occurrence-in-a-string|Find the Index of the First Occurrence in a String
H|text-justification|Text Justification`),
      group('Hash maps', `
E|ransom-note|Ransom Note
E|isomorphic-strings|Isomorphic Strings
E|word-pattern|Word Pattern
E|valid-anagram|Valid Anagram
M|group-anagrams|Group Anagrams
E|two-sum|Two Sum
E|happy-number|Happy Number
E|contains-duplicate-ii|Contains Duplicate II
M|longest-consecutive-sequence|Longest Consecutive Sequence`),
      group('Matrix traversal', `
M|valid-sudoku|Valid Sudoku
M|spiral-matrix|Spiral Matrix
M|rotate-image|Rotate Image
M|set-matrix-zeroes|Set Matrix Zeroes
M|game-of-life|Game of Life`),
    ],
  },
  {
    id: 'linear-patterns', title: 'Linear patterns',
    goal: 'Maintain an invariant while scanning instead of rescanning.',
    checkpoint: 'State what makes the current window valid and when each pointer moves.',
    groups: [
      group('Two pointers', `
E|valid-palindrome|Valid Palindrome
E|is-subsequence|Is Subsequence
M|two-sum-ii-input-array-is-sorted|Two Sum II - Input Array Is Sorted
M|container-with-most-water|Container With Most Water
M|3sum|3Sum`),
      group('Sliding window', `
M|minimum-size-subarray-sum|Minimum Size Subarray Sum
M|longest-substring-without-repeating-characters|Longest Substring Without Repeating Characters
H|substring-with-concatenation-of-all-words|Substring with Concatenation of All Words
H|minimum-window-substring|Minimum Window Substring`),
      group('Stacks', `
E|valid-parentheses|Valid Parentheses
M|simplify-path|Simplify Path
M|min-stack|Min Stack
M|evaluate-reverse-polish-notation|Evaluate Reverse Polish Notation
H|basic-calculator|Basic Calculator`),
    ],
  },
  {
    id: 'search-and-order', title: 'Search & order',
    goal: 'Eliminate search space; sort to expose structure.',
    checkpoint: 'Explain your binary-search boundaries and why the discarded half cannot contain the answer.',
    groups: [
      group('Binary search', `
E|search-insert-position|Search Insert Position
M|search-a-2d-matrix|Search a 2D Matrix
M|find-peak-element|Find Peak Element
M|search-in-rotated-sorted-array|Search in Rotated Sorted Array
M|find-first-and-last-position-of-element-in-sorted-array|Find First and Last Position of Element in Sorted Array
M|find-minimum-in-rotated-sorted-array|Find Minimum in Rotated Sorted Array
H|median-of-two-sorted-arrays|Median of Two Sorted Arrays`),
      group('Intervals', `
E|summary-ranges|Summary Ranges
M|merge-intervals|Merge Intervals
M|insert-interval|Insert Interval
M|minimum-number-of-arrows-to-burst-balloons|Minimum Number of Arrows to Burst Balloons`),
    ],
  },
  {
    id: 'linked-lists', title: 'Linked lists',
    goal: 'Pointer manipulation, dummy nodes, and fast / slow pointers.',
    checkpoint: 'Draw the pointers before and after each update without losing the remainder of the list.',
    groups: [group('Linked lists', `
E|linked-list-cycle|Linked List Cycle
M|add-two-numbers|Add Two Numbers
E|merge-two-sorted-lists|Merge Two Sorted Lists
M|copy-list-with-random-pointer|Copy List with Random Pointer
M|reverse-linked-list-ii|Reverse Linked List II
H|reverse-nodes-in-k-group|Reverse Nodes in k-Group
M|remove-nth-node-from-end-of-list|Remove Nth Node From End of List
M|remove-duplicates-from-sorted-list-ii|Remove Duplicates from Sorted List II
M|rotate-list|Rotate List
M|partition-list|Partition List
M|lru-cache|LRU Cache`)],
  },
  {
    id: 'trees', title: 'Trees',
    goal: 'Recursive return values, traversal order, and level processing.',
    checkpoint: 'Before coding, define what a recursive call returns and its empty-tree base case.',
    groups: [
      group('Binary trees', `
E|maximum-depth-of-binary-tree|Maximum Depth of Binary Tree
E|same-tree|Same Tree
E|invert-binary-tree|Invert Binary Tree
E|symmetric-tree|Symmetric Tree
M|construct-binary-tree-from-preorder-and-inorder-traversal|Construct Binary Tree from Preorder and Inorder Traversal
M|construct-binary-tree-from-inorder-and-postorder-traversal|Construct Binary Tree from Inorder and Postorder Traversal
M|populating-next-right-pointers-in-each-node-ii|Populating Next Right Pointers in Each Node II
M|flatten-binary-tree-to-linked-list|Flatten Binary Tree to Linked List
E|path-sum|Path Sum
M|sum-root-to-leaf-numbers|Sum Root to Leaf Numbers
H|binary-tree-maximum-path-sum|Binary Tree Maximum Path Sum
M|binary-search-tree-iterator|Binary Search Tree Iterator
E|count-complete-tree-nodes|Count Complete Tree Nodes
M|lowest-common-ancestor-of-a-binary-tree|Lowest Common Ancestor of a Binary Tree`),
      group('Breadth-first traversal', `
M|binary-tree-right-side-view|Binary Tree Right Side View
E|average-of-levels-in-binary-tree|Average of Levels in Binary Tree
M|binary-tree-level-order-traversal|Binary Tree Level Order Traversal
M|binary-tree-zigzag-level-order-traversal|Binary Tree Zigzag Level Order Traversal`),
      group('Binary search trees', `
E|minimum-absolute-difference-in-bst|Minimum Absolute Difference in BST
M|kth-smallest-element-in-a-bst|Kth Smallest Element in a BST
M|validate-binary-search-tree|Validate Binary Search Tree`),
    ],
  },
  {
    id: 'specialized-structures', title: 'Specialized structures',
    goal: 'Top-k selection, priority processing, and prefix search.',
    checkpoint: 'Explain why a heap or trie is a better fit than sorting or a plain hash map.',
    groups: [
      group('Heaps', `
M|kth-largest-element-in-an-array|Kth Largest Element in an Array
H|ipo|IPO
M|find-k-pairs-with-smallest-sums|Find K Pairs with Smallest Sums
H|find-median-from-data-stream|Find Median from Data Stream`),
      group('Tries', `
M|implement-trie-prefix-tree|Implement Trie (Prefix Tree)
M|design-add-and-search-words-data-structure|Design Add and Search Words Data Structure
H|word-search-ii|Word Search II`),
    ],
  },
  {
    id: 'graphs', title: 'Graphs',
    goal: 'Visited state, connected components, dependencies, and unweighted shortest paths.',
    checkpoint: 'Choose DFS or BFS deliberately, and explain when a node becomes visited.',
    groups: [
      group('Graph traversal & dependencies', `
M|number-of-islands|Number of Islands
M|surrounded-regions|Surrounded Regions
M|clone-graph|Clone Graph
M|evaluate-division|Evaluate Division
M|course-schedule|Course Schedule
M|course-schedule-ii|Course Schedule II`),
      group('Graph BFS', `
M|snakes-and-ladders|Snakes and Ladders
M|minimum-genetic-mutation|Minimum Genetic Mutation
H|word-ladder|Word Ladder`),
    ],
  },
  {
    id: 'recursive-search', title: 'Recursive search',
    goal: 'Choose → explore → undo. Split → solve → combine.',
    checkpoint: 'Explain your search state, stopping condition, and how you restore state after a branch.',
    groups: [
      group('Backtracking', `
M|letter-combinations-of-a-phone-number|Letter Combinations of a Phone Number
M|combinations|Combinations
M|permutations|Permutations
M|combination-sum|Combination Sum
H|n-queens-ii|N-Queens II
M|generate-parentheses|Generate Parentheses
M|word-search|Word Search`),
      group('Divide & conquer', `
E|convert-sorted-array-to-binary-search-tree|Convert Sorted Array to Binary Search Tree
M|sort-list|Sort List
M|construct-quad-tree|Construct Quad Tree
H|merge-k-sorted-lists|Merge k Sorted Lists`),
    ],
  },
  {
    id: 'dynamic-programming', title: 'Dynamic programming',
    goal: 'State, transitions, base cases, memoization, and tabulation.',
    checkpoint: 'Describe each state in one sentence and derive its transition before writing loops.',
    groups: [
      group('Kadane’s algorithm', `
M|maximum-subarray|Maximum Subarray
M|maximum-sum-circular-subarray|Maximum Sum Circular Subarray`),
      group('1D dynamic programming', `
E|climbing-stairs|Climbing Stairs
M|house-robber|House Robber
M|word-break|Word Break
M|coin-change|Coin Change
M|longest-increasing-subsequence|Longest Increasing Subsequence`),
      group('Multidimensional dynamic programming', `
M|triangle|Triangle
M|minimum-path-sum|Minimum Path Sum
M|unique-paths-ii|Unique Paths II
M|longest-palindromic-substring|Longest Palindromic Substring
M|interleaving-string|Interleaving String
M|edit-distance|Edit Distance
H|best-time-to-buy-and-sell-stock-iii|Best Time to Buy and Sell Stock III
H|best-time-to-buy-and-sell-stock-iv|Best Time to Buy and Sell Stock IV
M|maximal-square|Maximal Square`),
    ],
  },
  {
    id: 'math-and-bits', title: 'Math & bits',
    goal: 'Representations, arithmetic properties, and overflow boundaries.',
    checkpoint: 'Explain the bit operation or arithmetic invariant instead of memorizing a trick.',
    groups: [
      group('Bit manipulation', `
E|add-binary|Add Binary
E|reverse-bits|Reverse Bits
E|number-of-1-bits|Number of 1 Bits
E|single-number|Single Number
M|single-number-ii|Single Number II
M|bitwise-and-of-numbers-range|Bitwise AND of Numbers Range`),
      group('Mathematics', `
E|palindrome-number|Palindrome Number
E|plus-one|Plus One
M|factorial-trailing-zeroes|Factorial Trailing Zeroes
E|sqrtx|Sqrt(x)
M|powx-n|Pow(x, n)
H|max-points-on-a-line|Max Points on a Line`),
    ],
  },
];

export const ROADMAP_PROBLEMS = ROADMAP.flatMap(stage => stage.groups.flatMap(group => group.problems));
