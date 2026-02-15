Review all uncommitted changes (staged + unstaged + untracked new files) for optimization opportunities.

Steps:

1. Run `git diff HEAD` to get all staged and unstaged changes to tracked files.
2. Run `git ls-files --others --exclude-standard` to find untracked new files, then read each one.
3. For every changed or new file, analyze the code and identify:
   - Redundant or duplicated logic that can be simplified
   - Overly verbose code that can be written more concisely
   - Unnecessary type assertions or casts (e.g. `as string` when type is already known)
   - Dead code, unused variables, or unused imports
   - Logic that can leverage existing utility functions in the codebase
   - Repeated patterns that should be extracted into a helper
   - Conditions or branches that can be simplified
   - Performance improvements (unnecessary re-renders, redundant DB queries, etc.)
4. For each finding, output:
   - File path and line range
   - Current code snippet
   - Suggested improvement with code
   - Brief explanation of why it's better
5. Group findings by file. Skip trivial style issues already handled by Prettier/ESLint.
6. At the end, provide a summary: total findings count and which files have the most room for improvement.

Important:
- Only review code that is part of the uncommitted diff or new untracked files. Do NOT review unchanged code.
- Focus on meaningful improvements, not cosmetic preferences.
- Respect the project conventions in CLAUDE.md (arrow functions, single quotes, Tailwind spacing scale, no `any`, etc.)
