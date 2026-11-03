# Depthsworn Council

Public voting page for Depthsworn: anyone with the link picks answers and leaves thoughts, no account needed.

- `questions.js`: the questions (edit to add, close or add a plan).
- `config.js`: the Supabase project URL and anon key (public by design; row-level security protects the data).
- Votes and thoughts live in the Supabase tables `votes` and `thoughts`.
