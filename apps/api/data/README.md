# API data files

Files the API reads at runtime that are not code: reference data a fork ships with its image (a station list, a lookup table). Upstream ships none.

Both images copy this folder next to the compiled API, so code finds it at `../data` relative to `dist/` (and to `src/` under `tsx`), whichever image runs it. Operators can bind-mount a directory over a subfolder to replace its files without rebuilding.
