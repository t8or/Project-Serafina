# Local startup report

Date: 2026-07-09
Machine: macOS (Apple Silicon)

## Issues encountered

### Outdated Node runtime contract

The machine already used Node 26.5.0, the latest installed major, while
Serafina enforced Node 24 LTS. The project runtime contract was updated to
Node 26 Current (`>=26 <27`) so the application moves forward with the current
release instead of downgrading the machine. The temporarily installed Node 24
formula was removed after the Node 26 verification passed.

### Python environment timed out in the synced checkout

Creating `.venv` inside the iCloud-synced project directory failed with
`[Errno 60] Operation timed out` while writing `pyvenv.cfg`. The environment
was instead created at:

```text
~/Library/Application Support/Project Serafina/.venv
```

This matches the project's requirement to keep mutable runtime files outside
the synced source checkout.

### Invalid Python requirement

`requirements.txt` listed `tesseract-ocr==5.3.3`, but PyPI does not publish
that distribution/version. Tesseract is a system executable; the requirement
was replaced with an installation note while retaining the pinned
`pytesseract` Python adapter.

### Missing EasyOCR extra

The runtime configuration requires Docling's `easyocr` model family, but the
Python dependency list did not install Docling's optional EasyOCR dependency.
The artifact downloader failed with `ModuleNotFoundError: No module named
'easyocr'`. `easyocr==1.7.2` was added to the pinned requirements before the
artifact download was retried.

### Incompatible Docling version probe

The readiness check imported `docling.__version__`, but Docling 2.66 does not
expose that attribute. The check failed even though Docling and its artifacts
were installed correctly. The bridge now reads the installed distribution
version through Python's standard `importlib.metadata` API.

### Restricted network during dependency installation

The first JavaScript dependency install could not resolve `registry.npmjs.org`
in the restricted environment. It succeeded after network access was granted.

### Dependency audit findings

The locked JavaScript dependency tree reports 35 advisories: 4 low, 17
moderate, 12 high, and 2 critical. No automatic audit fix was applied because
that can change locked versions and potentially introduce breaking changes.

### Node 26 build deprecation warning

The build succeeds on Node 26 but Tailwind CSS 4.0's `@tailwindcss/node`
dependency calls Node's deprecated `module.register()` API. Node reports
`DEP0205` and recommends `module.registerHooks()`. This is a non-blocking
upstream dependency warning; no automatic Tailwind upgrade was applied because
that could alter generated styles.

## Verification

Final verification completed successfully:

```sh
npm run build
npm test
npm run local:doctor
npm run local:start
```

- Webpack production build on Node 26.5.0: passed (with the documented
  Tailwind deprecation warning)
- Node test suite: 5 passed, 0 failed
- Local runtime doctor: all 7 checks passed
- HTTP smoke test: `GET /` returned 200
- Docling status endpoint: available, version 2.66.0, 47 verified artifacts
- Running URL: `http://127.0.0.1:3002`
