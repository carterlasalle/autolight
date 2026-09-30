# e2e (reserved)

Playwright journeys live in `../journeys/` and run via
`yarn workspace @autolight/desktop test:e2e`. This directory stays empty so
the Vitest workspace never collects Playwright `test()` calls (T-TRU-07, S18).
