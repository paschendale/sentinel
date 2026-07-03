# [1.19.0](https://github.com/paschendale/sentinel/compare/v1.18.0...v1.19.0) (2026-07-03)


### Features

* **executor:** add ctx.s3 S3 client with SigV4 signing and disk-based downloads ([81a4ddc](https://github.com/paschendale/sentinel/commit/81a4ddc7758ff726cf842e646b2f73eef00e22a2))

# [1.18.0](https://github.com/paschendale/sentinel/compare/v1.17.0...v1.18.0) (2026-07-02)


### Features

* **api:** add AES-256-GCM secret-cipher crypto module ([9935179](https://github.com/paschendale/sentinel/commit/99351796c3f151e1b847f12e2a1051a20a6ef3db))
* **api:** add optional SECRETS_ENCRYPTION_KEY config ([8a1554d](https://github.com/paschendale/sentinel/commit/8a1554db43acd5b4a4f23ee74a4d121c5ede2f97))
* **api:** add secrets CRUD routes ([5043607](https://github.com/paschendale/sentinel/commit/5043607255c420628692bfdfcf9e0d650838af7e))
* **db:** add secrets query layer ([9c9ec4e](https://github.com/paschendale/sentinel/commit/9c9ec4e9691afca5b3569a104ae59b9b231259a4))
* **db:** add secrets table migration ([b85af52](https://github.com/paschendale/sentinel/commit/b85af52b3485b916b2cf6439993d611a2c720826))
* **executor:** add in-memory secrets cache warmed at startup ([c4f1a47](https://github.com/paschendale/sentinel/commit/c4f1a47c6cefb0c0f6abc3f7158b05f9c0f3eef8))
* **executor:** expose ctx.secrets in test context ([f87daab](https://github.com/paschendale/sentinel/commit/f87daabdf8ca226deb10c2e521e3e6effc7a0e00))
* **shared:** add Secret type and secret CRUD schemas ([0266da4](https://github.com/paschendale/sentinel/commit/0266da456077e7bd3d38096fb27e3f201341ad87))
* **web:** add secrets management page ([26f661d](https://github.com/paschendale/sentinel/commit/26f661d5a6f142b2d6b801464e3b9f314652829a))

# [1.17.0](https://github.com/paschendale/sentinel/compare/v1.16.0...v1.17.0) (2026-07-02)


### Features

* **db:** remove timeout_ms hard cap, enforce timeout/schedule margin ([1e7f9f5](https://github.com/paschendale/sentinel/commit/1e7f9f5361ec227fd6233b3065b3a00171c1a2c4))
* **executor:** add ctx.ftp.ls and ctx.ftp.get for FTP probes ([394d87b](https://github.com/paschendale/sentinel/commit/394d87b66f6128e037ef0c3ee08f46b602369e7c))
* **executor:** sweep orphaned FTP temp files periodically ([9a74bd7](https://github.com/paschendale/sentinel/commit/9a74bd78e698c0826162476e37406efccafe5d74))
* **scheduler:** prevent overlapping runs of the same test ([6726de1](https://github.com/paschendale/sentinel/commit/6726de1978ceddc5afa422795a85d3cb634a9ead))
* **web:** update test editor for uncapped timeout with margin validation ([17ee820](https://github.com/paschendale/sentinel/commit/17ee820ca54b3a35b54fbf571b606faf40ce976e))

# [1.16.0](https://github.com/paschendale/sentinel/compare/v1.15.0...v1.16.0) (2026-07-02)


### Features

* add events on charts and test status page ([dafb36c](https://github.com/paschendale/sentinel/commit/dafb36c8e2765b95df78edaded8f2651a0ead58c))

# [1.15.0](https://github.com/paschendale/sentinel/compare/v1.14.1...v1.15.0) (2026-07-02)


### Features

* add tag to page title and description, also add optional parameters to track period ([8dc5194](https://github.com/paschendale/sentinel/commit/8dc51942f7c75bb385e4df10625d4cb75c905057))

## [1.14.1](https://github.com/paschendale/sentinel/compare/v1.14.0...v1.14.1) (2026-06-09)


### Bug Fixes

* **db:** ensure test_runs partitions exist at deploy time and startup ([f04f636](https://github.com/paschendale/sentinel/commit/f04f636e9e441a6da979d0c6c77395ce9cff96d0))

# [1.14.0](https://github.com/territorial-dev/sentinel/compare/v1.13.0...v1.14.0) (2026-05-15)


### Features

* **web:** auto-refresh status pages every 60 seconds ([29b9274](https://github.com/territorial-dev/sentinel/commit/29b9274f44329dfce1bad7b8309d4e857598a925))

# [1.13.0](https://github.com/territorial-dev/sentinel/compare/v1.12.0...v1.13.0) (2026-05-15)


### Features

* added email notifications ([b42eb75](https://github.com/territorial-dev/sentinel/commit/b42eb75e5eb65da0f1e289078dee05d6b452eb0d))

# [1.12.0](https://github.com/territorial-dev/sentinel/compare/v1.11.1...v1.12.0) (2026-05-15)


### Features

* added compact test view ([039b7e7](https://github.com/territorial-dev/sentinel/commit/039b7e7a46df6cb0e840881560960474cc9e9f1c))
* added detailed test view ([04fa4a9](https://github.com/territorial-dev/sentinel/commit/04fa4a95444ca6dbb8c2e627a96178154c7fc47b))

## [1.11.1](https://github.com/territorial-dev/sentinel/compare/v1.11.0...v1.11.1) (2026-05-09)


### Bug Fixes

* fixed duplciate rows on partition ([33e31c4](https://github.com/territorial-dev/sentinel/commit/33e31c4360f5ba17bc16af63c838454c26016b7a))

# [1.11.0](https://github.com/territorial-dev/sentinel/compare/v1.10.0...v1.11.0) (2026-05-09)


### Features

* added log pruning ([bedde76](https://github.com/territorial-dev/sentinel/commit/bedde76d84e5452273e53d9fcb361f9e938a9811))

# [1.10.0](https://github.com/territorial-dev/sentinel/compare/v1.9.0...v1.10.0) (2026-04-29)


### Features

* Executor · `warn` status and warning notifications ([31a1eba](https://github.com/territorial-dev/sentinel/commit/31a1eba54438c811df11424567be05491b4391b7))

# [1.9.0](https://github.com/territorial-dev/sentinel/compare/v1.8.0...v1.9.0) (2026-04-01)


### Bug Fixes

* **executor:** add explicit redirect error handling and redirect modes ([db27107](https://github.com/territorial-dev/sentinel/commit/db27107ec2ac52ecc775dcb2f313fd744e660822))


### Features

* **api:** threshold-aware incidents from recent run window ([22f83a4](https://github.com/territorial-dev/sentinel/commit/22f83a47d81a64e7a719ed522e4570d7adb1f022))
* **api:** verbose synthetic test logs and quieter inbound HTTP ([72dd104](https://github.com/territorial-dev/sentinel/commit/72dd1048ffed816231aa41689f36f855adfac7c4))

# [1.8.0](https://github.com/territorial-dev/sentinel/compare/v1.7.0...v1.8.0) (2026-03-30)


### Features

* **web:** expose retries, failure_threshold, uses_browser in test editor and details page ([e1a8379](https://github.com/territorial-dev/sentinel/commit/e1a83797a089a300020f415825fde7a56cc1cdd9))

# [1.7.0](https://github.com/territorial-dev/sentinel/compare/v1.6.0...v1.7.0) (2026-03-30)


### Features

* **web:** add sentinel logo to dashboard, status pages, and favicon ([8ca3bc9](https://github.com/territorial-dev/sentinel/commit/8ca3bc92f1cbead38cd42124f61945e591738053))

# [1.6.0](https://github.com/territorial-dev/sentinel/compare/v1.5.1...v1.6.0) (2026-03-30)


### Features

* **api:** threshold-based public status with degraded state ([f86cc16](https://github.com/territorial-dev/sentinel/commit/f86cc1655992207f886619569d18811ffafa7a9b))

## [1.5.1](https://github.com/territorial-dev/sentinel/compare/v1.5.0...v1.5.1) (2026-03-26)


### Bug Fixes

* **api:** resolve build failure in normalization test ([a290c1a](https://github.com/territorial-dev/sentinel/commit/a290c1a4a38c3166de3779c6080ed751c731adbd))

# [1.5.0](https://github.com/territorial-dev/sentinel/compare/v1.4.0...v1.5.0) (2026-03-26)


### Bug Fixes

* **api:** persist notification events and notify ongoing fail streaks ([1fbdfa8](https://github.com/territorial-dev/sentinel/commit/1fbdfa8ce7bd664f9da0f3fcf966975de9c4a356))


### Features

* set default alert cooldown to 24h ([50140d8](https://github.com/territorial-dev/sentinel/commit/50140d8a779d2decaa20261cd342f17b121b2b2c))

# [1.4.0](https://github.com/territorial-dev/sentinel/compare/v1.3.1...v1.4.0) (2026-03-26)


### Bug Fixes

* **web:** redirect to /login on 401 across all authenticated calls ([6893896](https://github.com/territorial-dev/sentinel/commit/6893896c84547e2a24a1951e4045919df98625b7))


### Features

* **web:** sortable dashboard columns and avg response time ([67dcb57](https://github.com/territorial-dev/sentinel/commit/67dcb57c76f40b8fb3c2784d7ee0dae34637bdfc))

## [1.3.1](https://github.com/territorial-dev/sentinel/compare/v1.3.0...v1.3.1) (2026-03-26)


### Bug Fixes

* **web:** replace new URL() with URLSearchParams to fix production crash ([b27c333](https://github.com/territorial-dev/sentinel/commit/b27c333f33b59a99e5e7cad074492e62f6d1f6f8)), closes [#418](https://github.com/territorial-dev/sentinel/issues/418)

# [1.3.0](https://github.com/territorial-dev/sentinel/compare/v1.2.2...v1.3.0) (2026-03-26)


### Bug Fixes

* **ci:** replace missing coverage-badges-action with inline node script ([8c3d3b5](https://github.com/territorial-dev/sentinel/commit/8c3d3b54f9da4ab6d40db09f2403afe222c7a5ac))
* **executor:** add json() method to HttpResponse ([8c7e790](https://github.com/territorial-dev/sentinel/commit/8c7e790bf48e4b4eb855df25f704278170514220))


### Features

* **web:** granular status history with period selector (F-23) ([11626d4](https://github.com/territorial-dev/sentinel/commit/11626d472e06fc59b02d902c8aa0e5a091ce1667))

## [1.2.2](https://github.com/territorial-dev/sentinel/compare/v1.2.1...v1.2.2) (2026-03-25)


### Bug Fixes

* **shared:** build shared before dev and ignore dist output ([9e1767b](https://github.com/territorial-dev/sentinel/commit/9e1767b73c15fd5ca4e9ba25c05424f62d9d3b72))

## [1.2.1](https://github.com/territorial-dev/sentinel/compare/v1.2.0...v1.2.1) (2026-03-25)


### Bug Fixes

* **ci:** fix badge URLs and replace Codecov with self-hosted coverage badge ([a2c328d](https://github.com/territorial-dev/sentinel/commit/a2c328d5b4c588cd08fa97d4c1b2d5d3bdc1b7e4))

# [1.2.0](https://github.com/territorial-dev/sentinel/compare/v1.1.1...v1.2.0) (2026-03-25)


### Bug Fixes

* **ci:** run migrations before integration tests ([a2b3c26](https://github.com/territorial-dev/sentinel/commit/a2b3c26633622a0b51322d12f6b17688beec369a))


### Features

* **ci:** add automated test workflow with coverage reporting ([ced7b46](https://github.com/territorial-dev/sentinel/commit/ced7b4672fc978871f4985cff0ef4528b4cc3e87))

## [1.1.1](https://github.com/territorial-dev/sentinel/compare/v1.1.0...v1.1.1) (2026-03-25)


### Bug Fixes

* **ci:** copy SQL migrations and api package.json into runner image ([617cd2b](https://github.com/territorial-dev/sentinel/commit/617cd2b88f4c616167bfbd4914cc02848c8fd15a))

# [1.1.0](https://github.com/territorial-dev/sentinel/compare/v1.0.3...v1.1.0) (2026-03-25)


### Features

* **db:** run migrations automatically on API startup ([6fddd12](https://github.com/territorial-dev/sentinel/commit/6fddd121c57347ef3f682bae804e1bc3b4f92728))

## [1.0.3](https://github.com/territorial-dev/sentinel/compare/v1.0.2...v1.0.3) (2026-03-25)


### Bug Fixes

* **ci:** fix standalone path and shared TypeScript runtime errors in Docker ([ecedea4](https://github.com/territorial-dev/sentinel/commit/ecedea497e393b2b0f363d5c45953ff7bba44e91))

## [1.0.2](https://github.com/territorial-dev/sentinel/compare/v1.0.1...v1.0.2) (2026-03-25)


### Bug Fixes

* **ci:** create public dir in build-web stage if missing ([1371379](https://github.com/territorial-dev/sentinel/commit/1371379e10ce9538b9432f2edc53ca1496447503))

## [1.0.1](https://github.com/territorial-dev/sentinel/compare/v1.0.0...v1.0.1) (2026-03-25)


### Bug Fixes

* **ci:** trigger Docker builds from release job outputs, not release event ([a9dc2a7](https://github.com/territorial-dev/sentinel/commit/a9dc2a7b6ef2a2be98a360b3b787054611c1c204))

# 1.0.0 (2026-03-25)


### Bug Fixes

* **aggregator:** run at startup and cover today's partial data ([cb74143](https://github.com/territorial-dev/sentinel/commit/cb74143eaf0da070b19d90fa48ee47d8ef0cb583))
* **api:** add CORS headers and OPTIONS handling for browser clients ([3c9e7b2](https://github.com/territorial-dev/sentinel/commit/3c9e7b2f8c408cf9cec54ac46b75e4e2db63e46a))
* **api:** listen on port 3001 to avoid conflict with Next.js dev server ([b07cc04](https://github.com/territorial-dev/sentinel/commit/b07cc04bac8203cf8c80346eea2277baeb93e8b5))
* **db:** resolve TS errors in aggregator for regex match groups and array access ([e46014a](https://github.com/territorial-dev/sentinel/commit/e46014a482464e780491608defb74706dd9d9099))
* **executor:** use AsyncFunction so user code can use await ([e88614d](https://github.com/territorial-dev/sentinel/commit/e88614d288fac2fad8d645b330dc5c7d20691743))
* **tests:** exclude dist/ from vitest, add GET /status unit tests ([4cc700f](https://github.com/territorial-dev/sentinel/commit/4cc700fe04da95acb1155b70bc5cb45ecfe8ec7e))
* **web:** add dashboard back-link to channels page ([0daebb4](https://github.com/territorial-dev/sentinel/commit/0daebb45f565f6c14d719ca2aa16fef34af30676))
* **web:** improve Run Now panel layout and log positioning ([56a9ef8](https://github.com/territorial-dev/sentinel/commit/56a9ef8db00490bdbe057ac55c1fcf079696594a))


### Features

* add public status page (F-12) ([a71e803](https://github.com/territorial-dev/sentinel/commit/a71e803cf76add96e7b73dd9eb00076e023a3e39))
* add Run Now button and real-time log streaming (F-14, F-15) ([00dc638](https://github.com/territorial-dev/sentinel/commit/00dc638e89f45eb01aee08f128c6bb62b3509f95))
* **api,web:** F-21 notification channel management ([3152609](https://github.com/territorial-dev/sentinel/commit/315260990bdf8e0e759f60e2f4bec7cf232c6a66))
* **api,web:** F-22 channel assignments ([d1fd0ab](https://github.com/territorial-dev/sentinel/commit/d1fd0ab3259abe4979293558ffb4041e0bfff086))
* **api:** add export/import endpoints and incident timeline ([9d04aef](https://github.com/territorial-dev/sentinel/commit/9d04aef5da136a8ae69da7d907b8c4b9e8adf200))
* **api:** add GET /tests/:id/runs for recent run history ([9a34086](https://github.com/territorial-dev/sentinel/commit/9a340860f777a26062e3388afbe9fda50d5ce9bd))
* **api:** add JWT authentication to all non-public routes ([3553c21](https://github.com/territorial-dev/sentinel/commit/3553c215a6504e175d7024bd5358dee222220f87))
* **api:** add tag support to tests, dashboard, and status routes ([4e8422b](https://github.com/territorial-dev/sentinel/commit/4e8422be2ccba718a37eaeb1d4c79cc27869ab01))
* **api:** embed assertion results in GET /tests/:id/runs ([dce9f61](https://github.com/territorial-dev/sentinel/commit/dce9f615092b4a8ac8d8f66a2fc554df04bbacfb))
* **api:** implement Test CRUD endpoints (F-02) ([e4a8491](https://github.com/territorial-dev/sentinel/commit/e4a8491853617d2abd1d1492033c83c72b7d3379))
* **ci:** add Docker build and push workflows for M-02 and M-03 ([d967f65](https://github.com/territorial-dev/sentinel/commit/d967f65dae0441e4866bec27425fb166433645a5))
* **ci:** add semantic release workflow ([e850854](https://github.com/territorial-dev/sentinel/commit/e85085495870f098c99aa891fcd9ca73665885ad))
* **db:** add schema migrations and runner for F-01 ([eef83b7](https://github.com/territorial-dev/sentinel/commit/eef83b7d21613f39fdd7788bf9b175f22dd9fb83))
* **db:** add tags column to tests table ([c1578ae](https://github.com/territorial-dev/sentinel/commit/c1578ae93374c57afc1d77e8ce34617311a820ca))
* **db:** implement F-05 result persistence with in-memory buffer ([18b1567](https://github.com/territorial-dev/sentinel/commit/18b1567b8a6a72fd81cf1b3c329a8556a005f8c6))
* **db:** implement F-06 daily aggregation cron ([e3b0efa](https://github.com/territorial-dev/sentinel/commit/e3b0efa76da0e45c52d564db7e2ce0f425da6486))
* **executor:** implement F-03 execution engine with compile cache and timeout ([79ab87f](https://github.com/territorial-dev/sentinel/commit/79ab87f18d03a51906ef12329df4c55703a75fee))
* **metrics:** implement F-08 Prometheus metrics ([a54cc35](https://github.com/territorial-dev/sentinel/commit/a54cc353fa06cb7f8d558161b1b2b7d066a0e233))
* **notifier:** enrich notifications and add per-test alert config ([dcf0578](https://github.com/territorial-dev/sentinel/commit/dcf0578471a056e22a9d3558e7189400da0e8951))
* **notifier:** implement F-07 state-transition notifications ([bcca71e](https://github.com/territorial-dev/sentinel/commit/bcca71efcd14b4edad270a9129caec64fb48954b))
* **scheduler:** implement F-04 scheduler with jitter and p-limit concurrency cap ([21cc4b4](https://github.com/territorial-dev/sentinel/commit/21cc4b406785fc901ec7fab31bbd7d3b6ba94415))
* **scheduler:** run enabled tests immediately on creation ([3c89e43](https://github.com/territorial-dev/sentinel/commit/3c89e433f4d92202762dda7901879a3560f89cca))
* **shared:** add tags field to Test, TestSummary, and PublicStatusTest ([b3ff000](https://github.com/territorial-dev/sentinel/commit/b3ff000f0d43de1c525d9674f174b4900dfd72c7))
* **web:** add incident timeline to test detail page ([bd6e8b4](https://github.com/territorial-dev/sentinel/commit/bd6e8b4dbf14f391758d77240cfbbb8e3567a82d))
* **web:** add login page and auth headers to all protected API calls ([28ba09a](https://github.com/territorial-dev/sentinel/commit/28ba09a814269624cc96f65e0ee5f9b524d207a5))
* **web:** add status page link to dashboard header ([4942e65](https://github.com/territorial-dev/sentinel/commit/4942e653ddfd94c48a5930c55dca2ce16d5e8c60))
* **web:** add tag editor, dashboard filter pills, and /status/[slug] page ([fc21231](https://github.com/territorial-dev/sentinel/commit/fc21231a9674747c027d23153021f493847dcb97))
* **web:** add test editor with Monaco, run control, and unsaved-code gate ([457d896](https://github.com/territorial-dev/sentinel/commit/457d896d9bcf620d75d1a390ef65a418aa41dbf0))
* **web:** display named assertion results in run history ([0473c27](https://github.com/territorial-dev/sentinel/commit/0473c27dc43d1c7e66899bdf232ac9a5673cfcff))
* **web:** implement F-09 dashboard with server-rendered test list ([49e8061](https://github.com/territorial-dev/sentinel/commit/49e806112b84761a43b8851f56e862075f58e4a0))
* **web:** test detail full width, code preview, Recharts latency chart ([cefe039](https://github.com/territorial-dev/sentinel/commit/cefe039e70615c0c5e682c05dad7455306a6827c))
* **web:** test detail page, edit route, and delete confirmation dialog ([6ff65af](https://github.com/territorial-dev/sentinel/commit/6ff65affe33c319e152e2c216eee9d3fb871fdbd))
